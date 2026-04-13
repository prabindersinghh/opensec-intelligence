/**
 * Scheduling strategies for multi-agent task assignment.
 *
 * Each strategy takes a list of available agents and a task,
 * and returns the name of the best agent to handle it.
 */

import type { AgentConfig, Task } from '../core/types.js'

export type SchedulingStrategy = 'round-robin' | 'least-busy' | 'capability-match' | 'dependency-first'

export interface AgentLoad {
  readonly name: string
  readonly activeTasks: number
  readonly completedTasks: number
}

/**
 * Round-robin: Cycle through agents in order.
 */
export function roundRobin(
  agents: readonly AgentConfig[],
  _task: Task,
  counter: number,
): string {
  return agents[counter % agents.length].name
}

/**
 * Least-busy: Pick the agent with the fewest active tasks.
 */
export function leastBusy(
  agents: readonly AgentConfig[],
  _task: Task,
  loads: readonly AgentLoad[],
): string {
  const loadMap = new Map(loads.map(l => [l.name, l.activeTasks]))
  let best = agents[0].name
  let bestLoad = Infinity

  for (const agent of agents) {
    const load = loadMap.get(agent.name) ?? 0
    if (load < bestLoad) {
      bestLoad = load
      best = agent.name
    }
  }

  return best
}

/**
 * Capability-match: Pick the agent whose tool set best matches the task.
 * Scores agents by how many task-relevant keywords match their tools + system prompt.
 */
export function capabilityMatch(
  agents: readonly AgentConfig[],
  task: Task,
): string {
  const taskText = `${task.title} ${task.description}`.toLowerCase()

  let bestAgent = agents[0].name
  let bestScore = -1

  for (const agent of agents) {
    let score = 0
    const agentProfile = `${agent.name} ${agent.systemPrompt ?? ''} ${(agent.tools ?? []).join(' ')}`.toLowerCase()

    // Score based on keyword overlap
    const taskWords = new Set(taskText.split(/\s+/).filter(w => w.length > 3))
    for (const word of taskWords) {
      if (agentProfile.includes(word)) score++
    }

    // Bonus if agent has tools that seem relevant
    if (taskText.includes('test') && agentProfile.includes('bash')) score += 2
    if (taskText.includes('review') && agentProfile.includes('review')) score += 3
    if (taskText.includes('write') && agentProfile.includes('file_write')) score += 2
    if (taskText.includes('fix') && agentProfile.includes('file_edit')) score += 2
    if (taskText.includes('search') && agentProfile.includes('grep')) score += 2

    if (score > bestScore) {
      bestScore = score
      bestAgent = agent.name
    }
  }

  return bestAgent
}

/**
 * Dependency-first: Assign tasks whose dependencies are most satisfied first,
 * then use capability-match for the actual agent selection.
 */
export function dependencyFirst(
  agents: readonly AgentConfig[],
  task: Task,
): string {
  // Delegate to capability-match for agent selection.
  // The ordering is handled by the TaskQueue's topological sort.
  return capabilityMatch(agents, task)
}

/**
 * Select agent using the specified strategy.
 */
export function selectAgent(
  strategy: SchedulingStrategy,
  agents: readonly AgentConfig[],
  task: Task,
  state: { counter: number; loads: AgentLoad[] },
): string {
  switch (strategy) {
    case 'round-robin':
      return roundRobin(agents, task, state.counter)
    case 'least-busy':
      return leastBusy(agents, task, state.loads)
    case 'capability-match':
      return capabilityMatch(agents, task)
    case 'dependency-first':
      return dependencyFirst(agents, task)
  }
}
