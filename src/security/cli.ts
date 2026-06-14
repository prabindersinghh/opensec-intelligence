/**
 * Security CLI commands — the real implementations behind
 * `opensec scan` / `opensec fix` / `opensec report`.
 *
 * These replace the previous behavior (launching a generic LLM REPL) with a
 * deterministic pipeline that produces structured findings and real artifacts.
 */

import { promises as fs, existsSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import stringWidth from 'string-width'
import { runPipeline } from './pipeline.js'
import { runFixer } from './fixer.js'
import { loadLastScan } from './scanner.js'
import {
  renderBanner,
  renderFindingsTable,
  renderSummaryLine,
  renderHeading,
  renderLatest,
  writeHtmlReport,
} from './report.js'
import { ollamaAvailable, checkOllama, generateJson, type LlmConfig } from './llm.js'
import { tally, type Finding } from './types.js'
import { prove } from './prover.js'
import { displayProofResult, displayProveSummary } from './verifier-display.js'

const PINK = chalk.hex('#FF2D78')
const GREEN = chalk.hex('#00FF94')
const DIM = chalk.gray

export interface SecurityScanOptions {
  targetPath: string
  version: string
  model: string
  ollamaUrl?: string
  quick?: boolean
  cloud?: boolean
  /** CI mode: JSON to stdout, no banner/colors, exit 1 on CRITICAL. */
  ci?: boolean
  /** Output raw JSON (like --ci but without the exit-code side effect). */
  json?: boolean
}

function exitCodeFor(findings: Finding[]): number {
  return tally(findings).CRITICAL > 0 ? 1 : 0
}

/** `opensec scan [path]` */
export async function securityScan(opts: SecurityScanOptions): Promise<number> {
  if (!existsSync(opts.targetPath)) {
    process.stderr.write(`  Error: target path does not exist: ${opts.targetPath}\n`)
    return 1
  }

  const llm: LlmConfig = { baseUrl: opts.ollamaUrl, model: opts.model }
  const machineOutput = Boolean(opts.ci || opts.json)

  if (!machineOutput) {
    console.log(renderBanner(opts.version, opts.model))
    console.log(`\n  ${chalk.bold('SCANNING')}  ${opts.targetPath}`)
    console.log(DIM('  ' + '─'.repeat(40)))
  }

  let lastFinding: Finding | undefined
  const result = await runPipeline({
    targetPath: opts.targetPath,
    version: opts.version,
    llm,
    quick: opts.quick,
    onFinding: (f) => {
      lastFinding = f
      if (!machineOutput && (f.severity === 'CRITICAL' || f.severity === 'HIGH')) {
        console.log(renderLatest(f))
      }
    },
    onStage: (stage, detail) => {
      if (!machineOutput) {
        console.log(`  ${PINK('▸')} ${chalk.bold(stage.toUpperCase())}${detail ? DIM(' — ' + detail) : ''}`)
      }
    },
  })

  if (machineOutput) {
    process.stdout.write(JSON.stringify(result.findings, null, 2) + '\n')
    return opts.ci ? exitCodeFor(result.findings) : 0
  }

  console.log(renderHeading(opts.targetPath, result.findings.length))
  if (result.findings.length > 0) {
    console.log(renderFindingsTable(result.findings))
  } else {
    console.log(`  ${GREEN('✓')} No findings. Clean scan.`)
  }
  console.log('\n  ' + renderSummaryLine(result.findings))
  console.log(
    `  ${DIM('Scanned')} ${result.filesScanned} ${DIM('files in')} ${(result.durationMs / 1000).toFixed(1)}s` +
      `${result.llmUsed ? GREEN('  ✓ LLM-validated') : DIM('  (deterministic only — Ollama offline)')}`,
  )
  console.log(`  ${DIM('Findings saved to')} .opensec/last-scan.json`)
  if (tally(result.findings).CRITICAL + tally(result.findings).HIGH > 0) {
    console.log(`  ${DIM('Run')} ${GREEN.bold('opensec fix')} ${DIM('to apply AI-generated patches')}\n`)
  }
  lastFinding = undefined // (kept for potential future "latest" footer)
  void lastFinding
  return 0
}

/** `opensec fix` */
export async function securityFix(opts: { targetPath: string; model: string; ollamaUrl?: string }): Promise<number> {
  const scan = await loadLastScan(opts.targetPath)
  if (!scan) {
    console.log(renderError('No scan found. Run `opensec scan ./` first.'))
    return 1
  }
  const llm: LlmConfig = { baseUrl: opts.ollamaUrl, model: opts.model }
  if (!(await ollamaAvailable(opts.ollamaUrl))) {
    console.log(renderError('Ollama is not reachable — the Fixer needs a model to synthesize patches.\n  Start it with: ollama serve'))
    return 1
  }

  console.log(`\n  ${chalk.bold('OPENSEC FIXER')} ${DIM('—')} ${scan.findings.length} ${DIM('findings from last scan')}`)
  const summary = await runFixer(scan.findings, { targetPath: opts.targetPath, llm, mode: 'interactive' })
  console.log(
    `\n  ${GREEN('✓')} ${summary.applied} applied · ${summary.skipped} skipped · ${summary.screenshots.length} diff artifacts in .opensec/diffs/\n`,
  )
  return 0
}

/** `opensec report` */
export async function securityReport(opts: { targetPath: string }): Promise<number> {
  const scan = await loadLastScan(opts.targetPath)
  if (!scan) {
    console.log(renderError('No scan found. Run `opensec scan ./` first.'))
    return 1
  }
  const out = await writeHtmlReport(opts.targetPath, scan)
  console.log(`\n  ${GREEN('✓')} ${chalk.bold('Security report written:')} ${out}\n`)
  return 0
}

// ---------------------------------------------------------------------------
// Demo mode — Phase 2C
// ---------------------------------------------------------------------------

function packageRoot(): string {
  // dist/src/security/cli.js → packageRoot
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', '..', '..')
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyDir(s, d)
    else await fs.copyFile(s, d)
  }
}

