/**
 * TaskQueue — dependency-aware task scheduling with topological ordering.
 *
 * Supports DAG-based dependency resolution, auto-unblocking, and cascade failure.
 */

import type { Task, TaskStatus } from '../core/types.js'

export interface TaskQueueOptions {
  readonly onTaskReady?: (task: Task) => void
  readonly onTaskComplete?: (task: Task) => void
  readonly onTaskFailed?: (task: Task, error: Error) => void
}

export class TaskQueue {
  private tasks = new Map<string, Task>()
  private readonly options: TaskQueueOptions

  constructor(options: TaskQueueOptions = {}) {
    this.options = options
  }

  /** Add a task to the queue. */
  add(task: Task): void {
    this.tasks.set(task.id, { ...task })
  }

  /** Add multiple tasks at once. */
  addAll(tasks: Task[]): void {
    for (const t of tasks) this.add(t)
  }

  /** Get a task by ID. */
  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  /** Return all tasks. */
  getAll(): Task[] {
    return Array.from(this.tasks.values())
  }

  /**
   * Return tasks that are ready to execute (pending + all dependencies satisfied).
   */
  getReady(): Task[] {
    return Array.from(this.tasks.values()).filter(t => {
      if (t.status !== 'pending') return false
      return this.dependenciesSatisfied(t)
    })
  }

  /** Check if all dependencies of a task are completed. */
  private dependenciesSatisfied(task: Task): boolean {
    if (!task.dependsOn || task.dependsOn.length === 0) return true
    return task.dependsOn.every(depId => {
      const dep = this.tasks.get(depId)
      return dep?.status === 'completed'
    })
  }

  /** Mark a task as in-progress. */
  start(id: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'in_progress'
    task.updatedAt = new Date()
  }

  /** Mark a task as completed with an optional result. */
  complete(id: string, result?: string): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'completed'
    task.result = result
    task.updatedAt = new Date()
    this.options.onTaskComplete?.(task)

    // Check if any blocked tasks are now unblocked
    for (const t of this.tasks.values()) {
      if (t.status === 'blocked' && this.dependenciesSatisfied(t)) {
        t.status = 'pending'
        t.updatedAt = new Date()
      }
    }
  }

  /** Mark a task as failed — cascades to dependent tasks. */
  fail(id: string, error: Error): void {
    const task = this.tasks.get(id)
    if (!task) return
    task.status = 'failed'
    task.result = error.message
    task.updatedAt = new Date()
    this.options.onTaskFailed?.(task, error)

    // Cascade failure to dependents
    this.cascadeFailure(id)
  }

  /** Recursively fail all tasks that depend on a failed task. */
  private cascadeFailure(failedId: string): void {
    for (const task of this.tasks.values()) {
      if (task.dependsOn?.includes(failedId) && task.status !== 'failed' && task.status !== 'completed') {
        task.status = 'failed'
        task.result = `Dependency "${failedId}" failed`
        task.updatedAt = new Date()
        this.cascadeFailure(task.id)
      }
    }
  }

  /**
   * Return topologically sorted task IDs (respecting dependencies).
   * Uses Kahn's algorithm.
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>()
    const adjacency = new Map<string, string[]>()

    for (const task of this.tasks.values()) {
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0)
      if (!adjacency.has(task.id)) adjacency.set(task.id, [])

      if (task.dependsOn) {
        for (const dep of task.dependsOn) {
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1)
          const adj = adjacency.get(dep) ?? []
          adj.push(task.id)
          adjacency.set(dep, adj)
        }
      }
    }

    const queue: string[] = []
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      sorted.push(id)
      for (const next of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(next) ?? 1) - 1
        inDegree.set(next, newDegree)
        if (newDegree === 0) queue.push(next)
      }
    }

    return sorted
  }

  /** Check if all tasks are done (completed or failed). */
  isFinished(): boolean {
    return Array.from(this.tasks.values()).every(
      t => t.status === 'completed' || t.status === 'failed',
    )
  }

  /** Count tasks by status. */
  summary(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      pending: 0, in_progress: 0, completed: 0, failed: 0, blocked: 0,
    }
    for (const t of this.tasks.values()) {
      counts[t.status]++
    }
    return counts
  }

  /** Reset all tasks to pending. */
  reset(): void {
    for (const t of this.tasks.values()) {
      t.status = 'pending'
      t.result = undefined
      t.updatedAt = new Date()
    }
  }
}
