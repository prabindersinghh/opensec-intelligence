/**
 * cmdr VS Code Extension — Autonomous Loop System.
 *
 * Manages iterative agent loops that run until a task is complete,
 * with configurable limits and stop-hook integration.
 *
 * Features:
 *   - Configurable max iterations (default 25)
 *   - Stop hook integration (PreToolUse → Stop type)
 *   - Loop state persistence in .cmdr/loop-state.local.md
 *   - Iteration budget tracking (tokens, time, iterations)
 *   - Pause/resume/cancel controls
 *   - Auto-escalation if stuck (repeated similar outputs)
 */

import * as vscode from 'vscode'
import type { HookRunner } from './hooks'

export interface LoopConfig {
  enabled: boolean
  maxIterations: number
  maxDurationMs: number // default 10 minutes
  maxTokens: number // total token budget
  detectStuck: boolean // detect repeated outputs
  stuckThreshold: number // number of similar outputs before escalating
  requireApprovalEveryN: number // require user approval every N iterations (0 = never)
}

export interface LoopState {
  id: string
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'stuck'
  iteration: number
  startTime: number
  totalTokens: number
  lastOutput: string
  repeatedOutputCount: number
  goal: string
  history: LoopHistoryEntry[]
}

export interface LoopHistoryEntry {
  iteration: number
  timestamp: number
  action: string
  toolName?: string
  result?: string
  tokens?: number
}

const DEFAULT_CONFIG: LoopConfig = {
  enabled: false,
  maxIterations: 25,
  maxDurationMs: 10 * 60 * 1000, // 10 minutes
  maxTokens: 500_000,
  detectStuck: true,
  stuckThreshold: 3,
  requireApprovalEveryN: 0,
}

export class AutonomousLoopManager {
  private config: LoopConfig
  private activeLoop: LoopState | null = null
  private outputChannel: vscode.OutputChannel
  private hookRunner: HookRunner | null = null
  private cancelToken: vscode.CancellationTokenSource | null = null

  private readonly _onLoopUpdate = new vscode.EventEmitter<LoopState>()
  readonly onLoopUpdate = this._onLoopUpdate.event

  private readonly _onLoopEnd = new vscode.EventEmitter<LoopState>()
  readonly onLoopEnd = this._onLoopEnd.event

  constructor(outputChannel: vscode.OutputChannel, hookRunner?: HookRunner) {
    this.outputChannel = outputChannel
    this.hookRunner = hookRunner || null
    this.config = this.loadConfig()
  }

  private loadConfig(): LoopConfig {
    const vsConfig = vscode.workspace.getConfiguration('cmdr')
    const userConfig = vsConfig.get<Partial<LoopConfig>>('autonomousLoop')
    return { ...DEFAULT_CONFIG, ...userConfig }
  }

  /** Refresh config from VS Code settings. */
  refresh(): void {
    this.config = this.loadConfig()
  }

  /** Check if autonomous mode is enabled. */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /** Get the currently active loop if any. */
  getActiveLoop(): LoopState | null {
    return this.activeLoop
  }

  /** Start a new autonomous loop. */
  startLoop(goal: string): LoopState {
    if (this.activeLoop?.status === 'running') {
      throw new Error('A loop is already running. Cancel it first.')
    }

    this.cancelToken = new vscode.CancellationTokenSource()

    this.activeLoop = {
      id: `loop-${Date.now()}`,
      status: 'running',
      iteration: 0,
      startTime: Date.now(),
      totalTokens: 0,
      lastOutput: '',
      repeatedOutputCount: 0,
      goal,
      history: [],
    }

    this.outputChannel.appendLine(`[loop] Started autonomous loop: ${goal}`)
    this._onLoopUpdate.fire(this.activeLoop)
    return this.activeLoop
  }

