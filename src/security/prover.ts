/**
 * Prover — exploit generation, sandboxed execution, and patch verification.
 *
 * Flow: generate exploit → run before patch → apply patch → run after patch → verify.
 * Safety: validateExploit() blocks network access and filesystem writes in exploit code.
 */

import { spawnSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { Finding, ExploitResult, ExploitLang, ProofResult } from './types.js'
import { type LlmConfig, generateJson } from './llm.js'
import { applyFixSilently } from './fixer.js'

// ---------------------------------------------------------------------------
// Safety validation — runs before every exploit execution
// ---------------------------------------------------------------------------

const BANNED_NETWORK = [
  /require\s*\(\s*['"]https?['"]\s*\)/,
  /require\s*\(\s*['"]net['"]\s*\)/,
  /\bfetch\s*\(/,
  /\baxios\b/,
  /\.connect\s*\(/,
  /import\s+.*\bhttp\b/,
]

const BANNED_WRITES = [
  /fs\.unlink/,
  /fs\.rmdir/,
  /fs\.writeFileSync\s*\(\s*['"`](?!\/tmp|os\.tmpdir)/,
  /fs\.writeFile\s*\([^,]+,(?![^)]*tmpdir)/,
]

export function validateExploit(code: string): { safe: boolean; reason?: string } {
  for (const pat of BANNED_NETWORK) {
    if (pat.test(code)) {
      return { safe: false, reason: 'exploit attempts network access — blocked for safety' }
    }
  }
  for (const pat of BANNED_WRITES) {
    if (pat.test(code)) {
      return { safe: false, reason: 'exploit attempts filesystem writes — blocked for safety' }
    }
  }
  return { safe: true }
}

// ---------------------------------------------------------------------------
// Sandboxed execution
// ---------------------------------------------------------------------------

const MAX_EXEC_MS = 10_000
const MAX_OUTPUT_BYTES = 100 * 1024

export async function runExploit(
  code: string,
  lang: ExploitLang,
  projectRoot: string,
): Promise<ExploitResult> {
  const check = validateExploit(code)
  if (!check.safe) {
    return {
      success: false,
      input: '',
      output: '',
      exitCode: -1,
      duration: 0,
      error: check.reason,
    }
  }

  const ext = lang === 'javascript' ? 'js' : lang === 'python' ? 'py' : 'sh'
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'opensec-exploit-'))
  const exploitFile = path.join(tmpDir, `exploit.${ext}`)
  writeFileSync(exploitFile, code, 'utf8')

  const cmd = lang === 'javascript' ? 'node' : lang === 'python' ? 'python3' : 'bash'
  const start = Date.now()

  try {
    const result = spawnSync(cmd, [exploitFile], {
      cwd: projectRoot,
      timeout: MAX_EXEC_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        DATABASE_URL: 'sqlite::memory:',
        NODE_ENV: 'test',
      },
    })

    const stdout = (result.stdout?.toString() ?? '').slice(0, 500)
    const stderr = result.stderr?.toString() ?? ''
    const output = stdout + (stderr ? `\nSTDERR: ${stderr.slice(0, 200)}` : '')

    return {
      success: stdout.includes('EXPLOITED:'),
      input: extractInput(code),
      output: output.trim(),
      exitCode: result.status ?? 0,
      duration: Date.now() - start,
    }
  } catch (err: unknown) {
    return {
      success: false,
      input: '',
      output: '',
      exitCode: -1,
      duration: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true }) } catch { /* ignore */ }
  }
}

function extractInput(code: string): string {
  const m = code.match(/['"]([^'"]{4,80})['"]/)?.[1] ?? ''
  return m.length > 60 ? m.slice(0, 60) + '…' : m
}

// Task 4 will add: PROVABLE_VULN_CLASSES, SKIP_REASONS, buildExploitPrompt(), prove()
// Placeholder exports to satisfy TypeScript until Task 4 is complete:
export const PROVABLE_VULN_CLASSES = new Set<string>()
export const SKIP_REASONS: Record<string, string> = {}
export async function prove(
  _finding: Finding,
  _projectRoot: string,
  _llm: LlmConfig,
  _onProgress: (msg: string) => void,
  _dryRun?: boolean,
): Promise<ProofResult> {
  throw new Error('prove() not yet implemented — will be added in Task 4')
}
