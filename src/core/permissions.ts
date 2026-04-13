/**
 * Permission management — HITL (Human-in-the-Loop) tool approval.
 *
 * Classifies tools by risk level and gates execution on user approval
 * depending on the current permission mode.
 *
 * Supports fine-grained rules:
 *   - Glob patterns for file paths (e.g. "src/**" allows all file writes under src/)
 *   - Prefix matching for bash commands (e.g. "npm test" allows "npm test --watch")
 */

import type { PermissionMode, ToolRiskLevel, ApprovalDecision, ApprovalCallback } from './types.js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join, resolve, relative, isAbsolute } from 'path'
import { homedir } from 'os'

const SETTINGS_PATH = join(homedir(), '.opensec', 'settings.json')

interface PathRule {
  /** Glob pattern relative to project root. */
  pattern: string
  /** Whether to allow or deny matching paths. */
  allow: boolean
}

interface BashRule {
  /** Command prefix to match (e.g. "npm test", "git"). */
  prefix: string
  allow: boolean
}

interface PersistedSettings {
  allowedTools?: string[]
  permissionMode?: PermissionMode
  pathRules?: PathRule[]
  bashRules?: BashRule[]
  /** Pattern-based permission rules: "Tool(specifier)" syntax. */
  permissionRules?: PermissionRule[]
}

// ---------------------------------------------------------------------------
// Pattern-based permission rules — Claude Code-compatible syntax
// ---------------------------------------------------------------------------

/**
 * Pattern rule: "Tool(specifier)" format.
 * Examples:
 *   allow: ["bash(npm run *)", "file_read(src/**)"]
 *   deny:  ["bash(curl *)", "file_read(.env)"]
 *   ask:   ["bash(git push *)"]
 *
 * Priority: deny > ask > allow (most restrictive wins).
 */
export interface PermissionRule {
  /** 'allow' auto-approves, 'deny' auto-blocks, 'ask' always prompts. */
  action: 'allow' | 'deny' | 'ask'
  /** Tool name to match. */
  tool: string
  /** Optional glob pattern for the tool's primary argument. */
  pattern?: string
}

/**
 * Parse a permission rule string like "bash(npm run *)" into structured form.
 */
export function parsePermissionRule(rule: string, action: 'allow' | 'deny' | 'ask'): PermissionRule {
  const match = rule.match(/^(\w+)(?:\((.+)\))?$/)
  if (!match) {
    return { action, tool: rule.trim() }
  }
  return {
    action,
    tool: match[1],
    pattern: match[2],
  }
}

/**
 * Check if a permission rule's pattern matches a given value.
 */
