/**
 * Agent system — subagents as tools.
 */

export { AgentRegistry, type AgentDefinition } from './registry.js'
export { AgentExecutor, type SubagentResult } from './executor.js'
export { createSubagentTool } from './subagent-tool.js'
