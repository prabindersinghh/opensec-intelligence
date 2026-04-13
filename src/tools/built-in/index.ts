/**
 * Built-in tool collection — register all tools at once.
 */

import type { ToolDefinition } from '../../core/types.js'
import { ToolRegistry } from '../registry.js'
import { bashTool } from './bash.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { fileEditTool } from './file-edit.js'
import { grepTool } from './grep.js'
import { globTool } from './glob.js'
import { gitDiffTool } from './git-diff.js'
import { gitLogTool } from './git-log.js'
import { gitCommitTool, gitBranchTool } from './git-commit.js'
import { gitWorktreeTool } from './git-worktree.js'
import { thinkTool } from './think.js'
import { webFetchTool } from './web-fetch.js'
import { webSearchTool } from './web-search.js'
import { askUserTool } from './ask-user.js'
import { memoryReadTool, memoryWriteTool } from './memory.js'
import { lspDiagnosticsTool } from './diagnostics.js'
import { notebookReadTool, notebookEditTool, notebookRunTool } from './notebook.js'
import { todoWriteTool } from './todo-tool.js'
import { taskCreateTool, taskListTool, taskGetTool, taskStopTool } from './task-tools.js'
import { cronCreateTool, cronListTool, cronDeleteTool } from './cron-tools.js'
import { enterPlanModeTool, exitPlanModeTool } from './plan-tools.js'
import { mcpListResourcesTool, mcpReadResourceTool } from './mcp-resource-tools.js'
import { graphImpactTool, graphQueryTool, graphReviewTool } from './graph-tools.js'
import { pdfReportTool } from './pdf-report.js'
import { ragSearchTool } from './rag-search.js'
import { BROWSER_TOOLS, isPlaywrightAvailable } from './browser.js'

export {
  bashTool, fileReadTool, fileWriteTool, fileEditTool,
  grepTool, globTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
  gitWorktreeTool, lspDiagnosticsTool,
  notebookReadTool, notebookEditTool, notebookRunTool,
  thinkTool, webFetchTool, webSearchTool, askUserTool, memoryReadTool, memoryWriteTool,
  todoWriteTool,
  taskCreateTool, taskListTool, taskGetTool, taskStopTool,
  cronCreateTool, cronListTool, cronDeleteTool,
  enterPlanModeTool, exitPlanModeTool,
  mcpListResourcesTool, mcpReadResourceTool,
  graphImpactTool, graphQueryTool, graphReviewTool,
  pdfReportTool,
  ragSearchTool,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BUILT_IN_TOOLS: ToolDefinition<any>[] = [
  bashTool, fileReadTool, fileWriteTool, fileEditTool,
  grepTool, globTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool,
  gitWorktreeTool, lspDiagnosticsTool,
  notebookReadTool, notebookEditTool, notebookRunTool,
  thinkTool, webFetchTool, webSearchTool, askUserTool, memoryReadTool, memoryWriteTool,
  todoWriteTool,
  taskCreateTool, taskListTool, taskGetTool, taskStopTool,
  cronCreateTool, cronListTool, cronDeleteTool,
  enterPlanModeTool, exitPlanModeTool,
  mcpListResourcesTool, mcpReadResourceTool,
  graphImpactTool, graphQueryTool, graphReviewTool,
  pdfReportTool,
  ragSearchTool,
]

export function registerBuiltInTools(registry: ToolRegistry): void {
  for (const tool of BUILT_IN_TOOLS) {
    if (!registry.has(tool.name)) {
      registry.register(tool)
    }
  }
}

/**
 * Register browser automation tools (requires --browser flag and playwright-core).
 * Call this separately after registerBuiltInTools when browser mode is enabled.
 */
export async function registerBrowserTools(registry: ToolRegistry): Promise<boolean> {
  const available = await isPlaywrightAvailable()
  if (!available) return false
  for (const tool of BROWSER_TOOLS) {
    if (!registry.has(tool.name)) {
      registry.register(tool)
    }
  }
  return true
}
