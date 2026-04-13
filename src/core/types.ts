/**
 * Core type definitions for cmdr.
 *
 * All public types are defined here to keep the dependency graph acyclic.
 */

import type { ZodSchema } from 'zod'

// ---------------------------------------------------------------------------
// Effort levels
// ---------------------------------------------------------------------------

export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

export interface EffortConfig {
  readonly thinkingEnabled: boolean | undefined
  readonly temperature: number
  readonly maxTokensMultiplier: number
}

export const EFFORT_CONFIGS: Record<EffortLevel, EffortConfig> = {
  low:    { thinkingEnabled: false, temperature: 0.1, maxTokensMultiplier: 1 },
  medium: { thinkingEnabled: undefined, temperature: 0.3, maxTokensMultiplier: 1 },
  high:   { thinkingEnabled: true, temperature: 0.3, maxTokensMultiplier: 1 },
  max:    { thinkingEnabled: true, temperature: 0.5, maxTokensMultiplier: 2 },
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface TextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface ImageBlock {
  readonly type: 'image'
  readonly source: {
    readonly type: 'base64'
    readonly media_type: string
    readonly data: string
  }
}

export interface ToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

export interface ToolResultBlock {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string
  readonly is_error?: boolean
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

// ---------------------------------------------------------------------------
// LLM messages & responses
// ---------------------------------------------------------------------------

export interface LLMMessage {
  readonly role: 'user' | 'assistant'
  readonly content: ContentBlock[]
  // Compaction metadata (append-only session pattern)
  isCompactSummary?: boolean
  isCompactBoundary?: boolean
  isVisibleInTranscriptOnly?: boolean
  isMeta?: boolean
}

export interface TokenUsage {
  readonly input_tokens: number
  readonly output_tokens: number
}

export interface LLMResponse {
  readonly id: string
  readonly content: ContentBlock[]
  readonly model: string
  readonly stop_reason: string
  readonly usage: TokenUsage
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export interface StreamEvent {
  readonly type: 'text' | 'tool_use' | 'tool_result' | 'done' | 'error'
  readonly data: unknown
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface LLMToolDef {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
}

export interface ToolUseContext {
  readonly agent: AgentInfo
  readonly team?: TeamInfo
  readonly abortSignal?: AbortSignal
  readonly abortController?: AbortController
  readonly cwd?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AgentInfo {
  readonly name: string
  readonly role: string
  readonly model: string
}

export interface TeamInfo {
  readonly name: string
  readonly agents: readonly string[]
  readonly sharedMemory: MemoryStore
}

export interface ToolResult {
  readonly data: string
  readonly isError?: boolean
}

export interface ToolDefinition<TInput = Record<string, unknown>> {
  readonly name: string
  readonly description: string
  readonly inputSchema: ZodSchema<TInput>
  execute(input: TInput, context: ToolUseContext): Promise<ToolResult>
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface AgentConfig {
  readonly name: string
  readonly model?: string
  readonly provider?: 'ollama' | 'openai' | 'anthropic'
  readonly systemPrompt?: string
  readonly tools?: readonly string[]
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly temperature?: number
  /** Override thinking mode: true = force think, false = disable thinking. */
  readonly thinkingEnabled?: boolean
}

export interface AgentState {
  status: 'idle' | 'running' | 'completed' | 'error'
  messages: LLMMessage[]
  tokenUsage: TokenUsage
  error?: Error
}

export interface ToolCallRecord {
  readonly toolName: string
  readonly input: Record<string, unknown>
  readonly output: string
  readonly duration: number
}

export interface AgentRunResult {
  readonly success: boolean
  readonly output: string
  readonly messages: LLMMessage[]
  readonly tokenUsage: TokenUsage
  readonly toolCalls: ToolCallRecord[]
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface TeamConfig {
  readonly name: string
  readonly agents: readonly AgentConfig[]
  readonly sharedMemory?: boolean
  readonly maxConcurrency?: number
  readonly schedulingStrategy?: 'round-robin' | 'least-busy' | 'capability-match' | 'dependency-first'
}

export interface TeamRunResult {
  readonly success: boolean
  readonly agentResults: Map<string, AgentRunResult>
  readonly totalTokenUsage: TokenUsage
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'

export interface Task {
  readonly id: string
  readonly title: string
  readonly description: string
  status: TaskStatus
  assignee?: string
  dependsOn?: readonly string[]
  result?: string
  readonly createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionState {
  id: string
  messages: LLMMessage[]
  tokenCount: number
  maxContextTokens: number
  projectContext: ProjectContext
  createdAt: Date
  lastActivity: Date
}

export interface ProjectContext {
  rootDir: string
  language: string
  framework?: string
  packageManager?: string
  gitBranch?: string
  relevantFiles: string[]
  /** Contents of CMDR.md from the project root, if present. */
  cmdrInstructions?: string
  /** Skills active for this session. */
  activeSkills?: readonly { name: string; instructions: string; scripts: string[] }[]
  /** Whether code-review-graph is available and initialized. */
  graphAvailable?: boolean
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface CmdrPlugin {
  name: string
  version: string
  hooks?: {
    beforePrompt?: (params: LLMChatOptions) => LLMChatOptions | Promise<LLMChatOptions>
    afterResponse?: (result: LLMResponse) => LLMResponse | Promise<LLMResponse>
    beforeToolExec?: (tool: string, input: unknown) => unknown | Promise<unknown>
    afterToolExec?: (tool: string, result: ToolResult) => ToolResult | Promise<ToolResult>
    onError?: (error: Error) => void | Promise<void>
    onSessionStart?: (session: SessionState) => void | Promise<void>
    onSessionEnd?: (session: SessionState) => void | Promise<void>
  }
  tools?: ToolDefinition[]
  commands?: SlashCommand[]
}

export interface SlashCommand {
  name: string
  description: string
  execute: (args: string, context: CommandContext) => Promise<string | void>
}

export interface CommandContext {
  session: SessionState
  switchModel: (model: string) => void
  clearHistory: () => void
  setThinkingMode: (mode: 'on' | 'off' | 'auto') => void
  ollamaUrl: string
  adapter: LLMAdapter
  model: string
  agentTokenUsage: TokenUsage
  permissionManager?: import('./permissions.js').PermissionManager
}

// ---------------------------------------------------------------------------
// Permissions / HITL
// ---------------------------------------------------------------------------

/** Permission mode controls how tool calls are approved. */
export type PermissionMode = 'normal' | 'yolo' | 'strict'

/** Tools classified as read-only are auto-approved in 'normal' mode. */
export type ToolRiskLevel = 'read-only' | 'write' | 'dangerous'

/**
 * User's approval decision for a tool call.
 * - 'allow'       — run this one call
 * - 'deny'        — skip this call, return an error to the model
 * - 'allow-always' — auto-approve all future calls to this tool for the session
 */
export type ApprovalDecision = 'allow' | 'deny' | 'allow-always'

/**
 * Callback the REPL provides so the runner can ask for user approval
 * before executing a dangerous / write tool.
 */
export type ApprovalCallback = (
  toolName: string,
  input: Record<string, unknown>,
  riskLevel: ToolRiskLevel,
) => Promise<ApprovalDecision>

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CmdrConfig {
  ollamaUrl: string
  defaultModel: string
  defaultProvider: 'ollama' | 'openai' | 'anthropic'
  maxConcurrency: number
  maxTurns: number
  contextBudget: number
  autoCompact: boolean
  permissions: {
    allowBash: boolean
    allowFileWrite: boolean
    allowNetwork: boolean
    sandboxDir?: string
    /** Pattern-based rules: "Tool(pattern)" syntax. */
    allow?: string[]
    deny?: string[]
    ask?: string[]
  }
  mcp: {
    servers: McpServerConfig[]
  }
  plugins: string[]
  hooks?: Record<string, string>
}

export interface McpServerConfig {
  name: string
  /** URL for HTTP/SSE transports. */
  url?: string
  apiKey?: string
  /** Transport type: 'http' (default), 'stdio', or 'sse'. Auto-detected if omitted. */
  transport?: 'http' | 'stdio' | 'sse'
  /** Command to spawn for stdio transport. */
  command?: string
  /** Arguments for the stdio command. */
  args?: string[]
  /** Environment variables for the stdio process. */
  env?: Record<string, string>
  /** Working directory for the stdio process. */
  cwd?: string
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface MemoryEntry {
  readonly key: string
  readonly value: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly createdAt: Date
}

export interface MemoryStore {
  get(key: string): Promise<MemoryEntry | null>
  set(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>
  list(): Promise<MemoryEntry[]>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

// ---------------------------------------------------------------------------
// LLM adapter
// ---------------------------------------------------------------------------

export interface LLMChatOptions {
  readonly model: string
  readonly tools?: readonly LLMToolDef[]
  readonly maxTokens?: number
  readonly temperature?: number
  readonly systemPrompt?: string
  readonly abortSignal?: AbortSignal
  /** Override model-family thinking mode: true = force think, false = force no-think, undefined = auto. */
  readonly thinkingEnabled?: boolean
}

export interface LLMStreamOptions extends LLMChatOptions {}

/** Model-specific behavior profile for retry/repair decisions. */
export interface ModelProfile {
  /** Whether to enable retry loop for failed tool calls. */
  readonly retryOnFailure: boolean
  /** Maximum number of tool call retries. */
  readonly maxToolRetries: number
  /** Whether to attempt structural repair before retrying. */
  readonly attemptRepair: boolean
  /** Aggressiveness of correction prompts. */
  readonly correctionStyle: 'gentle' | 'strict'
  /** Use strict tool discipline in prompt. */
  readonly strictToolPrompt: boolean
}

/** Default profile for reliable models (OpenAI, Anthropic). */
export const DEFAULT_MODEL_PROFILE: ModelProfile = {
  retryOnFailure: false,
  maxToolRetries: 0,
  attemptRepair: false,
  correctionStyle: 'gentle',
  strictToolPrompt: false,
}

export interface LLMAdapter {
  readonly name: string
  chat(messages: LLMMessage[], options: LLMChatOptions): Promise<LLMResponse>
  stream(messages: LLMMessage[], options: LLMStreamOptions): AsyncIterable<StreamEvent>
  /** Get model-specific behavior profile for retry/repair decisions. */
  getModelProfile?(model: string): Promise<ModelProfile> | ModelProfile
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorEvent {
  readonly type:
    | 'agent_start'
    | 'agent_complete'
    | 'task_start'
    | 'task_complete'
    | 'message'
    | 'error'
  readonly agent?: string
  readonly task?: string
  readonly data?: unknown
}

export interface OrchestratorConfig {
  readonly maxConcurrency?: number
  readonly defaultModel?: string
  readonly defaultProvider?: 'ollama' | 'openai' | 'anthropic'
  onProgress?: (event: OrchestratorEvent) => void
}
