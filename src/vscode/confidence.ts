/**
 * cmdr VS Code Extension — Confidence Filtering.
 *
 * Scores tool results on a 0–100 scale and applies a configurable threshold
 * before presenting results to the user or allowing automatic execution.
 *
 * Confidence dimensions:
 *   - Relevance: Does the result address the user's request?
 *   - Correctness: Is the result syntactically/logically valid?
 *   - Completeness: Does the result fully solve the task?
 *   - Safety: Does the result avoid destructive side effects?
 *
 * When a result falls below the threshold, cmdr will:
 *   - Pause execution (if autonomous)
 *   - Show a warning to the user with the score breakdown
 *   - Allow the user to accept, reject, or retry
 */

import * as vscode from 'vscode'

export interface ConfidenceScore {
  overall: number // 0–100
  relevance: number // 0–100
  correctness: number // 0–100
  completeness: number // 0–100
  safety: number // 0–100
}

export interface ConfidenceResult {
  score: ConfidenceScore
  passed: boolean
  reason?: string
  suggestion?: string
}

export interface ConfidenceConfig {
  enabled: boolean
  threshold: number // 0–100, default 80
  weights: {
    relevance: number
    correctness: number
    completeness: number
    safety: number
  }
  /** Always require approval below this score regardless of auto-approve. */
  hardBlockThreshold: number // default 30
  /** Skip confidence checks for these tool names. */
  skipTools: string[]
}

const DEFAULT_CONFIG: ConfidenceConfig = {
  enabled: true,
  threshold: 80,
  weights: {
    relevance: 0.25,
    correctness: 0.3,
    completeness: 0.2,
    safety: 0.25,
  },
  hardBlockThreshold: 30,
  skipTools: [],
}

