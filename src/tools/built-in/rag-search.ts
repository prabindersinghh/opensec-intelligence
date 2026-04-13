/**
 * rag_search — semantic search over indexed project documents.
 *
 * Requires prior indexing via /index command.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'
import { IndexManager } from '../../memory/index-manager.js'

// Singleton IndexManager — set at startup by the REPL
let indexManager: IndexManager | null = null

export function setIndexManager(manager: IndexManager): void {
  indexManager = manager
}

export const ragSearchTool = defineTool({
  name: 'rag_search',
  description: 'Search indexed project documents using semantic similarity. Returns the most relevant code chunks for a given query. Use /index to build the index first.',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    topK: z.number().default(5).describe('Number of results to return (default: 5)'),
  }),
  execute: async (input) => {
    if (!indexManager) {
      return { data: 'Index not initialized. Use /index <path> to index files first.', isError: true }
    }

    try {
      const results = await indexManager.search(input.query, input.topK)
      if (results.length === 0) {
        return { data: 'No results found. Make sure files are indexed with /index.' }
      }

      const output = results.map((r, i) =>
        `[${i + 1}] ${r.file}:${r.startLine}-${r.endLine} (score: ${r.score.toFixed(3)})\n${r.text.slice(0, 500)}`
      ).join('\n\n---\n\n')

      return { data: output }
    } catch (err) {
      return { data: `Search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
  },
})
