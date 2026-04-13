/**
 * cmdr — public API exports.
 *
 * Import from 'cmdr-agent' for programmatic usage.
 */

// Core
export { Agent } from './core/agent.js'
export { AgentRunner } from './core/agent-runner.js'
export { AgentPool } from './core/agent-pool.js'
export { Team } from './core/team.js'
export { Orchestrator } from './core/orchestrator.js'
export {
  SOLO_CODER, CODE_REVIEW_TEAM, FULL_STACK_TEAM, SECURITY_AUDIT_TEAM,
  getPreset, getTeamPreset, listTeamPresets,
} from './core/presets.js'
export { EventBus, globalEventBus } from './core/event-bus.js'
export { PermissionManager } from './core/permissions.js'
export type {
  AgentConfig, AgentState, AgentRunResult,
  LLMAdapter, LLMMessage, LLMResponse, LLMChatOptions,
  StreamEvent, ContentBlock, TextBlock, ToolUseBlock, ToolResultBlock, ImageBlock,
  TokenUsage, ToolCallRecord,
  ToolDefinition, ToolResult, ToolUseContext,
  TeamConfig, TeamRunResult, Task, TaskStatus,
  SessionState, ProjectContext,
  CmdrPlugin, SlashCommand,
  CmdrConfig, OrchestratorConfig, OrchestratorEvent,
  EffortLevel, EffortConfig,
} from './core/types.js'
export { EFFORT_CONFIGS } from './core/types.js'

// Communication
export { MessageBus } from './communication/message-bus.js'
export type { BusMessage } from './communication/message-bus.js'
export { SharedMemory } from './communication/shared-memory.js'
export { TaskQueue } from './communication/task-queue.js'

// Scheduling
export { Semaphore } from './scheduling/semaphore.js'
export { selectAgent } from './scheduling/strategies.js'
export type { SchedulingStrategy } from './scheduling/strategies.js'

// Tools
export { defineTool, ToolRegistry, zodToJsonSchema } from './tools/registry.js'
export { ToolExecutor } from './tools/executor.js'
export { registerBuiltInTools, BUILT_IN_TOOLS } from './tools/built-in/index.js'

// LLM
export { OllamaAdapter } from './llm/ollama.js'
export { OpenAIAdapter } from './llm/openai.js'
export { AnthropicAdapter } from './llm/anthropic.js'
export { createAdapter } from './llm/provider-factory.js'
export type { ProviderName, ProviderOptions } from './llm/provider-factory.js'
export { getModelInfo, getDefaultContextLength, getRecommendedModel } from './llm/model-registry.js'
export { countTokens, countMessageTokens } from './llm/token-counter.js'

// Session
export { SessionManager } from './session/session-manager.js'
export { CheckpointManager } from './session/checkpoint-manager.js'
export { BranchManager } from './session/branch-manager.js'
export { discoverProject } from './session/project-context.js'
export { buildSystemPrompt, PromptBuilder, PROMPT_PRIORITIES } from './session/prompt-builder.js'
export type { PromptModule, PromptBuildOptions } from './session/prompt-builder.js'
export { compactHistory, shouldCompact, DEFAULT_COMPACTION_CONFIG } from './session/compaction.js'
export type { CompactionConfig } from './session/compaction.js'
export { saveSession, loadSession, listSessions, findRecentSession, DebouncedSaver, appendSessionMessage, writeSessionMeta, appendCompactMarker } from './session/session-persistence.js'
export type { SavedSession } from './session/session-persistence.js'
export { CostTracker } from './session/cost-tracker.js'
export type { CostEntry, CostSummary } from './session/cost-tracker.js'
export { UndoManager } from './session/undo-manager.js'
export type { FileChange } from './session/undo-manager.js'

// Memory
export { MemoryManager } from './memory/memory-manager.js'

// Plugins & MCP
export { PluginManager } from './plugins/plugin-manager.js'
export { McpClient } from './plugins/mcp-client.js'

// Config
export { loadConfig, getUserConfigPath, getProjectConfigPath } from './config/config-loader.js'
export { DEFAULT_CONFIG } from './config/defaults.js'
export { Telemetry } from './config/telemetry.js'
export type { TelemetryEvent } from './config/telemetry.js'

// CLI
export { startRepl } from './cli/repl.js'

// Server
export { startServer } from './server/index.js'
export type { ServeOptions } from './server/index.js'
