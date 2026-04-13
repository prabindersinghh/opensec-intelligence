/**
 * Built-in lsp tool — query Language Server Protocol for diagnostics, definitions, references.
 *
 * Uses a lightweight approach: shells out to language-specific CLIs
 * (tsc, eslint, pyright, etc.) rather than maintaining a full LSP client.
 * This covers the most common use cases without heavy dependencies.
 */

import { spawn } from 'child_process'
import { z } from 'zod'
import { defineTool } from '../registry.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill()
      resolve({ stdout: '', stderr: 'Command timed out', code: 1 })
    }, timeoutMs)

    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => errChunks.push(c))

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        stdout: Buffer.concat(chunks).toString('utf-8').trim(),
        stderr: Buffer.concat(errChunks).toString('utf-8').trim(),
        code: code ?? 1,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({ stdout: '', stderr: err.message, code: 1 })
    })
  })
}

export const lspDiagnosticsTool = defineTool({
  name: 'diagnostics',
  description:
    'Get compiler/linter diagnostics (errors, warnings) for the project or a specific file. ' +
    'Auto-detects the project type (TypeScript, Python, etc.) and runs the appropriate checker. ' +
    'Useful for finding errors after making code changes.',

  inputSchema: z.object({
    file: z.string().optional().describe('Specific file to check. If omitted, checks the whole project.'),
    checker: z.enum(['auto', 'tsc', 'eslint', 'pyright', 'mypy', 'ruff']).optional()
      .describe('Which checker to use. Defaults to auto-detect.'),
  }),

  execute: async (input, context) => {
    const cwd = context.cwd ?? process.cwd()
    const checker = input.checker ?? 'auto'
    const file = input.file

    // Auto-detect project type
    let resolvedChecker = checker
    if (resolvedChecker === 'auto') {
      if (existsSync(join(cwd, 'tsconfig.json'))) resolvedChecker = 'tsc'
      else if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) {
        resolvedChecker = 'pyright'
      } else if (existsSync(join(cwd, 'package.json'))) resolvedChecker = 'tsc'
      else resolvedChecker = 'tsc' // fallback
    }

    let result: { stdout: string; stderr: string; code: number }

    switch (resolvedChecker) {
      case 'tsc': {
        const args = ['--noEmit', '--pretty']
        if (file) args.push(file)
        result = await runCommand('npx', ['tsc', ...args], cwd)
        break
      }
      case 'eslint': {
        const target = file ?? '.'
        result = await runCommand('npx', ['eslint', '--format', 'compact', target], cwd)
        break
      }
      case 'pyright': {
        const args = file ? [file] : []
        result = await runCommand('pyright', ['--outputjson', ...args], cwd)
        // Parse pyright JSON output into readable format
        if (result.code === 0 || result.stdout.startsWith('{')) {
          try {
            const data = JSON.parse(result.stdout)
            const diags = data.generalDiagnostics ?? []
            if (diags.length === 0) {
              result.stdout = 'No errors found.'
            } else {
              result.stdout = diags.map((d: { file: string; range: { start: { line: number } }; severity: number; message: string }) =>
                `${d.file}:${d.range.start.line}: [${d.severity === 1 ? 'error' : 'warning'}] ${d.message}`,
              ).join('\n')
            }
          } catch { /* use raw output */ }
        }
        break
      }
      case 'mypy': {
        const target = file ?? '.'
        result = await runCommand('mypy', [target], cwd)
        break
      }
      case 'ruff': {
        const target = file ?? '.'
        result = await runCommand('ruff', ['check', target], cwd)
        break
      }
      default:
        return { data: `Unknown checker: ${resolvedChecker}`, isError: true }
    }

    const output = result.stdout || result.stderr
    if (result.code === 0 && !output) {
      return { data: `No diagnostics found (${resolvedChecker}).` }
    }
    // Code != 0 is normal for diagnostics tools (means errors found)
    return { data: output || 'No output from checker.' }
  },
})
