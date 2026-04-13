/**
 * Interactive REPL — the primary cmdr interface.
 *
 * Uses Ink (React for CLI) for robust terminal management,
 * matching the approach of Claude Code and Gemini CLI.
 *
 * Streaming output, tool execution display, markdown rendering,
 * AMOLED black + green/purple aesthetic.
 */

import React from 'react'
import { render } from 'ink'
import type { LLMAdapter, ToolUseBlock, ToolResultBlock, ApprovalDecision, ToolRiskLevel, AgentConfig, EffortLevel } from '../core/types.js'
import { EFFORT_CONFIGS } from '../core/types.js'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { createAdapter, detectProviderFromModel, type ProviderName } from '../llm/provider-factory.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools, registerBrowserTools } from '../tools/built-in/index.js'
import { SOLO_CODER, getTeamPreset } from '../core/presets.js'
import { Orchestrator } from '../core/orchestrator.js'
import type { TeamConfig } from '../core/types.js'
import { SessionManager } from '../session/session-manager.js'
import { discoverProject } from '../session/project-context.js'
import { buildSystemPrompt } from '../session/prompt-builder.js'
import { getDefaultContextLength, resolveContextLength, discoverOllamaModels } from '../llm/model-registry.js'
import { ModelWatcher } from '../llm/model-watcher.js'
import {
  renderWelcome, renderError,
  GREEN, PURPLE, DIM, WHITE,
  YELLOW, RED,
} from './theme.js'
import type { WelcomeOptions } from './theme.js'
import { PermissionManager } from '../core/permissions.js'
import { saveSession, loadSession, findRecentSession, DebouncedSaver } from '../session/session-persistence.js'
import { PluginManager } from '../plugins/plugin-manager.js'
import { McpClient } from '../plugins/mcp-client.js'
import { loadConfig } from '../config/config-loader.js'
import { AgentRegistry, AgentExecutor, createSubagentTool } from '../agents/index.js'
import { CommandLoader } from '../commands/index.js'
import { CostTracker } from '../session/cost-tracker.js'
import { UndoManager } from '../session/undo-manager.js'
import { MemoryManager } from '../memory/memory-manager.js'
import { execSync } from 'node:child_process'
import { startThinking, stopSpinner, spinnerSuccess, spinnerFail, getCompletionSummary, startToolExec } from './spinner.js'
import type { RunCallbacks } from '../core/agent-runner.js'
import App from './ink/App.js'
import { globalEventBus } from '../core/event-bus.js'
import { TaskScheduler } from '../scheduling/task-scheduler.js'
import { setTaskScheduler } from '../tools/built-in/task-tools.js'
import { setCronScheduler } from '../tools/built-in/cron-tools.js'
import { setMcpClient } from '../tools/built-in/mcp-resource-tools.js'
import { HookManager } from '../core/hooks.js'
import { detectCodeReviewGraph, graphDatabaseExists, buildCrgMcpConfig } from '../config/mcp-config.js'
import { GraphContextProvider } from '../core/graph-context.js'
import { setGraphToolsClient } from '../tools/built-in/graph-tools.js'
import { BuddyManager } from './buddy.js'

export interface ReplOptions {
  model: string
  ollamaUrl: string
  provider?: string
  version?: string
  initialPrompt?: string
  dangerouslySkipPermissions?: boolean
  resume?: string
  continue?: boolean
  verbose?: boolean
  team?: string
  maxTurns?: number
  outputFormat?: 'text' | 'json' | 'stream-json'
  effort?: EffortLevel
  image?: string
  noBuddy?: boolean
  browser?: boolean
}

