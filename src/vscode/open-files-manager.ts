/**
 * cmdr VS Code Extension — Open Files Manager.
 *
 * Tracks open files, cursor positions, and selected text.
 * Broadcasts context updates to the chat panel for richer context awareness.
 * Ported from gemini-cli's OpenFilesManager pattern.
 */

import * as vscode from 'vscode'

export interface TrackedFile {
  path: string
  relativePath: string
  language: string
  isActive: boolean
  timestamp: number
  cursor?: { line: number; character: number }
  selectedText?: string
}

const MAX_FILES = 10
const MAX_SELECTED_TEXT_LENGTH = 16384 // 16 KiB

export class OpenFilesManager {
  private onDidChangeEmitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.onDidChangeEmitter.event
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private openFiles: TrackedFile[] = []

  constructor(private context: vscode.ExtensionContext) {
    const editorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.isFileUri(editor.document.uri)) {
        this.addOrMoveToFront(editor)
        this.fireWithDebounce()
      }
    })

    const selectionWatcher = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (this.isFileUri(event.textEditor.document.uri)) {
        this.updateActiveContext(event.textEditor)
        this.fireWithDebounce()
      }
    })

    const closeWatcher = vscode.workspace.onDidCloseTextDocument((document) => {
      if (this.isFileUri(document.uri)) {
        this.remove(document.uri)
        this.fireWithDebounce()
      }
    })

    const deleteWatcher = vscode.workspace.onDidDeleteFiles((event) => {
      for (const uri of event.files) {
        if (this.isFileUri(uri)) {
          this.remove(uri)
        }
      }
      this.fireWithDebounce()
    })

    const renameWatcher = vscode.workspace.onDidRenameFiles((event) => {
      for (const { oldUri, newUri } of event.files) {
        if (this.isFileUri(oldUri)) {
          if (this.isFileUri(newUri)) {
            this.rename(oldUri, newUri)
          } else {
            this.remove(oldUri)
          }
        }
      }
      this.fireWithDebounce()
    })

    context.subscriptions.push(
      editorWatcher,
      selectionWatcher,
      closeWatcher,
      deleteWatcher,
      renameWatcher,
    )

    // Add current active file on startup
    if (vscode.window.activeTextEditor && this.isFileUri(vscode.window.activeTextEditor.document.uri)) {
      this.addOrMoveToFront(vscode.window.activeTextEditor)
    }
  }

  /** Get the list of tracked open files. */
  get files(): TrackedFile[] {
    return [...this.openFiles]
  }

  /** Get the currently active file. */
  get activeFile(): TrackedFile | undefined {
    return this.openFiles.find((f) => f.isActive)
  }

  private isFileUri(uri: vscode.Uri): boolean {
    return uri.scheme === 'file'
  }

  private addOrMoveToFront(editor: vscode.TextEditor): void {
    // Deactivate previous active file
    const currentActive = this.openFiles.find((f) => f.isActive)
    if (currentActive) {
      currentActive.isActive = false
      currentActive.cursor = undefined
      currentActive.selectedText = undefined
    }

    // Remove if already tracked
    const index = this.openFiles.findIndex((f) => f.path === editor.document.uri.fsPath)
    if (index !== -1) {
      this.openFiles.splice(index, 1)
    }

    // Add to front as active
    this.openFiles.unshift({
      path: editor.document.uri.fsPath,
      relativePath: vscode.workspace.asRelativePath(editor.document.uri),
      language: editor.document.languageId,
      isActive: true,
      timestamp: Date.now(),
    })

    // Enforce max
    if (this.openFiles.length > MAX_FILES) {
      this.openFiles.pop()
    }

    this.updateActiveContext(editor)
  }

  private remove(uri: vscode.Uri): void {
    const index = this.openFiles.findIndex((f) => f.path === uri.fsPath)
    if (index !== -1) {
      this.openFiles.splice(index, 1)
    }
  }

  private rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const index = this.openFiles.findIndex((f) => f.path === oldUri.fsPath)
    if (index !== -1) {
      this.openFiles[index].path = newUri.fsPath
      this.openFiles[index].relativePath = vscode.workspace.asRelativePath(newUri)
    }
  }

  private updateActiveContext(editor: vscode.TextEditor): void {
    const file = this.openFiles.find((f) => f.path === editor.document.uri.fsPath)
    if (!file || !file.isActive) return

    file.cursor = editor.selection.active
      ? { line: editor.selection.active.line + 1, character: editor.selection.active.character + 1 }
      : undefined

    let selectedText: string | undefined = editor.document.getText(editor.selection) || undefined
    if (selectedText && selectedText.length > MAX_SELECTED_TEXT_LENGTH) {
      selectedText = selectedText.substring(0, MAX_SELECTED_TEXT_LENGTH)
    }
    file.selectedText = selectedText
  }

  private fireWithDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.onDidChangeEmitter.fire()
    }, 100) // 100ms debounce
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
  }
}
