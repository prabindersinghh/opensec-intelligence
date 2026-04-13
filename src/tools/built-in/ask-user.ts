/**
 * ask_user — prompt the user for input/confirmation mid-task.
 */

import * as readline from 'readline'
import { z } from 'zod'
import { defineTool } from '../registry.js'

export const askUserTool = defineTool({
  name: 'ask_user',
  description: 'Ask the user a question and get their response. Use when you need clarification or a decision.',
  inputSchema: z.object({
    question: z.string().describe('The question to ask the user'),
  }),
  execute: async (input) => {
    return new Promise<{ data: string }>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      })

      console.log('')
      rl.question(`  \u001b[35m?\u001b[0m ${input.question}\n  \u001b[90m>\u001b[0m `, (answer) => {
        rl.close()
        resolve({ data: answer.trim() || '(no response)' })
      })
    })
  },
})
