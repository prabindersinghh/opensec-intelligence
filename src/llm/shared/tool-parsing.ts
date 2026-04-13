/**
 * Unified tool call parser for all LLM adapters.
 *
 * Consolidates the tool parsing logic that was duplicated across
 * ollama.ts, openai.ts, and anthropic.ts into a single, well-tested module.
 *
 * Supports:
 * - Native API tool calls (Ollama, OpenAI, Anthropic)
 * - Text-based JSON format: ```tool_call\n{JSON}\n```
 * - XML function format: <function=name><parameter=key>value</parameter></function>
 * - Invoke format: <invoke name="..."><parameter name="...">value</parameter></invoke>
 * - MiniMax wrapper: <minimax:tool_call>...</minimax:tool_call>
 *
 * Each strategy runs in order and returns on first match (waterfall).
 */

import type { ContentBlock, TextBlock, ToolUseBlock } from '../../core/types.js'
import { validateToolCallShape, type ParsedToolCall } from '../validation/tool-call-schema.js'
import { cleanLLMOutput } from './text-cleanup.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolParseConfig {
  /** Enable JSON ```tool_call``` format parsing. Default: true */
  jsonToolFormat?: boolean
  /** Enable XML <function=name> format parsing. Default: true */
  xmlToolFormat?: boolean
  /** Enable <invoke> tag format parsing. Default: true */
  invokeFormat?: boolean
}

export interface NativeToolCall {
  function: {
    name: string
    arguments: Record<string, unknown> | string
  }
  id?: string
}

const DEFAULT_CONFIG: Required<ToolParseConfig> = {
  jsonToolFormat: true,
  xmlToolFormat: true,
  invokeFormat: true,
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _idCounter = 0

function generateToolId(): string {
  _idCounter++
  return `tool_${Date.now()}_${_idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

// ---------------------------------------------------------------------------
// Unified resolution: native → text waterfall
// ---------------------------------------------------------------------------

/**
 * Three-stage tool resolution waterfall.
 * This is the main entry point for all adapters.
 *
 * 1. Native tool_calls from API (highest confidence)
 * 2. Text-based JSON format
 * 3. Text-based XML format
 *
 * Returns an array of ContentBlocks (text + tool_use mixed).
 */
export function resolveToolCalls(
  nativeToolCalls: NativeToolCall[] | null | undefined,
  textContent: string,
  config?: ToolParseConfig,
  hasTools?: boolean,
): ContentBlock[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Stage 1: Native tool_calls from API response
  if (nativeToolCalls && nativeToolCalls.length > 0) {
    const content: ContentBlock[] = []
    if (textContent) {
      content.push({ type: 'text', text: textContent } as TextBlock)
    }
    for (const tc of nativeToolCalls) {
      const args = typeof tc.function.arguments === 'string'
        ? safeParseJson(tc.function.arguments)
        : tc.function.arguments

      const validation = validateToolCallShape({
        name: tc.function.name,
        arguments: args,
      })

      if (validation.ok) {
        content.push({
          type: 'tool_use',
          id: tc.id ?? generateToolId(),
          name: validation.toolCall.name,
          input: validation.toolCall.arguments,
        } as ToolUseBlock)
      }
    }
    return content
  }

  // Stage 0: Pre-parse cleanup for text-based parsing
  const cleanedText = hasTools && textContent ? cleanLLMOutput(textContent) : textContent

  // Stage 2+3: Parse text-based tool calls only if tools are available
  if (hasTools && cleanedText) {
    const parsed = parseTextToolCalls(cleanedText, cfg)
    if (parsed.length > 0) return parsed
  }

  // No tool calls — return as pure text (use original, uncleaned text for display)
  if (textContent) {
    return [{ type: 'text', text: textContent } as TextBlock]
  }
  return []
}

// ---------------------------------------------------------------------------
// Text-based tool call extraction (all strategies)
// ---------------------------------------------------------------------------

/**
 * Parse tool calls from text output using multiple strategies.
 * Returns ContentBlock[] with interleaved text and tool_use blocks.
 */
export function parseTextToolCalls(
  text: string,
  config?: ToolParseConfig,
): ContentBlock[] {
  const cfg = { ...DEFAULT_CONFIG, ...config }

  // Strategy 1: ```tool_call JSON format
  if (cfg.jsonToolFormat) {
    const result = parseJsonToolCalls(text)
    if (result.length > 0 && result.some(b => b.type === 'tool_use')) {
      return result
    }
  }

  // Strategy 2: <function=name> XML format
  if (cfg.xmlToolFormat) {
    const result = parseXmlFunctionCalls(text)
    if (result.length > 0 && result.some(b => b.type === 'tool_use')) {
      return result
    }
  }

  // Strategy 3: <invoke name="..."> format (MiniMax, etc.)
  if (cfg.invokeFormat) {
    const result = parseInvokeCalls(text)
    if (result.length > 0 && result.some(b => b.type === 'tool_use')) {
      return result
    }
  }

  // No tool calls found
  if (text) {
    return [{ type: 'text', text } as TextBlock]
  }
  return []
}

// ---------------------------------------------------------------------------
// Strategy 1: JSON ```tool_call``` format
// ---------------------------------------------------------------------------

function parseJsonToolCalls(text: string): ContentBlock[] {
  const content: ContentBlock[] = []
  const toolCallRegex = /```tool_call\s*\n([\s\S]*?)\n```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let foundToolCalls = false

  while ((match = toolCallRegex.exec(text)) !== null) {
    foundToolCalls = true

    // Add preceding text
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) content.push({ type: 'text', text: before } as TextBlock)
    }

    const blockContent = match[1].trim()
    const parsedObjects = parseMultipleJsonObjects(blockContent)

    if (parsedObjects.length > 0) {
      for (const parsed of parsedObjects) {
        const validation = validateToolCallShape(parsed)
        if (validation.ok) {
          content.push({
            type: 'tool_use',
            id: generateToolId(),
            name: validation.toolCall.name,
            input: validation.toolCall.arguments,
          } as ToolUseBlock)
        }
      }
    } else {
      // Could not parse — keep as text
      content.push({ type: 'text', text: match[0] } as TextBlock)
    }

    lastIndex = match.index + match[0].length
  }

  if (foundToolCalls && lastIndex < text.length) {
    const remainder = text.slice(lastIndex).trim()
    if (remainder) content.push({ type: 'text', text: remainder } as TextBlock)
  }

  return foundToolCalls ? content : []
}

