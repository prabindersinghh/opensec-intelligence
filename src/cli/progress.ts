/**
 * Progress tracker — structured phase display for agent execution.
 *
 * Tracks lifecycle phases with compact formatted output blocks.
 *
 * Integrates with the spinner for animated state transitions.
 */

import { PURPLE, GREEN, CYAN, DIM, WHITE, RED } from './theme.js'

// ---------------------------------------------------------------------------
// Phase tracking
// ---------------------------------------------------------------------------

export type AgentPhase =
  | 'idle'
  | 'thinking'
  | 'tool_exec'
  | 'generating'
  | 'waiting_approval'
  | 'done'
  | 'error'

export interface ToolExecInfo {
  readonly name: string
  readonly startTime: number
  endTime?: number
  result?: 'success' | 'error' | 'denied'
}

export interface PhaseState {
  phase: AgentPhase
  turn: number
  totalTokens: { input: number; output: number }
  toolsExecuted: ToolExecInfo[]
  startTime: number
  thinkingStartTime?: number
  currentToolName?: string
}

// ---------------------------------------------------------------------------
// Singleton progress tracker
// ---------------------------------------------------------------------------

let state: PhaseState = {
  phase: 'idle',
  turn: 0,
  totalTokens: { input: 0, output: 0 },
  toolsExecuted: [],
  startTime: Date.now(),
}

export function resetProgress(): void {
  state = {
    phase: 'idle',
    turn: 0,
    totalTokens: { input: 0, output: 0 },
    toolsExecuted: [],
    startTime: Date.now(),
  }
}

export function getPhaseState(): Readonly<PhaseState> {
  return state
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

export function setPhase(phase: AgentPhase): void {
  state.phase = phase
  if (phase === 'thinking') {
    state.thinkingStartTime = Date.now()
  }
}

export function setTurn(turn: number): void {
  state.turn = turn
}

export function addTokens(input: number, output: number): void {
  state.totalTokens.input += input
  state.totalTokens.output += output
}

export function startToolExecution(toolName: string): void {
  state.phase = 'tool_exec'
  state.currentToolName = toolName
  state.toolsExecuted.push({
    name: toolName,
    startTime: Date.now(),
  })
}

export function endToolExecution(
  toolName: string,
  result: 'success' | 'error' | 'denied',
): void {
  const tool = [...state.toolsExecuted].reverse().find(t => t.name === toolName && !t.endTime)
  if (tool) {
    tool.endTime = Date.now()
    tool.result = result
  }
  state.currentToolName = undefined
}

// ---------------------------------------------------------------------------
// Formatting — structured output blocks
// ---------------------------------------------------------------------------

const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeLeft: '├',
  teeRight: '┤',
}

/**
 * Format a tool execution block with visual borders.
 * Matches Claude Code's structured tool output style.
 */
export function formatToolBlock(
  toolName: string,
  input: Record<string, unknown>,
  result: string,
  isError: boolean,
  durationMs: number,
): string {
  const width = Math.min(process.stdout.columns || 80, 80)
  const innerWidth = width - 4
  const headerLine = `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(2)} ${CYAN(toolName)} ${DIM(`(${durationMs}ms)`)} ${BOX_CHARS.horizontal.repeat(Math.max(0, innerWidth - toolName.length - String(durationMs).length - 8))}${BOX_CHARS.topRight}`

  const lines: string[] = [headerLine]

  // Input summary (compact)
  const inputStr = formatInputCompact(input)
  if (inputStr) {
    lines.push(`${BOX_CHARS.vertical} ${DIM('input:')} ${WHITE(truncateLine(inputStr, innerWidth - 8))} ${' '.repeat(Math.max(0, innerWidth - inputStr.length - 8))}${BOX_CHARS.vertical}`)
  }

  // Separator
  lines.push(`${BOX_CHARS.teeLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.teeRight}`)

  // Result (truncated to a few lines)
  const resultLines = result.split('\n').slice(0, 5)
  for (const line of resultLines) {
    const color = isError ? RED : GREEN
    const truncated = truncateLine(line, innerWidth - 2)
    lines.push(`${BOX_CHARS.vertical} ${color(truncated)}${' '.repeat(Math.max(0, innerWidth - truncated.length))}${BOX_CHARS.vertical}`)
  }
  if (result.split('\n').length > 5) {
    lines.push(`${BOX_CHARS.vertical} ${DIM(`... ${result.split('\n').length - 5} more lines`)}${' '.repeat(Math.max(0, innerWidth - 20))}${BOX_CHARS.vertical}`)
  }

  // Bottom border
  lines.push(`${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(width - 2)}${BOX_CHARS.bottomRight}`)

  return lines.join('\n')
}

/**
 * Format the "thinking" section header.
 */
export function formatThinkingHeader(): string {
  return `\n${PURPLE('◆')} ${PURPLE.bold('ANALYZING')} ${DIM('─'.repeat(58))}\n`
}

/**
 * Format the "generating" section header.
 */
export function formatGeneratingHeader(): string {
  return `\n${GREEN('◆')} ${GREEN.bold('RESPONDING')} ${DIM('─'.repeat(56))}\n`
}

/**
 * Format the waiting for approval section header.
 */
export function formatApprovalHeader(): string {
  return `\n${CYAN('◆')} ${CYAN.bold('WAITING FOR APPROVAL')} ${DIM('─'.repeat(45))}\n`
}

/**
 * Format a turn separator.
 */
export function formatTurnSeparator(turn: number): string {
  return `\n${DIM('─'.repeat(20))} ${PURPLE(`Turn ${turn}`)} ${DIM('─'.repeat(20))}\n`
}

/**
 * Format the session summary shown at the end of a run.
 */
export function formatSessionSummary(): string {
  const elapsed = Math.round((Date.now() - state.startTime) / 1000)
  const toolCount = state.toolsExecuted.length
  const successTools = state.toolsExecuted.filter(t => t.result === 'success').length
  const errorTools = state.toolsExecuted.filter(t => t.result === 'error').length

  const lines: string[] = [
    '',
    DIM('═'.repeat(60)),
    `${PURPLE.bold('Session Summary')}`,
    `  ${DIM('Turns:')} ${WHITE(String(state.turn))}  ${DIM('Duration:')} ${WHITE(`${elapsed}s`)}`,
    `  ${DIM('Tools:')} ${WHITE(String(toolCount))} total, ${GREEN(String(successTools))} succeeded${errorTools > 0 ? `, ${RED(String(errorTools))} failed` : ''}`,
    `  ${DIM('Tokens:')} ${WHITE(String(state.totalTokens.input))} in / ${WHITE(String(state.totalTokens.output))} out`,
    DIM('═'.repeat(60)),
    '',
  ]

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateLine(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

function formatInputCompact(input: Record<string, unknown>): string {
  const entries = Object.entries(input)
  if (entries.length === 0) return ''
  if (entries.length === 1) {
    const [key, value] = entries[0]
    const valStr = typeof value === 'string' ? value : JSON.stringify(value)
    return `${key}=${truncateLine(valStr, 60)}`
  }
  return entries.map(([k, v]) => {
    const valStr = typeof v === 'string' ? v : JSON.stringify(v)
    return `${k}=${truncateLine(valStr, 30)}`
  }).join(', ')
}
