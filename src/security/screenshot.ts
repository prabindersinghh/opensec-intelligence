/**
 * Diff rendering + screenshots — Phase 1D / Phase 3.
 *
 * Renders a colored before/after diff as terminal output (chalk) and as an HTML
 * page. The HTML can be rasterized to PNG via puppeteer, which is a LAZY,
 * OPTIONAL dependency: if puppeteer isn't installed we still write the .html
 * artifact and report that PNG rendering was skipped. This keeps the published
 * npm package from forcing a ~300MB Chromium download on every install.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import type { Finding, Severity } from './types.js'

export interface DiffLine {
  type: 'context' | 'removal' | 'addition'
  text: string
}

/** Build a small contextual diff from original lines + replacement lines. */
export function buildDiff(
  fileLines: string[],
  startLine: number, // 1-based
  removedCount: number,
  fixedLines: string[],
  context = 3,
): DiffLine[] {
  const idx = startLine - 1
  const out: DiffLine[] = []

  for (let i = Math.max(0, idx - context); i < idx; i++) {
    out.push({ type: 'context', text: fileLines[i] ?? '' })
  }
  for (let i = idx; i < idx + removedCount; i++) {
    out.push({ type: 'removal', text: fileLines[i] ?? '' })
  }
  for (const line of fixedLines) {
    out.push({ type: 'addition', text: line })
  }
  const after = idx + removedCount
  for (let i = after; i < Math.min(fileLines.length, after + context); i++) {
    out.push({ type: 'context', text: fileLines[i] ?? '' })
  }
  return out
}

/** Render a diff with ANSI color for the terminal. */
export function renderDiffTerminal(diff: DiffLine[]): string {
  return diff
    .map((l) => {
      if (l.type === 'removal') return chalk.red(`- ${l.text}`)
      if (l.type === 'addition') return chalk.green(`+ ${l.text}`)
      return chalk.gray(`  ${l.text}`)
    })
    .join('\n')
}

const SEVERITY_CLASS: Record<Severity, string> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'medium',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Render the diff as a standalone HTML page (GitHub-dark themed). */
export function renderDiffHtml(finding: Finding, diff: DiffLine[]): string {
  const diffContent = diff
    .map((l) => {
      const text = escapeHtml(l.text)
      if (l.type === 'removal') return `<span class="removal">- ${text}</span>`
      if (l.type === 'addition') return `<span class="addition">+ ${text}</span>`
      return `<span class="context">  ${text}</span>`
    })
    .join('\n')

  const sevClass = SEVERITY_CLASS[finding.severity]
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { background: #0d1117; font-family: 'Courier New', monospace; padding: 20px; margin: 0; }
  .header { color: #58a6ff; font-size: 14px; margin-bottom: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-right: 8px; font-weight: bold; }
  .critical { background: #ff000033; color: #ff4444; border: 1px solid #ff4444; }
  .high { background: #ff800033; color: #ff8800; border: 1px solid #ff8800; }
  .medium { background: #ffff0033; color: #ffff00; border: 1px solid #ffff00; }
  .removal { background: #ff000020; color: #ffa0a0; padding: 2px 8px; display: block; }
  .addition { background: #00ff0020; color: #a0ffa0; padding: 2px 8px; display: block; }
  .context { color: #8b949e; padding: 2px 8px; display: block; }
  .file-path { color: #8b949e; font-size: 12px; margin-bottom: 8px; }
  pre { margin: 0; }
</style>
</head>
<body>
  <div class="header">
    <span class="badge ${sevClass}">${finding.severity}</span>
    ${escapeHtml(finding.ruleName)} — ${escapeHtml(finding.file)}:${finding.line}
  </div>
  <div class="file-path">${escapeHtml(finding.description)}</div>
  <pre>${diffContent}</pre>
</body>
</html>`
}

export interface ScreenshotResult {
  htmlPath: string
  pngPath: string | null
  rendered: boolean
}

/**
 * Write the HTML and, if puppeteer is available, a PNG alongside it.
 * Returns paths and whether PNG rendering happened.
 */
export async function screenshotDiff(
  html: string,
  outPng: string,
): Promise<ScreenshotResult> {
  await fs.mkdir(path.dirname(outPng), { recursive: true })
  const htmlPath = outPng.replace(/\.png$/, '.html')
  await fs.writeFile(htmlPath, html, 'utf8')

  const puppeteer = await loadPuppeteer()
  if (!puppeteer) {
    return { htmlPath, pngPath: null, rendered: false }
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 900, height: 400, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'load' })
    await page.screenshot({ path: outPng, fullPage: true })
    await browser.close()
    return { htmlPath, pngPath: outPng, rendered: true }
  } catch {
    return { htmlPath, pngPath: null, rendered: false }
  }
}

interface PuppeteerLike {
  launch(opts: unknown): Promise<{
    newPage(): Promise<{
      setViewport(v: unknown): Promise<void>
      setContent(html: string, opts: unknown): Promise<void>
      screenshot(opts: unknown): Promise<unknown>
    }>
    close(): Promise<void>
  }>
}

/** Lazy, optional puppeteer import. Returns null if not installed. */
async function loadPuppeteer(): Promise<PuppeteerLike | null> {
  try {
    // Indirect specifier so the type-checker doesn't require the optional dep.
    const specifier = 'puppeteer'
    const mod = (await import(specifier)) as { default?: PuppeteerLike } & PuppeteerLike
    return mod.default ?? mod
  } catch {
    return null
  }
}
