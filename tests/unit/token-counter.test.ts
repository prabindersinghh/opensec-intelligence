import { describe, it, expect } from 'vitest'
import { countTokens, countMessageTokens } from '../../src/llm/token-counter.js'

describe('countTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(countTokens('hello')).toBe(2) // ceil(5/4)
    expect(countTokens('abcd')).toBe(1) // ceil(4/4)
    expect(countTokens('a')).toBe(1) // ceil(1/4)
  })

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0)
  })

  it('handles long text', () => {
    const text = 'x'.repeat(1000)
    expect(countTokens(text)).toBe(250)
  })
})

describe('countMessageTokens', () => {
  it('counts string content messages', () => {
    const msgs = [
      { content: 'hello' },     // 2 tokens
      { content: 'world!!!' },  // 2 tokens
    ]
    expect(countMessageTokens(msgs)).toBe(4)
  })

  it('counts array content with text blocks', () => {
    const msgs = [
      { content: [{ type: 'text', text: 'hello there friend' }] }, // ceil(18/4) = 5
    ]
    expect(countMessageTokens(msgs)).toBe(5)
  })

  it('counts array content with content blocks', () => {
    const msgs = [
      { content: [{ content: 'test' }] }, // ceil(4/4) = 1
    ]
    expect(countMessageTokens(msgs)).toBe(1)
  })

  it('falls back to JSON.stringify for unknown blocks', () => {
    const msgs = [
      { content: [{ type: 'image', url: 'http://example.com/img.png' }] },
    ]
    const result = countMessageTokens(msgs)
    expect(result).toBeGreaterThan(0)
  })

  it('skips non-string and non-array content', () => {
    const msgs = [{ content: 42 }, { content: null }]
    expect(countMessageTokens(msgs)).toBe(0)
  })

  it('handles empty message array', () => {
    expect(countMessageTokens([])).toBe(0)
  })
})
