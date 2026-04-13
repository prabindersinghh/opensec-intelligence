/**
 * cmdr theme — Industrial Terminal aesthetic.
 *
 * This module centralizes all color and styling constants for the TUI.
 * Colors now derive from the active CmdrTheme when possible.
 */

import chalk, { type ChalkInstance } from 'chalk'
import { getActiveTheme } from './themes.js'

// ---------------------------------------------------------------------------
// Core palette — theme-aware getters with fallback constants
// ---------------------------------------------------------------------------

/** Primary action accent (prompt/user) */
export const GREEN = chalk.hex('#7CFF5B')
/** Border/separator ink */
export const GREEN_DIM = chalk.hex('#314656')
/** Assistant/responding accent */
export const PURPLE = chalk.hex('#2DD4BF')
/** Secondary accent */
export const PURPLE_DIM = chalk.hex('#22D3EE')
/** Tool execution accent */
export const CYAN = chalk.hex('#F59E0B')
/** Muted tool accent */
export const CYAN_DIM = chalk.hex('#8A6A36')
/** Warning */
export const YELLOW = chalk.hex('#FBBF24')
/** Error */
export const RED = chalk.hex('#FF5D5D')
/** Primary text */
export const WHITE = chalk.hex('#D5DEE6')
/** Secondary text */
export const DIM = chalk.hex('#72808F')
/** Emphasis text */
export const BRIGHT = chalk.hex('#F2F7FB')

// Theme-aware color accessors (re-evaluated on each call)
export function themeGreen(): ChalkInstance { return chalk.hex(getActiveTheme().ui.prompt) }
export function themePurple(): ChalkInstance { return chalk.hex(getActiveTheme().text.accent) }
export function themeCyan(): ChalkInstance { return chalk.hex(getActiveTheme().message.system) }
export function themeSuccess(): ChalkInstance { return chalk.hex(getActiveTheme().status.success) }
export function themeError(): ChalkInstance { return chalk.hex(getActiveTheme().status.error) }
export function themeWarning(): ChalkInstance { return chalk.hex(getActiveTheme().status.warning) }
export function themeInfo(): ChalkInstance { return chalk.hex(getActiveTheme().status.info) }
export function themeMuted(): ChalkInstance { return chalk.hex(getActiveTheme().text.secondary) }

// ---------------------------------------------------------------------------
// Semantic styles
// ---------------------------------------------------------------------------

/** User input prompt arrow and text */
export const userPrompt = GREEN.bold
/** AI/assistant response text */
export const assistantText = PURPLE
/** Tool execution labels */
export const toolLabel = CYAN
/** Tool output */
export const toolOutput = WHITE
/** Error messages */
export const errorText = RED.bold
/** Warning messages */
export const warnText = YELLOW
/** Success messages */
export const successText = GREEN
/** Metadata / dim info */
export const dimText = DIM
/** Bold heading */
export const heading = BRIGHT.bold
/** Code/monospace text */
export const codeText = chalk.hex('#7CFF5B')
/** Slash command */
export const commandText = PURPLE_DIM

// ---------------------------------------------------------------------------
// Box drawing characters for panels
// ---------------------------------------------------------------------------

export const BOX = {
  topLeft: GREEN_DIM('╭'),
  topRight: GREEN_DIM('╮'),
  bottomLeft: GREEN_DIM('╰'),
  bottomRight: GREEN_DIM('╯'),
  horizontal: GREEN_DIM('─'),
  vertical: GREEN_DIM('│'),
  separator: GREEN_DIM('├'),
  separatorRight: GREEN_DIM('┤'),
} as const

// ---------------------------------------------------------------------------
// Decorative elements
// ---------------------------------------------------------------------------

/** The prompt symbol */
export const PROMPT_SYMBOL = GREEN.bold('❯ ')
/** Tool execution indicator */
export const TOOL_SYMBOL = CYAN('⚡')
/** Thinking indicator */
export const THINK_SYMBOL = PURPLE('◆')
/** Success indicator */
export const SUCCESS_SYMBOL = GREEN('✓')
/** Error indicator */
export const ERROR_SYMBOL = RED('✗')
/** Info indicator */
export const INFO_SYMBOL = PURPLE_DIM('ℹ')
/** Separator line */
export const SEPARATOR = GREEN_DIM('─'.repeat(60))

// ---------------------------------------------------------------------------
// Tool lifecycle indicators
// ---------------------------------------------------------------------------

/** Tool queued / pending */
export const TOOL_PENDING = DIM('◌')
/** Tool currently executing */
export const TOOL_EXECUTING = YELLOW('⟳')
/** Tool completed successfully */
export const TOOL_SUCCESS = GREEN('✓')
/** Tool failed with error */
export const TOOL_ERROR = RED('✗')
/** Tool was cancelled */
export const TOOL_CANCELLED = DIM('⊘')