export class ConfidenceFilter {
  private config: ConfidenceConfig
  private outputChannel: vscode.OutputChannel

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel
    this.config = this.loadConfig()
  }

  private loadConfig(): ConfidenceConfig {
    const vsConfig = vscode.workspace.getConfiguration('cmdr')
    const userConfig = vsConfig.get<Partial<ConfidenceConfig>>('confidence')

    return {
      ...DEFAULT_CONFIG,
      ...userConfig,
      weights: {
        ...DEFAULT_CONFIG.weights,
        ...userConfig?.weights,
      },
    }
  }

  /** Refresh config from VS Code settings. */
  refresh(): void {
    this.config = this.loadConfig()
  }

  /** Check if confidence filtering is enabled. */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /** Get the current threshold. */
  getThreshold(): number {
    return this.config.threshold
  }

  /**
   * Score a tool result based on heuristics.
   *
   * For file edits: checks syntax validity, diff size, file existence.
   * For bash commands: checks exit code, output length, error patterns.
   * For search results: checks relevance signals, result count.
   */
  scoreToolResult(
    toolName: string,
    input: Record<string, unknown>,
    output: string,
    exitCode?: number,
  ): ConfidenceResult {
    if (!this.config.enabled || this.config.skipTools.includes(toolName)) {
      return {
        score: { overall: 100, relevance: 100, correctness: 100, completeness: 100, safety: 100 },
        passed: true,
      }
    }

    const score = this.computeScore(toolName, input, output, exitCode)
    const passed = score.overall >= this.config.threshold

    const result: ConfidenceResult = { score, passed }

    if (!passed) {
      result.reason = this.explainScore(score)
      result.suggestion = this.suggestFix(toolName, score)
    }

    this.outputChannel.appendLine(
      `[confidence] ${toolName}: ${score.overall} (threshold ${this.config.threshold}) → ${passed ? 'PASS' : 'FAIL'}`,
    )

    return result
  }

  /** Check if a score is below the hard block threshold. */
  isHardBlocked(score: ConfidenceScore): boolean {
    return score.overall < this.config.hardBlockThreshold
  }

  private computeScore(
    toolName: string,
    input: Record<string, unknown>,
    output: string,
    exitCode?: number,
  ): ConfidenceScore {
    const { weights } = this.config

    let relevance = 70
    let correctness = 70
    let completeness = 70
    let safety = 85

    // Tool-specific scoring heuristics
    if (toolName.includes('bash') || toolName.includes('terminal') || toolName === 'Bash') {
      // Bash commands
      if (exitCode !== undefined) {
        correctness = exitCode === 0 ? 95 : Math.max(10, 60 - exitCode * 10)
      }

      // Check for error patterns in output
      const errorPatterns = /error|fatal|failed|denied|not found|exception|traceback|panic/i
      if (errorPatterns.test(output)) {
        correctness = Math.min(correctness, 40)
      }

      // Empty output can mean success or failure depending on command
      if (output.trim().length === 0 && exitCode === 0) {
        completeness = 80
      }

      // Safety: check for dangerous patterns
      const cmd = typeof input.command === 'string' ? input.command : ''
      if (/rm\s+-rf|sudo|chmod\s+777|>\s*\/dev\/|mkfs/i.test(cmd)) {
        safety = 20
      }
    } else if (toolName.includes('edit') || toolName.includes('write') || toolName === 'Edit') {
      // File edits
      if (output.includes('successfully') || output.includes('applied')) {
        correctness = 90
        completeness = 85
      }

      // Large diffs are less likely to be correct
      const diffLines = output.split('\n').length
      if (diffLines > 200) {
        correctness = Math.min(correctness, 60)
        completeness = Math.min(completeness, 70)
      }

      // Check for syntax error indicators
      if (/syntax\s*error|unexpected\s*token|parse\s*error/i.test(output)) {
        correctness = 20
      }
    } else if (toolName.includes('search') || toolName.includes('grep') || toolName === 'Search') {
      // Search results
      const resultCount = (output.match(/\n/g) || []).length
      if (resultCount === 0) {
        relevance = 30
        completeness = 20
      } else if (resultCount > 100) {
        relevance = 50 // Too many results = probably not specific enough
      } else {
        relevance = Math.min(95, 60 + resultCount * 2)
      }
      correctness = 90 // Searches are generally reliable
    } else if (toolName.includes('read') || toolName === 'Read') {
      // File reads are high confidence
      correctness = 95
      relevance = 80
      completeness = output.trim().length > 0 ? 90 : 30
    }

    // Compute weighted overall
    const overall = Math.round(
      relevance * weights.relevance +
      correctness * weights.correctness +
      completeness * weights.completeness +
      safety * weights.safety,
    )

    return {
      overall: Math.max(0, Math.min(100, overall)),
      relevance: Math.max(0, Math.min(100, relevance)),
      correctness: Math.max(0, Math.min(100, correctness)),
      completeness: Math.max(0, Math.min(100, completeness)),
      safety: Math.max(0, Math.min(100, safety)),
    }
  }

  private explainScore(score: ConfidenceScore): string {
    const parts: string[] = []
    if (score.relevance < 50) parts.push('low relevance')
    if (score.correctness < 50) parts.push('potential errors detected')
    if (score.completeness < 50) parts.push('incomplete result')
    if (score.safety < 50) parts.push('safety concerns')
    return parts.length > 0 ? parts.join(', ') : 'below confidence threshold'
  }

  private suggestFix(toolName: string, score: ConfidenceScore): string {
    if (score.safety < 50) return 'Review the command for potentially destructive operations'
    if (score.correctness < 50) return 'Check for errors in the output and retry if needed'
    if (score.relevance < 50) return 'Try a more specific query or different approach'
    if (score.completeness < 50) return 'The result may be partial — verify completeness'
    return 'Review the result before proceeding'
  }

  /** Format a score for display in the chat panel. */
  formatScore(result: ConfidenceResult): string {
    const { score } = result
    const bar = (v: number) => {
      const filled = Math.round(v / 10)
      return '█'.repeat(filled) + '░'.repeat(10 - filled)
    }

    return [
      `**Confidence: ${score.overall}%** ${result.passed ? '✓' : '⚠'}`,
      `  Relevance:   ${bar(score.relevance)} ${score.relevance}%`,
      `  Correctness: ${bar(score.correctness)} ${score.correctness}%`,
      `  Completeness:${bar(score.completeness)} ${score.completeness}%`,
      `  Safety:      ${bar(score.safety)} ${score.safety}%`,
      result.reason ? `\n⚠ ${result.reason}` : '',
      result.suggestion ? `💡 ${result.suggestion}` : '',
    ].filter(Boolean).join('\n')
  }

  dispose(): void {
    // Cleanup if needed
  }
}
