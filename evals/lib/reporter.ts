/**
 * Reporter — terminal + JSON + PDF report generation.
 */

import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { execFileSync } from 'child_process'
import { join, resolve } from 'path'
import type { EvalRun, EvalSummary, TaskResult } from './types.js'

const REPORTS_DIR = resolve(import.meta.dirname ?? '.', '..', 'reports')

// ---------------------------------------------------------------------------
// ANSI helpers (lightweight, no chalk dep for eval scripts)
// ---------------------------------------------------------------------------

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  purple: (s: string) => `\x1b[35m${s}\x1b[0m`,
}

// ---------------------------------------------------------------------------
// Terminal reporter
// ---------------------------------------------------------------------------

export function printTerminalReport(run: EvalRun): void {
  const s = run.summary

  console.log('')
  console.log(`  ${c.bold(c.purple('╔═══════════════════════════════════════════════╗'))}`)
  console.log(`  ${c.bold(c.purple('║         cmdr eval report                     ║'))}`)
  console.log(`  ${c.bold(c.purple('╚═══════════════════════════════════════════════╝'))}`)
  console.log(`  Model  : ${c.cyan(run.model)}`)
  console.log(`  Date   : ${run.completedAt}`)
  console.log('')

  // Overall
  const gradeColor = s.grade === 'S' || s.grade === 'A' ? c.green
    : s.grade === 'B' || s.grade === 'C' ? c.yellow
    : c.red
  console.log(`  ${c.bold('Overall')}: ${gradeColor(s.grade)} — ${s.score}/${s.maxScore} (${s.percentage}%)`)
  console.log(`  Passed : ${c.green(String(s.passed))} / ${s.totalTasks}`)
  console.log(`  Time   : ${Math.round(s.totalDuration)}s`)
  console.log(`  Tokens : ${s.totalTokensIn.toLocaleString()} in, ${s.totalTokensOut.toLocaleString()} out`)
  console.log('')

  // By tier
  console.log(`  ${c.bold('─── By Tier ───')}`)
  const tierOrder = ['basic', 'intermediate', 'advanced', 'hard', 'expert', 'extreme']
  for (const tier of tierOrder) {
    const t = s.byTier[tier]
    if (!t) continue
    const bar = makeBar(t.passed, t.total)
    console.log(`  ${tier.padEnd(14)} ${bar} ${t.passed}/${t.total} (${t.score}/${t.maxScore} pts)`)
  }
  console.log('')

  // By category
  console.log(`  ${c.bold('─── By Category ───')}`)
  for (const [cat, stats] of Object.entries(s.byCategory).sort()) {
    const bar = makeBar(stats.passed, stats.total)
    console.log(`  ${cat.padEnd(14)} ${bar} ${stats.passed}/${stats.total}`)
  }
  console.log('')

  // Failed tasks
  const failed = run.tasks.filter(t => !t.passed)
  if (failed.length > 0) {
    console.log(`  ${c.bold(c.red('─── Failed Tasks ───'))}`)
    for (const t of failed) {
      console.log(`  ${c.red('✗')} ${t.taskId.padEnd(28)} ${c.dim(t.error?.slice(0, 60) ?? 'unknown')}`)
    }
    console.log('')
  }
}

function makeBar(passed: number, total: number): string {
  const width = 20
  const filled = total > 0 ? Math.round((passed / total) * width) : 0
  return c.green('█'.repeat(filled)) + c.dim('░'.repeat(width - filled))
}

// ---------------------------------------------------------------------------
// JSON reporter
// ---------------------------------------------------------------------------

export function saveJsonReport(run: EvalRun): string {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const datePart = run.startedAt.slice(0, 10)
  const modelPart = run.model.replace(/[:/]/g, '-')
  const filename = `report-${datePart}-${modelPart}.json`
  const filepath = join(REPORTS_DIR, filename)
  writeFileSync(filepath, JSON.stringify(run, null, 2))
  return filepath
}

// ---------------------------------------------------------------------------
// PDF reporter
// ---------------------------------------------------------------------------

const PDF_SCRIPT = resolve(import.meta.dirname ?? '.', '..', 'lib', 'gen_pdf_report.py')

export function savePdfReport(run: EvalRun): string | null {
  mkdirSync(REPORTS_DIR, { recursive: true })

  if (!existsSync(PDF_SCRIPT)) {
    console.log(`  ${c.dim('PDF script not found, skipping PDF generation.')}`)
    return null
  }

  const datePart = run.startedAt.slice(0, 10)
  const modelPart = run.model.replace(/[:/]/g, '-')
  const jsonPath = join(REPORTS_DIR, `.tmp-${Date.now()}.json`)
  const pdfPath = join(REPORTS_DIR, `report-${datePart}-${modelPart}.pdf`)

  writeFileSync(jsonPath, JSON.stringify(run, null, 2))

  try {
    execFileSync('python3', [PDF_SCRIPT, jsonPath, pdfPath], {
      timeout: 30_000,
      stdio: 'pipe',
    })
    return pdfPath
  } catch (err: any) {
    console.log(`  ${c.dim(`PDF generation failed: ${err.message?.slice(0, 100)}`)}`)
    return null
  } finally {
    try { unlinkSync(jsonPath) } catch {}
  }
}
