/**
 * Fixer — Phase 1D. OpenSec's differentiator.
 *
 * For each eligible finding, asks the LLM for a fixed version of the vulnerable
 * lines, renders a colored before/after diff (terminal + HTML + optional PNG),
 * asks for human approval, and on approval writes the fix and commits it.
 *
 * Requires the LLM (you can't synthesize a patch without it). When Ollama is
 * offline, the Fixer reports that and makes no changes.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import chalk from 'chalk'
import type { Finding } from './types.js'
import { type LlmConfig, generateJson } from './llm.js'
import {
  buildDiff,
  renderDiffTerminal,
  renderDiffHtml,
  screenshotDiff,
  type DiffLine,
} from './screenshot.js'

const execFileAsync = promisify(execFile)

export type ApprovalMode = 'interactive' | 'auto-apply' | 'dry-run'

interface FixResponse {
  fixed_lines: string[]
  explanation: string
}

export interface FixerOptions {
  targetPath: string
  llm: LlmConfig
  mode: ApprovalMode
  /** Directory for diff screenshots. Default `<target>/.opensec/diffs`. */
  diffDir?: string
  /** Confidence threshold for eligibility when consensus is absent. Default 0.8. */
  confidenceThreshold?: number
}

export interface FixerSummary {
  considered: number
  applied: number
  skipped: number
  screenshots: string[]
  llmAvailable: boolean
}

function isEligible(f: Finding, threshold: number): boolean {
  if (f.consensus === true) return true
  if (typeof f.confidence === 'number') return f.confidence > threshold
  // No analyst data (offline scan): allow fixing high-severity findings.
  return f.severity === 'CRITICAL' || f.severity === 'HIGH'
}

function safeRuleSlug(rule: string): string {
  return rule.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function buildFixPrompt(finding: Finding): string {
  return `You are a security engineer writing a fix. Given this vulnerability:
- File: ${finding.file}
- Line: ${finding.line}
- Issue: ${finding.ruleName}: ${finding.description}
- Vulnerable code snippet:
${finding.snippet}

Write ONLY the fixed version of the vulnerable line(s).
Output JSON: { "fixed_lines": ["line1", "line2", ...], "explanation": "one sentence" }
Do not output anything else.`
}

export async function runFixer(
  findings: Finding[],
  opts: FixerOptions,
): Promise<FixerSummary> {
  const threshold = opts.confidenceThreshold ?? 0.8
  const diffDir = opts.diffDir ?? path.join(opts.targetPath, '.opensec', 'diffs')
  const eligible = findings.filter((f) => isEligible(f, threshold))

  const summary: FixerSummary = {
    considered: eligible.length,
    applied: 0,
    skipped: 0,
    screenshots: [],
    llmAvailable: true,
  }

  for (const finding of eligible) {
    const abs = path.join(opts.targetPath, finding.file)
    let fileContent: string
    try {
      fileContent = await fs.readFile(abs, 'utf8')
    } catch {
      summary.skipped++
      continue
    }
    const fileLines = fileContent.split(/\r?\n/)

    const res = await generateJson<FixResponse>(opts.llm, buildFixPrompt(finding))
    if (!res || !Array.isArray(res.fixed_lines) || res.fixed_lines.length === 0) {
      summary.llmAvailable = summary.llmAvailable && res !== null
      summary.skipped++
      continue
    }

    const diff = buildDiff(fileLines, finding.line, 1, res.fixed_lines)

    // Artifacts: HTML + optional PNG.
    const pngPath = path.join(diffDir, `${finding.id}-${safeRuleSlug(finding.ruleName)}.png`)
    const shot = await screenshotDiff(renderDiffHtml(finding, diff), pngPath)
    finding.diffPath = shot.pngPath ?? shot.htmlPath
    summary.screenshots.push(finding.diffPath)

    printFixCard(finding, diff, res.explanation, shot.rendered)

    const decision = await getDecision(opts.mode, finding, fileContent)
    if (decision === 'quit') break
    if (decision === 'skip') {
      summary.skipped++
      continue
    }

    // Apply: replace the vulnerable line with the fixed lines.
    const newLines = [
      ...fileLines.slice(0, finding.line - 1),
      ...res.fixed_lines,
      ...fileLines.slice(finding.line),
    ]
    await fs.writeFile(abs, newLines.join('\n'), 'utf8')
    finding.fixApplied = true
    summary.applied++
    await commitFix(opts.targetPath, finding)
  }

  return summary
}

function printFixCard(finding: Finding, diff: DiffLine[], explanation: string, rendered: boolean): void {
  const conf = typeof finding.confidence === 'number' ? finding.confidence.toFixed(2) : 'n/a'
  console.log('')
  console.log(chalk.hex('#FF2D78').bold('  ┌─ FIXER ' + '─'.repeat(48)))
  console.log(`  ${chalk.bold(finding.ruleName)} ${chalk.gray('in')} ${finding.file}:${finding.line}`)
  console.log(`  ${chalk.gray('Severity:')} ${finding.severity}  ${chalk.gray('Confidence:')} ${conf}`)
  console.log(chalk.gray('  ' + '─'.repeat(56)))
  console.log(renderDiffTerminal(diff).split('\n').map((l) => '  ' + l).join('\n'))
  console.log(chalk.gray('  ' + '─'.repeat(56)))
  console.log(`  ${chalk.gray('Why:')} ${explanation}`)
  if (finding.diffPath) {
    console.log(`  ${chalk.gray('Diff ' + (rendered ? 'screenshot' : 'HTML') + ':')} ${finding.diffPath}`)
  }
}

type Decision = 'apply' | 'skip' | 'quit'

async function getDecision(mode: ApprovalMode, finding: Finding, fileContent: string): Promise<Decision> {
  if (mode === 'auto-apply') return 'apply'
  if (mode === 'dry-run') return 'skip'
  return promptDecision(finding, fileContent)
}

/** Interactive single-key approval. Falls back to skip on non-TTY. */
async function promptDecision(finding: Finding, fileContent: string): Promise<Decision> {
  const stdin = process.stdin
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    console.log(chalk.gray('  (non-interactive terminal — skipping write)'))
    return 'skip'
  }

  return new Promise<Decision>((resolve) => {
    process.stdout.write(chalk.bold('  [A]pply  [S]kip  [V]iew full file  [Q]uit fixes  '))
    stdin.setRawMode(true)
    stdin.resume()
    const onData = (buf: Buffer): void => {
      const key = buf.toString('utf8').toLowerCase()
      if (key === 'v') {
        console.log('\n' + fileContent)
        process.stdout.write(chalk.bold('  [A]pply  [S]kip  [Q]uit  '))
        return
      }
      const decision: Decision = key === 'a' ? 'apply' : key === 'q' || key === '' ? 'quit' : 'skip'
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      console.log('')
      resolve(decision)
    }
    stdin.on('data', onData)
  })
}

async function commitFix(targetPath: string, finding: Finding): Promise<void> {
  try {
    await execFileAsync('git', ['add', '--', finding.file], { cwd: targetPath })
    await execFileAsync(
      'git',
      ['commit', '-m', `fix(security): ${finding.ruleName} in ${finding.file} [opensec]`],
      { cwd: targetPath },
    )
  } catch {
    // Not a git repo, nothing staged, or hooks failed — non-fatal.
    console.log(chalk.gray('  (skipped git commit — not a repo or nothing to commit)'))
  }
}
