/**
 * SessionManager — append-only conversation history with token counting and compaction.
 *
 * Messages are never deleted. On compaction, old messages are flagged as
 * transcript-only and a compact summary is inserted as a boundary.
 */

import type { LLMMessage, LLMAdapter, SessionState, ProjectContext, TokenUsage } from '../core/types.js'
import { countMessageTokens } from '../llm/token-counter.js'
import {
  shouldCompact as checkCompact,
  compactHistory,
  DEFAULT_COMPACTION_CONFIG,
  type CompactionConfig,
} from './compaction.js'

const MAX_COMPACT_FAILURES = 3

export class SessionManager {
  private session: SessionState
  private compactionConfig: CompactionConfig
  private consecutiveCompactFailures = 0

  constructor(projectContext: ProjectContext, maxContextTokens = 32768) {
    this.session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      messages: [],
      tokenCount: 0,
      maxContextTokens,
      projectContext,
      createdAt: new Date(),
      lastActivity: new Date(),
    }
    this.compactionConfig = {
      ...DEFAULT_COMPACTION_CONFIG,
      maxContextTokens,
    }
  }

  get id(): string { return this.session.id }
  get tokenCount(): number { return this.session.tokenCount }
  get maxContextTokens(): number { return this.session.maxContextTokens }
  get projectContext(): ProjectContext { return this.session.projectContext }

  /** All messages including transcript-only (full history). */
  get messages(): LLMMessage[] { return this.session.messages }

  /** Messages that should be sent to the LLM API (excludes transcript-only and meta). */
  getApiMessages(): LLMMessage[] {
    return this.session.messages.filter(
      m => !m.isVisibleInTranscriptOnly && !m.isMeta,
    )
  }

  addMessage(message: LLMMessage): void {
    this.session.messages.push(message)
    this.session.tokenCount = countMessageTokens(this.getApiMessages() as any)
    this.session.lastActivity = new Date()
  }

  addMessages(messages: LLMMessage[]): void {
    for (const msg of messages) {
      this.session.messages.push(msg)
    }
    this.session.tokenCount = countMessageTokens(this.getApiMessages() as any)
    this.session.lastActivity = new Date()
  }

  shouldCompact(): boolean {
    if (this.consecutiveCompactFailures >= MAX_COMPACT_FAILURES) {
      return false // Circuit breaker: stop trying after repeated failures
    }
    return checkCompact(this.getApiMessages(), this.session.tokenCount, this.compactionConfig)
  }

  /**
   * Multi-stage compaction: truncate tool results → LLM summary → hard truncation.
   * Uses append-only pattern: old messages are flagged, not removed.
   */
  async compact(adapter: LLMAdapter, model: string): Promise<{ before: number; after: number; tokensSaved: number }> {
    const apiMessages = this.getApiMessages()
    const before = apiMessages.length
    const beforeTokens = this.session.tokenCount

    try {
      const result = await compactHistory(
        apiMessages,
        this.compactionConfig,
        adapter,
        model,
      )

      // Flag old API messages as transcript-only
      for (const msg of this.session.messages) {
        if (!msg.isVisibleInTranscriptOnly && !msg.isMeta) {
          // If this message isn't in the compacted result, flag it
          if (!result.messages.includes(msg)) {
            msg.isVisibleInTranscriptOnly = true
          }
        }
      }

      // Insert new messages from compaction (summary boundary etc.)
      for (const msg of result.messages) {
        if (msg.isCompactSummary || msg.isCompactBoundary) {
          // Find insertion point: after all existing messages
          this.session.messages.push(msg)
        }
      }

      this.session.tokenCount = countMessageTokens(this.getApiMessages() as any)
      this.consecutiveCompactFailures = 0

      return {
        before,
        after: this.getApiMessages().length,
        tokensSaved: beforeTokens - this.session.tokenCount,
      }
    } catch (err) {
      this.consecutiveCompactFailures++
      throw err
    }
  }

  clear(): void {
    this.session.messages = []
    this.session.tokenCount = 0
    this.consecutiveCompactFailures = 0
  }

  /**
   * Emergency compaction — keeps only last 4 exchanges + a short fallback summary.
   * Used when a context overflow error occurs and normal compaction is too slow.
   */
  emergencyCompact(): void {
    const apiMessages = this.getApiMessages()
    const keepCount = 8 // 4 user + 4 assistant
    if (apiMessages.length <= keepCount) return

    // Flag all but the last keepCount messages as transcript-only
    const cutoff = this.session.messages.length - keepCount
    for (let i = 0; i < this.session.messages.length; i++) {
      const msg = this.session.messages[i]
      if (i < cutoff && !msg.isVisibleInTranscriptOnly && !msg.isMeta) {
        msg.isVisibleInTranscriptOnly = true
      }
    }

    // Insert a boundary marker
    this.session.messages.splice(cutoff, 0, {
      role: 'user',
      content: [{ type: 'text', text: '[Emergency compaction: older context was dropped to fit within model context window]' }],
      isCompactBoundary: true,
    })

    this.session.tokenCount = countMessageTokens(this.getApiMessages() as any)
    this.consecutiveCompactFailures = 0
  }

  /** Reset token counters (e.g. when switching models). */
  resetTokenCounters(): void {
    this.session.tokenCount = countMessageTokens(this.getApiMessages() as any)
  }

  /** Update the max context tokens (e.g. after switching models). */
  updateContextLength(maxContextTokens: number): void {
    this.session.maxContextTokens = maxContextTokens
    this.compactionConfig = {
      ...this.compactionConfig,
      maxContextTokens,
    }
  }

  getTokenUsage(): TokenUsage {
    return {
      input_tokens: this.session.tokenCount,
      output_tokens: 0,
    }
  }

  getState(): SessionState {
    return { ...this.session }
  }

  addRelevantFile(file: string): void {
    if (!this.session.projectContext.relevantFiles.includes(file)) {
      this.session.projectContext.relevantFiles.push(file)
    }
  }

  /** Replace session messages with the agent's current history. */
  syncFromAgent(messages: LLMMessage[]): void {
    this.session.messages = [...messages]
    this.session.tokenCount = countMessageTokens(this.session.messages as any)
    this.session.lastActivity = new Date()
  }
}
