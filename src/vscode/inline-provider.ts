/**
 * cmdr VS Code Extension — Inline Completion Provider.
 *
 * Provides AI-powered code completions using Ollama's FIM (Fill-in-Middle) mode.
 * Uses a lightweight model (qwen2.5-coder:7b by default) for fast completions.
 * Debounced at 300ms, cancels in-flight requests on new keystrokes.
 */

import * as vscode from 'vscode'

export class InlineProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private abortController: AbortController | null = null
  private enabled: boolean
  private model: string
  private ollamaUrl: string

  constructor() {
    const config = vscode.workspace.getConfiguration('cmdr')
    this.enabled = config.get<boolean>('inlineCompletions', true)
    this.model = config.get<string>('completionModel', 'qwen2.5-coder:7b')
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
  }

  /** Register as inline completion provider. */
  register(): vscode.Disposable {
    return vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      this,
    )
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this.enabled) return undefined

    // Cancel previous in-flight request
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }

    // Debounce
    if (this.debounceTimer) clearTimeout(this.debounceTimer)

    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          const result = await this.getCompletion(document, position, token)
          resolve(result)
        } catch {
          resolve(undefined)
        }
      }, 300)

      token.onCancellationRequested(() => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        if (this.abortController) this.abortController.abort()
        resolve(undefined)
      })
    })
  }

  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Extract prefix and suffix
    const prefix = document.getText(new vscode.Range(
      new vscode.Position(Math.max(0, position.line - 50), 0),
      position,
    ))
    const suffix = document.getText(new vscode.Range(
      position,
      new vscode.Position(Math.min(document.lineCount - 1, position.line + 20), 0),
    ))

    if (prefix.trim().length < 3) return undefined

    this.abortController = new AbortController()

    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prefix,
          suffix: suffix,
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 128,
            stop: ['\n\n', '\r\n\r\n'],
          },
        }),
        signal: this.abortController.signal,
      })

      if (token.isCancellationRequested || !response.ok) return undefined

      const data = await response.json() as { response?: string }
      const completion = data.response?.trim()

      if (!completion) return undefined

      return [new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position),
      )]
    } catch {
      return undefined
    }
  }

  /** Reload configuration. */
  reloadConfig(): void {
    const config = vscode.workspace.getConfiguration('cmdr')
    this.enabled = config.get<boolean>('inlineCompletions', true)
    this.model = config.get<string>('completionModel', 'qwen2.5-coder:7b')
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
  }

  /** Toggle inline completions on/off. */
  toggle(): boolean {
    this.enabled = !this.enabled
    return this.enabled
  }
}
