/**
 * Report + terminal UI — Phase 2 / Phase 3B.
 *
 * Self-contained renderers (no cli-table3/boxen dependency) for the scan
 * banner, the findings table, the summary line, and an HTML security report.
 * Uses `string-width` (already a dependency) for correct wide/emoji widths.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import chalk from 'chalk'
import stringWidth from 'string-width'
import type { Finding, ScanResult, Severity } from './types.js'
import { tally } from './types.js'

const PINK = chalk.hex('#FF2D78')
const GREEN = chalk.hex('#00FF94')
const DIM = chalk.gray

const SEV_COLOR: Record<Severity, (s: string) => string> = {
  CRITICAL: (s) => chalk.red.bold(s),
  HIGH: (s) => chalk.hex('#FF8800').bold(s),
  MEDIUM: (s) => chalk.yellow(s),
  LOW: (s) => chalk.white(s),
}

const SEV_DOT: Record<Severity, string> = {
  CRITICAL: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '⚪',
}

export function renderBanner(version: string, model: string): string {
  const W = 62
  const logo = [
    ' ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗',
    '██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║',
    ' ╚█████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗',
  ]
  const row = (content: string): string => {
    const padLen = Math.max(0, W - stringWidth(content))
    return PINK('║') + content + ' '.repeat(padLen) + PINK('║')
  }
  const top = PINK('╔' + '═'.repeat(W) + '╗')
  const bot = PINK('╚' + '═'.repeat(W) + '╝')
  const title = `  ${chalk.white.bold('OPENSEC INTELLIGENCE')}  ${DIM('v' + version)}   ${DIM('local · ' + model)}`
  return [top, ...logo.map((l) => row('  ' + GREEN(l))), row(title), bot].join('\n')
}

function pad(text: string, width: number): string {
  const w = stringWidth(text)
  return w >= width ? text : text + ' '.repeat(width - w)
}

function truncate(text: string, width: number): string {
  if (stringWidth(text) <= width) return text
  let out = ''
  for (const ch of text) {
    if (stringWidth(out + ch) > width - 1) break
    out += ch
  }
  return out + '…'
}

/** Render the findings as a bordered table. */
export function renderFindingsTable(findings: Finding[]): string {
  const cols = [
    { key: 'severity', label: 'SEVERITY', width: 8 },
    { key: 'rule', label: 'RULE', width: 24 },
    { key: 'file', label: 'FILE', width: 26 },
    { key: 'line', label: 'LINE', width: 5 },
    { key: 'conf', label: 'CONF', width: 5 },
  ]
  const sep = (l: string, m: string, r: string): string =>
    l + cols.map((c) => '─'.repeat(c.width + 2)).join(m) + r

  const headerCells = cols.map((c) => ' ' + pad(c.label, c.width) + ' ').join('│')
  const lines: string[] = []
  lines.push(DIM(sep('┌', '┬', '┐')))
  lines.push(DIM('│') + chalk.bold(headerCells) + DIM('│'))
  lines.push(DIM(sep('├', '┼', '┤')))

  for (const f of findings) {
    const conf = typeof f.confidence === 'number' ? f.confidence.toFixed(2) : '—'
    const cells = [
      ' ' + pad(SEV_COLOR[f.severity](pad(f.severity, cols[0].width)), cols[0].width) + ' ',
      ' ' + pad(truncate(f.ruleName, cols[1].width), cols[1].width) + ' ',
      ' ' + pad(truncate(f.file, cols[2].width), cols[2].width) + ' ',
      ' ' + pad(String(f.line), cols[3].width) + ' ',
      ' ' + pad(conf, cols[4].width) + ' ',
    ]
    lines.push(DIM('│') + cells.join(DIM('│')) + DIM('│'))
  }
  lines.push(DIM(sep('└', '┴', '┘')))
  return lines.join('\n')
}

export function renderSummaryLine(findings: Finding[]): string {
  const t = tally(findings)
  return [
    chalk.red.bold(`${t.CRITICAL} CRITICAL`),
    chalk.hex('#FF8800').bold(`${t.HIGH} HIGH`),
    chalk.yellow(`${t.MEDIUM} MEDIUM`),
    chalk.white(`${t.LOW} LOW`),
  ].join(DIM('  ·  '))
}

export function renderHeading(targetPath: string, count: number): string {
  return `\n  ${chalk.bold.white('OPENSEC SCAN RESULTS')} ${DIM('—')} ${PINK.bold(String(count))} ${DIM('findings in')} ${path.basename(targetPath) || targetPath}\n`
}

/** One-line live status used during scanning. */
export function renderLatest(f: Finding): string {
  return `  ${SEV_DOT[f.severity]}  ${DIM(f.file + ':' + f.line)} ${chalk.white('—')} ${SEV_COLOR[f.severity](f.ruleName)}`
}

/** Write an HTML security report next to the target; returns its path. */
export async function writeHtmlReport(targetPath: string, result: ScanResult): Promise<string> {
  const t = tally(result.findings)
  const rows = result.findings
    .map(
      (f) => `    <tr class="sev-${f.severity.toLowerCase()}">
      <td><span class="badge ${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td>${esc(f.ruleName)}</td>
      <td><code>${esc(f.file)}:${f.line}</code></td>
      <td>${typeof f.confidence === 'number' ? f.confidence.toFixed(2) : '—'}</td>
      <td>${esc(f.description)}</td>
    </tr>`,
    )
    .join('\n')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OpenSec Security Report</title>
<style>
  body { background:#0d1117; color:#c9d1d9; font-family:-apple-system,Segoe UI,sans-serif; padding:32px; }
  h1 { color:#FF2D78; } .meta { color:#8b949e; margin-bottom:24px; }
  .summary span { margin-right:16px; font-weight:bold; }
  table { border-collapse:collapse; width:100%; margin-top:16px; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid #21262d; font-size:14px; }
  th { color:#8b949e; text-transform:uppercase; font-size:11px; }
  code { color:#58a6ff; } .badge{ padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold; }
  .critical{ background:#ff000033;color:#ff4444; } .high{ background:#ff800033;color:#ff8800; }
  .medium{ background:#ffff0033;color:#ffd000; } .low{ background:#30363d;color:#c9d1d9; }
</style></head><body>
  <h1>OpenSec Intelligence — Security Report</h1>
  <div class="meta">Scanned <code>${esc(result.targetPath)}</code> · ${result.filesScanned} files · ${(result.durationMs / 1000).toFixed(1)}s · ${esc(result.scannedAt)}</div>
  <div class="summary">
    <span style="color:#ff4444">${t.CRITICAL} CRITICAL</span>
    <span style="color:#ff8800">${t.HIGH} HIGH</span>
    <span style="color:#ffd000">${t.MEDIUM} MEDIUM</span>
    <span style="color:#c9d1d9">${t.LOW} LOW</span>
  </div>
  <table>
    <thead><tr><th>Severity</th><th>Rule</th><th>Location</th><th>Conf</th><th>Description</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body></html>`

  const out = path.join(targetPath, 'opensec-report.html')
  await fs.writeFile(out, html, 'utf8')
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
