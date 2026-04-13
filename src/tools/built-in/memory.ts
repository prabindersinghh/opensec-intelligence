/**
 * Built-in memory tools — read and write persistent MEMORY.md files.
 *
 * Two scopes:
 *   - project: .cmdr/MEMORY.md — project conventions, build commands, patterns
 *   - user:    ~/.cmdr/MEMORY.md — personal preferences, global patterns
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

export const memoryReadTool = defineTool({
  name: 'memory_read',
  description:
    'Read persistent memory notes. Scope "project" reads .cmdr/MEMORY.md (repo-specific), ' +
    'scope "user" reads ~/.cmdr/MEMORY.md (global). Memory persists across sessions.',

  inputSchema: z.object({
    scope: z.enum(['project', 'user']).describe('Which memory file to read.'),
  }),

  execute: async (input, context) => {
    try {
      // MemoryManager is injected via context.metadata
      const manager = context.metadata?.memoryManager as
        import('../../memory/memory-manager.js').MemoryManager | undefined
      if (!manager) {
        return { data: 'Memory system not initialized.', isError: true }
      }

      const content = await manager.read(input.scope)
      if (!content.trim()) {
        return { data: `No ${input.scope} memory found. Use memory_write to save notes.` }
      }
      return { data: content }
    } catch (err) {
      return { data: `Failed to read memory: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})

export const memoryWriteTool = defineTool({
  name: 'memory_write',
  description:
    'Save notes to persistent memory. Use "project" scope for repo-specific info ' +
    '(build commands, conventions, architecture notes). Use "user" scope for personal ' +
    'preferences and global patterns. Content is appended with a date header.',

  inputSchema: z.object({
    scope: z.enum(['project', 'user']).describe('Which memory file to write to.'),
    content: z.string().describe('The note to append to memory. Keep concise — bullet points preferred.'),
  }),

  execute: async (input, context) => {
    try {
      const manager = context.metadata?.memoryManager as
        import('../../memory/memory-manager.js').MemoryManager | undefined
      if (!manager) {
        return { data: 'Memory system not initialized.', isError: true }
      }

      await manager.append(input.scope, input.content)
      return { data: `Saved to ${input.scope} memory.` }
    } catch (err) {
      return { data: `Failed to write memory: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})
