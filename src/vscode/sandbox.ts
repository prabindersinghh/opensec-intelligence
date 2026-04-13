/**
 * cmdr VS Code Extension — Sandbox Manager.
 *
 * Provides command isolation and network restriction for bash/terminal execution.
 * Modeled after Claude Code's sandbox system:
 *   - Command validation against allow/deny lists
 *   - Network domain restriction
 *   - Auto-approve if sandboxed
 *
 * Config via .cmdr/settings.json or cmdr.sandbox VS Code setting.
 */

import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

export interface SandboxConfig {
  enabled: boolean
  autoAllowBashIfSandboxed: boolean
  excludedCommands: string[] // Commands that are never allowed
  allowedCommands: string[] // Explicit allowlist (if empty, all non-excluded are allowed)
  dangerousPatterns: string[] // Regex patterns that trigger blocking
  network: {
    allowedDomains: string[]
    blockAllNetwork: boolean
    allowLocalBinding: boolean
  }
}

export interface ValidationResult {
  allowed: boolean
  reason?: string
  sandboxed: boolean
}

const DEFAULT_DANGEROUS_PATTERNS = [
  'rm\\s+-rf\\s+/',       // rm -rf /
  'rm\\s+-rf\\s+~',       // rm -rf ~
  'mkfs\\.',              // Format disk
  'dd\\s+if=',            // Raw disk write
  ':(){ :|:& };:',       // Fork bomb
  'chmod\\s+-R\\s+777',   // Overly permissive
  'curl.*\\|\\s*sh',      // Pipe to shell
  'curl.*\\|\\s*bash',    // Pipe to shell
  'wget.*\\|\\s*sh',      // Pipe to shell
  'eval\\s*\\$\\(',       // Eval command substitution
  'sudo\\s+rm',           // Sudo remove
  '> /dev/sd',            // Direct disk write
  'shutdown',             // System shutdown
  'reboot',               // System reboot
  'init\\s+0',            // System halt
]

const DEFAULT_EXCLUDED_COMMANDS = [
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init',
  'mkfs',
]

export class SandboxManager {
  private config: SandboxConfig
  private outputChannel: vscode.OutputChannel

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.config = this.loadConfig()
  }

  /** Reload sandbox configuration. */
  reload(): void {
    this.config = this.loadConfig()
  }

  /** Refresh config (alias for reload). */
  refresh(): void {
    this.reload()
  }

  /** Check if sandbox is enabled. */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /** Validate whether a command is allowed to execute. */
  validateCommand(command: string): ValidationResult {
    if (!this.config.enabled) {
      return { allowed: true, sandboxed: false }
    }

    const trimmed = command.trim()

    // Check excluded commands
    const baseCmd = trimmed.split(/\s+/)[0]
    if (this.config.excludedCommands.some((exc) => baseCmd === exc || trimmed.startsWith(exc + ' '))) {
      return {
        allowed: false,
        reason: `Command '${baseCmd}' is in the excluded commands list`,
        sandboxed: true,
      }
    }

    // Check dangerous patterns
    for (const pattern of this.config.dangerousPatterns) {
      try {
        const regex = new RegExp(pattern, 'i')
        if (regex.test(trimmed)) {
          return {
            allowed: false,
            reason: `Command matches dangerous pattern: ${pattern}`,
            sandboxed: true,
          }
        }
      } catch {
        // Invalid regex — skip
      }
    }

    // Check allowlist (if non-empty, only allowed commands pass)
    if (this.config.allowedCommands.length > 0) {
      const isAllowed = this.config.allowedCommands.some(
        (cmd) => baseCmd === cmd || trimmed.startsWith(cmd + ' '),
      )
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Command '${baseCmd}' is not in the allowed commands list`,
          sandboxed: true,
        }
      }
    }

    return { allowed: true, sandboxed: true }
  }

  /** Validate whether a network request to a domain is allowed. */
  validateNetwork(domain: string): ValidationResult {
    if (!this.config.enabled) {
      return { allowed: true, sandboxed: false }
    }

    if (this.config.network.blockAllNetwork) {
      return {
        allowed: false,
        reason: 'All network access is blocked in sandbox mode',
        sandboxed: true,
      }
    }

    if (this.config.network.allowedDomains.length > 0) {
      const isAllowed = this.config.network.allowedDomains.some((allowed) => {
        if (allowed.startsWith('*.')) {
          return domain.endsWith(allowed.slice(1)) || domain === allowed.slice(2)
        }
        return domain === allowed
      })
      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Domain '${domain}' is not in the allowed domains list`,
          sandboxed: true,
        }
      }
    }

    return { allowed: true, sandboxed: true }
  }

  /** Check if sandbox is enabled. */
  get enabled(): boolean {
    return this.config.enabled
  }

  /** Check if auto-approve for sandboxed commands is enabled. */
  get autoAllowIfSandboxed(): boolean {
    return this.config.autoAllowBashIfSandboxed
  }

  /** Get current sandbox config (for display in UI). */
  getConfig(): SandboxConfig {
    return { ...this.config }
  }

  private loadConfig(): SandboxConfig {
    const defaults: SandboxConfig = {
      enabled: false,
      autoAllowBashIfSandboxed: false,
      excludedCommands: [...DEFAULT_EXCLUDED_COMMANDS],
      allowedCommands: [],
      dangerousPatterns: [...DEFAULT_DANGEROUS_PATTERNS],
      network: {
        allowedDomains: [],
        blockAllNetwork: false,
        allowLocalBinding: true,
      },
    }

    // Try .cmdr/settings.json in workspace
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (workspaceRoot) {
      const settingsPath = path.join(workspaceRoot, '.cmdr', 'settings.json')
      if (fs.existsSync(settingsPath)) {
        try {
          const raw = fs.readFileSync(settingsPath, 'utf-8')
          const parsed = JSON.parse(raw)
          if (parsed.sandbox) {
            this.outputChannel.appendLine(`[sandbox] Loaded config from ${settingsPath}`)
            return this.mergeConfig(defaults, parsed.sandbox)
          }
        } catch (err) {
          this.outputChannel.appendLine(`[sandbox] Failed to parse ${settingsPath}: ${err}`)
        }
      }
    }

    // Try VS Code settings
    const vscodeConfig = vscode.workspace.getConfiguration('cmdr').get<Partial<SandboxConfig>>('sandbox')
    if (vscodeConfig) {
      this.outputChannel.appendLine('[sandbox] Loaded config from VS Code settings')
      return this.mergeConfig(defaults, vscodeConfig)
    }

    return defaults
  }

  private mergeConfig(defaults: SandboxConfig, override: Partial<SandboxConfig>): SandboxConfig {
    return {
      enabled: override.enabled ?? defaults.enabled,
      autoAllowBashIfSandboxed: override.autoAllowBashIfSandboxed ?? defaults.autoAllowBashIfSandboxed,
      excludedCommands: override.excludedCommands || defaults.excludedCommands,
      allowedCommands: override.allowedCommands || defaults.allowedCommands,
      dangerousPatterns: override.dangerousPatterns || defaults.dangerousPatterns,
      network: {
        allowedDomains: override.network?.allowedDomains || defaults.network.allowedDomains,
        blockAllNetwork: override.network?.blockAllNetwork ?? defaults.network.blockAllNetwork,
        allowLocalBinding: override.network?.allowLocalBinding ?? defaults.network.allowLocalBinding,
      },
    }
  }

  dispose(): void {
    // Nothing to dispose
  }
}
