import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { StreamClient } from './stream-client'
import { ContextCollector } from '../context-collector'
import type { ServerManager } from '../server-manager'
import type { DiffManager } from '../diff-manager'
import type { OpenFilesManager } from '../open-files-manager'
import type { HookRunner } from '../hooks'
import type { SandboxManager } from '../sandbox'
import type { ConfidenceFilter } from '../confidence'
import type { CmdrConfigLoader } from '../cmdr-config'
import type { AutonomousLoopManager } from '../autonomous-loops'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  tools?: { name: string; status: string; duration?: number }[]
  context?: { file?: string; selection?: string }
}

export class MessageHandler {
  private streamClient = new StreamClient()
  private contextCollector = new ContextCollector()
  private history: ChatMessage[] = []
  private pendingApprovals = new Map<string, { resolve: (approved: boolean) => void }>()

  constructor(
    private serverManager: ServerManager,
    private context: vscode.ExtensionContext,
    private diffManager: DiffManager,
    private openFilesManager: OpenFilesManager,
    private hookRunner?: HookRunner,
    private sandboxManager?: SandboxManager,
    private confidenceFilter?: ConfidenceFilter,
    private cmdrConfig?: CmdrConfigLoader,
    private loopManager?: AutonomousLoopManager,
  ) {
    // Load persisted history
    this.history = this.context.globalState.get<ChatMessage[]>('cmdr.chatHistory', [])
  }

  async handleWebviewMessage(msg: any, webview: vscode.Webview): Promise<void> {
    switch (msg.type) {
      case 'send':
        await this.handleSend(msg.text, webview)
        break

      case 'stop':
        this.streamClient.stop()
        break

      case 'getContext': {
        const ctx = this.contextCollector.collect()
        webview.postMessage({
          type: 'context',
          file: ctx.filePath,
          selection: ctx.selectedText,
          language: ctx.language,
          diagnostics: ctx.diagnostics?.map((d) => `${d.severity} at line ${d.line}: ${d.message}`),
        })
        break
      }

      case 'getModels':
        await this.handleGetModels(webview)
        break

      case 'setModel': {
        const config = vscode.workspace.getConfiguration('cmdr')
        await config.update('model', msg.model, vscode.ConfigurationTarget.Global)
        break
      }

      case 'setEffort': {
        const config = vscode.workspace.getConfiguration('cmdr')
        await config.update('effort', msg.effort, vscode.ConfigurationTarget.Global)
        webview.postMessage({ type: 'effort', level: msg.effort })
        break
      }

      case 'applyDiff':
        await this.handleApplyDiff(msg.filePath, msg.code, webview)
        break

      case 'insertCode':
        await this.handleInsertCode(msg.code)
        break

      case 'copyCode':
        await vscode.env.clipboard.writeText(msg.code)
        webview.postMessage({ type: 'notification', text: 'Copied to clipboard', level: 'info' })
        break

      case 'approvalResponse':
        this.handleApprovalResponse(msg.approvalId, msg.approved, msg.alwaysApprove, msg.tool)
        break

      case 'openFile':
        await this.handleOpenFile(msg.filePath, msg.line)
        break

      case 'getHistory':
        webview.postMessage({ type: 'history', messages: this.history })
        break

      case 'clearHistory':
        this.history = []
        await this.context.globalState.update('cmdr.chatHistory', [])
        webview.postMessage({ type: 'history', messages: [] })
        break

      case 'exportChat':
        await this.handleExport(msg.format)
        break
    }
  }

