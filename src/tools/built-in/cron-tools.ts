/**
 * Cron/scheduling tools — interval-based task management via CLI.
 *
 * Provides cron_create, cron_list, cron_delete for the LLM.
 * These are higher-level aliases that translate human-friendly intervals
 * (e.g. "every 5 minutes") into TaskScheduler calls.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import type { TaskScheduler } from '../../scheduling/task-scheduler.js'

let scheduler: TaskScheduler | null = null

export function setCronScheduler(ts: TaskScheduler): void {
  scheduler = ts
}

function parseInterval(interval: string): number | null {
  const match = interval.match(/^(\d+)\s*(s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours)$/i)
  if (!match) return null
  const value = parseInt(match[1], 10)
  const unit = match[2].toLowerCase()
  if (unit.startsWith('s')) return value * 1000
  if (unit.startsWith('m')) return value * 60 * 1000
  if (unit.startsWith('h')) return value * 60 * 60 * 1000
  return null
}

export const cronCreateTool = defineTool({
  name: 'cron_create',
  description: 'Create a recurring scheduled job. Specify interval in human-readable format (e.g. "30s", "5m", "1h").',
  inputSchema: z.object({
    name: z.string().describe('Name of the cron job'),
    command: z.string().describe('Shell command to execute on each interval'),
    interval: z.string().describe('How often to run: "30s", "5m", "1h", etc.'),
  }),
  execute: async (input) => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const ms = parseInterval(input.interval)
    if (!ms) {
      return { data: `Invalid interval: "${input.interval}". Use formats like "30s", "5m", "1h".`, isError: true }
    }

    const { execSync } = await import('node:child_process')
    const handler = async () => {
      execSync(input.command, { timeout: 30000, stdio: 'pipe' })
    }

    const id = scheduler.scheduleInterval(input.name, ms, handler)
    return { data: `Cron job created: "${input.name}" running every ${input.interval}\nID: ${id}` }
  },
})

export const cronListTool = defineTool({
  name: 'cron_list',
  description: 'List all active cron/scheduled jobs.',
  inputSchema: z.object({}),
  execute: async () => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const tasks = scheduler.list()
    // Filter to only recurring tasks (those with intervalMs would be in the schedule)
    if (tasks.length === 0) {
      return { data: 'No scheduled cron jobs.' }
    }

    const lines = tasks.map(t =>
      `  ${t.name} [${t.status}] — ${t.runCount} runs${t.error ? ` (error: ${t.error})` : ''}`,
    )

    return { data: `Cron jobs:\n${lines.join('\n')}` }
  },
})

export const cronDeleteTool = defineTool({
  name: 'cron_delete',
  description: 'Delete/cancel a cron job by ID.',
  inputSchema: z.object({
    id: z.string().describe('The cron job ID to delete'),
  }),
  execute: async (input) => {
    if (!scheduler) {
      return { data: 'TaskScheduler is not initialized', isError: true }
    }

    const success = scheduler.cancel(input.id)
    if (!success) {
      return { data: `Cron job not found: ${input.id}`, isError: true }
    }

    return { data: `Cron job ${input.id} deleted.` }
  },
})
