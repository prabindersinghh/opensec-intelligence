/**
 * cmdr VS Code Extension — Diff Manager.
 *
 * Uses VS Code's native diff editor to show file changes.
 * Ported from gemini-cli's DiffManager + DiffContentProvider pattern.
 *
 * Flow:
 * 1. showDiff(filePath, newContent) opens native diff view
 * 2. User accepts (writes to disk) or rejects (discards)
 * 3. Events fire to notify the chat panel of the result
 */

import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DIFF_SCHEME = 'cmdr-diff'

interface DiffEntry {
  filePath: string
  originalContent: string
  newContent: string
  resolve?: (accepted: boolean) => void
}

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private contentMap = new Map<string, string>()
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>()
  readonly onDidChange = this.onDidChangeEmitter.event

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.path) || ''
  }

  setContent(filePath: string, content: string): void {
    this.contentMap.set(filePath, content)
    this.onDidChangeEmitter.fire(vscode.Uri.parse(`${DIFF_SCHEME}:${filePath}`))
  }

  removeContent(filePath: string): void {
    this.contentMap.delete(filePath)
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose()
    this.contentMap.clear()
  }
}

export class DiffManager {
  private activeDiffs = new Map<string, DiffEntry>()
  private onDiffResultEmitter = new vscode.EventEmitter<{ filePath: string; accepted: boolean }>()
  readonly onDiffResult = this.onDiffResultEmitter.event

  constructor(
    private contentProvider: DiffContentProvider,
    private outputChannel: vscode.OutputChannel,
  ) {}

  /** Show a native diff view between original file content and proposed new content. */
  async showDiff(filePath: string, newContent: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      throw new Error('No workspace folder')
    }

    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath)
    const relativePath = vscode.workspace.asRelativePath(fullPath)

    // Read original content (empty string for new files)
    let originalContent = ''
    try {
      originalContent = fs.readFileSync(fullPath, 'utf-8')
    } catch {
      // File doesn't exist yet — creating new file
    }

    // Store diff state
    this.activeDiffs.set(fullPath, { filePath: fullPath, originalContent, newContent })

    // Set content for the virtual document (proposed changes)
    this.contentProvider.setContent(fullPath, newContent)

    // Build URIs
    const leftUri = vscode.Uri.parse(`${DIFF_SCHEME}:${fullPath}`)
    // For the right side, we use a special scheme that shows the NEW content
    const rightPath = `${fullPath}.proposed`
    this.contentProvider.setContent(rightPath, newContent)
    const rightUri = vscode.Uri.parse(`${DIFF_SCHEME}:${rightPath}`)

    // If file exists, left = original content; right = proposed content
    this.contentProvider.setContent(fullPath, originalContent)

    // Set context for menu visibility
    await vscode.commands.executeCommand('setContext', 'cmdr.diff.isVisible', true)

    // Open diff editor
    const title = `${relativePath} (cmdr proposed changes)`
    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title)

    this.outputChannel.appendLine(`[diff] Opened diff view for: ${relativePath}`)
  }

  /** Accept the current diff — write proposed content to file. */
  async acceptDiff(filePath?: string): Promise<void> {
    const entry = filePath ? this.activeDiffs.get(filePath) : this.getActiveEntry()
    if (!entry) {
      vscode.window.showWarningMessage('No active diff to accept.')
      return
    }

    try {
      const encoder = new TextEncoder()
      const uri = vscode.Uri.file(entry.filePath)

      // Ensure directory exists
      const dir = path.dirname(entry.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      await vscode.workspace.fs.writeFile(uri, encoder.encode(entry.newContent))
      this.outputChannel.appendLine(`[diff] Accepted changes for: ${entry.filePath}`)

      // Close diff editor
      await this.closeDiffEditor()

      // Fire event
      this.onDiffResultEmitter.fire({ filePath: entry.filePath, accepted: true })
      entry.resolve?.(true)

      // Cleanup
      this.cleanup(entry.filePath)

      // Open the written file
      await vscode.window.showTextDocument(uri)
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to accept diff: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Reject the current diff — discard proposed changes. */
  async rejectDiff(filePath?: string): Promise<void> {
    const entry = filePath ? this.activeDiffs.get(filePath) : this.getActiveEntry()
    if (!entry) {
      vscode.window.showWarningMessage('No active diff to reject.')
      return
    }

    this.outputChannel.appendLine(`[diff] Rejected changes for: ${entry.filePath}`)

    // Close diff editor
    await this.closeDiffEditor()

    // Fire event
    this.onDiffResultEmitter.fire({ filePath: entry.filePath, accepted: false })
    entry.resolve?.(false)

    // Cleanup
    this.cleanup(entry.filePath)
  }

  /** Show diff and wait for user decision. Returns true if accepted. */
  async showDiffAndWait(filePath: string, newContent: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.showDiff(filePath, newContent).then(() => {
        const entry = this.activeDiffs.get(
          path.isAbsolute(filePath) ? filePath : path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', filePath),
        )
        if (entry) {
          entry.resolve = resolve
        } else {
          resolve(false)
        }
      })
    })
  }

  /** Check if there are active diffs. */
  hasActiveDiffs(): boolean {
    return this.activeDiffs.size > 0
  }

  private getActiveEntry(): DiffEntry | undefined {
    // Return the most recently added diff
    const entries = [...this.activeDiffs.values()]
    return entries[entries.length - 1]
  }

  private cleanup(fullPath: string): void {
    this.contentProvider.removeContent(fullPath)
    this.contentProvider.removeContent(`${fullPath}.proposed`)
    this.activeDiffs.delete(fullPath)

    if (this.activeDiffs.size === 0) {
      vscode.commands.executeCommand('setContext', 'cmdr.diff.isVisible', false)
    }
  }

  private async closeDiffEditor(): Promise<void> {
    // Close the active diff tab
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  }

  dispose(): void {
    this.onDiffResultEmitter.dispose()
    this.activeDiffs.clear()
  }
}
