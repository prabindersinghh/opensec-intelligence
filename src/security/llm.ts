/**
 * Minimal Ollama client for the security pipeline.
 *
 * Talks to /api/generate directly (per the pipeline spec) so the Analyst,
 * Consensus, and Fixer stages stay self-contained and degrade gracefully when
 * Ollama is offline — detection (Scanner) never depends on this.
 */

const DEFAULT_URL = 'http://localhost:11434'

export interface LlmConfig {
  baseUrl?: string
  model: string
}

/** Is an Ollama server reachable? */
export async function ollamaAvailable(baseUrl = DEFAULT_URL): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Single-shot completion via /api/generate. Returns the raw text. */
export async function generate(config: LlmConfig, prompt: string): Promise<string> {
  const baseUrl = (config.baseUrl ?? DEFAULT_URL).replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      options: { temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    throw new Error(`Ollama /api/generate failed: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { response?: string }
  return data.response ?? ''
}

/**
 * Extract the first JSON object/array from a model response.
 * Models often wrap JSON in prose or ```json fences — this is forgiving.
 */
export function extractJson<T = unknown>(text: string): T | null {
  // Strip code fences first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text

  // Find the outermost {...} or [...] span.
  const start = candidate.search(/[{[]/)
  if (start === -1) return null
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++
    else if (candidate[i] === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** Generate and parse JSON in one call; returns null on any failure. */
export async function generateJson<T = unknown>(
  config: LlmConfig,
  prompt: string,
): Promise<T | null> {
  try {
    const text = await generate(config, prompt)
    return extractJson<T>(text)
  } catch {
    return null
  }
}
