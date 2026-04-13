/**
 * Task management tools — LLM-driven wrappers around TaskScheduler.
 *
 * Provides task_create, task_list, task_get, task_stop for the LLM to
 * schedule and manage background tasks.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import type { TaskScheduler } from '../../scheduling/task-scheduler.js'

// TaskScheduler reference is set during REPL startup
let scheduler: TaskScheduler | null = null

export function setTaskScheduler(ts: TaskScheduler): void {
  scheduler = ts
}

export const taskCreateTool = defineTool({
  name: 'task_create',
  description: 'Create a background scheduled task. Supports one-shot (delayed) and recurring (interval) tasks. The task runs a shell command.',
  inputSchema: z.object({
    name: z.string().describe('Human-readable name for the task'),
    command: z.string().describe('Shell command to execute'),
    intervalMs: z.number().optional().describe('Run every N milliseconds (recurring). Omit for one-shot.'),
    delayMs: z.number().optional().describe('Delay before first/only run (default: 0 for immediate)'),
  }),
  execute: async (input) => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const { execSync } = await import('node:child_process')
    const handler = async () => {
      execSync(input.command, { timeout: 30000, stdio: 'pipe' })
    }

    let id: string
    if (input.intervalMs) {
      id = scheduler.scheduleInterval(input.name, input.intervalMs, handler)
    } else {
      id = scheduler.scheduleOnce(input.name, input.delayMs ?? 0, handler)
    }

    const type = input.intervalMs ? `recurring (every ${input.intervalMs}ms)` : `one-shot (delay ${input.delayMs ?? 0}ms)`
    return { data: `Task created: ${input.name} (${type})\nID: ${id}` }
  },
})

export const taskListTool = defineTool({
  name: 'task_list',
  description: 'List all scheduled background tasks with their status, run count, and timing.',
  inputSchema: z.object({}),
  execute: async () => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const tasks = scheduler.list()
    if (tasks.length === 0) {
      return { data: 'No scheduled tasks.' }
    }

    const lines = tasks.map(t => {
      const parts = [
        `  ${t.name} [${t.status}]`,
        `  ID: ${t.id}`,
        `  Runs: ${t.runCount}`,
      ]
      if (t.lastRun) parts.push(`  Last: ${t.lastRun.toISOString()}`)
      if (t.nextRun) parts.push(`  Next: ${t.nextRun.toISOString()}`)
      if (t.error) parts.push(`  Error: ${t.error}`)
      return parts.join('\n')
    })

    return { data: `Scheduled tasks (${tasks.length} total, ${scheduler.activeCount} active):\n\n${lines.join('\n\n')}` }
  },
})

export const taskGetTool = defineTool({
  name: 'task_get',
  description: 'Get details of a specific scheduled task by ID.',
  inputSchema: z.object({
    id: z.string().describe('The task ID returned by task_create'),
  }),
  execute: async (input) => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const task = scheduler.get(input.id)
    if (!task) {
      return { data: `Task not found: ${input.id}`, isError: true }
    }

    const info = [
      `Name: ${task.name}`,
      `Status: ${task.status}`,
      `Runs: ${task.runCount}`,
      task.lastRun ? `Last run: ${task.lastRun.toISOString()}` : null,
      task.nextRun ? `Next run: ${task.nextRun.toISOString()}` : null,
      task.error ? `Error: ${task.error}` : null,
    ].filter(Boolean).join('\n')

    return { data: info }
  },
})

export const taskStopTool = defineTool({
  name: 'task_stop',
  description: 'Stop/cancel a scheduled task by ID.',
  inputSchema: z.object({
    id: z.string().describe('The task ID to cancel'),
  }),
  execute: async (input) => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const success = scheduler.cancel(input.id)
    if (!success) {
      return { data: `Task not found: ${input.id}`, isError: true }
    }

    return { data: `Task ${input.id} cancelled.` }
  },
})
