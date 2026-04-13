/**
 * Agent — high-level wrapper around AgentRunner.
 *
 * Provides persistent conversation (prompt), fresh-conversation (run), and streaming.
 */

import type {
  LLMAdapter, LLMMessage, AgentConfig, AgentState,
  AgentRunResult, TokenUsage, StreamEvent, ContentBlock,
} from './types.js'
import { AgentRunner, type RunCallbacks, type RunResult } from './agent-runner.js'
import { ToolRegistry } from '../tools/registry.js'
import { ToolExecutor } from '../tools/executor.js'
import type { PermissionManager } from './permissions.js'
import type { GraphContextProvider } from './graph-context.js'

const ZERO_USAGE: TokenUsage = { input_tokens: 0, output_tokens: 0 }

export class Agent {
  readonly config: AgentConfig
  private readonly adapter: LLMAdapter
  private readonly toolRegistry: ToolRegistry
  private readonly toolExecutor: ToolExecutor
  private readonly permissionManager?: PermissionManager
  private readonly metadata?: Readonly<Record<string, unknown>>
  private state: AgentState
  private cwd: string
  private graphContext?: GraphContextProvider

  constructor(
    config: AgentConfig,
    adapter: LLMAdapter,
    toolRegistry: ToolRegistry,
    cwd?: string,
    permissionManager?: PermissionManager,
    metadata?: Readonly<Record<string, unknown>>,
  ) {
    this.config = config
    this.adapter = adapter
    this.toolRegistry = toolRegistry
    this.toolExecutor = new ToolExecutor(toolRegistry)
    this.permissionManager = permissionManager
    this.metadata = metadata
    this.cwd = cwd ?? process.cwd()
    this.state = {
      status: 'idle',
      messages: [],
      tokenUsage: ZERO_USAGE,
    }
  }

  /** Fresh conversation — does not carry history. */
  async run(task: string, callbacks?: RunCallbacks): Promise<AgentRunResult> {
    const messages: LLMMessage[] = [
      { role: 'user', content: [{ type: 'text', text: task }] },
    ]

    this.state.status = 'running'
    try {
      const runner = this.createRunner()
      const result = await runner.run(messages, callbacks)
      this.state.status = 'completed'
      return this.toAgentResult(result)
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err : new Error(String(err))
      throw err
    }
  }

  /** Persistent conversation — appends to history. */
  async prompt(message: string, callbacks?: RunCallbacks): Promise<AgentRunResult> {
    this.state.messages.push({
      role: 'user',
      content: [{ type: 'text', text: message }],
    })

    this.state.status = 'running'
    try {
      const runner = this.createRunner()
      const result = await runner.run(this.state.messages, callbacks)

      // Append new messages to history
      for (const msg of result.messages) {
        this.state.messages.push(msg)
      }

      this.state.tokenUsage = {
        input_tokens: this.state.tokenUsage.input_tokens + result.tokenUsage.input_tokens,
        output_tokens: this.state.tokenUsage.output_tokens + result.tokenUsage.output_tokens,
      }

      this.state.status = 'completed'
      return this.toAgentResult(result)
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err : new Error(String(err))
      throw err
    }
  }

  /** Streaming prompt — yields events in real time. */
  async *stream(message: string, callbacks?: RunCallbacks, abortSignal?: AbortSignal): AsyncGenerator<StreamEvent> {
    this.state.messages.push({
      role: 'user',
      content: [{ type: 'text', text: message }],
    })

    this.state.status = 'running'
    const runner = this.createRunner(abortSignal)

    try {
      for await (const event of runner.stream(this.state.messages, callbacks)) {
        yield event

        if (event.type === 'done') {
          const result = event.data as RunResult
          for (const msg of result.messages) {
            this.state.messages.push(msg)
          }
          this.state.tokenUsage = {
            input_tokens: this.state.tokenUsage.input_tokens + result.tokenUsage.input_tokens,
            output_tokens: this.state.tokenUsage.output_tokens + result.tokenUsage.output_tokens,
          }
          this.state.status = 'completed'
        } else if (event.type === 'error') {
          this.state.status = 'error'
          this.state.error = event.data as Error
        }
      }
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err : new Error(String(err))
    }
  }

  getState(): AgentState { return { ...this.state } }
  getHistory(): LLMMessage[] { return [...this.state.messages] }

  reset(): void {
    this.state = { status: 'idle', messages: [], tokenUsage: ZERO_USAGE }
  }

  /** Replace internal message history (used after compaction). */
  replaceMessages(messages: LLMMessage[]): void {
    this.state.messages = [...messages]
  }

  /** Add a user message with both text and an image attachment. */
  addImageMessage(text: string, base64Data: string, mediaType: string): void {
    this.state.messages.push({
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        },
        { type: 'text', text },
      ],
    })
  }

  setCwd(cwd: string): void {
    this.cwd = cwd
  }

  /** Set the graph context provider for code-review-graph integration. */
  setGraphContext(graphContext: GraphContextProvider): void {
    this.graphContext = graphContext
  }

  /** Update the model used for subsequent LLM calls. */
  setModel(model: string): void {
    (this.config as { model?: string }).model = model
  }

  private createRunner(abortSignal?: AbortSignal): AgentRunner {
    return new AgentRunner(this.adapter, this.toolRegistry, this.toolExecutor, {
      model: this.config.model ?? 'qwen2.5-coder:14b',
      systemPrompt: this.config.systemPrompt,
      maxTurns: this.config.maxTurns ?? 30,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      allowedTools: this.config.tools as string[] | undefined,
      agentName: this.config.name,
      agentRole: 'assistant',
      cwd: this.cwd,
      abortSignal,
      thinkingEnabled: this.config.thinkingEnabled,
      metadata: this.metadata,
      graphContext: this.graphContext,
    }, this.permissionManager)
  }

  private toAgentResult(result: RunResult): AgentRunResult {
    return {
      success: true,
      output: result.output,
      messages: result.messages,
      tokenUsage: result.tokenUsage,
      toolCalls: result.toolCalls,
    }
  }
}
