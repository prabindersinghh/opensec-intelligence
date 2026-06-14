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

/**
 * Resolve the model to use: validates that `preferredModel` is installed and
 * falls back to the best available model if not.  Returns the resolved model
 * name and whether a fallback was applied.
 */
export async function resolveModel(
  preferredModel: string,
  baseUrl = DEFAULT_URL,
): Promise<{ model: string; fallback: boolean }> {
  try {
    const res = await fetch(`${(baseUrl ?? DEFAULT_URL).replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { model: preferredModel, fallback: false }
    const data = (await res.json()) as { models?: { name: string }[] }
    const names = (data.models ?? []).map((m) => m.name)
    const installed = names.some((n) => n === preferredModel || n.startsWith(preferredModel.split(':')[0] + ':'))
    if (installed) return { model: preferredModel, fallback: false }
    const best = PREFERRED_MODELS.find((p) => names.some((n) => n.startsWith(p.split(':')[0] + ':'))) ?? names[0]
    return best ? { model: best, fallback: true } : { model: preferredModel, fallback: false }
  } catch {
    return { model: preferredModel, fallback: false }
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
 * Repair a JSON string that contains unescaped control characters inside
 * string values (the most common LLM formatting mistake).
 */
function repairJson(s: string): string {
  let inString = false
  let escaped = false
  let out = ''
  for (const ch of s) {
    if (escaped) { out += ch; escaped = false; continue }
    if (ch === '\\') { escaped = true; out += ch; continue }
    if (ch === '"') { inString = !inString; out += ch; continue }
    if (inString) {
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
    }
    out += ch
  }
  return out
}

/**
 * Extract the first JSON object/array from a model response.
 * Models often wrap JSON in prose or ```json fences — this is forgiving.
 * Also repairs unescaped newlines/tabs that models embed in string values.
 */
export function extractJson<T = unknown>(text: string): T | null {
  // Strip code fences first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text

  // Find the outermost {...} or [...} span, tracking string context so
  // braces inside string values don't confuse the depth counter.
  const start = candidate.search(/[{[]/)
  if (start === -1) return null
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1)
        try {
          return JSON.parse(slice) as T
        } catch {
          try { return JSON.parse(repairJson(slice)) as T } catch { return null }
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
