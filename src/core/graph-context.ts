/**
 * GraphContextProvider — token-budgeted, heuristic-gated context injection
 * powered by code-review-graph's MCP tools.
 *
 * This is NOT injected into the system prompt. It prepends a structured
 * context message to the conversation when heuristics indicate the graph
 * can provide useful grounding for the current turn.
 *
 * Design rules:
 *  - Context injection = initial grounding (bounded, passive)
 *  - Tool calls = deep analysis mid-reasoning (on-demand)
 *  - Never duplicates: if context was injected, tools drill deeper
 */

import type { McpClient } from '../plugins/mcp-client.js'
import type { LLMMessage } from '../core/types.js'
import type { GraphConfig } from '../config/mcp-config.js'
import { DEFAULT_GRAPH_CONFIG } from '../config/mcp-config.js'
import { execSync } from 'node:child_process'

// ---------------------------------------------------------------------------
// Graph usage keywords — triggers graph context when found in user message
// ---------------------------------------------------------------------------

const CHANGE_KEYWORDS = /\b(review|refactor|impact|blast.?radius|affected|depends|dependency|dependencies|callers?|callees?|imports?|test.?coverage|dead.?code|what.?calls|who.?uses|trace)\b/gi

const FILE_PATH_PATTERN = /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|rb|kt|swift|php|vue|svelte|scala|cs|dart|lua|pl|r|sol))\b/gi

