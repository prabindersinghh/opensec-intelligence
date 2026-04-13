/**
 * cmdr VS Code Extension — Server Manager.
 *
 * Manages the cmdr serve child process lifecycle.
 * Spawns, health-checks, and auto-restarts the server.
 */

import { ChildProcess, spawn } from 'node:child_process'
import * as vscode from 'vscode'

export class ServerManager {
  private process: ChildProcess | null = null
  private port: number
  private model: string
  private ollamaUrl: string
  private healthy = false
  private restartCount = 0
  private maxRestarts = 5
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private outputChannel: vscode.OutputChannel

  constructor(private context: vscode.ExtensionContext) {
    this.outputChannel = vscode.window.createOutputChannel('cmdr')
    const config = vscode.workspace.getConfiguration('cmdr')
    this.port = config.get<number>('port', 4200)
    this.model = config.get<string>('model', 'qwen3-coder')
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
  }

  /** Start the cmdr serve process. */
  async start(): Promise<void> {
    if (this.process) return

    const cmdrPath = this.resolveCmdrPath()
    this.outputChannel.appendLine(`Starting cmdr serve on port ${this.port}...`)

    this.process = spawn('node', [
      cmdrPath, 'serve',
      '--port', String(this.port),
      '--host', '127.0.0.1',
      '-m', this.model,
    ], {
      env: {
        ...process.env,
        CMDR_OLLAMA_URL: this.ollamaUrl,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      this.outputChannel.appendLine(data.toString().trim())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      this.outputChannel.appendLine(`[stderr] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      this.outputChannel.appendLine(`cmdr serve exited with code ${code}`)
      this.process = null
      this.healthy = false

      // Auto-restart
      if (this.restartCount < this.maxRestarts) {
        this.restartCount++
        this.outputChannel.appendLine(`Auto-restarting (attempt ${this.restartCount}/${this.maxRestarts})...`)
        setTimeout(() => this.start(), 2000)
      }
    })

    // Start health checking
    this.startHealthCheck()
  }

  /** Stop the server process. */
  async stop(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
      this.healthy = false
    }
  }

  /** Check if server is healthy. */
  isHealthy(): boolean {
    return this.healthy
  }

  /** Get the base URL for API requests. */
  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  /** Resolve the path to cmdr CLI entry point. */
  private resolveCmdrPath(): string {
    // Try global install first, then local
    try {
      const which = require('which') as { sync: (cmd: string) => string }
      return which.sync('cmdr')
    } catch {
      // Fallback: assume it's in node_modules or parent
      return 'cmdr'
    }
  }

  /** Poll health endpoint. */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        const response = await fetch(`${this.getBaseUrl()}/health`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)
        this.healthy = response.ok
        if (this.healthy) this.restartCount = 0
      } catch {
        this.healthy = false
      }
    }, 5000)
  }

  /** Reload configuration. */
  reloadConfig(): void {
    const config = vscode.workspace.getConfiguration('cmdr')
    this.port = config.get<number>('port', 4200)
    this.model = config.get<string>('model', 'qwen3-coder')
    this.ollamaUrl = config.get<string>('ollamaUrl', 'http://localhost:11434')
  }

  /** Get current model. */
  getModel(): string {
    return this.model
  }
}
