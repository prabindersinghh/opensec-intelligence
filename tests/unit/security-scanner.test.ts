import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runScanner, loadLastScan } from '../../src/security/scanner.js'
import { extractJson } from '../../src/security/llm.js'
import { buildDiff, renderDiffHtml } from '../../src/security/screenshot.js'
import { tally } from '../../src/security/types.js'

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opensec-test-'))
  await fs.mkdir(path.join(dir, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(dir, 'src', 'app.js'),
    [
      "const password = 'hunter2pass'",
      'const id = req.query.id',
      'db.query(`SELECT * FROM users WHERE id = ${id}`)',
      "const h = crypto.createHash('md5')",
      // use a security-sensitive variable name so the scoped pattern fires
      'const token = Math.random()',
    ].join('\n'),
    'utf8',
  )
  await fs.writeFile(
    path.join(dir, 'Dockerfile'),
    ['FROM node:latest', 'USER root'].join('\n'),
    'utf8',
  )
  // A line that must be suppressed.
  await fs.writeFile(
    path.join(dir, 'safe.js'),
    "const apiKey = 'this-should-be-ignored-1234' // opensec-ignore\n",
    'utf8',
  )
})

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('runScanner', () => {
  it('detects secret, code and infra findings deterministically', async () => {
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    const rules = result.findings.map((f) => f.ruleName)
    expect(rules).toContain('Hardcoded Password Assignment')
    expect(rules).toContain('SQL Injection — Template Literal')
    expect(rules).toContain('Weak Hash Algorithm (MD5)')
    expect(rules).toContain('Insecure Random for Secret')
    expect(rules).toContain('Docker: Latest Tag')
    expect(rules).toContain('Docker: Running as Root')
  })

  it('respects opensec-ignore markers', async () => {
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    expect(result.findings.find((f) => f.file === 'safe.js')).toBeUndefined()
  })

  it('produces stable ids and required fields', async () => {
    const a = await runScanner({ targetPath: dir, version: 't', persist: false })
    const b = await runScanner({ targetPath: dir, version: 't', persist: false })
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id))
    for (const f of a.findings) {
      expect(f).toMatchObject({
        id: expect.any(String),
        file: expect.any(String),
        line: expect.any(Number),
        severity: expect.stringMatching(/CRITICAL|HIGH|MEDIUM|LOW/),
        remediation: expect.any(String),
      })
    }
  })

  it('sorts findings by severity', async () => {
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
    const ranks = result.findings.map((f) => order[f.severity])
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y))
  })

  it('persists and reloads .opensec/last-scan.json', async () => {
    await runScanner({ targetPath: dir, version: 't', persist: true })
    const loaded = await loadLastScan(dir)
    expect(loaded).not.toBeNull()
    expect(loaded!.findings.length).toBeGreaterThan(0)
    await fs.rm(path.join(dir, '.opensec'), { recursive: true, force: true })
  })

  it('tally counts by severity', async () => {
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    const t = tally(result.findings)
    expect(t.CRITICAL + t.HIGH + t.MEDIUM + t.LOW).toBe(result.findings.length)
  })

  it('excludes test files for noise-prone patterns', async () => {
    // Write the same vuln inside a test file path.
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true })
    await fs.writeFile(
      path.join(dir, 'tests', 'auth.test.js'),
      "const password = 'hunter2pass'\nconst token = Math.random()\n",
      'utf8',
    )
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    const testFindings = result.findings.filter((f) => f.file.includes('tests/'))
    // skipInTestFiles patterns should not fire in test files
    expect(testFindings.filter((f) => f.ruleName === 'Hardcoded Password Assignment')).toHaveLength(0)
    expect(testFindings.filter((f) => f.ruleName === 'Insecure Random for Secret')).toHaveLength(0)
    await fs.rm(path.join(dir, 'tests'), { recursive: true, force: true })
  })

  it('includes findings with a confidence score', async () => {
    const result = await runScanner({ targetPath: dir, version: 't', persist: false })
    for (const f of result.findings) {
      expect(typeof f.confidence).toBe('number')
      expect(f.confidence).toBeGreaterThan(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('extractJson', () => {
  it('parses fenced json', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('parses json embedded in prose', () => {
    expect(extractJson('Sure! {"confirmed":true,"confidence":0.9} done')).toEqual({
      confirmed: true,
      confidence: 0.9,
    })
  })
  it('returns null when no json present', () => {
    expect(extractJson('no json here')).toBeNull()
  })
})

describe('diff rendering', () => {
  it('builds removal/addition lines and renders valid html', () => {
    const fileLines = ['a', 'const password = "x"', 'b']
    const diff = buildDiff(fileLines, 2, 1, ['const password = process.env.PW'])
    expect(diff.some((d) => d.type === 'removal')).toBe(true)
    expect(diff.some((d) => d.type === 'addition')).toBe(true)
    const html = renderDiffHtml(
      { severity: 'HIGH', ruleName: 'Hardcoded Password Assignment', file: 'a.js', line: 2, description: 'x' } as never,
      diff,
    )
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('class="addition"')
  })
})
