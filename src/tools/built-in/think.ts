/**
 * Built-in think tool — extended thinking scratchpad with no side effects.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

export const thinkTool = defineTool({
  name: 'think',
  description:
    'Use this tool to think through complex problems step by step. ' +
    'Has no side effects — purely a reasoning scratchpad. ' +
    'Use before making important decisions or complex code changes.',

  inputSchema: z.object({
    thought: z.string().describe('Your step-by-step reasoning.'),
  }),

  execute: async (input) => {
    return { data: `Thought recorded: ${input.thought.slice(0, 100)}...` }
  },
})
