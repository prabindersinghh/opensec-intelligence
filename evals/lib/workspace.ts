/**
 * Workspace manager — creates and tears down isolated temp workspaces for eval tasks.
 */

import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'

export interface WorkspaceInfo {
  path: string
  taskId: string
}

/**
 * Create an isolated workspace for a task.
 * Copies the task's workspace/ directory into a temp location.
 * Runs setup.sh if present.
 */
export function createWorkspace(taskDir: string, taskId: string): WorkspaceInfo {
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const wsPath = join(tmpdir(), `cmdr-eval-${safeId}-${Date.now()}`)

  mkdirSync(wsPath, { recursive: true })

  // Copy workspace contents
  const sourceWs = join(taskDir, 'workspace')
  if (existsSync(sourceWs)) {
    cpSync(sourceWs, wsPath, { recursive: true })
  }

  // Initialize git so git-related tools work
  try {
    execFileSync('git', ['init', '-q'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
    execFileSync('git', ['checkout', '-b', 'main'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
    // Set temporary git config for the workspace
    execFileSync('git', ['config', 'user.email', 'eval@cmdr.local'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
    execFileSync('git', ['config', 'user.name', 'cmdr-eval'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
    execFileSync('git', ['add', '-A'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
    execFileSync('git', ['commit', '-m', 'initial', '--allow-empty'], { cwd: wsPath, stdio: 'pipe', timeout: 5000 })
  } catch {
    // Git init is best-effort
  }

  // Run setup script if present
  const setupScript = join(taskDir, 'setup.sh')
  if (existsSync(setupScript)) {
    try {
      execFileSync('bash', [setupScript], {
        cwd: wsPath,
        timeout: 30_000,
        stdio: 'pipe',
        env: { ...process.env, WORKSPACE: wsPath },
      })
    } catch (err: any) {
      console.error(`  Setup failed for ${taskId}: ${err.message?.slice(0, 100)}`)
    }
  }

  return { path: wsPath, taskId }
}

/**
 * Clean up a workspace after evaluation.
 */
export function destroyWorkspace(ws: WorkspaceInfo): void {
  try {
    rmSync(ws.path, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
}
