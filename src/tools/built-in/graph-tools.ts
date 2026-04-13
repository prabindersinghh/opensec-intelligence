/**
 * Graph tools — curated wrappers around code-review-graph MCP tools.
 *
 * Three tools exposed to the LLM:
 *  - graph_impact: blast radius analysis
 *  - graph_query: dependency queries (callers, callees, imports, tests)
 *  - graph_review: risk-scored review context
 *
 * These are for deep analysis mid-reasoning. Initial grounding is handled
 * by GraphContextProvider's context injection — no duplication.
 *
 * All three are read-only and added to SAFE_PARALLEL_TOOLS.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import type { ToolResult, ToolUseContext } from '../../core/types.js'
import type { McpClient } from '../../plugins/mcp-client.js'

// Module-level reference — set during startup
let _mcpClient: McpClient | null = null
let _graphAvailable = false
let _projectRoot = ''

export function setGraphToolsClient(client: McpClient, projectRoot: string): void {
  _mcpClient = client
  _projectRoot = projectRoot
  _graphAvailable = true
}

export function setGraphToolsAvailable(available: boolean): void {
  _graphAvailable = available
}

async function callCrg(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
  if (!_graphAvailable || !_mcpClient) {
    return {
      data: 'Code review graph is not available. Install it with: pip install code-review-graph\nThen restart cmdr. Falling back to grep/file_read for code exploration.',
      isError: true,
    }
  }
  return _mcpClient.callTool('crg', toolName, input)
}

// ---------------------------------------------------------------------------
// graph_impact — blast radius analysis
// ---------------------------------------------------------------------------

export const graphImpactTool = defineTool({
  name: 'graph_impact',
  description: `Analyze the blast radius of changed files using the code knowledge graph. Shows which functions, classes, and files are impacted by changes. Use this for understanding the scope of modifications before or after editing code. Returns impacted files, affected nodes, and dependency chains.`,
  inputSchema: z.object({
    changed_files: z.array(z.string()).optional().describe('File paths to analyze. Auto-detects from git diff if omitted.'),
    max_depth: z.number().optional().describe('BFS traversal depth in dependency graph. Default: 2.'),
    base: z.string().optional().describe('Git ref for change detection. Default: HEAD~1.'),
  }),
  async execute(input, _context: ToolUseContext): Promise<ToolResult> {
    const params: Record<string, unknown> = {
      repo_root: _projectRoot,
      max_depth: input.max_depth ?? 2,
      base: input.base ?? 'HEAD~1',
    }
    if (input.changed_files) params.changed_files = input.changed_files
    return callCrg('get_impact_radius_tool', params)
  },
})

// ---------------------------------------------------------------------------
// graph_query — dependency queries
// ---------------------------------------------------------------------------

export const graphQueryTool = defineTool({
  name: 'graph_query',
  description: `Query the code knowledge graph for structural relationships. Patterns: callers_of (find who calls a function), callees_of (find what a function calls), imports_of (what a file imports), importers_of (who imports a file), children_of (nodes in a file/class), tests_for (tests for a target), inheritors_of (subclasses), file_summary (all nodes in a file).`,
  inputSchema: z.object({
    pattern: z.enum([
      'callers_of', 'callees_of', 'imports_of', 'importers_of',
      'children_of', 'tests_for', 'inheritors_of', 'file_summary',
    ]).describe('Query pattern to run.'),
    target: z.string().describe('Node name, qualified name, or file path to query.'),
  }),
  async execute(input, _context: ToolUseContext): Promise<ToolResult> {
    return callCrg('query_graph_tool', {
      pattern: input.pattern,
      target: input.target,
      repo_root: _projectRoot,
    })
  },
})

// ---------------------------------------------------------------------------
// graph_review — risk-scored review context
// ---------------------------------------------------------------------------

export const graphReviewTool = defineTool({
  name: 'graph_review',
  description: `Generate a risk-scored code review using the knowledge graph. Maps git diffs to affected functions, execution flows, communities, and test coverage gaps. Returns prioritized review items with risk levels. Use this for comprehensive code reviews instead of manually reading all changed files.`,
  inputSchema: z.object({
    base: z.string().optional().describe('Git ref to diff against. Default: HEAD~1.'),
    changed_files: z.array(z.string()).optional().describe('Files to review. Auto-detected from git diff if omitted.'),
    include_source: z.boolean().optional().describe('Include source code snippets. Default: false.'),
  }),
  async execute(input, _context: ToolUseContext): Promise<ToolResult> {
    const params: Record<string, unknown> = {
      base: input.base ?? 'HEAD~1',
      repo_root: _projectRoot,
      include_source: input.include_source ?? false,
      max_depth: 2,
    }
    if (input.changed_files) params.changed_files = input.changed_files
    return callCrg('detect_changes_tool', params)
  },
})
