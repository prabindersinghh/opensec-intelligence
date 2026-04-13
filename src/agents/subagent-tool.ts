/**
 * Subagent Tool — wraps a subagent definition as a standard cmdr tool.
 *
 * When the main agent calls this tool, it:
 * 1. Spins up an isolated subagent with restricted tools
 * 2. Runs the task to completion
 * 3. Returns the subagent's output as the tool result
 *
 * Subagent tools have 'read' permission — they're always safe from HITL
 * perspective because the subagent itself has restricted tools.
 */

import { z } from 'zod'
import { defineTool } from '../tools/registry.js'
import type { AgentDefinition } from './registry.js'
import { AgentExecutor } from './executor.js'
import type { LLMAdapter } from '../core/types.js'
import type { ToolRegistry } from '../tools/registry.js'

/**
 * Create a tool definition that wraps a subagent.
 *
 * @param definition — The agent definition from the registry
 * @param executor   — The shared AgentExecutor instance
 * @param adapter    — The LLM adapter for the subagent to use
 * @param parentToolRegistry — The parent's tool registry (subagent picks from this)
 */
export function createSubagentTool(
  definition: AgentDefinition,
  executor: AgentExecutor,
  adapter: LLMAdapter,
  parentToolRegistry: ToolRegistry,
) {
  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: z.object({
      task: z.string().describe('The specific task or question to delegate to this agent'),
    }),
    execute: async (input, context) => {
      const parentModel = context.agent.model
      const result = await executor.execute(
        definition,
        input.task,
        parentModel,
        adapter,
        parentToolRegistry,
        context.metadata,
      )
      return { data: result.output, isError: false }
    },
  })
}
