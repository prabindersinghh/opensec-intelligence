/**
 * Verifier — runs verification specs against a workspace to determine pass/fail.
 */

import { existsSync, readFileSync, statSync } from 'fs'
import { execFileSync, execSync } from 'child_process'
import { join } from 'path'
import type { VerificationSpec } from './types.js'

export interface VerifyResult {
  passed: boolean
  details: string[]
}

/**
 * Run all verification specs against a workspace.
 * ALL specs must pass for the task to pass.
 */
export function verifyTask(specs: VerificationSpec[], workspacePath: string): VerifyResult {
  const details: string[] = []
  let allPassed = true

  for (const spec of specs) {
    const result = verifySingle(spec, workspacePath)
    details.push(result.detail)
    if (!result.ok) allPassed = false
  }

  return { passed: allPassed, details }
}

function verifySingle(spec: VerificationSpec, ws: string): { ok: boolean; detail: string } {
  try {
    switch (spec.strategy) {
      case 'file_exists':
        return verifyFileExists(spec.target, ws)

      case 'file_contains':
        return verifyFileContains(spec.target, spec.expected ?? '', ws)

      case 'test_passes':
        return verifyTestPasses(spec.target, ws)

      case 'output_matches':
        return verifyOutputMatches(spec.target, spec.expected ?? '', ws)

      case 'script_verify':
        return verifyScript(spec.script ?? spec.target, ws)

      case 'diff_check':
        return verifyDiff(spec.expected ?? '', ws)

      default:
        return { ok: false, detail: `Unknown strategy: ${spec.strategy}` }
    }
  } catch (err: any) {
    return { ok: false, detail: `Error: ${err.message?.slice(0, 200) ?? String(err)}` }
  }
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

function verifyFileExists(target: string, ws: string): { ok: boolean; detail: string } {
  const fullPath = join(ws, target)
  const exists = existsSync(fullPath)

  // Also check if it's a directory (target ending in /)
  if (target.endsWith('/')) {
    const isDir = exists && statSync(fullPath).isDirectory()
    return {
      ok: isDir,
      detail: isDir ? `✓ Directory exists: ${target}` : `✗ Directory missing: ${target}`,
    }
  }

  return {
    ok: exists,
    detail: exists ? `✓ File exists: ${target}` : `✗ File missing: ${target}`,
  }
}

function verifyFileContains(target: string, expected: string, ws: string): { ok: boolean; detail: string } {
  const fullPath = join(ws, target)
  if (!existsSync(fullPath)) {
    return { ok: false, detail: `✗ File not found: ${target}` }
  }

  const content = readFileSync(fullPath, 'utf-8')

  // NOT prefix → inverted check
  if (expected.startsWith('NOT ')) {
    const pattern = expected.slice(4)
    const contains = content.includes(pattern)
    return {
      ok: !contains,
      detail: !contains
        ? `✓ File ${target} does NOT contain "${pattern.slice(0, 50)}"`
        : `✗ File ${target} unexpectedly contains "${pattern.slice(0, 50)}"`,
    }
  }

  // REGEX: prefix → regex match
  if (expected.startsWith('REGEX:')) {
    const pattern = expected.slice(6)
    const re = new RegExp(pattern)
    const matches = re.test(content)
    return {
      ok: matches,
      detail: matches
        ? `✓ File ${target} matches regex: ${pattern.slice(0, 50)}`
        : `✗ File ${target} does not match regex: ${pattern.slice(0, 50)}`,
    }
  }

  // Plain substring check
  const contains = content.includes(expected)
  return {
    ok: contains,
    detail: contains
      ? `✓ File ${target} contains "${expected.slice(0, 50)}"`
      : `✗ File ${target} missing "${expected.slice(0, 50)}"`,
  }
}

function verifyTestPasses(command: string, ws: string): { ok: boolean; detail: string } {
  try {
    execSync(command, {
      cwd: ws,
      timeout: 30_000,
      stdio: 'pipe',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    })
    return { ok: true, detail: `✓ Test passed: ${command}` }
  } catch (err: any) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.slice(0, 200) : ''
    return { ok: false, detail: `✗ Test failed: ${command} — ${stderr}` }
  }
}

function verifyOutputMatches(command: string, expected: string, ws: string): { ok: boolean; detail: string } {
  try {
    const output = execSync(command, {
      cwd: ws,
      timeout: 15_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    }).trim()

    const matches = output.includes(expected)
    return {
      ok: matches,
      detail: matches
        ? `✓ Output of "${command}" contains "${expected.slice(0, 50)}"`
        : `✗ Output of "${command}" missing "${expected.slice(0, 50)}" (got: ${output.slice(0, 100)})`,
    }
  } catch (err: any) {
    return { ok: false, detail: `✗ Command failed: ${command} — ${err.message?.slice(0, 100)}` }
  }
}

function verifyScript(scriptPath: string, ws: string): { ok: boolean; detail: string } {
  try {
    execFileSync('bash', [scriptPath], {
      cwd: ws,
      timeout: 30_000,
      stdio: 'pipe',
      env: { ...process.env, WORKSPACE: ws },
    })
    return { ok: true, detail: `✓ Verify script passed: ${scriptPath}` }
  } catch (err: any) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.slice(0, 200) : ''
    return { ok: false, detail: `✗ Verify script failed: ${scriptPath} — ${stderr}` }
  }
}

function verifyDiff(expected: string, ws: string): { ok: boolean; detail: string } {
  try {
    const diff = execSync('git diff --name-only', {
      cwd: ws,
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    const contains = diff.includes(expected)
    return {
      ok: contains,
      detail: contains
        ? `✓ Git diff includes: ${expected}`
        : `✗ Git diff missing: ${expected} (changed: ${diff.slice(0, 100)})`,
    }
  } catch {
    return { ok: false, detail: '✗ Git diff failed (not a git repo?)' }
  }
}