// ---------------------------------------------------------------------------
// Strategy 2: XML <function=name> format
// ---------------------------------------------------------------------------

function parseXmlFunctionCalls(text: string): ContentBlock[] {
  const content: ContentBlock[] = []
  const xmlToolRegex = /<function=(\w+)>([\s\S]*?)<\/function>/g
  const paramRegex = /<parameter=(\w+)>([\s\S]*?)<\/parameter>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let foundToolCalls = false

  while ((match = xmlToolRegex.exec(text)) !== null) {
    foundToolCalls = true

    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) content.push({ type: 'text', text: before } as TextBlock)
    }

    const toolName = match[1]
    const paramsBlock = match[2]
    const input: Record<string, string> = {}

    let paramMatch: RegExpExecArray | null
    while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
      input[paramMatch[1]] = paramMatch[2].trim()
    }
    paramRegex.lastIndex = 0

    content.push({
      type: 'tool_use',
      id: generateToolId(),
      name: toolName,
      input,
    } as ToolUseBlock)

    lastIndex = match.index + match[0].length
  }

  if (foundToolCalls && lastIndex < text.length) {
    const remainder = text.slice(lastIndex).trim()
    if (remainder) content.push({ type: 'text', text: remainder } as TextBlock)
  }

  return foundToolCalls ? content : []
}

// ---------------------------------------------------------------------------
// Strategy 3: <invoke name="..."> format (MiniMax/Kimi style)
// ---------------------------------------------------------------------------

