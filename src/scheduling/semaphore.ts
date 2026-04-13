/**
 * Semaphore — concurrency limiter for parallel agent/task execution.
 */

export class Semaphore {
  private current = 0
  private queue: Array<() => void> = []

  constructor(private readonly max: number) {
    if (max < 1) throw new Error('Semaphore max must be >= 1')
  }

  /** Acquire a slot. Resolves when a slot is available. */
  acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  /** Release a slot. Wakes the next waiter if any. */
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    } else {
      this.current = Math.max(0, this.current - 1)
    }
  }

  /** Run a function while holding a semaphore slot. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }

  /** Current number of active slots. */
  get active(): number {
    return this.current
  }

  /** Number of waiters in queue. */
  get waiting(): number {
    return this.queue.length
  }
}
