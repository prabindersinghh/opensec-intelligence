/**
 * Orchestrator — top-level coordinator for multi-agent workflows.
 *
 * Provides runAgent(), runTeam(), runTasks(), and coordinate() entry points.
 * The coordinate() method adds a planning phase where an LLM decomposes a
 * complex goal into tasks with dependencies before executing them.
 */

import type {
  AgentConfig, AgentRunResult, TeamConfig, TeamRunResult,
  Task, LLMAdapter, OrchestratorConfig, OrchestratorEvent, TokenUsage,
  LLMMessage, LLMChatOptions, TextBlock,
} from './types.js'
import type { ToolRegistry } from '../tools/registry.js'
import type { PermissionManager } from './permissions.js'
import { Agent } from './agent.js'
import { Team } from './team.js'
import { TaskQueue } from '../communication/task-queue.js'
import { Semaphore } from '../scheduling/semaphore.js'

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

const COORDINATOR_SYSTEM_PROMPT = `You are a task decomposition coordinator. Given a complex goal and a list of available agents, break the goal into concrete tasks.

Output a JSON array of tasks. Each task has:
- "id": unique short string (e.g. "t1", "t2")
- "title": brief task description (1 line)
- "description": detailed instructions for the agent
- "assignee": name of the agent best suited for this task
- "dependsOn": array of task IDs that must complete first (or empty array)

Rules:
- Minimize dependencies — parallelize when possible
- Each task should be self-contained enough for one agent to handle
- Assign tasks to agents based on their roles/specializations
- Keep the total number of tasks reasonable (2-8)

Output ONLY the JSON array, no other text.`

export interface CoordinateResult {
  success: boolean
  taskResults: Map<string, AgentRunResult>
  totalTokenUsage: TokenUsage
  plannedTasks: number
  completedTasks: number
}

export class Orchestrator {
  private readonly adapter: LLMAdapter
  private readonly toolRegistry: ToolRegistry
  private readonly config: OrchestratorConfig
  private readonly permissionManager?: PermissionManager
  private readonly cwd: string
  private activeTeam?: Team

  constructor(
    adapter: LLMAdapter,
    toolRegistry: ToolRegistry,
    config: OrchestratorConfig = {},
    cwd?: string,
    permissionManager?: PermissionManager,
  ) {
    this.adapter = adapter
    this.toolRegistry = toolRegistry
    this.config = config
    this.cwd = cwd ?? process.cwd()
    this.permissionManager = permissionManager
  }

  /** Run a single agent on a task. */
  async runAgent(agentConfig: AgentConfig, task: string): Promise<AgentRunResult> {
    const agent = new Agent(
      agentConfig,
      this.adapter,
      this.toolRegistry,
      this.cwd,
      this.permissionManager,
    )

    this.emit({ type: 'agent_start', agent: agentConfig.name })
    const result = await agent.run(task)
    this.emit({ type: 'agent_complete', agent: agentConfig.name, data: result })

    return result
  }

  /** Run a team on a goal. Returns aggregated results from all agents. */
  async runTeam(teamConfig: TeamConfig, goal: string): Promise<TeamRunResult> {
    const team = new Team(
      teamConfig,
      this.adapter,
      this.toolRegistry,
      this.cwd,
      this.permissionManager,
    )

    this.activeTeam = team
    team.setProgressHandler(event => this.emit(event))

    const result = await team.run(goal)
    this.activeTeam = undefined

    return result
  }

