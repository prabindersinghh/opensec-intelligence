/**
 * Daemon mode — background file watcher + on-change command execution.
 *
 * cmdr daemon start --watch src/ --on-change "npm run lint --fix"
 * cmdr daemon status
 * cmdr daemon stop
 *
 * Uses Node.js fs.watch (recursive) and spawns on-change commands.
 */

import { watch, type FSWatcher } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'

export interface DaemonConfig {
  watchPaths: string[]
  onChange: string
  cwd: string
  debounceMs?: number
}

interface DaemonPidFile {
  pid: number
  cwd: string
  watchPaths: string[]
  onChange: string
  startedAt: string
}

const PID_DIR = join(homedir(), '.opensec', 'daemon')

function pidFilePath(cwd: string): string {
  // Use a hash of cwd for unique pid file
  const { createHash } = require('node:crypto') as typeof import('node:crypto')
  const hash = createHash('sha256').update(cwd).digest('hex').slice(0, 12)
  return join(PID_DIR, `${hash}.json`)
}

export class CmdrDaemon {
  private watchers: FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private config: DaemonConfig) {}

  /** Start watching and executing on change. */
  async start(): Promise<void> {
    if (this.running) return

    const debounceMs = this.config.debounceMs ?? 500

    for (const watchPath of this.config.watchPaths) {
      const fullPath = resolve(this.config.cwd, watchPath)
      try {
        const watcher = watch(fullPath, { recursive: true }, (_eventType, filename) => {
          if (!filename) return
          // Skip hidden files and node_modules
          if (filename.startsWith('.') || filename.includes('node_modules')) return

          // Debounce rapid changes
          if (this.debounceTimer) clearTimeout(this.debounceTimer)
          this.debounceTimer = setTimeout(() => {
            this.executeOnChange(filename)
          }, debounceMs)
        })
        this.watchers.push(watcher)
      } catch (err) {
        console.error(`Cannot watch ${fullPath}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    this.running = true
    await this.writePidFile()

    console.log(`Daemon started (PID ${process.pid})`)
    console.log(`  Watching: ${this.config.watchPaths.join(', ')}`)
    console.log(`  On change: ${this.config.onChange}`)

    // Keep process alive
    const keepAlive = setInterval(() => {}, 60_000)

    // Graceful shutdown
    const shutdown = async () => {
      clearInterval(keepAlive)
      await this.stop()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }

  /** Execute the on-change command. */
  private executeOnChange(filename: string): void {
    console.log(`[daemon] Change detected: ${filename}`)
    console.log(`[daemon] Running: ${this.config.onChange}`)

    const child = spawn('sh', ['-c', this.config.onChange], {
      cwd: this.config.cwd,
      stdio: 'inherit',
      env: { ...process.env, CMDR_CHANGED_FILE: filename },
    })

    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[daemon] Command completed successfully`)
      } else {
        console.log(`[daemon] Command exited with code ${code}`)
      }
    })
  }

  /** Stop watching. */
  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
    this.running = false
    await this.removePidFile()
    console.log('Daemon stopped.')
  }

  /** Write PID file for status/stop from another process. */
  private async writePidFile(): Promise<void> {
    await mkdir(PID_DIR, { recursive: true })
    const data: DaemonPidFile = {
      pid: process.pid,
      cwd: this.config.cwd,
      watchPaths: this.config.watchPaths,
      onChange: this.config.onChange,
      startedAt: new Date().toISOString(),
    }
    await writeFile(pidFilePath(this.config.cwd), JSON.stringify(data, null, 2))
  }

  /** Remove PID file on shutdown. */
  private async removePidFile(): Promise<void> {
    try {
      await unlink(pidFilePath(this.config.cwd))
    } catch { /* already gone */ }
  }

  /** Read daemon status for a given cwd. */
  static async status(cwd: string): Promise<DaemonPidFile | null> {
    try {
      const raw = await readFile(pidFilePath(cwd), 'utf-8')
      const data = JSON.parse(raw) as DaemonPidFile
      // Check if process is actually running
      try {
        process.kill(data.pid, 0)
        return data
      } catch {
        // Process no longer running, clean up stale PID file
        await unlink(pidFilePath(cwd)).catch(() => {})
        return null
      }
    } catch {
      return null
    }
  }

  /** Stop a running daemon for a given cwd. */
  static async stopByPid(cwd: string): Promise<boolean> {
    const info = await CmdrDaemon.status(cwd)
    if (!info) return false
    try {
      process.kill(info.pid, 'SIGTERM')
      await unlink(pidFilePath(cwd)).catch(() => {})
      return true
    } catch {
      return false
    }
  }
}
