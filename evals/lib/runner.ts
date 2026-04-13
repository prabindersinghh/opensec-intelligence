/**
 * Eval runner — orchestrates running cmdr against eval tasks and collecting results.
 *
 * Drives cmdr via its AgentRunner in headless (non-interactive) mode:
 *   1. Creates an isolated workspace for the task
 *   2. Sends the task prompt to cmdr through the Ollama adapter
 *   3. Collects output, tool calls, and token usage
 *   4. Runs verification specs against the workspace
 *   5. Records the result
 */

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve, basename } from 'path'

import type { EvalTask, TaskResult, Tier, TaskCategory, VerificationSpec } from './types.js'
import { TIER_POINTS } from './types.js'
import { createWorkspace, destroyWorkspace } from './workspace.js'
import { verifyTask } from './verifier.js'

// ---------------------------------------------------------------------------
// Task loading
// ---------------------------------------------------------------------------

const TASKS_DIR = resolve(import.meta.dirname ?? '.', '..', 'tasks')

/** Read a v1 task.json and normalize it to our EvalTask type. */
function loadTaskDef(taskDir: string): EvalTask | null {
  const taskJsonPath = join(taskDir, 'task.json')
  if (!existsSync(taskJsonPath)) return null

  const raw = JSON.parse(readFileSync(taskJsonPath, 'utf-8'))

  // Support both old tier names and new ones
  const tierMap: Record<string, Tier> = {
    trivial: 'basic',
    easy: 'intermediate',
    medium: 'advanced',
    hard: 'hard',
    expert: 'expert',
    extreme: 'extreme',
    // direct mappings
    basic: 'basic',
    intermediate: 'intermediate',
    advanced: 'advanced',
  }

  const tier: Tier = tierMap[raw.tier] ?? 'basic'
  const id = basename(taskDir)

  // Scale default timeout by tier difficulty
  const tierTimeouts: Record<string, number> = {
    basic: 60_000,
    intermediate: 90_000,
    advanced: 120_000,
    hard: 180_000,
    expert: 300_000,
    extreme: 300_000,
  }
  const defaultTimeout = tierTimeouts[tier] ?? 120_000

  // Build verification specs from verify.sh (backward-compat) or v2 verify array
  let verify: VerificationSpec[] = []
  if (raw.verify && Array.isArray(raw.verify)) {
    verify = raw.verify
  } else {
    // Fall back: verify.sh as script_verify
    const verifyScript = join(taskDir, 'verify.sh')
    if (existsSync(verifyScript)) {
      verify = [{ strategy: 'script_verify', target: verifyScript }]
    }
  }

  return {
    id,
    name: raw.name ?? id,
    tier,
    category: (raw.category as TaskCategory) ?? 'code_gen',
    description: raw.description ?? '',
    prompt: raw.prompt,
    timeout: raw.timeout ?? defaultTimeout,
    expectedTools: raw.expectedTools ?? [],
    verify,
    setup: raw.setup,
    tags: raw.tags ?? [],
    points: raw.points ?? TIER_POINTS[tier],
    requiresSkill: raw.requiresSkill,
  }
}

/** Discover and load all tasks, optionally filtered. */
export function loadTasks(filter?: string): { tasks: EvalTask[]; taskDirs: Map<string, string> } {
  if (!existsSync(TASKS_DIR)) {
    return { tasks: [], taskDirs: new Map() }
  }

  const dirs = readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()

  const filterRe = filter ? new RegExp(filter, 'i') : null
  const tasks: EvalTask[] = []
  const taskDirs = new Map<string, string>()

  for (const dir of dirs) {
    if (filterRe && !filterRe.test(dir)) continue
    const fullPath = join(TASKS_DIR, dir)
    const task = loadTaskDef(fullPath)
    if (task) {
      tasks.push(task)
      taskDirs.set(task.id, fullPath)
    }
  }

  return { tasks, taskDirs }
}

// ---------------------------------------------------------------------------
// Single-task execution (headless cmdr via subprocess)
// ---------------------------------------------------------------------------