function parseInvokeCalls(text: string): ContentBlock[] {
  const content: ContentBlock[] = []
  const invokeRegex = /<invoke\s+name="([^"]+)">((?:.|\n)*?)<\/invoke>/g
  const invokeParamRegex = /<parameter\s+name="([^"]+)">((?:.|\n)*?)<\/parameter>/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let foundToolCalls = false

  while ((match = invokeRegex.exec(text)) !== null) {
    foundToolCalls = true

    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      // Strip wrapper tags like <minimax:tool_call>
      const cleaned = before.replace(/<\/?[\w:]+>/g, '').trim()
      if (cleaned) content.push({ type: 'text', text: cleaned } as TextBlock)
    }

    const toolName = match[1]
    const paramsBlock = match[2]
    const input: Record<string, string> = {}

    let paramMatch: RegExpExecArray | null
    while ((paramMatch = invokeParamRegex.exec(paramsBlock)) !== null) {
      input[paramMatch[1]] = paramMatch[2].trim()
    }
    invokeParamRegex.lastIndex = 0

    content.push({
      type: 'tool_use',
      id: generateToolId(),
      name: toolName,
      input,
    } as ToolUseBlock)

    lastIndex = match.index + match[0].length
  }

  if (foundToolCalls) {
    if (lastIndex < text.length) {
      const remainder = text.slice(lastIndex).replace(/<\/?[\w:]+>/g, '').trim()
      if (remainder) content.push({ type: 'text', text: remainder } as TextBlock)
    }
    return content
  }

  return []
}

// ---------------------------------------------------------------------------
// JSON parsing utilities
// ---------------------------------------------------------------------------

/**
 * Parse multiple JSON objects from a block that may contain:
 * - A single JSON object
 * - A JSON array
 * - One object per line
 * - Comma-separated objects
 */
export function parseMultipleJsonObjects(
  block: string,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const results: Array<{ name: string; arguments: Record<string, unknown> }> = []

  // Try 1: Single JSON object or array
  try {
    const parsed = JSON.parse(block)
    if (parsed && typeof parsed === 'object') {
      if (parsed.name && parsed.arguments) {
        results.push(parsed)
        return results
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item?.name && item?.arguments) results.push(item)
        }
        if (results.length > 0) return results
      }
    }
  } catch {
    // Not valid single JSON — try multi-line
  }

  // Try 2: One JSON object per line
  const lines = block.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed?.name && parsed?.arguments) {
        results.push(parsed)
      }
    } catch {
      // Try stripping trailing comma
      const noComma = trimmed.replace(/,\s*$/, '')
      try {
        const parsed = JSON.parse(noComma)
        if (parsed?.name && parsed?.arguments) {
          results.push(parsed)
        }
      } catch {
        // Skip unparseable
      }
    }
  }

  return results
}

/**
 * Safely parse a JSON string, returning an empty object on failure.
 */
function safeParseJson(str: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(str)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Tool prompt builder (for models without native tool support)
// ---------------------------------------------------------------------------

/**
 * Build the tool-call instruction suffix to inject into the system prompt
 * for models that don't support native tool calling.
 */
export function buildToolPromptSuffix(
  tools: readonly { name: string; description: string; inputSchema: Record<string, unknown> }[],
  options?: { strict?: boolean },
): string {
  const toolDescs = tools.map(t =>
    `- ${t.name}: ${t.description}\n  Input: ${JSON.stringify(t.inputSchema)}`
  ).join('\n')

  return `\n\nYou have access to the following tools. To use a tool, respond with a JSON block:

\`\`\`tool_call
{"name": "tool_name", "arguments": {"arg1": "value1"}}
\`\`\`

To call MULTIPLE tools, use one JSON object per line inside a single \`\`\`tool_call block:

\`\`\`tool_call
{"name": "tool1", "arguments": {"arg": "val"}}
{"name": "tool2", "arguments": {"arg": "val"}}
\`\`\`

Available tools:
${toolDescs}

IMPORTANT: Use ONLY the \`\`\`tool_call JSON format shown above. Do NOT use XML, <invoke>, <function>, or any other format for tool calls.
Always use tools when you need to interact with the filesystem or run commands.
After receiving a tool result, continue your analysis.${options?.strict ? `

CRITICAL: When calling tools, output ONLY the tool call format. Do not include explanatory text, reasoning, or commentary before or after tool calls. Tool calls must use the exact argument types specified in the schema (numbers as numbers, booleans as booleans, not strings).` : ''}`
}
