<div align="center">

<pre>
 ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗ 
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔════╝ 
██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║      
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ██║      
╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗ 
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝ 
</pre>

**Find vulnerabilities. Prove they're real. Patch them. Prove the patch works.**<br/>
**Free forever. No API keys. Runs on your machine.**

<br/>

[![npm version](https://img.shields.io/npm/v/opensec-intelligence?color=FF2D78&label=npm&style=flat-square)](https://www.npmjs.com/package/opensec-intelligence)
[![npm downloads](https://img.shields.io/npm/dw/opensec-intelligence?color=00FF94&style=flat-square)](https://www.npmjs.com/package/opensec-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-white?style=flat-square)](LICENSE)
[![Powered by Ollama](https://img.shields.io/badge/runs%20on-Ollama-blue?style=flat-square)](https://ollama.com)
[![Tests](https://img.shields.io/badge/tests-148%20passing-00FF94?style=flat-square)](#)
[![Built by Prabinder Singh](https://img.shields.io/badge/built%20by-Prabinder%20Singh-FF2D78?style=flat-square)](https://github.com/prabindersinghh)

<br/>

[Install](#quickstart) · [The prove loop](#the-prove-loop) · [How it works](#how-it-works) · [CLI reference](#commands) · [Models](#model-recommendations)

</div>

---

## The problem with every other security tool

They give you a list of 47 findings.  
You fix maybe 3 of them — the ones you're sure about.  
The other 44 sit there because you can't tell what's real.

**OpenSec Intelligence solves the trust problem.**

It doesn't just find the vulnerability. It runs an exploit to prove it exists, patches it with a local AI, then runs the same exploit again to prove the patch closed the hole. You see exactly what happened at every step.

```bash
npm install -g opensec-intelligence
ollama pull qwen2.5-coder:14b
opensec scan ./
```

---

## The prove loop

This is what makes OpenSec different from every other free tool.

```bash
opensec prove ./
```

```
  ╭─────────────────────────────────────────────────────────────╮
  │  PROVING: SQL Injection in src/db/queries.js:47             │
  │                                                             │
  │  🔴 VULNERABILITY CONFIRMED                                 │
  │     Input:  "' OR '1'='1"                                  │
  │     Result: returned 3 rows — authentication bypassed       │
  │                                                             │
  │  ─────────────────────────────────────────────────────────  │
  │                                                             │
  │  ✅ PATCH VERIFIED — exploit no longer works                │
  │     Same input: "' OR '1'='1"                              │
  │     Result:     parameterized query — 0 rows                │
  ╰─────────────────────────────────────────────────────────────╯
```

**What's happening:**
1. A local LLM writes a minimal exploit script for the finding
2. The script runs in a sandboxed subprocess and confirms the vuln fires (`🔴`)
3. The Fixer agent writes and applies the patch
4. The same exploit runs again — it must fail (`✅`)
5. Proof saved to `.opensec/proofs/` for audit

No other free, local tool does this. Most enterprise tools don't either.

---

## Quickstart

```bash
# Install
npm install -g opensec-intelligence

# Pull a model (free, runs locally — one time)
ollama pull qwen2.5-coder:14b

# Scan your repo
opensec scan ./

# See it on a deliberately vulnerable demo app
opensec scan --demo
```

**No account. No API key. Nothing leaves your machine.**

---

## How it works

```
Your codebase
      │
      ▼
┌─────────────┐
│   Scanner   │  Walks every file — code, Dockerfiles, k8s, .env,
│             │  Terraform, CI/CD — in under 30 seconds.
│             │  25+ deterministic rules. No LLM needed here.
└──────┬──────┘
       │ structured findings JSON
       ▼
┌─────────────┐
│   Analyst   │  Sends each HIGH/CRITICAL finding to a local LLM
│             │  with ±15 lines of file context.
│             │  Filters anything below 0.7 confidence.
└──────┬──────┘
       │ confirmed findings
       ▼
┌─────────────┐
│  Consensus  │  Adversarial second pass on every CRITICAL.
│             │  Tries to argue the finding ISN'T a vulnerability.
│             │  If it still holds up — it's real.
└──────┬──────┘
       │ validated findings
       ▼
┌─────────────┐
│    Fixer    │  Writes the exact patch.
│             │  Shows you a colored before/after diff.
│             │  [A]pply / [S]kip / [Q]uit — you decide.
│             │  Git commits on approval.
└─────────────┘
```

The insight that makes this work: **single-model tools hallucinate**. If one model says something is a vulnerability, it might be wrong. OpenSec's consensus layer requires independent confirmation — if models disagree, you don't get paged.

---

## What gets scanned

| Category | File types |
|---|---|
| **Code** | `.py` `.js` `.ts` `.go` `.rb` `.java` `.php` `.rs` `.cpp` `.cs` |
| **Infrastructure** | `Dockerfile` `docker-compose.yml` `*.tf` `*.hcl` `*.toml` |
| **Kubernetes / Config** | `*.yaml` `*.yml` `openapi.*` `*.json` |
| **Secrets** | `.env` `.env.*` `*.pem` `*.key` `*.p12` `*.pfx` |
| **CI/CD** | `.github/workflows/*.yml` `.gitlab-ci.yml` `Jenkinsfile` |

What gets detected: AWS/GitHub/Stripe keys, hardcoded passwords, SQL injection, command injection, path traversal, CORS wildcards, weak crypto (MD5/SHA1), eval usage, Docker root users, k8s privileged containers, Terraform open security groups, and more.

---

## Commands

```bash
# Scan
opensec scan ./              # Full 4-agent scan
opensec scan ./ --quick      # Deterministic scanner only (no LLM, instant)
opensec scan ./ --ci         # JSON output, exit 1 on CRITICAL — use in CI/CD
opensec scan --demo          # Run on bundled vulnerable app — see the pipeline live

# Prove + fix
opensec prove ./             # Generate exploit → confirm → patch → re-confirm
opensec prove ./ --dry-run   # Generate and run exploit, skip patching
opensec prove ./ --show-exploit  # Print the LLM-generated exploit code
opensec fix                  # Apply patches from last scan interactively

# Report + serve
opensec report               # HTML security report
opensec serve --port 4141    # Start HTTP + MCP server

# Model
opensec -m llama3.2:3b       # Override Ollama model
```

---

## CI/CD integration

```bash
# .github/workflows/security.yml
opensec scan ./ --ci --output json
# exits 1 if any CRITICAL findings — blocks the merge
```

See [`.github/workflows/opensec.yml`](.github/workflows/opensec.yml) for a full example.

---

## MCP integration

OpenSec exposes an MCP server so any MCP-compatible tool (Claude Code, goose, Cursor) can call it:

```bash
opensec serve --port 4141
# connect any MCP client to http://localhost:4141/v1/stream
```

| Tool | What it does |
|---|---|
| `scan_repo` | Trigger a full or quick scan |
| `get_findings` | Structured JSON of last scan results |
| `apply_fix` | Apply a specific validated fix |
| `prove_finding` | Run the prove loop on a specific finding |
| `get_report` | Generate HTML report |

---

## Model recommendations

| Model | RAM | Best for |
|---|---|---|
| `qwen2.5-coder:14b` | 16GB | Best overall — recommended |
| `deepseek-r1:14b` | 16GB | Best for the consensus reasoning pass |
| `codellama:13b` | 16GB | Balanced speed + accuracy |
| `llama3.2:3b` | 8GB | Fast scanner on low RAM machines |

```bash
ollama pull qwen2.5-coder:14b   # recommended
ollama pull llama3.2:3b          # minimum spec
```

---

## Local vs Cloud

| Mode | Cost | Privacy | Command |
|---|---|---|---|
| **Local** (default) | Free | 100% private | `opensec scan ./` |
| **Quick** | Free | 100% private | `opensec scan ./ --quick` |
| **Cloud** | API cost | Analyst + Consensus only | `opensec scan ./ --cloud` |

Cloud mode keeps Scanner and Fixer fully local. Only the confirmation passes use cloud models.

---

## Safety

The prove loop runs exploit code in a sandboxed subprocess:

- Real credentials and environment variables are never passed to the subprocess
- `eval()` and `new Function()` string codegen are disabled inside the subprocess
- Network access is blocked before execution
- Filesystem writes outside `/tmp` are blocked
- Hard 10-second timeout
- Exploit files are deleted immediately after use

> ⚠️ Do not run `opensec prove` on untrusted code. File content is embedded in the LLM prompt — a crafted file could influence the generated exploit. Full isolation requires a container.

---

## What's coming

- [ ] VS Code extension — inline vulnerability highlights as you type
- [ ] GitHub App — auto-scan every PR, post findings as review comments
- [ ] SARIF output — GitHub Advanced Security integration
- [ ] Multi-model parallel scanning (`--multi-model`)
- [ ] Web dashboard for team findings
- [ ] Slack / Discord alerts

**Pro + Enterprise tiers** are in development for teams that need zero-false-positive guarantees, air-gapped deployment, and compliance reports (SOC2, ISO 27001, OWASP). [Join the waitlist →](mailto:prabindersinghh@gmail.com)

---

## Contributing

Security rules live in `src/security/patterns.ts` — adding a new detection pattern is a 5-line PR. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/prabindersinghh/opensec-intelligence
npm install
npm test          # 148 tests
opensec scan ./   # dogfood
```

---

<div align="center">

MIT License · [npm](https://www.npmjs.com/package/opensec-intelligence) · [Issues](https://github.com/prabindersinghh/opensec-intelligence/issues)

Built by [Prabinder Singh](https://github.com/prabindersinghh) — B.Tech CS, Thapar Institute · Founder, [Leorit.ai](https://leorit.ai)

</div>
