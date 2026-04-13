/**
 * cmdr VS Code Extension — Chat Provider.
 *
 * Implements the VS Code Chat API participant @cmdr.
 * Sends requests to cmdr serve and streams markdown back.
 */

import * as vscode from 'vscode'
import type { ServerManager } from './server-manager.js'

export class ChatProvider {
  private participantId = 'cmdr.chat'

  constructor(
    private serverManager: ServerManager,
    private context: vscode.ExtensionContext,
  ) {}

  /** Register the chat participant. */
  register(): vscode.Disposable {
    const participant = vscode.chat.createChatParticipant(this.participantId, this.handleRequest.bind(this))
    participant.iconPath = new vscode.ThemeIcon('hubot')
    return participant
  }

  /** Handle incoming chat request. */
  private async handleRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (!this.serverManager.isHealthy()) {
      stream.markdown('⚠️ cmdr server is not running. Starting...')
      await this.serverManager.start()
      // Wait a bit for startup
      await new Promise(resolve => setTimeout(resolve, 3000))
      if (!this.serverManager.isHealthy()) {
        stream.markdown('\n\n❌ Could not connect to cmdr server. Check the output channel for details.')
        return
      }
    }

    // Build context from active editor
    let editorContext = ''
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor) {
      const doc = activeEditor.document
      const fileName = vscode.workspace.asRelativePath(doc.uri)
      const selection = activeEditor.selection
      if (!selection.isEmpty) {
        const selectedText = doc.getText(selection)
        editorContext = `\n\n[Selected code from ${fileName}:${selection.start.line + 1}-${selection.end.line + 1}]\n\`\`\`\n${selectedText}\n\`\`\``
      } else {
        const content = doc.getText()
        // Limit to first 200 lines to avoid token overflow
        const truncated = content.split('\n').slice(0, 200).join('\n')
        editorContext = `\n\n[Active file: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``
      }
    }

    // Add workspace info
    const workspaceFolders = vscode.workspace.workspaceFolders
    const workspaceName = workspaceFolders?.[0]?.name ?? 'unknown'

    const message = `[Workspace: ${workspaceName}]${editorContext}\n\nUser request: ${request.prompt}`

    try {
      const baseUrl = this.serverManager.getBaseUrl()
      const response = await fetch(`${baseUrl}/v1/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: token.isCancellationRequested ? AbortSignal.abort() : undefined,
      })

      if (!response.ok) {
        stream.markdown(`❌ Server error: ${response.status} ${response.statusText}`)
        return
      }

      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (token.isCancellationRequested) {
          reader.cancel()
          break
        }

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text') {
              stream.markdown(event.data as string)
            } else if (event.type === 'tool_use') {
              stream.markdown(`\n\n🔧 Using tool: \`${event.tool}\`\n`)
            } else if (event.type === 'tool_result' && event.is_error) {
              stream.markdown(`\n⚠️ Tool error: ${event.output}\n`)
            } else if (event.type === 'done') {
              // Stream complete
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      stream.markdown(`❌ Request failed: ${msg}`)
    }
  }
}
