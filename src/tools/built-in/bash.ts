/**
 * Built-in bash/shell tool — execute shell commands cross-platform.
 *
 * Uses the ShellExecutor for platform-aware execution.
 * On Unix: uses bash/zsh/sh (auto-detected).
 * On Windows: uses PowerShell or cmd.exe (auto-detected).
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import { sanitizeBashCommand } from './bash-security.js'
import { execute, detectPlatform, getDefaultShell } from '../shell/shell-executor.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RESULT_SIZE = 30_000 // 30KB — matches Claude Code's BashTool limit

export const bashTool = defineTool({
  name: 'bash',
  description:
    'Execute a shell command and return stdout/stderr. ' +
    'Use for file operations, running scripts, installing packages, etc. ' +
    `Runs in ${detectPlatform() === 'windows' ? 'PowerShell/cmd' : 'bash'} (auto-detected).`,

  inputSchema: z.object({
    command: z.string().describe('The shell command to execute.'),
    timeout: z.number().optional().describe(`Timeout in ms. Defaults to ${DEFAULT_TIMEOUT_MS}.`),
    cwd: z.string().optional().describe('Working directory for the command.'),
  }),

  execute: async (input, context) => {
    // Security check
    const check = sanitizeBashCommand(input.command)
    if (!check.safe) {
      return { data: `Command blocked: ${check.reason}`, isError: true }
    }

    const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS
    const cwd = input.cwd ?? context.cwd ?? process.cwd()

    const result = await execute({
      command: check.sanitized,
      cwd,
      timeoutMs,
      signal: context.abortSignal,
    })

    const parts: string[] = []
    if (result.stdout) parts.push(result.stdout)
    if (result.stderr) parts.push(`[stderr]\n${result.stderr}`)
    if (result.timedOut) parts.push(`[timed out after ${timeoutMs}ms]`)
    if (result.interrupted) parts.push('[interrupted by user]')
    if (result.exitCode !== 0) parts.push(`[exit code: ${result.exitCode}]`)

    let output = parts.join('\n') || '(no output)'

    // Truncate large outputs to prevent context overflow
    if (output.length > MAX_RESULT_SIZE) {
      const truncated = output.slice(0, MAX_RESULT_SIZE)
      output = truncated + `\n[output truncated: ${output.length} chars total, showing first ${MAX_RESULT_SIZE}]`
    }

    return {
      data: output,
      isError: result.exitCode !== 0,
    }
  },
})
