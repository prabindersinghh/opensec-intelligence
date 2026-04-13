/**
 * CostTracker — tracks token usage and estimates cost per session.
 *
 * Local models have no direct cost, but tracking usage helps
 * understand resource consumption and compare models.
 */

export interface CostEntry {
  readonly timestamp: Date
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly toolCalls: number
  readonly duration: number  // ms
}

export interface CostSummary {
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalTokens: number
  readonly totalToolCalls: number
  readonly totalDuration: number
  readonly turns: number
  readonly avgTokensPerTurn: number
  readonly model: string
}

export class CostTracker {
  private entries: CostEntry[] = []
  private sessionStart = Date.now()

  /** Record a turn's usage. */
  record(model: string, inputTokens: number, outputTokens: number, toolCalls: number): void {
    this.entries.push({
      timestamp: new Date(),
      model,
      inputTokens,
      outputTokens,
      toolCalls,
      duration: Date.now() - (this.entries.length > 0
        ? this.entries[this.entries.length - 1].timestamp.getTime()
        : this.sessionStart),
    })
  }

  /** Get a summary of all tracked usage. */
  getSummary(): CostSummary {
    let totalInput = 0
    let totalOutput = 0
    let totalToolCalls = 0
    let totalDuration = 0
    let model = 'unknown'

    for (const entry of this.entries) {
      totalInput += entry.inputTokens
      totalOutput += entry.outputTokens
      totalToolCalls += entry.toolCalls
      totalDuration += entry.duration
      model = entry.model
    }

    const totalTokens = totalInput + totalOutput
    const turns = this.entries.length

    return {
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens,
      totalToolCalls,
      totalDuration,
      turns,
      avgTokensPerTurn: turns > 0 ? Math.round(totalTokens / turns) : 0,
      model,
    }
  }

  /** Get all entries. */
  getEntries(): CostEntry[] {
    return [...this.entries]
  }

  /** Get session elapsed time in seconds. */
  getElapsedSeconds(): number {
    return Math.round((Date.now() - this.sessionStart) / 1000)
  }

  /** Format elapsed as human-readable. */
  formatElapsed(): string {
    const secs = this.getElapsedSeconds()
    if (secs < 60) return `${secs}s`
    const mins = Math.floor(secs / 60)
    const remainder = secs % 60
    if (mins < 60) return `${mins}m ${remainder}s`
    const hours = Math.floor(mins / 60)
    return `${hours}h ${mins % 60}m`
  }

  /** Reset all tracking. */
  reset(): void {
    this.entries = []
    this.sessionStart = Date.now()
  }
}
