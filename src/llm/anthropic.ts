/**
 * Anthropic LLM adapter for cmdr.
 *
 * Uses the Anthropic Messages API (/v1/messages) with native tool use support.
 * Anthropic's message format uses content blocks (text + tool_use), matching
 * cmdr's internal ContentBlock structure very closely.
 */

import type {
  LLMAdapter, LLMMessage, LLMChatOptions, LLMStreamOptions,
  LLMResponse, StreamEvent, ContentBlock, TextBlock,
  ToolUseBlock, ToolResultBlock, LLMToolDef, TokenUsage,
} from '../core/types.js'
import { validateToolCallShape } from './validation/tool-call-schema.js'

// Anthropic API types
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Array<AnthropicContentBlock>
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

interface AnthropicResponse {
  id: string
  type: 'message'
  role: 'assistant'
  content: AnthropicContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

interface AnthropicStreamEvent {
  type: string
  index?: number
  content_block?: AnthropicContentBlock
  delta?: {
    type: string
    text?: string
    partial_json?: string
  }
  message?: AnthropicResponse
  usage?: { output_tokens: number }
}

export class AnthropicAdapter implements LLMAdapter {
  readonly name = 'anthropic'
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: {
    apiKey: string
    baseUrl?: string
  }) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.chat
  // -----------------------------------------------------------------------

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }

    if (options.systemPrompt) {
      body.system = options.systemPrompt
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 300)}`)
    }

    const data = await res.json() as AnthropicResponse
    const content = this.parseContent(data.content)

    return {
      id: data.id,
      content,
      model: data.model,
      stop_reason: data.stop_reason,
      usage: {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
      },
    }
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.stream
  // -----------------------------------------------------------------------

  async *stream(messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    }

    if (options.systemPrompt) {
      body.system = options.systemPrompt
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (err) {
      yield { type: 'error', data: err instanceof Error ? err : new Error(String(err)) }
      return
    }

    if (!res.ok) {
      const text = await res.text()
      yield { type: 'error', data: new Error(`Anthropic API error (${res.status}): ${text.slice(0, 300)}`) }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { type: 'error', data: new Error('No response body from Anthropic') }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let model = options.model
    let totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 }

    // Track current content block for incremental tool_use
    const toolBlocks = new Map<number, { id: string; name: string; partialJson: string }>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)

          let event: AnthropicStreamEvent
          try {
            event = JSON.parse(payload) as AnthropicStreamEvent
          } catch {
            continue
          }

          switch (event.type) {
            case 'message_start':
              if (event.message) {
                model = event.message.model
                totalUsage = {
                  input_tokens: event.message.usage?.input_tokens ?? 0,
                  output_tokens: event.message.usage?.output_tokens ?? 0,
                }
              }
              break

            case 'content_block_start':
              if (event.content_block?.type === 'tool_use' && event.index !== undefined) {
                const tb = event.content_block as { type: 'tool_use'; id: string; name: string }
                toolBlocks.set(event.index, { id: tb.id, name: tb.name, partialJson: '' })
              }
              break

            case 'content_block_delta':
              if (event.delta?.type === 'text_delta' && event.delta.text) {
                fullText += event.delta.text
                yield { type: 'text', data: event.delta.text }
              } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json !== undefined) {
                const block = event.index !== undefined ? toolBlocks.get(event.index) : undefined
                if (block) {
                  block.partialJson += event.delta.partial_json
                }
              }
              break

            case 'content_block_stop':
              if (event.index !== undefined) {
                const block = toolBlocks.get(event.index)
                if (block) {
                  let args: Record<string, unknown> = {}
                  try { args = JSON.parse(block.partialJson) } catch { /* */ }
                  const toolUseBlock: ToolUseBlock = {
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: args,
                  }
                  yield { type: 'tool_use', data: toolUseBlock }
                }
              }
              break

            case 'message_delta':
              if (event.usage) {
                totalUsage = {
                  ...totalUsage,
                  output_tokens: event.usage.output_tokens,
                }
              }
              break
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Done event
    const content: ContentBlock[] = []
    if (fullText) content.push({ type: 'text', text: fullText } as TextBlock)
    for (const [, block] of toolBlocks) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(block.partialJson) } catch { /* */ }
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: args } as ToolUseBlock)
    }

    yield {
      type: 'done',
      data: {
        id: `anthropic_${Date.now()}`,
        content,
        model,
        stop_reason: toolBlocks.size > 0 ? 'tool_use' : 'end_turn',
        usage: totalUsage,
      } as LLMResponse,
    }
  }

  // -----------------------------------------------------------------------
  // Message conversion
  // -----------------------------------------------------------------------

  /**
   * Convert cmdr's LLMMessage[] to Anthropic's message format.
   * Anthropic uses content blocks natively, so this is nearly a 1:1 mapping.
   */
  private convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = []

    for (const msg of messages) {
      const blocks: AnthropicContentBlock[] = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          blocks.push({ type: 'text', text: (block as TextBlock).text })
        } else if (block.type === 'image') {
          const ib = block as import('../core/types.js').ImageBlock
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: ib.source.media_type,
              data: ib.source.data,
            },
          })
        } else if (block.type === 'tool_use') {
          const tb = block as ToolUseBlock
          blocks.push({ type: 'tool_use', id: tb.id, name: tb.name, input: tb.input })
        } else if (block.type === 'tool_result') {
          const tr = block as ToolResultBlock
          blocks.push({
            type: 'tool_result',
            tool_use_id: tr.tool_use_id,
            content: tr.content,
            ...(tr.is_error ? { is_error: true } : {}),
          })
        }
      }

      if (blocks.length > 0) {
        result.push({ role: msg.role, content: blocks })
      }
    }

    return result
  }

  private parseContent(blocks: AnthropicContentBlock[]): ContentBlock[] {
    return blocks.map(b => {
      if (b.type === 'text') {
        return { type: 'text', text: b.text } as TextBlock
      }
      if (b.type === 'tool_use') {
        // Validate through canonical schema
        const validation = validateToolCallShape({ name: b.name, arguments: b.input })
        if (validation.ok) {
          return {
            type: 'tool_use',
            id: b.id,
            name: validation.toolCall.name,
            input: validation.toolCall.arguments,
          } as ToolUseBlock
        }
      }
      return { type: 'text', text: '' } as TextBlock  // fallback
    })
  }

  private convertToolDef(tool: LLMToolDef): Record<string, unknown> {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }
  }

  getModelProfile(): import('../core/types.js').ModelProfile {
    return {
      retryOnFailure: false,
      maxToolRetries: 0,
      attemptRepair: false,
      correctionStyle: 'gentle',
      strictToolPrompt: false,
    }
  }
}
