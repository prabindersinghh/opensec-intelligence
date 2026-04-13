/**
 * cmdr VS Code Extension — CMDR.md Config Parser.
 *
 * Reads CMDR.md files from workspace root and subdirectories to provide
 * project-specific agent configuration via markdown + YAML frontmatter.
 *
 * Similar to Claude Code's CLAUDE.md, supports:
 *   - Project-level instructions (workspace root CMDR.md)
 *   - Directory-scoped config (subdirectory CMDR.md files)
 *   - YAML frontmatter: name, model, allowed-tools, description
 *   - Automatic context injection based on active file directory
 *   - Nested CMDR.md discovery with inheritance
 *
 * File format:
 *   ---
 *   name: backend-agent
 *   model: qwen3-coder
 *   allowed-tools: bash,edit,read
 *   description: Backend API development agent
 *   ---
 *   # Project Instructions
 *   ... markdown body as system prompt context ...
 */

import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

export interface CmdrConfig {
  /** File path this config was loaded from. */
  filePath: string
  /** Directory this config applies to. */
  directory: string
  /** Parsed YAML frontmatter. */
  meta: CmdrConfigMeta
  /** Markdown body (system prompt context). */
  body: string
}

export interface CmdrConfigMeta {
  name?: string
  model?: string
  'allowed-tools'?: string
  description?: string
  [key: string]: string | undefined
}

export class CmdrConfigLoader {
  private configs: CmdrConfig[] = []
  private outputChannel: vscode.OutputChannel
  private watcher: vscode.FileSystemWatcher | null = null

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.discoverConfigs()
    this.setupWatcher()
  }

  /** Scan workspace for all CMDR.md files. */
  discoverConfigs(): void {
    this.configs = []
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return

    this.scanDirectory(workspaceRoot, 0)
    this.outputChannel.appendLine(`[cmdr-config] Found ${this.configs.length} CMDR.md files`)
  }

  private scanDirectory(dir: string, depth: number): void {
    if (depth > 5) return // Max recursion depth

    // Check for CMDR.md (case-insensitive variants)
    const variants = ['CMDR.md', 'cmdr.md', '.cmdr.md']
    for (const variant of variants) {
      const filePath = path.join(dir, variant)
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const parsed = this.parseConfig(content, filePath, dir)
          this.configs.push(parsed)
          this.outputChannel.appendLine(`[cmdr-config] Loaded: ${filePath}`)
        } catch (err) {
          this.outputChannel.appendLine(`[cmdr-config] Failed to parse ${filePath}: ${err}`)
        }
        break // Only load one variant per directory
      }
    }

    // Scan subdirectories (skip common ignores)
    const skipDirs = new Set([
      'node_modules', '.git', '.vscode', 'dist', 'build', 'out',
      '.next', '.nuxt', '__pycache__', '.pytest_cache', 'coverage',
      'vendor', '.cmdr', '.cmdr-plugin',
    ])

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
          this.scanDirectory(path.join(dir, entry.name), depth + 1)
        }
      }
    } catch {
      // Permission denied or other read error
    }
  }

  private parseConfig(content: string, filePath: string, directory: string): CmdrConfig {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    
    if (!match) {
      return {
        filePath,
        directory,
        meta: {},
        body: content.trim(),
      }
    }

    const meta: CmdrConfigMeta = {}
    const lines = match[1].split('\n')
    for (const line of lines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        meta[key] = value
      }
    }

    return {
      filePath,
      directory,
      meta,
      body: match[2].trim(),
    }
  }

  private setupWatcher(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/CMDR.md', false, false, false)
    const reload = () => this.discoverConfigs()
    this.watcher.onDidCreate(reload)
    this.watcher.onDidChange(reload)
    this.watcher.onDidDelete(reload)

    // Also watch lowercase variant
    const lowerWatcher = vscode.workspace.createFileSystemWatcher('**/cmdr.md', false, false, false)
    lowerWatcher.onDidCreate(reload)
    lowerWatcher.onDidChange(reload)
    lowerWatcher.onDidDelete(reload)
  }

  /** Get all loaded configs. */
  getAllConfigs(): CmdrConfig[] {
    return [...this.configs]
  }

  /** Get the root config (workspace root CMDR.md). */
  getRootConfig(): CmdrConfig | undefined {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!workspaceRoot) return undefined
    return this.configs.find((c) => c.directory === workspaceRoot)
  }

  /**
   * Get all configs applicable to a file path.
   *
   * Returns configs in order from most specific (deepest) to root.
   * A config applies if the file is in the config's directory or a subdirectory.
   */
  getConfigsForFile(filePath: string): CmdrConfig[] {
    const applicable = this.configs.filter((config) => {
      const rel = path.relative(config.directory, filePath)
      return !rel.startsWith('..')
    })

    // Sort by depth (deepest first)
    return applicable.sort((a, b) => b.directory.length - a.directory.length)
  }

  /**
   * Build a context string for the active file.
   *
   * Combines all applicable CMDR.md bodies, with root config first
   * and most specific last.
   */
  getContextForFile(filePath: string): string {
    const configs = this.getConfigsForFile(filePath).reverse() // Root first
    if (configs.length === 0) return ''

    const parts: string[] = []
    for (const config of configs) {
      const label = config.meta.name || path.basename(config.directory)
      parts.push(`<!-- CMDR.md from ${label} (${path.relative(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        config.directory,
      ) || '.'}) -->`)
      parts.push(config.body)
    }

    return parts.join('\n\n')
  }

  /**
   * Get model override for a file path.
   * Returns the most specific model from CMDR.md frontmatter.
   */
  getModelForFile(filePath: string): string | undefined {
    const configs = this.getConfigsForFile(filePath)
    for (const config of configs) {
      if (config.meta.model) return config.meta.model
    }
    return undefined
  }

  /**
   * Get allowed tools for a file path.
   * Returns the most specific tool list from CMDR.md frontmatter.
   */
  getAllowedToolsForFile(filePath: string): string[] | undefined {
    const configs = this.getConfigsForFile(filePath)
    for (const config of configs) {
      if (config.meta['allowed-tools']) {
        return config.meta['allowed-tools'].split(',').map((t) => t.trim())
      }
    }
    return undefined
  }

  dispose(): void {
    this.watcher?.dispose()
    this.configs = []
  }
}
