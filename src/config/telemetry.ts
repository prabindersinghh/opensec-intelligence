/**
 * Telemetry — opt-in anonymous session telemetry.
 *
 * No data is sent unless the user explicitly enables it in ~/.cmdr/config.toml:
 *   [telemetry]
 *   enabled = true
 *
 * When enabled, session summaries are written to ~/.cmdr/telemetry/ as JSON
 * for the user's own analysis. No network calls are made.
 */

import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

export interface TelemetryEvent {
  readonly id: string
  readonly timestamp: string
  readonly sessionId: string
  readonly event: string
  readonly data: Record<string, unknown>
}

export class Telemetry {
  private enabled = false
  private readonly sessionId = randomUUID()
  private readonly dir = join(homedir(), '.cmdr', 'telemetry')

  /** Enable or disable telemetry. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Record a telemetry event to disk.
   * Only writes if telemetry is enabled. No data leaves the machine.
   */
  async record(event: string, data: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return

    const entry: TelemetryEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      event,
      data,
    }

    try {
      await mkdir(this.dir, { recursive: true })
      const filename = `${this.sessionId}.jsonl`
      const line = JSON.stringify(entry) + '\n'
      await writeFile(join(this.dir, filename), line, { flag: 'a' })
    } catch {
      // best-effort — never break the REPL for telemetry
    }
  }

  /**
   * Record a session summary at exit.
   */
  async recordSessionEnd(summary: {
    model: string
    turns: number
    totalTokens: number
    toolCalls: number
    durationSeconds: number
  }): Promise<void> {
    await this.record('session_end', summary)
  }
}
