import { describe, it, expect } from 'vitest'
import { shouldRetry, buildCorrectionMessages, DEFAULT_RETRY_POLICY, STRICT_RETRY_POLICY, MODERATE_RETRY_POLICY } from '../../src/llm/repair/retry-policy.js'

describe('shouldRetry', () => {
  it('returns false when max retries exhausted', () => {
    const result = shouldRetry(2, STRICT_RETRY_POLICY, 'validation')
    expect(result.shouldRetry).toBe(false)
    expect(result.reason).toContain('exhausted')
  })

  it('retries leakage errors', () => {
    const result = shouldRetry(0, STRICT_RETRY_POLICY, 'leakage')
    expect(result.shouldRetry).toBe(true)
    expect(result.reason).toContain('leaked')
  })

  it('retries validation errors with strict policy', () => {
    const result = shouldRetry(0, STRICT_RETRY_POLICY, 'validation')
    expect(result.shouldRetry).toBe(true)
  })

  it('retries unknown tool errors with strict policy', () => {
    const result = shouldRetry(0, STRICT_RETRY_POLICY, 'unknown_tool')
    expect(result.shouldRetry).toBe(true)
  })

  it('does not retry with default (0-retry) policy', () => {
    expect(shouldRetry(0, DEFAULT_RETRY_POLICY, 'validation').shouldRetry).toBe(false)
    expect(shouldRetry(0, DEFAULT_RETRY_POLICY, 'unknown_tool').shouldRetry).toBe(false)
  })

  it('moderate policy retries once then stops', () => {
    expect(shouldRetry(0, MODERATE_RETRY_POLICY, 'validation').shouldRetry).toBe(true)
    expect(shouldRetry(1, MODERATE_RETRY_POLICY, 'validation').shouldRetry).toBe(false)
  })
})

describe('buildCorrectionMessages', () => {
  it('builds leakage correction messages', () => {
    const msgs = buildCorrectionMessages(
      { errors: [], availableTools: ['grep'], attempt: 0, isLeakage: true },
      STRICT_RETRY_POLICY,
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].isMeta).toBe(true)
  })

  it('builds error-based correction messages for non-leakage', () => {
    const msgs = buildCorrectionMessages(
      {
        errors: [{ name: 'file_read', error: 'missing path' }],
        availableTools: ['file_read', 'grep'],
        attempt: 0,
        isLeakage: false,
      },
      STRICT_RETRY_POLICY,
    )
    expect(msgs.length).toBeGreaterThan(0)
    // Should contain error info and available tools
    const text = msgs.map(m => JSON.stringify(m.content)).join(' ')
    expect(text).toContain('file_read')
  })
})
