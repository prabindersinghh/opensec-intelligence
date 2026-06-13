/**
 * Security pipeline data model.
 *
 * These types are the contract shared by every stage of the pipeline
 * (Scanner → Analyst → Consensus → Fixer → Report). A `Finding` is enriched
 * in place as it flows through the stages; optional fields are populated by
 * later stages.
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export type Category = 'secret' | 'code' | 'infra'

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

/** A single security pattern the Scanner matches against file contents. */
export interface SecurityPattern {
  name: string
  regex: RegExp
  severity: Severity
  category: Category
  description: string
  remediation: string
  /** Base confidence that regex alone (without LLM) correctly identifies a vuln. 0.0–1.0. */
  confidence: number
  /** Skip matches in test/spec/fixture files. Default true. Only false for secrets that are real even in tests. */
  skipInTestFiles?: boolean
  /** Restrict to matching file extensions or exact basenames (e.g. ['.yaml', 'Dockerfile']). */
  files?: string[]
  /** Match against the whole file instead of line-by-line (for multi-line regexes). */
  multiline?: boolean
}

/** A confirmed or candidate finding produced by the Scanner. */
export interface Finding {
  id: string
  file: string
  line: number
  column: number
  ruleName: string
  severity: Severity
  category: Category
  snippet: string
  description: string
  remediation: string

  // --- Analyst stage (Phase 1B) ---
  confirmed?: boolean
  confidence?: number
  attackVector?: string | null
  falsePositiveReason?: string | null

  // --- Consensus stage (Phase 1C) ---
  consensus?: boolean

  // --- Fixer stage (Phase 1D) ---
  fixApplied?: boolean
  diffPath?: string
}

export type ExploitLang = 'javascript' | 'python' | 'bash'

export interface ExploitResult {
  success: boolean      // true = vuln confirmed; false = not exploitable / already patched
  input: string
  output: string
  exitCode: number
  duration: number      // ms
  error?: string
}

export interface ProofResult {
  findingId: string
  exploitCode: string
  exploitLang: ExploitLang
  beforePatch: ExploitResult
  afterPatch: ExploitResult
  verified: boolean     // exploit confirmed, patch validated
  skipped: boolean
  skipReason?: string | null
}

export interface ScanResult {
  tool: string
  version: string
  scannedAt: string
  targetPath: string
  filesScanned: number
  durationMs: number
  findings: Finding[]
}

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER[s]
}

/** Count findings by severity for summaries. */
export function tally(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const f of findings) counts[f.severity]++
  return counts
}
