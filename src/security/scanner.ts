/**
 * Scanner — Phase 1A.
 *
 * Walks a target directory, reads source/config/secret/infra files, and runs
 * the deterministic pattern set over them. No LLM involved: fast and
 * reproducible. Produces structured findings and writes `.opensec/last-scan.json`.
 */

import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import * as path from 'path'
import { ALL_PATTERNS } from './patterns.js'
import type { Finding, ScanResult, SecurityPattern } from './types.js'
import { severityRank } from './types.js'

/** Directories never worth scanning. */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.opensec', '.next', '.nuxt', '.cache', 'vendor', '__pycache__',
  '.venv', 'venv', '.idea', '.vscode',
])

/** File extensions and exact names we scan. */
const SCAN_EXTENSIONS = new Set([
  '.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.rb', '.java', '.php',
  '.rs', '.cpp', '.cc', '.c', '.cs', '.tf', '.hcl', '.toml',
  '.yaml', '.yml', '.json', '.env', '.pem', '.key', '.p12', '.pfx',
])

const SCAN_NAMES = new Set([
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.gitlab-ci.yml', 'Jenkinsfile',
])

/** Files that are noisy/derived and produce false positives. */
const IGNORE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'poetry.lock', 'Cargo.lock',
])

const MAX_FILE_BYTES = 1_000_000 // skip files > 1MB (likely generated/binary)
const SNIPPET_MAX = 200

export interface ScannerOptions {
  /** Absolute path of the directory to scan. */
  targetPath: string
  version?: string
  /** Persist `.opensec/last-scan.json`. Default true. */
  persist?: boolean
  /** Optional callback fired as each finding is discovered (for live UI). */
  onFinding?: (finding: Finding) => void
  /** Optional callback fired as files are scanned (for progress). */
  onProgress?: (scanned: number, total: number) => void
}

function shouldScanFile(name: string): boolean {
  if (IGNORE_NAMES.has(name)) return false
  if (SCAN_NAMES.has(name)) return true
  if (name.startsWith('.env')) return true // .env, .env.local, .env.production
  const ext = path.extname(name)
  return SCAN_EXTENSIONS.has(ext)
}

/** Does this file's name match a pattern's `files` restriction? */
function fileMatchesScope(fileName: string, scope?: string[]): boolean {
  if (!scope || scope.length === 0) return true
  return scope.some((glob) => {
    if (glob.startsWith('*.')) return fileName.endsWith(glob.slice(1))
    return fileName === glob
  })
}

/** Recursively collect scannable files under a directory. */
async function collectFiles(root: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        await walk(full)
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        results.push(full)
      }
    }
  }
  await walk(root)
  return results
}

function makeId(file: string, line: number, ruleName: string): string {
  return createHash('sha1')
    .update(`${file}:${line}:${ruleName}`)
    .digest('hex')
    .slice(0, 12)
}

function trimSnippet(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > SNIPPET_MAX ? `${trimmed.slice(0, SNIPPET_MAX)}…` : trimmed
}

/** Run every applicable pattern against one file's content. */
function scanContent(relFile: string, fileName: string, content: string): Finding[] {
  const findings: Finding[] = []
  const lines = content.split(/\r?\n/)

  const applicable = ALL_PATTERNS.filter((p) => fileMatchesScope(fileName, p.files))
  const lineBased = applicable.filter((p) => !p.multiline)
  const multiline = applicable.filter((p) => p.multiline)

  // Line-by-line patterns (most): gives precise line/column.
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]
    if (lineText.includes('opensec-ignore')) continue
    for (const pattern of lineBased) {
      const m = pattern.regex.exec(lineText)
      if (m) {
        findings.push(buildFinding(relFile, i + 1, (m.index ?? 0) + 1, pattern, lineText))
      }
    }
  }

  // Whole-file patterns (multi-line regexes).
  for (const pattern of multiline) {
    const m = pattern.regex.exec(content)
    if (m) {
      const before = content.slice(0, m.index)
      const lineNo = before.split(/\r?\n/).length
      if (!lines[lineNo - 1]?.includes('opensec-ignore')) {
        findings.push(buildFinding(relFile, lineNo, 1, pattern, lines[lineNo - 1] ?? m[0]))
      }
    }
  }

  return findings
}

function buildFinding(
  file: string,
  line: number,
  column: number,
  pattern: SecurityPattern,
  snippet: string,
): Finding {
  return {
    id: makeId(file, line, pattern.name),
    file,
    line,
    column,
    ruleName: pattern.name,
    severity: pattern.severity,
    category: pattern.category,
    snippet: trimSnippet(snippet),
    description: pattern.description,
    remediation: pattern.remediation,
  }
}

export async function runScanner(opts: ScannerOptions): Promise<ScanResult> {
  const start = Date.now()
  const { targetPath } = opts
  const files = await collectFiles(targetPath)
  const findings: Finding[] = []

  let scanned = 0
  for (const absFile of files) {
    let content: string
    try {
      const stat = await fs.stat(absFile)
      if (stat.size > MAX_FILE_BYTES) {
        scanned++
        opts.onProgress?.(scanned, files.length)
        continue
      }
      content = await fs.readFile(absFile, 'utf8')
    } catch {
      scanned++
      opts.onProgress?.(scanned, files.length)
      continue
    }

    const relFile = path.relative(targetPath, absFile).replace(/\\/g, '/')
    const fileName = path.basename(absFile)
    for (const finding of scanContent(relFile, fileName, content)) {
      findings.push(finding)
      opts.onFinding?.(finding)
    }
    scanned++
    opts.onProgress?.(scanned, files.length)
  }

  findings.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) ||
    a.file.localeCompare(b.file) ||
    a.line - b.line,
  )

  const result: ScanResult = {
    tool: 'opensec-intelligence',
    version: opts.version ?? '0.0.0',
    scannedAt: new Date().toISOString(),
    targetPath,
    filesScanned: files.length,
    durationMs: Date.now() - start,
    findings,
  }

  if (opts.persist !== false) {
    await persistScan(targetPath, result)
  }
  return result
}

/** Write `.opensec/last-scan.json` under the target path. */
export async function persistScan(targetPath: string, result: ScanResult): Promise<string> {
  const dir = path.join(targetPath, '.opensec')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'last-scan.json')
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf8')
  return file
}

/** Load a previously persisted scan (used by `fix` / `report`). */
export async function loadLastScan(targetPath: string): Promise<ScanResult | null> {
  const file = path.join(targetPath, '.opensec', 'last-scan.json')
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as ScanResult
  } catch {
    return null
  }
}
