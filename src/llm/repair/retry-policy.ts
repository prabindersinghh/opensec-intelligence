/**
 * Retry policy — configures when and how to retry failed tool calls.
 *
 * Produces correction messages that tell the model exactly what went wrong
 * and how to fix it, enabling the repair-retry loop in agent-runner.
 */

import type { LLMMessage, ContentBlock, TextBlock } from '../../core/types.js'
import { buildLeakageCorrectionPrompt } from '../validation/tool-call-schema.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Maximum number of retry attempts for failed tool calls. 0 = no retry. */
  readonly maxRetries: number
  /** Whether to attempt structural repair before retrying. */
  readonly attemptRepair: boolean
  /** How aggressive the correction prompt should be. */
  readonly correctionStyle: 'gentle' | 'strict'
}

/** Default retry policy for unknown/reliable models. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 0,
  attemptRepair: false,
  correctionStyle: 'gentle',
}

/** Retry policy for models known to produce messy tool calls (Kimi, MiniMax, etc.). */
export const STRICT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  attemptRepair: true,
  correctionStyle: 'strict',
}

/** Retry policy for moderately reliable models. */
export const MODERATE_RETRY_POLICY: RetryPolicy = {
  maxRetries: 1,
  attemptRepair: true,
  correctionStyle: 'gentle',
}

// ---------------------------------------------------------------------------
// Retry decision
// ---------------------------------------------------------------------------

export interface RetryDecision {
  readonly shouldRetry: boolean
  readonly reason: string
}

/**
 * Determine whether to retry after a tool call failure.
 */
export function shouldRetry(
  attempt: number,
  policy: RetryPolicy,
  errorType: 'validation' | 'leakage' | 'unknown_tool',
): RetryDecision {
  if (attempt >= policy.maxRetries) {
    return { shouldRetry: false, reason: `Max retries (${policy.maxRetries}) exhausted` }
  }

  // Always retry leakage — model is trying to use tools but in the wrong format
  if (errorType === 'leakage') {
    return { shouldRetry: true, reason: 'Tool call leaked into text output' }
  }

  // Retry validation errors if policy allows
  if (errorType === 'validation' && policy.maxRetries > 0) {
    return { shouldRetry: true, reason: 'Tool call failed validation' }
  }

  // Retry unknown tools if policy allows (model may have misspelled)
  if (errorType === 'unknown_tool' && policy.maxRetries > 0) {
    return { shouldRetry: true, reason: 'Unknown tool name — may be misspelled' }
  }

  return { shouldRetry: false, reason: 'No retry policy for this error type' }
}

// ---------------------------------------------------------------------------
// Correction message builder
// ---------------------------------------------------------------------------

export interface CorrectionContext {
  /** The errors from the failed validation attempt. */
  readonly errors: Array<{ name: string; error: string }>
  /** Available tool names for reference. */
  readonly availableTools: readonly string[]
  /** Which attempt this is (0-indexed). */
  readonly attempt: number
  /** Whether leakage was detected (tool format in text output). */
  readonly isLeakage: boolean
}

/**
 * Build correction messages to inject into the conversation before retrying.
 * These tell the model exactly what went wrong and how to fix it.
 */
export function buildCorrectionMessages(
  ctx: CorrectionContext,
  policy: RetryPolicy,
): LLMMessage[] {
  const messages: LLMMessage[] = []

  if (ctx.isLeakage) {
    // Leakage: model outputted tool format in text instead of proper API
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: buildLeakageCorrectionPrompt() } as TextBlock],
      isMeta: true,
    })
    return messages
  }

  // Build error summary
  const errorLines = ctx.errors.map(e => `- Tool "${e.name}": ${e.error}`).join('\n')
  const toolList = ctx.availableTools.join(', ')

  const gentle = [
    `Your previous tool call(s) had issues:\n${errorLines}`,
    `Available tools: ${toolList}`,
    'Please retry with corrected tool calls.',
  ].join('\n\n')

  const strict = [
    `ERROR: Your tool call(s) failed validation. This is attempt ${ctx.attempt + 1}.`,
    `Issues:\n${errorLines}`,
    `You MUST use one of these exact tool names: ${toolList}`,
    'Respond with ONLY a valid tool call. Do not include explanatory text.',
    'Use the exact argument types specified in the tool schema.',
  ].join('\n\n')

  const text = policy.correctionStyle === 'strict' ? strict : gentle

  messages.push({
    role: 'user',
    content: [{ type: 'text', text } as TextBlock],
    isMeta: true,
  })

  return messages
}
