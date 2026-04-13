/**
 * OllamaAdapter — primary LLM backend for cmdr.
 *
 * Uses Ollama's /api/chat endpoint with native tool calling support.
 * Falls back to prompt-based tool injection for models without tool support.
 */

import type {
  LLMAdapter, LLMMessage, LLMChatOptions, LLMStreamOptions,
  LLMResponse, StreamEvent, ContentBlock, TextBlock,
  ToolUseBlock, LLMToolDef, TokenUsage,
} from '../core/types.js'
import { getDefaultContextLength, TOOL_CAPABLE_FAMILIES } from './model-registry.js'
import { resolveToolCalls, buildToolPromptSuffix, type NativeToolCall, type ToolParseConfig } from './shared/tool-parsing.js'
import { detectToolCallLeakage } from './validation/tool-call-schema.js'

// ---------------------------------------------------------------------------
// Types for Ollama API responses
// ---------------------------------------------------------------------------

interface OllamaChatResponse {
  model: string
  message: {
    role: string
    content: string
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> }
    }>
  }
  done: boolean
  total_duration?: number
  prompt_eval_count?: number
  eval_count?: number
}

interface OllamaModelInfo {
  modelfile: string
  parameters: string
  template: string
  details: {
    family: string
    parameter_size: string
    quantization_level: string
  }
  model_info?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Per-model-family configuration
// ---------------------------------------------------------------------------

interface ModelFamilyConfig {
  supportsNativeTools: boolean
  needsPromptInjection: boolean
  thinkingMode: 'auto' | 'disabled' | 'strip'
  xmlToolFormat: boolean      // Parse <function=name> XML in text output
  jsonToolFormat: boolean     // Parse ```tool_call JSON in text output
  // Retry/repair configuration
  retryOnFailure?: boolean       // Enable retry loop for failed tool calls
  maxToolRetries?: number        // Max retries (default: 0)
  strictToolPrompt?: boolean     // Apply strict tool discipline in prompt
  correctionStyle?: 'gentle' | 'strict'  // How aggressive correction prompts are
}

const MODEL_FAMILY_CONFIGS: Record<string, ModelFamilyConfig> = {
  qwen2:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  'qwen2.5': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  qwen3:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  qwen3moe: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true },
  gemma4:   { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'disabled', xmlToolFormat: false, jsonToolFormat: true },
  'llama3.1': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'llama3.2': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'llama3.3': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  llama4:   { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  mistral:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'mistral-nemo': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  'command-r': { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  minimax:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true, retryOnFailure: true, maxToolRetries: 2, strictToolPrompt: true, correctionStyle: 'strict' },
  deepseek: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  dolphin:  { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true, retryOnFailure: true, maxToolRetries: 1, correctionStyle: 'gentle' },
  phi:      { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  gemma:    { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  granite:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  nemotron: { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  hermes3:  { supportsNativeTools: true,  needsPromptInjection: false, thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true },
  kimi:     { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true, retryOnFailure: true, maxToolRetries: 2, strictToolPrompt: true, correctionStyle: 'strict' },
  yi:       { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: false, jsonToolFormat: true, retryOnFailure: true, maxToolRetries: 1, correctionStyle: 'gentle' },
  default:  { supportsNativeTools: false, needsPromptInjection: true,  thinkingMode: 'auto',     xmlToolFormat: true,  jsonToolFormat: true, retryOnFailure: true, maxToolRetries: 1, correctionStyle: 'gentle' },
}

/** Resolve the family config for a detected model family string. */
function getFamilyConfig(family: string): ModelFamilyConfig {
  // Exact match first
  if (MODEL_FAMILY_CONFIGS[family]) return MODEL_FAMILY_CONFIGS[family]
  // Prefix match (e.g. 'qwen3-coder' matches 'qwen3')
  for (const key of Object.keys(MODEL_FAMILY_CONFIGS)) {
    if (key !== 'default' && family.startsWith(key)) return MODEL_FAMILY_CONFIGS[key]
  }
  return MODEL_FAMILY_CONFIGS.default
}

/** Strip thinking channel markers from model output. */
function stripThinkingMarkers(text: string): string {
  return text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '').replace(/<channel\|>/g, '')
}

// ---------------------------------------------------------------------------
// OllamaAdapter
// ---------------------------------------------------------------------------

export class OllamaAdapter implements LLMAdapter {
  readonly name = 'ollama'
  private readonly baseUrl: string
  private familyCache = new Map<string, string>()

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  /** Check if Ollama is running and reachable. */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      return res.ok
    } catch {
      return false
    }
  }

  /** List available models. */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`)
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`)
    const data = await res.json() as { models: Array<{ name: string }> }
    return data.models.map(m => m.name)
  }

  /** Detect the model family via Ollama /api/show (cached). */
  async getModelFamily(model: string): Promise<string> {
    const cached = this.familyCache.get(model)
    if (cached !== undefined) return cached

    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      })

      if (!res.ok) {
        this.familyCache.set(model, 'unknown')
        return 'unknown'
      }

      const info = await res.json() as OllamaModelInfo
      const family = info.details?.family?.toLowerCase() ?? 'unknown'
      this.familyCache.set(model, family)
      return family
    } catch {
      this.familyCache.set(model, 'unknown')
      return 'unknown'
    }
  }

  /** Check if a specific model supports native tool calling. */
  async supportsTools(model: string): Promise<boolean> {
    const family = await this.getModelFamily(model)
    return getFamilyConfig(family).supportsNativeTools
  }

  /** Get model-specific behavior profile for retry/repair decisions. */
  async getModelProfile(model: string): Promise<import('../core/types.js').ModelProfile> {
    const family = await this.getModelFamily(model)
    const config = getFamilyConfig(family)
    return {
      retryOnFailure: config.retryOnFailure ?? false,
      maxToolRetries: config.maxToolRetries ?? 0,
      attemptRepair: config.retryOnFailure ?? false,
      correctionStyle: config.correctionStyle ?? 'gentle',
      strictToolPrompt: config.strictToolPrompt ?? false,
    }
  }

  // -----------------------------------------------------------------------
  // LLMAdapter.chat
  // -----------------------------------------------------------------------

  async chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse> {
    const hasTools = options.tools && options.tools.length > 0
    const family = await this.getModelFamily(options.model)
    const config = getFamilyConfig(family)
    const supportsNativeTools = hasTools ? config.supportsNativeTools : false
    const needsInjection = hasTools ? (!supportsNativeTools || config.needsPromptInjection) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, needsInjection ? options.tools : undefined, { strict: config.strictToolPrompt }),
      stream: false,
      options: {
        num_ctx: contextLength,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
      },
    }

    if (supportsNativeTools && options.tools) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    // Thinking mode: user override > model family default
    if (options.thinkingEnabled === false) {
      body.think = false
    } else if (options.thinkingEnabled === true) {
      body.think = true
    } else if (config.thinkingMode === 'disabled') {
      body.think = false
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      throw new Error(`Ollama request failed: ${msg} (model=${options.model}, num_ctx=${contextLength})`)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama API error (${res.status}): ${text.slice(0, 300)}`)
    }

    const data = await res.json() as OllamaChatResponse

    // Strip thinking channel markers from content
    const rawContent = stripThinkingMarkers(data.message.content || '')

    // Three-stage tool resolution waterfall (runs for ALL models)
    // Uses unified parser from shared/tool-parsing.ts
    const nativeToolCalls: NativeToolCall[] | null = data.message.tool_calls ?? null
    const parseConfig: ToolParseConfig = {
      jsonToolFormat: config.jsonToolFormat,
      xmlToolFormat: config.xmlToolFormat,
    }
    const content: ContentBlock[] = resolveToolCalls(
      nativeToolCalls,
      rawContent,
      parseConfig,
      hasTools ?? false,
    )

    const usage: TokenUsage = {
      input_tokens: data.prompt_eval_count ?? 0,
      output_tokens: data.eval_count ?? 0,
    }

    const hasToolUse = content.some(b => b.type === 'tool_use')

    return {
      id: `ollama_${Date.now()}`,
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
    const hasTools = options.tools && options.tools.length > 0
    const family = await this.getModelFamily(options.model)
    const config = getFamilyConfig(family)
    const supportsNativeTools = hasTools ? config.supportsNativeTools : false
    const needsInjection = hasTools ? (!supportsNativeTools || config.needsPromptInjection) : false

    const contextLength = getDefaultContextLength(options.model)

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.convertMessages(messages, options.systemPrompt, needsInjection ? options.tools : undefined, { strict: config.strictToolPrompt }),
      stream: true,
      options: {
        num_ctx: contextLength,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens !== undefined ? { num_predict: options.maxTokens } : {}),
      },
    }

    if (supportsNativeTools && options.tools) {
      body.tools = options.tools.map(t => this.convertToolDef(t))
    }

    // Thinking mode: user override > model family default
    if (options.thinkingEnabled === false) {
      body.think = false
    } else if (options.thinkingEnabled === true) {
      body.think = true
    } else if (config.thinkingMode === 'disabled') {
      body.think = false
    }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.abortSignal,
      })
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
      yield { type: 'error', data: new Error(`Ollama request failed: ${msg} (model=${options.model}, num_ctx=${contextLength})`) }
      return
    }

    if (!res.ok) {
      const text = await res.text()
      yield { type: 'error', data: new Error(`Ollama API error (${res.status}): ${text.slice(0, 300)}`) }
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      yield { type: 'error', data: new Error('No response body from Ollama') }
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let model = options.model
    let nativeToolCallsEmitted = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          let chunk: OllamaChatResponse
          try {
            chunk = JSON.parse(line)
          } catch {
            continue
          }

          model = chunk.model

          if (chunk.message?.content) {
            // Strip thinking channel markers from streamed content
            const cleaned = stripThinkingMarkers(chunk.message.content)
            if (cleaned) {
              fullText += cleaned
              yield { type: 'text', data: cleaned }
            }
          }

          if (chunk.message?.tool_calls) {
            nativeToolCallsEmitted = true
            for (const tc of chunk.message.tool_calls) {
              yield {
                type: 'tool_use',
                data: {
                  type: 'tool_use',
                  id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  name: tc.function.name,
                  input: tc.function.arguments,
                },
              }
            }
          }

          if (chunk.done) {
            totalInputTokens = chunk.prompt_eval_count ?? 0
            totalOutputTokens = chunk.eval_count ?? 0
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Fallback: three-stage waterfall for text-based tool calls if no native calls were emitted
    // Uses unified parser from shared/tool-parsing.ts
    if (hasTools && fullText && !nativeToolCallsEmitted) {
      const parseConfig: ToolParseConfig = {
        jsonToolFormat: config.jsonToolFormat,
        xmlToolFormat: config.xmlToolFormat,
      }
      const resolved = resolveToolCalls(null, fullText, parseConfig, true)
      const toolBlocks = resolved.filter(b => b.type === 'tool_use')
      if (toolBlocks.length > 0) {
        for (const block of toolBlocks) {
          yield { type: 'tool_use', data: block }
        }
      }

      // Leakage detection: if no tool_use blocks extracted but text smells like
      // leaked tool call format, yield a leakage event so agent-runner can retry
      if (toolBlocks.length === 0 && detectToolCallLeakage(fullText)) {
        yield { type: 'tool_use', data: {
          type: 'tool_use',
          id: `leakage_${Date.now()}`,
          name: '__tool_call_leakage__',
          input: { rawText: fullText },
        } }
      }
    }

    const finalContent: ContentBlock[] = fullText
      ? [{ type: 'text', text: fullText }]
      : []

    const response: LLMResponse = {
      id: `ollama_${Date.now()}`,
      content: finalContent,
      model,
      stop_reason: 'end_turn',
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    }

    yield { type: 'done', data: response }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private convertMessages(
    messages: LLMMessage[],
    systemPrompt?: string,
    fallbackTools?: readonly LLMToolDef[],
    options?: { strict?: boolean },
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = []

    // System prompt
    let sysContent = systemPrompt || ''
    if (fallbackTools && fallbackTools.length > 0) {
      sysContent += buildToolPromptSuffix(fallbackTools, { strict: options?.strict })
    }
    if (sysContent) {
      result.push({ role: 'system', content: sysContent })
    }

    // Conversation messages
    for (const msg of messages) {
      if (msg.role === 'user') {
        const textParts: string[] = []
        const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = []
        const images: string[] = []

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text)
          } else if (block.type === 'tool_result') {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
            })
          } else if (block.type === 'image') {
            images.push(block.source.data)
          }
        }

        if (toolResults.length > 0) {
          // Ollama expects tool results as separate messages with role 'tool'
          for (const tr of toolResults) {
            result.push({ role: 'tool', content: tr.content })
          }
        } else {
          const userMsg: Record<string, unknown> = { role: 'user', content: textParts.join('\n') }
          if (images.length > 0) userMsg.images = images
          result.push(userMsg)
        }
      } else if (msg.role === 'assistant') {
        const text = msg.content
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')

        const toolCalls = msg.content
          .filter((b): b is ToolUseBlock => b.type === 'tool_use')
          .map(b => ({
            function: { name: b.name, arguments: b.input },
          }))

        const assistantMsg: Record<string, unknown> = {
          role: 'assistant',
          content: text,
        }
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls
        }
        result.push(assistantMsg)
      }
    }

    return result
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

  // Uses shared buildToolPromptSuffix from shared/tool-parsing.ts
}
