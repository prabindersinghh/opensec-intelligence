import { describe, it, expect } from 'vitest'
import { PromptBuilder, PROMPT_PRIORITIES, buildSystemPrompt } from '../../src/session/prompt-builder.js'
import type { ProjectContext } from '../../src/core/types.js'

describe('PromptBuilder', () => {
  it('assembles modules in priority order', () => {
    const builder = new PromptBuilder()
    builder.addModule({ id: 'b', content: 'SECOND', priority: 20, isStatic: false })
    builder.addModule({ id: 'a', content: 'FIRST', priority: 10, isStatic: true })
    builder.addModule({ id: 'c', content: 'THIRD', priority: 30, isStatic: false })

    const result = builder.build()
    const firstIdx = result.indexOf('FIRST')
    const secondIdx = result.indexOf('SECOND')
    const thirdIdx = result.indexOf('THIRD')
    expect(firstIdx).toBeLessThan(secondIdx)
    expect(secondIdx).toBeLessThan(thirdIdx)
  })

  it('skips empty modules', () => {
    const builder = new PromptBuilder()
    builder.addModule({ id: 'a', content: 'hello', priority: 10, isStatic: true })
    builder.addModule({ id: 'b', content: '', priority: 20, isStatic: false })
    builder.addModule({ id: 'c', content: 'world', priority: 30, isStatic: false })

    const result = builder.build()
    expect(result).toBe('hello\n\nworld')
  })

  it('updateModule changes content', () => {
    const builder = new PromptBuilder()
    builder.addModule({ id: 'x', content: 'old', priority: 10, isStatic: false })
    builder.updateModule('x', 'new')
    expect(builder.build()).toBe('new')
  })

  it('removeModule removes a module', () => {
    const builder = new PromptBuilder()
    builder.addModule({ id: 'a', content: 'keep', priority: 10, isStatic: true })
    builder.addModule({ id: 'b', content: 'remove', priority: 20, isStatic: false })
    builder.removeModule('b')
    expect(builder.build()).toBe('keep')
  })

  it('getStaticPrefix returns only static modules', () => {
    const builder = new PromptBuilder()
    builder.addModule({ id: 'static1', content: 'S1', priority: 10, isStatic: true })
    builder.addModule({ id: 'dynamic', content: 'D1', priority: 20, isStatic: false })
    builder.addModule({ id: 'static2', content: 'S2', priority: 30, isStatic: true })

    const prefix = builder.getStaticPrefix()
    expect(prefix).toContain('S1')
    expect(prefix).toContain('S2')
    expect(prefix).not.toContain('D1')
  })
})

describe('buildSystemPrompt', () => {
  it('includes base prompt', () => {
    const result = buildSystemPrompt({
      basePrompt: 'You are cmdr.',
      projectContext: { rootDir: '/tmp', language: 'ts', relevantFiles: [] },
      model: 'qwen',
    })
    expect(result).toContain('You are cmdr.')
  })

  it('includes project instructions when present', () => {
    const ctx: ProjectContext = {
      rootDir: '/tmp',
      language: 'ts',
      relevantFiles: [],
      cmdrInstructions: 'Always use TypeScript.',
    }
    const result = buildSystemPrompt({ basePrompt: 'Base.', projectContext: ctx, model: 'q' })
    expect(result).toContain('Always use TypeScript.')
    expect(result).toContain('project_instructions')
  })

  it('omits project instructions when absent', () => {
    const ctx: ProjectContext = { rootDir: '/tmp', language: 'ts', relevantFiles: [] }
    const result = buildSystemPrompt({ basePrompt: 'Base.', projectContext: ctx, model: 'q' })
    expect(result).not.toContain('project_instructions')
  })
})

describe('PROMPT_PRIORITIES', () => {
  it('has ascending priority values', () => {
    const vals = Object.values(PROMPT_PRIORITIES)
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThan(vals[i - 1])
    }
  })
})