// ---------------------------------------------------------------------------
// ASCII art banner
// ---------------------------------------------------------------------------

const CMDR_LOGO_LARGE = [
  ' ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗ ',
  '██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔════╝ ',
  '██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║      ',
  '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗ ██║╚════██║██╔══╝  ██║      ',
  '╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗ ',
  ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝ ',
]

const CMDR_LOGO_COMPACT = [
  '██╗  █████╗  █████╗ ██╗  █████╗  █████╗ ',
  '██║ ██╔══██╗██╔══██╗██║ ██╔══██╗██╔══██╗',
  '██║ ██║  ██║███████║██║ ██║  ██║██║  ██║',
  '██║ ██║  ██║██╔══██║██║ ██║  ██║██║  ██║',
  '██████╗╚█████╔╝██║  ██║██████╗╚█████╔╝╚█████╔╝',
]

const CMDR_LOGO_TINY = [
  '█▀█ █▀█ █▀█▀█ █▀█ █▀█▀█ █▀█▀█ █▀█',
  '█▄▀ █▄█ █  █ █▄█ █  █ █  █ █▄█',
]

const LOGO_GRADIENT_HEX = [
  '#7CFF5B',
  '#57C43F',
  '#2E6622',
  '#0D0D0D',
  '#3C0D0D',
  '#972525',
  '#FF5D5D',
]

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
}

function visibleWidth(value: string): number {
  return stripAnsi(value).length
}

function truncatePlain(value: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (value.length <= maxWidth) return value
  if (maxWidth === 1) return '…'
  return `${value.slice(0, maxWidth - 1)}…`
}

function padAnsi(value: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(value))
  return value + ' '.repeat(padding)
}

function fitAnsi(value: string, width: number): string {
  const truncated = visibleWidth(value) > width
    ? truncatePlain(stripAnsi(value), width)
    : value
  return padAnsi(truncated, width)
}

function getLogoForWidth(width: number): string[] {
  if (width >= 70) return CMDR_LOGO_LARGE
  if (width >= 50) return CMDR_LOGO_COMPACT
  return CMDR_LOGO_TINY
}

function colorizeLineGradient(line: string): string {
  const chars = Array.from(line)
  const maxIndex = Math.max(1, chars.length - 1)

  return chars.map((char, idx) => {
    if (/\s/.test(char)) return char
    const gradientIndex = Math.round((idx / maxIndex) * (LOGO_GRADIENT_HEX.length - 1))
    return chalk.hex(LOGO_GRADIENT_HEX[gradientIndex]).bold(char)
  }).join('')
}

function colorizeLogo(logoLines: string[]): string[] {
  return logoLines.map((line) => colorizeLineGradient(line))
}

export function renderBanner(): string {
  const width = Math.min(process.stdout.columns || 100, 120)
  const logo = colorizeLogo(getLogoForWidth(width))
  return ['', ...logo, ''].join('\n')
}

// ---------------------------------------------------------------------------
// Advanced two-panel welcome screen
// ---------------------------------------------------------------------------

export interface WelcomeOptions {
  model: string
  projectInfo: string
  version?: string
  gitBranch?: string
  permissionMode?: string
  teamName?: string
  teamAgentCount?: number
  cmdrMdLines?: number
  agentCount?: number
  customCmdCount?: number
  pluginCount?: number
  mcpServerCount?: number
  resumedSession?: string
  cwd?: string
  provider?: string
}

