import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../../src/core/event-bus.js'

describe('EventBus', () => {
  it('emits events to subscribed listeners', async () => {
    const bus = new EventBus()
    const received: string[] = []

    bus.on('session:start', (data) => { received.push(data.sessionId) })
    await bus.emit('session:start', { sessionId: 'abc' })

    expect(received).toEqual(['abc'])
  })

  it('supports multiple listeners on one event', async () => {
    const bus = new EventBus()
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    bus.on('tool:before', fn1)
    bus.on('tool:before', fn2)
    await bus.emit('tool:before', { name: 'grep', input: {} })

    expect(fn1).toHaveBeenCalledOnce()
    expect(fn2).toHaveBeenCalledOnce()
  })

  it('once() fires handler only once', async () => {
    const bus = new EventBus()
    const fn = vi.fn()

    bus.once('turn:start', fn)
    await bus.emit('turn:start', { turn: 1, model: 'qwen' })
    await bus.emit('turn:start', { turn: 2, model: 'qwen' })

    expect(fn).toHaveBeenCalledOnce()
  })

  it('returns unsubscribe function from on()', async () => {
    const bus = new EventBus()
    const fn = vi.fn()

    const unsub = bus.on('tool:error', fn)
    unsub()

    await bus.emit('tool:error', { name: 'bash', error: 'oops' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('wildcard listener receives all events', async () => {
    const bus = new EventBus()
    const events: string[] = []

    bus.onAny(({ event }) => { events.push(event) })
    await bus.emit('session:start', { sessionId: 'x' })
    await bus.emit('tool:before', { name: 'grep', input: {} })

    expect(events).toEqual(['session:start', 'tool:before'])
  })

  it('off() removes all listeners for an event', async () => {
    const bus = new EventBus()
    const fn = vi.fn()

    bus.on('llm:error', fn)
    bus.off('llm:error')
    await bus.emit('llm:error', { model: 'x', error: 'y' })

    expect(fn).not.toHaveBeenCalled()
  })

  it('removeAll() clears everything', async () => {
    const bus = new EventBus()
    const fn1 = vi.fn()
    const fn2 = vi.fn()

    bus.on('session:start', fn1)
    bus.onAny(fn2)
    bus.removeAll()

    await bus.emit('session:start', { sessionId: 'x' })
    expect(fn1).not.toHaveBeenCalled()
    expect(fn2).not.toHaveBeenCalled()
  })

  it('listenerCount returns correct count', () => {
    const bus = new EventBus()
    bus.on('tool:before', () => {})
    bus.on('tool:before', () => {})
    bus.on('tool:after', () => {})

    expect(bus.listenerCount('tool:before')).toBe(2)
    expect(bus.listenerCount('tool:after')).toBe(1)
    expect(bus.listenerCount('tool:error')).toBe(0)
  })

  it('listener errors do not propagate', async () => {
    const bus = new EventBus()
    const fn2 = vi.fn()

    bus.on('session:start', () => { throw new Error('boom') })
    bus.on('session:start', fn2)

    // Should not throw
    await bus.emit('session:start', { sessionId: 'x' })
    expect(fn2).toHaveBeenCalledOnce()
  })
})
