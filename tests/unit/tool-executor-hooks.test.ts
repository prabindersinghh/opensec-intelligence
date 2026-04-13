import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ToolExecutor } from '../../src/tools/executor.js'
import { defineTool, ToolRegistry } from '../../src/tools/registry.js'

describe('ToolExecutor plugin hooks', () => {
  it('runs beforeToolExec and afterToolExec hooks', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'echo',
        description: 'echo input',
        inputSchema: z.object({ text: z.string() }),
        execute: async (input) => ({ data: input.text }),
      }),
    )

    const beforeHook = vi.fn(async (_tool: string, input: unknown) => {
      const parsed = input as { text: string }
      return { text: parsed.text.toUpperCase() }
    })
    const afterHook = vi.fn(async (_tool: string, result: { data: string }) => ({
      data: `${result.data}!`,
    }))
    const errorHook = vi.fn(async () => {})

    const executor = new ToolExecutor(registry)
    const result = await executor.execute(
      'echo',
      { text: 'hello' },
      {
        agent: { name: 'tester', role: 'assistant', model: 'test-model' },
        metadata: {
          pluginManager: {
            runBeforeToolExec: beforeHook,
            runAfterToolExec: afterHook,
            runOnError: errorHook,
          },
        },
      },
    )

    expect(beforeHook).toHaveBeenCalledTimes(1)
    expect(afterHook).toHaveBeenCalledTimes(1)
    expect(errorHook).not.toHaveBeenCalled()
    expect(result).toEqual({ data: 'HELLO!' })
  })

  it('returns an error when beforeToolExec does not return an object', async () => {
    const registry = new ToolRegistry()
    registry.register(
      defineTool({
        name: 'echo',
        description: 'echo input',
        inputSchema: z.object({ text: z.string() }),
        execute: async (input) => ({ data: input.text }),
      }),
    )

    const executor = new ToolExecutor(registry)
    const result = await executor.execute(
      'echo',
      { text: 'hello' },
      {
        agent: { name: 'tester', role: 'assistant', model: 'test-model' },
        metadata: {
          pluginManager: {
            runBeforeToolExec: async () => 'invalid',
            runAfterToolExec: async (_tool: string, payload: unknown) => payload,
            runOnError: async () => {},
          },
        },
      },
    )

    expect(result.isError).toBe(true)
    expect(result.data).toContain('must return an object input payload')
  })
})
