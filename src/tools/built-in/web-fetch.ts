/**
 * web_fetch — HTTP fetch tool for retrieving web content.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

export const webFetchTool = defineTool({
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the response body as text. Supports GET and POST.',
  inputSchema: z.object({
    url: z.string().describe('The URL to fetch'),
    method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
    headers: z.record(z.string()).optional().describe('Additional HTTP headers'),
    body: z.string().optional().describe('Request body (for POST)'),
    maxBytes: z.number().default(100000).describe('Max response size in bytes (default: 100KB)'),
  }),
  execute: async (input) => {
    // Validate URL
    let parsed: URL
    try {
      parsed = new URL(input.url)
    } catch {
      return { data: `Invalid URL: ${input.url}`, isError: true }
    }

    // Block private/internal addresses
    const hostname = parsed.hostname.toLowerCase()
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      /^169\.254\./.test(hostname)
    ) {
      return { data: `Blocked: cannot fetch private/internal addresses (${hostname})`, isError: true }
    }

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { data: `Blocked: only http/https URLs are allowed`, isError: true }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.method === 'POST' ? input.body : undefined,
        signal: controller.signal,
        redirect: 'follow',
      })

      clearTimeout(timeout)

      const contentType = response.headers.get('content-type') ?? ''
      const buffer = await response.arrayBuffer()

      const maxBytes = input.maxBytes ?? 100000
      if (buffer.byteLength > maxBytes) {
        const text = new TextDecoder().decode(buffer.slice(0, maxBytes))
        return { data: `[${response.status}] (truncated to ${maxBytes} bytes)\n${text}` }
      }

      const text = new TextDecoder().decode(buffer)
      const statusLine = `[${response.status} ${response.statusText}] ${contentType}`
      return { data: `${statusLine}\n${text}` }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `Fetch failed: ${msg}`, isError: true }
    }
  },
})
