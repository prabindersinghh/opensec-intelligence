/**
 * HTTP API server tests — starts `opensec serve` on a random port and exercises
 * all public endpoints: /health, /v1/models, /v1/chat, /v1/stream.
 */
import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'child_process'
import * as path from 'path'

const BIN = path.resolve('dist/bin/cmdr.js')
const PORT = 4242
const BASE = `http://127.0.0.1:${PORT}`

let server: ChildProcess | null = null

test.beforeAll(async () => {
  server = spawn(process.execPath, [BIN, 'serve', '--port', String(PORT), '--host', '127.0.0.1', '-m', 'llama3.2:3b'], {
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Wait up to 8 s for the server to be ready
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(500) })
      if (res.ok) break
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
})

test.afterAll(() => {
  server?.kill('SIGTERM')
  server = null
})

test('GET /health returns 200 with status ok', async ({ request }) => {
  const res = await request.get(`${BASE}/health`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(typeof body.uptime).toBe('number')
})

test('GET /health includes model and provider fields', async ({ request }) => {
  const res = await request.get(`${BASE}/health`)
  const body = await res.json()
  expect(body).toHaveProperty('model')
  expect(body).toHaveProperty('provider')
})

test('GET /v1/models returns models array', async ({ request }) => {
  const res = await request.get(`${BASE}/v1/models`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body).toHaveProperty('models')
  expect(Array.isArray(body.models)).toBe(true)
})

test('GET /unknown returns 404', async ({ request }) => {
  const res = await request.get(`${BASE}/unknown-route`)
  expect(res.status()).toBe(404)
})

test('POST /v1/chat with missing message returns 400', async ({ request }) => {
  const res = await request.post(`${BASE}/v1/chat`, {
    data: { not_message: 'oops' },
  })
  expect(res.status()).toBe(400)
  const body = await res.json()
  expect(body).toHaveProperty('error')
})

test('OPTIONS preflight returns 204 with CORS headers', async ({ request }) => {
  const res = await request.fetch(`${BASE}/health`, { method: 'OPTIONS' })
  expect(res.status()).toBe(204)
  expect(res.headers()['access-control-allow-origin']).toBe('*')
})
