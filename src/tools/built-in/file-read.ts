/**
 * Built-in file_read tool — read file contents with offset/limit support.
 */

import { readFile, stat } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const fileReadTool = defineTool({
  name: 'file_read',
  description:
    'Read the contents of a file. Supports offset and limit for large files. ' +
    'Returns the file text or an error if the file does not exist.',

  inputSchema: z.object({
    path: z.string().describe('Absolute or relative path to the file.'),
    offset: z.number().optional().describe('Line number to start reading from (0-based).'),
    limit: z.number().optional().describe('Maximum number of lines to return.'),
  }),

  execute: async (input, context) => {
    try {
      const filePath = resolve(context.cwd ?? process.cwd(), input.path)
      const info = await stat(filePath)
      if (!info.isFile()) {
        return { data: `"${input.path}" is not a file.`, isError: true }
      }

      const content = await readFile(filePath, 'utf-8')

      if (input.offset !== undefined || input.limit !== undefined) {
        const lines = content.split('\n')
        const start = input.offset ?? 0
        const end = input.limit !== undefined ? start + input.limit : lines.length
        const slice = lines.slice(start, end)
        const header = `[Lines ${start}-${Math.min(end, lines.length)} of ${lines.length}]\n`
        return { data: header + slice.join('\n') }
      }

      return { data: content }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: msg, isError: true }
    }
  },
})
