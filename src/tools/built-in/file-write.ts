/**
 * Built-in file_write tool — create or overwrite files.
 */

import { writeFile, mkdir } from 'fs/promises'
import { resolve, dirname } from 'path'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const fileWriteTool = defineTool({
  name: 'file_write',
  description:
    'Write content to a file. Creates the file and parent directories if they do not exist. ' +
    'Overwrites existing content. Use file_edit for surgical changes.',

  inputSchema: z.object({
    path: z.string().describe('Absolute or relative path to the file.'),
    content: z.string().describe('The full content to write to the file.'),
  }),

  execute: async (input, context) => {
    try {
      const filePath = resolve(context.cwd ?? process.cwd(), input.path)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, input.content, 'utf-8')
      return { data: `Wrote ${input.content.length} bytes to ${input.path}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: msg, isError: true }
    }
  },
})