  private async handleSend(text: string, webview: vscode.Webview): Promise<void> {
    if (!this.serverManager.isHealthy()) {
      webview.postMessage({
        type: 'notification',
        text: 'cmdr server is not running. Starting...',
        level: 'warning',
      })
      await this.serverManager.start()
      await new Promise((resolve) => setTimeout(resolve, 3000))
      if (!this.serverManager.isHealthy()) {
        webview.postMessage({
          type: 'streamError',
          id: '',
          error: 'Could not connect to cmdr server.',
        })
        return
      }
    }

    const ctx = this.contextCollector.collect()

    // Add open files context from OpenFilesManager
    const trackedFiles = this.openFilesManager.files
    const openFilesContext = trackedFiles
      .filter((f) => !f.isActive) // Active file already included via ContextCollector
      .map((f) => f.relativePath)
    if (openFilesContext.length > 0) {
      ctx.openFiles = [...(ctx.openFiles || []), ...openFilesContext]
    }

    const contextPrompt = this.contextCollector.buildContextPrompt(ctx)

    // Inject CMDR.md context for the active file
    let cmdrContext = ''
    if (this.cmdrConfig && ctx.filePath) {
      cmdrContext = this.cmdrConfig.getContextForFile(ctx.filePath)
    } else if (this.cmdrConfig) {
      const rootConfig = this.cmdrConfig.getRootConfig()
      if (rootConfig) cmdrContext = rootConfig.body
    }

    const fullPrompt = (cmdrContext ? cmdrContext + '\n\n' : '') + contextPrompt + text

    const config = vscode.workspace.getConfiguration('cmdr')
    const model = config.get<string>('model', 'qwen3-coder')
    const effort = config.get<string>('effort', 'medium')
    const autoApprove = config.get<string>('autoApprove', 'ask')
    const approvedTools = config.get<string[]>('approvedTools', [])
    const useDiffEditor = config.get<boolean>('useDiffEditor', true)
    const deferredMode = config.get<boolean>('deferredMode', false)

    // Configure deferred mode on stream client
    this.streamClient.setDeferredMode(deferredMode)

    const msgId = generateId()

    // Save user message
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      context: { file: ctx.filePath, selection: ctx.selectedText },
    }
    this.history.push(userMsg)

    // Start streaming
    webview.postMessage({ type: 'streamStart', id: msgId })

    let assistantContent = ''
    const tools: ChatMessage['tools'] = []

    try {
      await this.streamClient.stream(
        this.serverManager.getBaseUrl(),
        fullPrompt,
        { model, effort },
        async (event) => {
          switch (event.type) {
            case 'text':
              assistantContent += event.text || ''
              webview.postMessage({ type: 'streamText', id: msgId, text: event.text })
              break

            case 'tool_start':
              tools.push({ name: event.tool || 'unknown', status: 'start' })
              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'start',
                input: event.input,
              })
              break

            case 'tool_done': {
              const t = tools.find((t) => t.name === event.tool && t.status === 'start')
              if (t) {
                t.status = 'done'
                t.duration = event.duration
              }

              // Confidence scoring
              let confidenceInfo: string | undefined
              if (this.confidenceFilter?.isEnabled() && event.tool) {
                const result = this.confidenceFilter.scoreToolResult(
                  event.tool,
                  typeof event.input === 'object' ? (event.input as Record<string, unknown>) : {},
                  event.output || '',
                  event.exitCode,
                )
                if (!result.passed) {
                  confidenceInfo = this.confidenceFilter.formatScore(result)
                  if (this.confidenceFilter.isHardBlocked(result.score)) {
                    webview.postMessage({
                      type: 'notification',
                      text: `Low confidence (${result.score.overall}%): ${result.reason || 'review recommended'}`,
                      level: 'warning',
                    })
                  }
                }
              }

              // Run PostToolUse hook
              if (this.hookRunner && event.tool) {
                await this.hookRunner.run('PostToolUse', {
                  tool: event.tool,
                  output: event.output,
                  duration: event.duration,
                }).catch(() => {})
              }

              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'done',
                output: event.output,
                duration: event.duration,
              })
              break
            }

            case 'tool_error':
              webview.postMessage({
                type: 'streamTool',
                id: msgId,
                tool: event.tool,
                status: 'error',
              })
              break

