import { describe, it, expect } from 'vitest'
import { parsePermissionRule, classifyTool } from '../../src/core/permissions.js'

describe('parsePermissionRule', () => {
  it('parses tool name with pattern', () => {
    const rule = parsePermissionRule('bash(npm run *)', 'allow')
    expect(rule).toEqual({ action: 'allow', tool: 'bash', pattern: 'npm run *' })
  })

  it('parses tool name without pattern', () => {
    const rule = parsePermissionRule('file_read', 'deny')
    expect(rule).toEqual({ action: 'deny', tool: 'file_read' })
  })

  it('parses ask rules', () => {
    const rule = parsePermissionRule('bash(git push *)', 'ask')
    expect(rule).toEqual({ action: 'ask', tool: 'bash', pattern: 'git push *' })
  })

  it('handles nested parentheses in pattern', () => {
    const rule = parsePermissionRule('file_read(src/**)', 'allow')
    expect(rule).toEqual({ action: 'allow', tool: 'file_read', pattern: 'src/**' })
  })

  it('handles malformed input gracefully', () => {
    const rule = parsePermissionRule('  some weird input  ', 'deny')
    expect(rule.action).toBe('deny')
    expect(rule.tool).toBe('some weird input')
  })
})

describe('classifyTool', () => {
  it('classifies read-only tools', () => {
    expect(classifyTool('file_read')).toBe('read-only')
    expect(classifyTool('glob')).toBe('read-only')
    expect(classifyTool('grep')).toBe('read-only')
    expect(classifyTool('git_diff')).toBe('read-only')
    expect(classifyTool('git_log')).toBe('read-only')
    expect(classifyTool('think')).toBe('read-only')
    expect(classifyTool('memory_read')).toBe('read-only')
  })

  it('classifies dangerous tools', () => {
    expect(classifyTool('bash')).toBe('dangerous')
  })

  it('classifies write tools by default', () => {
    expect(classifyTool('file_write')).toBe('write')
    expect(classifyTool('file_edit')).toBe('write')
    expect(classifyTool('unknown_tool')).toBe('write')
  })
})
