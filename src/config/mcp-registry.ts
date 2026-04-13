/**
 * MCP Server Registry — pre-configured MCP server definitions.
 *
 * These are NOT auto-connected. Users opt in via `/mcp add <name>`.
 * Each entry describes how to launch the server and what env vars are needed.
 */

import type { McpServerConfig } from '../core/types.js'

export interface McpServerDefinition {
  /** Unique registry name */
  name: string
  /** Human-readable description */
  description: string
  /** npm package / command to run */
  command: string
  /** Default CLI args */
  args: string[]
  /** Transport type */
  transport: 'stdio' | 'http' | 'sse'
  /** Required environment variables (user must set these) */
  requiredEnv: string[]
  /** Optional environment variables */
  optionalEnv: string[]
  /** Category for organization */
  category: 'data' | 'search' | 'dev' | 'communication' | 'ai'
  /** URL for more info */
  homepage: string
}

/**
 * Top 10 MCP server definitions, ready to be activated.
 */
export const MCP_SERVER_REGISTRY: McpServerDefinition[] = [
  {
    name: 'filesystem',
    description: 'Read, write, and manage files on the local filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: [],
    category: 'dev',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    name: 'github',
    description: 'Interact with GitHub repos, issues, PRs, and code search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    transport: 'stdio',
    requiredEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    optionalEnv: [],
    category: 'dev',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    name: 'memory',
    description: 'Persistent knowledge graph memory for long-term context',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: [],
    category: 'ai',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    name: 'fetch',
    description: 'Fetch and convert web pages to markdown for LLM consumption',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: [],
    category: 'search',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    name: 'sequential-thinking',
    description: 'Dynamic chain-of-thought reasoning with branching and revision',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: [],
    category: 'ai',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
  },
  {
    name: 'brave-search',
    description: 'Web and local search via Brave Search API',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    transport: 'stdio',
    requiredEnv: ['BRAVE_API_KEY'],
    optionalEnv: [],
    category: 'search',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    name: 'playwright',
    description: 'Browser automation — navigate, click, screenshot, scrape with Playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: [],
    category: 'dev',
    homepage: 'https://github.com/microsoft/playwright-mcp',
  },
  {
    name: 'postgres',
    description: 'Query PostgreSQL databases with read-only access',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    transport: 'stdio',
    requiredEnv: ['POSTGRES_CONNECTION_STRING'],
    optionalEnv: [],
    category: 'data',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    name: 'sqlite',
    description: 'Query and analyze SQLite databases',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite'],
    transport: 'stdio',
    requiredEnv: [],
    optionalEnv: ['SQLITE_DB_PATH'],
    category: 'data',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    name: 'slack',
    description: 'Read and search Slack channels, threads, and messages',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    transport: 'stdio',
    requiredEnv: ['SLACK_BOT_TOKEN'],
    optionalEnv: ['SLACK_TEAM_ID'],
    category: 'communication',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
]

/** Look up a server definition by name. */
export function getServerDefinition(name: string): McpServerDefinition | undefined {
  return MCP_SERVER_REGISTRY.find(s => s.name === name)
}

/** List all available server names. */
export function listAvailableServers(): McpServerDefinition[] {
  return [...MCP_SERVER_REGISTRY]
}

/**
 * Convert a registry definition into an McpServerConfig for connection.
 * Resolves required env vars from process.env.
 */
export function toMcpConfig(def: McpServerDefinition, overrides?: Partial<McpServerConfig>): McpServerConfig {
  const env: Record<string, string> = {}
  for (const key of [...def.requiredEnv, ...def.optionalEnv]) {
    const val = process.env[key]
    if (val) env[key] = val
  }

  return {
    name: def.name,
    command: def.command,
    args: def.args,
    transport: def.transport,
    env,
    ...overrides,
  }
}

/**
 * Check which required env vars are missing for a server definition.
 */
export function getMissingEnvVars(def: McpServerDefinition): string[] {
  return def.requiredEnv.filter(key => !process.env[key])
}
