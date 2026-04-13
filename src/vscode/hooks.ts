/**
 * cmdr VS Code Extension — Hook System.
 *
 * Event-driven validation hooks that gate tool execution.
 * Modeled after Claude Code's hook system with exit code semantics:
 *   - Exit 0: Allow (tool proceeds)
 *   - Exit 1: Error shown to user only (tool still proceeds)
 *   - Exit 2: Block tool + show error to agent (can retry)
 *
 * Hook Types:
 *   - PreToolUse: Before a tool runs (can block)
 *   - PostToolUse: After a tool completes (can modify output)
 *   - Stop: Before session/stream ends (can prevent exit for autonomous loops)
 *   - SessionStart: When chat session begins
 *   - SessionEnd: When chat session ends
 *   - UserPromptSubmit: Before user prompt is sent (can modify)
 *
 * Hooks are configured via:
 *   1. .cmdr/hooks.json in workspace root
 *   2. cmdr.hooks setting in VS Code settings
 */

import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'

export type HookType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreCompact'
  | 'Notification'

export interface HookDefinition {
  type: 'command'
  command: string
  timeout?: number // ms, default 30000
}

export interface HookRule {
  matcher?: string // regex pattern to match tool names
  hooks: HookDefinition[]
}

export interface HooksConfig {
  hooks: Partial<Record<HookType, HookRule[]>>
}

export interface HookResult {
  exitCode: number
  stdout: string
  stderr: string
  // Parsed from JSON stdout
  retry?: boolean
  defer?: boolean
  message?: string
  modifiedInput?: unknown
}

export class HookRunner {
  private config: HooksConfig | null = null
  private outputChannel: vscode.OutputChannel

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.loadConfig()
  }

  /** Reload hook configuration from workspace. */
  loadConfig(): void {
    this.config = null

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    // Try .cmdr/hooks.json
    const hooksPath = path.join(workspaceRoot, '.cmdr', 'hooks.json')
    if (fs.existsSync(hooksPath)) {
      try {
        const raw = fs.readFileSync(hooksPath, 'utf-8')
        this.config = JSON.parse(raw) as HooksConfig
        this.outputChannel.appendLine(`[hooks] Loaded config from ${hooksPath}`)
        return
      } catch (err) {
        this.outputChannel.appendLine(`[hooks] Failed to parse ${hooksPath}: ${err}`)
      }
    }

    // Try VS Code settings
    const settingsHooks = vscode.workspace.getConfiguration('cmdr').get<HooksConfig>('hooks')
    if (settingsHooks) {
      this.config = settingsHooks
      this.outputChannel.appendLine('[hooks] Loaded config from VS Code settings')
    }
  }

  /** Run hooks for a given event type. Returns the aggregate result. */
  async runHooks(
    hookType: HookType,
    context: {
      tool?: string
      input?: unknown
      output?: string
      prompt?: string
      transcriptPath?: string
      sessionId?: string
    },
  ): Promise<HookResult> {
    if (!this.config?.hooks?.[hookType]) {
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const rules = this.config.hooks[hookType]!
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''

    for (const rule of rules) {
      // Check matcher
      if (rule.matcher && context.tool) {
        const regex = new RegExp(rule.matcher, 'i')
        if (!regex.test(context.tool)) continue
      }

      for (const hookDef of rule.hooks) {
        const result = await this.executeHook(hookDef, hookType, context, workspaceRoot)

        if (result.exitCode === 2) {
          // Block — stop processing further hooks
          this.outputChannel.appendLine(
            `[hooks] ${hookType} BLOCKED by hook: ${hookDef.command} — ${result.stderr || result.message || 'no reason'}`,
          )
          return result
        }

        if (result.exitCode === 1) {
          // User-facing error, but don't block
          this.outputChannel.appendLine(
            `[hooks] ${hookType} warning from hook: ${hookDef.command} — ${result.stderr}`,
          )
          vscode.window.showWarningMessage(`cmdr hook: ${result.stderr || result.message || 'Hook error'}`)
        }

        // Exit 0 — continue to next hook
      }
    }

    return { exitCode: 0, stdout: '', stderr: '' }
  }

  /** Execute a single hook command. */
  private executeHook(
    hookDef: HookDefinition,
    hookType: HookType,
    context: {
      tool?: string
      input?: unknown
      output?: string
      prompt?: string
      transcriptPath?: string
      sessionId?: string
    },
    workspaceRoot: string,
  ): Promise<HookResult> {
    const timeout = hookDef.timeout || 30000

    // Build environment variables for the hook
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CMDR_HOOK_TYPE: hookType,
      CMDR_TOOL_NAME: context.tool || '',
      CMDR_TOOL_INPUT: typeof context.input === 'string' ? context.input : JSON.stringify(context.input || ''),
      CMDR_TOOL_OUTPUT: context.output || '',
      CMDR_PROMPT: context.prompt || '',
      CMDR_TRANSCRIPT_PATH: context.transcriptPath || '',
      CMDR_SESSION_ID: context.sessionId || '',
      CMDR_WORKSPACE_ROOT: workspaceRoot,
    }

    // Build stdin payload (JSON)
    const stdinPayload = JSON.stringify({
      hook_type: hookType,
      tool_name: context.tool,
      tool_input: context.input,
      tool_output: context.output,
      prompt: context.prompt,
      transcript_path: context.transcriptPath,
      session_id: context.sessionId,
      workspace_root: workspaceRoot,
    })

    return new Promise<HookResult>((resolve) => {
      const parts = hookDef.command.split(/\s+/)
      const cmd = parts[0]
      const args = parts.slice(1)

      const child = execFile(
        cmd,
        args,
        {
          cwd: workspaceRoot,
          env,
          timeout,
          maxBuffer: 1024 * 1024, // 1MB
        },
        (error, stdout, stderr) => {
          const exitCode = error?.code === 'ETIMEDOUT' ? 2 : (error as any)?.code ?? 0
          const numericExit = typeof exitCode === 'number' ? exitCode : parseInt(exitCode, 10) || 0

          // Try to parse JSON from stdout
          let parsed: any = {}
          try {
            if (stdout.trim()) {
              parsed = JSON.parse(stdout.trim())
            }
          } catch {
            // Not JSON — that's fine
          }

          resolve({
            exitCode: numericExit,
            stdout: stdout || '',
            stderr: stderr || '',
            retry: parsed.retry,
            defer: parsed.defer,
            message: parsed.message,
            modifiedInput: parsed.modified_input || parsed.modifiedInput,
          })
        },
      )

      // Send context via stdin
      if (child.stdin) {
        child.stdin.write(stdinPayload)
        child.stdin.end()
      }
    })
  }

  /** Check if hooks are configured for a given type. */
  hasHooks(hookType: HookType): boolean {
    return !!(this.config?.hooks?.[hookType]?.length)
  }

  /** Get number of configured hook rules. */
  get hookCount(): number {
    if (!this.config?.hooks) return 0
    return Object.values(this.config.hooks).reduce((sum, rules) => sum + (rules?.length || 0), 0)
  }

  /** Refresh config (alias for loadConfig). */
  refresh(): void {
    this.loadConfig()
  }

  dispose(): void {
    this.config = null
  }
}
