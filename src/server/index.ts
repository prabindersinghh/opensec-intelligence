/**
 * cmdr serve — HTTP/SSE server exposing the agent API.
 *
 * Endpoints:
 *   POST /v1/chat     — JSON request/response
 *   POST /v1/stream   — SSE streaming response
 *   GET  /health      — health check
 *   GET  /v1/models   — list available models
 *
 * Uses Node.js built-in http module (no Express).
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Agent } from '../core/agent.js'
import { OllamaAdapter } from '../llm/ollama.js'
import { createAdapter, type ProviderName } from '../llm/provider-factory.js'
import { ToolRegistry } from '../tools/registry.js'
import { registerBuiltInTools } from '../tools/built-in/index.js'
import { PermissionManager } from '../core/permissions.js'
import { SOLO_CODER } from '../core/presets.js'
import { discoverProject } from '../session/project-context.js'
import { buildSystemPrompt } from '../session/prompt-builder.js'
import { discoverOllamaModels } from '../llm/model-registry.js'
import { MemoryManager } from '../memory/memory-manager.js'
import type { ToolUseBlock, ToolResultBlock } from '../core/types.js'

export interface ServeOptions {
  port: number
  host: string
  model: string
  ollamaUrl: string
  provider?: string
}

/** Read request body as JSON, with a size limit. */
async function readBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        req.destroy()
        reject(new Error('Request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message })
}

/** Set CORS headers for development use. */
function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export async function startServer(options: ServeOptions): Promise<void> {
  const cwd = process.cwd()

  // Resolve provider
  const provider: ProviderName = (options.provider as ProviderName) ?? 'ollama'
  const adapter = createAdapter({ provider, ollamaUrl: options.ollamaUrl })

  // Discover project context
  const projectContext = await discoverProject(cwd)

  // Memory
  const memoryManager = new MemoryManager(cwd)
  const memoryPrompt = await memoryManager.getMemoryPrompt()

  // System prompt
  const systemPrompt = buildSystemPrompt({
    basePrompt: SOLO_CODER.systemPrompt!,
    projectContext,
    model: options.model,
    memoryPrompt: memoryPrompt || undefined,
  })

  // Tools
  const toolRegistry = new ToolRegistry()
  registerBuiltInTools(toolRegistry)

  // Permission manager (yolo for server mode — approvals aren't interactive)
  const permissionManager = new PermissionManager('yolo')

  // Discover models for Ollama
  if (provider === 'ollama') {
    const ollamaAdapter = adapter as OllamaAdapter
    const healthy = await ollamaAdapter.healthCheck()
    if (!healthy) {
      console.error(`Cannot connect to Ollama at ${options.ollamaUrl}`)
      process.exit(1)
    }
    await discoverOllamaModels(options.ollamaUrl)
  }

  /** Create a fresh agent for each request. */
  function createAgent(model: string): Agent {
    const allowedToolNames = Array.from(new Set([
      ...(SOLO_CODER.tools ?? []),
      ...toolRegistry.list().map(t => t.name),
    ]))

    return new Agent(
      {
        ...SOLO_CODER,
        model,
        systemPrompt,
        tools: allowedToolNames,
      },
      adapter,
      toolRegistry,
      cwd,
      permissionManager,
    )
  }

  const server = createServer(async (req, res) => {
    setCorsHeaders(res)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = req.url ?? '/'

    try {
      // GET /health
      if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, {
          status: 'ok',
          model: options.model,
          provider,
          uptime: process.uptime(),
        })
        return
      }

      // GET /v1/models
      if (req.method === 'GET' && url === '/v1/models') {
        if (provider === 'ollama') {
          const ollamaAdapter = adapter as OllamaAdapter
          const models = await ollamaAdapter.listModels()
          sendJson(res, 200, { models })
        } else {
          sendJson(res, 200, { models: [options.model] })
        }
        return
      }

      // POST /v1/chat — non-streaming chat
      if (req.method === 'POST' && url === '/v1/chat') {
        const body = await readBody(req) as { message: string; model?: string }
        if (!body?.message) {
          sendError(res, 400, 'Missing "message" field')
          return
        }

        const model = body.model ?? options.model
        const agent = createAgent(model)
        const startTime = Date.now()
        const toolsCalled: { name: string; duration_ms: number }[] = []
        let currentToolStart = 0
        let currentToolName = ''
        let fullOutput = ''

        for await (const event of agent.stream(body.message)) {
          switch (event.type) {
            case 'text':
              fullOutput += event.data as string
              break
            case 'tool_use': {
              const block = event.data as ToolUseBlock
              currentToolName = block.name
              currentToolStart = Date.now()
              break
            }
            case 'tool_result': {
              toolsCalled.push({ name: currentToolName, duration_ms: Date.now() - currentToolStart })
              currentToolName = ''
              break
            }
          }
        }

        const state = agent.getState()
        const tokens = state.tokenUsage

        sendJson(res, 200, {
          model,
          response: fullOutput,
          tools_called: toolsCalled,
          tokens: { input: tokens.input_tokens, output: tokens.output_tokens },
          duration_ms: Date.now() - startTime,
        })
        return
      }

      // POST /v1/stream — SSE streaming
      if (req.method === 'POST' && url === '/v1/stream') {
        const body = await readBody(req) as { message: string; model?: string }
        if (!body?.message) {
          sendError(res, 400, 'Missing "message" field')
          return
        }

        const model = body.model ?? options.model
        const agent = createAgent(model)
        const startTime = Date.now()
        const toolsCalled: { name: string; duration_ms: number }[] = []
        let currentToolStart = 0
        let currentToolName = ''

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })

        const sendEvent = (data: Record<string, unknown>) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        try {
          for await (const event of agent.stream(body.message)) {
            switch (event.type) {
              case 'text':
                sendEvent({ type: 'text', data: event.data, timestamp: Date.now() })
                break
              case 'tool_use': {
                const block = event.data as ToolUseBlock
                currentToolName = block.name
                currentToolStart = Date.now()
                sendEvent({ type: 'tool_use', tool: block.name, input: block.input, timestamp: Date.now() })
                break
              }
              case 'tool_result': {
                const block = event.data as ToolResultBlock
                const duration_ms = Date.now() - currentToolStart
                toolsCalled.push({ name: currentToolName, duration_ms })
                sendEvent({ type: 'tool_result', tool: currentToolName, output: block.content, is_error: block.is_error, duration_ms, timestamp: Date.now() })
                currentToolName = ''
                break
              }
              case 'error': {
                const err = event.data as Error
                sendEvent({ type: 'error', message: err.message, timestamp: Date.now() })
                break
              }
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          sendEvent({ type: 'error', message: msg, timestamp: Date.now() })
        }

        const state = agent.getState()
        const tokens = state.tokenUsage
        sendEvent({
          type: 'done',
          tokens: { input: tokens.input_tokens, output: tokens.output_tokens },
          duration_ms: Date.now() - startTime,
        })
        res.end()
        return
      }

      // 404 for anything else
      sendError(res, 404, `Not found: ${url}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[opensec serve] Error:`, msg)
      if (!res.headersSent) {
        sendError(res, 500, msg)
      }
    }
  })

  server.listen(options.port, options.host, () => {
    console.log(`opensec serve running on http://${options.host}:${options.port}`)
    console.log(`  Model:    ${options.model}`)
    console.log(`  Provider: ${provider}`)
    console.log(`  Endpoints:`)
    console.log(`    GET  /health      — health check`)
    console.log(`    GET  /v1/models   — list models`)
    console.log(`    POST /v1/chat     — JSON chat`)
    console.log(`    POST /v1/stream   — SSE streaming`)
  })

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down opensec serve...')
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
