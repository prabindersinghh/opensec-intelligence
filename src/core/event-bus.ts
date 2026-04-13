/**
 * EventBus — typed pub/sub event system for cmdr lifecycle events.
 *
 * Provides a decoupled communication layer beyond plugin hooks.
 * Supports:
 *  - Typed event emission and subscription
 *  - One-time listeners
 *  - Wildcard subscriptions
 *  - Async handlers
 */

import type { LLMMessage, TokenUsage, ToolResult } from './types.js'

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

export interface CmdrEvents {
  // Session lifecycle
  'session:start': { sessionId: string }
  'session:end': { sessionId: string; messageCount: number; totalTokens: TokenUsage }
  'session:compact': { before: number; after: number; tokensSaved: number }

  // Turn lifecycle
  'turn:start': { turn: number; model: string }
  'turn:end': { turn: number; tokenUsage: TokenUsage; toolCallCount: number }

  // Tool lifecycle
  'tool:before': { name: string; input: Record<string, unknown> }
  'tool:after': { name: string; result: ToolResult; durationMs: number }
  'tool:error': { name: string; error: string }
  'tool:denied': { name: string; reason: string }
  'tool:leakage': { text: string }
  'tool:repaired': { fixes: string[]; count: number }
  'tool:retry': { attempt: number; reason: string; errors: string[] }

  // LLM lifecycle
  'llm:request': { model: string; messageCount: number }
  'llm:response': { model: string; usage: TokenUsage; stopReason: string }
  'llm:stream:text': { chunk: string }
  'llm:error': { model: string; error: string }

  // Memory lifecycle
  'memory:read': { scope: string }
  'memory:write': { scope: string; bytes: number }
  'memory:consolidate': { entriesBefore: number; entriesAfter: number }

  // Agent lifecycle
  'agent:start': { name: string; task: string }
  'agent:complete': { name: string; success: boolean; turns: number }
  'agent:error': { name: string; error: string }

  // User interaction
  'user:message': { text: string; tokenEstimate: number }
  'user:command': { command: string; args: string }
  'user:abort': {}
}

export type EventName = keyof CmdrEvents

type Listener<T> = (data: T) => void | Promise<void>

interface ListenerEntry<T = unknown> {
  handler: Listener<T>
  once: boolean
}

// ---------------------------------------------------------------------------
// EventBus implementation
// ---------------------------------------------------------------------------

export class EventBus {
  private listeners = new Map<string, ListenerEntry[]>()
  private wildcardListeners: ListenerEntry<{ event: string; data: unknown }>[] = []

  /** Subscribe to a specific event. Returns an unsubscribe function. */
  on<E extends EventName>(event: E, handler: Listener<CmdrEvents[E]>): () => void {
    return this.addListener(event, handler, false)
  }

  /** Subscribe to a specific event, auto-remove after first fire. */
  once<E extends EventName>(event: E, handler: Listener<CmdrEvents[E]>): () => void {
    return this.addListener(event, handler, true)
  }

  /** Subscribe to ALL events (wildcard). */
  onAny(handler: Listener<{ event: string; data: unknown }>): () => void {
    const entry: ListenerEntry<{ event: string; data: unknown }> = { handler, once: false }
    this.wildcardListeners.push(entry)
    return () => {
      const idx = this.wildcardListeners.indexOf(entry)
      if (idx !== -1) this.wildcardListeners.splice(idx, 1)
    }
  }

  /** Emit an event to all listeners. */
  async emit<E extends EventName>(event: E, data: CmdrEvents[E]): Promise<void> {
    // Specific listeners
    const entries = this.listeners.get(event)
    if (entries) {
      const toRemove: number[] = []
      for (let i = 0; i < entries.length; i++) {
        try {
          await entries[i].handler(data)
        } catch {
          // Don't let listener errors propagate
        }
        if (entries[i].once) toRemove.push(i)
      }
      // Remove one-time listeners in reverse order
      for (let i = toRemove.length - 1; i >= 0; i--) {
        entries.splice(toRemove[i], 1)
      }
    }

    // Wildcard listeners
    const wcToRemove: number[] = []
    for (let i = 0; i < this.wildcardListeners.length; i++) {
      try {
        await this.wildcardListeners[i].handler({ event, data })
      } catch {
        // Don't let listener errors propagate
      }
      if (this.wildcardListeners[i].once) wcToRemove.push(i)
    }
    for (let i = wcToRemove.length - 1; i >= 0; i--) {
      this.wildcardListeners.splice(wcToRemove[i], 1)
    }
  }

  /** Remove all listeners for a specific event. */
  off<E extends EventName>(event: E): void {
    this.listeners.delete(event)
  }

  /** Remove ALL listeners. */
  removeAll(): void {
    this.listeners.clear()
    this.wildcardListeners = []
  }

  /** Get count of listeners for an event. */
  listenerCount(event: EventName): number {
    return (this.listeners.get(event)?.length ?? 0)
  }

  private addListener<T>(event: string, handler: Listener<T>, once: boolean): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    const entry: ListenerEntry = { handler: handler as Listener<unknown>, once }
    this.listeners.get(event)!.push(entry)
    return () => {
      const entries = this.listeners.get(event)
      if (entries) {
        const idx = entries.indexOf(entry)
        if (idx !== -1) entries.splice(idx, 1)
      }
    }
  }
}

/** Singleton event bus for the cmdr process. */
export const globalEventBus = new EventBus()
