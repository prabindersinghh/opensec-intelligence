import { describe, it, expect } from 'vitest'
import { TaskQueue } from '../../src/communication/task-queue.js'
import type { Task } from '../../src/core/types.js'

function mkTask(id: string, deps?: string[]): Task {
  return {
    id,
    title: `Task ${id}`,
    description: '',
    status: 'pending',
    dependsOn: deps,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

describe('TaskQueue', () => {
  it('adds and retrieves tasks', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b'))
    expect(q.get('a')?.id).toBe('a')
    expect(q.getAll()).toHaveLength(2)
  })

  it('getReady returns tasks with no dependencies', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b', ['a']))
    const ready = q.getReady()
    expect(ready).toHaveLength(1)
    expect(ready[0].id).toBe('a')
  })

  it('getReady returns tasks whose dependencies are completed', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b', ['a']))
    q.complete('a', 'done')
    const ready = q.getReady()
    expect(ready).toHaveLength(1)
    expect(ready[0].id).toBe('b')
  })

  it('marks tasks in-progress', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.start('a')
    expect(q.get('a')?.status).toBe('in_progress')
    expect(q.getReady()).toHaveLength(0) // not pending anymore
  })

  it('marks tasks completed', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.complete('a', 'result')
    expect(q.get('a')?.status).toBe('completed')
    expect(q.get('a')?.result).toBe('result')
  })

  it('cascades failure to dependents', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b', ['a']))
    q.add(mkTask('c', ['b']))
    q.fail('a', new Error('boom'))

    expect(q.get('a')?.status).toBe('failed')
    expect(q.get('b')?.status).toBe('failed')
    expect(q.get('c')?.status).toBe('failed')
    expect(q.get('b')?.result).toContain('Dependency "a" failed')
  })

  it('unblocks tasks when deps complete', () => {
    const q = new TaskQueue()
    const blocked = mkTask('b', ['a'])
    blocked.status = 'blocked'
    q.add(mkTask('a'))
    q.add(blocked)

    expect(q.get('b')?.status).toBe('blocked')
    q.complete('a')
    expect(q.get('b')?.status).toBe('pending')
  })

  it('topologicalSort respects dependency order', () => {
    const q = new TaskQueue()
    q.add(mkTask('c', ['b']))
    q.add(mkTask('b', ['a']))
    q.add(mkTask('a'))
    const sorted = q.topologicalSort()
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
    expect(sorted.indexOf('b')).toBeLessThan(sorted.indexOf('c'))
  })

  it('isFinished returns true when all done', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b'))
    expect(q.isFinished()).toBe(false)
    q.complete('a')
    q.fail('b', new Error('err'))
    expect(q.isFinished()).toBe(true)
  })

  it('summary counts tasks by status', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.add(mkTask('b'))
    q.add(mkTask('c'))
    q.start('a')
    q.complete('b')
    const s = q.summary()
    expect(s.pending).toBe(1)
    expect(s.in_progress).toBe(1)
    expect(s.completed).toBe(1)
  })

  it('reset sets all tasks to pending', () => {
    const q = new TaskQueue()
    q.add(mkTask('a'))
    q.complete('a')
    q.reset()
    expect(q.get('a')?.status).toBe('pending')
  })

  it('fires callbacks on complete and fail', () => {
    const events: string[] = []
    const q = new TaskQueue({
      onTaskComplete: (t) => events.push(`complete:${t.id}`),
      onTaskFailed: (t) => events.push(`fail:${t.id}`),
    })
    q.add(mkTask('a'))
    q.add(mkTask('b'))
    q.complete('a')
    q.fail('b', new Error('x'))
    expect(events).toEqual(['complete:a', 'fail:b'])
  })
})
