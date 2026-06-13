# OpenSec Intelligence — Codebase Audit (Phase 0)

> Generated as the first step of the v3.1 production upgrade. This documents the
> honest state of the repo **before** the upgrade work began.

## 1. What actually exists vs. what the README promises

| README promise | Reality (before upgrade) |
|---|---|
| "Four-agent AI pipeline: Scanner → Analyst → Consensus → Fixer" | These are **prompt personas**, not implemented agents. There is no discrete Scanner/Analyst/Consensus/Fixer code. |
| "Finds real vulnerabilities" | No deterministic detection exists. `opensec scan` launches a generic LLM REPL and asks the model to "find issues" in free text. |
| "Writes the exact patches. Asks approval. Commits." | No diff engine, no approval loop, no auto-commit for fixes. The `fix` command just prompts an LLM to "apply fixes." |
| "Multi-model consensus — 3+ models validate each finding" | No consensus mechanism in code. Single agentic loop. |
| "Structured JSON findings → `.opensec/last-scan.json`" | This file is never written. No structured findings format. |
| "Diff screenshots / shareable security reports" | No screenshot code, no `.opensec/diffs/`. `report` asks an LLM to emit HTML. |

**Root cause:** This project is a rebrand of a general-purpose multi-agent coding
assistant (originally **"cmdr"** — see `bin/cmdr.ts`, `src/vscode/cmdr-vscode-*.vsix`,
and `cmdr`/`CmdrDaemon` identifiers throughout `src/`). The security framing is a
marketing layer over a generic Ollama-backed agentic CLI.

## 2. Which agents are implemented end-to-end vs. skeleton

There are **no security-specific agents** implemented as code. What exists:

- `src/core/orchestrator.ts`, `src/core/team.ts`, `src/core/agent.ts` — a real,
  working **generic** multi-agent orchestrator.
- `src/agents/bundled/security.md` — a single system-prompt persona used by the
  `security` team preset.
- `src/core/presets.ts` — defines the `security` team preset (prompt-level only).

So: the generic orchestration engine is real and functional. The "4 security
agents" are **0% implemented as the README describes** — they are LLM prompts.

## 3. What `opensec scan ./` actually does when run

From `bin/cmdr.ts:269`:

1. Resolves the path and `chdir`s into it.
2. Optionally swaps to a cloud provider if `--cloud` + an API key is present.
3. Calls `startRepl(...)` — the **interactive coding REPL** — with `team: 'security'`
   (full mode) or a one-shot prompt (`--quick`): *"Run a quick security surface
   scan of this codebase. Use glob and grep… Output a structured JSON attack
   surface map."*
4. The local LLM then freely decides what to do. Output quality is entirely
   model-dependent and non-deterministic. No findings file is produced.

There is **no scanning logic** — it is an LLM agent loop pointed at a directory.

## 4. Top 5 gaps between README promises and real code

1. **No deterministic scanner.** Zero regex/AST detection. The headline feature
   ("finds real vulnerabilities") relies entirely on an LLM's free-form output.
2. **No findings data model.** Nothing writes `.opensec/last-scan.json`; downstream
   `fix`/`report` have no structured input to operate on.
3. **No real Fixer.** No unified-diff generation, no before/after, no approval gate,
   no `git commit` of fixes — all of which the README sells as the differentiator.
4. **No consensus / confidence scoring.** "0.7+ confidence threshold" and "3 models
   validate each finding" exist only in prose.
5. **No demo / proof artifacts.** No demo mode, no diff screenshots, no shareable
   report output — nothing that delivers the promised "oh shit" moment.

## 5. What the upgrade builds (foundation that already works in our favor)

- `src/llm/ollama.ts` (`OllamaAdapter.chat`) — reusable for the Analyst/Consensus.
- `chalk`, `ora`, `strip-ansi`, `ink`, `react` already in `dependencies`.
- TypeScript ESM build (`tsc` → `dist/`), Node ≥ 20, `vitest` for tests.

The upgrade adds a **real deterministic pipeline** (`src/security/`) that runs
independently of the LLM for detection, uses the LLM only for triage/fix synthesis,
and writes real, structured, shareable artifacts.