            case 'tool_approval': {
              // Check auto-approve settings
              const toolName = event.tool || 'unknown'

              // Run PreToolUse hook
              if (this.hookRunner) {
                const hookResult = await this.hookRunner.run('PreToolUse', {
                  tool: toolName,
                  input: event.input,
                })
                if (hookResult.exitCode === 2) {
                  // Hook blocked this tool — send denial to server
                  this.sendApprovalToServer(event.approvalId || '', false)
                  webview.postMessage({
                    type: 'streamTool',
                    id: msgId,
                    tool: toolName,
                    status: 'blocked',
                    input: event.input,
                  })
                  webview.postMessage({
                    type: 'notification',
                    text: `Hook blocked ${toolName}: ${hookResult.message || hookResult.stderr || 'PreToolUse hook denied'}`,
                    level: 'warning',
                  })
                  break
                }
                if (hookResult.exitCode === 1) {
                  webview.postMessage({
                    type: 'notification',
                    text: `Hook warning for ${toolName}: ${hookResult.message || hookResult.stderr || 'proceed with caution'}`,
                    level: 'warning',
                  })
                }
              }

              // Sandbox validation for bash/terminal commands
              if (this.sandboxManager && this.sandboxManager.isEnabled()) {
                const inputObj = typeof event.input === 'object' && event.input !== null ? event.input as Record<string, unknown> : {}
                const cmd = typeof inputObj.command === 'string' ? inputObj.command : ''
                if (cmd && (toolName.toLowerCase().includes('bash') || toolName.toLowerCase().includes('terminal'))) {
                  const validation = this.sandboxManager.validateCommand(cmd)
                  if (!validation.allowed) {
                    this.sendApprovalToServer(event.approvalId || '', false)
                    webview.postMessage({
                      type: 'streamTool',
                      id: msgId,
                      tool: toolName,
                      status: 'blocked',
                      input: event.input,
                    })
                    webview.postMessage({
                      type: 'notification',
                      text: `Sandbox blocked: ${validation.reason}`,
                      level: 'error',
                    })
                    break
                  }
                }
              }

              if (autoApprove === 'auto' || approvedTools.includes(toolName)) {
                // Auto-approve — send approval back to server
                this.sendApprovalToServer(event.approvalId || '', true)
                webview.postMessage({
                  type: 'streamTool',
                  id: msgId,
                  tool: toolName,
                  status: 'auto-approved',
                  input: event.input,
                })
              } else {
                // Ask user for approval via webview
                webview.postMessage({
                  type: 'approvalRequired',
                  id: msgId,
                  approvalId: event.approvalId,
                  tool: toolName,
                  input: event.input,
                  description: event.description,
                })
              }
              break
            }

            case 'terminal': {
              // Forward terminal output to webview
              webview.postMessage({
                type: 'terminalOutput',
                id: msgId,
                command: event.command,
                output: event.output || '',
                exitCode: event.exitCode,
                cwd: event.cwd,
              })
              break
            }

            case 'file_edit': {
              // Use native diff editor if enabled
              if (useDiffEditor && event.filePath && event.newContent) {
                webview.postMessage({
                  type: 'fileEdit',
                  id: msgId,
                  filePath: event.filePath,
                  status: 'pending',
                })
                try {
                  await this.diffManager.showDiff(event.filePath, event.newContent)
                } catch (err) {
                  webview.postMessage({
                    type: 'notification',
                    text: `Failed to show diff: ${err instanceof Error ? err.message : String(err)}`,
                    level: 'error',
                  })
                }
              } else if (event.filePath && event.newContent) {
                // Fallback: apply directly
                await this.handleApplyDiff(event.filePath, event.newContent, webview)
              }
              break
            }

            case 'done':
              webview.postMessage({
                type: 'streamEnd',
                id: msgId,
                tokens: event.tokens,
              })
              break

