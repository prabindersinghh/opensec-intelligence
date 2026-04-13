/**
 * OpenAI-compatible LLM adapter for cmdr.
 *
 * Works with: OpenAI API, Groq, Together, OpenRouter, and any OpenAI-API-compatible provider.
 * Uses the standard /v1/chat/completions endpoint.
 */

import type {
  LLMAdapter, LLMMessage, LLMChatOptions, LLMStreamOptions,
  LLMResponse, StreamEvent, ContentBlock, TextBlock, ImageBlock,
  ToolUseBlock, ToolResultBlock, LLMToolDef, TokenUsage,
} from '../core/types.js'
import { validateToolCallShape } from './validation/tool-call-schema.js'

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface OpenAIChatResponse {
  id: string
  model: string
  choices: Array<{
    index: number
    message: OpenAIChatMessage
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens?: number
  }
}

interface OpenAIStreamDelta {
  id: string
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
  }
}

export class OpenAIAdapter implements LLMAdapter {
  readonly name: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly defaultHeaders: Record<string, string>

  constructor(options: {
    apiKey: string
    baseUrl?: string
    name?: string
    headers?: Record<string, string>
  }) {
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    this.name = options.name ?? 'openai'
    this.defaultHeaders = options.headers ?? {}
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.chat
  // -----------------------------------------------------------------------

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt),
      stream: false,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...this.defaultHeaders,
      },
      body: JSON.stringify(body),
      signal: options.abortSignal,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`)
    }

    const data = await res.json() as OpenAIChatResponse
    const choice = data.choices[0]
    if (!choice) throw new Error('No choices in OpenAI response')

    const content = this.parseAssistantMessage(choice.message)
    const hasToolUse = content.some(b => b.type === 'tool_use')

    const usage: TokenUsage = {
      input_tokens: data.usage?.prompt_tokens ?? 0,
      output_tokens: data.usage?.completion_tokens ?? 0,
    }

    return {
      id: data.id,
      content,
      model: data.model,
      stop_reason: hasToolUse ? 'tool_use' : 'end_turn',
      usage,
    }
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.stream
  // -----------------------------------------------------------------------

  async *stream(messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.defaultHeaders,
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
      yield { type: 'error', data: new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`) }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { type: 'error', data: new Error('No response body') }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let totalUsage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
    let model = options.model

    // Accumulate tool call deltas
    const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const payload = trimmed.slice(6)
          if (payload === '[DONE]') continue

          let chunk: OpenAIStreamDelta
          try {
            chunk = JSON.parse(payload) as OpenAIStreamDelta
          } catch {
            continue
          }

          model = chunk.model || model

          if (chunk.usage) {
            totalUsage = {
              input_tokens: chunk.usage.prompt_tokens ?? 0,
              output_tokens: chunk.usage.completion_tokens ?? 0,
            }
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue

          // Text content
          if (choice.delta.content) {
            fullText += choice.delta.content
            yield { type: 'text', data: choice.delta.content }
          }

          // Tool call deltas
          if (choice.delta.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              const existing = toolCallAccumulator.get(tc.index)
              if (existing) {
                if (tc.function?.arguments) existing.arguments += tc.function.arguments
              } else {
                toolCallAccumulator.set(tc.index, {
                  id: tc.id ?? `call_${Date.now()}_${tc.index}`,
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                })
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Emit accumulated tool calls
    for (const [, tc] of toolCallAccumulator) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.arguments)
      } catch { /* malformed args */ }

      const toolUseBlock: ToolUseBlock = {
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: args,
      }
      yield { type: 'tool_use', data: toolUseBlock }
    }

    // Done event
    const content: ContentBlock[] = []
    if (fullText) content.push({ type: 'text', text: fullText } as TextBlock)
    for (const [, tc] of toolCallAccumulator) {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(tc.arguments) } catch { /* */ }
      content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: args } as ToolUseBlock)
    }

    yield {
      type: 'done',
      data: {
        id: `openai_${Date.now()}`,
        content,
        model,
        stop_reason: toolCallAccumulator.size > 0 ? 'tool_use' : 'end_turn',
        usage: totalUsage,
      } as LLMResponse,
    }
  }

  // -----------------------------------------------------------------------
  // Message conversion
  // -----------------------------------------------------------------------

  private convertMessages(messages: LLMMessage[], systemPrompt?: string): OpenAIChatMessage[] {
    const result: OpenAIChatMessage[] = []

    if (systemPrompt) {
      result.push({ role: 'system', content: systemPrompt })
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Check if this is a tool result message
        const toolResults = msg.content.filter(
          (b): b is ToolResultBlock => b.type === 'tool_result',
        )
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            result.push({
              role: 'tool',
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            })
          }
        } else {
          const textBlocks = msg.content.filter((b): b is TextBlock => b.type === 'text')
          const imageBlocks = msg.content.filter((b): b is ImageBlock => b.type === 'image')

          if (imageBlocks.length > 0) {
            // OpenAI vision: use content array format with text + image_url
            const parts: Array<Record<string, unknown>> = []
            for (const tb of textBlocks) {
              parts.push({ type: 'text', text: tb.text })
            }
            for (const ib of imageBlocks) {
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${ib.source.media_type};base64,${ib.source.data}` },
              })
            }
            result.push({ role: 'user', content: parts as any })
          } else {
            const text = textBlocks.map(b => b.text).join('')
            if (text) result.push({ role: 'user', content: text })
          }
        }
      } else if (msg.role === 'assistant') {
        const text = msg.content
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')
        const toolCalls = msg.content
          .filter((b): b is ToolUseBlock => b.type === 'tool_use')
          .map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          }))

        const chatMsg: OpenAIChatMessage = {
          role: 'assistant',
          ...(text ? { content: text } : { content: null }),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        }
        result.push(chatMsg)
      }
    }

    return result
  }

  private parseAssistantMessage(msg: OpenAIChatMessage): ContentBlock[] {
    const content: ContentBlock[] = []

    if (msg.content) {
      content.push({ type: 'text', text: msg.content } as TextBlock)
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.function.arguments)
        } catch { /* malformed args */ }

        // Validate through canonical schema
        const validation = validateToolCallShape({ name: tc.function.name, arguments: args })
        if (validation.ok) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: validation.toolCall.name,
            input: validation.toolCall.arguments,
          } as ToolUseBlock)
        }
      }
    }

    return content
  }

  private convertToolDef(tool: LLMToolDef): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
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
