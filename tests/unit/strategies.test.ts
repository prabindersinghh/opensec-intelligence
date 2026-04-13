import { describe, it, expect } from 'vitest'
import { roundRobin, leastBusy, capabilityMatch, selectAgent } from '../../src/scheduling/strategies.js'
import type { AgentConfig, Task } from '../../src/core/types.js'

const agents: AgentConfig[] = [
  { name: 'alice', systemPrompt: 'You are a code reviewer', tools: ['file_read', 'grep'] },
  { name: 'bob', systemPrompt: 'You write tests with bash', tools: ['bash', 'file_write'] },
  { name: 'carol', systemPrompt: 'You search and find bugs', tools: ['grep', 'file_read'] },
]

const task = (title: string, desc = ''): Task => ({
  id: `t-${title}`,
  title,
  description: desc,
  status: 'pending',
  createdAt: new Date(),
  updatedAt: new Date(),
})

describe('roundRobin', () => {
  it('cycles through agents in order', () => {
    expect(roundRobin(agents, task('a'), 0)).toBe('alice')
    expect(roundRobin(agents, task('b'), 1)).toBe('bob')
    expect(roundRobin(agents, task('c'), 2)).toBe('carol')
    expect(roundRobin(agents, task('d'), 3)).toBe('alice')
  })
})

describe('leastBusy', () => {
  it('picks agent with fewest active tasks', () => {
    const loads = [
      { name: 'alice', activeTasks: 3, completedTasks: 0 },
      { name: 'bob', activeTasks: 1, completedTasks: 0 },
      { name: 'carol', activeTasks: 2, completedTasks: 0 },
    ]
    expect(leastBusy(agents, task('x'), loads)).toBe('bob')
  })

  it('defaults to 0 load for agents not in loads list', () => {
    const loads = [
      { name: 'alice', activeTasks: 1, completedTasks: 0 },
    ]
    // bob and carol have 0 load (not in list), bob should be picked first
    expect(leastBusy(agents, task('x'), loads)).toBe('bob')
  })
})

describe('capabilityMatch', () => {
  it('selects agent whose profile best matches the task', () => {
    const result = capabilityMatch(agents, task('review the code', 'review the pull request carefully'))
    expect(result).toBe('alice') // alice has "reviewer" in systemPrompt and review gives +3
  })

  it('favors agents with matching tools for test tasks', () => {
    const result = capabilityMatch(agents, task('test the login flow', 'write and run tests'))
    expect(result).toBe('bob') // bob has bash tool → +2 bonus for "test"
  })
})

describe('selectAgent', () => {
  it('dispatches to round-robin', () => {
    const result = selectAgent('round-robin', agents, task('a'), { counter: 1, loads: [] })
    expect(result).toBe('bob')
  })

  it('dispatches to least-busy', () => {
    const loads = [
      { name: 'alice', activeTasks: 5, completedTasks: 0 },
      { name: 'bob', activeTasks: 5, completedTasks: 0 },
      { name: 'carol', activeTasks: 0, completedTasks: 0 },
    ]
    const result = selectAgent('least-busy', agents, task('a'), { counter: 0, loads })
    expect(result).toBe('carol')
  })

  it('dispatches to capability-match', () => {
    const result = selectAgent('capability-match', agents, task('search for the bug'), { counter: 0, loads: [] })
    expect(result).toBe('carol') // carol has "search" and "find bugs" in prompt
  })
})
