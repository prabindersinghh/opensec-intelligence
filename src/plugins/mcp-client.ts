/**
 * MCP Client — connects to external Model Context Protocol servers for tool expansion.
 *
 * Supports multiple transports:
 *  - HTTP REST: GET /tools, POST /tools/{name}
 *  - stdio: Spawn a child process, communicate via JSON-RPC over stdin/stdout
 *  - SSE: Server-Sent Events for streaming tool discovery and execution
 */

import type { McpServerConfig, ToolDefinition, ToolResult, ToolUseContext } from '../core/types.js'
import type { ToolRegistry } from '../tools/registry.js'
import { z } from 'zod'
import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

interface McpConnection {
  config: McpServerConfig
  tools: McpTool[]
  connected: boolean
  transport: 'http' | 'stdio' | 'sse'
  process?: ChildProcess
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers for stdio transport
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

let rpcIdCounter = 0

export class McpClient {
  private connections = new Map<string, McpConnection>()

  /** Connect to an MCP server. Auto-detects transport from config. */
  async connect(config: McpServerConfig): Promise<McpTool[]> {
    const transport = config.transport ?? (config.command ? 'stdio' : 'http')

    switch (transport) {
      case 'stdio': return this.connectStdio(config)
      case 'sse': return this.connectSse(config)
      default: return this.connectHttp(config)
    }
  }

  // ─── HTTP REST transport ────────────────────────────────────

  private async connectHttp(config: McpServerConfig): Promise<McpTool[]> {
    const url = config.url!.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

    const response = await fetch(`${url}/tools`, { headers })
    if (!response.ok) {
      throw new Error(`MCP server returned ${response.status}: ${response.statusText}`)
    }
    const data = await response.json() as { tools?: McpTool[] }
    const tools = data.tools ?? []

    this.connections.set(config.name, { config, tools, connected: true, transport: 'http' })
    return tools
  }

