/**
 * Tool repair module — attempts to fix malformed tool calls before giving up.
 *
 * Strategies (applied in order):
 * A. Strip surrounding text, re-extract JSON
 * B. Fix common JSON issues (trailing commas, unquoted keys, partial brackets)
 * C. Fuzzy-match partial tool names to closest registered tool
 * D. Coerce argument types ("true" → true, "42" → 42) per Zod schema
 *
 * If any strategy produces a valid tool call, it's returned immediately.
 * If none succeed, null is returned → caller should retry or give up.
 */

import type { ZodSchema, ZodObject, ZodTypeAny } from 'zod'
import { validateToolCallShape, type ParsedToolCall } from '../validation/tool-call-schema.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RepairContext {
  /** Names of all registered tools. */
  readonly availableTools: readonly string[]
  /** Registered Zod input schemas, keyed by tool name. */
  readonly toolSchemas: ReadonlyMap<string, ZodSchema>
}

export interface RepairResult {
  readonly repaired: ParsedToolCall[]
  /** Human-readable description of what was fixed. */
  readonly fixes: string[]
}

/**
 * Attempt to repair a set of rejected tool calls.
 *
 * @param rawText    The full LLM output text that contained the failed tool calls.
 * @param rejected   The tool calls that failed validation, with error details.
 * @param context    Available tool names and schemas for fuzzy matching + type coercion.
 * @returns          Repaired tool calls, or null if repair failed entirely.
 */
export function attemptRepair(
  rawText: string,
  rejected: Array<{ name: string; arguments: Record<string, unknown>; error: string }>,
  context: RepairContext,
): RepairResult | null {
  const repaired: ParsedToolCall[] = []
  const fixes: string[] = []

  for (const call of rejected) {
    // Strategy C: Fuzzy-match tool name
    let toolName = call.name
    const nameFixed = fuzzyMatchToolName(toolName, context.availableTools)
    if (nameFixed && nameFixed !== toolName) {
      fixes.push(`Fixed tool name: "${toolName}" → "${nameFixed}"`)
      toolName = nameFixed
    }

    // Strategy D: Type coercion per Zod schema
    let args = { ...call.arguments }
    const schema = context.toolSchemas.get(toolName)
    if (schema) {
      const coerced = coerceArgumentTypes(args, schema)
      if (coerced.fixed) {
        args = coerced.args
        fixes.push(...coerced.fixes)
      }
    }

    // Validate after fixes
    const validation = validateToolCallShape({ name: toolName, arguments: args })
    if (validation.ok) {
      // Double-check input schema if available
      if (schema) {
        const result = schema.safeParse(args)
        if (result.success) {
          repaired.push({ name: toolName, arguments: result.data as Record<string, unknown> })
          continue
        }
      } else {
        repaired.push(validation.toolCall)
        continue
      }
    }
  }

  // Strategy A+B: Re-extract from raw text if per-call repair failed
  if (repaired.length < rejected.length && rawText) {
    const extracted = extractFromRawText(rawText, context)
    if (extracted.length > 0) {
      fixes.push(`Re-extracted ${extracted.length} tool call(s) from raw output`)
      for (const tc of extracted) {
        if (!repaired.some(r => r.name === tc.name)) {
          repaired.push(tc)
        }
      }
    }
  }

  return repaired.length > 0 ? { repaired, fixes } : null
}

// ---------------------------------------------------------------------------
// Strategy A: Re-extract JSON from raw text
// ---------------------------------------------------------------------------

function extractFromRawText(text: string, context: RepairContext): ParsedToolCall[] {
  const results: ParsedToolCall[] = []

  // Strip markdown code fences and try to find JSON objects
  const stripped = text
    .replace(/```(?:json|tool_call)?\s*\n?/g, '')
    .replace(/```/g, '')

  // Find all JSON-like objects in the text
  const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g
  let match: RegExpExecArray | null
  while ((match = jsonRegex.exec(stripped)) !== null) {
    const candidate = match[0]
    const parsed = tryParseAndRepairJson(candidate)
    if (parsed && parsed.name && typeof parsed.name === 'string') {
      const args = (parsed.arguments ?? parsed.args ?? parsed.params ?? parsed.input ?? {}) as Record<string, unknown>
      const toolName = fuzzyMatchToolName(parsed.name as string, context.availableTools) ?? parsed.name as string

      const validation = validateToolCallShape({ name: toolName, arguments: args })
      if (validation.ok) {
        results.push(validation.toolCall)
      }
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Strategy B: Fix common JSON issues
// ---------------------------------------------------------------------------

function tryParseAndRepairJson(text: string): Record<string, unknown> | null {
  // Try direct parse first
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) return parsed
  } catch {
    // Fall through to repairs
  }

  let repaired = text

  // Fix trailing commas: { "a": 1, }
  repaired = repaired.replace(/,\s*([}\]])/g, '$1')

  // Fix unquoted keys: { name: "value" } → { "name": "value" }
  repaired = repaired.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')

  // Fix single-quoted strings: { 'name': 'value' } → { "name": "value" }
  repaired = repaired.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')

  // Fix missing closing bracket
  const openBraces = (repaired.match(/\{/g) || []).length
  const closeBraces = (repaired.match(/\}/g) || []).length
  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces)
  }

  // Fix missing closing square bracket in arrays
  const openBrackets = (repaired.match(/\[/g) || []).length
  const closeBrackets = (repaired.match(/\]/g) || []).length
  if (openBrackets > closeBrackets) {
    // Insert before last }
    const lastBrace = repaired.lastIndexOf('}')
    if (lastBrace > 0) {
      repaired = repaired.slice(0, lastBrace) + ']'.repeat(openBrackets - closeBrackets) + repaired.slice(lastBrace)
    }
  }

  try {
    const parsed = JSON.parse(repaired)
    if (typeof parsed === 'object' && parsed !== null) return parsed
  } catch {
    // Could not repair
  }

  return null
}

