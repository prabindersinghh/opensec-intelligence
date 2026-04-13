/**
 * cmdr VS Code Extension — Hookify (Dynamic Rule Creation).
 *
 * Creates validation rules dynamically from conversation patterns.
 * Rules are saved as `.cmdr/hookify.*.local.md` files with:
 *   - YAML frontmatter (type, matcher, enabled, created)
 *   - Markdown body (description, rationale)
 *
 * The user can create rules via:
 *   - /hookify slash command in chat
 *   - Quick fix actions on blocked tools
 *   - Manual rule creation via command palette
 *
 * Rules are loaded by HookRunner and applied as inline hook definitions.
 */

import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

export interface HookifyRule {
  /** Unique slug for the rule. */
  slug: string
  /** Hook type: PreToolUse, PostToolUse, etc. */
  type: string
  /** Regex pattern to match tool names. */
  matcher: string
  /** Shell command or script to run. */
  command: string
  /** Whether the rule is active. */
  enabled: boolean
  /** When the rule was created. */
  created: string
  /** Exit code behavior: block (2), warn (1), or allow (0). */
  action: 'block' | 'warn' | 'allow'
  /** Description/rationale. */
  description: string
  /** File path of the .local.md file. */
  filePath: string
}

export class Hookify {
  private rules: HookifyRule[] = []
  private outputChannel: vscode.OutputChannel
  private watcher: vscode.FileSystemWatcher | null = null

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.loadRules()
    this.setupWatcher()
  }

  /** Scan for hookify rule files. */
  loadRules(): void {
    this.rules = []
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    const cmdrDir = path.join(workspaceRoot, '.cmdr')
    if (!fs.existsSync(cmdrDir)) return

    const files = fs.readdirSync(cmdrDir).filter((f) => f.startsWith('hookify.') && f.endsWith('.local.md'))

    for (const file of files) {
      const filePath = path.join(cmdrDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const rule = this.parseRule(content, filePath)
        if (rule) {
          this.rules.push(rule)
        }
      } catch (err) {
        this.outputChannel.appendLine(`[hookify] Failed to parse ${file}: ${err}`)
      }
    }

    this.outputChannel.appendLine(`[hookify] Loaded ${this.rules.length} rules`)
  }

  private parseRule(content: string, filePath: string): HookifyRule | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!match) return null

    const meta: Record<string, string> = {}
    const lines = match[1].split('\n')
    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim()
      }
    }

    if (!meta.type || !meta.matcher) return null

    const slug = path.basename(filePath).replace('hookify.', '').replace('.local.md', '')

    return {
      slug,
      type: meta.type,
      matcher: meta.matcher,
      command: meta.command || '',
      enabled: meta.enabled !== 'false',
      created: meta.created || new Date().toISOString(),
      action: (meta.action as 'block' | 'warn' | 'allow') || 'block',
      description: match[2].trim(),
      filePath,
    }
  }

  private setupWatcher(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.cmdr/hookify.*.local.md')
    const reload = () => this.loadRules()
    this.watcher.onDidCreate(reload)
    this.watcher.onDidChange(reload)
    this.watcher.onDidDelete(reload)
  }

  /** Get all loaded rules. */
  getRules(): HookifyRule[] {
    return [...this.rules]
  }

  /** Get enabled rules only. */
  getActiveRules(): HookifyRule[] {
    return this.rules.filter((r) => r.enabled)
  }

  /** Get rules matching a specific hook type and tool name. */
  getMatchingRules(hookType: string, toolName: string): HookifyRule[] {
    return this.getActiveRules().filter((rule) => {
      if (rule.type !== hookType) return false
      try {
        return new RegExp(rule.matcher, 'i').test(toolName)
      } catch {
        return rule.matcher === toolName
      }
    })
  }

  /**
   * Create a new hookify rule.
   *
   * @returns The created rule, or null if cancelled.
   */
  async createRule(options?: {
    type?: string
    matcher?: string
    action?: 'block' | 'warn' | 'allow'
    description?: string
  }): Promise<HookifyRule | null> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder')
      return null
    }

    // Get hook type
    const type = options?.type || await vscode.window.showQuickPick(
      ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'],
      { placeHolder: 'Hook type' },
    )
    if (!type) return null

    // Get tool matcher
    const matcher = options?.matcher || await vscode.window.showInputBox({
      prompt: 'Tool name regex pattern',
      placeHolder: 'e.g. Bash|bash or Edit|write',
      value: '.*',
    })
    if (!matcher) return null

    // Get action
    const action = options?.action || await vscode.window.showQuickPick(
      [
        { label: 'block', description: 'Block the tool use (exit code 2)' },
        { label: 'warn', description: 'Show warning but allow (exit code 1)' },
        { label: 'allow', description: 'Always allow (exit code 0)' },
      ],
      { placeHolder: 'Action when rule matches' },
    ).then((item) => item?.label as 'block' | 'warn' | 'allow' | undefined)
    if (!action) return null

    // Get description
    const description = options?.description || await vscode.window.showInputBox({
      prompt: 'Description (why this rule exists)',
      placeHolder: 'e.g. Block destructive bash commands in production',
    })
    if (description === undefined) return null

    // Generate slug
    const slug = `${type.toLowerCase()}-${matcher.replace(/[^a-z0-9]/gi, '-').slice(0, 30)}-${Date.now()}`

    // Build the file
    const now = new Date().toISOString()
    const exitCode = action === 'block' ? 2 : action === 'warn' ? 1 : 0
    const command = `exit ${exitCode}`

    const content = [
      '---',
      `type: ${type}`,
      `matcher: ${matcher}`,
      `action: ${action}`,
      `command: ${command}`,
      `enabled: true`,
      `created: ${now}`,
      '---',
      '',
      description || 'No description provided.',
      '',
    ].join('\n')

    // Write the file
    const cmdrDir = path.join(workspaceRoot, '.cmdr')
    if (!fs.existsSync(cmdrDir)) {
      fs.mkdirSync(cmdrDir, { recursive: true })
    }

    const filePath = path.join(cmdrDir, `hookify.${slug}.local.md`)
    fs.writeFileSync(filePath, content, 'utf-8')

    this.outputChannel.appendLine(`[hookify] Created rule: ${slug}`)
    vscode.window.showInformationMessage(`Hookify rule created: ${slug}`)

    this.loadRules()
    const rule = this.rules.find((r) => r.slug === slug)
    return rule || null
  }

  /** Toggle a rule's enabled state. */
  toggleRule(slug: string): boolean {
    const rule = this.rules.find((r) => r.slug === slug)
    if (!rule) return false

    try {
      let content = fs.readFileSync(rule.filePath, 'utf-8')
      const newEnabled = !rule.enabled
      content = content.replace(
        /enabled:\s*(true|false)/,
        `enabled: ${newEnabled}`,
      )
      fs.writeFileSync(rule.filePath, content, 'utf-8')
      this.loadRules()
      return true
    } catch {
      return false
    }
  }

  /** Delete a rule. */
  async deleteRule(slug: string): Promise<boolean> {
    const rule = this.rules.find((r) => r.slug === slug)
    if (!rule) return false

    const confirm = await vscode.window.showWarningMessage(
      `Delete hookify rule '${slug}'?`,
      { modal: true },
      'Delete',
    )
    if (confirm !== 'Delete') return false

    try {
      fs.unlinkSync(rule.filePath)
      this.loadRules()
      return true
    } catch {
      return false
    }
  }

  /** Show rule manager UI. */
  async showManager(): Promise<void> {
    this.loadRules()

    const items: vscode.QuickPickItem[] = this.rules.map((r) => ({
      label: `${r.enabled ? '$(check) ' : '$(circle-slash) '}${r.slug}`,
      description: `${r.type} → ${r.action} | ${r.matcher}`,
      detail: r.description,
    }))

    items.push({
      label: '$(add) Create new rule...',
      description: 'Create a hookify rule from scratch',
    })

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Hookify Rules',
      matchOnDescription: true,
      matchOnDetail: true,
    })

    if (!selected) return

    if (selected.label.includes('Create new rule')) {
      await this.createRule()
      return
    }

    const slug = selected.label.replace(/^\$\([^)]+\)\s*/, '')
    const action = await vscode.window.showQuickPick(
      ['Toggle enabled', 'Edit file', 'Delete'],
      { placeHolder: `Rule: ${slug}` },
    )

    if (action === 'Toggle enabled') {
      this.toggleRule(slug)
    } else if (action === 'Edit file') {
      const rule = this.rules.find((r) => r.slug === slug)
      if (rule) {
        const doc = await vscode.workspace.openTextDocument(rule.filePath)
        await vscode.window.showTextDocument(doc)
      }
    } else if (action === 'Delete') {
      await this.deleteRule(slug)
    }
  }

  dispose(): void {
    this.watcher?.dispose()
    this.rules = []
  }
}
