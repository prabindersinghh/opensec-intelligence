/**
 * cmdr VS Code Extension — Plugin Marketplace.
 *
 * Centralized plugin discovery, installation, and management.
 * Modeled after Claude Code's plugin marketplace with:
 *   - Local registry (.cmdr-plugin/marketplace.json)
 *   - Plugin discovery from remote registries
 *   - Install/uninstall lifecycle
 *   - Plugin manifest validation
 *
 * Plugin Format:
 *   .cmdr-plugin/plugin.json → manifest
 *   commands/*.md → slash commands (markdown with YAML frontmatter)
 *   agents/*.md → agent definitions
 *   hooks/hooks.json → hook configuration
 *   skills/*.md → skill definitions
 */

import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

export interface PluginManifest {
  name: string
  version: string
  description: string
  author?: string
  homepage?: string
  repository?: string
  tags?: string[]
  // What the plugin provides
  commands?: string[]
  agents?: string[]
  hooks?: string[]
  skills?: string[]
}

export interface PluginEntry {
  name: string
  version: string
  description: string
  author?: string
  tags?: string[]
  installed: boolean
  path?: string // Local path if installed
  source?: string // Remote URL/registry
}

export interface MarketplaceRegistry {
  version: string
  plugins: Array<{
    name: string
    version: string
    description: string
    author?: string
    tags?: string[]
    repository: string
  }>
}

