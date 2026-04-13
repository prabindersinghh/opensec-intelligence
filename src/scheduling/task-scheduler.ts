/**
 * TaskScheduler — cron-like background task automation for cmdr.
 *
 * Supports:
 *  - Interval-based tasks (run every N seconds/minutes)
 *  - One-shot delayed tasks (run after N seconds)
 *  - Named tasks with status tracking
 *  - Graceful shutdown
 */

export interface ScheduledTask {
  readonly id: string
  readonly name: string
  readonly handler: () => Promise<void> | void
  readonly intervalMs?: number
  readonly delayMs?: number
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  lastRun?: Date
  nextRun?: Date
  runCount: number
  error?: string
}

interface TaskEntry extends ScheduledTask {
  timer?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>
}

let taskIdCounter = 0

export class TaskScheduler {
  private tasks = new Map<string, TaskEntry>()
  private running = false

  /** Start the scheduler. */
  start(): void {
    this.running = true
    // Arm all pending tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'pending') this.arm(task)
    }
  }

  /** Stop all scheduled tasks. */
  stop(): void {
    this.running = false
    for (const task of this.tasks.values()) {
      if (task.timer) {
        clearTimeout(task.timer as ReturnType<typeof setTimeout>)
        clearInterval(task.timer as ReturnType<typeof setInterval>)
        task.timer = undefined
      }
      if (task.status === 'pending' || task.status === 'running') {
        task.status = 'cancelled'
      }
    }
  }

  /** Schedule a recurring task. */
  scheduleInterval(name: string, intervalMs: number, handler: () => Promise<void> | void): string {
    const id = `task_${++taskIdCounter}_${Date.now()}`
    const task: TaskEntry = {
      id, name, handler, intervalMs,
      status: 'pending',
      runCount: 0,
      nextRun: new Date(Date.now() + intervalMs),
    }
    this.tasks.set(id, task)
    if (this.running) this.arm(task)
    return id
  }

  /** Schedule a one-shot delayed task. */
  scheduleOnce(name: string, delayMs: number, handler: () => Promise<void> | void): string {
    const id = `task_${++taskIdCounter}_${Date.now()}`
    const task: TaskEntry = {
      id, name, handler, delayMs,
      status: 'pending',
      runCount: 0,
      nextRun: new Date(Date.now() + delayMs),
    }
    this.tasks.set(id, task)
    if (this.running) this.arm(task)
    return id
  }

  /** Cancel a specific task. */
  cancel(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) return false
    if (task.timer) {
      clearTimeout(task.timer as ReturnType<typeof setTimeout>)
      clearInterval(task.timer as ReturnType<typeof setInterval>)
      task.timer = undefined
    }
    task.status = 'cancelled'
    return true
  }

  /** List all scheduled tasks with their status. */
  list(): Array<{
    id: string
    name: string
    status: string
    runCount: number
    lastRun?: Date
    nextRun?: Date
    error?: string
  }> {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      status: t.status,
      runCount: t.runCount,
      lastRun: t.lastRun,
      nextRun: t.nextRun,
      error: t.error,
    }))
  }

  /** Get a specific task by ID. */
  get(id: string): ScheduledTask | undefined {
    return this.tasks.get(id)
  }

  /** Number of active (pending/running) tasks. */
  get activeCount(): number {
    return Array.from(this.tasks.values()).filter(
      t => t.status === 'pending' || t.status === 'running',
    ).length
  }

  private arm(task: TaskEntry): void {
    const execute = async () => {
      task.status = 'running'
      task.lastRun = new Date()
      try {
        await task.handler()
        task.runCount++
        task.error = undefined
        if (task.intervalMs) {
          task.status = 'pending'
          task.nextRun = new Date(Date.now() + task.intervalMs)
        } else {
          task.status = 'completed'
        }
      } catch (err) {
        task.error = err instanceof Error ? err.message : String(err)
        task.status = 'failed'
      }
    }

    if (task.intervalMs) {
      task.timer = setInterval(execute, task.intervalMs)
    } else if (task.delayMs) {
      task.timer = setTimeout(execute, task.delayMs)
    }
  }
}
