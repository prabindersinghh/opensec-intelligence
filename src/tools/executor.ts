/**
 * Tool executor with concurrency control, Zod validation, and error isolation.
 *
 * Mirrors Claude Code's tool execution flow:
 * 1. Tool lookup (with unknown tool rejection)
 * 2. Zod schema validation (with corrective error messages)
 * 3. Concurrency-limited execution
 * 4. Error isolation (tool failures don't crash the agent loop)
 */

import type { ToolResult, ToolUseContext } from '../core/types.js'
import type { ToolRegistry } from './registry.js'
import { validateToolInput } from '../llm/validation/tool-call-schema.js'
import type { PluginManager } from '../plugins/plugin-manager.js'

export interface ToolExecutorOptions {
  maxConcurrency?: number
}

export interface BatchToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

type PluginHookRunner = Pick<PluginManager, 'runBeforeToolExec' | 'runAfterToolExec' | 'runOnError'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getPluginHookRunner(context: ToolUseContext): PluginHookRunner | undefined {
  const candidate = context.metadata?.pluginManager as Partial<PluginHookRunner> | undefined
  if (!candidate) return undefined

  if (
    typeof candidate.runBeforeToolExec === 'function'
    && typeof candidate.runAfterToolExec === 'function'
    && typeof candidate.runOnError === 'function'
  ) {
    return candidate as PluginHookRunner
  }

  return undefined
}

export class ToolExecutor {
  private readonly registry: ToolRegistry
  private active = 0
  private readonly maxConcurrency: number
  private readonly waitQueue: Array<() => void> = []

  constructor(registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.registry = registry
    this.maxConcurrency = options.maxConcurrency ?? 4
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolUseContext,
  ): Promise<ToolResult> {
    const pluginHooks = getPluginHookRunner(context)

    const tool = this.registry.get(name)
    if (!tool) {
      const availableTools = this.registry.list().map(t => t.name).join(', ')
      return {
        data: `Unknown tool: "${name}". Available tools: ${availableTools}`,
        isError: true,
      }
    }

    let effectiveInput = input

    if (pluginHooks) {
      try {
        const modified = await pluginHooks.runBeforeToolExec(name, input)
        if (!isRecord(modified)) {
          return {
            data: `Plugin beforeToolExec hook for "${name}" must return an object input payload.`,
            isError: true,
          }
        }
        effectiveInput = modified
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        await pluginHooks.runOnError(error)
        return {
          data: `Plugin beforeToolExec hook failed for "${name}": ${error.message}`,
          isError: true,
        }
      }
    }

    // Validate input through Zod schema with corrective error messages
    const validation = validateToolInput(name, effectiveInput, tool.inputSchema)
    if (!validation.ok) {
      return { data: validation.message, isError: true }
    }

    try {
      await this.acquire()
      try {
        let result = await tool.execute(validation.parsed, context)

        if (pluginHooks) {
          try {
            result = await pluginHooks.runAfterToolExec(name, result)
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            await pluginHooks.runOnError(error)
            return {
              data: `Plugin afterToolExec hook failed for "${name}": ${error.message}`,
              isError: true,
            }
          }
        }

        return result
      } finally {
        this.release()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (pluginHooks) {
        await pluginHooks.runOnError(err instanceof Error ? err : new Error(String(err)))
      }
      return { data: `Tool "${name}" execution error: ${message}`, isError: true }
    }
  }

  async executeBatch(
    calls: BatchToolCall[],
    context: ToolUseContext,
  ): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>()
    const promises = calls.map(async (call) => {
      const result = await this.execute(call.name, call.input, context)
      results.set(call.id, result)
    })
    await Promise.all(promises)
    return results
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.waitQueue.shift()
    if (next) next()
  }
}
