import { describe, it, expect, vi } from 'vitest'
import { MessageBus } from '../../src/communication/message-bus.js'

describe('MessageBus', () => {
  it('delivers broadcast messages to all channel subscribers', async () => {
    const bus = new MessageBus()
    const received: string[] = []

    bus.subscribe('alice', 'updates', (msg) => { received.push(`alice:${msg.payload}`) })
    bus.subscribe('bob', 'updates', (msg) => { received.push(`bob:${msg.payload}`) })

    await bus.broadcast('system', 'updates', 'deploy complete')

    expect(received).toContain('alice:deploy complete')
    expect(received).toContain('bob:deploy complete')
  })

  it('does not echo messages back to sender', async () => {
    const bus = new MessageBus()
    const received: string[] = []

    bus.subscribe('alice', 'chat', (msg) => { received.push(`alice`) })
    await bus.broadcast('alice', 'chat', 'hello')

    expect(received).toHaveLength(0)
  })

  it('delivers direct messages only to the target', async () => {
    const bus = new MessageBus()
    const received: string[] = []

    bus.subscribe('alice', 'tasks', (msg) => { received.push('alice') })
    bus.subscribe('bob', 'tasks', (msg) => { received.push('bob') })

    await bus.send('system', 'bob', 'tasks', 'do this')

    expect(received).toEqual(['bob'])
  })

  it('supports wildcard channel subscription', async () => {
    const bus = new MessageBus()
    const received: string[] = []

    bus.subscribe('logger', '*', (msg) => { received.push(msg.channel) })

    await bus.broadcast('alice', 'chat', 'hi')
    await bus.broadcast('bob', 'tasks', 'work')

    expect(received).toEqual(['chat', 'tasks'])
  })

  it('stores message history', async () => {
    const bus = new MessageBus()
    await bus.broadcast('alice', 'chat', 'msg1')
    await bus.broadcast('bob', 'chat', 'msg2')
    await bus.broadcast('carol', 'tasks', 'msg3')

    expect(bus.getHistory()).toHaveLength(3)
    expect(bus.getHistory('chat')).toHaveLength(2)
    expect(bus.getHistory('tasks')).toHaveLength(1)
  })

  it('trims history to maxHistory', async () => {
    const bus = new MessageBus(2)
    await bus.broadcast('a', 'ch', '1')
    await bus.broadcast('b', 'ch', '2')
    await bus.broadcast('c', 'ch', '3')

    expect(bus.getHistory()).toHaveLength(2)
    expect(bus.getHistory()[0].payload).toBe('2')
  })

  it('unsubscribe removes all subs for an agent', async () => {
    const bus = new MessageBus()
    const called = vi.fn()

    bus.subscribe('alice', 'chat', called)
    bus.subscribe('alice', 'tasks', called)
    bus.unsubscribe('alice')

    await bus.broadcast('bob', 'chat', 'hello')
    await bus.broadcast('bob', 'tasks', 'work')

    expect(called).not.toHaveBeenCalled()
  })

  it('reset clears subscriptions and history', async () => {
    const bus = new MessageBus()
    const called = vi.fn()

    bus.subscribe('alice', 'chat', called)
    await bus.broadcast('bob', 'chat', 'hello')

    bus.reset()

    expect(bus.getHistory()).toHaveLength(0)
    await bus.broadcast('bob', 'chat', 'after-reset')
    expect(called).toHaveBeenCalledTimes(1) // only from before reset
  })
})
