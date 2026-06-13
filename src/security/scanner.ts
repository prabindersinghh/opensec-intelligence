/**
 * Scanner — deterministic regex-based security scan.
 *
 * Walks a target directory, reads source/config/infra files, and runs the
 * pattern set.  No LLM: fast and reproducible.  Produces structured findings
 * and writes `.opensec/last-scan.json`.
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

/**
 * Relative paths (forward-slash, from scan root) that are excluded from
 * self-scanning.  Prevents patterns.ts regexes matching their own source text,
 * and avoids noise from evaluation / documentation files.
 */
const SKIP_REL_PREFIXES: string[] = [
  'src/security/patterns.ts',
  'evals/',
  'eval/',
  'docs/',
  'README',
  'AUDIT',
  'BENCHMARK',
  'CHANGELOG',
  '_fp_audit',
]

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

/** Lock files — large, noisy, no real findings. */
const IGNORE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'poetry.lock', 'Cargo.lock',
])

const MAX_FILE_BYTES = 1_000_000
const SNIPPET_MAX = 200

export interface ScannerOptions {
  targetPath: string
  version?: string
  persist?: boolean
  onFinding?: (finding: Finding) => void
  onProgress?: (scanned: number, total: number) => void
}

function shouldScanFile(name: string): boolean {
  if (IGNORE_NAMES.has(name)) return false
  if (SCAN_NAMES.has(name)) return true
  if (name.startsWith('.env')) return true
  return SCAN_EXTENSIONS.has(path.extname(name))
}

/** True if the relative file path should be excluded from scanning entirely. */
function isSkippedPath(relFile: string): boolean {
  for (const prefix of SKIP_REL_PREFIXES) {
    if (relFile === prefix || relFile.startsWith(prefix)) return true
  }
  return false
}

/** True when the file looks like a test / spec / fixture. */
function isTestFile(relFile: string): boolean {
  const lower = relFile.toLowerCase()
  if (/\.(test|spec)\.[jt]sx?$/.test(lower)) return true
  return (
    lower.includes('/test/') ||
    lower.includes('/tests/') ||
    lower.includes('/__tests__/') ||
    lower.includes('/spec/') ||
    lower.includes('/fixtures/') ||
    lower.includes('/mocks/') ||
    lower.startsWith('test/') ||
    lower.startsWith('tests/') ||
    lower.startsWith('spec/')
  )
}

/**
 * True when a source line is a comment (not meaningful code).
 * Covers the most common single-line comment forms.
 */
function isLineInComment(line: string): boolean {
  const t = line.trimStart()
  return (
    t.startsWith('//') ||
    t.startsWith('#') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('<!--') ||
    t.startsWith('--')
  )
}

/** Does the file name/extension match a pattern's `files` restriction? */
function fileMatchesScope(fileName: string, scope?: string[]): boolean {
  if (!scope || scope.length === 0) return true
  return scope.some((s) => {
    if (s.startsWith('.')) return fileName.endsWith(s) || path.extname(fileName) === s
    return fileName === s
  })
}

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
  return createHash('sha1') // opensec-ignore — SHA-1 used only for a short deterministic ID, not cryptographic security
    .update(`${file}:${line}:${ruleName}`)
    .digest('hex')
    .slice(0, 12)
}

function trimSnippet(text: string): string {
  const t = text.trim()
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t
}

/**
 * Data-only extensions: JSON/YAML/TOML can hold secrets but not executable
 * code, so CODE_PATTERNS (eval, SQL, CORS, etc.) are noise in these files.
 */
const DATA_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml'])

/** Run every applicable pattern against one file's content. */
function scanContent(
  relFile: string,
  fileName: string,
  content: string,
  testFile: boolean,
): Finding[] {
  const findings: Finding[] = []
  const lines = content.split(/\r?\n/)

  const isDataFile = DATA_EXTENSIONS.has(path.extname(fileName).toLowerCase())
  const applicable = ALL_PATTERNS.filter((p) => {
    if (!fileMatchesScope(fileName, p.files)) return false
    // Skip code-execution patterns in JSON/YAML/TOML — they only produce noise.
    if (isDataFile && p.category === 'code') return false
    return true
  })
  const lineBased = applicable.filter((p) => !p.multiline)
  const multilinePats = applicable.filter((p) => p.multiline)

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]

    // Suppression markers on this line or the line immediately above it.
    const prevLine = i > 0 ? lines[i - 1] : ''
    if (
      lineText.includes('opensec-ignore') ||
      lineText.includes('nosec') ||
      prevLine.includes('opensec-ignore') ||
      prevLine.includes('nosec')
    ) {
      continue
    }

    // Skip pure comment lines — no real code to flag.
    if (isLineInComment(lineText)) continue

    for (const pattern of lineBased) {
      if (testFile && pattern.skipInTestFiles !== false) continue
      const m = pattern.regex.exec(lineText)
      if (m) {
        findings.push(buildFinding(relFile, i + 1, (m.index ?? 0) + 1, pattern, lineText))
      }
    }
  }

  for (const pattern of multilinePats) {
    if (testFile && pattern.skipInTestFiles !== false) continue
    const m = pattern.regex.exec(content)
    if (m) {
      const before = content.slice(0, m.index)
      const lineNo = before.split(/\r?\n/).length
      const matchLine = lines[lineNo - 1] ?? m[0]
      if (
        !matchLine.includes('opensec-ignore') &&
        !matchLine.includes('nosec') &&
        !isLineInComment(matchLine)
      ) {
        findings.push(buildFinding(relFile, lineNo, 1, pattern, matchLine))
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
    confidence: pattern.confidence,
  }
}

export async function runScanner(opts: ScannerOptions): Promise<ScanResult> {
  const start = Date.now()
  const { targetPath } = opts
  const files = await collectFiles(targetPath)
  const findings: Finding[] = []

  let scanned = 0
  for (const absFile of files) {
    const relFile = path.relative(targetPath, absFile).replace(/\\/g, '/')

    // Hard-exclude certain paths (self-scan noise, docs, evals).
    if (isSkippedPath(relFile)) {
      scanned++
      opts.onProgress?.(scanned, files.length)
      continue
    }

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

    const fileName = path.basename(absFile)
    const testFile = isTestFile(relFile)
    for (const finding of scanContent(relFile, fileName, content, testFile)) {
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

export async function persistScan(targetPath: string, result: ScanResult): Promise<string> {
  const dir = path.join(targetPath, '.opensec')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'last-scan.json')
  await fs.writeFile(file, JSON.stringify(result, null, 2), 'utf8')
  return file
}

export async function loadLastScan(targetPath: string): Promise<ScanResult | null> {
  const file = path.join(targetPath, '.opensec', 'last-scan.json')
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as ScanResult
  } catch {
    return null
  }
}
