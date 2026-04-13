import * as vscode from 'vscode'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

export interface ContextPayload {
  filePath?: string
  fileName?: string
  language?: string
  fileContent?: string
  selectedText?: string
  selectionRange?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  diagnostics?: { severity: string; line: number; message: string }[]
  workspaceRoot?: string
  openFiles?: string[]
  gitBranch?: string
}

export class ContextCollector {
  collect(): ContextPayload {
    const editor = vscode.window.activeTextEditor
    if (!editor) return {}

    const document = editor.document
    const selection = editor.selection

    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
      .map((d) => ({
        severity: d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning',
        line: d.range.start.line + 1,
        message: d.message,
      }))

    return {
      filePath: vscode.workspace.asRelativePath(document.uri),
      fileName: path.basename(document.fileName),
      language: document.languageId,
      fileContent: document.getText(),
      selectedText: selection.isEmpty ? undefined : document.getText(selection),
      selectionRange: selection.isEmpty
        ? undefined
        : {
            start: { line: selection.start.line, character: selection.start.character },
            end: { line: selection.end.line, character: selection.end.character },
          },
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      openFiles: vscode.window.visibleTextEditors.map((e) =>
        vscode.workspace.asRelativePath(e.document.uri),
      ),
      gitBranch: this.getGitBranch(),
    }
  }

  buildContextPrompt(ctx: ContextPayload): string {
    const parts: string[] = []

    if (ctx.filePath) {
      parts.push(`Active file: ${ctx.filePath} (${ctx.language})`)
    }

    if (ctx.selectedText) {
      parts.push(
        `Selected code (${ctx.filePath}:${ctx.selectionRange?.start.line}-${ctx.selectionRange?.end.line}):\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      )
    } else if (ctx.fileContent && ctx.fileContent.length < 10000) {
      parts.push(`File content:\n\`\`\`${ctx.language}\n${ctx.fileContent}\n\`\`\``)
    }

    if (ctx.diagnostics?.length) {
      parts.push(
        `Current errors/warnings:\n${ctx.diagnostics.map((d) => `- ${d.severity} at line ${d.line}: ${d.message}`).join('\n')}`,
      )
    }

    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : ''
  }

  private getGitBranch(): string | undefined {
    try {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      if (!root) return undefined
      return execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim()
    } catch {
      return undefined
    }
  }
}
