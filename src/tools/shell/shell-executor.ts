/**
 * Cross-platform shell executor for cmdr.
 *
 * Mirrors Claude Code's approach: separate BashTool + PowerShellTool with
 * a shared shell abstraction. Detects platform, resolves the correct shell,
 * normalizes paths, and escapes arguments safely.
 */

import { spawn, type ChildProcess } from 'child_process'
import * as os from 'os'
import * as path from 'path'
import { existsSync } from 'fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform = 'windows' | 'unix'
export type ShellType = 'bash' | 'zsh' | 'sh' | 'powershell' | 'cmd'

export interface ShellConfig {
  readonly executable: string
  readonly args: string[]
  readonly shellType: ShellType
}

export interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly interrupted: boolean
}

export interface ShellExecOptions {
  readonly command: string
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly env?: Record<string, string>
  /** Force a specific shell type. Auto-detected if omitted. */
  readonly shell?: ShellType
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

let _cachedPlatform: Platform | undefined

export function detectPlatform(): Platform {
  if (_cachedPlatform) return _cachedPlatform
  _cachedPlatform = os.platform() === 'win32' ? 'windows' : 'unix'
  return _cachedPlatform
}

// ---------------------------------------------------------------------------
// Shell resolution
// ---------------------------------------------------------------------------

const SHELL_LOOKUP: Record<ShellType, ShellConfig> = {
  bash: { executable: 'bash', args: ['-c'], shellType: 'bash' },
  zsh: { executable: 'zsh', args: ['-c'], shellType: 'zsh' },
  sh: { executable: 'sh', args: ['-c'], shellType: 'sh' },
  powershell: { executable: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command'], shellType: 'powershell' },
  cmd: { executable: 'cmd.exe', args: ['/c'], shellType: 'cmd' },
}

let _cachedDefaultShell: ShellConfig | undefined

/**
 * Resolve the default shell for the current platform.
 * On unix: prefers SHELL env, falls back to bash, then sh.
 * On windows: prefers powershell, falls back to cmd.
 */
export function getDefaultShell(): ShellConfig {
  if (_cachedDefaultShell) return _cachedDefaultShell

  const platform = detectPlatform()

  if (platform === 'unix') {
    // Prefer user's SHELL env, then bash, then sh
    const userShell = process.env.SHELL
    if (userShell) {
      const name = path.basename(userShell) as ShellType
      if (SHELL_LOOKUP[name]) {
        _cachedDefaultShell = { ...SHELL_LOOKUP[name], executable: userShell }
        return _cachedDefaultShell
      }
    }
    _cachedDefaultShell = SHELL_LOOKUP.bash
    return _cachedDefaultShell
  }

  // Windows: prefer powershell if available
  const psLocations = [
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  ]
  for (const psPath of psLocations) {
    if (existsSync(psPath)) {
      _cachedDefaultShell = {
        executable: psPath,
        args: ['-NoProfile', '-NonInteractive', '-Command'],
        shellType: 'powershell',
      }
      return _cachedDefaultShell
    }
  }

  // Fallback to cmd
  _cachedDefaultShell = SHELL_LOOKUP.cmd
  return _cachedDefaultShell
}

/**
 * Get a specific shell config by type.
 */
export function getShell(shellType: ShellType): ShellConfig {
  return SHELL_LOOKUP[shellType] ?? SHELL_LOOKUP.sh
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a file path for the current platform.
 * On Windows: converts forward slashes to backslashes.
 * On Unix: converts backslashes to forward slashes.
 */
export function normalizePath(p: string): string {
  if (detectPlatform() === 'windows') {
    return p.replace(/\//g, '\\')
  }
  return p.replace(/\\/g, '/')
}

// ---------------------------------------------------------------------------
// Argument escaping
// ---------------------------------------------------------------------------

/**
 * Escape a shell argument for the current platform.
 * Prevents shell injection by properly quoting arguments.
 */
export function escapeArg(arg: string, shellType?: ShellType): string {
  const shell = shellType ?? getDefaultShell().shellType

  if (shell === 'cmd') {
    // CMD: double-quote and escape internal quotes
    return `"${arg.replace(/"/g, '""')}"`
  }

  if (shell === 'powershell') {
    // PowerShell: single-quote (no variable expansion)
    return `'${arg.replace(/'/g, "''")}'`
  }

  // Unix shells: single-quote (safest, no expansions)
  return `'${arg.replace(/'/g, "'\\''")}'`
}

// ---------------------------------------------------------------------------
// Environment variable expansion
// ---------------------------------------------------------------------------

/**
 * Translate environment variable references between platforms.
 * $VAR / ${VAR} (unix) <-> %VAR% (windows cmd) / $env:VAR (powershell)
 */
export function translateEnvVars(command: string, targetShell: ShellType): string {
  if (targetShell === 'cmd') {
    // Unix → CMD: $VAR / ${VAR} → %VAR%
    return command
      .replace(/\$\{(\w+)\}/g, '%$1%')
      .replace(/\$(\w+)/g, '%$1%')
  }

  if (targetShell === 'powershell') {
    // Unix → PowerShell: $VAR → $env:VAR (only top-level, not already $env:)
    return command
      .replace(/\$\{(\w+)\}/g, '$env:$1')
      .replace(/(?<!\w)\$(?!env:)(\w+)/g, '$env:$1')
  }

  // Already unix-style
  return command
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BUFFER_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Execute a command in the appropriate shell.
 * Mirrors Claude Code's BashTool execution model with:
 * - Platform-aware shell selection
 * - Timeout support
 * - AbortSignal support
 * - Output size limiting
 */
export function execute(options: ShellExecOptions): Promise<ShellResult> {
  return new Promise<ShellResult>((resolve) => {
    const shellConfig = options.shell
      ? getShell(options.shell)
      : getDefaultShell()

    const command = options.command
    const cwd = options.cwd ? normalizePath(options.cwd) : process.cwd()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

    const env = options.env
      ? { ...process.env, ...options.env }
      : process.env

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutSize = 0
    let stderrSize = 0
    let timedOut = false
    let interrupted = false

    const child: ChildProcess = spawn(
      shellConfig.executable,
      [...shellConfig.args, command],
      {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length
      if (stdoutSize <= MAX_BUFFER_SIZE) {
        stdoutChunks.push(chunk)
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length
      if (stderrSize <= MAX_BUFFER_SIZE) {
        stderrChunks.push(chunk)
      }
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const onAbort = () => {
      interrupted = true
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.on('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)

      let stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      let stderr = Buffer.concat(stderrChunks).toString('utf-8')

      // Truncation notice
      if (stdoutSize > MAX_BUFFER_SIZE) {
        stdout += `\n[stdout truncated: ${stdoutSize} bytes total, showing first ${MAX_BUFFER_SIZE}]`
      }
      if (stderrSize > MAX_BUFFER_SIZE) {
        stderr += `\n[stderr truncated: ${stderrSize} bytes total, showing first ${MAX_BUFFER_SIZE}]`
      }

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
        interrupted,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        timedOut: false,
        interrupted: false,
      })
    })
  })
}

/**
 * Check if a command exists on the system.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const platform = detectPlatform()
  const checkCmd = platform === 'windows' ? `where ${cmd}` : `which ${cmd}`
  const result = await execute({
    command: checkCmd,
    timeoutMs: 5000,
  })
  return result.exitCode === 0
}