  private async callToolHttp(conn: McpConnection, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const url = conn.config.url!.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (conn.config.apiKey) headers['Authorization'] = `Bearer ${conn.config.apiKey}`

    const response = await fetch(`${url}/tools/${toolName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ input }),
    })

    if (!response.ok) {
      const text = await response.text()
      return { data: `MCP tool error (${response.status}): ${text}`, isError: true }
    }

    const data = await response.json() as { result?: string; error?: string }
    if (data.error) return { data: data.error, isError: true }
    return { data: data.result ?? JSON.stringify(data) }
  }

  // ─── stdio transport ────────────────────────────────────────

  private async connectStdio(config: McpServerConfig): Promise<McpTool[]> {
    if (!config.command) throw new Error(`stdio transport requires "command" in MCP config for "${config.name}"`)

    const args = config.args ?? []
    const child = spawn(config.command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
      cwd: config.cwd,
    })

    // Initialize: send JSON-RPC initialize + tools/list
    const tools = await new Promise<McpTool[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`stdio MCP server "${config.name}" timed out during init`)), 15_000)

      const rl = createInterface({ input: child.stdout! })
      const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

      rl.on('line', (line) => {
        try {
          const msg = JSON.parse(line) as JsonRpcResponse
          const handler = pending.get(msg.id)
          if (handler) {
            pending.delete(msg.id)
            if (msg.error) handler.reject(new Error(msg.error.message))
            else handler.resolve(msg.result)
          }
        } catch { /* ignore non-JSON lines */ }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`Failed to spawn MCP server "${config.name}": ${err.message}`))
      })

      const sendRpc = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
        const id = ++rpcIdCounter
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej })
          const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
          child.stdin!.write(JSON.stringify(req) + '\n')
        })
      }

      // Step 1: Initialize
      sendRpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'cmdr', version: '2.2.0' },
      }).then(() => {
        // Step 2: Send initialized notification (no response expected)
        child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
        // Step 3: List tools
        return sendRpc('tools/list', {})
      }).then((result) => {
        clearTimeout(timeout)
        const toolsResult = result as { tools?: McpTool[] }
        resolve(toolsResult.tools ?? [])
      }).catch((err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    this.connections.set(config.name, { config, tools, connected: true, transport: 'stdio', process: child })
    return tools
  }

  private async callToolStdio(conn: McpConnection, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const child = conn.process
    if (!child || !child.stdin || !child.stdout) {
      return { data: `stdio MCP server "${conn.config.name}" not running`, isError: true }
    }

    return new Promise((resolve) => {
      const id = ++rpcIdCounter
      const timeout = setTimeout(() => {
        resolve({ data: `MCP tool call timed out after 60s`, isError: true })
      }, 60_000)

      const rl = createInterface({ input: child.stdout! })
      const onLine = (line: string) => {
        try {
          const msg = JSON.parse(line) as JsonRpcResponse
          if (msg.id === id) {
            clearTimeout(timeout)
            rl.removeListener('line', onLine)
            rl.close()
            if (msg.error) {
              resolve({ data: msg.error.message, isError: true })
            } else {
              const result = msg.result as { content?: Array<{ text?: string }>; isError?: boolean }
              const text = result?.content?.map(c => c.text ?? '').join('') ?? JSON.stringify(result)
              resolve({ data: text, isError: result?.isError })
            }
          }
        } catch { /* ignore */ }
      }
      rl.on('line', onLine)

      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: input } }
      child.stdin!.write(JSON.stringify(req) + '\n')
    })
  }

  // ─── SSE transport ──────────────────────────────────────────

  private async connectSse(config: McpServerConfig): Promise<McpTool[]> {
    const url = config.url!.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

    // SSE endpoint for tool listing
    const response = await fetch(`${url}/sse/tools`, { headers })
    if (!response.ok) throw new Error(`SSE MCP server returned ${response.status}`)

    const text = await response.text()
    // Parse SSE data lines
    const tools: McpTool[] = []
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6))
          if (data.tools) tools.push(...data.tools)
          else if (data.name) tools.push(data)
        } catch { /* skip malformed */ }
      }
    }

    // Fallback: try regular JSON if SSE parsing yields nothing
    if (tools.length === 0) {
      try {
        const jsonData = JSON.parse(text) as { tools?: McpTool[] }
        if (jsonData.tools) tools.push(...jsonData.tools)
      } catch { /* not JSON either */ }
    }

    this.connections.set(config.name, { config, tools, connected: true, transport: 'sse' })
    return tools
  }

  private async callToolSse(conn: McpConnection, toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    // SSE tool calls use POST, response may be SSE stream
    return this.callToolHttp(conn, toolName, input)
  }

  /** Disconnect from an MCP server. */
  disconnect(name: string): boolean {
    const conn = this.connections.get(name)
    if (!conn) return false
    // Kill stdio child process if running
    if (conn.process) {
      try { conn.process.kill() } catch { /* ignore */ }
    }
    return this.connections.delete(name)
  }

  /** List connected MCP servers. */
  listConnections(): Array<{ name: string; url: string | undefined; tools: number; connected: boolean; transport: string }> {
    return Array.from(this.connections.values()).map(c => ({
      name: c.config.name,
      url: c.config.url,
      tools: c.tools.length,
      connected: c.connected,
      transport: c.transport,
    }))
  }

  /** Call a tool on an MCP server. Dispatches to the appropriate transport. */
  async callTool(
    serverName: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const conn = this.connections.get(serverName)
    if (!conn) throw new Error(`Not connected to MCP server "${serverName}"`)

    try {
      switch (conn.transport) {
        case 'stdio': return await this.callToolStdio(conn, toolName, input)
        case 'sse': return await this.callToolSse(conn, toolName, input)
        default: return await this.callToolHttp(conn, toolName, input)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `MCP call failed: ${msg}`, isError: true }
    }
  }

  /**
   * Register all tools from connected MCP servers into a ToolRegistry.
   * Tools are prefixed with `mcp_{serverName}_` to avoid collisions.
   */
  registerTools(registry: ToolRegistry): number {
    let count = 0

    for (const [serverName, conn] of this.connections) {
      for (const mcpTool of conn.tools) {
        const toolName = `mcp_${serverName}_${mcpTool.name}`
        const client = this

        const tool: ToolDefinition = {
          name: toolName,
          description: `[MCP:${serverName}] ${mcpTool.description}`,
          inputSchema: z.record(z.unknown()),
          async execute(input: Record<string, unknown>, _context: ToolUseContext): Promise<ToolResult> {
            return client.callTool(serverName, mcpTool.name, input)
          },
        }

        registry.register(tool)
        count++
      }
    }

    return count
  }

  /** Check if any servers are connected. */
  get hasConnections(): boolean {
    return this.connections.size > 0
  }
}
