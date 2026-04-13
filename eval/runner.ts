#!/usr/bin/env npx tsx
/**
 * Benchmark runner — evaluates code-generation quality against HumanEval & MBPP.
 *
 * Calls the Ollama API directly (temperature=0, single shot, no tools)
 * to isolate pure code-generation ability.
 *
 * Usage:
 *   npx tsx eval/runner.ts --benchmark humaneval --model qwen3-coder:latest
 *   npx tsx eval/runner.ts --benchmark mbpp --model qwen3-coder:latest --limit 10
 */

import { execFileSync } from 'child_process'
import { writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import {
  loadHumanEvalDataset,
  loadMBPPDataset,
  extractPythonCode,
  extractFunctionName,
  validateSyntax,
  buildHumanEvalCode,
  buildHumanEvalTest,
  buildMBPPTest,
  type HumanEvalTask,
  type MBPPTask,
} from './utils.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskResult {
  task_id: string
  passed: boolean
  duration_ms: number
  raw_output: string
  extracted_code: string
  error?: string
}

interface BenchmarkSummary {
  benchmark: string
  model: string
  timestamp: string
  total: number
  passed: number
  'pass@1': number
  results: TaskResult[]
}

interface ExecutionResult {
  passed: boolean
  stdout: string
  stderr: string
  returncode: number
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
let benchmark = 'humaneval'
let model = 'qwen3-coder:latest'
let ollamaUrl = 'http://localhost:11434'
let limit = 0
let timeout = 5
let retries = 1

for (let i = 0; i < argv.length; i++) {
  switch (argv[i]) {
    case '--benchmark':
    case '-b':
      benchmark = argv[++i]
      break
    case '--model':
    case '-m':
      model = argv[++i]
      break
    case '--ollama-url':
    case '-u':
      ollamaUrl = argv[++i]
      break
    case '--limit':
    case '-l':
      limit = parseInt(argv[++i], 10)
      break
    case '--timeout':
    case '-t':
      timeout = parseInt(argv[++i], 10)
      break
    case '--retries':
    case '-r':
      retries = parseInt(argv[++i], 10)
      break
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVAL_DIR = resolve(import.meta.dirname ?? '.')
const DATASETS_DIR = join(EVAL_DIR, 'datasets')
const RUNS_DIR = join(EVAL_DIR, 'runs', benchmark)
const RESULTS_DIR = join(EVAL_DIR, 'results')
const EXECUTOR = join(EVAL_DIR, 'executor.py')
const TMP_DIR = join(RUNS_DIR, '_tmp')

// Ensure directories exist
mkdirSync(RUNS_DIR, { recursive: true })
mkdirSync(RESULTS_DIR, { recursive: true })
mkdirSync(TMP_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Ollama API — single-shot generation
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are an expert Python programmer. Complete the given function implementation. ' +
  'Output ONLY the Python code. Do not include explanations, markdown formatting, ' +
  'or anything other than valid Python code.'

async function queryOllama(prompt: string): Promise<string> {
  const controller = new AbortController()
  const apiTimeout = setTimeout(() => controller.abort(), 120_000) // 2 min hard cap

  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: {
          temperature: 0,
          num_predict: 2048,
        },
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = (await res.json()) as { message: { content: string } }
    return data.message.content
  } finally {
    clearTimeout(apiTimeout)
  }
}

// ---------------------------------------------------------------------------
// Sandbox execution via executor.py
// ---------------------------------------------------------------------------

function executeTest(codeContent: string, testContent: string): ExecutionResult {
  const codeFile = join(TMP_DIR, 'code.py')
  const testFile = join(TMP_DIR, 'test.py')

  writeFileSync(codeFile, codeContent)
  writeFileSync(testFile, testContent)

  try {
    const output = execFileSync(
      'python3',
      [EXECUTOR, '--code', codeFile, '--test', testFile, '--timeout', String(timeout)],
      {
        timeout: (timeout + 10) * 1000, // extra buffer
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    return JSON.parse(output.trim())
  } catch (err: any) {
    const stderr = typeof err.stderr === 'string' ? err.stderr : ''
    return {
      passed: false,
      stdout: '',
      stderr: stderr.slice(0, 500) || err.message?.slice(0, 500) || String(err),
      returncode: -1,
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildHumanEvalPrompt(task: HumanEvalTask): string {
  return (
    'Complete the following Python function:\n\n' +
    task.prompt
  )
}

function buildMBPPPrompt(task: MBPPTask): string {
  const funcName = extractFunctionName(task.code)
  const nameHint = funcName ? ` Name the function \`${funcName}\`.` : ''
  return task.text + '\n\nWrite a Python function to solve this.' + nameHint
}

// ---------------------------------------------------------------------------
// Single task evaluation (with optional retry)
// ---------------------------------------------------------------------------

async function evaluateTask(
  taskId: string,
  prompt: string,
  buildCode: (extracted: string) => string,
  buildTest: () => string,
): Promise<TaskResult> {
  const start = Date.now()
  let rawOutput = ''
  let extractedCode = ''
  let passed = false
  let error: string | undefined

  for (let attempt = 0; attempt < retries; attempt++) {
    rawOutput = ''
    extractedCode = ''
    passed = false
    error = undefined

    try {
      // Step 1: Query model
      rawOutput = await queryOllama(prompt)

      // Step 2: Extract code
      extractedCode = extractPythonCode(rawOutput)

      // Step 3: Validate syntax
      if (!validateSyntax(extractedCode)) {
        error = 'Syntax validation failed on extracted code'
        continue
      }

      // Step 4: Build code + test files, execute
      const codeContent = buildCode(extractedCode)
      const testContent = buildTest()
      const result = executeTest(codeContent, testContent)

      passed = result.passed
      if (!passed) {
        error = result.stderr.slice(0, 300) || `Exit code: ${result.returncode}`
      } else {
        break // passed — no more retries needed
      }
    } catch (err: any) {
      error = err.message?.slice(0, 300) ?? String(err)
    }
  }

  return {
    task_id: taskId,
    passed,
    duration_ms: Date.now() - start,
    raw_output: rawOutput,
    extracted_code: extractedCode,
    error,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('')
  console.log('  ╔═══════════════════════════════════════╗')
  console.log('  ║       cmdr benchmark runner           ║')
  console.log('  ╚═══════════════════════════════════════╝')
  console.log(`  Benchmark : ${benchmark}`)
  console.log(`  Model     : ${model}`)
  console.log(`  Ollama    : ${ollamaUrl}`)
  console.log(`  Timeout   : ${timeout}s per task`)
  console.log(`  Retries   : ${retries}`)
  if (limit > 0) console.log(`  Limit     : ${limit} tasks`)
  console.log('')

  // --- Load dataset ---
  interface NormalizedTask {
    id: string
    prompt: string
    /** Given extracted code, return the code file content. */
    buildCode: (extracted: string) => string
    /** Return the test file content (combined with code by executor). */
    buildTest: () => string
  }

  let tasks: NormalizedTask[]

  if (benchmark === 'humaneval') {
    const dataset = loadHumanEvalDataset(join(DATASETS_DIR, 'humaneval.jsonl'))
    tasks = dataset.map(t => ({
      id: t.task_id,
      prompt: buildHumanEvalPrompt(t),
      buildCode: (extracted: string) => buildHumanEvalCode(t, extracted),
      buildTest: () => buildHumanEvalTest(t),
    }))
  } else if (benchmark === 'mbpp') {
    const dataset = loadMBPPDataset(join(DATASETS_DIR, 'mbpp.jsonl'))
    tasks = dataset.map(t => ({
      id: `MBPP/${t.task_id}`,
      prompt: buildMBPPPrompt(t),
      buildCode: (extracted: string) => extracted,
      buildTest: () => buildMBPPTest(t),
    }))
  } else {
    console.error(`  Unknown benchmark: ${benchmark}`)
    console.error('  Supported: humaneval, mbpp')
    process.exit(1)
  }

  if (limit > 0) tasks = tasks.slice(0, limit)

  console.log(`  Loaded ${tasks.length} tasks`)
  console.log('  ─────────────────────────────────────────')
  console.log('')

  // --- Evaluate each task ---
  const results: TaskResult[] = []
  let passedCount = 0

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const progress = `[${String(i + 1).padStart(3)}/${tasks.length}]`
    process.stdout.write(`  ${progress} ${task.id.padEnd(20)} `)

    const result = await evaluateTask(task.id, task.prompt, task.buildCode, task.buildTest)
    results.push(result)
    if (result.passed) passedCount++

    // Write per-task log
    const sanitizedId = task.id.replace(/\//g, '_')
    writeFileSync(
      join(RUNS_DIR, `${sanitizedId}.txt`),
      [
        `Task: ${task.id}`,
        `Passed: ${result.passed}`,
        `Duration: ${result.duration_ms}ms`,
        `Error: ${result.error ?? 'none'}`,
        '',
        '--- RAW OUTPUT ---',
        result.raw_output,
        '',
        '--- EXTRACTED CODE ---',
        result.extracted_code,
      ].join('\n'),
    )

    const status = result.passed ? '✓ PASS' : '✗ FAIL'
    const time = `(${(result.duration_ms / 1000).toFixed(1)}s)`
    console.log(`${status}  ${time}`)
  }

  // --- Compute & save metrics ---
  const passAt1 = tasks.length > 0 ? passedCount / tasks.length : 0

  const summary: BenchmarkSummary = {
    benchmark,
    model,
    timestamp: new Date().toISOString(),
    total: tasks.length,
    passed: passedCount,
    'pass@1': Math.round(passAt1 * 1000) / 1000,
    results,
  }

  const resultsFile = join(RESULTS_DIR, `${benchmark}_results.json`)
  writeFileSync(resultsFile, JSON.stringify(summary, null, 2))

  console.log('')
  console.log('  ═══════════════════════════════════════')
  console.log('  Results')
  console.log(`  Total   : ${summary.total}`)
  console.log(`  Passed  : ${summary.passed}`)
  console.log(`  pass@1  : ${summary['pass@1']}`)
  console.log(`  Report  : ${resultsFile}`)
  console.log('  ═══════════════════════════════════════')
  console.log('')
}

main().catch(err => {
  console.error(`\n  Fatal: ${err.message ?? err}`)
  process.exit(1)
})
