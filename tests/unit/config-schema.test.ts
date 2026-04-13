import { describe, expect, it } from 'vitest'

import { CmdrConfigSchema } from '../../src/config/schema.js'

describe('CmdrConfigSchema MCP validation', () => {
  it('accepts stdio MCP servers with command/args', () => {
    const parsed = CmdrConfigSchema.safeParse({
      mcp: {
        servers: [
          {
            name: 'github',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'test-token' },
          },
        ],
      },
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.mcp?.servers[0]).toMatchObject({
        name: 'github',
        transport: 'stdio',
        command: 'npx',
      })
    }
  })

  it('rejects stdio MCP servers without command', () => {
    const parsed = CmdrConfigSchema.safeParse({
      mcp: {
        servers: [
          {
            name: 'broken-stdio',
            transport: 'stdio',
          },
        ],
      },
    })

    expect(parsed.success).toBe(false)
  })

  it('preserves permission pattern lists', () => {
    const parsed = CmdrConfigSchema.safeParse({
      permissions: {
        allowBash: true,
        allowFileWrite: true,
        allowNetwork: false,
        allow: ['mcp_github_*'],
        deny: ['bash(rm -rf *)'],
        ask: ['file_write(package.json)'],
      },
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.permissions?.allow).toEqual(['mcp_github_*'])
      expect(parsed.data.permissions?.deny).toEqual(['bash(rm -rf *)'])
      expect(parsed.data.permissions?.ask).toEqual(['file_write(package.json)'])
    }
  })
})