export async function startRepl(options: ReplOptions): Promise<void> {
  const cwd = process.cwd()
  const verbose = options.verbose ?? false

  // Load config first — needed for provider resolution
  const config = await loadConfig(cwd)

  // --- Setup ---
  // Determine provider: CLI flag > model auto-detect > config > default (ollama)
  const resolvedProvider: ProviderName =
    (options.provider as ProviderName | undefined)
    ?? detectProviderFromModel(options.model)
    ?? (config?.defaultProvider as ProviderName | undefined)
    ?? 'ollama'

  const adapter = createAdapter({
    provider: resolvedProvider,
    ollamaUrl: options.ollamaUrl,
  })

  // Ollama-specific setup: health check, model discovery, model watcher
  let modelWatcher: ModelWatcher | undefined
  if (resolvedProvider === 'ollama') {
    const ollamaAdapter = adapter as OllamaAdapter
    const healthy = await ollamaAdapter.healthCheck()
    if (!healthy) {
      console.error(renderError(
        `Cannot connect to Ollama at ${options.ollamaUrl}\n` +
        `  Make sure Ollama is running: ollama serve\n` +
        `  Then pull a model: ollama pull ${options.model}`,
      ))
      process.exit(1)
    }

    // Auto-discover all installed Ollama models into the registry
    await discoverOllamaModels(options.ollamaUrl)

    // Start background model watcher — detects newly pulled models
    modelWatcher = new ModelWatcher(options.ollamaUrl, 30_000)
    modelWatcher.start()
  }

  // Discover project
  const projectContext = await discoverProject(cwd)
  const projectInfo = projectContext.language !== 'unknown'
    ? `${projectContext.language}${projectContext.framework ? ' / ' + projectContext.framework : ''}`
    : cwd.split('/').pop() || 'unknown'

  // Session — resolve model's actual context length
  const modelContextLength = await resolveContextLength(options.model, options.ollamaUrl)
  const session = new SessionManager(projectContext, modelContextLength)

  // Load persistent memory
  const memoryManager = new MemoryManager(cwd)
  const memoryPrompt = await memoryManager.getMemoryPrompt()

  // Build system prompt with project context + memory
  const systemPrompt = buildSystemPrompt({
    basePrompt: SOLO_CODER.systemPrompt!,
    projectContext,
    model: options.model,
    memoryPrompt: memoryPrompt || undefined,
  })

  // Tool registry
  const toolRegistry = new ToolRegistry()
  registerBuiltInTools(toolRegistry)

  // Browser tools (optional, requires --browser flag)
  if (options.browser) {
    const registered = await registerBrowserTools(toolRegistry)
    if (!registered) {
      console.log(`  ${YELLOW('⚠')} ${DIM('Browser tools unavailable: install playwright-core')}`)
    } else {
      console.log(`  ${DIM('Browser: 5 tools registered (headless Chromium)')}`)
    }
  }

  // Plugin manager
  const pluginManager = new PluginManager()
  for (const pluginSource of config.plugins) {
    try {
      await pluginManager.load(pluginSource, cwd)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${DIM('⚠ Plugin load failed:')} ${msg}`)
    }
  }
  pluginManager.registerTools(toolRegistry)

  // MCP client
  const mcpClient = new McpClient()
  for (const server of config.mcp.servers) {
    try {
      await mcpClient.connect(server)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${DIM('⚠ MCP connect failed:')} ${msg}`)
    }
  }
  mcpClient.registerTools(toolRegistry)
  setMcpClient(mcpClient)

  // Code-review-graph (MCP auto-detect)
  let graphContext: GraphContextProvider | undefined
  const crgDetection = detectCodeReviewGraph()
  if (crgDetection.available) {
    try {
      const crgConfig = buildCrgMcpConfig(crgDetection, cwd)
      await mcpClient.connect(crgConfig)
      graphContext = new GraphContextProvider(cwd)
      graphContext.setMcpClient(mcpClient)
      setGraphToolsClient(mcpClient, cwd)
      projectContext.graphAvailable = true

      // Auto-build graph on first session if no DB exists
      if (!graphDatabaseExists(cwd)) {
        console.log(`  ${DIM('Building code graph (first run, async)...')}`)
        graphContext.buildGraph().then(() => {
          graphContext!.setBuildReady(true)
        }).catch(() => {
          console.log(`  ${DIM('⚠ Graph build failed — graph tools will use fallback')}`)
        })
      } else {
        graphContext.setBuildReady(true)
      }

      console.log(`  ${DIM('Graph:')} code-review-graph connected`)
      registerMcpCleanup(mcpClient)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${DIM('⚠ Code graph unavailable:')} ${msg}`)
    }
  }

  // Load subagent registry
  const agentRegistry = new AgentRegistry()
  await agentRegistry.loadAll(cwd)

  // Register subagent tools
  const agentExecutor = new AgentExecutor()
  for (const agentDef of agentRegistry.list()) {
    if (agentDef.kind === 'local') {
      const tool = createSubagentTool(agentDef, agentExecutor, adapter, toolRegistry)
      toolRegistry.register(tool)
    }
  }

  const agentCount = agentRegistry.list().length
  if (agentCount > 0) {
    console.log(`  ${DIM(`Agents: ${agentCount} loaded (${agentRegistry.list().map(a => a.name).join(', ')})`)}`)
  }

  // Load custom commands
  const commandLoader = new CommandLoader()
  commandLoader.loadAll(cwd)
  const customCmdCount = commandLoader.list().length
  if (customCmdCount > 0) {
    console.log(`  ${DIM(`Commands: ${customCmdCount} custom (${commandLoader.list().map(c => c.name).join(', ')})`)}`)
  }

  // Cost tracker
  const costTracker = new CostTracker()

  // Undo manager
  const undoManager = new UndoManager()

  // Task scheduler
  const taskScheduler = new TaskScheduler()
  setTaskScheduler(taskScheduler)
  setCronScheduler(taskScheduler)

  // Hooks
  const hookManager = new HookManager(config.hooks ?? {}, cwd)
  hookManager.wireEventBus()

  // Permission manager
  const permissionManager = new PermissionManager(
    options.dangerouslySkipPermissions ? 'yolo' : 'normal',
  )
  await permissionManager.loadSettings()
  permissionManager.setProjectRoot(cwd)
  if (options.dangerouslySkipPermissions) {
    permissionManager.setMode('yolo')
  }
  // Load pattern permission rules from config
  if (config.permissions.allow || config.permissions.deny || config.permissions.ask) {
    permissionManager.loadPermissionRules({
      allow: config.permissions.allow,
      deny: config.permissions.deny,
      ask: config.permissions.ask,
    })
  }

  // Orchestrator for team mode
  const orchestrator = new Orchestrator(adapter, toolRegistry, {
    maxConcurrency: 2,
    defaultModel: options.model,
  }, cwd, permissionManager)
  let activeTeamConfig: TeamConfig | undefined
  if (options.team) {
    activeTeamConfig = getTeamPreset(options.team)
    if (!activeTeamConfig) {
      console.error(renderError(`Unknown team preset: ${options.team}. Use: review, fullstack, security`))
      process.exit(1)
    }
  }

  // Create agent
  const currentModel = options.model
  const allowedToolNames = Array.from(new Set([
    ...(SOLO_CODER.tools ?? []),
    ...toolRegistry.list().map(tool => tool.name),
  ]))

  const agentConfig = {
    ...SOLO_CODER,
    model: currentModel,
    systemPrompt,
    tools: allowedToolNames,
  } as AgentConfig & { maxTurns?: number; thinkingEnabled?: boolean; temperature?: number }
  if (options.maxTurns) {
    agentConfig.maxTurns = options.maxTurns
  } else if (config.maxTurns) {
    agentConfig.maxTurns = config.maxTurns
  }

  // Effort level: --effort flag or --fast alias
  const effortLevel: EffortLevel = options.effort ?? 'medium'
  const effortConfig = EFFORT_CONFIGS[effortLevel]
  if (effortConfig.thinkingEnabled !== undefined) {
    agentConfig.thinkingEnabled = effortConfig.thinkingEnabled
  }
  agentConfig.temperature = effortConfig.temperature

  const agent = new Agent(
    agentConfig,
    adapter,
    toolRegistry,
    cwd,
    permissionManager,
    { memoryManager, pluginManager },
  )

  // Wire graph context into agent if available
  if (graphContext) {
    agent.setGraphContext(graphContext)
  }

  // Start background task scheduler
  taskScheduler.start()

  // Emit session start event
  globalEventBus.emit('session:start', { sessionId: session.id ?? 'default' })
  await pluginManager.runOnSessionStart(session.getState())

  let resumedSessionSummary: string | undefined
  let startupNotice: string | undefined

  // Resolve resume/continue before printing welcome so startup metadata can render as one coherent block.
  if (options.resume) {
    const saved = await loadSession(options.resume)
    if (saved) {
      agent.replaceMessages(saved.messages)
      session.syncFromAgent(saved.messages)
      resumedSessionSummary = `resumed ${saved.id} (${saved.messages.length} messages)`
    } else {
      startupNotice = renderError(`Session not found: ${options.resume}`)
    }
  } else if (options.continue) {
    const saved = await findRecentSession(cwd)
    if (saved) {
      agent.replaceMessages(saved.messages)
      session.syncFromAgent(saved.messages)
      resumedSessionSummary = `continued ${saved.id} (${saved.messages.length} messages)`
    } else {
      startupNotice = `  ${DIM('No previous session found for this directory.')}`
    }
  }

  // --- Welcome banner (prints to normal terminal before Ink takes over) ---
  let gitBranch: string | undefined
  try {
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()
  } catch { /* not a git repo */ }

  const cmdrMdLines = projectContext.cmdrInstructions
    ? projectContext.cmdrInstructions.split('\n').length : 0
  const mcpServerCount = config.mcp?.servers?.length || 0

  const welcomeOpts: WelcomeOptions = {
    model: currentModel,
    projectInfo,
    version: options.version,
    gitBranch,
    permissionMode: permissionManager.getMode(),
    teamName: activeTeamConfig?.name,
    teamAgentCount: activeTeamConfig?.agents.length,
    cmdrMdLines,
    agentCount,
    customCmdCount,
    pluginCount: pluginManager.list?.().length || 0,
    mcpServerCount,
    resumedSession: resumedSessionSummary,
    cwd,
  }
  const welcomeBanner = renderWelcome(currentModel, projectInfo, options.version, welcomeOpts)

  // Buddy system — startup greeting
  const buddyManager = new BuddyManager()
  if (!options.noBuddy) {
    try {
      const buddyGreeting = await buddyManager.getGreeting()
      console.log(`\n${buddyGreeting}\n`)
      await buddyManager.recordSession()
    } catch { /* buddy is non-critical */ }
  }

  if (startupNotice) {
    console.log(startupNotice)
  }

  // Debounced auto-save (max once per 5s)
  const autoSaver = new DebouncedSaver(5000)
  const doSave = async () => {
    session.syncFromAgent(agent.getHistory())
    if (session.messages.length > 0) {
      await saveSession(session.getState(), currentModel)
    }
  }

  const cleanupMcp = () => { mcpClient.disconnect('crg') }

  // --- Handle one-shot prompt (non-interactive) ---
  if (options.initialPrompt) {
    await handleOneShot(options.initialPrompt, agent, session, currentModel, permissionManager, verbose, adapter, costTracker, undoManager, options.outputFormat, options.image)
    await doSave()
    await pluginManager.runOnSessionEnd(session.getState())

    // Keep one-shot lifecycle consistent with interactive cleanup so process exits cleanly.
    taskScheduler.stop()
    cleanupMcp()
    globalEventBus.emit('session:end', {
      sessionId: session.id ?? 'default',
      messageCount: agent.getHistory().length,
      totalTokens: agent.getState().tokenUsage,
    })
    globalEventBus.removeAll()
    modelWatcher?.stop()
    process.removeListener('exit', cleanupMcp)

    return
  }

  // --- Interactive REPL via Ink ---
  const app = render(
    React.createElement(App, {
      agent,
      session,
      model: currentModel,
      permissionManager,
      adapter,
      orchestrator,
      activeTeamConfig,
      costTracker,
      undoManager,
      pluginManager,
      mcpClient,
      toolRegistry,
      agentRegistry,
      commandLoader,
      taskScheduler,
      ollamaUrl: options.ollamaUrl,
      verbose,
      doSave,
      autoSaver,
      version: options.version,
      gitBranch,
      welcomeBanner,
    }),
    {
      exitOnCtrlC: false,   // We handle Ctrl+C ourselves
      patchConsole: false,  // Ban console logs from being intercepted during banner
    },
  )

  await app.waitUntilExit()

  // Cleanup
  taskScheduler.stop()
  await pluginManager.runOnSessionEnd(session.getState())
  mcpClient.disconnect('crg')
  globalEventBus.emit('session:end', {
    sessionId: session.id ?? 'default',
    messageCount: agent.getHistory().length,
    totalTokens: agent.getState().tokenUsage,
  })
  globalEventBus.removeAll()
  modelWatcher?.stop()

  // Ensure MCP child processes are killed on unexpected exit
  process.removeListener('exit', cleanupMcp)
}

// Register global exit handler once (outside startRepl to avoid stacking)
let _cleanupRegistered = false
function registerMcpCleanup(mcpClient: McpClient): void {
  if (_cleanupRegistered) return
  _cleanupRegistered = true
  const cleanup = () => { try { mcpClient.disconnect('crg') } catch {} }
  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

// ---------------------------------------------------------------------------
// One-shot handler (non-interactive --prompt mode)
// ---------------------------------------------------------------------------

async function handleOneShot(
  message: string,
  agent: Agent,
  session: SessionManager,
  model: string,
  permissionManager: PermissionManager,
  verbose: boolean,
  adapter: LLMAdapter,
  costTracker: CostTracker,
  undoManager: UndoManager,
  outputFormat: 'text' | 'json' | 'stream-json' = 'text',
  imagePath?: string,
): Promise<void> {
  // If an image is attached, prepend it as a user message with image content
  if (imagePath) {
    const { readFile: readFs } = await import('fs/promises')
    const { extname } = await import('path')
    const ext = extname(imagePath).toLowerCase()
    const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
    const mediaType = mimeMap[ext] || 'image/png'
    const imageData = await readFs(imagePath)
    const base64 = imageData.toString('base64')
    agent.addImageMessage(message, base64, mediaType)
    // Stream with no additional message text since we already added it
    message = ''
  }

  // JSON or stream-json output — structured machine-readable output
  if (outputFormat === 'json' || outputFormat === 'stream-json') {
    const startTime = Date.now()
    let fullOutput = ''
    const toolsCalled: { name: string; duration_ms: number }[] = []
    const filesModified = new Set<string>()
    let currentToolStart = 0
    let currentToolName = ''
    let exitCode = 0

    try {
      for await (const event of agent.stream(message)) {
        switch (event.type) {
          case 'text': {
            const chunk = event.data as string
            fullOutput += chunk
            if (outputFormat === 'stream-json') {
              console.log(JSON.stringify({ type: 'text', data: chunk, timestamp: Date.now() }))
            }
            break
          }
          case 'tool_use': {
            const block = event.data as ToolUseBlock
            currentToolName = block.name
            currentToolStart = Date.now()
            // Track file modifications
            if (block.name === 'file_write' || block.name === 'file_edit') {
              const filePath = (block.input.path ?? block.input.file_path) as string | undefined
              if (filePath) filesModified.add(filePath)
            }
            if (outputFormat === 'stream-json') {
              console.log(JSON.stringify({ type: 'tool_use', tool: block.name, input: block.input, timestamp: Date.now() }))
            }
            break
          }
          case 'tool_result': {
            const block = event.data as ToolResultBlock
            const duration_ms = Date.now() - currentToolStart
            toolsCalled.push({ name: currentToolName, duration_ms })
            if (block.is_error) exitCode = 1
            if (outputFormat === 'stream-json') {
              console.log(JSON.stringify({ type: 'tool_result', tool: currentToolName, output: block.content, is_error: block.is_error, duration_ms, timestamp: Date.now() }))
            }
            currentToolName = ''
            break
          }
          case 'done': break
          case 'error': {
            exitCode = 1
            const err = event.data as Error
            if (outputFormat === 'stream-json') {
              console.log(JSON.stringify({ type: 'error', message: err.message, timestamp: Date.now() }))
            }
            break
          }
        }
      }
    } catch (err) {
      exitCode = 1
      const msg = err instanceof Error ? err.message : String(err)
      if (outputFormat === 'stream-json') {
        console.log(JSON.stringify({ type: 'error', message: msg, timestamp: Date.now() }))
      }
    }

    const state = agent.getState()
    const tokens = state.tokenUsage
    const durationMs = Date.now() - startTime

    if (outputFormat === 'json') {
      console.log(JSON.stringify({
        model,
        response: fullOutput,
        tools_called: toolsCalled,
        files_modified: [...filesModified],
        tokens: { input: tokens.input_tokens, output: tokens.output_tokens },
        duration_ms: durationMs,
        exit_code: exitCode,
      }))
    } else {
      console.log(JSON.stringify({
        type: 'done',
        tokens: { input: tokens.input_tokens, output: tokens.output_tokens },
        duration_ms: durationMs,
      }))
    }

    costTracker.record(model, tokens.input_tokens, tokens.output_tokens, toolsCalled.length)
    session.syncFromAgent(agent.getHistory())
    process.exitCode = exitCode
    return
  }

  // Text output — standard interactive display
  console.log('')
  startThinking()

  let fullOutput = ''
  let firstText = true
  let currentTool = ''
  let currentToolInput: Record<string, unknown> = {}
  let toolCallCount = 0

  try {
    for await (const event of agent.stream(message)) {
      switch (event.type) {
        case 'text': {
          if (firstText) {
            stopSpinner()
            process.stdout.write(`\n  ${PURPLE('│')} `)
            firstText = false
          }
          const chunk = event.data as string
          fullOutput += chunk
          const formatted = chunk.replace(/\n/g, `\n  ${PURPLE('│')} `)
          process.stdout.write(formatted)
          break
        }
        case 'tool_use': {
          stopSpinner()
          if (!firstText) {
            process.stdout.write('\n')
            firstText = true
          }
          const block = event.data as ToolUseBlock
          currentTool = block.name
          currentToolInput = block.input
          toolCallCount++

          if (block.name === 'file_write' || block.name === 'file_edit') {
            const filePath = (block.input.path ?? block.input.file_path) as string | undefined
            if (filePath) await undoManager.recordBefore(filePath, block.name === 'file_write' ? 'write' : 'edit')
          }

          const toolSummary = Object.entries(block.input)
            .map(([k, v]) => {
              const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
              return `${DIM(k + ':')} ${WHITE(val)}`
            })
            .join(' ')
          console.log(`  ${GREEN('⚡')} ${GREEN.bold(block.name)} ${toolSummary}`)
          startToolExec(block.name)
          break
        }
        case 'tool_result': {
          const block = event.data as ToolResultBlock
          if (block.is_error) spinnerFail(currentTool)
          else spinnerSuccess(currentTool)
          currentTool = ''
          currentToolInput = {}
          startThinking()
          firstText = true
          break
        }
        case 'done': stopSpinner(); break
        case 'error': {
          stopSpinner()
          const err = event.data as Error
          console.error(renderError(err.message))
          break
        }
      }
    }
  } catch (err) {
    stopSpinner()
    const msg = err instanceof Error ? err.message : String(err)
    console.error(renderError(msg))
  }

  if (!firstText) process.stdout.write('\n')
  if (fullOutput) console.log('')

  const state = agent.getState()
  const tokens = state.tokenUsage
  const summary = getCompletionSummary()
  const tokenInfo = tokens.input_tokens > 0 || tokens.output_tokens > 0
    ? `  ${DIM('·')}  ${DIM(`${tokens.input_tokens} in / ${tokens.output_tokens} out`)}`
    : ''
  console.log(`  ${DIM(summary)}${tokenInfo}`)

  costTracker.record(model, tokens.input_tokens, tokens.output_tokens, toolCallCount)
  session.syncFromAgent(agent.getHistory())
}
