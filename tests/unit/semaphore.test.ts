import { describe, it, expect } from 'vitest'
import { Semaphore } from '../../src/scheduling/semaphore.js'

describe('Semaphore', () => {
  it('throws if max < 1', () => {
    expect(() => new Semaphore(0)).toThrow('Semaphore max must be >= 1')
    expect(() => new Semaphore(-1)).toThrow('Semaphore max must be >= 1')
  })

  it('allows immediate acquisition up to max', async () => {
    const sem = new Semaphore(2)
    expect(sem.active).toBe(0)
    await sem.acquire()
    expect(sem.active).toBe(1)
    await sem.acquire()
    expect(sem.active).toBe(2)
  })

  it('queues acquisition beyond max', async () => {
    const sem = new Semaphore(1)
    await sem.acquire()
    expect(sem.active).toBe(1)

    let acquired = false
    const p = sem.acquire().then(() => { acquired = true })
    // Should not be acquired yet
    expect(acquired).toBe(false)
    expect(sem.waiting).toBe(1)

    sem.release()
    await p
    expect(acquired).toBe(true)
    expect(sem.waiting).toBe(0)
  })

  it('release unblocks next waiter in FIFO order', async () => {
    const sem = new Semaphore(1)
    await sem.acquire()

    const order: number[] = []
    const p1 = sem.acquire().then(() => { order.push(1) })
    const p2 = sem.acquire().then(() => { order.push(2) })

    expect(sem.waiting).toBe(2)
    sem.release()
    await p1
    sem.release()
    await p2

    expect(order).toEqual([1, 2])
  })

  it('active never goes below 0', () => {
    const sem = new Semaphore(1)
    sem.release()
    sem.release()
    expect(sem.active).toBe(0)
  })

  it('run() acquires and releases around async fn', async () => {
    const sem = new Semaphore(1)
    const result = await sem.run(async () => {
      expect(sem.active).toBe(1)
      return 42
    })
    expect(result).toBe(42)
    expect(sem.active).toBe(0)
  })

  it('run() releases even if fn throws', async () => {
    const sem = new Semaphore(1)
    await expect(sem.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(sem.active).toBe(0)
  })
})
