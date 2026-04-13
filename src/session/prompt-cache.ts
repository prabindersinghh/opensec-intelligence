/**
 * PromptCache — tracks static prompt prefix hashes to enable KV cache reuse.
 *
 * When the static prefix (system prompt, project instructions, skills) doesn't
 * change between turns, the LLM can reuse its KV cache for those tokens,
 * dramatically reducing input token processing time.
 *
 * Works with PromptBuilder's getStaticPrefix() to detect cache hits/misses.
 */

import { createHash } from 'node:crypto'

export interface CacheStats {
  hits: number
  misses: number
  estimatedTokensSaved: number
  lastPrefixHash: string | null
}

export class PromptCache {
  private lastPrefixHash: string | null = null
  private hits = 0
  private misses = 0
  private estimatedTokensSaved = 0

  /**
   * Check whether the static prefix has changed since last turn.
   * Returns true if prefix is unchanged (cache hit).
   */
  checkPrefix(staticPrefix: string): boolean {
    const hash = createHash('sha256').update(staticPrefix).digest('hex').slice(0, 16)

    if (this.lastPrefixHash === hash) {
      this.hits++
      // Rough estimate: ~4 chars per token for English text
      this.estimatedTokensSaved += Math.ceil(staticPrefix.length / 4)
      return true
    }

    this.misses++
    this.lastPrefixHash = hash
    return false
  }

  /** Reset tracking (e.g. on model switch). */
  reset(): void {
    this.lastPrefixHash = null
    this.hits = 0
    this.misses = 0
    this.estimatedTokensSaved = 0
  }

  /** Get cache statistics. */
  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      estimatedTokensSaved: this.estimatedTokensSaved,
      lastPrefixHash: this.lastPrefixHash,
    }
  }

  /** Hit rate as a percentage (0-100). */
  get hitRate(): number {
    const total = this.hits + this.misses
    return total === 0 ? 0 : Math.round((this.hits / total) * 100)
  }
}
