/**
 * cmdr eval harness — multi-tier evaluation runner.
 *
 * Usage:
 *   npx tsx evals/run-evals.ts                          # run all tasks
 *   npx tsx evals/run-evals.ts --model qwen3-coder      # specific model
 *   npx tsx evals/run-evals.ts --filter "create|hello"   # filter by pattern
 *   npx tsx evals/run-evals.ts --tier basic,intermediate  # filter by tier
 *   npx tsx evals/run-evals.ts --json                    # save JSON report
 *   npx tsx evals/run-evals.ts --pdf                     # generate PDF report
 */

import type { EvalTask, TaskResult, EvalRun, Tier } from './lib/types.js'
import { runBatch } from './lib/runner.js'
import { computeSummary } from './lib/scorer.js'
import { printTerminalReport, saveJsonReport, savePdfReport } from './lib/reporter.js'
import { randomUUID } from 'crypto'

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
let model = 'qwen2.5-coder:14b'
let filter = ''
let ollamaUrl = 'http://localhost:11434'
let tierFilter: Tier[] | undefined
let saveJson = false
let savePdf = false
let timeout: number | undefined

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--model': case '-m': model = args[++i]; break
    case '--filter': case '-f': filter = args[++i]; break
    case '--ollama-url': case '-u': ollamaUrl = args[++i]; break
    case '--tier': case '-t':
      tierFilter = args[++i].split(',').map(s => s.trim()) as Tier[]
      break
    case '--json': saveJson = true; break
    case '--pdf': savePdf = true; break
    case '--timeout': timeout = parseInt(args[++i]); break
    case '--help': case '-h':
      console.log(`
  cmdr eval harness

  Options:
    -m, --model <name>       Model to use (default: qwen2.5-coder:14b)
    -f, --filter <pattern>   Regex to filter task IDs
    -t, --tier <list>        Comma-separated tier filter (basic,intermediate,advanced,hard,expert,extreme)
    -u, --ollama-url <url>   Ollama API URL (default: http://localhost:11434)
        --json               Save JSON report to evals/reports/
        --pdf                Generate PDF report (requires python3 + reportlab)
        --timeout <ms>       Override per-task timeout
    -h, --help               Show this help message
`)
      process.exit(0)
  }
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('')
  console.log(`  ${c.bold('cmdr eval harness')}`)
  console.log(`  Model  : ${c.cyan(model)}`)
  console.log(`  Ollama : ${ollamaUrl}`)
  if (filter) console.log(`  Filter : ${filter}`)
  if (tierFilter) console.log(`  Tiers  : ${tierFilter.join(', ')}`)
  console.log('')

  const startedAt = new Date().toISOString()

  const { tasks, results } = await runBatch({
    model,
    ollamaUrl,
    filter: filter || undefined,
    tierFilter,
    timeout,
    onTaskStart(task: EvalTask, i: number, total: number) {
      const num = `[${i + 1}/${total}]`
      process.stdout.write(`  ${c.dim(num)} ${task.id.padEnd(30)} `)
    },
    onTaskComplete(task: EvalTask, result: TaskResult, _i: number, _total: number) {
      const status = result.passed
        ? c.green('PASS')
        : c.red('FAIL')
      const time = c.dim(`${result.duration.toFixed(1)}s`)
      const err = result.error ? c.dim(` — ${result.error.slice(0, 60)}`) : ''
      console.log(`${status} ${time}${err}`)
    },
  })

  if (tasks.length === 0) {
    console.log('  No tasks found. Add tasks to evals/tasks/.')
    return
  }

  // Build run report
  const summary = computeSummary(tasks, results)
  const run: EvalRun = {
    id: randomUUID(),
    model,
    ollamaUrl,
    startedAt,
    completedAt: new Date().toISOString(),
    tasks: results,
    summary,
  }

  // Terminal output
  printTerminalReport(run)

  // Optional: save JSON report
  if (saveJson) {
    const path = saveJsonReport(run)
    console.log(`  ${c.dim(`JSON report: ${path}`)}`)
  }

  // Optional: generate PDF report
  if (savePdf) {
    const path = savePdfReport(run)
    if (path) {
      console.log(`  ${c.dim(`PDF report: ${path}`)}`)
    }
  }

  // Exit with non-zero if grade is below C
  const exitCode = summary.grade === 'S' || summary.grade === 'A' || summary.grade === 'B' || summary.grade === 'C'
    ? 0
    : 1
  process.exit(exitCode)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
