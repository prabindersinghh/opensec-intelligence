/**
 * AgentPool — parallel agent execution with semaphore-controlled concurrency.
 */

import { Agent } from './agent.js'
import type {
  AgentConfig, AgentRunResult, LLMAdapter, TokenUsage,
} from './types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionManager } from './permissions.js'
import { Semaphore } from '../scheduling/semaphore.js'

export interface PoolOptions {
  readonly maxConcurrency: number
  readonly cwd?: string
}

export class AgentPool {
  private readonly agents = new Map<string, Agent>()
  private readonly semaphore: Semaphore
  private readonly cwd: string

  constructor(
    private readonly adapter: LLMAdapter,
    private readonly toolRegistry: ToolRegistry,
    private readonly options: PoolOptions,
    private readonly permissionManager?: PermissionManager,
  ) {
    this.semaphore = new Semaphore(options.maxConcurrency)
    this.cwd = options.cwd ?? process.cwd()
  }

  /** Create or get an agent by config. */
  getOrCreate(config: AgentConfig): Agent {
    let agent = this.agents.get(config.name)
    if (!agent) {
      agent = new Agent(config, this.adapter, this.toolRegistry, this.cwd, this.permissionManager)
      this.agents.set(config.name, agent)
    }
    return agent
  }

  /** Run a task on a named agent, respecting concurrency limits. */
  async runTask(agentName: string, task: string): Promise<AgentRunResult> {
    const agent = this.agents.get(agentName)
    if (!agent) throw new Error(`Agent "${agentName}" not found in pool`)
    return this.semaphore.run(() => agent.run(task))
  }

  /** Run tasks in parallel across multiple agents. */
  async runParallel(
    assignments: Array<{ agentName: string; task: string }>,
  ): Promise<Map<string, AgentRunResult>> {
    const results = new Map<string, AgentRunResult>()

    const promises = assignments.map(async ({ agentName, task }) => {
      const result = await this.runTask(agentName, task)
      results.set(agentName, result)
    })

    await Promise.all(promises)
    return results
  }

  /** Get the current load of each agent. */
  getLoads(): Array<{ name: string; status: string }> {
    return Array.from(this.agents.entries()).map(([name, agent]) => ({
      name,
      status: agent.getState().status,
    }))
  }

  /** Get all agents in the pool. */
  getAgents(): Map<string, Agent> {
    return new Map(this.agents)
  }

  /** Reset all agents. */
  resetAll(): void {
    for (const agent of this.agents.values()) {
      agent.reset()
    }
  }
}
