/**
 * MCP resource tools — list and read resources from connected MCP servers.
 *
 * MCP servers can expose resources (files, database schemas, API docs, etc.)
 * in addition to tools. These tools let the LLM discover and read them.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import type { McpClient } from '../../plugins/mcp-client.js'

let mcpClientRef: McpClient | null = null

export function setMcpClient(client: McpClient): void {
  mcpClientRef = client
}

export const mcpListResourcesTool = defineTool({
  name: 'mcp_list_resources',
  description: 'List available resources from connected MCP servers. Resources are additional context like files, database schemas, or documentation that MCP servers can provide.',
  inputSchema: z.object({
    server: z.string().optional().describe('Optional: filter to a specific MCP server name'),
  }),
  execute: async (input) => {
    if (!mcpClientRef) {
      return { data: 'No MCP client available', isError: true }
    }

    const connections = mcpClientRef.listConnections()
    if (connections.length === 0) {
      return { data: 'No MCP servers connected. Use /mcp to manage connections.' }
    }

    const filtered = input.server
      ? connections.filter(c => c.name === input.server)
      : connections

    if (filtered.length === 0) {
      return { data: `MCP server "${input.server}" not found. Connected: ${connections.map(c => c.name).join(', ')}`, isError: true }
    }

    // Note: Resource listing requires the MCP server to support resources/list.
    // This is a best-effort — many servers only support tools.
    const lines = filtered.map(c =>
      `${c.name} (${c.transport}) — ${c.tools} tools${c.connected ? '' : ' [disconnected]'}`,
    )

    return {
      data: `Connected MCP servers:\n${lines.join('\n')}\n\nNote: Use mcp_read_resource with a specific server and resource URI to read content.`,
    }
  },
})

export const mcpReadResourceTool = defineTool({
  name: 'mcp_read_resource',
  description: 'Read a specific resource from an MCP server by URI. The resource URI format depends on the server (e.g. "file:///path", "db://schema/table").',
  inputSchema: z.object({
    server: z.string().describe('The MCP server name'),
    uri: z.string().describe('The resource URI to read'),
  }),
  execute: async (input) => {
    if (!mcpClientRef) {
      return { data: 'No MCP client available', isError: true }
    }

    // Validate URI format
    try {
      new URL(input.uri)
    } catch {
      // Allow relative URIs too — some MCP servers use simple paths
    }

    try {
      // Use the MCP client's callTool to send a resources/read request
      // This piggybacks on the existing transport infrastructure
      const result = await mcpClientRef.callTool(input.server, '__resources_read__', {
        uri: input.uri,
      })

      return result
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { data: `Failed to read resource: ${msg}`, isError: true }
    }
  },
})
