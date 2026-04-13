/**
 * Markdown renderer for terminal output.
 *
 * Uses marked + marked-terminal for rich terminal rendering and
 * provides chunk-safe streaming helpers for smooth incremental output.
 */

import { Marked } from 'marked'
import { markedTerminal } from 'marked-terminal'
import chalk from 'chalk'
import { getActiveTheme } from './themes.js'

const MARKDOWN_WIDTH_FALLBACK = 96

const marked = new Marked()

function configureMarked(width: number): void {
  const theme = getActiveTheme()
  marked.use(
    markedTerminal({
      code: chalk.hex(theme.syntax.string),
      codespan: chalk.hex(theme.syntax.function),
      strong: chalk.hex(theme.text.primary).bold,
      em: chalk.hex(theme.text.accent).italic,
      heading: chalk.hex(theme.message.assistant).bold,
      firstHeading: chalk.hex(theme.message.assistant).underline.bold,
      href: chalk.hex(theme.message.system).underline,
      link: chalk.hex(theme.message.system),
      listitem: chalk.reset,
      blockquote: chalk.hex(theme.text.secondary).italic,
      hr: chalk.hex(theme.ui.separator),
      paragraph: chalk.reset,
      table: chalk.reset,
      text: chalk.hex(theme.text.primary),
      unescape: true,
      emoji: false,
      showSectionPrefix: false,
      reflowText: false,
      width,
      tab: 2,
    }),
  )
}

export interface RenderMarkdownOptions {
  width?: number
}

function normalizeWidth(width?: number): number {
  if (typeof width === 'number' && width > 20) return width
  const terminalWidth = process.stdout.columns ?? MARKDOWN_WIDTH_FALLBACK
  return Math.max(40, Math.min(terminalWidth - 4, MARKDOWN_WIDTH_FALLBACK))
}

function stripInternalBlocks(text: string): string {
  let cleaned = text
  cleaned = cleaned.replace(/```tool_call[\s\S]*?```/g, '')
  cleaned = cleaned.replace(/```thought[\s\S]*?```/g, '')
  return cleaned
}

function findSafeSplitIndex(buffer: string): number {
  if (!buffer) return -1

  const candidates = [
    buffer.lastIndexOf('\n\n'),
    buffer.lastIndexOf('```\n'),
    buffer.lastIndexOf('\n- '),
    buffer.lastIndexOf('\n* '),
    buffer.lastIndexOf('\n> '),
  ]

  const punctuationSplit = Math.max(
    buffer.lastIndexOf('.\n'),
    buffer.lastIndexOf('!\n'),
    buffer.lastIndexOf('?\n'),
  )

  if (punctuationSplit > 0) candidates.push(punctuationSplit + 2)

  const best = Math.max(...candidates)
  if (best <= 0) return -1
  return best
}

export function renderMarkdown(text: string, opts: RenderMarkdownOptions = {}): string {
  try {
    configureMarked(normalizeWidth(opts.width))
    return marked.parse(stripInternalBlocks(text)) as string
  } catch {
    return text
  }
}

export class StreamingMarkdownRenderer {
  private pending = ''

  constructor(private readonly options: RenderMarkdownOptions = {}) {}

  push(chunk: string): string | null {
    if (!chunk) return null
    this.pending += chunk

    const splitAt = findSafeSplitIndex(this.pending)
    if (splitAt <= 0) return null

    const renderable = this.pending.slice(0, splitAt)
    this.pending = this.pending.slice(splitAt)

    const cleaned = stripInternalBlocks(renderable).trim()
    if (!cleaned) return null
    return renderMarkdown(cleaned, this.options)
  }

  flush(): string | null {
    const remaining = stripInternalBlocks(this.pending).trim()
    this.pending = ''
    if (!remaining) return null
    return renderMarkdown(remaining, this.options)
  }

  reset(): void {
    this.pending = ''
  }
}
