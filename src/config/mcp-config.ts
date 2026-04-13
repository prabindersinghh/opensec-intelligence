/**
 * MCP configuration for code-review-graph integration.
 *
 * Auto-detects if code-review-graph is installed and provides
 * configuration for the MCP server connection.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServerConfig } from '../core/types.js'

export interface GraphConfig {
  /** Maximum blast radius depth for BFS traversal. */
  maxDepth: number
  /** Maximum nodes returned from impact analysis. */
  maxNodes: number
  /** Maximum files included in graph context. */
  maxFiles: number
  /** Maximum tokens for graph context injection. */
  maxTokens: number
  /** Git ref for change detection. */
  base: string
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  maxDepth: 2,
  maxNodes: 20,
  maxFiles: 15,
  maxTokens: 2048,
  base: 'HEAD~1',
}

/**
 * Detect if code-review-graph is available on the system.
 * Checks for: uvx availability, pipx/pip install, direct command.
 */
export function detectCodeReviewGraph(): { available: boolean; command: string; args: string[] } {
  // Check if `code-review-graph` command exists directly
  try {
    execSync('which code-review-graph', { stdio: 'pipe', timeout: 5000 })
    return { available: true, command: 'code-review-graph', args: ['serve'] }
  } catch { /* not found */ }

  // Check if `uvx` is available (preferred: runs without install)
  try {
    execSync('which uvx', { stdio: 'pipe', timeout: 5000 })
    return { available: true, command: 'uvx', args: ['code-review-graph', 'serve'] }
  } catch { /* not found */ }

  return { available: false, command: '', args: [] }
}

/**
 * Check if the graph database already exists for a project.
 */
export function graphDatabaseExists(projectRoot: string): boolean {
  return existsSync(join(projectRoot, '.code-review-graph', 'graph.db'))
}

/**
 * Build an MCP server config for code-review-graph.
 */
export function buildCrgMcpConfig(
  detection: { command: string; args: string[] },
  projectRoot: string,
): McpServerConfig {
  return {
    name: 'crg',
    transport: 'stdio',
    command: detection.command,
    args: detection.args,
    env: { CRG_REPO_ROOT: projectRoot },
    cwd: projectRoot,
  }
}
