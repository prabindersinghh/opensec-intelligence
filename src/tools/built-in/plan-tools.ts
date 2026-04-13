/**
 * Plan mode tools — allow the LLM to self-manage planning vs execution mode.
 *
 * When in plan mode, the LLM should describe its approach before executing.
 * These tools let the LLM switch modes programmatically.
 */

import { z } from 'zod'
import { defineTool } from '../registry.js'

// Global plan mode state — can also be set by /plan command
let planModeActive = false

export function isPlanMode(): boolean {
  return planModeActive
}

export function setPlanMode(active: boolean): void {
  planModeActive = active
}

export const enterPlanModeTool = defineTool({
  name: 'enter_plan_mode',
  description: 'Switch to plan mode. In plan mode, describe your approach and reasoning before executing any tools. Use this when the task is complex and would benefit from planning first.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Why you are entering plan mode'),
  }),
  execute: async (input) => {
    planModeActive = true
    const reason = input.reason ? ` Reason: ${input.reason}` : ''
    return {
      data: `Plan mode activated.${reason}\n\nYou are now in plan mode. Describe your approach step-by-step before executing. Use exit_plan_mode when ready to execute.`,
    }
  },
})

export const exitPlanModeTool = defineTool({
  name: 'exit_plan_mode',
  description: 'Exit plan mode and return to execution mode. Use this after you have laid out your plan and are ready to start implementing.',
  inputSchema: z.object({}),
  execute: async () => {
    planModeActive = false
    return {
      data: 'Plan mode deactivated. You are now in execution mode. Proceed with implementing your plan.',
    }
  },
})
