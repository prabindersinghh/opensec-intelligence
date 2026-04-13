/**
 * Tool call validation layer using Zod schemas.
 *
 * Mirrors Claude Code's approach: every tool call is validated through its
 * registered Zod schema before execution. Malformed calls are rejected
 * early with clear error messages to the model, enabling retry with
 * corrected format.
 */

import { z, type ZodSchema, type ZodError } from 'zod'
import type { LLMToolDef, ToolUseBlock } from '../../core/types.js'

// ---------------------------------------------------------------------------
// Canonical tool call schema — validates the SHAPE of any tool call
// ---------------------------------------------------------------------------

/**
 * Schema for a single parsed tool call object.
 * All parsed tool calls (from native API, JSON text, XML text) must conform to this.
 */
export const ToolCallSchema = z.object({
  name: z.string().min(1, 'Tool name must be a non-empty string'),
  arguments: z.record(z.unknown()).default({}),
})

export type ParsedToolCall = z.infer<typeof ToolCallSchema>

/**
 * Validate a raw parsed tool call against the canonical schema.
 * Returns a normalized tool call or validation errors.
 */
export function validateToolCallShape(raw: unknown): {
  ok: true
  toolCall: ParsedToolCall
} | {
  ok: false
  errors: string[]
} {
  const result = ToolCallSchema.safeParse(raw)
  if (result.success) {
    return { ok: true, toolCall: result.data }
  }
  return {
    ok: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  }
}

// ---------------------------------------------------------------------------
// Tool-specific input validation
// ---------------------------------------------------------------------------

/**
 * Validate a tool call's arguments against the tool's registered Zod input schema.
 * Returns { ok: true, parsed } or { ok: false, message } with a corrective hint.
 */
export function validateToolInput(
  toolName: string,
  args: Record<string, unknown>,
  inputSchema: ZodSchema,
): {
  ok: true
  parsed: unknown
} | {
  ok: false
  message: string
} {
  const result = inputSchema.safeParse(args)
  if (result.success) {
    return { ok: true, parsed: result.data }
  }
  return {
    ok: false,
    message: formatZodError(toolName, result.error),
  }
}

/**
 * Format a ZodError into a clear corrective message for the model.
 * The message tells the model exactly what was wrong and how to fix it.
 */
function formatZodError(toolName: string, error: ZodError): string {
  const issues = error.errors.map(e => {
    const path = e.path.length > 0 ? `"${e.path.join('.')}"` : 'root'
    return `  - ${path}: ${e.message}`
  }).join('\n')

  return (
    `Tool "${toolName}" received invalid arguments:\n${issues}\n` +
    `Please retry with corrected arguments matching the tool's input schema.`
  )
}

// ---------------------------------------------------------------------------
// Tool call batch validator
// ---------------------------------------------------------------------------

export interface ValidatedToolCall {
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
  readonly rawInput: Record<string, unknown>
}

export interface RejectedToolCall {
  readonly id: string
  readonly name: string
  readonly error: string
}

/**
 * Validate a batch of tool use blocks against registered tool definitions.
 * Separates valid tool calls from rejected ones with clear error messages.
 *
 * Mirrors Claude Code's flow: Zod input validation → tool-specific validateInput → execute
 */
export function validateToolCallBatch(
  toolUseBlocks: ToolUseBlock[],
  toolLookup: Map<string, { inputSchema: ZodSchema }>,
  availableToolNames: Set<string>,
): {
  valid: ValidatedToolCall[]
  rejected: RejectedToolCall[]
} {
  const valid: ValidatedToolCall[] = []
  const rejected: RejectedToolCall[] = []

  for (const block of toolUseBlocks) {
    // Check tool exists
    if (!availableToolNames.has(block.name)) {
      rejected.push({
        id: block.id,
        name: block.name,
        error: `Unknown tool "${block.name}". Available tools: ${[...availableToolNames].join(', ')}`,
      })
      continue
    }

    const toolDef = toolLookup.get(block.name)
    if (!toolDef) {
      rejected.push({
        id: block.id,
        name: block.name,
        error: `Tool "${block.name}" has no registered schema.`,
      })
      continue
    }

    // Validate input against schema
    const validation = validateToolInput(block.name, block.input, toolDef.inputSchema)
    if (!validation.ok) {
      rejected.push({
        id: block.id,
        name: block.name,
        error: validation.message,
      })
      continue
    }

    valid.push({
      id: block.id,
      name: block.name,
      input: validation.parsed as Record<string, unknown>,
      rawInput: block.input,
    })
  }

  return { valid, rejected }
}

// ---------------------------------------------------------------------------
// Leakage detection — detect when models leak tool format into text
// ---------------------------------------------------------------------------

/** Patterns that indicate a model is leaking tool call format into text output. */
const LEAKAGE_PATTERNS: RegExp[] = [
  // JSON tool_call format leaking
  /```tool_call[\s\S]*?```/,
  // XML function format leaking
  /<function=\w+>[\s\S]*?<\/function>/,
  // Invoke format leaking
  /<invoke\s+name="[^"]+">[\s\S]*?<\/invoke>/,
  // MiniMax wrapper leaking
  /<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/,
  // OpenAI function_call format leaking into text
  /"function_call"\s*:\s*\{/,
]

/**
 * Detect if text contains leaked tool call formatting.
 * When a model outputs tool call syntax in its text response instead of
 * through the proper tool calling mechanism, we detect it here so the
 * parser can try to extract valid tool calls from it.
 */
export function detectToolCallLeakage(text: string): boolean {
  return LEAKAGE_PATTERNS.some(p => p.test(text))
}

/**
 * Build a corrective system message to send back to the model
 * when tool call leakage is detected.
 */
export function buildLeakageCorrectionPrompt(): string {
  return (
    'Your previous response contained tool call formatting in the text output. ' +
    'Please use the proper tool calling mechanism instead of embedding tool calls in text. ' +
    'Use the tool_call format or the native tool use API to call tools.'
  )
}
