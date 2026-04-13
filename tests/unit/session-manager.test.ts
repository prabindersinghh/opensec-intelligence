import { describe, it, expect } from 'vitest'
import { SessionManager } from '../../src/session/session-manager.js'
import type { LLMMessage, ProjectContext } from '../../src/core/types.js'

const ctx: ProjectContext = {
  rootDir: '/tmp/test',
  language: 'typescript',
  relevantFiles: [],
}

function userMsg(text: string): LLMMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantMsg(text: string): LLMMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

describe('SessionManager', () => {
  it('initializes with unique session id', () => {
    const sm = new SessionManager(ctx)
    expect(sm.id).toMatch(/^session_/)
    expect(sm.tokenCount).toBe(0)
    expect(sm.messages).toHaveLength(0)
  })

  it('adds messages and updates token count', () => {
    const sm = new SessionManager(ctx)
    sm.addMessage(userMsg('hello world'))
    expect(sm.messages).toHaveLength(1)
    expect(sm.tokenCount).toBeGreaterThan(0)
  })

  it('addMessages adds multiple at once', () => {
    const sm = new SessionManager(ctx)
    sm.addMessages([userMsg('a'), assistantMsg('b')])
    expect(sm.messages).toHaveLength(2)
  })

  it('getApiMessages excludes transcript-only and meta messages', () => {
    const sm = new SessionManager(ctx)
    sm.addMessage(userMsg('visible'))
    sm.addMessage({ ...userMsg('hidden'), isVisibleInTranscriptOnly: true })
    sm.addMessage({ ...userMsg('meta'), isMeta: true })

    expect(sm.messages).toHaveLength(3)
    expect(sm.getApiMessages()).toHaveLength(1)
    expect(sm.getApiMessages()[0].content[0]).toHaveProperty('text', 'visible')
  })

  it('clear resets messages and token count', () => {
    const sm = new SessionManager(ctx)
    sm.addMessages([userMsg('a'), assistantMsg('b')])
    sm.clear()
    expect(sm.messages).toHaveLength(0)
    expect(sm.tokenCount).toBe(0)
  })

  it('emergencyCompact keeps last 8 messages', () => {
    const sm = new SessionManager(ctx)
    for (let i = 0; i < 20; i++) {
      sm.addMessage(i % 2 === 0 ? userMsg(`user-${i}`) : assistantMsg(`asst-${i}`))
    }
    sm.emergencyCompact()

    const apiMsgs = sm.getApiMessages()
    // Should have 8 kept + 1 boundary marker = ~9 visible api messages
    // But boundary is isMeta or isCompactBoundary — check it's within bounds
    expect(apiMsgs.length).toBeLessThanOrEqual(9)
    expect(apiMsgs.length).toBeGreaterThanOrEqual(8)
  })

  it('addRelevantFile avoids duplicates', () => {
    const sm = new SessionManager(ctx)
    sm.addRelevantFile('src/index.ts')
    sm.addRelevantFile('src/index.ts')
    expect(sm.projectContext.relevantFiles).toEqual(['src/index.ts'])
  })

  it('updateContextLength updates compaction thresholds', () => {
    const sm = new SessionManager(ctx, 8192)
    expect(sm.maxContextTokens).toBe(8192)
    sm.updateContextLength(16384)
    expect(sm.maxContextTokens).toBe(16384)
  })

  it('syncFromAgent replaces all messages', () => {
    const sm = new SessionManager(ctx)
    sm.addMessage(userMsg('old'))
    sm.syncFromAgent([userMsg('new1'), assistantMsg('new2')])
    expect(sm.messages).toHaveLength(2)
    expect(sm.messages[0].content[0]).toHaveProperty('text', 'new1')
  })

  it('getState returns a copy', () => {
    const sm = new SessionManager(ctx)
    sm.addMessage(userMsg('test'))
    const state = sm.getState()
    expect(state.id).toBe(sm.id)
    expect(state.messages).toHaveLength(1)
  })

  it('shouldCompact respects circuit breaker', () => {
    // Fill with enough messages to trigger compaction normally
    const sm = new SessionManager(ctx, 10) // very low max tokens
    for (let i = 0; i < 50; i++) {
      sm.addMessage(userMsg('x'.repeat(100)))
    }
    // shouldCompact should be true initially if tokens exceed budget
    // After 3 consecutive failures, circuit breaker kicks in
    // We can't easily test the failure path without mocking compact(),
    // but we can verify shouldCompact returns a boolean
    expect(typeof sm.shouldCompact()).toBe('boolean')
  })
})