function matchesPattern(pattern: string, value: string): boolean {
  return globMatch(pattern, value)
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

const READ_ONLY_TOOLS = new Set([
  'file_read',
  'glob',
  'grep',
  'git_diff',
  'git_log',
  'think',
  'memory_read',
])

const DANGEROUS_TOOLS = new Set([
  'bash',
])

/** Tools that operate on file paths — their inputs contain paths to check. */
const FILE_TOOLS = new Set([
  'file_write',
  'file_edit',
  'file_read',
])

export function classifyTool(toolName: string): ToolRiskLevel {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read-only'
  if (DANGEROUS_TOOLS.has(toolName)) return 'dangerous'
  return 'write'
}

// ---------------------------------------------------------------------------
// Glob matching (minimal implementation — no external deps)
// ---------------------------------------------------------------------------

/**
 * Simple glob match supporting *, **, and ?.
 * Not as full-featured as minimatch but handles common patterns.
 */
function globMatch(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars (except * and ?)
    .replace(/\*\*/g, '{{GLOBSTAR}}')        // Temp placeholder for **
    .replace(/\*/g, '[^/]*')                 // * matches within a segment
    .replace(/\?/g, '[^/]')                  // ? matches single char
    .replace(/\{\{GLOBSTAR\}\}/g, '.*')      // ** matches across segments

  return new RegExp(`^${regexStr}$`).test(path)
}

// ---------------------------------------------------------------------------
// Permission manager
// ---------------------------------------------------------------------------

export class PermissionManager {
  private mode: PermissionMode
  /** Tools the user has permanently allowed for this session. */
  private sessionAllowed = new Set<string>()
  /** Tools persisted in ~/.cmdr/settings.json. */
  private persistedAllowed = new Set<string>()
  /** Path-based rules for file tools. */
  private pathRules: PathRule[] = []
  /** Command-prefix rules for bash tool. */
  private bashRules: BashRule[] = []
  /** Pattern-based permission rules (Tool(pattern) syntax). */
  private permissionRules: PermissionRule[] = []
  /** Project root for resolving relative paths in rules. */
  private projectRoot: string = process.cwd()

  constructor(mode: PermissionMode = 'normal') {
    this.mode = mode
  }

  setProjectRoot(root: string): void {
    this.projectRoot = root
  }

  /** Load persisted settings from ~/.cmdr/settings.json. */
  async loadSettings(): Promise<void> {
    try {
      const data = await readFile(SETTINGS_PATH, 'utf-8')
      const settings = JSON.parse(data) as PersistedSettings
      if (settings.allowedTools) {
        for (const tool of settings.allowedTools) {
          this.persistedAllowed.add(tool)
        }
      }
      if (settings.permissionMode) {
        this.mode = settings.permissionMode
      }
      if (settings.pathRules) {
        this.pathRules = settings.pathRules
      }
      if (settings.bashRules) {
        this.bashRules = settings.bashRules
      }
      if (settings.permissionRules) {
        this.permissionRules = settings.permissionRules
      }
    } catch {
      // no settings file yet — that's fine
    }
  }

  /** Save current persisted allow-list to disk. */
  private async saveSettings(): Promise<void> {
    try {
      await mkdir(join(homedir(), '.opensec'), { recursive: true })
      const settings: PersistedSettings = {
        allowedTools: [...this.persistedAllowed],
        permissionMode: this.mode,
        pathRules: this.pathRules.length > 0 ? this.pathRules : undefined,
        bashRules: this.bashRules.length > 0 ? this.bashRules : undefined,
        permissionRules: this.permissionRules.length > 0 ? this.permissionRules : undefined,
      }
      await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
    } catch {
      // best effort
    }
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    this.sessionAllowed.clear()
  }

  /** Add a path rule (e.g. allow writes to "src/**"). */
  addPathRule(pattern: string, allow: boolean = true): void {
    this.pathRules.push({ pattern, allow })
  }

  /** Add a bash command rule (e.g. allow "npm test"). */
  addBashRule(prefix: string, allow: boolean = true): void {
    this.bashRules.push({ prefix, allow })
  }

  /** Add a pattern permission rule (e.g. "bash(npm run *)" with action "allow"). */
  addPermissionRule(ruleString: string, action: 'allow' | 'deny' | 'ask'): void {
    this.permissionRules.push(parsePermissionRule(ruleString, action))
  }

  /** Load permission rules from config format: { allow: [...], deny: [...], ask: [...] } */
  loadPermissionRules(config: { allow?: string[]; deny?: string[]; ask?: string[] }): void {
    for (const rule of config.allow ?? []) {
      this.permissionRules.push(parsePermissionRule(rule, 'allow'))
    }
    for (const rule of config.deny ?? []) {
      this.permissionRules.push(parsePermissionRule(rule, 'deny'))
    }
    for (const rule of config.ask ?? []) {
      this.permissionRules.push(parsePermissionRule(rule, 'ask'))
    }
  }

  /**
   * Check if a specific file path is allowed by path rules.
   * Returns true (allowed), false (denied), or undefined (no matching rule).
   */
  private checkPathRules(filePath: string): boolean | undefined {
    // Normalize to relative path from project root
    const absPath = isAbsolute(filePath)
      ? filePath
      : resolve(this.projectRoot, filePath)
    const relPath = relative(this.projectRoot, absPath)

    // Check rules in reverse order (last rule wins)
    for (let i = this.pathRules.length - 1; i >= 0; i--) {
      if (globMatch(this.pathRules[i].pattern, relPath)) {
        return this.pathRules[i].allow
      }
    }
    return undefined
  }

  /**
   * Check if a bash command matches any bash rules.
   * Returns true (allowed), false (denied), or undefined (no matching rule).
   */
  private checkBashRules(command: string): boolean | undefined {
    const trimmedCmd = command.trim()
    // Check rules in reverse order (last rule wins)
    for (let i = this.bashRules.length - 1; i >= 0; i--) {
      if (trimmedCmd === this.bashRules[i].prefix || trimmedCmd.startsWith(this.bashRules[i].prefix + ' ')) {
        return this.bashRules[i].allow
      }
    }
    return undefined
  }

  /**
   * Check fine-grained rules for a specific tool invocation.
   * Returns true if auto-approved by rules, false otherwise.
   */
  private checkFineGrainedRules(toolName: string, input: Record<string, unknown>): boolean {
    // Check pattern-based permission rules first (highest priority system)
    const patternResult = this.checkPermissionRules(toolName, input)
    if (patternResult === 'deny') return false
    if (patternResult === 'allow') return true
    // 'ask' falls through to normal flow

    // File tool path checks
    if (FILE_TOOLS.has(toolName)) {
      const path = (input.path ?? input.filePath ?? input.file) as string | undefined
      if (path) {
        const result = this.checkPathRules(path)
        if (result !== undefined) return result
      }
    }

    // Bash command prefix checks
    if (toolName === 'bash') {
      const command = (input.command ?? input.cmd) as string | undefined
      if (command) {
        const result = this.checkBashRules(command)
        if (result !== undefined) return result
      }
    }

    return false
  }

  /**
   * Check pattern-based permission rules.
   * Priority: deny > ask > allow (most restrictive wins).
   * Returns 'allow', 'deny', 'ask', or undefined if no matching rule.
   */
  private checkPermissionRules(
    toolName: string,
    input: Record<string, unknown>,
  ): 'allow' | 'deny' | 'ask' | undefined {
    // Collect matching rules
    const matches: PermissionRule[] = []

    // Get the primary argument for pattern matching
    const primaryArg = this.getPrimaryArg(toolName, input)

    for (const rule of this.permissionRules) {
      if (rule.tool !== toolName) continue

      // If rule has no pattern, it matches all invocations of this tool
      if (!rule.pattern) {
        matches.push(rule)
        continue
      }

      // If rule has a pattern, check against primary arg
      if (primaryArg && matchesPattern(rule.pattern, primaryArg)) {
        matches.push(rule)
      }
    }

    if (matches.length === 0) return undefined

    // Priority: deny > ask > allow
    if (matches.some(r => r.action === 'deny')) return 'deny'
    if (matches.some(r => r.action === 'ask')) return 'ask'
    if (matches.some(r => r.action === 'allow')) return 'allow'

    return undefined
  }

  /**
   * Extract the primary argument from tool input for pattern matching.
   * Each tool type uses a different "primary" argument.
   */
  private getPrimaryArg(toolName: string, input: Record<string, unknown>): string | undefined {
    switch (toolName) {
      case 'bash':
        return (input.command ?? input.cmd) as string | undefined
      case 'file_read':
      case 'file_write':
      case 'file_edit':
        return (input.path ?? input.filePath ?? input.file) as string | undefined
      case 'web_fetch':
      case 'web_search':
        return (input.url ?? input.query) as string | undefined
      default:
        // Try common argument names
        return (input.path ?? input.command ?? input.url ?? input.query) as string | undefined
    }
  }

  /**
   * Decide whether a tool call should proceed.
   */
  needsApproval(toolName: string, input?: Record<string, unknown>): boolean {
    if (this.mode === 'yolo') return false
    if (this.sessionAllowed.has(toolName)) return false
    if (this.persistedAllowed.has(toolName)) return false

    const risk = classifyTool(toolName)

    if (this.mode === 'strict') {
      // In strict, fine-grained rules can still auto-approve
      if (input && this.checkFineGrainedRules(toolName, input)) return false
      return true
    }

    // Normal mode — read-only never needs approval
    if (risk === 'read-only') return false

    // Check fine-grained rules before prompting
    if (input && this.checkFineGrainedRules(toolName, input)) return false

    return true
  }

  /**
   * Gate a tool call. If approval is needed, calls the approvalCallback.
   * Returns the decision (allow/deny). Handles 'allow-always' by recording it.
   * Pattern deny rules auto-block without prompting.
   */
  async gate(
    toolName: string,
    input: Record<string, unknown>,
    approvalCallback: ApprovalCallback,
  ): Promise<'allow' | 'deny'> {
    // Check for auto-deny from pattern rules (bypass everything)
    const patternResult = this.checkPermissionRules(toolName, input)
    if (patternResult === 'deny') return 'deny'

    if (!this.needsApproval(toolName, input)) {
      return 'allow'
    }

    const risk = classifyTool(toolName)
    const decision = await approvalCallback(toolName, input, risk)

    if (decision === 'allow-always') {
      this.sessionAllowed.add(toolName)
      this.persistedAllowed.add(toolName)
      await this.saveSettings()
      return 'allow'
    }

    return decision
  }

  /** Reset session-allowed set (e.g. on /clear). */
  resetSession(): void {
    this.sessionAllowed.clear()
  }
}
