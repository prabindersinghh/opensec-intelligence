/**
 * cmdr VS Code Extension — Status Bar.
 *
 * Shows: $(hubot) cmdr: model | effort: level | status
 * Click opens quick pick for model switch, effort change, toggle completions.
 */

import * as vscode from 'vscode'
import type { ServerManager } from './server-manager.js'
import type { InlineProvider } from './inline-provider.js'

export class StatusBar {
  private item: vscode.StatusBarItem

  constructor(
    private serverManager: ServerManager,
    private inlineProvider: InlineProvider,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.item.command = 'cmdr.statusBarMenu'
  }

  /** Register and show status bar. */
  register(): vscode.Disposable[] {
    this.update()
    this.item.show()

    // Update periodically
    const interval = setInterval(() => this.update(), 5000)

    const menuCommand = vscode.commands.registerCommand('cmdr.statusBarMenu', async () => {
      await this.showMenu()
    })

    return [
      this.item,
      menuCommand,
      { dispose: () => clearInterval(interval) },
    ]
  }

  /** Update status bar text. */
  update(): void {
    const config = vscode.workspace.getConfiguration('cmdr')
    const model = config.get<string>('model', 'qwen3-coder')
    const effort = config.get<string>('effort', 'medium')
    const connected = this.serverManager.isHealthy()
    const status = connected ? '$(check)' : '$(warning)'

    this.item.text = `$(hubot) cmdr: ${model} | effort: ${effort} | ${status}`
    this.item.tooltip = connected
      ? 'cmdr is connected. Click for options.'
      : 'cmdr server not connected. Click to start.'
  }

  /** Show quick pick menu. */
  private async showMenu(): Promise<void> {
    const config = vscode.workspace.getConfiguration('cmdr')
    const items: vscode.QuickPickItem[] = [
      { label: '$(settings-gear) Switch Model', description: `Current: ${config.get('model')}` },
      { label: '$(flame) Change Effort', description: `Current: ${config.get('effort')}` },
      { label: '$(symbol-boolean) Toggle Completions', description: `Currently: ${config.get('inlineCompletions') ? 'enabled' : 'disabled'}` },
      { label: '$(debug-restart) Restart Server' },
      { label: '$(output) Show Output' },
    ]

    const selected = await vscode.window.showQuickPick(items, { placeHolder: 'cmdr options' })
    if (!selected) return

    switch (selected.label) {
      case '$(settings-gear) Switch Model':
        await vscode.commands.executeCommand('cmdr.switchModel')
        break
      case '$(flame) Change Effort': {
        const effort = await vscode.window.showQuickPick(
          ['low', 'medium', 'high', 'max'],
          { placeHolder: 'Select effort level' },
        )
        if (effort) {
          await config.update('effort', effort, vscode.ConfigurationTarget.Workspace)
          this.update()
        }
        break
      }
      case '$(symbol-boolean) Toggle Completions': {
        const current = config.get<boolean>('inlineCompletions', true)
        await config.update('inlineCompletions', !current, vscode.ConfigurationTarget.Workspace)
        this.inlineProvider.toggle()
        this.update()
        break
      }
      case '$(debug-restart) Restart Server':
        await this.serverManager.stop()
        await this.serverManager.start()
        this.update()
        break
      case '$(output) Show Output':
        vscode.commands.executeCommand('workbench.action.output.show')
        break
    }
  }
}