// Symbol-like identifiers: camelCase, PascalCase, or snake_case (min 4 chars, must have case change or underscore)
const SYMBOL_PATTERN = /\b([a-z][a-zA-Z0-9]{3,}(?:[A-Z][a-zA-Z0-9]*)+|[A-Z][a-zA-Z0-9]{3,}(?:[A-Z][a-z][a-zA-Z0-9]*)+|[a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g

// ---------------------------------------------------------------------------
// Structured log entry for eval/debugging
// ---------------------------------------------------------------------------

export interface GraphTurnLog {
  used: boolean
  reason: string
  files: number
  estimatedTokens: number
  freshness: 'fresh' | 'stale' | 'skipped'
  latencyMs: number
}

// ---------------------------------------------------------------------------
// GraphContextProvider
// ---------------------------------------------------------------------------

export class GraphContextProvider {
  private mcpClient: McpClient | null = null
  private projectRoot: string
  private config: GraphConfig
  private graphAvailable: boolean = false
  private buildReady: boolean = false
  private lastKnownSha: string | null = null
  private turnLogs: GraphTurnLog[] = []
  private loggedUnavailable: boolean = false

  constructor(projectRoot: string, config?: Partial<GraphConfig>) {
    this.projectRoot = projectRoot
    this.config = { ...DEFAULT_GRAPH_CONFIG, ...config }
  }

  /**
   * Initialize with an MCP client that has a connected 'crg' server.
   */
  setMcpClient(client: McpClient): void {
    this.mcpClient = client
    this.graphAvailable = true
  }

  setGraphAvailable(available: boolean): void {
    this.graphAvailable = available
  }

  /** Mark the graph as ready (build complete). */
  setBuildReady(ready: boolean): void {
    this.buildReady = ready
  }

  isAvailable(): boolean {
    return this.graphAvailable && this.buildReady
  }

  // ─── Heuristic trigger ──────────────────────────────────────

  /**
   * Determine if graph context should be injected for this turn.
   * Returns false for conversational intents or messages without
   * concrete code references.
   */
  shouldUseGraph(intent: string, userMessage: string): boolean {
    if (!this.graphAvailable || !this.buildReady) return false
    if (intent === 'conversational') return false

    // Weighted scoring — avoids naive boolean OR
    // fileRef=2, symbol=2, keyword=1. Threshold: score >= 2
    let score = 0

    // Reset regex lastIndex (global flag)
    FILE_PATH_PATTERN.lastIndex = 0
    CHANGE_KEYWORDS.lastIndex = 0
    SYMBOL_PATTERN.lastIndex = 0

    const fileMatches = userMessage.match(FILE_PATH_PATTERN)
    if (fileMatches) score += fileMatches.length * 2

    const symbolMatches = userMessage.match(SYMBOL_PATTERN)
    if (symbolMatches) score += Math.min(symbolMatches.length, 3) * 2

    const keywordMatches = userMessage.match(CHANGE_KEYWORDS)
    if (keywordMatches) score += keywordMatches.length

    return score >= 2
  }

  // ─── Freshness check ───────────────────────────────────────

  /**
   * Check if the graph is stale (files changed outside cmdr).
   * Returns true if an incremental update was triggered.
   */
  async checkFreshness(): Promise<'fresh' | 'stale'> {
    try {
      const currentSha = execSync('git rev-parse HEAD', {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).toString().trim()

      if (this.lastKnownSha && this.lastKnownSha !== currentSha) {
        // Graph is stale — trigger incremental update
        await this.callMcp('build_or_update_graph_tool', {
          full_rebuild: false,
          repo_root: this.projectRoot,
        })
        this.lastKnownSha = currentSha
        return 'stale'
      }

      this.lastKnownSha = currentSha
      return 'fresh'
    } catch {
      return 'fresh' // Can't check — assume fresh
    }
  }

  // ─── Context generation ─────────────────────────────────────

  /**
   * Generate a graph context message for the current turn.
   * Returns null if graph is unavailable, nothing relevant found,
   * or an error occurs (graceful internal fallback).
   */
  async getContext(
    intent: string,
    userMessage: string,
  ): Promise<LLMMessage | null> {
    const start = Date.now()

    if (!this.shouldUseGraph(intent, userMessage)) {
      this.logTurn({ used: false, reason: 'heuristic_skip', files: 0, estimatedTokens: 0, freshness: 'skipped', latencyMs: 0 })
      return null
    }

    try {
      // Freshness check
      const freshness = await this.checkFreshness()

      // Determine query strategy based on intent
      let contextText: string | null = null

      if (intent === 'actionable') {
        contextText = await this.getImpactContext(userMessage)
      } else if (intent === 'exploratory') {
        contextText = await this.getExploratoryContext(userMessage)
      }

      if (!contextText) {
        this.logTurn({ used: false, reason: 'no_results', files: 0, estimatedTokens: 0, freshness, latencyMs: Date.now() - start })
        return null
      }

      // Token budget enforcement — rough estimate: 4 chars per token
      const estimatedTokens = Math.ceil(contextText.length / 4)
      if (estimatedTokens > this.config.maxTokens) {
        // Truncate to budget
        const maxChars = this.config.maxTokens * 4
        contextText = contextText.slice(0, maxChars) + '\n\n[Graph context truncated to token budget]'
      }

      const fileCount = (contextText.match(/📄|file_path/g) || []).length || 1

      this.logTurn({
        used: true,
        reason: intent,
        files: fileCount,
        estimatedTokens: Math.ceil(contextText.length / 4),
        freshness,
        latencyMs: Date.now() - start,
      })

      return {
        role: 'user',
        content: [{ type: 'text', text: `[Graph Context]\n${contextText}` }],
        isMeta: true,
      }
    } catch (err) {
      // Internal fallback — never crash the turn
      const reason = err instanceof Error ? err.message : String(err)
      if (!this.loggedUnavailable) {
        console.error(`[graph] query failed: ${reason}, falling back`)
        this.loggedUnavailable = true
      }
      this.logTurn({ used: false, reason: `error: ${reason}`, files: 0, estimatedTokens: 0, freshness: 'skipped', latencyMs: Date.now() - start })
      return null
    }
  }

  // ─── Impact context (actionable intent) ─────────────────────

  private async getImpactContext(userMessage: string): Promise<string | null> {
    // Extract file paths from message
    const fileRefs = this.extractFileRefs(userMessage)

    // Get blast radius — either from mentioned files or auto-detected changed files
    const params: Record<string, unknown> = {
      max_depth: this.config.maxDepth,
      repo_root: this.projectRoot,
      base: this.config.base,
    }
    if (fileRefs.length > 0) {
      params.changed_files = fileRefs
    }

    const result = await this.callMcp('get_impact_radius_tool', params)
    if (!result) return null

    return this.formatImpactResult(result)
  }

  // ─── Exploratory context ────────────────────────────────────

  private async getExploratoryContext(userMessage: string): Promise<string | null> {
    // Try to extract a query target from the message
    const fileRefs = this.extractFileRefs(userMessage)
    const callMatch = userMessage.match(/(?:what\s+calls|who\s+uses|callers?\s+of|trace)\s+[`"]?(\w+)[`"]?/i)

    if (callMatch) {
      // Caller query
      const result = await this.callMcp('query_graph_tool', {
        pattern: 'callers_of',
        target: callMatch[1],
        repo_root: this.projectRoot,
      })
      if (result) return this.formatQueryResult(result, 'callers_of', callMatch[1])
    }

    if (fileRefs.length > 0) {
      // File summary
      const result = await this.callMcp('query_graph_tool', {
        pattern: 'file_summary',
        target: fileRefs[0],
        repo_root: this.projectRoot,
      })
      if (result) return this.formatQueryResult(result, 'file_summary', fileRefs[0])
    }

    // Fall back to impact radius with auto-detection
    const result = await this.callMcp('get_impact_radius_tool', {
      max_depth: this.config.maxDepth,
      repo_root: this.projectRoot,
      base: this.config.base,
    })
    if (result) return this.formatImpactResult(result)

    return null
  }

  // ─── MCP call wrapper ──────────────────────────────────────

  private async callMcp(toolName: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (!this.mcpClient) return null

    const timeoutMs = 5000
    const result = await Promise.race([
      this.mcpClient.callTool('crg', toolName, input),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])

    if (!result || ('isError' in result && result.isError)) return null

    try {
      const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data
      return data as Record<string, unknown>
    } catch {
      return null
    }
  }

  // ─── Formatting helpers ─────────────────────────────────────

  private formatImpactResult(data: Record<string, unknown>): string {
    const lines: string[] = ['## Blast Radius Analysis']

    const impactedFiles = (data.impacted_files as string[]) || []
    const changedNodes = (data.changed_nodes as Array<Record<string, unknown>>) || []
    const impactedNodes = (data.impacted_nodes as Array<Record<string, unknown>>) || []

    if (impactedFiles.length === 0 && changedNodes.length === 0) {
      return '' // Nothing to report
    }

    // Changed nodes summary
    if (changedNodes.length > 0) {
      lines.push(`\n### Changed (${changedNodes.length} nodes)`)
      for (const node of changedNodes.slice(0, this.config.maxNodes)) {
        const name = node.name || node.qualified_name || 'unknown'
        const kind = node.kind || ''
        const file = node.file_path || ''
        lines.push(`- ${kind} \`${name}\` in ${file}`)
      }
    }

    // Impacted files
    if (impactedFiles.length > 0) {
      lines.push(`\n### Impacted Files (${impactedFiles.length})`)
      for (const file of impactedFiles.slice(0, this.config.maxFiles)) {
        lines.push(`- 📄 ${file}`)
      }
      if (impactedFiles.length > this.config.maxFiles) {
        lines.push(`- ... and ${impactedFiles.length - this.config.maxFiles} more`)
      }
    }

    // Impacted nodes (brief)
    if (impactedNodes.length > 0) {
      lines.push(`\n### Impacted Nodes (${impactedNodes.length})`)
      for (const node of impactedNodes.slice(0, this.config.maxNodes)) {
        const name = node.name || node.qualified_name || 'unknown'
        const kind = node.kind || ''
        lines.push(`- ${kind} \`${name}\``)
      }
      if (impactedNodes.length > this.config.maxNodes) {
        lines.push(`- ... and ${impactedNodes.length - this.config.maxNodes} more`)
      }
    }

    if (data.truncated) {
      lines.push(`\n> ⚠️ Results truncated. Use graph_impact tool for full analysis.`)
    }

    return lines.join('\n')
  }

  private formatQueryResult(data: Record<string, unknown>, pattern: string, target: string): string {
    const lines: string[] = [`## Graph Query: ${pattern}(${target})`]

    const nodes = (data.nodes as Array<Record<string, unknown>>) || []
    const results = (data.results as Array<Record<string, unknown>>) || nodes

    if (results.length === 0) {
      return '' // Nothing to report
    }

    for (const node of results.slice(0, this.config.maxNodes)) {
      const name = node.name || node.qualified_name || 'unknown'
      const kind = node.kind || ''
      const file = node.file_path || ''
      const line = node.line_start ? `:${node.line_start}` : ''
      lines.push(`- ${kind} \`${name}\` in ${file}${line}`)
    }

    if (results.length > this.config.maxNodes) {
      lines.push(`- ... and ${results.length - this.config.maxNodes} more. Use graph_query tool to explore.`)
    }

    return lines.join('\n')
  }

  // ─── Utility ────────────────────────────────────────────────

  private extractFileRefs(message: string): string[] {
    const matches = message.match(new RegExp(FILE_PATH_PATTERN.source, 'gi'))
    return matches ? [...new Set(matches.map(m => m.trim()))] : []
  }

  private logTurn(entry: GraphTurnLog): void {
    this.turnLogs.push(entry)
    // Keep last 100 entries
    if (this.turnLogs.length > 100) {
      this.turnLogs = this.turnLogs.slice(-100)
    }
  }

  // ─── Public accessors ───────────────────────────────────────

  getLastLog(): GraphTurnLog | undefined {
    return this.turnLogs[this.turnLogs.length - 1]
  }

  getStats(): { totalQueries: number; graphHits: number; totalFiles: number } {
    const graphHits = this.turnLogs.filter(l => l.used).length
    const totalFiles = this.turnLogs.reduce((sum, l) => sum + l.files, 0)
    return { totalQueries: this.turnLogs.length, graphHits, totalFiles }
  }

  /**
   * Trigger an incremental graph update (call after file writes).
   * Debounce externally — this is the raw update call.
   */
  async triggerIncrementalUpdate(): Promise<void> {
    if (!this.graphAvailable || !this.mcpClient) return
    try {
      await this.callMcp('build_or_update_graph_tool', {
        full_rebuild: false,
        repo_root: this.projectRoot,
      })
    } catch {
      // Non-critical — log and continue
    }
  }

  /**
   * Build the graph for the first time (or full rebuild).
   */
  async buildGraph(): Promise<boolean> {
    if (!this.mcpClient) return false
    try {
      const result = await this.callMcp('build_or_update_graph_tool', {
        full_rebuild: false,
        repo_root: this.projectRoot,
      })
      if (result !== null) {
        this.buildReady = true
        return true
      }
      return false
    } catch {
      return false
    }
  }
}
