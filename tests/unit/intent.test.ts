import { describe, it, expect } from 'vitest'
import { classifyIntent, detectFrustration } from '../../src/core/intent.js'

describe('classifyIntent', () => {
  // ── Conversational ────────────────────────────────────────────────
  it('returns conversational for empty string', () => {
    expect(classifyIntent('')).toBe('conversational')
    expect(classifyIntent('   ')).toBe('conversational')
  })

  it('returns conversational for greetings', () => {
    const greetings = ['hi', 'hey', 'hello', 'yo', 'sup', 'thanks', 'thank you', 'ok', 'bye']
    for (const g of greetings) {
      expect(classifyIntent(g)).toBe('conversational')
    }
  })

  it('returns conversational for meta questions', () => {
    expect(classifyIntent('who are you')).toBe('conversational')
    expect(classifyIntent('what model are you')).toBe('conversational')
    expect(classifyIntent('what can you do')).toBe('conversational')
  })

  it('returns conversational for short messages without signals', () => {
    expect(classifyIntent('sure thing')).toBe('conversational')
    expect(classifyIntent('got it')).toBe('conversational')
  })

  // ── Actionable ────────────────────────────────────────────────────
  it('returns actionable for action verbs', () => {
    expect(classifyIntent('fix the bug in parser')).toBe('actionable')
    expect(classifyIntent('create a new file')).toBe('actionable')
    expect(classifyIntent('refactor the login module')).toBe('actionable')
    expect(classifyIntent('delete the old tests')).toBe('actionable')
    expect(classifyIntent('implement user auth')).toBe('actionable')
    expect(classifyIntent('run the test suite')).toBe('actionable')
    expect(classifyIntent('commit these changes')).toBe('actionable')
  })

  it('returns actionable for messages with file extensions (no explore signal)', () => {
    expect(classifyIntent('something wrong with server.ts probably')).toBe('actionable')
    expect(classifyIntent('the config.json has a typo I think')).toBe('actionable')
    expect(classifyIntent('index.html needs some love')).toBe('actionable')
  })

  it('returns actionable for long ambiguous messages', () => {
    const long = 'I have this weird problem with the application that I cannot figure out on my own'
    expect(classifyIntent(long)).toBe('actionable')
  })

  // ── Exploratory ───────────────────────────────────────────────────
  it('returns exploratory for exploration language', () => {
    expect(classifyIntent('what is this function doing')).toBe('exploratory')
    expect(classifyIntent('explain the auth flow')).toBe('exploratory')
    expect(classifyIntent('show me the config')).toBe('exploratory')
    expect(classifyIntent('where is the main entry point')).toBe('exploratory')
    expect(classifyIntent('how does the router work')).toBe('exploratory')
  })

  it('returns exploratory for medium messages without signals', () => {
    // 15-39 chars, no action/explore signals, no file ext
    expect(classifyIntent('the code looks good')).toBe('exploratory')
  })

  // ── Priority: action beats explore ────────────────────────────────
  it('action signals take priority over explore signals', () => {
    // "fix" is an action signal, even though "show me" is explore
    expect(classifyIntent('fix the bug, show me the output')).toBe('actionable')
  })
})

describe('detectFrustration', () => {
  it('detects frustration signals', () => {
    expect(detectFrustration('wtf is going on')).toBe(true)
    expect(detectFrustration('this sucks')).toBe(true)
    expect(detectFrustration('so frustrating')).toBe(true)
    expect(detectFrustration('damn it')).toBe(true)
  })

  it('returns false for normal messages', () => {
    expect(detectFrustration('please fix the bug')).toBe(false)
    expect(detectFrustration('hello')).toBe(false)
    expect(detectFrustration('can you help me')).toBe(false)
  })
})
