/**
 * PluginManager — loads, registers, and manages plugin lifecycle.
 *
 * Plugins can provide hooks, tools, and slash commands.
 */

import type {
  CmdrPlugin, LLMChatOptions, LLMResponse,
  ToolResult, SessionState, ToolDefinition, SlashCommand,
} from '../core/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export class PluginManager {
  private plugins: CmdrPlugin[] = []

  private resolvePluginSource(source: string, baseDir: string): string {
    if (source.startsWith('file://')) return source

    if (source.startsWith('.') || isAbsolute(source)) {
      const absolutePath = isAbsolute(source) ? source : resolve(baseDir, source)
      return pathToFileURL(absolutePath).href
    }

    return source
  }

  /** Load a plugin from a module path or package name. */
  async load(source: string, baseDir = process.cwd()): Promise<void> {
    try {
      const mod = await import(this.resolvePluginSource(source, baseDir))
      const plugin: CmdrPlugin = mod.default ?? mod
      if (!plugin.name) {
        throw new Error(`Plugin from "${source}" has no name`)
      }
      if (this.plugins.some(p => p.name === plugin.name)) {
        throw new Error(`Plugin "${plugin.name}" is already loaded`)
      }
      this.plugins.push(plugin)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to load plugin "${source}": ${msg}`)
    }
  }

  /** Register a plugin instance directly (for programmatic use). */
  register(plugin: CmdrPlugin): void {
    if (this.plugins.some(p => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`)
    }
    this.plugins.push(plugin)
  }

  /** Unregister a plugin by name. */
  unregister(name: string): boolean {
    const idx = this.plugins.findIndex(p => p.name === name)
    if (idx === -1) return false
    this.plugins.splice(idx, 1)
    return true
  }

  /** Get all loaded plugins. */
  list(): CmdrPlugin[] {
    return [...this.plugins]
  }

  /** Register all plugin tools into a ToolRegistry. */
  registerTools(registry: ToolRegistry): void {
    for (const plugin of this.plugins) {
      if (plugin.tools) {
        for (const tool of plugin.tools) {
          registry.register(tool as ToolDefinition)
        }
      }
    }
  }

  /** Get all slash commands from plugins. */
  getCommands(): SlashCommand[] {
    const cmds: SlashCommand[] = []
    for (const plugin of this.plugins) {
      if (plugin.commands) {
        cmds.push(...plugin.commands)
      }
    }
    return cmds
  }

  // ─── Hook pipeline ────────────────────────────────────────

  /** Run beforePrompt hooks. Plugins can modify the chat options. */
  async runBeforePrompt(options: LLMChatOptions): Promise<LLMChatOptions> {
    let result = options
    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforePrompt) {
        result = await plugin.hooks.beforePrompt(result)
      }
    }
    return result
  }

  /** Run afterResponse hooks. Plugins can modify the response. */
  async runAfterResponse(response: LLMResponse): Promise<LLMResponse> {
    let result = response
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterResponse) {
        result = await plugin.hooks.afterResponse(result)
      }
    }
    return result
  }

  /** Run beforeToolExec hooks. Plugins can modify tool input. */
  async runBeforeToolExec(tool: string, input: unknown): Promise<unknown> {
    let result = input
    for (const plugin of this.plugins) {
      if (plugin.hooks?.beforeToolExec) {
        result = await plugin.hooks.beforeToolExec(tool, result)
      }
    }
    return result
  }

  /** Run afterToolExec hooks. Plugins can modify tool results. */
  async runAfterToolExec(tool: string, result: ToolResult): Promise<ToolResult> {
    let modified = result
    for (const plugin of this.plugins) {
      if (plugin.hooks?.afterToolExec) {
        modified = await plugin.hooks.afterToolExec(tool, modified)
      }
    }
    return modified
  }

  /** Run onError hooks. */
  async runOnError(error: Error): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.onError) {
        try {
          await plugin.hooks.onError(error)
        } catch {
          // Don't let plugin errors cascade
        }
      }
    }
  }

  /** Run onSessionStart hooks. */
  async runOnSessionStart(session: SessionState): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.onSessionStart) {
        try {
          await plugin.hooks.onSessionStart(session)
        } catch {
          // best effort
        }
      }
    }
  }

  /** Run onSessionEnd hooks. */
  async runOnSessionEnd(session: SessionState): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.hooks?.onSessionEnd) {
        try {
          await plugin.hooks.onSessionEnd(session)
        } catch {
          // best effort
        }
      }
    }
  }
}
