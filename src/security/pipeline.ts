/**
 * Pipeline orchestrator — runs Scanner → (Analyst → Consensus) and persists.
 *
 * Detection (Scanner) always runs. The LLM stages run only when requested and
 * when Ollama is reachable; otherwise the deterministic result stands.
 */

import { runScanner } from './scanner.js'
import { runAnalyst } from './analyst.js'
import { runConsensus } from './consensus.js'
import { persistScan } from './scanner.js'
import { ollamaAvailable, type LlmConfig } from './llm.js'
import type { Finding, ScanResult } from './types.js'

export interface PipelineOptions {
  targetPath: string
  version: string
  llm: LlmConfig
  /** Scanner only — skip the LLM stages. */
  quick?: boolean
  persist?: boolean
  onProgress?: (scanned: number, total: number) => void
  onFinding?: (f: Finding) => void
  onStage?: (stage: 'scanner' | 'analyst' | 'consensus', detail?: string) => void
}

export interface PipelineResult extends ScanResult {
  llmUsed: boolean
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  opts.onStage?.('scanner')
  const scan = await runScanner({
    targetPath: opts.targetPath,
    version: opts.version,
    persist: false,
    onProgress: opts.onProgress,
    onFinding: opts.onFinding,
  })

  let findings = scan.findings
  let llmUsed = false

  if (!opts.quick) {
    const available = await ollamaAvailable(opts.llm.baseUrl)
    if (available) {
      llmUsed = true
      opts.onStage?.('analyst', 'confirming HIGH/CRITICAL findings')
      findings = await runAnalyst(findings, { targetPath: opts.targetPath, llm: opts.llm })
      opts.onStage?.('consensus', 'adversarial review of CRITICAL findings')
      findings = await runConsensus(findings, { targetPath: opts.targetPath, llm: opts.llm })
    }
  }

  const result: PipelineResult = { ...scan, findings, llmUsed }
  if (opts.persist !== false) {
    await persistScan(opts.targetPath, result)
  }
  return result
}
