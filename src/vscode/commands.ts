/**
 * cmdr VS Code Extension — Command Registrations.
 *
 * Registers all extension commands in the command palette.
 */

import * as vscode from 'vscode'
import type { ServerManager } from './server-manager.js'
import type { DiffManager } from './diff-manager.js'
import type { PluginMarketplace } from './plugin-marketplace.js'
import type { Hookify } from './hookify.js'
import type { AutonomousLoopManager } from './autonomous-loops.js'

/** Helper: send a prompt to cmdr serve and display result in a new editor or notification. */
async function sendToCmdr(
  serverManager: ServerManager,
  prompt: string,
  document?: vscode.TextDocument,
  range?: vscode.Range,
): Promise<string | null> {
  if (!serverManager.isHealthy()) {
    vscode.window.showWarningMessage('cmdr server is not running.')
    return null
  }

  const baseUrl = serverManager.getBaseUrl()

  // Build context
  let context = ''
  if (document && range) {
    const fileName = vscode.workspace.asRelativePath(document.uri)
    const selectedText = document.getText(range)
    context = `\n\n[Code from ${fileName}:${range.start.line + 1}-${range.end.line + 1}]\n\`\`\`\n${selectedText}\n\`\`\``
  }

  const message = `${prompt}${context}`

  try {
    const response = await fetch(`${baseUrl}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    if (!response.ok) {
      vscode.window.showErrorMessage(`cmdr error: ${response.status}`)
      return null
    }

    const data = await response.json() as { response: string }
    return data.response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    vscode.window.showErrorMessage(`cmdr request failed: ${msg}`)
    return null
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  serverManager: ServerManager,
  diffManager: DiffManager,
  pluginMarketplace?: PluginMarketplace,
  hookify?: Hookify,
  loopManager?: AutonomousLoopManager,
): void {
  // cmdr.openChat — Focus the chat sidebar panel
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.openChat', () => {
      vscode.commands.executeCommand('cmdr.chatPanel.focus')
    }),
  )

  // cmdr.toggleInline — Toggle inline completions
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.toggleInline', async () => {
      const config = vscode.workspace.getConfiguration('cmdr')
      const current = config.get<boolean>('inlineCompletions', true)
      await config.update('inlineCompletions', !current, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(`cmdr inline completions: ${!current ? 'enabled' : 'disabled'}`)
    }),
  )

  // cmdr.explain — Explain selected code
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.explain', async (doc?: vscode.TextDocument, range?: vscode.Range) => {
      const editor = vscode.window.activeTextEditor
      const document = doc ?? editor?.document
      const selection = range ?? editor?.selection

      if (!document || !selection || selection.isEmpty) {
        vscode.window.showInformationMessage('Select some code to explain.')
        return
      }

      const result = await sendToCmdr(serverManager, 'Explain this code concisely:', document, selection)
      if (result) {
        const outputDoc = await vscode.workspace.openTextDocument({
          content: result,
          language: 'markdown',
        })
        await vscode.window.showTextDocument(outputDoc, vscode.ViewColumn.Beside)
      }
    }),
  )

  // cmdr.refactor — Refactor selected code
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.refactor', async (doc?: vscode.TextDocument, range?: vscode.Range) => {
      const editor = vscode.window.activeTextEditor
      const document = doc ?? editor?.document
      const selection = range ?? editor?.selection

      if (!document || !selection || selection.isEmpty) {
        vscode.window.showInformationMessage('Select some code to refactor.')
        return
      }

      const result = await sendToCmdr(serverManager, 'Refactor this code for improved readability and maintainability. Return only the refactored code:', document, selection)
      if (result) {
        // Extract code block if wrapped in markdown
        const codeMatch = result.match(/```[\w]*\n([\s\S]*?)```/)
        const code = codeMatch ? codeMatch[1] : result

        const edit = new vscode.WorkspaceEdit()
        edit.replace(document.uri, selection, code)
        await vscode.workspace.applyEdit(edit)
      }
    }),
  )

  // cmdr.writeTests — Write tests for selected code
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.writeTests', async (doc?: vscode.TextDocument, range?: vscode.Range) => {
      const editor = vscode.window.activeTextEditor
      const document = doc ?? editor?.document
      const selection = range ?? editor?.selection

      if (!document || !selection || selection.isEmpty) {
        vscode.window.showInformationMessage('Select some code to write tests for.')
        return
      }

      const result = await sendToCmdr(serverManager, 'Write comprehensive unit tests for this code:', document, selection)
      if (result) {
        const outputDoc = await vscode.workspace.openTextDocument({
          content: result,
          language: document.languageId,
        })
        await vscode.window.showTextDocument(outputDoc, vscode.ViewColumn.Beside)
      }
    }),
  )

  // cmdr.fixDiagnostic — Fix errors/warnings
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.fixDiagnostic', async (
      doc?: vscode.TextDocument,
      range?: vscode.Range,
      diagnostics?: vscode.Diagnostic[],
    ) => {
      const editor = vscode.window.activeTextEditor
      const document = doc ?? editor?.document
      if (!document) return

      const diags = diagnostics ?? vscode.languages.getDiagnostics(document.uri)
        .filter(d => d.severity === vscode.DiagnosticSeverity.Error)

      if (diags.length === 0) {
        vscode.window.showInformationMessage('No errors to fix.')
        return
      }

      const diagText = diags.map(d => `Line ${d.range.start.line + 1}: ${d.message} (${d.source})`).join('\n')
      const codeRange = range ?? new vscode.Range(
        new vscode.Position(Math.max(0, diags[0].range.start.line - 5), 0),
        new vscode.Position(Math.min(document.lineCount - 1, diags[diags.length - 1].range.end.line + 5), 10000),
      )

      const prompt = `Fix these errors:\n${diagText}\n\nReturn only the corrected code:`
      const result = await sendToCmdr(serverManager, prompt, document, codeRange)
      if (result) {
        const codeMatch = result.match(/```[\w]*\n([\s\S]*?)```/)
        const code = codeMatch ? codeMatch[1] : result

        const edit = new vscode.WorkspaceEdit()
        edit.replace(document.uri, codeRange, code)
        await vscode.workspace.applyEdit(edit)
      }
    }),
  )

  // cmdr.review — Review git changes
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.review', async () => {
      const result = await sendToCmdr(serverManager, 'Review the recent git changes in this repository. Focus on bugs, security issues, and code quality.')
      if (result) {
        const outputDoc = await vscode.workspace.openTextDocument({
          content: result,
          language: 'markdown',
        })
        await vscode.window.showTextDocument(outputDoc, vscode.ViewColumn.Beside)
      }
    }),
  )

  // cmdr.switchModel — Switch the active model
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.switchModel', async () => {
      try {
        const baseUrl = serverManager.getBaseUrl()
        const response = await fetch(`${baseUrl}/v1/models`)
        if (!response.ok) throw new Error('Failed to fetch models')
        const data = await response.json() as { models: string[] }

        const selected = await vscode.window.showQuickPick(data.models, {
          placeHolder: 'Select a model',
        })
        if (selected) {
          const config = vscode.workspace.getConfiguration('cmdr')
          await config.update('model', selected, vscode.ConfigurationTarget.Workspace)
          vscode.window.showInformationMessage(`cmdr model switched to: ${selected}`)
        }
      } catch (err) {
        const model = await vscode.window.showInputBox({
          prompt: 'Enter model name',
          placeHolder: 'qwen3-coder',
        })
        if (model) {
          const config = vscode.workspace.getConfiguration('cmdr')
          await config.update('model', model, vscode.ConfigurationTarget.Workspace)
        }
      }
    }),
  )

  // cmdr.diff.accept — Accept proposed diff changes
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.diff.accept', async () => {
      await diffManager.acceptDiff()
    }),
  )

  // cmdr.diff.reject — Reject proposed diff changes
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.diff.reject', async () => {
      await diffManager.rejectDiff()
    }),
  )

  // cmdr.newChat — Clear chat and start fresh
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.newChat', () => {
      vscode.commands.executeCommand('cmdr.chatPanel.focus')
    }),
  )

  // cmdr.toggleAutoApprove — Toggle auto-approve mode
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.toggleAutoApprove', async () => {
      const config = vscode.workspace.getConfiguration('cmdr')
      const current = config.get<string>('autoApprove', 'ask')
      const next = current === 'ask' ? 'auto' : 'ask'
      await config.update('autoApprove', next, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(`cmdr auto-approve: ${next === 'auto' ? 'enabled (all tools auto-approved)' : 'disabled (will ask for approval)'}`)
    }),
  )

  // cmdr.managePlugins — Open plugin marketplace UI
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.managePlugins', async () => {
      if (pluginMarketplace) {
        await pluginMarketplace.showPluginPicker()
      } else {
        vscode.window.showWarningMessage('Plugin marketplace not available')
      }
    }),
  )

  // cmdr.manageHookifyRules — Open hookify rule manager
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.manageHookifyRules', async () => {
      if (hookify) {
        await hookify.showManager()
      } else {
        vscode.window.showWarningMessage('Hookify not available')
      }
    }),
  )

  // cmdr.createHookifyRule — Create a new hookify rule
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.createHookifyRule', async () => {
      if (hookify) {
        await hookify.createRule()
      } else {
        vscode.window.showWarningMessage('Hookify not available')
      }
    }),
  )

  // cmdr.toggleAutonomousLoop — Toggle autonomous loop mode
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.toggleAutonomousLoop', async () => {
      const config = vscode.workspace.getConfiguration('cmdr')
      const current = config.get<boolean>('autonomousLoop.enabled', false)
      await config.update('autonomousLoop.enabled', !current, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(`cmdr autonomous loop: ${!current ? 'enabled' : 'disabled'}`)
    }),
  )

  // cmdr.cancelLoop — Cancel the active autonomous loop
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.cancelLoop', () => {
      if (loopManager?.getActiveLoop()) {
        loopManager.cancelLoop()
        vscode.window.showInformationMessage('cmdr autonomous loop cancelled')
      } else {
        vscode.window.showInformationMessage('No active loop to cancel')
      }
    }),
  )

  // cmdr.toggleDeferredMode — Toggle deferred/headless mode
  context.subscriptions.push(
    vscode.commands.registerCommand('cmdr.toggleDeferredMode', async () => {
      const config = vscode.workspace.getConfiguration('cmdr')
      const current = config.get<boolean>('deferredMode', false)
      await config.update('deferredMode', !current, vscode.ConfigurationTarget.Global)
      vscode.window.showInformationMessage(`cmdr deferred mode: ${!current ? 'enabled (will pause at tool decisions)' : 'disabled'}`)
    }),
  )
}
