/**
 * Built-in git_commit tool — commit changes from the working tree.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []

    child.stdout.on('data', (c: Buffer) => stdout.push(c))
    child.stderr.on('data', (c: Buffer) => stderr.push(c))

    child.on('close', (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString('utf-8').trim(),
        stderr: Buffer.concat(stderr).toString('utf-8').trim(),
        code: code ?? 1,
      })
    })

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, code: 1 })
    })
  })
}

export const gitCommitTool = defineTool({
  name: 'git_commit',
  description:
    'Stage and commit files. Can stage specific files or all changes, ' +
    'then create a commit with the given message.',

  inputSchema: z.object({
    message: z.string().describe('Commit message.'),
    files: z.array(z.string()).optional().describe(
      'Specific files to stage. If omitted, stages all changes (git add -A).',
    ),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()

    // Stage files
    if (input.files && input.files.length > 0) {
      const stageResult = await runGit(['add', '--', ...input.files], cwd)
      if (stageResult.code !== 0) {
        return { data: `git add failed: ${stageResult.stderr}`, isError: true }
      }
    } else {
      const stageResult = await runGit(['add', '-A'], cwd)
      if (stageResult.code !== 0) {
        return { data: `git add failed: ${stageResult.stderr}`, isError: true }
      }
    }

    // Commit
    const commitResult = await runGit(['commit', '-m', input.message], cwd)
    if (commitResult.code !== 0) {
      // "nothing to commit" is not really an error
      if (commitResult.stdout.includes('nothing to commit')) {
        return { data: 'Nothing to commit, working tree clean.' }
      }
      return { data: `git commit failed: ${commitResult.stderr || commitResult.stdout}`, isError: true }
    }

    return { data: commitResult.stdout }
  },
})

export const gitBranchTool = defineTool({
  name: 'git_branch',
  description:
    'Create, switch, or list git branches.',

  inputSchema: z.object({
    action: z.enum(['list', 'create', 'switch']).describe('Branch action.'),
    name: z.string().optional().describe('Branch name (for create/switch).'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()

    switch (input.action) {
      case 'list': {
        const result = await runGit(['branch', '--no-color', '-a'], cwd)
        return { data: result.stdout || '(no branches)', isError: result.code !== 0 }
      }
      case 'create': {
        if (!input.name) return { data: 'Branch name required.', isError: true }
        const result = await runGit(['checkout', '-b', input.name], cwd)
        if (result.code !== 0) {
          return { data: result.stderr, isError: true }
        }
        return { data: `Created and switched to branch: ${input.name}` }
      }
      case 'switch': {
        if (!input.name) return { data: 'Branch name required.', isError: true }
        const result = await runGit(['checkout', input.name], cwd)
        if (result.code !== 0) {
          return { data: result.stderr, isError: true }
        }
        return { data: `Switched to branch: ${input.name}` }
      }
    }
  },
})
