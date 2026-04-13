/**
 * Built-in git_worktree tool — manage git worktrees for parallel branch work.
 *
 * Allows the agent to create, list, and remove worktrees, enabling
 * work on multiple branches simultaneously without stashing.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => errChunks.push(c))

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(chunks).toString('utf-8').trim(),
        stderr: Buffer.concat(errChunks).toString('utf-8').trim(),
        code: code ?? 1,
      })
    })

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 })
    })
  })
}

export const gitWorktreeTool = defineTool({
  name: 'git_worktree',
  description:
    'Manage git worktrees for parallel branch work. ' +
    'Actions: list (show worktrees), add (create new worktree), remove (delete worktree).',

  inputSchema: z.object({
    action: z.enum(['list', 'add', 'remove']).describe('Worktree action to perform.'),
    path: z.string().optional().describe('Path for the new worktree (required for add/remove).'),
    branch: z.string().optional().describe('Branch name for the worktree (for add). Created if -b is needed.'),
    createBranch: z.boolean().optional().describe('Create a new branch for the worktree.'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()

    switch (input.action) {
      case 'list': {
        const result = await runGit(['worktree', 'list', '--porcelain'], cwd)
        if (result.code !== 0) return { data: result.stderr || 'Failed to list worktrees', isError: true }
        return { data: result.stdout || '(no worktrees)' }
      }

      case 'add': {
        if (!input.path) return { data: '"path" is required for add action', isError: true }
        const args = ['worktree', 'add']
        if (input.createBranch && input.branch) {
          args.push('-b', input.branch)
        }
        args.push(input.path)
        if (input.branch && !input.createBranch) {
          args.push(input.branch)
        }
        const result = await runGit(args, cwd)
        if (result.code !== 0) return { data: result.stderr || 'Failed to add worktree', isError: true }
        return { data: result.stdout || `Worktree created at ${input.path}` }
      }

      case 'remove': {
        if (!input.path) return { data: '"path" is required for remove action', isError: true }
        const result = await runGit(['worktree', 'remove', input.path], cwd)
        if (result.code !== 0) return { data: result.stderr || 'Failed to remove worktree', isError: true }
        return { data: result.stdout || `Worktree at ${input.path} removed` }
      }
    }
  },
})
