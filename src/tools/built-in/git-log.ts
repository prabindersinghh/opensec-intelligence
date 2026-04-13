/**
 * Built-in git_log tool — recent git history.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const gitLogTool = defineTool({
  name: 'git_log',
  description: 'Show recent git commit history.',

  inputSchema: z.object({
    count: z.number().optional().describe('Number of commits to show. Defaults to 10.'),
    oneline: z.boolean().optional().describe('Use one-line format. Defaults to true.'),
  }),

  execute: async (input, context) => {
    const count = input.count ?? 10
    const format = input.oneline !== false ? '--oneline' : '--format=medium'
    const args = ['log', format, `-n${count}`, '--no-color']
    const cwd = context.cwd ?? process.cwd()

    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      const errChunks: Buffer[] = []

      child.stdout.on('data', (c: Buffer) => chunks.push(c))
      child.stderr.on('data', (c: Buffer) => errChunks.push(c))

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ data: Buffer.concat(chunks).toString('utf-8').trim() || '(no commits)' })
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
