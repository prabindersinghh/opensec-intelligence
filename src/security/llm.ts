/**
 * Minimal Ollama client for the security pipeline.
 *
 * Talks to /api/generate directly so the Analyst, Consensus, and Fixer stages
 * stay self-contained and degrade gracefully when Ollama is offline — the
 * Scanner never depends on this module.
 */

const DEFAULT_URL = 'http://localhost:11434'

/** Ordered preference list for model auto-selection. */
const PREFERRED_MODELS = [
  'qwen2.5-coder:14b',
  'qwen2.5-coder:7b',
  'deepseek-r1:14b',
  'deepseek-r1:7b',
  'llama3.2:3b',
  'llama3.1:8b',
  'llama3:8b',
]

export interface LlmConfig {
  baseUrl?: string
  model: string
}

export interface OllamaStatus {
  available: boolean
  model: string | null
}

/**
 * Check Ollama availability and pick the best available model.
 * Returns `{ available: false, model: null }` when Ollama is unreachable.
 */
export async function checkOllama(baseUrl = DEFAULT_URL): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { available: false, model: null }
    const data = (await res.json()) as { models?: { name: string }[] }
    const names = (data.models ?? []).map((m) => m.name)
    const model = PREFERRED_MODELS.find((p) => names.some((n) => n.startsWith(p))) ?? names[0] ?? null
    return { available: true, model }
  } catch {
    return { available: false, model: null }
  }
}

/** Backward-compat: returns true when Ollama is reachable. */
export async function ollamaAvailable(baseUrl = DEFAULT_URL): Promise<boolean> {
  return (await checkOllama(baseUrl)).available
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

/**
 * Generate and parse JSON with up to `retries` attempts (exponential backoff).
 * Returns null when all attempts fail or Ollama is unreachable.
 */
export async function generateJson<T = unknown>(
  config: LlmConfig,
  prompt: string,
  retries = 3,
): Promise<T | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const text = await generate(config, prompt)
      const parsed = extractJson<T>(text)
      if (parsed !== null) return parsed
    } catch {
      // swallow and retry
    }
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  return null
}
