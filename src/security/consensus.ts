/**
 * Consensus — Phase 1C.
 *
 * Re-examines each CRITICAL finding that passed the Analyst with an adversarial
 * prompt ("argue why this is NOT a vulnerability"). If the adversarial pass
 * still confirms it, mark consensus:true. If it raises real doubt, downgrade to
 * HIGH. Final confidence is the average of both passes.
 *
 * Degrades gracefully: with no LLM, CRITICAL findings keep their Analyst state.
 */

import { promises as fs } from 'fs'
import * as path from 'path'
import type { Finding } from './types.js'
import { type LlmConfig, generateJson } from './llm.js'

const CONTEXT_LINES = 20

const ADVERSARIAL_PROMPT = `You are a skeptical security engineer playing devil's advocate.
You are given a finding that another engineer flagged as a CRITICAL vulnerability.
Your job is to argue, as rigorously as you can, why this might NOT be a real
vulnerability (false positive, mitigated elsewhere, unreachable, etc.).

After arguing, give your honest verdict.

Respond ONLY in this JSON format:
{
  "still_vulnerable": true/false,
  "confidence": 0.0-1.0,
  "doubt_reason": "string or null"
}`

interface AdversarialResponse {
  still_vulnerable: boolean
  confidence: number
  doubt_reason: string | null
}

async function readContext(targetPath: string, finding: Finding): Promise<string> {
  try {
    const abs = path.join(targetPath, finding.file)
    const content = await fs.readFile(abs, 'utf8')
    const lines = content.split(/\r?\n/)
    const from = Math.max(0, finding.line - 1 - CONTEXT_LINES)
    const to = Math.min(lines.length, finding.line + CONTEXT_LINES)
    return lines.slice(from, to).map((l, i) => `${from + i + 1}: ${l}`).join('\n')
  } catch {
    return finding.snippet
  }
}

export interface ConsensusOptions {
  targetPath: string
  llm: LlmConfig
  onReviewed?: (finding: Finding, index: number, total: number) => void
}

export async function runConsensus(
  findings: Finding[],
  opts: ConsensusOptions,
): Promise<Finding[]> {
  const criticals = findings.filter((f) => f.severity === 'CRITICAL')
  let i = 0

  for (const finding of criticals) {
    i++
    const context = await readContext(opts.targetPath, finding)
    const prompt = `${ADVERSARIAL_PROMPT}

FINDING:
- Rule: ${finding.ruleName}
- File: ${finding.file}:${finding.line}
- Description: ${finding.description}
- Attack vector (from first pass): ${finding.attackVector ?? 'n/a'}

CODE CONTEXT:
${context}

Respond with the JSON only.`

    const res = await generateJson<AdversarialResponse>(opts.llm, prompt)
    opts.onReviewed?.(finding, i, criticals.length)

    if (!res) {
      // No second opinion available — leave as-is.
      continue
    }

    const firstPass = finding.confidence ?? 0.9
    const secondPass = clamp(res.confidence)
    finding.confidence = Math.round(((firstPass + secondPass) / 2) * 100) / 100

    if (res.still_vulnerable) {
      finding.consensus = true
    } else {
      // Adversarial pass raised doubt — downgrade severity.
      finding.consensus = false
      finding.severity = 'HIGH'
      if (res.doubt_reason) finding.falsePositiveReason = res.doubt_reason
    }
  }

  // Drop CRITICALs that collapsed below the confidence floor after averaging.
  return findings.filter((f) => (f.confidence ?? 1) >= 0.5 || f.consensus !== false)
}

function clamp(c: unknown): number {
  const n = typeof c === 'number' ? c : Number(c)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