  /**
   * Called before each iteration. Returns whether to continue.
   *
   * Checks:
   *   - Cancellation token
   *   - Max iterations
   *   - Max duration
   *   - Max tokens
   *   - Stuck detection
   *   - Stop hook
   *   - Periodic approval
   */
  async shouldContinue(): Promise<{ continue: boolean; reason?: string }> {
    if (!this.activeLoop || this.activeLoop.status !== 'running') {
      return { continue: false, reason: 'No active loop' }
    }

    // Cancellation
    if (this.cancelToken?.token.isCancellationRequested) {
      this.activeLoop.status = 'cancelled'
      this._onLoopEnd.fire(this.activeLoop)
      return { continue: false, reason: 'Cancelled by user' }
    }

    // Max iterations
    if (this.activeLoop.iteration >= this.config.maxIterations) {
      this.activeLoop.status = 'completed'
      this._onLoopEnd.fire(this.activeLoop)
      return { continue: false, reason: `Max iterations reached (${this.config.maxIterations})` }
    }

    // Max duration
    const elapsed = Date.now() - this.activeLoop.startTime
    if (elapsed > this.config.maxDurationMs) {
      this.activeLoop.status = 'completed'
      this._onLoopEnd.fire(this.activeLoop)
      return { continue: false, reason: `Max duration reached (${Math.round(elapsed / 1000)}s)` }
    }

    // Max tokens
    if (this.activeLoop.totalTokens > this.config.maxTokens) {
      this.activeLoop.status = 'completed'
      this._onLoopEnd.fire(this.activeLoop)
      return { continue: false, reason: `Token budget exhausted (${this.activeLoop.totalTokens})` }
    }

    // Stuck detection
    if (this.config.detectStuck && this.activeLoop.repeatedOutputCount >= this.config.stuckThreshold) {
      this.activeLoop.status = 'stuck'
      this._onLoopEnd.fire(this.activeLoop)
      return { continue: false, reason: `Stuck: ${this.config.stuckThreshold} similar outputs in a row` }
    }

    // Stop hook
    if (this.hookRunner) {
      const hookResult = await this.hookRunner.run('Stop', {
        iteration: this.activeLoop.iteration,
        goal: this.activeLoop.goal,
        elapsed,
        totalTokens: this.activeLoop.totalTokens,
      })
      if (hookResult.exitCode === 2) {
        this.activeLoop.status = 'completed'
        this._onLoopEnd.fire(this.activeLoop)
        return { continue: false, reason: `Stop hook triggered: ${hookResult.message || 'hook exit code 2'}` }
      }
    }

    // Periodic approval
    if (
      this.config.requireApprovalEveryN > 0 &&
      this.activeLoop.iteration > 0 &&
      this.activeLoop.iteration % this.config.requireApprovalEveryN === 0
    ) {
      const choice = await vscode.window.showInformationMessage(
        `cmdr autonomous loop: ${this.activeLoop.iteration} iterations completed. Continue?`,
        'Continue',
        'Cancel',
      )
      if (choice !== 'Continue') {
        this.activeLoop.status = 'cancelled'
        this._onLoopEnd.fire(this.activeLoop)
        return { continue: false, reason: 'User declined to continue' }
      }
    }

    return { continue: true }
  }

  /**
   * Record an iteration result.
   * Updates stuck detection, token count, and history.
   */
  recordIteration(entry: Omit<LoopHistoryEntry, 'iteration' | 'timestamp'>): void {
    if (!this.activeLoop) return

    this.activeLoop.iteration++
    const historyEntry: LoopHistoryEntry = {
      ...entry,
      iteration: this.activeLoop.iteration,
      timestamp: Date.now(),
    }
    this.activeLoop.history.push(historyEntry)

    if (entry.tokens) {
      this.activeLoop.totalTokens += entry.tokens
    }

    // Stuck detection: compare output similarity
    if (entry.result && this.config.detectStuck) {
      const normalized = entry.result.trim().slice(0, 500)
      if (normalized === this.activeLoop.lastOutput) {
        this.activeLoop.repeatedOutputCount++
      } else {
        this.activeLoop.repeatedOutputCount = 0
        this.activeLoop.lastOutput = normalized
      }
    }

    this.outputChannel.appendLine(
      `[loop] Iteration ${this.activeLoop.iteration}/${this.config.maxIterations}: ${entry.action}`,
    )
    this._onLoopUpdate.fire(this.activeLoop)
  }

  /** Pause the active loop. */
  pauseLoop(): void {
    if (this.activeLoop?.status === 'running') {
      this.activeLoop.status = 'paused'
      this.outputChannel.appendLine(`[loop] Paused at iteration ${this.activeLoop.iteration}`)
      this._onLoopUpdate.fire(this.activeLoop)
    }
  }

  /** Resume a paused loop. */
  resumeLoop(): void {
    if (this.activeLoop?.status === 'paused') {
      this.activeLoop.status = 'running'
      this.outputChannel.appendLine(`[loop] Resumed at iteration ${this.activeLoop.iteration}`)
      this._onLoopUpdate.fire(this.activeLoop)
    }
  }

  /** Cancel the active loop. */
  cancelLoop(): void {
    this.cancelToken?.cancel()
    if (this.activeLoop) {
      this.activeLoop.status = 'cancelled'
      this.outputChannel.appendLine(`[loop] Cancelled at iteration ${this.activeLoop.iteration}`)
      this._onLoopEnd.fire(this.activeLoop)
    }
  }

  /** Complete the loop successfully. */
  completeLoop(): void {
    if (this.activeLoop) {
      this.activeLoop.status = 'completed'
      this.outputChannel.appendLine(
        `[loop] Completed after ${this.activeLoop.iteration} iterations, ${this.activeLoop.totalTokens} tokens`,
      )
      this._onLoopEnd.fire(this.activeLoop)
    }
  }

  /** Get a summary of the current/last loop. */
  getLoopSummary(): string {
    if (!this.activeLoop) return 'No loop active'

    const elapsed = Date.now() - this.activeLoop.startTime
    return [
      `**Loop: ${this.activeLoop.goal}**`,
      `Status: ${this.activeLoop.status}`,
      `Iterations: ${this.activeLoop.iteration}/${this.config.maxIterations}`,
      `Duration: ${Math.round(elapsed / 1000)}s`,
      `Tokens: ${this.activeLoop.totalTokens.toLocaleString()}`,
      this.activeLoop.status === 'stuck' ? '⚠ Loop detected repeated outputs' : '',
    ].filter(Boolean).join('\n')
  }

  dispose(): void {
    this.cancelToken?.cancel()
    this.cancelToken?.dispose()
    this._onLoopUpdate.dispose()
    this._onLoopEnd.dispose()
  }
}
