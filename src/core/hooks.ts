/**
 * Hooks — shell-based pre/post hooks for tool and command lifecycle.
 *
 * Hooks are defined in .cmdr.toml under [hooks]:
 *   [hooks]
 *   "pre:tool:bash" = "echo 'About to run bash tool'"
 *   "post:tool:file_write" = "./scripts/lint-changed.sh"
 *   "pre:command:commit" = "npm test"
 *   "session:end" = "./scripts/cleanup.sh"
 *
 * Hook types:
 *   pre:tool:<name>   — runs before a tool executes (can block on non-zero exit)
 *   post:tool:<name>  — runs after a tool completes
 *   pre:command:<name> — runs before a slash command
 *   post:command:<name> — runs after a slash command
 *   session:start     — runs when session begins
 *   session:end       — runs when session ends
 *
 * Hooks receive context via environment variables:
 *   CMDR_HOOK_TYPE, CMDR_TOOL_NAME, CMDR_TOOL_INPUT (JSON), CMDR_CWD
 */

import { execSync } from 'node:child_process'
import { globalEventBus } from './event-bus.js'

export interface HookConfig {
  [pattern: string]: string
}

export interface HookResult {
  success: boolean
  output?: string
  error?: string
}

const HOOK_TIMEOUT_MS = 30_000

export class HookManager {
  private hooks = new Map<string, string>()
  private cwd: string

  constructor(hookConfig: HookConfig = {}, cwd: string = process.cwd()) {
    this.cwd = cwd
    for (const [pattern, command] of Object.entries(hookConfig)) {
      this.hooks.set(pattern, command)
    }
  }

  /** Register hooks from config. */
  loadConfig(config: HookConfig): void {
    for (const [pattern, command] of Object.entries(config)) {
      this.hooks.set(pattern, command)
    }
  }

  /** Find matching hooks for a given event pattern. */
  private findHooks(pattern: string): Array<{ pattern: string; command: string }> {
    const matches: Array<{ pattern: string; command: string }> = []
    for (const [hookPattern, command] of this.hooks) {
      if (hookPattern === pattern) {
        matches.push({ pattern: hookPattern, command })
      }
    }
    return matches
  }

  /** Execute a hook command. Returns result with success/failure info. */
  private executeHook(
    command: string,
    env: Record<string, string>,
  ): HookResult {
    try {
      const output = execSync(command, {
        cwd: this.cwd,
        timeout: HOOK_TIMEOUT_MS,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      }).toString().trim()

      return { success: true, output }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  }

  /**
   * Run pre-tool hooks. Returns false if a hook blocks execution (non-zero exit).
   */
  async runPreTool(
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ allowed: boolean; output?: string }> {
    const hooks = this.findHooks(`pre:tool:${toolName}`)
    if (hooks.length === 0) return { allowed: true }

    const env: Record<string, string> = {
      CMDR_HOOK_TYPE: 'pre:tool',
      CMDR_TOOL_NAME: toolName,
      CMDR_TOOL_INPUT: JSON.stringify(input),
      CMDR_CWD: this.cwd,
    }

    for (const hook of hooks) {
      const result = this.executeHook(hook.command, env)
      if (!result.success) {
        return { allowed: false, output: result.error }
      }
    }

    return { allowed: true }
  }

  /** Run post-tool hooks (informational — cannot block). */
  async runPostTool(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
  ): Promise<void> {
    const hooks = this.findHooks(`post:tool:${toolName}`)
    if (hooks.length === 0) return

    const env: Record<string, string> = {
      CMDR_HOOK_TYPE: 'post:tool',
      CMDR_TOOL_NAME: toolName,
      CMDR_TOOL_INPUT: JSON.stringify(input),
      CMDR_TOOL_SUCCESS: String(success),
      CMDR_CWD: this.cwd,
    }

    for (const hook of hooks) {
      this.executeHook(hook.command, env)
    }
  }

  /** Run session lifecycle hooks. */
  async runSessionHook(type: 'session:start' | 'session:end'): Promise<void> {
    const hooks = this.findHooks(type)
    if (hooks.length === 0) return

    const env: Record<string, string> = {
      CMDR_HOOK_TYPE: type,
      CMDR_CWD: this.cwd,
    }

    for (const hook of hooks) {
      this.executeHook(hook.command, env)
    }
  }

  /** Wire hooks into the EventBus for automatic firing. */
  wireEventBus(): void {
    globalEventBus.on('tool:before', async (data) => {
      await this.runPreTool(data.name, data.input)
    })
    globalEventBus.on('tool:after', async (data) => {
      await this.runPostTool(data.name, {}, !data.result.isError)
    })
    globalEventBus.on('session:start', async () => {
      await this.runSessionHook('session:start')
    })
    globalEventBus.on('session:end', async () => {
      await this.runSessionHook('session:end')
    })
  }

  /** Get the number of registered hooks. */
  get count(): number {
    return this.hooks.size
  }

  /** List all registered hook patterns. */
  list(): Array<{ pattern: string; command: string }> {
    return Array.from(this.hooks.entries()).map(([pattern, command]) => ({ pattern, command }))
  }
}
