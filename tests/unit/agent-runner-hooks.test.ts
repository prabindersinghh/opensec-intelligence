import { describe, expect, it, vi } from 'vitest'

import type { LLMAdapter, LLMChatOptions, LLMMessage, LLMResponse, StreamEvent } from '../../src/core/types.js'
import { AgentRunner } from '../../src/core/agent-runner.js'
import { ToolExecutor } from '../../src/tools/executor.js'
import { ToolRegistry } from '../../src/tools/registry.js'

describe('AgentRunner plugin hooks', () => {
  it('applies beforePrompt and afterResponse hooks in stream mode', async () => {
    const capturedOptions: LLMChatOptions[] = []

    const adapter: LLMAdapter = {
      name: 'test-adapter',
      chat: async () => {
        throw new Error('chat not used in this test')
      },
      stream: async function* (_messages: LLMMessage[], options: LLMChatOptions): AsyncIterable<StreamEvent> {
        capturedOptions.push(options)

        const response: LLMResponse = {
          id: 'resp-1',
          model: options.model,
          stop_reason: 'end_turn',
          usage: { input_tokens: 3, output_tokens: 5 },
          content: [{ type: 'text', text: 'raw-output' }],
        }

        yield { type: 'text', data: 'raw-output' }
        yield { type: 'done', data: response }
      },
    }

    const beforePrompt = vi.fn(async (options: LLMChatOptions): Promise<LLMChatOptions> => ({
      ...options,
      temperature: 0.05,
    }))

    const afterResponse = vi.fn(async (response: LLMResponse): Promise<LLMResponse> => ({
      ...response,
      content: [{ type: 'text', text: 'hooked-output' }],
    }))

    const onError = vi.fn(async () => {})

    const registry = new ToolRegistry()
    const runner = new AgentRunner(
      adapter,
      registry,
      new ToolExecutor(registry),
      {
        model: 'test-model',
        maxTurns: 2,
        metadata: {
          pluginManager: {
            runBeforePrompt: beforePrompt,
            runAfterResponse: afterResponse,
            runOnError: onError,
          },
        },
      },
    )

    const events: StreamEvent[] = []
    for await (const event of runner.stream([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ])) {
      events.push(event)
    }

    expect(beforePrompt).toHaveBeenCalledTimes(1)
    expect(afterResponse).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(capturedOptions[0].temperature).toBe(0.05)

    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
    const output = (doneEvent?.data as { output: string }).output
    expect(output).toBe('hooked-output')
  })
})
