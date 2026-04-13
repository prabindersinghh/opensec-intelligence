/**
 * Model registry — known models and their capabilities.
 *
 * Seed data provides accurate defaults for well-known models.
 * Dynamic models discovered from Ollama are merged on top at runtime.
 */

export interface ModelInfo {
  name: string
  contextLength: number
  supportsTools: boolean
  parameterSize: string
  recommended: 'lightweight' | 'midrange' | 'heavy'
}

// ---------------------------------------------------------------------------
// Seed data — accurate context lengths + capabilities for popular models.
// Used as fallback when Ollama /api/show is unavailable.
// ---------------------------------------------------------------------------

const SEED_MODELS: ModelInfo[] = [
  // Qwen family
  { name: 'qwen2.5-coder:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'qwen2.5-coder:14b', contextLength: 32768, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen2.5-coder:32b', contextLength: 32768, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  { name: 'qwen3-coder:latest', contextLength: 65536, supportsTools: true, parameterSize: '30.5B', recommended: 'heavy' },
  { name: 'qwen2.5:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'qwen2.5:14b', contextLength: 32768, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen2.5:32b', contextLength: 32768, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  { name: 'qwen3:8b', contextLength: 40960, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'qwen3:14b', contextLength: 40960, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'qwen3:32b', contextLength: 40960, supportsTools: true, parameterSize: '32B', recommended: 'heavy' },
  // Llama family
  { name: 'llama3.1:8b', contextLength: 131072, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'llama3.1:70b', contextLength: 131072, supportsTools: true, parameterSize: '70B', recommended: 'heavy' },
  { name: 'llama3.2:3b', contextLength: 131072, supportsTools: true, parameterSize: '3B', recommended: 'lightweight' },
  { name: 'llama3.3:70b', contextLength: 131072, supportsTools: true, parameterSize: '70B', recommended: 'heavy' },
  { name: 'llama4:scout', contextLength: 131072, supportsTools: true, parameterSize: '109B', recommended: 'heavy' },
  // Mistral family
  { name: 'mistral:7b', contextLength: 32768, supportsTools: true, parameterSize: '7B', recommended: 'lightweight' },
  { name: 'mistral-nemo:12b', contextLength: 128000, supportsTools: true, parameterSize: '12B', recommended: 'midrange' },
  { name: 'mistral-small:24b', contextLength: 32768, supportsTools: true, parameterSize: '24B', recommended: 'midrange' },
  // Gemma family
  { name: 'gemma2:9b', contextLength: 8192, supportsTools: true, parameterSize: '9B', recommended: 'lightweight' },
  { name: 'gemma2:27b', contextLength: 8192, supportsTools: true, parameterSize: '27B', recommended: 'midrange' },
  { name: 'gemma3:12b', contextLength: 32768, supportsTools: true, parameterSize: '12B', recommended: 'midrange' },
  { name: 'gemma3:27b', contextLength: 32768, supportsTools: true, parameterSize: '27B', recommended: 'heavy' },
  { name: 'gemma4:12b', contextLength: 32768, supportsTools: true, parameterSize: '12B', recommended: 'midrange' },
  { name: 'gemma4:26b', contextLength: 262144, supportsTools: false, parameterSize: '25.8B', recommended: 'heavy' },
  { name: 'gemma4:27b', contextLength: 32768, supportsTools: true, parameterSize: '27B', recommended: 'heavy' },
  { name: 'gemma4:e4b', contextLength: 131072, supportsTools: false, parameterSize: '4B', recommended: 'lightweight' },
  { name: 'gemma4:e2b', contextLength: 131072, supportsTools: false, parameterSize: '2B', recommended: 'lightweight' },
  // Phi family
  { name: 'phi3:3.8b', contextLength: 4096, supportsTools: true, parameterSize: '3.8B', recommended: 'lightweight' },
  { name: 'phi3:14b', contextLength: 4096, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'phi4:14b', contextLength: 16384, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  { name: 'phi-3:latest', contextLength: 131072, supportsTools: true, parameterSize: '3.8B', recommended: 'lightweight' },
  { name: 'phi-4:latest', contextLength: 16384, supportsTools: true, parameterSize: '14B', recommended: 'midrange' },
  // DeepSeek family
  { name: 'deepseek-coder-v2:16b', contextLength: 131072, supportsTools: true, parameterSize: '16B', recommended: 'midrange' },
  { name: 'deepseek-coder:6.7b', contextLength: 16384, supportsTools: true, parameterSize: '6.7B', recommended: 'lightweight' },
  { name: 'deepseek-v3:latest', contextLength: 65536, supportsTools: true, parameterSize: '685B', recommended: 'heavy' },
  // Command-R family
  { name: 'command-r:latest', contextLength: 131072, supportsTools: true, parameterSize: '35B', recommended: 'heavy' },
  { name: 'command-r:35b', contextLength: 131072, supportsTools: true, parameterSize: '35B', recommended: 'heavy' },
  { name: 'command-r-plus:104b', contextLength: 131072, supportsTools: true, parameterSize: '104B', recommended: 'heavy' },
  // Others
  { name: 'codellama:34b', contextLength: 16384, supportsTools: false, parameterSize: '34B', recommended: 'heavy' },
  { name: 'dolphin3:latest', contextLength: 131072, supportsTools: false, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'granite3.1-dense:8b', contextLength: 131072, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'nemotron:70b', contextLength: 32768, supportsTools: true, parameterSize: '70B', recommended: 'heavy' },
  { name: 'hermes3:8b', contextLength: 131072, supportsTools: true, parameterSize: '8B', recommended: 'lightweight' },
  { name: 'yi:34b', contextLength: 4096, supportsTools: false, parameterSize: '34B', recommended: 'heavy' },
  // Cloud / proxy models
  { name: 'minimax-m2.5:cloud', contextLength: 1048576, supportsTools: true, parameterSize: 'cloud', recommended: 'heavy' },
  { name: 'minimax-m2.7:cloud', contextLength: 1048576, supportsTools: true, parameterSize: 'cloud', recommended: 'heavy' },
]

// ---------------------------------------------------------------------------
// Dynamic registry — mutable map populated from seed + Ollama discovery
// ---------------------------------------------------------------------------

const dynamicRegistry = new Map<string, ModelInfo>()

// Initialize with seed data
for (const model of SEED_MODELS) {
  dynamicRegistry.set(model.name, model)
}

/** Register or update a model in the dynamic registry. */
export function registerModel(info: ModelInfo): void {
  dynamicRegistry.set(info.name, info)
}

/** Remove a model from the dynamic registry. */
export function unregisterModel(name: string): void {
  dynamicRegistry.delete(name)
}

/** Get all models in the registry (seed + dynamically discovered). */
export function getAllModels(): ModelInfo[] {
  return [...dynamicRegistry.values()]
}

/** Get the set of model names currently in the registry. */
export function getRegisteredModelNames(): Set<string> {
  return new Set(dynamicRegistry.keys())
}

/**
 * Lookup model info — checks dynamic registry first (exact match),
 * then falls back to prefix matching against seed data.
 */
export function getModelInfo(name: string): ModelInfo | undefined {
  // Exact match in dynamic registry
  const exact = dynamicRegistry.get(name)
  if (exact) return exact

  // Prefix match (e.g. "qwen2.5-coder" matches "qwen2.5-coder:14b")
  for (const model of dynamicRegistry.values()) {
    if (name.startsWith(model.name.split(':')[0])) return model
  }
  return undefined
}

export function getDefaultContextLength(model: string): number {
  const info = getModelInfo(model)
  return info?.contextLength ?? 8192
}

// ---------------------------------------------------------------------------
// Families known to support native tool calling — used during discovery
// ---------------------------------------------------------------------------

export const TOOL_CAPABLE_FAMILIES = new Set([
  'qwen2', 'qwen2.5', 'qwen3', 'qwen3moe',
  'llama3.1', 'llama3.2', 'llama3.3', 'llama4',
  'mistral', 'mistral-nemo',
  'command-r', 'firefunction',
  'granite', 'nemotron', 'hermes3',
  'minimax',
  'gemma', 'gemma2', 'gemma3', 'gemma4',
  'phi3', 'phi4',
  'deepseek', 'deepseek-v3',
  'yi',
])

/** Infer whether a model family supports tools. */
export function familySupportsTools(family: string): boolean {
  const f = family.toLowerCase()
  if (TOOL_CAPABLE_FAMILIES.has(f)) return true
  // Fuzzy fallback for sub-families
  for (const known of TOOL_CAPABLE_FAMILIES) {
    if (f.includes(known) || known.includes(f)) return true
  }
  return false
}

/** Infer recommended tier from parameter size string. */
export function inferTier(parameterSize: string): 'lightweight' | 'midrange' | 'heavy' {
  const cleaned = parameterSize.toLowerCase().replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num) || parameterSize.toLowerCase().includes('cloud')) return 'heavy'
  if (num <= 9) return 'lightweight'
  if (num <= 30) return 'midrange'
  return 'heavy'
}

// ---------------------------------------------------------------------------
// Ollama model discovery
// ---------------------------------------------------------------------------

interface OllamaShowResponse {
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
  model_info?: Record<string, unknown>
  parameters?: string
}

/** Extract context length from an Ollama /api/show response. */
function extractContextLength(data: OllamaShowResponse): number {
  const modelInfo = data.model_info
  if (modelInfo) {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('context_length') && typeof value === 'number') {
        return value
      }
    }
  }
  const params = data.parameters
  if (params) {
    const match = params.match(/num_ctx\s+(\d+)/)
    if (match) return parseInt(match[1], 10)
  }
  return 8192
}

