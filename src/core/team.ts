/**
 * Team — multi-agent collaboration unit.
 *
 * A team owns agents, a shared memory, a message bus, and a task queue.
 * The Orchestrator uses teams to decompose and execute complex goals.
 */

import type {
  TeamConfig, TeamRunResult, AgentConfig, AgentRunResult,
  LLMAdapter, TokenUsage, Task, OrchestratorEvent,
} from './types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionManager } from './permissions.js'
import { AgentPool } from './agent-pool.js'
import { MessageBus } from '../communication/message-bus.js'
import { SharedMemory } from '../communication/shared-memory.js'
import { TaskQueue } from '../communication/task-queue.js'
import { selectAgent, type AgentLoad } from '../scheduling/strategies.js'

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

export class Team {
  readonly config: TeamConfig
  readonly messageBus: MessageBus
  readonly sharedMemory: SharedMemory
  readonly taskQueue: TaskQueue
  private readonly pool: AgentPool
  private taskCounter = 0
  private onProgress?: (event: OrchestratorEvent) => void

  constructor(
    config: TeamConfig,
    adapter: LLMAdapter,
    toolRegistry: ToolRegistry,
    cwd?: string,
    permissionManager?: PermissionManager,
  ) {
    this.config = config
    this.messageBus = new MessageBus()
    this.sharedMemory = new SharedMemory()
    this.taskQueue = new TaskQueue()
    this.pool = new AgentPool(adapter, toolRegistry, {
      maxConcurrency: config.maxConcurrency ?? 2,
      cwd,
    }, permissionManager)

    // Initialize agents in the pool
    for (const agentConfig of config.agents) {
      this.pool.getOrCreate(agentConfig)
    }
  }

  /** Set a progress callback for orchestration events. */
  setProgressHandler(handler: (event: OrchestratorEvent) => void): void {
    this.onProgress = handler
  }

  /**
   * Run a goal by decomposing it into tasks and assigning to agents.
   * The first agent in the config is the "planner" that decomposes the goal.
   */
  async run(goal: string): Promise<TeamRunResult> {
    const agentResults = new Map<string, AgentRunResult>()
    let totalUsage: TokenUsage = ZERO_USAGE

    // If only one agent, just run it directly
    if (this.config.agents.length === 1) {
      const agentName = this.config.agents[0].name
      this.emit({ type: 'agent_start', agent: agentName })
      const result = await this.pool.runTask(agentName, goal)
      agentResults.set(agentName, result)
      totalUsage = addUsage(totalUsage, result.tokenUsage)
      this.emit({ type: 'agent_complete', agent: agentName })

      return {
        success: result.success,
        agentResults,
        totalTokenUsage: totalUsage,
      }
    }

    // Multi-agent: run each agent's specialty in dependency order
    // Create one task per agent with the goal
    const tasks: Task[] = this.config.agents.map((agent, i) => ({
      id: `task-${++this.taskCounter}`,
      title: `${agent.name}: ${goal.slice(0, 80)}`,
      description: goal,
      status: 'pending' as const,
      assignee: agent.name,
      dependsOn: i > 0 ? [`task-${this.taskCounter - 1}`] : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    this.taskQueue.addAll(tasks)

    // Execute in topological order
    const sorted = this.taskQueue.topologicalSort()

    for (const taskId of sorted) {
      const task = this.taskQueue.get(taskId)
      if (!task || task.status === 'failed') continue

      const agentName = task.assignee ?? this.selectAgent(task)
      this.taskQueue.start(taskId)
      this.emit({ type: 'task_start', task: taskId, agent: agentName })
      this.emit({ type: 'agent_start', agent: agentName })

      try {
        // Build a context-aware prompt including shared memory
        const contextEntries = await this.sharedMemory.list()
        let prompt = task.description
        if (contextEntries.length > 0) {
          const memoryContext = contextEntries
            .map(e => `[${e.key}]: ${e.value}`)
            .join('\n')
          prompt = `Previous agent context:\n${memoryContext}\n\nTask: ${task.description}`
        }

        const result = await this.pool.runTask(agentName, prompt)
        agentResults.set(agentName, result)
        totalUsage = addUsage(totalUsage, result.tokenUsage)

        // Store result in shared memory for downstream agents
        await this.sharedMemory.set(
          `${agentName}-output`,
          result.output.slice(0, 2000),
          { agent: agentName, task: taskId },
        )

        this.taskQueue.complete(taskId, result.output.slice(0, 500))
        this.emit({ type: 'agent_complete', agent: agentName })
        this.emit({ type: 'task_complete', task: taskId, agent: agentName })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.taskQueue.fail(taskId, error)
        this.emit({ type: 'error', agent: agentName, task: taskId, data: error.message })

        agentResults.set(agentName, {
          success: false,
          output: error.message,
          messages: [],
          tokenUsage: ZERO_USAGE,
          toolCalls: [],
        })
      }
    }

    const summary = this.taskQueue.summary()
    return {
      success: summary.failed === 0,
      agentResults,
      totalTokenUsage: totalUsage,
    }
  }

  /** Select the best agent for a task using the configured strategy. */
  private selectAgent(task: Task): string {
    const strategy = this.config.schedulingStrategy ?? 'capability-match'
    const loads: AgentLoad[] = this.pool.getLoads().map(l => ({
      name: l.name,
      activeTasks: l.status === 'running' ? 1 : 0,
      completedTasks: 0,
    }))
    return selectAgent(strategy, this.config.agents, task, {
      counter: this.taskCounter,
      loads,
    })
  }

  private emit(event: OrchestratorEvent): void {
    this.onProgress?.(event)
  }

  /** Get the agent pool for direct access. */
  getPool(): AgentPool {
    return this.pool
  }

  /** Get status of all agents and tasks. */
  getStatus(): { agents: Array<{ name: string; status: string }>; tasks: ReturnType<TaskQueue['summary']> } {
    return {
      agents: this.pool.getLoads(),
      tasks: this.taskQueue.summary(),
    }
  }
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}
