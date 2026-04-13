/**
 * Agent Executor — runs a subagent to completion in an isolated context.
 *
 * Each subagent gets its own AgentRunner with:
 * - Restricted tool set (only tools listed in the agent definition)
 * - Its own conversation history (does NOT pollute parent context)
 * - Its own system prompt
 */

import { Agent } from '../core/agent.js'
import type { LLMAdapter } from '../core/types.js'
import { ToolRegistry } from '../tools/registry.js'
import type { AgentDefinition } from './registry.js'

export interface SubagentResult {
  output: string
  tokensUsed: { input: number; output: number }
  turns: number
}

export class AgentExecutor {
  /**
   * Run a subagent to completion with its own isolated context.
   *
   * @param definition  — The agent definition (from registry)
   * @param task        — The task/question to delegate
   * @param parentModel — The parent agent's model (used if definition.model is null)
   * @param adapter     — The LLM adapter to use
   * @param parentToolRegistry — The parent's full tool registry (we pick allowed tools)
   */
  async execute(
    definition: AgentDefinition,
    task: string,
    parentModel: string,
    adapter: LLMAdapter,
    parentToolRegistry: ToolRegistry,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<SubagentResult> {
    // 1. Create a restricted ToolRegistry with only the agent's allowed tools
    const agentTools = new ToolRegistry()
    for (const toolName of definition.tools) {
      const tool = parentToolRegistry.get(toolName)
      if (tool) agentTools.register(tool)
    }

    // 2. Create Agent with the subagent's config (isolated context)
    const agent = new Agent(
      {
        name: definition.name,
        model: definition.model ?? parentModel,
        systemPrompt: definition.systemPrompt,
        tools: definition.tools,
        maxTurns: definition.maxTurns,
        temperature: definition.temperature,
      },
      adapter,
      agentTools,
      undefined,
      undefined,
      metadata,
    )

    // 3. Run to completion, collecting all text output
    const result = await agent.run(task)

    return {
      output: result.output,
      tokensUsed: {
        input: result.tokenUsage.input_tokens,
        output: result.tokenUsage.output_tokens,
      },
      turns: result.toolCalls.length,
    }
  }
}
