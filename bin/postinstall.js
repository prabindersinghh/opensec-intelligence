#!/usr/bin/env node
/**
 * Post-install check. Friendly, never fatal.
 *
 * OpenSec's scanner runs with zero setup. The optional LLM stages
 * (analyst/consensus/fixer) use a local Ollama model — so we just nudge the
 * user if Ollama isn't running. We never fail the install over it.
 */

// Skip in CI / non-interactive installs to keep logs clean.
if (process.env.CI || process.env.OPENSEC_SKIP_POSTINSTALL) {
  process.exit(0)
}

const url = process.env.OPENSEC_OLLAMA_URL || 'http://localhost:11434'

const PINK = '\x1b[38;2;255;45;120m'
const GREEN = '\x1b[38;2;0;255;148m'
const DIM = '\x1b[90m'
const R = '\x1b[0m'

async function main() {
  let ollamaUp = false
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) })
    ollamaUp = res.ok
  } catch {
    ollamaUp = false
  }

  console.log('')
  console.log(`  ${PINK}OpenSec Intelligence${R} installed.`)
  console.log(`  ${DIM}Run${R} ${GREEN}opensec scan --demo${R} ${DIM}to see it find real vulns in seconds.${R}`)
  if (!ollamaUp) {
    console.log('')
    console.log(`  ${DIM}Note: the deterministic scanner works now with no setup.${R}`)
    console.log(`  ${DIM}For AI analyst/consensus/fixer, install Ollama and pull a model:${R}`)
    console.log(`    ${DIM}https://ollama.com  ·  ollama pull qwen2.5-coder:14b${R}`)
  } else {
    console.log(`  ${GREEN}✓${R} ${DIM}Ollama detected — AI analyst/consensus/fixer enabled.${R}`)
  }
  console.log('')
}

main().catch(() => process.exit(0))
