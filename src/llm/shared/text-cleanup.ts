/**
 * Pre-parse text cleanup — sanitizes raw LLM output before tool call parsing.
 *
 * Fixes common model artifacts that break JSON/XML parsing:
 * - Markdown code fence wrappers around JSON
 * - Thinking/reasoning tags (<think>, <thought>, etc.)
 * - Control characters
 * - Repeated newlines in JSON
 * - Incomplete/truncated brackets
 */

// ---------------------------------------------------------------------------
// Main cleanup function
// ---------------------------------------------------------------------------

/**
 * Clean raw LLM output text before passing it to tool call parsers.
 * This is a pure function that returns sanitized text — idempotent and safe.
 */
export function cleanLLMOutput(text: string): string {
  if (!text) return text

  let cleaned = text

  // 1. Strip thinking/reasoning tags and their content
  cleaned = stripThinkingTags(cleaned)

  // 2. Strip control characters (except newline, tab, carriage return)
  cleaned = stripControlChars(cleaned)

  // 3. Unwrap bare markdown JSON fences that wrap the entire response
  //    (but NOT tool_call fences — those are handled by the parser)
  cleaned = unwrapBareJsonFences(cleaned)

  // 4. Collapse excessive whitespace inside JSON-like structures
  cleaned = collapseJsonWhitespace(cleaned)

  return cleaned
}

// ---------------------------------------------------------------------------
// Individual cleanup strategies
// ---------------------------------------------------------------------------

/**
 * Strip thinking/reasoning tags and their content.
 * Models like Qwen3, DeepSeek emit <think>...</think> blocks.
 */
function stripThinkingTags(text: string): string {
  // <think>...</think>
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // <thought>...</thought>
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '')
  // <reasoning>...</reasoning>
  cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
  // <reflection>...</reflection>
  cleaned = cleaned.replace(/<reflection>[\s\S]*?<\/reflection>/gi, '')
  // Ollama-specific thinking channel markers
  cleaned = cleaned.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '')
  cleaned = cleaned.replace(/<channel\|>/g, '')
  return cleaned.trim()
}

/**
 * Strip control characters that break JSON parsing.
 * Preserves: \n (0x0A), \r (0x0D), \t (0x09)
 */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/**
 * Unwrap bare JSON code fences that wrap the entire response.
 *
 * Some models wrap their entire tool call in ```json ... ``` instead of
 * using the proper ```tool_call format. We unwrap these to expose the
 * raw JSON for the parser.
 *
 * Does NOT unwrap ```tool_call fences — those are handled by the parser.
 */
function unwrapBareJsonFences(text: string): string {
  const trimmed = text.trim()

  // Check if the entire response is a single ```json fence
  const jsonFenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/)
  if (jsonFenceMatch) {
    const inner = jsonFenceMatch[1].trim()
    // Only unwrap if the inner content looks like a tool call JSON
    if (isToolCallLike(inner)) {
      // Re-wrap as ```tool_call so the parser picks it up
      return '```tool_call\n' + inner + '\n```'
    }
  }

  return text
}

/**
 * Collapse excessive whitespace inside JSON structures.
 * Some models emit JSON with many blank lines between keys.
 */
function collapseJsonWhitespace(text: string): string {
  // Only apply inside ```tool_call blocks to avoid mangling prose
  return text.replace(/```tool_call\s*\n([\s\S]*?)\n```/g, (_match, inner: string) => {
    const collapsed = inner
      .split('\n')
      .map((line: string) => line.trimEnd())
      .filter((line: string, i: number, arr: string[]) => {
        // Remove blank lines between JSON lines, but keep at least one
        if (line === '' && i > 0 && arr[i - 1] === '') return false
        return true
      })
      .join('\n')
    return '```tool_call\n' + collapsed + '\n```'
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: does this text look like a tool call JSON object?
 */
function isToolCallLike(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return false

  // Check for tool call shape indicators
  return (
    (trimmed.includes('"name"') && trimmed.includes('"arguments"')) ||
    (trimmed.includes('"name"') && trimmed.includes('"args"')) ||
    (trimmed.includes('"function"') && trimmed.includes('"arguments"'))
  )
}