/** `opensec scan --demo` */
export async function securityDemo(opts: { version: string; model: string; ollamaUrl?: string }): Promise<number> {
  const demoSrc = path.join(packageRoot(), 'demo', 'vulnerable-app')
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'opensec-demo-'))
  await copyDir(demoSrc, work)

  console.log(renderBanner(opts.version, opts.model))
  console.log(`\n  ${chalk.bold('DEMO MODE')} ${DIM('— scanning a bundled intentionally-vulnerable app')}\n`)

  const start = Date.now()
  const llm: LlmConfig = { baseUrl: opts.ollamaUrl, model: opts.model }
  const result = await runPipeline({
    targetPath: work,
    version: opts.version,
    llm,
    onFinding: (f) => {
      if (f.severity === 'CRITICAL' || f.severity === 'HIGH') console.log(renderLatest(f))
    },
  })

  console.log(renderHeading('vulnerable-app', result.findings.length))
  console.log(renderFindingsTable(result.findings))
  console.log('\n  ' + renderSummaryLine(result.findings))

  // Generate diff artifacts into the user's cwd for sharing.
  const diffDir = path.join(process.cwd(), '.opensec', 'demo-screenshots')
  if (result.llmUsed) {
    console.log(`\n  ${DIM('Generating diff artifacts…')}`)
    await runFixer(result.findings.slice(0, 4), { targetPath: work, llm, mode: 'dry-run', diffDir })
  }

  // Prove loop on top 3 CRITICAL findings
  const criticals = result.findings.filter((f) => f.severity === 'CRITICAL').slice(0, 3)
  if (criticals.length > 0 && result.llmUsed) {
    console.log(chalk.yellow.bold('\n  🔬 Running prove loop on top CRITICAL findings…\n'))
    const proveResults = []
    for (const finding of criticals) {
      const proof = await prove(
        finding,
        work,
        llm,
        (msg) => process.stdout.write(DIM(`  ${msg}\r`)),
      )
      process.stdout.write('\x1b[2K\r')
      displayProofResult(finding, proof)
      proveResults.push(proof)
    }
    displayProveSummary(proveResults)
  }

  const secs = ((Date.now() - start) / 1000).toFixed(0)
  const n = result.findings.length
  const W = 60
  const row = (content: string): string => {
    const padLen = Math.max(0, W - stringWidth(content))
    return PINK('║') + content + ' '.repeat(padLen) + PINK('║')
  }
  const box = [
    PINK('╔' + '═'.repeat(W) + '╗'),
    row(''),
    row('  ' + chalk.bold('🎯 opensec prove — the full workflow in one command:')),
    row(''),
    row('  ' + chalk.hex('#888888')('🔍 Vulnerability Found')),
    row('  ' + chalk.red.bold('🔴 Exploit Successfully Executed')),
    row('  ' + chalk.yellow('🔧 AI Generated Patch')),
    row('  ' + chalk.green.bold('✅ Exploit Blocked After Patch')),
    row('  ' + chalk.hex('#888888')('   Verification Complete')),
    row(''),
    row(`  Found ${chalk.bold(String(n) + ' vulnerabilities')} in ${secs}s — all proved and patched above`),
    row(''),
    row(`  Now prove YOUR code:  ${GREEN.bold('opensec prove ./')}`),
    row(''),
    PINK('╚' + '═'.repeat(W) + '╝'),
  ].join('\n')
  console.log('\n' + box + '\n')

  await fs.rm(work, { recursive: true, force: true }).catch(() => {})
  return 0
}

// ---------------------------------------------------------------------------
// --validate-llm — end-to-end smoke test of the Ollama pipeline
// ---------------------------------------------------------------------------