export class PluginMarketplace {
  private plugins: PluginEntry[] = []
  private outputChannel: vscode.OutputChannel

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.scanInstalledPlugins()
  }

  /** Scan workspace for installed plugins. */
  scanInstalledPlugins(): void {
    this.plugins = []
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    // Check .cmdr/plugins/ directory
    const pluginsDir = path.join(workspaceRoot, '.cmdr', 'plugins')
    if (fs.existsSync(pluginsDir)) {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = path.join(pluginsDir, entry.name, '.cmdr-plugin', 'plugin.json')
        const altManifestPath = path.join(pluginsDir, entry.name, 'plugin.json')

        const mPath = fs.existsSync(manifestPath) ? manifestPath : fs.existsSync(altManifestPath) ? altManifestPath : null
        if (mPath) {
          try {
            const manifest = JSON.parse(fs.readFileSync(mPath, 'utf-8')) as PluginManifest
            this.plugins.push({
              name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              author: manifest.author,
              tags: manifest.tags,
              installed: true,
              path: path.join(pluginsDir, entry.name),
            })
          } catch (err) {
            this.outputChannel.appendLine(`[plugins] Failed to load plugin ${entry.name}: ${err}`)
          }
        }
      }
    }

    // Check for marketplace registry
    const registryPath = path.join(workspaceRoot, '.cmdr-plugin', 'marketplace.json')
    if (fs.existsSync(registryPath)) {
      try {
        const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as MarketplaceRegistry
        for (const entry of registry.plugins) {
          const existing = this.plugins.find((p) => p.name === entry.name)
          if (!existing) {
            this.plugins.push({
              name: entry.name,
              version: entry.version,
              description: entry.description,
              author: entry.author,
              tags: entry.tags,
              installed: false,
              source: entry.repository,
            })
          }
        }
        this.outputChannel.appendLine(`[plugins] Loaded ${registry.plugins.length} plugins from marketplace`)
      } catch (err) {
        this.outputChannel.appendLine(`[plugins] Failed to load marketplace: ${err}`)
      }
    }

    this.outputChannel.appendLine(`[plugins] Found ${this.plugins.filter((p) => p.installed).length} installed plugins`)
  }

  /** Get all known plugins. */
  getPlugins(): PluginEntry[] {
    return [...this.plugins]
  }

  /** Get installed plugins only. */
  getInstalledPlugins(): PluginEntry[] {
    return this.plugins.filter((p) => p.installed)
  }

  /** Install a plugin from a git repository URL. */
  async installPlugin(nameOrUrl: string): Promise<boolean> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('No workspace folder to install plugin into')
      return false
    }

    const pluginsDir = path.join(workspaceRoot, '.cmdr', 'plugins')
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true })
    }

    // Check marketplace for name match
    const marketplaceEntry = this.plugins.find((p) => p.name === nameOrUrl && !p.installed && p.source)
    const repoUrl = marketplaceEntry?.source || nameOrUrl

    if (!repoUrl.includes('/') && !repoUrl.startsWith('http')) {
      vscode.window.showErrorMessage(`Invalid plugin source: ${nameOrUrl}`)
      return false
    }

    const pluginName = marketplaceEntry?.name || path.basename(repoUrl).replace(/\.git$/, '')
    const targetDir = path.join(pluginsDir, pluginName)

    if (fs.existsSync(targetDir)) {
      vscode.window.showWarningMessage(`Plugin '${pluginName}' is already installed`)
      return false
    }

    try {
      // Clone the repo
      const { execSync } = require('node:child_process')
      execSync(`git clone --depth 1 ${repoUrl} "${targetDir}"`, {
        cwd: workspaceRoot,
        timeout: 60000,
      })

      // Remove .git directory to save space
      const gitDir = path.join(targetDir, '.git')
      if (fs.existsSync(gitDir)) {
        fs.rmSync(gitDir, { recursive: true, force: true })
      }

      this.outputChannel.appendLine(`[plugins] Installed plugin: ${pluginName}`)
      vscode.window.showInformationMessage(`cmdr plugin '${pluginName}' installed successfully`)

      // Refresh
      this.scanInstalledPlugins()
      return true
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to install plugin: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** Uninstall a plugin by name. */
  async uninstallPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.find((p) => p.name === name && p.installed)
    if (!plugin || !plugin.path) {
      vscode.window.showWarningMessage(`Plugin '${name}' is not installed`)
      return false
    }

    const confirm = await vscode.window.showWarningMessage(
      `Uninstall plugin '${name}'?`,
      { modal: true },
      'Uninstall',
    )

    if (confirm !== 'Uninstall') return false

    try {
      fs.rmSync(plugin.path, { recursive: true, force: true })
      this.outputChannel.appendLine(`[plugins] Uninstalled plugin: ${name}`)
      vscode.window.showInformationMessage(`cmdr plugin '${name}' uninstalled`)

      this.scanInstalledPlugins()
      return true
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to uninstall: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** Get all slash commands from installed plugins. */
  getPluginCommands(): Array<{ plugin: string; name: string; description: string; content: string }> {
    const commands: Array<{ plugin: string; name: string; description: string; content: string }> = []

    for (const plugin of this.getInstalledPlugins()) {
      if (!plugin.path) continue
      const commandsDir = path.join(plugin.path, 'commands')
      if (!fs.existsSync(commandsDir)) continue

      const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'))
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(commandsDir, file), 'utf-8')
          const { frontmatter, body } = parseFrontmatter(content)
          commands.push({
            plugin: plugin.name,
            name: frontmatter.name || file.replace('.md', ''),
            description: frontmatter.description || '',
            content: body,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }

    return commands
  }

  /** Get all agent definitions from installed plugins. */
  getPluginAgents(): Array<{ plugin: string; name: string; model?: string; tools?: string[]; content: string }> {
    const agents: Array<{ plugin: string; name: string; model?: string; tools?: string[]; content: string }> = []

    for (const plugin of this.getInstalledPlugins()) {
      if (!plugin.path) continue
      const agentsDir = path.join(plugin.path, 'agents')
      if (!fs.existsSync(agentsDir)) continue

      const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
          const { frontmatter, body } = parseFrontmatter(content)
          agents.push({
            plugin: plugin.name,
            name: frontmatter.name || file.replace('.md', ''),
            model: frontmatter.model,
            tools: frontmatter.tools ? String(frontmatter.tools).split(',').map((t: string) => t.trim()) : undefined,
            content: body,
          })
        } catch {
          // Skip
        }
      }
    }

    return agents
  }

  /** Get hook configurations from installed plugins. */
  getPluginHooks(): Array<{ plugin: string; hooks: Record<string, unknown[]> }> {
    const allHooks: Array<{ plugin: string; hooks: Record<string, unknown[]> }> = []

    for (const plugin of this.getInstalledPlugins()) {
      if (!plugin.path) continue
      const hooksPath = path.join(plugin.path, 'hooks', 'hooks.json')
      if (!fs.existsSync(hooksPath)) continue

      try {
        const content = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'))
        if (content.hooks) {
          allHooks.push({ plugin: plugin.name, hooks: content.hooks })
        }
      } catch {
        // Skip
      }
    }

    return allHooks
  }

  /** Show plugin picker in VS Code. */
  async showPluginPicker(): Promise<void> {
    this.scanInstalledPlugins()

    const items: vscode.QuickPickItem[] = this.plugins.map((p) => ({
      label: `${p.installed ? '$(check) ' : '$(cloud-download) '}${p.name}`,
      description: `v${p.version}${p.author ? ` by ${p.author}` : ''}`,
      detail: p.description,
    }))

    items.push({
      label: '$(add) Install from URL...',
      description: 'Install a plugin from a Git repository URL',
    })

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'cmdr Plugins',
      matchOnDescription: true,
      matchOnDetail: true,
    })

    if (!selected) return

    if (selected.label.includes('Install from URL')) {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter Git repository URL',
        placeHolder: 'https://github.com/user/cmdr-plugin-name',
      })
      if (url) {
        await this.installPlugin(url)
      }
    } else {
      const name = selected.label.replace(/^\$\([^)]+\)\s*/, '')
      const plugin = this.plugins.find((p) => p.name === name)
      if (plugin?.installed) {
        const action = await vscode.window.showQuickPick(
          ['Uninstall', 'View Info'],
          { placeHolder: `Plugin: ${name}` },
        )
        if (action === 'Uninstall') {
          await this.uninstallPlugin(name)
        } else if (action === 'View Info') {
          const info = `**${plugin.name}** v${plugin.version}\n\n${plugin.description}\n\nPath: ${plugin.path}`
          const doc = await vscode.workspace.openTextDocument({ content: info, language: 'markdown' })
          await vscode.window.showTextDocument(doc)
        }
      } else if (plugin?.source) {
        await this.installPlugin(plugin.name)
      }
    }
  }

  dispose(): void {
    this.plugins = []
  }
}

/** Parse YAML-like frontmatter from markdown. */
function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, any> = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      let value: any = line.slice(colonIdx + 1).trim()
      // Simple type coercion
      if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (/^\d+$/.test(value)) value = parseInt(value, 10)
      frontmatter[key] = value
    }
  }

  return { frontmatter, body: match[2].trim() }
}
