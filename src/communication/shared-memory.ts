/**
 * SharedMemory — shared key-value store across agents in a team.
 *
 * Implements the MemoryStore interface from core/types.
 */

import type { MemoryEntry, MemoryStore } from '../core/types.js'

export class SharedMemory implements MemoryStore {
  private store = new Map<string, MemoryEntry>()

  async get(key: string): Promise<MemoryEntry | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
    this.store.set(key, {
      key,
      value,
      metadata: metadata ? Object.freeze({ ...metadata }) : undefined,
      createdAt: new Date(),
    })
  }

  async list(): Promise<MemoryEntry[]> {
    return Array.from(this.store.values())
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  /** Synchronous snapshot of all entries (for status display). */
  snapshot(): Map<string, MemoryEntry> {
    return new Map(this.store)
  }

  /** Total number of entries. */
  get size(): number {
    return this.store.size
  }
}
