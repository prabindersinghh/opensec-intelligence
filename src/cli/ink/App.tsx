/**
 * Ink-based REPL application — replaces raw readline.
 *
 * Architecture:
 * - Windowed transcript viewport for bounded scrollback rendering
 * - Dynamic section: active spinner, approval prompts, and input composer
 * - State machine: idle | processing | waiting_approval | exiting
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { Agent } from '../../core/agent.js'
import type { SessionManager } from '../../session/session-manager.js'
import type { PermissionManager } from '../../core/permissions.js'
import type { LLMAdapter, ToolUseBlock, ToolResultBlock, ApprovalDecision, ToolRiskLevel, TeamConfig } from '../../core/types.js'
import type { Orchestrator } from '../../core/orchestrator.js'
import type { RunCallbacks } from '../../core/agent-runner.js'
import { getDefaultContextLength } from '../../llm/model-registry.js'
import { isSlashCommand, parseSlashCommand, getCommand } from '../commands.js'
import {
  saveSession, loadSession, listSessions, findRecentSession, DebouncedSaver,
} from '../../session/session-persistence.js'
import { getTeamPreset } from '../../core/presets.js'
import type { CostTracker } from '../../session/cost-tracker.js'
import type { UndoManager } from '../../session/undo-manager.js'
import type { PluginManager } from '../../plugins/plugin-manager.js'
import type { McpClient } from '../../plugins/mcp-client.js'
import type { ToolRegistry } from '../../tools/registry.js'
import type { AgentRegistry } from '../../agents/registry.js'
import type { CommandLoader } from '../../commands/loader.js'
import type { TaskScheduler } from '../../scheduling/task-scheduler.js'
import { listAvailableServers, getServerDefinition, toMcpConfig, getMissingEnvVars } from '../../config/mcp-registry.js'
import StatusBar from './StatusBar.js'
import PromptInput from './PromptInput.js'
import { StreamingMarkdownRenderer } from '../renderer.js'
import {
  GREEN,
  PURPLE,
  CYAN,
  DIM,
  WHITE,
  YELLOW,
  RED,
  SEPARATOR,
} from '../theme.js'

const SUCCESS_SYM = GREEN('✓')
const ERROR_SYM = RED('✗')

// ---------------------------------------------------------------------------
// Verb pool for spinner
// ---------------------------------------------------------------------------

const VERBS = [
  'Computing', 'Architecting', 'Bootstrapping', 'Compiling', 'Debugging',
  'Refactoring', 'Profiling', 'Indexing', 'Optimizing', 'Parsing',
  'Noodling', 'Percolating', 'Combobulating', 'Bamboozling', 'Cogitating',
  'Ruminating', 'Pondering', 'Brainstorming', 'Concocting', 'Devising',
  'Simmering', 'Marinating', 'Fermenting', 'Whisking', 'Reducing',
  'Moonwalking', 'Pirouetting', 'Sashaying', 'Waltzing', 'Commanding',
  'Strategizing', 'Maneuvering', 'Rallying', 'Scouting', 'Dispatching',
  'Crystallizing', 'Metamorphosing', 'Germinating', 'Blooming', 'Coalescing',
  'Weaving', 'Sculpting', 'Tinkering', 'Trailblazing', 'Questing',
]

function pickVerb(): string {
  return VERBS[Math.floor(Math.random() * VERBS.length)]
}

function toPastTense(verb: string): string {
  if (!verb.endsWith('ing')) return verb
  const stem = verb.slice(0, -3)
  const last = stem[stem.length - 1]
  if (last && 'bcdfghjklmnpqrstvwxyz'.includes(last.toLowerCase())) {
    return stem + 'ed'
  }
  return stem + 'ed'
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReplState = 'idle' | 'processing' | 'waiting_approval' | 'exiting'

interface OutputLine {
  id: string
  text: string
}

const MAX_OUTPUT_LINES = 6000

interface ApprovalRequest {
  toolName: string
  input: Record<string, unknown>
  riskLevel: ToolRiskLevel
  resolve: (decision: ApprovalDecision) => void
}

export interface InkAppProps {
  agent: Agent
  session: SessionManager
  model: string
  permissionManager: PermissionManager
  adapter: LLMAdapter
  orchestrator: Orchestrator
  activeTeamConfig?: TeamConfig
  costTracker: CostTracker
  undoManager: UndoManager
  pluginManager: PluginManager
  mcpClient: McpClient
  toolRegistry: ToolRegistry
  agentRegistry: AgentRegistry
  commandLoader: CommandLoader
  taskScheduler: TaskScheduler
  ollamaUrl: string
  verbose: boolean
  doSave: () => Promise<void>
  autoSaver: DebouncedSaver
  version?: string
  gitBranch?: string
  welcomeBanner?: string
}

// ---------------------------------------------------------------------------
// Tool result summary
// ---------------------------------------------------------------------------

function summarizeToolResult(
  toolName: string,
  input: Record<string, unknown>,
  content: string,
  isError?: boolean,
): string {
  const lineCount = content.split('\n').length
  const prefix = isError ? ERROR_SYM : SUCCESS_SYM
  let summary: string

  switch (toolName) {
    case 'file_read': {
      const file = (input.path as string) ?? 'unknown'
      const fname = file.split('/').pop() ?? file
      summary = `${fname} (${lineCount} lines)`
      break
    }
    case 'glob': {
      const pattern = (input.pattern as string) ?? '*'
      const matches = content === '(no matches)' ? 0 : lineCount
      summary = `${pattern} (${matches} matches)`
      break
    }
    case 'bash': {
      const cmd = (input.command as string) ?? ''
      const truncCmd = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd
      const exitMatch = content.match(/\[exit code: (\d+)\]/)
      const exitCode = exitMatch ? exitMatch[1] : '0'
      summary = `\`${truncCmd}\` exit=${exitCode} (${lineCount} lines)`
      break
    }
    case 'grep': {
      const pattern = (input.pattern as string) ?? ''
      const matches = content === '(no matches)' ? 0 : lineCount
      summary = `/${pattern}/ (${matches} matches)`
      break
    }
    case 'think': {
      const thought = (input.thought as string) ?? ''
      const preview = thought.length > 60 ? thought.slice(0, 57) + '...' : thought
      summary = preview
      break
    }
    default: {
      const bytes = Buffer.byteLength(content, 'utf-8')
      summary = `${bytes > 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' B'}`
      break
    }
  }

  return `  ${prefix} ${DIM(toolName)}  ${DIM(summary)}`
}

// ---------------------------------------------------------------------------
// Main App Component
// ---------------------------------------------------------------------------

let lineCounter = 0
function nextId(): string {
  return `line-${++lineCounter}`
}

export default function App(props: InkAppProps): React.ReactElement {
  const {
    agent, session, permissionManager, adapter,
    orchestrator, costTracker, undoManager,
    pluginManager, mcpClient, toolRegistry, agentRegistry, commandLoader, taskScheduler, ollamaUrl, verbose,
    doSave, autoSaver,
  } = props

  const { exit } = useApp()

  const [state, setState] = useState<ReplState>('idle')
  const [outputLines, setOutputLines] = useState<OutputLine[]>(() => {
    if (props.welcomeBanner) {
      return props.welcomeBanner.split('\n').map(text => ({ id: nextId(), text }))
    }
    return []
  })
  const [historyScrollOffset, setHistoryScrollOffset] = useState(0)
  const [spinnerText, setSpinnerText] = useState('')
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)
  const [approvalInput, setApprovalInput] = useState('')
  const approvalQueueRef = useRef<ApprovalRequest[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const [tokensIn, setTokensIn] = useState(0)
  const [tokensOut, setTokensOut] = useState(0)
  const [turnCount, setTurnCount] = useState(0)
  const planModeRef = useRef(false)
  const pendingImageRef = useRef<string | null>(null)

  const currentModelRef = useRef(props.model)
  const activeTeamRef = useRef(props.activeTeamConfig)
  const stateRef = useRef<ReplState>(state)
  const lastSigintRef = useRef(0)

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Append output to scrollback
  const appendOutput = useCallback((text: string) => {
    setHistoryScrollOffset(0)
    setOutputLines(prev => {
      const next = [...prev, { id: nextId(), text }]
      return next.length > MAX_OUTPUT_LINES ? next.slice(next.length - MAX_OUTPUT_LINES) : next
    })
  }, [])

  // Append multiple lines at once
  const appendLines = useCallback((lines: string[]) => {
    if (lines.length === 0) return
    setHistoryScrollOffset(0)
    setOutputLines(prev => {
      const next = [
        ...prev,
        ...lines.map(text => ({ id: nextId(), text })),
      ]
      return next.length > MAX_OUTPUT_LINES ? next.slice(next.length - MAX_OUTPUT_LINES) : next
    })
  }, [])

  const appendRenderedMarkdown = useCallback((rendered: string) => {
    if (!rendered) return
    const prefixed = rendered
      .split('\n')
      .map((line) => `  ${PURPLE('│')} ${line}`)
    appendLines(prefixed)
  }, [appendLines])

  const terminalRows = process.stdout.rows || 42
  const reservedRows = state === 'idle' ? 9 : state === 'waiting_approval' ? 13 : 6
  const historyWindowSize = Math.max(8, terminalRows - reservedRows)

  const visibleOutputLines = useMemo(() => {
    const end = Math.max(0, outputLines.length - historyScrollOffset)
    const start = Math.max(0, end - historyWindowSize)
    return outputLines.slice(start, end)
  }, [outputLines, historyScrollOffset, historyWindowSize])

  // ---------------------------------------------------------------------------
  // Spinner management
  // ---------------------------------------------------------------------------

  const spinnerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const verbRef = useRef(pickVerb())
  const spinnerStartRef = useRef(0)
  const turnStartRef = useRef(0)
  const lastVerbRotateSecondRef = useRef(0)
  const spinnerFrameRef = useRef(0)
  const SPINNER_FRAMES = ['◇ ', '◈ ', '◆ ', '◈ ']

  const startSpinner = useCallback((mode: 'thinking' | 'tool', toolName?: string) => {
    stopSpinnerFn()
    spinnerStartRef.current = Date.now()
    verbRef.current = pickVerb()
    lastVerbRotateSecondRef.current = 0
    spinnerFrameRef.current = 0

    if (mode === 'tool') {
      setSpinnerText(`  ${CYAN('⚡')} ${CYAN(toolName ?? 'tool')} ${DIM('executing...')}`)
      return
    }

    const update = () => {
      spinnerFrameRef.current = (spinnerFrameRef.current + 1) % SPINNER_FRAMES.length
      const frame = SPINNER_FRAMES[spinnerFrameRef.current]
      const elapsed = Math.round((Date.now() - spinnerStartRef.current) / 1000)

      // Rotate verb every ~3s, once per threshold crossing.
      if (
        elapsed > 0 &&
        elapsed % 3 === 0 &&
        elapsed !== lastVerbRotateSecondRef.current
      ) {
        verbRef.current = pickVerb()
        lastVerbRotateSecondRef.current = elapsed
      }

      setSpinnerText(`  ${PURPLE(frame)}${PURPLE(verbRef.current + '...')} ${DIM(`(${elapsed}s)`)}`)
    }

    update()
    spinnerRef.current = setInterval(update, 120)
  }, [])

  const stopSpinnerFn = useCallback(() => {
    if (spinnerRef.current) {
      clearInterval(spinnerRef.current)
      spinnerRef.current = null
    }
    setSpinnerText('')
  }, [])

  const getCompletionSummary = useCallback(() => {
    const start = turnStartRef.current || spinnerStartRef.current
    const elapsed = Math.round((Date.now() - start) / 1000)
    return `${toPastTense(verbRef.current)} for ${elapsed}s`
  }, [])

  // ---------------------------------------------------------------------------
  // Cleanup & Exit
  // ---------------------------------------------------------------------------

  const cleanupAndExit = useCallback(async () => {
    if (stateRef.current === 'exiting') return
    setState('exiting')
    stopSpinnerFn()

    autoSaver.cancel()
    session.syncFromAgent(agent.getHistory())
    if (session.messages.length > 0) {
      try {
        const sid = await saveSession(session.getState(), currentModelRef.current)
        appendOutput(`\n  ${DIM('Session saved:')} ${DIM(sid)}`)
      } catch {
        // best effort
      }
    }
    appendOutput(`\n  ${PURPLE('Goodbye.')} ${DIM('Session ended.')}\n`)

    // Give Ink a moment to render the final output
    setTimeout(() => {
      exit()
      process.exit(0)
    }, 100)
  }, [agent, session, autoSaver, stopSpinnerFn, appendOutput, exit])

  // Signal handlers
  useEffect(() => {
    const onSigterm = () => { cleanupAndExit() }
    process.on('SIGTERM', onSigterm)
    process.on('SIGHUP', onSigterm)
    return () => {
      process.off('SIGTERM', onSigterm)
      process.off('SIGHUP', onSigterm)
    }
  }, [cleanupAndExit])

  // ---------------------------------------------------------------------------
  // Handle user message (streaming)
  // ---------------------------------------------------------------------------

  const handleUserMessage = useCallback(async (message: string) => {
    turnStartRef.current = Date.now()
    appendOutput('')

    startSpinner('thinking')

    const streamRenderer = new StreamingMarkdownRenderer({
      width: Math.max(60, (process.stdout.columns || 96) - 8),
    })
    let firstText = true
    let hadTextOutput = false
    let currentTool = ''
    let currentToolInput: Record<string, unknown> = {}
    let toolCallCount = 0

    const abortController = new AbortController()
    abortRef.current = abortController

    const callbacks: RunCallbacks = {
      onToolApproval: (toolName, input, riskLevel) => {
        return new Promise<ApprovalDecision>((resolve) => {
          stopSpinnerFn()
          const request: ApprovalRequest = { toolName, input, riskLevel, resolve }
          // If we're already showing an approval prompt, queue this one
          if (stateRef.current === 'waiting_approval') {
            approvalQueueRef.current.push(request)
          } else {
            setApproval(request)
            setState('waiting_approval')
          }
        })
      },
    }

    // ── Pre-call compaction: prevent context overflow before hitting the LLM ──
    session.syncFromAgent(agent.getHistory())
    const contextLimit = getDefaultContextLength(currentModelRef.current)
    if (session.tokenCount > contextLimit * 0.70) {
      try {
        // Auto-checkpoint before compaction
        const { CheckpointManager } = await import('../../session/checkpoint-manager.js')
        const cpMgr = new CheckpointManager(session.id ?? 'default')
        await cpMgr.save('auto-pre-compact', agent.getHistory(), currentModelRef.current).catch(() => {})
        const stats = await session.compact(adapter, currentModelRef.current)
        agent.replaceMessages(session.messages)
        appendOutput(`  ${DIM(`◇ pre-compacted: ${stats.before} → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)
      } catch {
        // best effort — will try emergency compaction on failure
      }
    }

    try {
      for await (const event of agent.stream(message, callbacks, abortController.signal)) {
        switch (event.type) {
          case 'text': {
            if (firstText) {
              stopSpinnerFn()
              firstText = false
            }
            const chunk = event.data as string
            const rendered = streamRenderer.push(chunk)
            if (rendered) {
              hadTextOutput = true
              appendRenderedMarkdown(rendered)
            }
            break
          }

          case 'tool_use': {
            stopSpinnerFn()
            const rendered = streamRenderer.flush()
            if (rendered) {
              hadTextOutput = true
              appendRenderedMarkdown(rendered)
              appendOutput('')
            }
            firstText = true
            const block = event.data as ToolUseBlock
            currentTool = block.name
            currentToolInput = block.input
            toolCallCount++

            if (undoManager && (block.name === 'file_write' || block.name === 'file_edit')) {
              const filePath = (block.input.path ?? block.input.file_path) as string | undefined
              if (filePath) {
                await undoManager.recordBefore(filePath, block.name === 'file_write' ? 'write' : 'edit')
              }
            }

            // Render tool exec line
            const toolSummary = Object.entries(block.input)
              .map(([k, v]) => {
                const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
                return `${DIM(k + ':')} ${WHITE(val)}`
              })
              .join(' ')
            appendOutput(`  ${YELLOW('⟳')} ${CYAN.bold(block.name)} ${toolSummary}`)
            startSpinner('tool', block.name)
            break
          }

          case 'tool_result': {
            stopSpinnerFn()
            const block = event.data as ToolResultBlock

            if (verbose) {
              const truncated = block.content.length > 2000
                ? block.content.slice(0, 2000) + DIM('\n... (truncated)')
                : block.content
              const prefix = block.is_error ? ERROR_SYM : SUCCESS_SYM
              appendOutput(`  ${prefix} ${DIM(currentTool + ':')} ${block.is_error ? RED(truncated) : DIM(truncated)}`)
            } else {
              appendOutput(summarizeToolResult(currentTool, currentToolInput, block.content, block.is_error))
            }

            currentTool = ''
            currentToolInput = {}
            startSpinner('thinking')
            firstText = true
            break
          }

          case 'done': {
            const rendered = streamRenderer.flush()
            if (rendered) {
              hadTextOutput = true
              appendRenderedMarkdown(rendered)
            }
            stopSpinnerFn()
            break
          }

          case 'error': {
            stopSpinnerFn()
            const err = event.data as Error
            appendOutput(`\n  ${ERROR_SYM} ${RED.bold(err.message)}\n`)
            break
          }
        }
      }
    } catch (err) {
      stopSpinnerFn()
      const msg = err instanceof Error ? err.message : String(err)
      // ── Emergency compaction on context overflow ──
      const isContextOverflow = msg.includes('context') || msg.includes('too long') ||
        msg.includes('exceeds') || msg.includes('num_ctx') || msg.includes('out of memory')

      if (isContextOverflow) {
        appendOutput(`  ${YELLOW('⚠')} ${DIM('Context overflow detected — emergency compacting...')}`)
        session.syncFromAgent(agent.getHistory())
        session.emergencyCompact()
        agent.replaceMessages(session.messages)
        appendOutput(`  ${DIM('◇ emergency compacted — retrying...')}`)

        // Retry once with compacted context
        try {
          startSpinner('thinking')
          streamRenderer.reset()
          firstText = true
          hadTextOutput = false
          for await (const event of agent.stream('', callbacks, abortController.signal)) {
            switch (event.type) {
              case 'text': {
                if (firstText) { stopSpinnerFn(); firstText = false }
                const rendered = streamRenderer.push(event.data as string)
                if (rendered) {
                  hadTextOutput = true
                  appendRenderedMarkdown(rendered)
                }
                break
              }
              case 'tool_use': {
                stopSpinnerFn()
                const rendered = streamRenderer.flush()
                if (rendered) {
                  hadTextOutput = true
                  appendRenderedMarkdown(rendered)
                  appendOutput('')
                }
                const block = event.data as ToolUseBlock
                currentTool = block.name
                currentToolInput = block.input
                toolCallCount++
                const toolSummary = Object.entries(block.input)
                  .map(([k, v]) => {
                    const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
                    return `${DIM(k + ':')} ${WHITE(val)}`
                  }).join(' ')
                appendOutput(`  ${YELLOW('⟳')} ${CYAN.bold(block.name)} ${toolSummary}`)
                startSpinner('tool', block.name)
                break
              }
              case 'tool_result': {
                stopSpinnerFn()
                const block = event.data as ToolResultBlock
                appendOutput(summarizeToolResult(currentTool, currentToolInput, block.content, block.is_error))
                currentTool = ''
                currentToolInput = {}
                startSpinner('thinking')
                firstText = true
                break
              }
              case 'done': { stopSpinnerFn(); break }
              case 'error': {
                stopSpinnerFn()
                appendOutput(`\n  ${ERROR_SYM} ${RED.bold((event.data as Error).message)}\n`)
                break
              }
            }
          }

          const retryRemainder = streamRenderer.flush()
          if (retryRemainder) {
            hadTextOutput = true
            appendRenderedMarkdown(retryRemainder)
          }
        } catch (retryErr) {
          stopSpinnerFn()
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
          appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Retry after compaction failed: ${retryMsg}`)}\n`)
        }
      } else if (msg.includes('not found') || msg.includes('404') || (msg.includes('model') && msg.includes('pull'))) {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(
          `Model '${currentModelRef.current}' not found. Run ${GREEN('/models')} to see available models or ${GREEN('/model <name>')} to switch.`,
        )}\n`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
      }
    }

    const remainder = streamRenderer.flush()
    if (remainder) {
      hadTextOutput = true
      appendRenderedMarkdown(remainder)
    }

    if (hadTextOutput || !firstText) {
      appendOutput('')
    }

    // Turn summary
    const agentState = agent.getState()
    const tokens = agentState.tokenUsage
    const summary = getCompletionSummary()
    const tokenInfo = tokens.input_tokens > 0 || tokens.output_tokens > 0
      ? `  ${DIM('·')}  ${DIM(`${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`
      : ''
    appendOutput(`  ${DIM(summary)}${tokenInfo}`)

    costTracker.record(currentModelRef.current, tokens.input_tokens, tokens.output_tokens, toolCallCount)
    setTokensIn(prev => prev + tokens.input_tokens)
    setTokensOut(prev => prev + tokens.output_tokens)
    setTurnCount(prev => prev + 1)
    session.syncFromAgent(agent.getHistory())

    // Auto-compact if needed
    if (session.shouldCompact()) {
      try {
        // Auto-checkpoint before compaction
        const { CheckpointManager } = await import('../../session/checkpoint-manager.js')
        const cpMgr = new CheckpointManager(session.id ?? 'default')
        await cpMgr.save('auto-pre-compact', agent.getHistory(), currentModelRef.current).catch(() => {})
        const stats = await session.compact(adapter, currentModelRef.current)
        agent.replaceMessages(session.messages)
        appendOutput(`  ${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)
      } catch {
        // best effort
      }
    }

    autoSaver.schedule(doSave)
    appendOutput(SEPARATOR)
    appendOutput('')
    }, [agent, session, adapter, costTracker, undoManager, verbose, autoSaver, doSave,
      appendOutput, appendRenderedMarkdown, startSpinner, stopSpinnerFn, getCompletionSummary])

  // ---------------------------------------------------------------------------
  // Handle team message
  // ---------------------------------------------------------------------------

  const handleTeamMessage = useCallback(async (goal: string, teamConfig: TeamConfig) => {
    turnStartRef.current = Date.now()
    appendOutput('')
    appendOutput(`  ${PURPLE('◈')} Running team ${PURPLE.bold(teamConfig.name)} with ${teamConfig.agents.length} agents...`)
    appendOutput('')
    startSpinner('thinking')

    try {
      const result = await orchestrator.runTeam(teamConfig, goal)
      stopSpinnerFn()

      for (const [agentName, agentResult] of result.agentResults) {
        const status = agentResult.success ? GREEN('✓') : RED('✗')
        appendOutput(`  ${status} ${CYAN(agentName)}`)

        if (agentResult.output) {
          const lines = agentResult.output.split('\n')
          const displayLines = verbose ? lines : lines.slice(0, 20)
          for (const line of displayLines) {
            appendOutput(`  ${PURPLE('│')} ${line}`)
          }
          if (!verbose && lines.length > 20) {
            appendOutput(`  ${PURPLE('│')} ${DIM(`... ${lines.length - 20} more lines (use --verbose)`)}`)
          }
          appendOutput('')
        }

        if (agentResult.toolCalls.length > 0) {
          const tools = agentResult.toolCalls.map(t => t.toolName)
          const unique = [...new Set(tools)]
          appendOutput(`  ${DIM(`  tools: ${unique.join(', ')} (${tools.length} calls)`)}`)
        }
      }

      const usage = result.totalTokenUsage
      const summary = getCompletionSummary()
      const tokenInfo = `${usage.input_tokens} in / ${usage.output_tokens} out`
      appendOutput(`  ${DIM(summary)}  ${DIM('·')}  ${DIM(tokenInfo)}`)
      appendOutput(`  ${result.success ? GREEN('Team completed successfully') : RED('Team had failures')}`)
    } catch (err) {
      stopSpinnerFn()
      const msg = err instanceof Error ? err.message : String(err)
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
    }

    appendOutput(SEPARATOR)
    appendOutput('')
  }, [orchestrator, verbose, appendOutput, startSpinner, stopSpinnerFn, getCompletionSummary])

  // ---------------------------------------------------------------------------
  // Process slash commands
  // ---------------------------------------------------------------------------

  const processCommand = useCallback(async (input: string): Promise<boolean> => {
    const { name, args } = parseSlashCommand(input)
    const cmd = getCommand(name)
    if (!cmd) {
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Unknown command: /${name}. Type /help for available commands.`)}\n`)
      return false
    }

    const result = await cmd.execute(args, {
      session: session.getState(),
      switchModel: (model: string) => {
        currentModelRef.current = model
        agent.setModel(model)
        session.updateContextLength(getDefaultContextLength(model))
        // Reset token counters for the new model
        costTracker.reset()
        setTokensIn(0)
        setTokensOut(0)
        setTurnCount(0)
      },
      clearHistory: () => {
        session.clear()
        agent.reset()
        permissionManager.resetSession()
      },
      setThinkingMode: (mode: 'on' | 'off' | 'auto') => {
        const cfg = agent.config as unknown as { thinkingEnabled?: boolean; temperature?: number }
        if (mode === 'on') {
          cfg.thinkingEnabled = true
          cfg.temperature = undefined
        } else if (mode === 'off') {
          cfg.thinkingEnabled = false
          cfg.temperature = 0.2
        } else {
          cfg.thinkingEnabled = undefined
          cfg.temperature = undefined
        }
      },
      ollamaUrl,
      adapter,
      model: currentModelRef.current,
      agentTokenUsage: agent.getState().tokenUsage,
      permissionManager,
    })

    if (result === '__QUIT__') {
      await cleanupAndExit()
      return true
    }

    if (result === '__COMPACT__') {
      session.syncFromAgent(agent.getHistory())
      // Auto-checkpoint before compaction
      const { CheckpointManager: CpMgr } = await import('../../session/checkpoint-manager.js')
      const cpMgr = new CpMgr(session.id ?? 'default')
      await cpMgr.save('auto-pre-compact', agent.getHistory(), currentModelRef.current).catch(() => {})
      const stats = await session.compact(adapter, currentModelRef.current)
      agent.replaceMessages(session.messages)
      appendOutput(`  ${DIM('ℹ')} ${WHITE(`${DIM(`◇ compacted: ${stats.before} messages → ${stats.after} messages (saved ~${stats.tokensSaved} tokens)`)}`)}`)
      return false
    }

    if (result === '__DIFF__') {
      const gitTool = toolRegistry.get('git_diff')
      if (gitTool) {
        const diffResult = await gitTool.execute({ staged: false }, {
          agent: { name: 'cmdr', role: 'assistant', model: currentModelRef.current },
          cwd: process.cwd(),
        })
        appendOutput(`\n${WHITE(diffResult.data)}\n`)
      }
      return false
    }

    // /review command — get diff and send as structured review prompt
    if (typeof result === 'string' && result.startsWith('__REVIEW__:')) {
      const reviewArgs = result.slice('__REVIEW__:'.length).trim()
      const gitTool = toolRegistry.get('git_diff')
      if (!gitTool) {
        appendOutput(`  ${ERROR_SYM} ${RED('git_diff tool not available.')}`)
        return false
      }

      // Parse review args: --staged, range (e.g. HEAD~3..HEAD), or path
      let diffInput: Record<string, unknown> = {}
      if (!reviewArgs) {
        // Default: HEAD~1..HEAD
        diffInput = { range: 'HEAD~1..HEAD' }
      } else if (reviewArgs === '--staged') {
        diffInput = { staged: true }
      } else if (reviewArgs.includes('..')) {
        // Commit range like HEAD~3..HEAD
        const parts = reviewArgs.split(/\s+/)
        diffInput = { range: parts[0] }
        if (parts[1]) diffInput.path = parts[1]
      } else {
        // Path scope
        diffInput = { range: 'HEAD~1..HEAD', path: reviewArgs }
      }

      const diffResult = await gitTool.execute(diffInput, {
        agent: { name: 'cmdr', role: 'assistant', model: currentModelRef.current },
        cwd: process.cwd(),
      })

      if (diffResult.isError || diffResult.data === '(no changes)') {
        appendOutput(`  ${DIM('ℹ')} ${WHITE(diffResult.data)}`)
        return false
      }

      const reviewPrompt = `Please review the following git diff. Analyze for:\n1. **Logic errors** — incorrect behavior, off-by-one, wrong conditions\n2. **Security** — injection, exposure, auth gaps\n3. **Performance** — unnecessary work, missing caching, O(n²) patterns\n4. **Style** — naming, consistency, readability\n5. **Error handling** — missing catches, swallowed errors, unclear messages\n\nBe specific. Reference line numbers and file names. Suggest fixes where applicable.\n\n\`\`\`diff\n${diffResult.data}\n\`\`\``

      await handleUserMessage(reviewPrompt)
      return false
    }

    // /effort command — set effort level
    if (typeof result === 'string' && result.startsWith('__EFFORT__:')) {
      const level = result.slice('__EFFORT__:'.length) as import('../../core/types.js').EffortLevel
      const { EFFORT_CONFIGS } = await import('../../core/types.js')
      const config = EFFORT_CONFIGS[level]
      const cfg = agent.config as unknown as { thinkingEnabled?: boolean; temperature?: number }
      cfg.thinkingEnabled = config.thinkingEnabled
      cfg.temperature = config.temperature
      const levelColors: Record<string, (s: string) => string> = { low: GREEN, medium: YELLOW, high: PURPLE, max: RED }
      const colorFn = levelColors[level] || WHITE
      appendOutput(`  ${DIM('ℹ')} ${WHITE('Effort:')} ${colorFn(level)} ${DIM(`(think=${config.thinkingEnabled ?? 'auto'}, temp=${config.temperature})`)}`)
      return false
    }

    // /image command — set pending image for next prompt
    if (typeof result === 'string' && result.startsWith('__IMAGE__:')) {
      const imgPath = result.slice('__IMAGE__:'.length)
      const { existsSync } = await import('fs')
      const { resolve } = await import('path')
      const resolvedPath = resolve(imgPath)
      if (!existsSync(resolvedPath)) {
        appendOutput(`  ${ERROR_SYM} ${RED(`Image not found: ${imgPath}`)}`)
      } else {
        pendingImageRef.current = resolvedPath
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Image attached: ${GREEN(imgPath)} — will be included in your next message`)}`)
      }
      return false
    }

    // /checkpoint command
    if (typeof result === 'string' && result.startsWith('__CHECKPOINT__:')) {
      const { CheckpointManager } = await import('../../session/checkpoint-manager.js')
      const cpManager = new CheckpointManager(session.id ?? 'default')
      const payload = result.slice('__CHECKPOINT__:'.length)

      if (payload === 'list') {
        const checkpoints = await cpManager.list()
        if (checkpoints.length === 0) {
          appendOutput(`  ${DIM('No checkpoints saved. Use /checkpoint save [label]')}`)
        } else {
          const lines = ['', `  ${PURPLE.bold('Checkpoints')}`, '']
          for (const cp of checkpoints) {
            const date = new Date(cp.createdAt)
            const timeStr = date.toLocaleTimeString()
            lines.push(`  ${GREEN('•')} ${DIM(cp.id.slice(0, 20))}  ${WHITE(cp.label)}  ${DIM(cp.model)}  ${DIM(timeStr)}  ${DIM(`${cp.messageCount} msgs`)}`)
          }
          lines.push('')
          appendLines(lines)
        }
      } else if (payload.startsWith('save:')) {
        const label = payload.slice('save:'.length)
        session.syncFromAgent(agent.getHistory())
        const cp = await cpManager.save(label, session.messages, currentModelRef.current)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Checkpoint saved: ${GREEN(cp.label)} (${cp.messageCount} messages)`)}`)
      } else if (payload.startsWith('restore:')) {
        const id = payload.slice('restore:'.length)
        const cp = await cpManager.restore(id)
        if (cp) {
          agent.replaceMessages(cp.messages)
          session.syncFromAgent(cp.messages)
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Restored checkpoint: ${GREEN(cp.label)} (${cp.messageCount} messages)`)}`)
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Checkpoint not found: ${id}`)}`)
        }
      } else if (payload.startsWith('delete:')) {
        const id = payload.slice('delete:'.length)
        const deleted = await cpManager.delete(id)
        if (deleted) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('Checkpoint deleted.')}`)
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Checkpoint not found: ${id}`)}`)
        }
      }
      return false
    }

    // /fork, /branches, /switch, /merge commands
    if (typeof result === 'string' && result.startsWith('__BRANCH__:')) {
      const { BranchManager } = await import('../../session/branch-manager.js')
      const brManager = new BranchManager(session.id ?? 'default')
      const payload = result.slice('__BRANCH__:'.length)

      if (payload === 'list') {
        const branches = await brManager.list()
        if (branches.length === 0) {
          appendOutput(`  ${DIM('No branches. Use /fork [name] to create one.')}`)
        } else {
          const lines = ['', `  ${PURPLE.bold('Branches')}`, '']
          for (const br of branches) {
            const date = new Date(br.createdAt)
            const timeStr = date.toLocaleTimeString()
            const active = br.id === brManager.activeBranch ? ` ${GREEN('← active')}` : ''
            lines.push(`  ${GREEN('•')} ${DIM(br.id.slice(0, 20))}  ${WHITE(br.name)}  ${DIM(timeStr)}  ${DIM(`${br.messageCount} msgs`)}${active}`)
          }
          lines.push('')
          appendLines(lines)
        }
      } else if (payload.startsWith('fork:')) {
        const name = payload.slice('fork:'.length)
        session.syncFromAgent(agent.getHistory())
        const br = await brManager.fork(name, session.messages, currentModelRef.current)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Forked branch: ${GREEN(br.name)} (${br.messageCount} messages)`)}`)
      } else if (payload.startsWith('switch:')) {
        const id = payload.slice('switch:'.length)
        const br = await brManager.switch(id)
        if (br) {
          agent.replaceMessages(br.messages)
          session.syncFromAgent(br.messages)
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Switched to branch: ${GREEN(br.name)} (${br.messageCount} messages)`)}`)
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Branch not found: ${id}`)}`)
        }
      } else if (payload.startsWith('merge:')) {
        const id = payload.slice('merge:'.length)
        const merged = await brManager.merge(id, agent.getHistory())
        if (merged) {
          agent.replaceMessages(merged)
          session.syncFromAgent(merged)
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Merged branch into current conversation (${merged.length} messages)`)}`)
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Branch not found: ${id}`)}`)
        }
      }
      return false
    }

    // /index and /search commands — RAG indexing
    if (typeof result === 'string' && result.startsWith('__INDEX__:')) {
      const { IndexManager } = await import('../../memory/index-manager.js')
      const { setIndexManager } = await import('../../tools/built-in/rag-search.js')
      const idxManager = new IndexManager(process.cwd(), props.ollamaUrl)
      setIndexManager(idxManager)
      const payload = result.slice('__INDEX__:'.length)

      if (payload === 'status') {
        const status = await idxManager.status()
        appendOutput(`  ${DIM('Index:')} ${WHITE(`${status.fileCount} files, ${status.chunkCount} chunks`)} ${DIM(`(model: ${status.model}, updated: ${status.updatedAt})`)}`)
      } else if (payload === 'clear') {
        await idxManager.clear()
        appendOutput(`  ${DIM('ℹ')} ${WHITE('Index cleared.')}`)
      } else if (payload.startsWith('search:')) {
        const query = payload.slice('search:'.length)
        try {
          const results = await idxManager.search(query)
          if (results.length === 0) {
            appendOutput(`  ${DIM('No results. Make sure files are indexed with /index <path>.')}`)
          } else {
            const lines = ['', `  ${PURPLE.bold('Search Results')}`, '']
            for (const r of results) {
              lines.push(`  ${GREEN('•')} ${CYAN(`${r.file}:${r.startLine}-${r.endLine}`)} ${DIM(`(score: ${r.score.toFixed(3)})`)}`)
              const preview = r.text.split('\n').slice(0, 3).map(l => `    ${DIM(l)}`).join('\n')
              lines.push(preview)
            }
            lines.push('')
            appendLines(lines)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          appendOutput(`  ${ERROR_SYM} ${RED(`Search failed: ${msg}`)}`)
        }
      } else if (payload.startsWith('index:')) {
        const path = payload.slice('index:'.length)
        appendOutput(`  ${DIM('Indexing')} ${WHITE(path)}${DIM('...')}`)
        try {
          const count = await idxManager.index([path], (msg) => {
            appendOutput(`  ${DIM(msg)}`)
          })
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Indexed ${GREEN(String(count))} new chunks`)}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          appendOutput(`  ${ERROR_SYM} ${RED(`Indexing failed: ${msg}`)}`)
        }
      }
      return false
    }

    if (result === '__SESSION_SAVE__') {
      session.syncFromAgent(agent.getHistory())
      if (session.messages.length > 0) {
        const sid = await saveSession(session.getState(), currentModelRef.current)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Session saved: ${DIM(sid)}`)}`)
      } else {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('No messages to save.')}`)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__SESSION_RESUME__:')) {
      const sessionId = result.slice('__SESSION_RESUME__:'.length)
      const saved = await loadSession(sessionId)
      if (saved) {
        agent.replaceMessages(saved.messages)
        session.syncFromAgent(saved.messages)
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Resumed session ${DIM(saved.id)} (${saved.messages.length} messages)`)}`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Session not found: ${sessionId}`)}\n`)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__TEAM_SWITCH__:')) {
      const preset = result.slice('__TEAM_SWITCH__:'.length)
      const teamCfg = getTeamPreset(preset)
      if (teamCfg) {
        activeTeamRef.current = teamCfg
        const teamAgents = teamCfg.agents.map(a => a.name).join(', ')
        appendOutput(`  ${DIM('ℹ')} ${WHITE(`Switched to team: ${PURPLE(teamCfg.name)} (${teamAgents})`)}`)
      } else {
        appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Unknown team: ${preset}. Use: review, fullstack, security`)}\n`)
      }
      return false
    }

    if (result === '__AGENTS_STATUS__') {
      const agents = agentRegistry.list()
      if (agents.length === 0) {
        appendOutput(`  ${DIM('No subagents loaded. Place .md files in .cmdr/agents/ or ~/.cmdr/agents/')}`)
      } else {
        const lines = ['', `  ${PURPLE.bold('Subagents')} ${DIM(`(${agents.length})`)}`, '']
        for (const ag of agents) {
          const sourceLabel = ag.source === 'bundled' ? DIM('[bundled]') : ag.source === 'user' ? DIM('[user]') : DIM('[project]')
          const toolCount = ag.tools.length
          lines.push(`  ${GREEN('•')} ${CYAN(ag.name.padEnd(16))} ${WHITE(ag.description.slice(0, 60))}`)
          lines.push(`    ${DIM(`${toolCount} tools · ${ag.maxTurns} turns · temp ${ag.temperature}`)} ${sourceLabel}`)
        }
        lines.push('')
        lines.push(`  ${DIM('Use @<name> <task> to delegate, or /agents info <name> for details.')}`)
        lines.push('')
        appendLines(lines)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__AGENT_INFO__:')) {
      const agentName = result.slice('__AGENT_INFO__:'.length)
      const ag = agentRegistry.get(agentName)
      if (!ag) {
        appendOutput(`  ${ERROR_SYM} ${RED(`Unknown agent: ${agentName}`)}`)
      } else {
        const lines = [
          '',
          `  ${PURPLE.bold(ag.name)} ${DIM(`[${ag.source}]`)}`,
          `  ${WHITE(ag.description)}`,
          '',
          `  ${DIM('Kind:')}        ${ag.kind}`,
          `  ${DIM('Model:')}       ${ag.model ?? 'inherit from parent'}`,
          `  ${DIM('Temperature:')} ${ag.temperature}`,
          `  ${DIM('Max turns:')}   ${ag.maxTurns}`,
          `  ${DIM('Tools:')}       ${ag.tools.join(', ') || 'none'}`,
          `  ${DIM('Source:')}      ${ag.filePath}`,
          '',
          `  ${DIM('System prompt:')}`,
          ...ag.systemPrompt.split('\n').slice(0, 10).map(l => `  ${DIM('│')} ${WHITE(l)}`),
          ag.systemPrompt.split('\n').length > 10 ? `  ${DIM(`  ... (${ag.systemPrompt.split('\n').length - 10} more lines)`)}` : '',
          '',
        ]
        appendLines(lines.filter(Boolean))
      }
      return false
    }

    if (result === '__TASKS_STATUS__') {
      // Show orchestrator team tasks
      const status = orchestrator.getStatus()
      if (status?.tasks) {
        const s = status.tasks
        appendOutput(`  ${DIM('ℹ')} ${WHITE(
          `Team: ${GREEN(`${s.completed} done`)} · ${YELLOW(`${s.in_progress} running`)} · ${DIM(`${s.pending} pending`)} · ${s.failed > 0 ? RED(`${s.failed} failed`) : DIM('0 failed')}`,
        )}`)
      }
      // Show background scheduled tasks
      const scheduled = taskScheduler.list()
      if (scheduled.length > 0) {
        appendOutput(`  ${PURPLE.bold('Scheduled Tasks')} ${DIM(`(${taskScheduler.activeCount} active)`)}`)
        for (const t of scheduled) {
          const statusColor = t.status === 'running' ? YELLOW : t.status === 'completed' ? GREEN : t.status === 'failed' ? RED : DIM
          appendOutput(`  ${DIM('·')} ${WHITE(t.name)} ${statusColor(t.status)} ${DIM(`runs: ${t.runCount}`)}`)
        }
      } else if (!status?.tasks) {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('No active team or scheduled tasks.')}`)
      }
      return false
    }

    if (result === '__COST__') {
      const summary = costTracker.getSummary()
      const elapsed = costTracker.formatElapsed()
      appendLines([
        '',
        `  ${PURPLE.bold('Token usage')}`,
        '',
        `  ${DIM('Model:')}          ${WHITE(summary.model)}`,
        `  ${DIM('Turns:')}          ${WHITE(String(summary.turns))}`,
        `  ${DIM('Input tokens:')}   ${WHITE(String(summary.totalInputTokens))}`,
        `  ${DIM('Output tokens:')}  ${WHITE(String(summary.totalOutputTokens))}`,
        `  ${DIM('Total tokens:')}   ${GREEN(String(summary.totalTokens))}`,
        `  ${DIM('Tool calls:')}     ${WHITE(String(summary.totalToolCalls))}`,
        `  ${DIM('Avg/turn:')}       ${WHITE(String(summary.avgTokensPerTurn))}`,
        `  ${DIM('Session time:')}   ${WHITE(elapsed)}`,
        '',
      ])
      return false
    }

    if (result === '__UNDO__') {
      if (undoManager.count === 0) {
        appendOutput(`  ${DIM('ℹ')} ${WHITE('Nothing to undo.')}`)
      } else {
        const change = await undoManager.undoLast()
        if (change) {
          const action = change.originalContent === null ? 'deleted' : 'restored'
          const fname = change.path.split('/').pop() ?? change.path
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Undid ${change.type} on ${GREEN(fname)} (${action})`)}`)
        }
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__PLUGIN__:')) {
      const sub = result.slice('__PLUGIN__:'.length).trim()
      if (sub === 'list' || !sub) {
        const plugins = pluginManager.list()
        if (plugins.length === 0) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('No plugins loaded. Add plugins to ~/.cmdr/config.toml')}`)
        } else {
          appendLines(['', `  ${PURPLE.bold('Loaded plugins')}`, ''])
          for (const p of plugins) {
            const hooks = p.hooks ? Object.keys(p.hooks).length : 0
            const tools = p.tools?.length ?? 0
            appendOutput(`  ${GREEN('•')} ${WHITE(p.name)} v${p.version} ${DIM(`(${hooks} hooks, ${tools} tools)`)}`)
          }
          appendOutput('')
        }
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__MCP__:')) {
      const sub = result.slice('__MCP__:'.length).trim().split(/\s+/)
      const action = sub[0]

      if (action === 'list' || !action) {
        const conns = mcpClient.listConnections()
        if (conns.length === 0) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('No MCP servers connected. Add to ~/.cmdr/config.toml or use /mcp connect <name> <url>')}`)
        } else {
          appendLines(['', `  ${PURPLE.bold('MCP servers')}`, ''])
          for (const c of conns) {
            const status = c.connected ? GREEN('connected') : RED('disconnected')
            appendOutput(`  ${GREEN('•')} ${WHITE(c.name)} ${DIM(c.url)} ${status} ${DIM(`(${c.tools} tools)`)}`)
          }
          appendOutput('')
        }
      } else if (action === 'connect') {
        const name = sub[1]
        const url = sub[2]
        if (!name || !url) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('Usage: /mcp connect <name> <url>')}`)
        } else {
          try {
            const tools = await mcpClient.connect({ name, url })
            mcpClient.registerTools(toolRegistry)
            appendOutput(`  ${DIM('ℹ')} ${WHITE(`Connected to ${name}: ${tools.length} tools discovered`)}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
          }
        }
      } else if (action === 'disconnect') {
        const name = sub[1]
        if (name && mcpClient.disconnect(name)) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE(`Disconnected from ${name}`)}`)
        } else {
          appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`MCP server "${name}" not found`)}\n`)
        }
      } else if (action === 'list-available' || action === 'available') {
        const servers = listAvailableServers()
        appendLines(['', `  ${PURPLE.bold('Available MCP Servers')} ${DIM(`(${servers.length})`)}`, ''])
        for (const s of servers) {
          const missing = getMissingEnvVars(s)
          const envNote = missing.length > 0 ? ` ${YELLOW(`needs: ${missing.join(', ')}`)}` : ` ${GREEN('ready')}`
          appendOutput(`  ${GREEN('•')} ${WHITE(s.name.padEnd(20))} ${DIM(s.description)}${envNote}`)
        }
        appendLines(['', `  ${DIM('Add with: /mcp add <name>')}`, ''])
      } else if (action === 'add') {
        const name = sub[1]
        if (!name) {
          appendOutput(`  ${DIM('ℹ')} ${WHITE('Usage: /mcp add <name> — use /mcp list-available to see options')}`)
        } else {
          const def = getServerDefinition(name)
          if (!def) {
            appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Unknown server "${name}". Use /mcp list-available to see options.`)}\n`)
          } else {
            const missing = getMissingEnvVars(def)
            if (missing.length > 0) {
              appendOutput(`\n  ${ERROR_SYM} ${RED.bold(`Missing required env vars: ${missing.join(', ')}`)}\n  ${DIM(`Set them before connecting: export ${missing[0]}=...`)}\n`)
            } else {
              try {
                const config = toMcpConfig(def)
                const tools = await mcpClient.connect(config)
                mcpClient.registerTools(toolRegistry)
                appendOutput(`  ${SUCCESS_SYM} ${WHITE(`Connected to ${name}: ${tools.length} tools discovered`)}`)
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
              }
            }
          }
        }
      }
      return false
    }

    if (result === '__CUSTOM_COMMANDS_LIST__') {
      const cmds = commandLoader.list()
      if (cmds.length === 0) {
        appendOutput(`  ${DIM('No custom commands. Create with /command create <name>')}`)
      } else {
        const lines = ['', `  ${PURPLE.bold('Custom commands')} ${DIM(`(${cmds.length})`)}`, '']
        for (const cmd of cmds) {
          lines.push(`  ${GREEN('•')} ${CYAN('/' + cmd.name.padEnd(16))} ${WHITE(cmd.description)} ${DIM(`[${cmd.source}]`)}`)
        }
        lines.push('')
        lines.push(`  ${DIM('Run with: /<name> <arguments>')}`)
        lines.push('')
        appendLines(lines)
      }
      return false
    }

    if (typeof result === 'string' && result.startsWith('__CUSTOM_COMMAND_CREATE__:')) {
      const cmdName = result.slice('__CUSTOM_COMMAND_CREATE__:'.length)
      const filePath = commandLoader.scaffold(cmdName, process.cwd())
      appendOutput(`  ${DIM('ℹ')} ${WHITE(`Created command scaffold: ${GREEN(filePath)}`)}`)
      commandLoader.loadAll(process.cwd())
      return false
    }

    if (result === '__PLAN_TOGGLE__') {
      planModeRef.current = !planModeRef.current
      if (planModeRef.current) {
        appendOutput(`  ${PURPLE('◈')} ${WHITE('Plan mode')} ${GREEN('ON')} ${DIM('— agent will only analyze and plan, no changes')}`)
      } else {
        appendOutput(`  ${PURPLE('◈')} ${WHITE('Plan mode')} ${RED('OFF')} ${DIM('— full tool access restored')}`)
      }
      return false
    }

    if (result) appendOutput(String(result))
    return false
  }, [agent, session, permissionManager, adapter, ollamaUrl, toolRegistry,
      orchestrator, costTracker, undoManager, pluginManager, mcpClient, commandLoader,
      cleanupAndExit, appendOutput, appendLines])

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async (value: string) => {
    const input = value.trim()

    if (!input) return
    if (stateRef.current !== 'idle') return

    // Echo user input
    appendOutput(`${GREEN.bold('❯')} ${WHITE(input)}`)

    setState('processing')

    try {
      if (isSlashCommand(input)) {
        // Check if it's a custom command first
        const { name: cmdName, args: cmdArgs } = parseSlashCommand(input)
        const customCmd = commandLoader.get(cmdName)
        if (customCmd && !getCommand(cmdName)) {
          // Resolve template and send as user message
          const resolved = commandLoader.resolve(customCmd, cmdArgs, process.cwd())
          if (planModeRef.current) {
            const planMsg = `[System: PLAN MODE is active. Analyze only — do NOT make changes. Produce a numbered step-by-step plan.]\n\n${resolved}`
            await handleUserMessage(planMsg)
          } else {
            await handleUserMessage(resolved)
          }
        } else {
          const shouldExit = await processCommand(input)
          if (shouldExit) return
        }
      } else if (input.startsWith('@')) {
        // @agent syntax: @investigator explain the auth flow
        const spaceIdx = input.indexOf(' ')
        const agentName = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
        const agentTask = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1).trim()

        if (agentRegistry.has(agentName)) {
          if (!agentTask) {
            appendOutput(`  ${ERROR_SYM} ${RED('Usage:')} @${agentName} <task description>`)
          } else {
            const delegateMsg = `[System: The user has requested the "${agentName}" subagent. Please immediately call the "${agentName}" tool with the following task: ${agentTask}]`
            await handleUserMessage(delegateMsg)
          }
        } else {
          appendOutput(`  ${ERROR_SYM} ${RED(`Unknown agent: ${agentName}`)}. Use /agents to list available agents.`)
        }
      } else if (activeTeamRef.current) {
        await handleTeamMessage(input, activeTeamRef.current)
      } else if (planModeRef.current) {
        const planMsg = `[System: PLAN MODE is active. Analyze the request and produce a numbered step-by-step plan. Do NOT make any changes.]\n\n${input}`
        await handleUserMessage(planMsg)
      } else {
        // If an image is pending, attach it to this message
        if (pendingImageRef.current) {
          const { readFile: readFs } = await import('fs/promises')
          const { extname } = await import('path')
          const ext = extname(pendingImageRef.current).toLowerCase()
          const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
          const mediaType = mimeMap[ext] || 'image/png'
          const imageData = await readFs(pendingImageRef.current)
          const base64 = imageData.toString('base64')
          agent.addImageMessage(input, base64, mediaType)
          pendingImageRef.current = null
          // Stream with empty message since we already added the user message with image
          await handleUserMessage('')
        } else {
          await handleUserMessage(input)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendOutput(`\n  ${ERROR_SYM} ${RED.bold(msg)}\n`)
    } finally {
      // stateRef.current may have changed during async processing (TS narrows incorrectly here)
      if ((stateRef.current as ReplState) !== 'exiting') {
        setState('idle')
      }
    }
  }, [appendOutput, processCommand, handleUserMessage, handleTeamMessage])

  // ---------------------------------------------------------------------------
  // Keyboard input handling (Ctrl+C, Ctrl+D)
  // ---------------------------------------------------------------------------

  useInput((input, key) => {
    const maxScrollOffset = Math.max(0, outputLines.length - historyWindowSize)
    const pageStep = Math.max(1, Math.floor(historyWindowSize * 0.7))

    if (key.pageUp) {
      setHistoryScrollOffset((prev) => Math.min(maxScrollOffset, prev + pageStep))
      return
    }

    if (key.pageDown) {
      setHistoryScrollOffset((prev) => Math.max(0, prev - pageStep))
      return
    }

    if (key.escape && historyScrollOffset > 0) {
      setHistoryScrollOffset(0)
      return
    }

    // Ctrl+C handling
    if (key.ctrl && input === 'c') {
      const now = Date.now()
      if (now - lastSigintRef.current < 1000) {
        cleanupAndExit()
        return
      }
      lastSigintRef.current = now

      if (stateRef.current === 'processing' || stateRef.current === 'waiting_approval') {
        // Abort the current agent turn
        if (abortRef.current) {
          abortRef.current.abort()
          abortRef.current = null
        }
        // Drain any pending approval queue
        for (const pending of approvalQueueRef.current) {
          pending.resolve('deny')
        }
        approvalQueueRef.current = []
        if (approval) {
          approval.resolve('deny')
          setApproval(null)
        }
        appendOutput(`\n  ${DIM('Interrupt — press Ctrl+C again to exit.')}`)
      } else if (stateRef.current === 'idle') {
        appendOutput(`  ${DIM('Press Ctrl+C again to exit.')}`)
      }
      return
    }

    // Ctrl+D — ignore (don't close)
    if (key.ctrl && input === 'd') {
      return
    }
  })

  // ---------------------------------------------------------------------------
  // Handle approval input
  // ---------------------------------------------------------------------------

  const handleApprovalSubmit = useCallback((value: string) => {
    if (!approval) return
    const trimmed = value.trim().toLowerCase()
    setApprovalInput('')

    let decision: ApprovalDecision
    if (trimmed === 'y' || trimmed === 'yes' || trimmed === '') {
      decision = 'allow'
    } else if (trimmed === 'a' || trimmed === 'always') {
      decision = 'allow-always'
    } else {
      decision = 'deny'
    }

    const resolve = approval.resolve
    setApproval(null)

    // Show next queued approval, or return to processing
    const next = approvalQueueRef.current.shift()
    if (next) {
      setApproval(next)
      // Stay in waiting_approval state
    } else {
      setState('processing')
    }

    resolve(decision)
  }, [approval])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box flexDirection="column" height={terminalRows}>
      {/* Transcript viewport */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleOutputLines.map((line) => (
          <Text key={line.id}>{line.text}</Text>
        ))}
      </Box>

      {historyScrollOffset > 0 && (
        <Text>{`  ${DIM('Scrollback')} ${WHITE(String(historyScrollOffset))} ${DIM('(PgUp/PgDn, Esc to jump to live)')}`}</Text>
      )}

      {/* Active spinner */}
      {state === 'processing' && spinnerText && (
        <Text>{spinnerText}</Text>
      )}

      {/* Approval prompt */}
      {state === 'waiting_approval' && approval && (
        <Box flexDirection="column">
          <Text>{''}</Text>
          <Text>{`  ${YELLOW('⚠')}  ${WHITE('Tool approval required')} ${DIM('[')}${
            approval.riskLevel === 'dangerous' ? RED(approval.riskLevel.toUpperCase()) : YELLOW(approval.riskLevel.toUpperCase())
          }${DIM(']')}`}</Text>
          <Text>{`  ${DIM('Tool:')}  ${CYAN(approval.toolName)}`}</Text>
          {Object.entries(approval.input).map(([key, val]) => {
            const display = typeof val === 'string'
              ? val.length > 120 ? val.slice(0, 120) + DIM('...') : val
              : JSON.stringify(val).slice(0, 120)
            return <Text key={key}>{`  ${DIM(key + ':')}  ${WHITE(display)}`}</Text>
          })}
          <Text>{''}</Text>
          <Text>{`  ${GREEN('y')}${DIM('es')}  ${DIM('/')}  ${RED('n')}${DIM('o')}  ${DIM('/')}  ${PURPLE('a')}${DIM('lways allow this tool')}`}</Text>
          <Box>
            <Text>{`  ${YELLOW('?')} `}</Text>
            <TextInput
              value={approvalInput}
              onChange={setApprovalInput}
              onSubmit={handleApprovalSubmit}
            />
          </Box>
        </Box>
      )}

      <StatusBar
        model={currentModelRef.current}
        tokensIn={tokensIn}
        tokensOut={tokensOut}
        turns={turnCount}
        agentCount={agentRegistry.list().length}
        permissionMode={permissionManager.getMode()}
        cwd={process.cwd()}
        gitBranch={props.gitBranch}
        contextPct={session.maxContextTokens ? Math.round((session.tokenCount / session.maxContextTokens) * 100) : 0}
        version={props.version}
      />

      {/* Input prompt (only when idle) */}
      {state === 'idle' && (
        <PromptInput
          onSubmit={handleSubmit}
          placeholder="Ask anything, @file to include, /help for commands"
        />
      )}
    </Box>
  )
}