  /**
   * Run a set of tasks with dependency resolution and agent assignment.
   * Uses topological ordering and semaphore-controlled parallelism.
   */
  async runTasks(
    tasks: Task[],
    agentConfigs: readonly AgentConfig[],
  ): Promise<{ results: Map<string, AgentRunResult>; totalUsage: TokenUsage }> {
    const queue = new TaskQueue()
    queue.addAll(tasks)
    const semaphore = new Semaphore(this.config.maxConcurrency ?? 2)
    const results = new Map<string, AgentRunResult>()
    let totalUsage: TokenUsage = ZERO_USAGE

    // Create agents
    const agents = new Map<string, Agent>()
    for (const config of agentConfigs) {
      agents.set(config.name, new Agent(
        config, this.adapter, this.toolRegistry, this.cwd, this.permissionManager,
      ))
    }

    // Process tasks in topological order, running independent tasks in parallel
    while (!queue.isFinished()) {
      const ready = queue.getReady()
      if (ready.length === 0) {
        // Check for deadlock
        const summary = queue.summary()
        if (summary.in_progress === 0) break // true deadlock or all done
        // Wait for in-progress tasks
        await new Promise(r => setTimeout(r, 100))
        continue
      }

      const batch = ready.map(task => {
        const agentName = task.assignee ?? agentConfigs[0].name
        const agent = agents.get(agentName) ?? agents.values().next().value!
        queue.start(task.id)
        this.emit({ type: 'task_start', task: task.id, agent: agentName })

        return semaphore.run(async () => {
          try {
            this.emit({ type: 'agent_start', agent: agentName })
            const result = await agent.run(task.description)
            results.set(task.id, result)
            totalUsage = addUsage(totalUsage, result.tokenUsage)
            queue.complete(task.id, result.output.slice(0, 500))
            this.emit({ type: 'task_complete', task: task.id, agent: agentName })
            this.emit({ type: 'agent_complete', agent: agentName })
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            queue.fail(task.id, error)
            this.emit({ type: 'error', task: task.id, agent: agentName, data: error.message })
          }
        })
      })

      await Promise.all(batch)
    }

    return { results, totalUsage }
  }

  /** Get the active team (if any). */
  getActiveTeam(): Team | undefined {
    return this.activeTeam
  }

  /**
   * Coordinator mode: LLM-driven task decomposition + parallel execution.
   * Uses the adapter to plan tasks, then executes them via runTasks().
   */
  async coordinate(
    goal: string,
    agentConfigs: readonly AgentConfig[],
    options?: { maxTokenBudget?: number },
  ): Promise<CoordinateResult> {
    this.emit({ type: 'message', data: 'Coordinator: planning tasks...' })

    // Step 1: Plan — ask LLM to decompose the goal into tasks
    const agentList = agentConfigs.map(a => `- ${a.name}: ${a.systemPrompt?.slice(0, 100) ?? 'general assistant'}`).join('\n')
    const planMessages: LLMMessage[] = [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Available agents:\n${agentList}\n\nGoal: ${goal}`,
      }],
    }]

    const planOptions: LLMChatOptions = {
      model: this.config.defaultModel ?? agentConfigs[0]?.model ?? 'qwen3',
      systemPrompt: COORDINATOR_SYSTEM_PROMPT,
      maxTokens: 1024,
      temperature: 0.3,
    }

    let tasks: Task[]
    let planUsage: TokenUsage = ZERO_USAGE

    try {
      const response = await this.adapter.chat(planMessages, planOptions)
      planUsage = response.usage
      const text = response.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('')

      // Parse JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) throw new Error('No JSON array in planner response')

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: string; title: string; description: string;
        assignee?: string; dependsOn?: string[]
      }>

      tasks = parsed.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: 'pending' as const,
        assignee: t.assignee,
        dependsOn: t.dependsOn,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))

      this.emit({ type: 'message', data: `Coordinator: planned ${tasks.length} tasks` })
    } catch (err) {
      // Fallback: single task assigned to first agent
      tasks = [{
        id: 't1',
        title: goal.slice(0, 80),
        description: goal,
        status: 'pending' as const,
        assignee: agentConfigs[0]?.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]
      this.emit({ type: 'message', data: 'Coordinator: plan failed, using single-task fallback' })
    }

    // Step 2: Execute
    const { results: taskResults, totalUsage: execUsage } = await this.runTasks(tasks, agentConfigs)

    const totalUsage = addUsage(planUsage, execUsage)
    const completed = Array.from(taskResults.values()).filter(r => r.success).length

    // Check token budget
    if (options?.maxTokenBudget && (totalUsage.input_tokens + totalUsage.output_tokens) > options.maxTokenBudget) {
      this.emit({ type: 'message', data: 'Coordinator: token budget exceeded' })
    }

    return {
      success: completed === tasks.length,
      taskResults,
      totalTokenUsage: totalUsage,
      plannedTasks: tasks.length,
      completedTasks: completed,
    }
  }

  /** Get status of the active team. */
  getStatus(): { agents: Array<{ name: string; status: string }>; tasks?: ReturnType<TaskQueue['summary']> } | null {
    if (!this.activeTeam) return null
    return this.activeTeam.getStatus()
  }

  private emit(event: OrchestratorEvent): void {
    this.config.onProgress?.(event)
  }
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  }
}
