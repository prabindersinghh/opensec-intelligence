/**
 * Approximate token counter for context management.
 *
 * Uses a simple heuristic: ~4 characters per token for English text.
 * Good enough for context budget tracking; not for billing.
 */

const CHARS_PER_TOKEN = 4

export function countTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

export function countMessageTokens(messages: Array<{ content: unknown }>): number {
  let total = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content)
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (typeof block === 'object' && block !== null) {
          if ('text' in block && typeof block.text === 'string') {
            total += countTokens(block.text)
          } else if ('content' in block && typeof block.content === 'string') {
            total += countTokens(block.content)
          } else {
            total += countTokens(JSON.stringify(block))
          }
        }
      }
    }
  }
  return total
}