export function renderWelcome(model: string, _projectInfo: string, version = '0.0.0', opts?: WelcomeOptions): string {
  const terminalWidth = Math.max(42, Math.min(process.stdout.columns || 100, 120))
  const logoLines = colorizeLogo(getLogoForWidth(terminalWidth))
  const sep = DIM('─'.repeat(Math.max(22, Math.min(41, terminalWidth - 6))))

  const lines: string[] = ['']

  // ASCII logo
  for (const logoLine of logoLines) {
    lines.push(`  ${logoLine}`)
  }

  lines.push('')
  lines.push(`  ${WHITE.bold('OpenSec Intelligence')}  ${DIM(`v${version}`)}`)
  lines.push('')
  lines.push(`  ${PURPLE.bold('By Prabinder Singh')}`)
  lines.push('')
  lines.push(`  ${sep}`)
  lines.push('')
  lines.push(`  ${DIM('Local-first AI security engine')}`)
  lines.push(`  ${WHITE('The Claude Code of security.')}`)
  lines.push('')
  lines.push(`  ${sep}`)
  lines.push('')

  // Status bullets
  const modelStr = truncatePlain(model || 'auto-detect', 36)
  const isCloud = opts?.provider && opts.provider !== 'ollama'

  if (isCloud) {
    lines.push(`  ${GREEN('✦')} ${DIM('Provider:')} ${PURPLE.bold(opts!.provider!)} ${DIM(`(${modelStr})`)}`)
    lines.push(`  ${GREEN('✦')} ${DIM('Mode:')} ${PURPLE.bold('Cloud')}`)
  } else {
    lines.push(`  ${GREEN('✦')} ${DIM('Ollama:')} ${GREEN.bold('connected')} ${DIM(`(${modelStr})`)}`)
    lines.push(`  ${GREEN('✦')} ${DIM('Mode:')} ${WHITE.bold('Local')} ${DIM('(free)')}`)
  }
  lines.push(`  ${GREEN('✦')} ${DIM('Run:')} ${WHITE.bold('opensec scan ./')} ${DIM('to begin')}`)
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Scan progress UI
// ---------------------------------------------------------------------------

export interface ScanAgentProgress {
  name: string
  step: number
  pct: number
  status: string
}

export function renderScanProgress(
  target: string,
  fileCount: number,
  agents: ScanAgentProgress[],
): string {
  const BAR_WIDTH = 20
  const lines: string[] = [
    '',
    `  ${PURPLE.bold('◆')} ${WHITE.bold('OpenSec Intelligence')} ${DIM('— Security Scan')}`,
    '',
    `  ${DIM('Target:')} ${WHITE(target)} ${DIM(`(${fileCount} files)`)}`,
    '',
  ]

  for (const agent of agents) {
    const filled = Math.round((agent.pct / 100) * BAR_WIDTH)
    const empty = BAR_WIDTH - filled
    const bar = GREEN('█'.repeat(filled)) + DIM('░'.repeat(empty))
    const pctStr = CYAN(`${String(agent.pct).padStart(3, ' ')}%`)
    const stepStr = DIM(`[${agent.step}/4]`)
    const nameStr = WHITE.bold(agent.name.padEnd(10))
    lines.push(`  ${stepStr} ${nameStr} ${bar} ${pctStr}  ${DIM(agent.status)}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Findings output UI
// ---------------------------------------------------------------------------

export interface SecurityFinding {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  type: string
  file: string
  line?: number
  description: string
  modelsAgreed?: number
  totalModels?: number
  fixAvailable?: boolean
}

function sevColor(sev: string): ChalkInstance {
  switch (sev) {
    case 'CRITICAL': return RED.bold
    case 'HIGH': return YELLOW.bold
    case 'MEDIUM': return CYAN.bold
    default: return DIM
  }
}

function sevBar(sev: string): string {
  switch (sev) {
    case 'CRITICAL': return RED.bold('████')
    case 'HIGH': return YELLOW.bold('███')
    case 'MEDIUM': return CYAN.bold('██')
    default: return DIM('█')
  }
}

export function renderFindings(findings: SecurityFinding[]): string {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const f of findings) counts[f.severity]++

  const lines: string[] = [
    '',
    `  ${PURPLE.bold('◆')} ${WHITE.bold('Security Report')} ${DIM('—')} ${RED.bold(`${counts.CRITICAL} Critical`)}, ${YELLOW.bold(`${counts.HIGH} High`)}, ${CYAN(`${counts.MEDIUM} Medium`)}`,
    '',
  ]

  for (const finding of findings) {
    const color = sevColor(finding.severity)
    const bar = sevBar(finding.severity)
    const agreedStr = finding.modelsAgreed !== undefined && finding.totalModels !== undefined
      ? ` — confirmed by ${finding.modelsAgreed}/${finding.totalModels} models`
      : ''
    const fileRef = `${finding.file}${finding.line ? `:${finding.line}` : ''}`

    lines.push(`  ${color(finding.severity)}  ${bar}  ${WHITE.bold(finding.type)}`)
    lines.push(`  ${DIM('╰─')} ${DIM(fileRef)}`)
    lines.push(`  ${DIM('╰─')} ${DIM(finding.description)}${DIM(agreedStr)}`)
    if (finding.fixAvailable) {
      lines.push(`  ${DIM('╰─')} ${GREEN('Fix available')} ${DIM('— run:')} ${WHITE.bold('opensec fix')}`)
    }
    lines.push('')
  }

  const sep = DIM('─'.repeat(38))
  const totalModels = findings[0]?.totalModels ?? 3
  const agreedCount = findings[0]?.modelsAgreed ?? 3
  lines.push(`  ${sep}`)
  lines.push(`  ${DIM('Confidence:')} ${GREEN.bold('HIGH')}  ${DIM('•  Models agreed:')} ${WHITE.bold(`${agreedCount}/${totalModels}`)}`)
  lines.push(`  ${DIM('Run')} ${WHITE.bold('opensec fix')} ${DIM('to apply all patches')}`)
  lines.push(`  ${DIM('Run')} ${WHITE.bold('opensec report')} ${DIM('for HTML report')}`)
  lines.push('')

  return lines.join('\n')
}

export function renderToolExec(toolName: string, input: Record<string, unknown>): string {
  const summary = Object.entries(input)
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v.slice(0, 80) : JSON.stringify(v).slice(0, 80)
      return `${DIM(k + ':')} ${WHITE(val)}`
    })
    .join(' ')
  return `  ${TOOL_SYMBOL} ${toolLabel(toolName)} ${summary}`
}

export function renderToolResult(toolName: string, result: string, isError?: boolean): string {
  const prefix = isError ? ERROR_SYMBOL : SUCCESS_SYMBOL
  const truncated = result.length > 300 ? result.slice(0, 300) + DIM('...') : result
  return `  ${prefix} ${DIM(toolName + ':')} ${isError ? errorText(truncated) : dimText(truncated)}`
}

export function renderError(message: string): string {
  return `\n  ${ERROR_SYMBOL} ${errorText(message)}\n`
}

export function renderInfo(message: string): string {
  return `  ${INFO_SYMBOL} ${WHITE(message)}`
}

export function renderSessionStatus(
  model: string,
  turns: number,
  tokens: { input: number; output: number },
): string {
  return [
    `  ${DIM('Model:')} ${GREEN(model)}`,
    `  ${DIM('Turns:')} ${WHITE(String(turns))}`,
    `  ${DIM('Tokens:')} ${CYAN(String(tokens.input))} ${DIM('in /')} ${PURPLE(String(tokens.output))} ${DIM('out')}`,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Context window visualization
// ---------------------------------------------------------------------------

export function renderContextWindow(opts: {
  model: string
  usedTokens: number
  maxTokens: number
  inputTokens: number
  outputTokens: number
  systemPromptTokens: number
  conversationTokens: number
  turns: number
  messageCount: number
}): string {
  const { model, usedTokens, maxTokens, inputTokens, outputTokens,
    systemPromptTokens, conversationTokens, turns, messageCount } = opts

  const remaining = Math.max(0, maxTokens - usedTokens)
  const pct = maxTokens > 0 ? (usedTokens / maxTokens) * 100 : 0

  // Build the progress bar (40 chars wide)
  const barWidth = 40
  const filledCount = Math.round((pct / 100) * barWidth)
  const emptyCount = barWidth - filledCount

  // Color the bar based on usage: green < 60%, yellow 60-85%, red > 85%
  const barColor = pct > 85 ? RED : pct > 60 ? YELLOW : GREEN
  const filled = barColor('█'.repeat(filledCount))
  const empty = DIM('░'.repeat(emptyCount))
  const pctStr = pct.toFixed(1)

  const fmtNum = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  const lines = [
    '',
    `  ${PURPLE.bold('Context Window')} ${DIM('—')} ${GREEN(model)}`,
    '',
    `  ${filled}${empty} ${WHITE(pctStr + '%')}`,
    '',
    `  ${DIM('Used:')}      ${CYAN(fmtNum(usedTokens))} ${DIM('/')} ${WHITE(fmtNum(maxTokens))} ${DIM('tokens')}`,
    `  ${DIM('Remaining:')} ${remaining > maxTokens * 0.3 ? GREEN(fmtNum(remaining)) : remaining > maxTokens * 0.15 ? YELLOW(fmtNum(remaining)) : RED(fmtNum(remaining))} ${DIM('tokens')}`,
    '',
    `  ${DIM('Breakdown:')}`,
    `    ${PURPLE('●')} ${DIM('System prompt:')}   ${WHITE(fmtNum(systemPromptTokens))}`,
    `    ${CYAN('●')} ${DIM('Conversation:')}    ${WHITE(fmtNum(conversationTokens))}`,
    `    ${GREEN('●')} ${DIM('Input tokens:')}    ${WHITE(fmtNum(inputTokens))} ${DIM('(API reported)')}`,
    `    ${PURPLE_DIM('●')} ${DIM('Output tokens:')}   ${WHITE(fmtNum(outputTokens))} ${DIM('(API reported)')}`,
    '',
    `  ${DIM('Turns:')} ${WHITE(String(turns))}  ${DIM('Messages:')} ${WHITE(String(messageCount))}`,
    '',
    SEPARATOR,
  ]
  return lines.join('\n')
}