            case 'error':
              webview.postMessage({
                type: 'streamError',
                id: msgId,
                error: event.error,
              })
              break
          }
        },
      )
    } catch (err) {
      webview.postMessage({
        type: 'streamError',
        id: msgId,
        error: err instanceof Error ? err.message : String(err),
      })
    }

    // Save assistant message
    const assistantMsg: ChatMessage = {
      id: msgId,
      role: 'assistant',
      content: assistantContent,
      timestamp: Date.now(),
      tools: tools.length > 0 ? tools : undefined,
    }
    this.history.push(assistantMsg)
    await this.context.globalState.update('cmdr.chatHistory', this.history.slice(-100))
  }

  private async handleGetModels(webview: vscode.Webview): Promise<void> {
    const config = vscode.workspace.getConfiguration('cmdr')
    const ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
    const currentModel = config.get<string>('model', 'qwen3-coder')

    try {
      const response = await fetch(`${ollamaUrl}/api/tags`)
      if (response.ok) {
        const data = (await response.json()) as { models: { name: string }[] }
        const models = data.models?.map((m) => m.name) ?? []
        webview.postMessage({ type: 'models', models, current: currentModel })
      }
    } catch {
      webview.postMessage({ type: 'models', models: [currentModel], current: currentModel })
    }
  }

  private async handleApplyDiff(filePath: string, code: string, webview: vscode.Webview): Promise<void> {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!workspaceRoot) throw new Error('No workspace folder')

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath)

      const uri = vscode.Uri.file(fullPath)
      const encoder = new TextEncoder()
      await vscode.workspace.fs.writeFile(uri, encoder.encode(code))
      await vscode.window.showTextDocument(uri)
      webview.postMessage({ type: 'diffApplied', filePath, success: true })
    } catch (err) {
      webview.postMessage({ type: 'diffApplied', filePath, success: false })
      vscode.window.showErrorMessage(`Failed to apply: ${err instanceof Error ? err.message : err}`)
    }
  }

  private async handleInsertCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor to insert into.')
      return
    }
    await editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, code)
    })
  }

  private async handleOpenFile(filePath: string, line?: number): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(workspaceRoot, filePath)

    const uri = vscode.Uri.file(fullPath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(doc)

    if (line !== undefined) {
      const position = new vscode.Position(Math.max(0, line - 1), 0)
      editor.selection = new vscode.Selection(position, position)
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
    }
  }

  private async handleExport(format: 'markdown' | 'json'): Promise<void> {
    let content: string
    if (format === 'json') {
      content = JSON.stringify(this.history, null, 2)
    } else {
      content = this.history
        .map((m) => `## ${m.role === 'user' ? 'You' : 'cmdr'}\n\n${m.content}`)
        .join('\n\n---\n\n')
    }

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: format === 'json' ? 'json' : 'markdown',
    })
    await vscode.window.showTextDocument(doc)
  }

  private handleApprovalResponse(
    approvalId: string,
    approved: boolean,
    alwaysApprove?: boolean,
    toolName?: string,
  ): void {
    // If "always approve" was selected, persist the tool name
    if (alwaysApprove && toolName) {
      const config = vscode.workspace.getConfiguration('cmdr')
      const current = config.get<string[]>('approvedTools', [])
      if (!current.includes(toolName)) {
        config.update('approvedTools', [...current, toolName], vscode.ConfigurationTarget.Global)
      }
    }

    // Send approval back to server
    this.sendApprovalToServer(approvalId, approved)

    // Resolve any pending approval promise
    const pending = this.pendingApprovals.get(approvalId)
    if (pending) {
      pending.resolve(approved)
      this.pendingApprovals.delete(approvalId)
    }
  }

  private async sendApprovalToServer(approvalId: string, approved: boolean): Promise<void> {
    if (!approvalId) return
    try {
      await fetch(`${this.serverManager.getBaseUrl()}/v1/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approval_id: approvalId, approved }),
      })
    } catch {
      // Server may not support approval endpoint yet — ignore
    }
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