import { execFileSync } from 'child_process'

const CMDR_BIN = resolve(import.meta.dirname ?? '.', '..', '..', 'dist', 'bin', 'cmdr.js')

export interface RunTaskOptions {
  model: string
  ollamaUrl: string
  timeout?: number
}

/**
 * Run a single eval task.
 *
 * Launches cmdr as a subprocess with --prompt (non-interactive mode).
 * Collects output, then verifies the workspace.
 */
export async function runSingleTask(
  task: EvalTask,
  taskDir: string,
  opts: RunTaskOptions,
): Promise<TaskResult> {
  const ws = createWorkspace(taskDir, task.id)
  const start = Date.now()
  let agentOutput = ''
  let error: string | undefined
  let toolsCalled: string[] = []
  let tokensIn = 0
  let tokensOut = 0

  try {
    const timeout = opts.timeout ?? task.timeout

    // Scale max-turns by tier difficulty
    const tierMaxTurns: Record<string, number> = {
      basic: 5,
      intermediate: 10,
      advanced: 15,
      hard: 20,
      expert: 30,
      extreme: 30,
    }
    const maxTurns = tierMaxTurns[task.tier] ?? 15

    const result = execFileSync('node', [
      CMDR_BIN,
      '--cwd', ws.path,
      '-m', opts.model,
      '-u', opts.ollamaUrl,
      '--dangerously-skip-permissions',
      '--max-turns', String(maxTurns),
      '-p', task.prompt,
    ], {
      timeout,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        CMDR_EVAL_MODE: '1',
      },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })

    agentOutput = result.toString('utf-8')

    // Try to extract tool call names from output (cmdr logs them)
    const toolMatches = agentOutput.matchAll(/Tool: (\w+)/g)
    for (const m of toolMatches) {
      toolsCalled.push(m[1])
    }

    // Try to extract token usage from output
    const tokenMatch = agentOutput.match(/Tokens: (\d+) in, (\d+) out/)
    if (tokenMatch) {
      tokensIn = parseInt(tokenMatch[1])
      tokensOut = parseInt(tokenMatch[2])
    }
  } catch (err: any) {
    agentOutput = err.stdout?.toString('utf-8') ?? ''
    error = err.message?.slice(0, 500) ?? String(err)
  }

  const duration = (Date.now() - start) / 1000

  // Verify
  const verifyResult = verifyTask(task.verify, ws.path)

  // Clean up
  destroyWorkspace(ws)

  return {
    taskId: task.id,
    passed: verifyResult.passed,
    score: verifyResult.passed ? task.points : 0,
    duration,
    tokensIn,
    tokensOut,
    toolsCalled,
    error: verifyResult.passed ? undefined : (error ?? verifyResult.details.join('; ')),
    agentOutput: agentOutput.slice(0, 5000),
    verifyDetails: verifyResult.details.join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

export interface BatchOptions extends RunTaskOptions {
  filter?: string
  tierFilter?: Tier[]
  concurrency?: number
  onTaskStart?: (task: EvalTask, index: number, total: number) => void
  onTaskComplete?: (task: EvalTask, result: TaskResult, index: number, total: number) => void
}

/**
 * Run all matching tasks and return results.
 * Tasks run sequentially to avoid Ollama concurrency issues.
 */
export async function runBatch(opts: BatchOptions): Promise<{ tasks: EvalTask[]; results: TaskResult[] }> {
  const { tasks, taskDirs } = loadTasks(opts.filter)

  // Apply tier filter
  const filtered = opts.tierFilter
    ? tasks.filter(t => opts.tierFilter!.includes(t.tier))
    : tasks

  const results: TaskResult[] = []

  for (let i = 0; i < filtered.length; i++) {
    const task = filtered[i]
    const taskDir = taskDirs.get(task.id)!
    opts.onTaskStart?.(task, i, filtered.length)

    const result = await runSingleTask(task, taskDir, opts)
    results.push(result)

    opts.onTaskComplete?.(task, result, i, filtered.length)
  }

  return { tasks: filtered, results }
}
