---
name: mcp-builder
description: "Guide for building Model Context Protocol (MCP) servers and tools"
---

# MCP Server Builder

## Instructions

When the user asks you to build an MCP server, MCP tool, or integrate with the Model Context Protocol:

1. **MCP Server Structure** — an MCP server exposes tools to LLM agents via a standardized protocol
2. **Communication** — uses JSON-RPC 2.0 over stdio (default) or SSE
3. **Tools** — each tool has a name, description, and JSON Schema for parameters

## Server Template

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new Server({ name: 'my-server', version: '1.0.0' }, {
  capabilities: { tools: {} }
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'my_tool',
    description: 'Does something useful',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: 'The input' }
      },
      required: ['input']
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (name === 'my_tool') {
    return { content: [{ type: 'text', text: 'result' }] };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Best Practices

- Keep tool descriptions clear and concise
- Use strict JSON Schema validation
- Handle errors gracefully, return error content blocks
- Log to stderr (stdout is the protocol channel)
- Test tools independently before connecting via MCP
