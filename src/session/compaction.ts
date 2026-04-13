/**
 * Compaction — intelligent conversation history compaction.
 *
 * Multi-stage strategy:
 * 1. Truncate old tool results (no LLM call needed)
 * 2. Summarize old conversation via LLM
 * 3. Hard truncation as emergency fallback
 */

import type { LLMMessage, LLMAdapter, ContentBlock, TokenUsage } from '../core/types.js'
import { countMessageTokens, countTokens } from '../llm/token-counter.js'

export interface CompactionConfig {
  /** Model's context window size in tokens */
  maxContextTokens: number
  /** Trigger compaction at this fraction of max (default: 0.75) */
  compactionThreshold: number
  /** Always keep last N user+assistant pairs intact (default: 4) */
  preserveRecentTurns: number
  /** Max tokens for the summary message (default: 500) */
  summaryMaxTokens: number
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxContextTokens: 32768,
  compactionThreshold: 0.75,
  preserveRecentTurns: 4,
  summaryMaxTokens: 500,
}

/**
 * Check whether compaction should be triggered.
 */
export function shouldCompact(
  messages: LLMMessage[],
  tokenCount: number,
  config: CompactionConfig,
): boolean {
  return tokenCount > config.maxContextTokens * config.compactionThreshold
}

/**
 * Full compaction pipeline: truncate tool results → LLM summary → hard truncation.
 */
export async function compactHistory(
  messages: LLMMessage[],
  config: CompactionConfig,
  adapter: LLMAdapter,
  model: string,
): Promise<{ messages: LLMMessage[]; tokensSaved: number }> {
  const originalTokens = countMessageTokens(messages as any)

  // Determine the split point: keep the last `preserveRecentTurns * 2` messages
  const keepCount = config.preserveRecentTurns * 2
  if (messages.length <= keepCount) {
    return { messages, tokensSaved: 0 }
  }

  const oldMessages = messages.slice(0, messages.length - keepCount)
  const recentMessages = messages.slice(messages.length - keepCount)

  // ─── Stage 1: Truncate old tool results ───
  const truncatedOld = truncateToolResults(oldMessages)
  let result = [...truncatedOld, ...recentMessages]
  let currentTokens = countMessageTokens(result as any)

  if (currentTokens <= config.maxContextTokens * config.compactionThreshold) {
    return { messages: result, tokensSaved: originalTokens - currentTokens }
  }

  // ─── Stage 2: LLM-powered summary of old messages ───
  try {
    const summaryMessage = await summarizeMessages(truncatedOld, adapter, model, config.summaryMaxTokens)
    result = [summaryMessage, ...recentMessages]
    currentTokens = countMessageTokens(result as any)

    if (currentTokens <= config.maxContextTokens * config.compactionThreshold) {
      return { messages: result, tokensSaved: originalTokens - currentTokens }
    }
  } catch {
    // LLM summary failed — fall through to hard truncation
    // Use a simple text-based summary instead
    const fallbackSummary = buildFallbackSummary(truncatedOld)
    result = [fallbackSummary, ...recentMessages]
    currentTokens = countMessageTokens(result as any)
  }

  // ─── Stage 3: Hard truncation ───
  // Drop oldest messages (after summary) one at a time until under threshold
  while (result.length > 2 && currentTokens > config.maxContextTokens * config.compactionThreshold) {
    // Never drop the first message (summary) or the recent messages
    if (result.length <= keepCount + 1) {
      // Truncate the summary itself if needed
      const summaryBlock = result[0]
      if (summaryBlock.role === 'user' && summaryBlock.content[0]?.type === 'text') {
        const text = (summaryBlock.content[0] as any).text as string
        const halfLen = Math.floor(text.length / 2)
        result[0] = {
          role: 'user',
          content: [{ type: 'text', text: text.slice(0, halfLen) + '\n... (truncated)' }],
        }
      }
      break
    }
    result.splice(1, 1) // Remove second message (first after summary)
    currentTokens = countMessageTokens(result as any)
  }

  return { messages: result, tokensSaved: originalTokens - currentTokens }
}

/**
 * Stage 1: Truncate tool result contents in old messages.
 */
function truncateToolResults(messages: LLMMessage[]): LLMMessage[] {
  return messages.map(msg => {
    const newContent: ContentBlock[] = msg.content.map(block => {
      if (block.type === 'tool_result') {
        const content = block.content
        if (content.length > 500) {
          return {
            ...block,
            content: content.slice(0, 200) + `\n... (truncated, was ${content.length} chars)`,
          }
        }
      }
      return block
    })
    return { ...msg, content: newContent }
  })
}

/**
 * Stage 2: Use the LLM to create a concise summary of old messages.
 */
async function summarizeMessages(
  messages: LLMMessage[],
  adapter: LLMAdapter,
  model: string,
  maxTokens: number,
): Promise<LLMMessage> {
  // Build a text representation of the conversation to summarize
  const conversationText = messages.map(msg => {
    const textParts = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
    const toolParts = msg.content
      .filter(b => b.type === 'tool_use')
      .map(b => `[tool: ${(b as any).name}]`)
      .join(', ')
    const prefix = msg.role === 'user' ? 'User' : 'Assistant'
    let line = `${prefix}: ${textParts.slice(0, 300)}`
    if (toolParts) line += ` ${toolParts}`
    return line
  }).join('\n')

  const summaryPrompt: LLMMessage[] = [
    {
      role: 'user',
      content: [{
        type: 'text',
        text: `Summarize the following conversation between a user and a coding assistant.\nFocus on: what files were read/modified, what tasks were completed, what decisions were made, and what the current state of work is.\nBe concise. Output only the summary, no preamble.\n\n${conversationText}`,
      }],
    },
  ]

  const response = await adapter.chat(summaryPrompt, {
    model,
    maxTokens,
    temperature: 0.3,
  })

  const summaryText = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')

  return {
    role: 'user',
    content: [{
      type: 'text',
      text: `[Previous conversation summary]\n${summaryText}\n[End of summary — recent conversation follows]`,
    }],
    isCompactSummary: true,
    isCompactBoundary: true,
  }
}

/**
 * Fallback summary when LLM call fails — simple text extraction.
 */
function buildFallbackSummary(messages: LLMMessage[]): LLMMessage {
  const parts: string[] = ['[Previous conversation summary]']

  for (const msg of messages) {
    const text = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .slice(0, 200)
    if (text) {
      parts.push(`${msg.role}: ${text}${text.length >= 200 ? '...' : ''}`)
    }
    const tools = msg.content
      .filter(b => b.type === 'tool_use')
      .map(b => (b as any).name)
    if (tools.length > 0) {
      parts.push(`  [tools: ${tools.join(', ')}]`)
    }
  }

  parts.push('[End of summary — recent conversation follows]')

  return {
    role: 'user',
    content: [{ type: 'text', text: parts.join('\n') }],
    isCompactSummary: true,
    isCompactBoundary: true,
  }
}
