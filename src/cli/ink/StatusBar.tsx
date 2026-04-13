/**
 * Persistent footer status bar for cmdr.
 *
 * Gemini CLI-inspired segmented bar: workspace, branch, model, context, tokens, mode.
 */

import React from 'react'
import { Box, Text } from 'ink'
import chalk from 'chalk'
import { getActiveTheme } from '../themes.js'

export interface StatusBarProps {
  model: string
  tokensIn: number
  tokensOut: number
  turns: number
  agentCount: number
  permissionMode: string
  cwd: string
  gitBranch?: string
  contextPct?: number
  version?: string
}

interface Segment {
  id: string
  priority: number
  value: string
  width: number
}

export default function StatusBar(props: StatusBarProps): React.ReactElement {
  const {
    model, tokensIn, tokensOut, turns, agentCount,
    permissionMode, cwd, gitBranch, contextPct = 0, version,
  } = props
  const theme = getActiveTheme()

  const dim = chalk.hex(theme.text.secondary)
  const primary = chalk.hex(theme.text.primary)
  const user = chalk.hex(theme.message.user)
  const assistant = chalk.hex(theme.message.assistant)
  const info = chalk.hex(theme.message.system)
  const tool = chalk.hex(theme.message.tool)
  const border = chalk.hex(theme.ui.border)
  const warn = chalk.hex(theme.status.warning)
  const error = chalk.hex(theme.status.error)

  const modeColor = permissionMode === 'yolo'
    ? warn
    : permissionMode === 'strict'
      ? error
      : user

  const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

  const cap = (v: string, max: number): string => {
    if (v.length <= max) return v
    if (max < 3) return v.slice(0, max)
    return `${v.slice(0, max - 1)}…`
  }

  const countAnsi = (v: string): number => v.replace(/\x1b\[[0-9;]*m/g, '').length

  // Context bar: ██░░░░░░░░ 42%
  const barLen = 10
  const filled = Math.round((contextPct / 100) * barLen)
  const barColor = contextPct > 85 ? error : contextPct > 65 ? warn : info
  const bar = barColor('█'.repeat(filled)) + dim('░'.repeat(barLen - filled))
  const pctStr = contextPct > 85
    ? error(`${contextPct}%`)
    : contextPct > 65
      ? warn(`${contextPct}%`)
      : info(`${contextPct}%`)

  const shortCwd = cwd.replace(/^\/Users\/\w+/, '~')
  const dir = shortCwd.split('/').pop() || shortCwd

  const leftSegments: Segment[] = [
    {
      id: 'workspace',
      priority: 1,
      value: `${dim('ws')} ${primary(cap(dir, 20))}`,
      width: countAnsi(`${dim('ws')} ${cap(dir, 20)}`),
    },
  ]

  if (gitBranch) {
    const safeBranch = cap(gitBranch, 24)
    leftSegments.push({
      id: 'branch',
      priority: 2,
      value: `${dim('git')} ${assistant(safeBranch)}`,
      width: countAnsi(`${dim('git')} ${safeBranch}`),
    })
  }

  if (version) {
    leftSegments.push({
      id: 'version',
      priority: 5,
      value: dim(`v${version}`),
      width: countAnsi(`v${version}`),
    })
  }

  const rightSegments: Segment[] = [
    {
      id: 'model',
      priority: 1,
      value: `${dim('mdl')} ${user(cap(model, 18))}`,
      width: countAnsi(`${dim('mdl')} ${cap(model, 18)}`),
    },
    {
      id: 'context',
      priority: 2,
      value: `${dim('ctx')} ${bar} ${pctStr}`,
      width: countAnsi(`ctx ${'█'.repeat(barLen)} ${contextPct}%`),
    },
    {
      id: 'tokens',
      priority: 3,
      value: `${dim('tok')} ${info(fmtNum(tokensIn))}/${tool(fmtNum(tokensOut))}`,
      width: countAnsi(`tok ${fmtNum(tokensIn)}/${fmtNum(tokensOut)}`),
    },
    {
      id: 'turns',
      priority: 4,
      value: `${dim('turn')} ${primary(String(turns))}`,
      width: countAnsi(`turn ${turns}`),
    },
    {
      id: 'agents',
      priority: 4,
      value: `${dim('agt')} ${primary(String(agentCount))}`,
      width: countAnsi(`agt ${agentCount}`),
    },
    {
      id: 'mode',
      priority: 1,
      value: `${dim('mode')} ${modeColor(permissionMode)}`,
      width: countAnsi(`mode ${permissionMode}`),
    },
  ]

  const termWidth = process.stdout.columns || 80
  const separator = dim(' · ')
  const separatorWidth = countAnsi(' · ')

  const fitSegments = (segments: Segment[], maxWidth: number): Segment[] => {
    const sorted = [...segments].sort((a, b) => a.priority - b.priority)
    const fitted: Segment[] = []
    let used = 0
    for (const segment of sorted) {
      const nextCost = segment.width + (fitted.length > 0 ? separatorWidth : 0)
      if (used + nextCost <= maxWidth) {
        fitted.push(segment)
        used += nextCost
      }
    }
    return fitted
  }

  const halfWidth = Math.floor((termWidth - 4) / 2)
  const leftFitted = fitSegments(leftSegments, halfWidth)
  const rightFitted = fitSegments(rightSegments, termWidth - 4 - halfWidth)

  const left = leftFitted.map(s => s.value).join(separator)
  const right = rightFitted.map(s => s.value).join(separator)

  const leftLen = countAnsi(left)
  const rightLen = countAnsi(right)
  const gap = Math.max(1, termWidth - leftLen - rightLen - 2)
  const rule = border('─'.repeat(termWidth))

  const content = `${left}${' '.repeat(gap)}${right}`

  return (
    <Box flexDirection="column">
      <Text>{rule}</Text>
      <Text>{` ${content}`}</Text>
    </Box>
  )
}
