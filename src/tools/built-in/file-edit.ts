/**
 * Built-in file_edit tool — replace exact strings in files.
 */

import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const fileEditTool = defineTool({
  name: 'file_edit',
  description:
    'Edit a file by replacing an exact string with a new string. ' +
    'The old_string must appear exactly once in the file. ' +
    'Use this for surgical edits instead of rewriting entire files.',

  inputSchema: z.object({
    path: z.string().describe('Absolute or relative path to the file.'),
    old_string: z.string().describe('The exact string to find and replace. Must appear exactly once.'),
    new_string: z.string().describe('The replacement string.'),
  }),

  execute: async (input, context) => {
    try {
      const filePath = resolve(context.cwd ?? process.cwd(), input.path)
      const content = await readFile(filePath, 'utf-8')

      const occurrences = content.split(input.old_string).length - 1
      if (occurrences === 0) {
        return { data: `old_string not found in ${input.path}`, isError: true }
      }
      if (occurrences > 1) {
        return { data: `old_string found ${occurrences} times in ${input.path}. Must appear exactly once.`, isError: true }
      }

      const updated = content.replace(input.old_string, input.new_string)
      await writeFile(filePath, updated, 'utf-8')

      return { data: `Edited ${input.path}: replaced ${input.old_string.length} chars with ${input.new_string.length} chars.` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: msg, isError: true }
    }
  },
})