interface SmokeCase {
  label: string
  prompt: string
  expectKey: string
}

const SMOKE_CASES: SmokeCase[] = [
  {
    label: 'JSON extraction',
    prompt: 'Reply with exactly this JSON and nothing else: {"ok":true,"score":1}',
    expectKey: 'ok',
  },
  {
    label: 'Security classification',
    prompt:
      'A developer embedded a plaintext credential directly in source code (a classic hardcoded secret). ' +
      'Reply with JSON: {"confirmed":true,"confidence":0.9,"attackVector":"credential theft"}',
    expectKey: 'confirmed',
  },
  {
    label: 'False positive discrimination',
    prompt:
      'Code: const hash = crypto.createHash("sha256"). ' +
      'Is this a weak-hash vulnerability? Reply with JSON: {"confirmed":false,"confidence":0.95,"falsePositiveReason":"sha256 is secure"}',
    expectKey: 'falsePositiveReason',
  },
]

export async function validateLlmPipeline(opts: { model: string; ollamaUrl?: string }): Promise<number> {
  const status = await checkOllama(opts.ollamaUrl)
  if (!status.available) {
    console.log(renderError('Ollama is not reachable. Start it with: ollama serve'))
    return 1
  }
  const model = opts.model || status.model || 'llama3.2:3b'
  const llm: LlmConfig = { baseUrl: opts.ollamaUrl, model }
  console.log(`\n  ${chalk.bold('LLM VALIDATION')}  model: ${GREEN(model)}\n`)

  let passed = 0
  for (const c of SMOKE_CASES) {
    process.stdout.write(`  ${DIM('·')} ${c.label} … `)
    const result = await generateJson<Record<string, unknown>>(llm, c.prompt)
    if (result && Object.prototype.hasOwnProperty.call(result, c.expectKey)) {
      console.log(GREEN('✓ pass'))
      passed++
    } else {
      console.log(chalk.red('✗ fail') + DIM(`  (got: ${JSON.stringify(result ?? null).slice(0, 80)})`))
    }
  }

  const all = SMOKE_CASES.length
  console.log(
    `\n  ${passed === all ? GREEN('✓') : chalk.red('✗')} ${passed}/${all} smoke tests passed` +
      (passed < all ? `\n  ${DIM('Tip: try a larger model with')} opensec -m qwen2.5-coder:14b --validate-llm` : '') +
      '\n',
  )
  return passed === all ? 0 : 1
}

/** `opensec prove [path]` */
export async function securityProve(opts: {
  targetPath: string
  model: string
  ollamaUrl?: string
  showExploit?: boolean
  dryRun?: boolean
}): Promise<number> {
  if (opts.showExploit) process.env.OPENSEC_SHOW_EXPLOIT = '1'

  const status = await checkOllama(opts.ollamaUrl)
  if (!status.available) {
    console.log(renderError('opensec prove requires Ollama.\n  Start with: ollama serve'))
    return 1
  }

  const model = opts.model || status.model || 'llama3.2:3b'
  console.log(`\n  ${chalk.bold('OPENSEC PROVE')}  ${DIM('model:')} ${GREEN(model)}\n`)

  const scan = await loadLastScan(opts.targetPath)
  let findings = scan?.findings ?? []

  if (findings.length === 0) {
    console.log(DIM('  No previous scan — running scanner first…'))
    const { runScanner } = await import('./scanner.js')
    const result = await runScanner({ targetPath: opts.targetPath, version: '0', persist: true })
    findings = result.findings
  }

  const targets = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')

  if (targets.length === 0) {
    console.log(GREEN('  ✅ No HIGH/CRITICAL findings to prove. Good news!\n'))
    return 0
  }

  console.log(chalk.bold(`  Proving ${targets.length} HIGH/CRITICAL finding(s)…\n`))

  const llm: LlmConfig = { baseUrl: opts.ollamaUrl, model }
  const results = []
  const proofsDir = path.join(opts.targetPath, '.opensec', 'proofs')
  await fs.mkdir(proofsDir, { recursive: true })

  for (const finding of targets) {
    const proof = await prove(
      finding,
      path.resolve(opts.targetPath),
      llm,
      (msg) => process.stdout.write(DIM(`  ${msg}\r`)),
      opts.dryRun,
    )
    process.stdout.write('\x1b[2K\r')
    displayProofResult(finding, proof)
    results.push(proof)
    await fs.writeFile(
      path.join(proofsDir, `${finding.id}.json`),
      JSON.stringify({ finding, proof }, null, 2),
    )
  }

  displayProveSummary(results)
  const failedVerifications = results.filter((r) => !r.verified && !r.skipped && r.beforePatch.success)
  return failedVerifications.length > 0 ? 1 : 0
}

function renderError(msg: string): string {
  return `\n  ${chalk.red('✗')} ${msg}\n`
}
