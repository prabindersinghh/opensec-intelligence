/**
 * todo_write — session-scoped task checklist for tracking progress.
 *
 * The LLM can create, update, and manage a checklist of tasks
 * within the current session, similar to Claude Code's TodoWrite tool.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

interface TodoItem {
  id: number
  title: string
  status: 'not-started' | 'in-progress' | 'completed'
}

// Session-scoped todo list (shared across all tool invocations)
const sessionTodos: TodoItem[] = []
let nextId = 1

export function getSessionTodos(): readonly TodoItem[] {
  return sessionTodos
}

export const todoWriteTool = defineTool({
  name: 'todo_write',
  description: 'Manage a session-scoped task checklist. Use to track progress on multi-step tasks. Provide the complete array of all todo items (both existing and new) each time.',
  inputSchema: z.object({
    todos: z.array(z.object({
      id: z.number().optional().describe('Existing todo ID (omit for new items)'),
      title: z.string().describe('Short description of the task'),
      status: z.enum(['not-started', 'in-progress', 'completed']).describe('Current status'),
    })).describe('Complete list of all todo items'),
  }),
  execute: async (input) => {
    // Replace the entire todo list with the provided items
    sessionTodos.length = 0
    for (const item of input.todos) {
      sessionTodos.push({
        id: item.id ?? nextId++,
        title: item.title,
        status: item.status,
      })
      // Keep nextId ahead of any provided IDs
      if (item.id && item.id >= nextId) {
        nextId = item.id + 1
      }
    }

    const total = sessionTodos.length
    const completed = sessionTodos.filter(t => t.status === 'completed').length
    const inProgress = sessionTodos.filter(t => t.status === 'in-progress').length
    const notStarted = sessionTodos.filter(t => t.status === 'not-started').length

    const lines = sessionTodos.map(t => {
      const icon = t.status === 'completed' ? '✓' : t.status === 'in-progress' ? '▶' : '○'
      return `  ${icon} [${t.id}] ${t.title} (${t.status})`
    })

    return {
      data: `Todo list updated (${completed}/${total} done, ${inProgress} in-progress, ${notStarted} not-started):\n${lines.join('\n')}`,
    }
  },
})
