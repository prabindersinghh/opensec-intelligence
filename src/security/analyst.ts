/**
 * Analyst — Phase 1B.
 *
 * For each HIGH/CRITICAL finding, sends the finding plus ±20 lines of file
 * context to the local LLM to confirm whether it's a real vulnerability or a
 * false positive, and to assign a confidence score.
 *
 * Degrades gracefully: if the LLM is unavailable, findings pass through
 * unverified (the deterministic Scanner result is the floor).
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import type { Finding, Severity } from './types.js'
import { type LlmConfig, generateJson } from './llm.js'

const CONTEXT_LINES = 20
const CONFIDENCE_FLOOR = 0.6

const SYSTEM_PROMPT = `You are a senior application security engineer. You are given a potential vulnerability finding.

Your job:
1. Confirm if this is a real vulnerability or a false positive
2. If real, explain the attack vector in 1-2 sentences
3. Rate severity: CRITICAL / HIGH / MEDIUM / LOW
4. Give a confidence score 0.0-1.0

Respond ONLY in this JSON format:
{
  "confirmed": true/false,
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "confidence": 0.0-1.0,
  "attack_vector": "string",
  "false_positive_reason": "string or null"
}`

interface AnalystResponse {
  confirmed: boolean
  severity: Severity
  confidence: number
  attack_vector: string
  false_positive_reason: string | null
}

async function readContext(targetPath: string, finding: Finding): Promise<string> {
  try {
    const abs = path.join(targetPath, finding.file)
    const content = await fs.readFile(abs, 'utf8')
    const lines = content.split(/\r?\n/)
    const from = Math.max(0, finding.line - 1 - CONTEXT_LINES)
    const to = Math.min(lines.length, finding.line + CONTEXT_LINES)
    return lines
      .slice(from, to)
      .map((l, i) => `${from + i + 1}: ${l}`)
      .join('\n')
  } catch {
    return finding.snippet
  }
}

function buildPrompt(finding: Finding, context: string): string {
  return `${SYSTEM_PROMPT}

FINDING:
- Rule: ${finding.ruleName}
- File: ${finding.file}:${finding.line}
- Severity (heuristic): ${finding.severity}
- Description: ${finding.description}

CODE CONTEXT:
${context}

Respond with the JSON only.`
}

export interface AnalystOptions {
  targetPath: string
  llm: LlmConfig
  /** Called after each finding is analyzed (for progress UI). */
  onAnalyzed?: (finding: Finding, index: number, total: number) => void
}

/**
 * Analyze HIGH/CRITICAL findings. Returns the full finding list with HIGH/CRITICAL
 * items enriched (and false positives / low-confidence items removed). MEDIUM/LOW
 * findings pass through untouched.
 */
export async function runAnalyst(
  findings: Finding[],
  opts: AnalystOptions,
): Promise<Finding[]> {
  const targets = findings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH')
  const passthrough = findings.filter((f) => f.severity === 'MEDIUM' || f.severity === 'LOW')

  const kept: Finding[] = []
  let i = 0
  for (const finding of targets) {
    i++
    const context = await readContext(opts.targetPath, finding)
    const res = await generateJson<AnalystResponse>(opts.llm, buildPrompt(finding, context))
    opts.onAnalyzed?.(finding, i, targets.length)

    if (!res) {
      // LLM unavailable or unparseable — keep finding unverified.
      kept.push(finding)
      continue
    }

    finding.confirmed = res.confirmed
    finding.confidence = clampConfidence(res.confidence)
    finding.attackVector = res.attack_vector ?? null
    finding.falsePositiveReason = res.false_positive_reason ?? null
    if (isSeverity(res.severity)) finding.severity = res.severity

    // Filter out confirmed-false or low-confidence findings.
    if (res.confirmed === false) continue
    if (finding.confidence < CONFIDENCE_FLOOR) continue
    kept.push(finding)
  }

  return [...kept, ...passthrough]
}

function clampConfidence(c: unknown): number {
  const n = typeof c === 'number' ? c : Number(c)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function isSeverity(s: unknown): s is Severity {
  return s === 'CRITICAL' || s === 'HIGH' || s === 'MEDIUM' || s === 'LOW'
}
