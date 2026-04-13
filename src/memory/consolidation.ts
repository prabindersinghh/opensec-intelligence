/**
 * Memory Consolidation — the "auto-dream" system for cmdr.
 *
 * After a session ends, consolidation reviews the conversation to extract
 * learnings and update MEMORY.md files. This follows a 4-stage pipeline:
 *
 *  1. Orient  — Identify what the session was about (project, topic, scope)
 *  2. Gather  — Extract actionable learnings from the conversation
 *  3. Consolidate — Merge new learnings with existing memory, dedup
 *  4. Prune   — Remove stale or contradicted entries, enforce size budget
 *
 * Triggered automatically at session end or via /compact command.
 */

import type { LLMAdapter, LLMMessage, LLMChatOptions, TextBlock } from '../core/types.js'
import type { MemoryManager } from './memory-manager.js'

const GATHER_PROMPT = `You are a memory consolidation agent. Analyze this conversation and extract key learnings.

Focus on:
- Project conventions discovered (naming, structure, patterns)
- User preferences observed (style, tools, workflow)
- Technical decisions made and their rationale
- Bugs found and solutions applied
- Common patterns that should be remembered

Output a bulleted list of concise, actionable learnings. Each item should be self-contained.
Do NOT include conversation-specific details that won't be useful in future sessions.
Do NOT include transient information (file paths of temporary files, specific error messages that were fixed).

If there are no meaningful learnings to extract, output exactly: NO_LEARNINGS`

const CONSOLIDATE_PROMPT = `You are a memory manager. Given existing memory and new learnings, produce a consolidated MEMORY.md.

Rules:
- Merge duplicates: if a new learning matches an existing entry, keep the more specific/recent one
- Remove contradictions: if a new learning contradicts an old one, keep the new one
- Group by topic: use ## headers (preferences, conventions, patterns, decisions)
- Keep each entry as a concise bullet point
- Stay under {MAX_LINES} lines total
- Preserve date annotations where useful

Output the final consolidated markdown content. No preamble, just the content.`

const MAX_MEMORY_LINES = 150

interface ConsolidationResult {
  learningsFound: number
  memoryUpdated: boolean
  scope: 'project' | 'user'
}

export class MemoryConsolidator {
  constructor(
    private readonly memoryManager: MemoryManager,
    private readonly adapter: LLMAdapter,
    private readonly model: string,
  ) {}

  /**
   * Run the full consolidation pipeline on a completed session's messages.
   * Returns info about what was updated.
   */
  async consolidate(
    messages: LLMMessage[],
    scope: 'project' | 'user' = 'project',
  ): Promise<ConsolidationResult> {
    // Skip tiny sessions — not enough to learn from
    if (messages.length < 4) {
      return { learningsFound: 0, memoryUpdated: false, scope }
    }

    // Stage 1 & 2: Gather learnings from conversation
    const learnings = await this.gatherLearnings(messages)
    if (!learnings || learnings === 'NO_LEARNINGS') {
      return { learningsFound: 0, memoryUpdated: false, scope }
    }

    const learningsList = learnings.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'))
    if (learningsList.length === 0) {
      return { learningsFound: 0, memoryUpdated: false, scope }
    }

    // Stage 3 & 4: Consolidate with existing memory
    const existingMemory = await this.memoryManager.read(scope)
    const consolidated = await this.consolidateMemory(existingMemory, learnings)

    if (consolidated && consolidated.trim()) {
      await this.memoryManager.write(scope, consolidated)
    }

    return {
      learningsFound: learningsList.length,
      memoryUpdated: true,
      scope,
    }
  }

  /** Stage 2: Extract learnings from conversation messages. */
  private async gatherLearnings(messages: LLMMessage[]): Promise<string | null> {
    // Build a condensed transcript for the LLM
    const transcript = messages
      .filter(m => !m.isMeta && !m.isVisibleInTranscriptOnly)
      .map(m => {
        const texts = m.content
          .filter((b): b is TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('')
        return `[${m.role}]: ${texts.slice(0, 2000)}`
      })
      .join('\n\n')

    // Limit transcript size for the LLM call
    const truncated = transcript.length > 12_000
      ? transcript.slice(0, 6000) + '\n\n...(middle omitted)...\n\n' + transcript.slice(-6000)
      : transcript

    const chatMessages: LLMMessage[] = [
      { role: 'user', content: [{ type: 'text', text: `Here is the conversation to analyze:\n\n${truncated}` }] },
    ]

    const options: LLMChatOptions = {
      model: this.model,
      systemPrompt: GATHER_PROMPT,
      maxTokens: 1024,
      temperature: 0.3,
    }

    try {
      const response = await this.adapter.chat(chatMessages, options)
      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      return text.trim()
    } catch {
      return null
    }
  }

  /** Stage 3 & 4: Merge new learnings with existing memory. */
  private async consolidateMemory(existing: string, newLearnings: string): Promise<string | null> {
    const prompt = CONSOLIDATE_PROMPT.replace('{MAX_LINES}', String(MAX_MEMORY_LINES))

    const chatMessages: LLMMessage[] = [
      {
        role: 'user',
        content: [{
          type: 'text',
          text: `## Existing Memory\n\n${existing || '(empty — first session)'}\n\n## New Learnings\n\n${newLearnings}`,
        }],
      },
    ]

    const options: LLMChatOptions = {
      model: this.model,
      systemPrompt: prompt,
      maxTokens: 2048,
      temperature: 0.2,
    }

    try {
      const response = await this.adapter.chat(chatMessages, options)
      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')
      return text.trim()
    } catch {
      return null
    }
  }
}
