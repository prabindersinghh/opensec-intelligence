/**
 * Built-in git_diff tool — show git diff of working tree.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const gitDiffTool = defineTool({
  name: 'git_diff',
  description:
    'Show the git diff of the working tree, staged changes, or a commit range. ' +
    'Useful for reviewing changes before committing.',

  inputSchema: z.object({
    staged: z.boolean().optional().describe('If true, show staged changes (--cached).'),
    path: z.string().optional().describe('Limit diff to a specific file or directory.'),
    range: z.string().optional().describe('Commit range (e.g. "HEAD~1..HEAD", "main..feature"). Overrides staged flag.'),
  }),

  execute: async (input, context) => {
    const args = ['diff', '--no-color']
    if (input.range) {
      args.push(input.range)
    } else if (input.staged) {
      args.push('--cached')
    }
    if (input.path) args.push('--', input.path)

    const cwd = context.cwd ?? process.cwd()

    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      const errChunks: Buffer[] = []

      child.stdout.on('data', (c: Buffer) => chunks.push(c))
      child.stderr.on('data', (c: Buffer) => errChunks.push(c))

      child.on('close', (code) => {
        if (code === 0) {
          const output = Buffer.concat(chunks).toString('utf-8').trim()
          resolve({ data: output || '(no changes)' })
        } else {
          resolve({ data: Buffer.concat(errChunks).toString('utf-8'), isError: true })
        }
      })

      child.on('error', (err) => {
        resolve({ data: err.message, isError: true })
      })
    })
  },
})