/**
 * Discover all models from Ollama and register them in the dynamic registry.
 * Returns the list of newly added model names.
 */
export async function discoverOllamaModels(
  ollamaUrl = 'http://localhost:11434',
): Promise<string[]> {
  const newModels: string[] = []

  try {
    const tagsRes = await fetch(`${ollamaUrl}/api/tags`)
    if (!tagsRes.ok) return newModels
    const tagsData = await tagsRes.json() as { models: Array<{ name: string }> }

    for (const { name } of tagsData.models) {
      // Skip if we already have an exact entry from seed data
      if (dynamicRegistry.has(name)) continue

      // Probe model details
      try {
        const showRes = await fetch(`${ollamaUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })

        if (!showRes.ok) {
          // Can't probe — register with conservative defaults
          registerModel({
            name,
            contextLength: 8192,
            supportsTools: false,
            parameterSize: 'unknown',
            recommended: 'midrange',
          })
          newModels.push(name)
          continue
        }

        const showData = await showRes.json() as OllamaShowResponse
        const family = showData.details?.family?.toLowerCase() ?? ''
        const parameterSize = showData.details?.parameter_size ?? 'unknown'
        const contextLength = extractContextLength(showData)
        const supportsTools = familySupportsTools(family)
        const recommended = inferTier(parameterSize)

        registerModel({ name, contextLength, supportsTools, parameterSize, recommended })
        newModels.push(name)
      } catch {
        // Individual model probe failed — register minimal entry
        registerModel({
          name,
          contextLength: 8192,
          supportsTools: false,
          parameterSize: 'unknown',
          recommended: 'midrange',
        })
        newModels.push(name)
      }
    }
  } catch {
    // Ollama unreachable — no-op
  }

  return newModels
}

/**
 * Query Ollama /api/show for the actual context length of a model.
 * Falls back to getDefaultContextLength if the query fails.
 */
export async function resolveContextLength(
  model: string,
  ollamaUrl = 'http://localhost:11434',
): Promise<number> {
  // If we know the model, trust our registry
  const info = getModelInfo(model)
  if (info) return info.contextLength

  // Query Ollama for unknown models
  try {
    const res = await fetch(`${ollamaUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
    })
    if (res.ok) {
      const data = await res.json() as OllamaShowResponse
      const contextLength = extractContextLength(data)

      // Auto-register discovered model
      const family = data.details?.family?.toLowerCase() ?? ''
      const parameterSize = data.details?.parameter_size ?? 'unknown'
      registerModel({
        name: model,
        contextLength,
        supportsTools: familySupportsTools(family),
        parameterSize,
        recommended: inferTier(parameterSize),
      })

      return contextLength
    }
  } catch {
    // Network error — fall through
  }

  return 8192
}

export function getRecommendedModel(tier: 'lightweight' | 'midrange' | 'heavy'): string {
  for (const model of dynamicRegistry.values()) {
    if (model.recommended === tier && model.name.includes('coder')) return model.name
  }
  return 'qwen2.5-coder:14b'
}
