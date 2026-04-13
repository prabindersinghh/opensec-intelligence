/**
 * cmdr VS Code Extension — Entry Point.
 *
 * Activates on startup:
 * 1. Starts cmdr serve as child process
 * 2. Registers custom webview chat panel (sidebar)
 * 3. Registers chat participant (@cmdr)
 * 4. Registers inline completion provider
 * 5. Registers code actions
 * 6. Registers status bar
 * 7. Registers commands
 * 8. Initializes hook system, sandbox, plugins, confidence, config, loops, hookify
 */

import * as vscode from 'vscode'
import { ServerManager } from './server-manager.js'
import { ChatProvider } from './chat-provider.js'
import { InlineProvider } from './inline-provider.js'
import { CodeActionProvider } from './code-action.js'
import { StatusBar } from './status-bar.js'
import { registerCommands } from './commands.js'
import { ChatPanelManager } from './chat/panel-manager.js'
import { MessageHandler } from './chat/message-handler.js'
import { DiffManager, DiffContentProvider } from './diff-manager.js'
import { OpenFilesManager } from './open-files-manager.js'
import { HookRunner } from './hooks.js'
import { SandboxManager } from './sandbox.js'
import { PluginMarketplace } from './plugin-marketplace.js'
import { ConfidenceFilter } from './confidence.js'
import { AutonomousLoopManager } from './autonomous-loops.js'
import { CmdrConfigLoader } from './cmdr-config.js'
import { Hookify } from './hookify.js'

let serverManager: ServerManager | undefined
let diffManager: DiffManager | undefined

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('cmdr')
  const autoStart = config.get<boolean>('autoStart', true)

  // Server manager
  serverManager = new ServerManager(context)
  if (autoStart) {
    await serverManager.start()
  }

  // Output channel (shared by subsystems)
  const outputChannel = vscode.window.createOutputChannel('cmdr')

  // Diff manager (native VS Code diff editor)
  const diffContentProvider = new DiffContentProvider()
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('cmdr-diff', diffContentProvider),
  )
  diffManager = new DiffManager(diffContentProvider, outputChannel)

  // Open files manager (tracks active files, cursor, selection)
  const openFilesManager = new OpenFilesManager(context)

  // Hook system (Pre/PostToolUse, Stop, SessionStart/End)
  const hookRunner = new HookRunner(outputChannel)
  context.subscriptions.push({ dispose: () => hookRunner.dispose() })

  // Sandbox manager (command validation, network restrictions)
  const sandboxManager = new SandboxManager(outputChannel)
  context.subscriptions.push({ dispose: () => sandboxManager.dispose() })

  // Plugin marketplace (plugin discovery, install/uninstall)
  const pluginMarketplace = new PluginMarketplace(outputChannel)
  context.subscriptions.push({ dispose: () => pluginMarketplace.dispose() })

  // Confidence filter (score tool results, threshold gating)
  const confidenceFilter = new ConfidenceFilter(outputChannel)
  context.subscriptions.push({ dispose: () => confidenceFilter.dispose() })

  // Autonomous loop manager (iterative agent loops)
  const loopManager = new AutonomousLoopManager(outputChannel, hookRunner)
  context.subscriptions.push({ dispose: () => loopManager.dispose() })

  // CMDR.md config loader (project-level instructions)
  const cmdrConfig = new CmdrConfigLoader(outputChannel)
  context.subscriptions.push({ dispose: () => cmdrConfig.dispose() })

  // Hookify (dynamic rule creation)
  const hookify = new Hookify(outputChannel)
  context.subscriptions.push({ dispose: () => hookify.dispose() })

  // Custom webview chat panel (sidebar)
  const messageHandler = new MessageHandler(
    serverManager, context, diffManager, openFilesManager,
    hookRunner, sandboxManager, confidenceFilter, cmdrConfig, loopManager,
  )
  const chatPanelManager = new ChatPanelManager(context.extensionUri, messageHandler)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelManager.viewType, chatPanelManager),
  )

  // Forward diff results to chat panel
  diffManager.onDiffResult(({ filePath, accepted }) => {
    chatPanelManager.postMessage({
      type: 'diffResult',
      filePath,
      accepted,
    })
  })

  // Chat provider (@cmdr participant — built-in chat API)
  const chatProvider = new ChatProvider(serverManager, context)
  context.subscriptions.push(chatProvider.register())

  // Inline completion provider
  const inlineProvider = new InlineProvider()
  context.subscriptions.push(inlineProvider.register())

  // Code action provider
  const codeActionProvider = new CodeActionProvider(serverManager)
  context.subscriptions.push(codeActionProvider.register())

  // Status bar
  const statusBar = new StatusBar(serverManager, inlineProvider)
  const statusBarDisposables = statusBar.register()
  context.subscriptions.push(...statusBarDisposables)

  // Commands
  registerCommands(context, serverManager, diffManager, pluginMarketplace, hookify, loopManager)

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('cmdr')) {
        serverManager?.reloadConfig()
        inlineProvider.reloadConfig()
        statusBar.update()
        hookRunner.refresh()
        sandboxManager.refresh()
        confidenceFilter.refresh()
        loopManager.refresh()
      }
    }),
  )

  // Fire SessionStart hook
  hookRunner.run('SessionStart', {}).catch(() => {})

  vscode.window.showInformationMessage('cmdr extension activated')
}

export async function deactivate(): Promise<void> {
  if (diffManager) {
    diffManager.dispose()
    diffManager = undefined
  }
  if (serverManager) {
    await serverManager.stop()
    serverManager = undefined
  }
}
