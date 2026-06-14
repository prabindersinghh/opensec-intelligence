/**
 * CLI smoke tests — spawn the compiled binary and assert on stdout/exit codes.
 * No Ollama required: --quick mode uses the deterministic scanner only.
 */
import { test, expect } from '@playwright/test'
import { spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

const BIN = path.resolve('dist/bin/cmdr.js')
const DEMO_DIR = path.resolve('demo/prove-demo')

function run(args: string[], cwd = process.cwd()): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    timeout: 20_000,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? 1,
  }
}

test('--version prints version number', () => {
  const { stdout, code } = run(['--version'])
  expect(code).toBe(0)
  expect(stdout).toMatch(/\d+\.\d+\.\d+/)
})

test('--help prints usage', () => {
  const { stdout, code } = run(['--help'])
  expect(code).toBe(0)
  expect(stdout).toContain('opensec scan')
  expect(stdout).toContain('opensec prove')
  expect(stdout).toContain('opensec fix')
})

test('scan --quick finds HIGH findings in prove-demo', () => {
  const { stdout, code } = run(['scan', DEMO_DIR, '--quick'])
  expect(code).toBe(0)
  expect(stdout).toContain('auth.js')
  expect(stdout).toContain('HIGH')
})

test('scan --quick finds MD5 weakness', () => {
  const { stdout } = run(['scan', DEMO_DIR, '--quick'])
  expect(stdout).toMatch(/Weak Hash Algorithm|MD5/i)
})

test('scan --quick finds JWT secret', () => {
  const { stdout } = run(['scan', DEMO_DIR, '--quick'])
  expect(stdout).toMatch(/JWT Secret/i)
})

test('scan --quick --ci exits 0 with no CRITICAL', () => {
  const { code, stdout } = run(['scan', DEMO_DIR, '--quick', '--ci'])
  // prove-demo has only HIGH findings → exit 0
  expect(code).toBe(0)
  // --ci outputs JSON
  const findings = JSON.parse(stdout)
  expect(Array.isArray(findings)).toBe(true)
  expect(findings.length).toBeGreaterThan(0)
})

test('scan --quick --ci JSON output has required fields', () => {
  const { stdout } = run(['scan', DEMO_DIR, '--quick', '--ci'])
  const findings = JSON.parse(stdout)
  const f = findings[0]
  expect(f).toHaveProperty('id')
  expect(f).toHaveProperty('file')
  expect(f).toHaveProperty('line')
  expect(f).toHaveProperty('severity')
  expect(f).toHaveProperty('ruleName')
  expect(f).toHaveProperty('snippet')
})

test('scan --quick writes .opensec/last-scan.json', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opensec-e2e-'))
  // Copy prove-demo into tmp so .opensec/ is written there
  fs.cpSync(DEMO_DIR, tmp, { recursive: true })
  run(['scan', tmp, '--quick'])
  const scanFile = path.join(tmp, '.opensec', 'last-scan.json')
  expect(fs.existsSync(scanFile)).toBe(true)
  const data = JSON.parse(fs.readFileSync(scanFile, 'utf8'))
  expect(data).toHaveProperty('findings')
  expect(data).toHaveProperty('scannedAt')
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('prove skips gracefully with no Ollama model', () => {
  // Even without a code-gen model, prove must not crash — it skips findings
  const { code, stdout } = run(['prove', DEMO_DIR])
  // Exit 0 = no unpatched exploitation confirmed (skipped ≠ failed)
  expect(code).toBe(0)
  expect(stdout).toMatch(/PROVE SUMMARY|SKIPPED|No HIGH\/CRITICAL/i)
})

test('scan unknown directory exits non-zero', () => {
  const nonexistent = path.join(os.tmpdir(), `opensec-nonexistent-${Date.now()}`)
  const { code } = run(['scan', nonexistent])
  expect(code).not.toBe(0)
})