// ---------------------------------------------------------------------------
// Strategy C: Fuzzy tool name matching
// ---------------------------------------------------------------------------

/**
 * Find the closest registered tool name for a possibly misspelled/partial name.
 * Uses: exact match → case-insensitive → prefix match → Levenshtein distance.
 */
function fuzzyMatchToolName(name: string, available: readonly string[]): string | null {
  if (!name || available.length === 0) return null

  // Exact match
  if (available.includes(name)) return name

  // Case-insensitive match
  const lower = name.toLowerCase()
  const ciMatch = available.find(t => t.toLowerCase() === lower)
  if (ciMatch) return ciMatch

  // Prefix match (e.g., "file_wr" → "file_write")
  const prefixMatches = available.filter(t => t.toLowerCase().startsWith(lower))
  if (prefixMatches.length === 1) return prefixMatches[0]

  // Contains match (e.g., "write" → "file_write")
  const containsMatches = available.filter(t => t.toLowerCase().includes(lower))
  if (containsMatches.length === 1) return containsMatches[0]

  // Levenshtein distance (max distance 3 to avoid wild matches)
  let bestMatch: string | null = null
  let bestDist = 4
  for (const tool of available) {
    const dist = levenshtein(lower, tool.toLowerCase())
    if (dist < bestDist) {
      bestDist = dist
      bestMatch = tool
    }
  }

  return bestMatch
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Use single-row optimization for memory efficiency
  const row = Array.from({ length: n + 1 }, (_, i) => i)

  for (let i = 1; i <= m; i++) {
    let prev = i - 1
    row[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const val = Math.min(
        row[j] + 1,        // deletion
        row[j - 1] + 1,    // insertion
        prev + cost,        // substitution
      )
      prev = row[j]
      row[j] = val
    }
  }

  return row[n]
}

// ---------------------------------------------------------------------------
// Strategy D: Type coercion
// ---------------------------------------------------------------------------

interface CoercionResult {
  args: Record<string, unknown>
  fixed: boolean
  fixes: string[]
}

/**
 * Coerce argument types to match the tool's Zod schema.
 * Handles: string "true" → boolean, "42" → number, "null" → null.
 */
function coerceArgumentTypes(
  args: Record<string, unknown>,
  schema: ZodSchema,
): CoercionResult {
  const result: Record<string, unknown> = { ...args }
  const fixes: string[] = []
  let fixed = false

  // Extract shape from ZodObject if possible
  const shape = getZodObjectShape(schema)
  if (!shape) return { args, fixed: false, fixes }

  for (const [key, value] of Object.entries(args)) {
    const fieldSchema = shape[key]
    if (!fieldSchema) continue

    const expectedType = getZodBaseType(fieldSchema)
    if (!expectedType) continue

    // String → boolean coercion
    if (expectedType === 'boolean' && typeof value === 'string') {
      const lower = value.toLowerCase()
      if (lower === 'true' || lower === 'yes' || lower === '1') {
        result[key] = true
        fixes.push(`Coerced "${key}": "${value}" → true`)
        fixed = true
      } else if (lower === 'false' || lower === 'no' || lower === '0') {
        result[key] = false
        fixes.push(`Coerced "${key}": "${value}" → false`)
        fixed = true
      }
    }

    // String → number coercion
    if (expectedType === 'number' && typeof value === 'string') {
      const num = Number(value)
      if (!isNaN(num) && value.trim() !== '') {
        result[key] = num
        fixes.push(`Coerced "${key}": "${value}" → ${num}`)
        fixed = true
      }
    }

    // String → null coercion
    if (expectedType === 'null' && typeof value === 'string') {
      if (value.toLowerCase() === 'null' || value === '') {
        result[key] = null
        fixes.push(`Coerced "${key}": "${value}" → null`)
        fixed = true
      }
    }

    // Array string → array coercion (e.g. "[1,2,3]" → [1,2,3])
    if (expectedType === 'array' && typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
          result[key] = parsed
          fixes.push(`Coerced "${key}": string → array`)
          fixed = true
        }
      } catch {
        // Not valid JSON array
      }
    }
  }

  return { args: result, fixed, fixes }
}

// ---------------------------------------------------------------------------
// Zod introspection helpers
// ---------------------------------------------------------------------------

function getZodObjectShape(schema: ZodSchema): Record<string, ZodTypeAny> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (schema as any)?._def
    if (def?.typeName === 'ZodObject') {
      return def.shape()
    }
    // Handle ZodEffects wrapping (e.g., .transform(), .refine())
    if (def?.typeName === 'ZodEffects' && def?.schema) {
      return getZodObjectShape(def.schema)
    }
  } catch {
    // Schema introspection failed
  }
  return null
}

function getZodBaseType(schema: ZodTypeAny): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const def = (schema as any)?._def
    const typeName: string | undefined = def?.typeName
    if (!typeName) return null

    switch (typeName) {
      case 'ZodString': return 'string'
      case 'ZodNumber': return 'number'
      case 'ZodBoolean': return 'boolean'
      case 'ZodNull': return 'null'
      case 'ZodArray': return 'array'
      case 'ZodOptional': return getZodBaseType(def.innerType)
      case 'ZodDefault': return getZodBaseType(def.innerType)
      case 'ZodNullable': return getZodBaseType(def.innerType)
      default: return null
    }
  } catch {
    return null
  }
}
