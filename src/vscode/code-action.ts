/**
 * cmdr VS Code Extension — Code Action Provider.
 *
 * Provides code actions for:
 * - Fix diagnostics with cmdr
 * - Explain code
 * - Refactor code
 * - Write tests
 */

import * as vscode from 'vscode'
import type { ServerManager } from './server-manager.js'

export class CodeActionProvider implements vscode.CodeActionProvider {
  constructor(private serverManager: ServerManager) {}

  /** Register the code action provider. */
  register(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider(
      { pattern: '**' },
      this,
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.QuickFix,
          vscode.CodeActionKind.Refactor,
        ],
      },
    )
  }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = []

    // Fix diagnostic actions
    if (context.diagnostics.length > 0) {
      const fixAction = new vscode.CodeAction(
        '$(hubot) Fix with cmdr',
        vscode.CodeActionKind.QuickFix,
      )
      fixAction.command = {
        command: 'cmdr.fixDiagnostic',
        title: 'Fix with cmdr',
        arguments: [document, range, context.diagnostics],
      }
      fixAction.isPreferred = false
      actions.push(fixAction)
    }

    // Always-available actions for selections
    if (!range.isEmpty) {
      const explainAction = new vscode.CodeAction(
        '$(hubot) Explain with cmdr',
        vscode.CodeActionKind.Empty,
      )
      explainAction.command = {
        command: 'cmdr.explain',
        title: 'Explain with cmdr',
        arguments: [document, range],
      }
      actions.push(explainAction)

      const refactorAction = new vscode.CodeAction(
        '$(hubot) Refactor with cmdr',
        vscode.CodeActionKind.Refactor,
      )
      refactorAction.command = {
        command: 'cmdr.refactor',
        title: 'Refactor with cmdr',
        arguments: [document, range],
      }
      actions.push(refactorAction)

      const testAction = new vscode.CodeAction(
        '$(hubot) Write tests with cmdr',
        vscode.CodeActionKind.Empty,
      )
      testAction.command = {
        command: 'cmdr.writeTests',
        title: 'Write tests with cmdr',
        arguments: [document, range],
      }
      actions.push(testAction)
    }

    return actions
  }
}
