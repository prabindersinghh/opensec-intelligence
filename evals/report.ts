/**
 * Eval report viewer — reads JSON reports and prints a summary.
 *
 * Usage: npx tsx evals/report.ts [report-file.json]
 *        npx tsx evals/report.ts --latest
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { EvalRun } from './lib/types.js'
import { printTerminalReport } from './lib/reporter.js'

const REPORTS_DIR = resolve(import.meta.dirname ?? '.', 'reports')
const RESULTS_DIR = resolve(import.meta.dirname ?? '.', 'results')

function findLatestReport(): string | null {
  // Check new reports/ directory first
  if (existsSync(REPORTS_DIR)) {
    const files = readdirSync(REPORTS_DIR)
      .filter(f => f.startsWith('report-') && f.endsWith('.json'))
      .sort()
    if (files.length > 0) return join(REPORTS_DIR, files[files.length - 1])
  }

  // Fall back to old results/ directory
  if (existsSync(RESULTS_DIR)) {
    const files = readdirSync(RESULTS_DIR)
      .filter(f => f.startsWith('eval-') && f.endsWith('.json'))
      .sort()
    if (files.length > 0) return join(RESULTS_DIR, files[files.length - 1])
  }

  return null
}

// --- Main ---
const arg = process.argv[2]
let reportPath: string | null = null

if (arg && arg !== '--latest') {
  reportPath = resolve(arg)
} else {
  reportPath = findLatestReport()
}

if (!reportPath || !existsSync(reportPath)) {
  console.log('  No eval reports found. Run: npx tsx evals/run-evals.ts')
  process.exit(0)
}

const data = JSON.parse(readFileSync(reportPath, 'utf-8'))

// Detect report format
if (data.summary && data.tasks && data.model) {
  // New EvalRun format
  printTerminalReport(data as EvalRun)
} else {
  // Legacy format — simple table
  console.log(`\n  cmdr eval report (legacy format)`)
  console.log(`  Model: ${data.model}`)
  console.log(`  Date:  ${data.timestamp}`)
  console.log(`  ${data.summary?.passed ?? '?'}/${data.summary?.total ?? '?'} passed\n`)

  if (data.results) {
    for (const r of data.results) {
      const status = r.passed ? '✓' : '✗'
      console.log(`  ${status} ${r.name ?? r.taskId}`)
    }
  }
  console.log('')
}
