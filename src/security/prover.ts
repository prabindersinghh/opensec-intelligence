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

// ---------------------------------------------------------------------------
// Provable vulnerability classes
// ---------------------------------------------------------------------------

export const PROVABLE_VULN_CLASSES = new Set([
  'Weak Hash Algorithm (MD5)',
  'Weak Hash Algorithm (SHA-1)',
  'Hardcoded Password Assignment',
  'JWT Secret Hardcoded',
  'Database URL with Credentials',
  'eval() Usage',
  'Insecure Random for Secret',
  'AWS Access Key',
  'Private Key Block',
  'GitHub Token',
  'Stripe Secret Key',
  'Command Injection',
  'SQL Injection — String Concat',
  'SQL Injection — Template Literal',
  'Path Traversal',
  'CORS Wildcard',
  'Hardcoded API Key',
])

export const SKIP_REASONS: Record<string, string> = {
  'K8s: Privileged Container':      'requires live cluster — use kubesec for verification',
  'K8s: Host Network':              'requires live cluster — flag for manual review',
  'K8s: Secret in Plain Env':       'requires live cluster — flag for manual review',
  'Docker: Running as Root':        'requires container runtime — flag for manual review',
  'Docker: Latest Tag':             'image tag policy — flag for manual review',
  'Docker: Hardcoded Secret in ENV':'requires container runtime — flag for manual review',
  'Terraform: Public S3 Bucket':    'requires AWS credentials — flag for manual review',
  'Terraform: Open Security Group': 'requires AWS credentials — flag for manual review',
  'Prototype Pollution':            'requires runtime context — complex to auto-prove safely',
  'Open Redirect':                  'requires live HTTP server — add to integration tests',
  'Debug Mode Enabled':             'configuration check — flag for manual review',
  'HTTP Endpoint (not HTTPS)':      'network policy check — flag for manual review',
}

// ---------------------------------------------------------------------------
// LLM exploit generator
// ---------------------------------------------------------------------------

interface ExploitGenResponse {
  lang: ExploitLang
  code: string
}

function buildExploitPrompt(finding: Finding, fileContent: string): string {
  const truncated = fileContent.length > 3000
  const content = fileContent.slice(0, 3000) + (truncated ? '\n[...truncated]' : '')

  return `You are a security researcher writing a minimal proof-of-concept exploit.

VULNERABILITY:
- Type: ${finding.ruleName}
- File: ${finding.file}
- Line: ${finding.line}
- Severity: ${finding.severity}
- Snippet: ${finding.snippet}

FULL FILE CONTENT:
${content}

TASK: Write the SMALLEST possible self-contained script that:
1. Calls the vulnerable function/endpoint with a malicious input
2. Prints "EXPLOITED: <what happened>" if the vuln exists
3. Prints "NOT_EXPLOITED: <reason>" if it cannot trigger the vuln
4. Exits normally

CONSTRAINTS:
- Maximum 30 lines of code
- Must be runnable with: node exploit.js  OR  python3 exploit.py
- Use relative require/import paths from the project root (e.g. require('./demo/prove-demo/auth'))
- Use ONLY Node.js built-ins OR Python stdlib — NO external packages

VULN-SPECIFIC GUIDANCE:
- Weak Hash Algorithm (MD5): hash 'password', check result === '5f4dcc3b5aa765d61d8327deb882cf99'
- Hardcoded Password Assignment: read file source and check literal password value is present
- JWT Secret Hardcoded: read exported JWT_SECRET, confirm it is not from env
- Database URL with Credentials: read exported connection string, check it contains '@'
- eval() Usage: call the function with 'EXPLOITED_TOKEN', check output contains it
- Insecure Random for Secret: call the function, verify Math.random was invoked (not crypto.randomBytes) by checking output is predictable/seeded; print EXPLOITED: math.random used for secret
- SQL Injection — String Concat / Template Literal: call with "' OR '1'='1", check rows.length > 0
- Command Injection: call with "; echo EXPLOITED_CMD", check output contains EXPLOITED_CMD
- CORS Wildcard: pass a mock res object with getHeader/setHeader, call the function, check res.getHeader('Access-Control-Allow-Origin') === '*'
- Hardcoded API Key: read exported api key value, confirm it is a string literal

OUTPUT FORMAT — respond ONLY with this JSON (no explanation, no markdown):
{
  "lang": "javascript",
  "code": "<full exploit script with \\n newlines>"
}`
}

// ---------------------------------------------------------------------------
// Main prove() entry point
// ---------------------------------------------------------------------------

export async function prove(
  finding: Finding,
  projectRoot: string,
  llm: LlmConfig,
  onProgress: (msg: string) => void,
  dryRun = false,
): Promise<ProofResult> {
  const empty: ExploitResult = { success: false, input: '', output: '', exitCode: -1, duration: 0 }

  if (!PROVABLE_VULN_CLASSES.has(finding.ruleName)) {
    return {
      findingId: finding.id,
      exploitCode: '',
      exploitLang: 'javascript',
      beforePatch: empty,
      afterPatch: empty,
      verified: false,
      skipped: true,
      skipReason: SKIP_REASONS[finding.ruleName] ?? 'auto-proof not supported for this vuln class',
    }
  }

  let fileContent = ''
  try {
    fileContent = readFileSync(path.join(projectRoot, finding.file), 'utf8')
  } catch {
    return {
      findingId: finding.id,
      exploitCode: '',
      exploitLang: 'javascript',
      beforePatch: empty,
      afterPatch: empty,
      verified: false,
      skipped: true,
      skipReason: `cannot read ${finding.file}`,
    }
  }

  onProgress(`Generating exploit for ${finding.ruleName}…`)
  const raw = await generateJson<ExploitGenResponse>(llm, buildExploitPrompt(finding, fileContent), 2)

  if (!raw?.code) {
    return {
      findingId: finding.id,
      exploitCode: '',
      exploitLang: 'javascript',
      beforePatch: empty,
      afterPatch: empty,
      verified: false,
      skipped: true,
      skipReason: 'LLM exploit generation failed or timed out',
    }
  }

  const exploitCode = raw.code
  const exploitLang: ExploitLang =
    raw.lang === 'python' || raw.lang === 'bash' ? raw.lang : 'javascript'

  onProgress(`Running exploit (before patch)…`)
  const beforePatch = await runExploit(exploitCode, exploitLang, projectRoot)

  if (dryRun) {
    return {
      findingId: finding.id,
      exploitCode,
      exploitLang,
      beforePatch,
      afterPatch: empty,
      verified: false,
      skipped: true,
      skipReason: 'dry run',
    }
  }

  onProgress(`Applying patch…`)
  const fixed = await applyFixSilently(finding, projectRoot, llm)
  if (!fixed) {
    return {
      findingId: finding.id,
      exploitCode,
      exploitLang,
      beforePatch,
      afterPatch: empty,
      verified: false,
      skipped: true,
      skipReason: 'LLM could not synthesize a patch',
    }
  }

  onProgress(`Re-running exploit (after patch)…`)
  const afterPatch = await runExploit(exploitCode, exploitLang, projectRoot)

  // exploit fired before patch and failed after = vuln is closed
  const verified = beforePatch.success && !afterPatch.success

  return {
    findingId: finding.id,
    exploitCode,
    exploitLang,
    beforePatch,
    afterPatch,
    verified,
    skipped: false,
  }
}
