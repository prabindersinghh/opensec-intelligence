/**
 * ModelWatcher — periodically polls Ollama for new models and updates the registry.
 *
 * Lightweight: only hits /api/tags each interval. Full /api/show probes are only
 * performed for newly discovered models not yet in the registry.
 */

import {
  getRegisteredModelNames,
  registerModel,
  familySupportsTools,
  inferTier,
} from './model-registry.js'

export type ModelAddedCallback = (name: string) => void

export class ModelWatcher {
  private intervalId: ReturnType<typeof setInterval> | undefined
  private readonly callbacks: ModelAddedCallback[] = []
  private running = false

  constructor(
    private readonly ollamaUrl: string = 'http://localhost:11434',
    private readonly pollIntervalMs: number = 30_000,
  ) {}

  /** Register a callback fired when a new model is discovered. */
  onModelAdded(cb: ModelAddedCallback): void {
    this.callbacks.push(cb)
  }

  /** Start periodic polling. */
  start(): void {
    if (this.running) return
    this.running = true

    this.intervalId = setInterval(() => {
      void this.poll()
    }, this.pollIntervalMs)

    // Don't keep the process alive just for polling
    if (this.intervalId && typeof this.intervalId === 'object' && 'unref' in this.intervalId) {
      this.intervalId.unref()
    }
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
    this.running = false
  }

  /** Single poll iteration: check for new models. */
  private async poll(): Promise<void> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`)
      if (!res.ok) return

      const data = await res.json() as { models: Array<{ name: string }> }
      const knownNames = getRegisteredModelNames()

      for (const { name } of data.models) {
        if (knownNames.has(name)) continue

        // New model found — probe it
        await this.probeAndRegister(name)
      }
    } catch {
      // Ollama unreachable — silently skip
    }
  }

  /** Probe a single model via /api/show and register it. */
  private async probeAndRegister(name: string): Promise<void> {
    try {
      const res = await fetch(`${this.ollamaUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!res.ok) {
        registerModel({
          name,
          contextLength: 8192,
          supportsTools: false,
          parameterSize: 'unknown',
          recommended: 'midrange',
        })
      } else {
        const data = await res.json() as {
          details?: { family?: string; parameter_size?: string }
          model_info?: Record<string, unknown>
          parameters?: string
        }

        const family = data.details?.family?.toLowerCase() ?? ''
        const parameterSize = data.details?.parameter_size ?? 'unknown'

        let contextLength = 8192
        if (data.model_info) {
          for (const [key, value] of Object.entries(data.model_info)) {
            if (key.endsWith('context_length') && typeof value === 'number') {
              contextLength = value
              break
            }
          }
        }
        if (contextLength === 8192 && data.parameters) {
          const match = data.parameters.match(/num_ctx\s+(\d+)/)
          if (match) contextLength = parseInt(match[1], 10)
        }

        registerModel({
          name,
          contextLength,
          supportsTools: familySupportsTools(family),
          parameterSize,
          recommended: inferTier(parameterSize),
        })
      }

      for (const cb of this.callbacks) {
        try { cb(name) } catch { /* callback errors are non-fatal */ }
      }
    } catch {
      // Probe failed — register with conservative defaults
      registerModel({
        name,
        contextLength: 8192,
        supportsTools: false,
        parameterSize: 'unknown',
        recommended: 'midrange',
      })
      for (const cb of this.callbacks) {
        try { cb(name) } catch { /* callback errors are non-fatal */ }
      }
    }
  }
}
