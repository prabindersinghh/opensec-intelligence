<div align="center">

<pre>
 ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗ 
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔════╝ 
██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║      
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ██║      
╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗ 
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝ 
</pre>

**The world's first local-first, multi-agent AI security engine.**<br/>
**Free forever. No API keys. Runs on your machine.**

<br/>

[![The Security Layer Claude Code Doesn't Have](https://img.shields.io/badge/the%20security%20layer-Claude%20Code%20doesn't%20have-FF2D78?style=for-the-badge)](https://github.com/prabindersinghh/opensec-intelligence)

[![npm version](https://img.shields.io/npm/v/opensec-intelligence?color=FF2D78&label=npm&style=flat-square)](https://www.npmjs.com/package/opensec-intelligence)
[![npm downloads](https://img.shields.io/npm/dw/opensec-intelligence?color=00FF94&style=flat-square)](https://www.npmjs.com/package/opensec-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-white?style=flat-square)](LICENSE)
[![Powered by Ollama](https://img.shields.io/badge/runs%20on-Ollama-blue?style=flat-square)](https://ollama.com)
[![Built by Prabinder Singh](https://img.shields.io/badge/built%20by-Prabinder%20Singh-FF2D78?style=flat-square)](https://github.com/prabindersinghh)

<br/>

> **Built by [Prabinder Singh](https://github.com/prabindersinghh)** — B.Tech CS, Thapar Institute · Founder, Leorit.ai

<br/>

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Agents](#the-4-agents) · [Skills](#skills) · [MCP](#mcp-integration) · [Models](#model-recommendations)

</div>

---

## What is OpenSec Intelligence?

Claude Code writes your code. **OpenSec Intelligence secures it.**

> 💬 "Claude Code writes your code. OpenSec Intelligence makes sure it doesn't get hacked."

A four-agent AI pipeline that scans your entire codebase — code, infrastructure, secrets, configs — finds real vulnerabilities, validates them with consensus scoring, and writes the exact patches. Runs completely free on your machine with Ollama. No data leaves your environment.

```bash
npm install -g opensec-intelligence
ollama pull qwen2.5-coder:14b
opensec scan ./
```

---

## Why it beats everything else

| | Claude Code | OpenSec Intelligence |
|---|---|---|
| Security scanning | ❌ Not built for it | ✅ Purpose-built, 4-agent pipeline |
| Cost | $20/month | **Free forever** |
| Local/private | ❌ Cloud only | ✅ 100% on your machine |
| Fixes vulnerabilities | ❌ | ✅ Writes exact patches |
| Multi-model consensus | ❌ | ✅ 3+ models validate each finding |

| | Existing tools | OpenSec Intelligence |
|---|---|---|
| Models | Single model, trust blindly | 4-agent pipeline, consensus validated |
| Scope | Code files only | Code + Docker + k8s + Terraform + secrets + OpenAPI |
| Cost | $$$  per scan | **Free forever** with Ollama |
| Privacy | Code sent to cloud | **Zero data leaves your machine** |
| False positives | High | Filtered by 0.7+ confidence threshold |
| Fixes | Suggestions only | **Writes the exact patch. Asks approval. Commits.** |
| Cross-file reasoning | None | **Correlates findings across your entire system** |

---

## Quickstart

```bash
# 1. Install
npm install -g opensec-intelligence

# 2. Pull a model (free, runs locally)
ollama pull qwen2.5-coder:14b

# 3. Scan your repo
opensec scan ./

# Quick sweep only
opensec scan ./ --quick

# Maximum accuracy (uses cloud for analyst + consensus)
opensec scan ./ --cloud

# Apply all validated fixes
opensec fix

# Generate HTML security report
opensec report
```

---

## How it works

```
Your codebase
      │
      ▼
┌─────────────┐
│   Scanner   │  Maps attack surface — every .py .js .ts .go .env
│             │  Dockerfile *.yaml *.tf openapi.* *.pem *.key
└──────┬──────┘
       │ structured JSON
       ▼
┌─────────────┐
│   Analyst   │  OWASP Top 10 · injection · auth bypass · secret leakage
│             │  Cross-modal: weak auth + exposed port + public endpoint
└──────┬──────┘  = one elevated CRITICAL finding
       │ findings JSON
       ▼
┌─────────────┐
│  Consensus  │  Re-examines every HIGH/CRITICAL independently
│             │  Confidence score 0.0–1.0 · filters below 0.7
└──────┬──────┘  Adds exploit scenario + CVSS estimate
       │ validated findings
       ▼
┌─────────────┐
│    Fixer    │  Writes exact patches · before/after diff
│             │  Asks approval before each write · git commits
└─────────────┘
```

**The insight:** Single-model tools hallucinate. OpenSec's consensus layer means every HIGH finding was independently confirmed. If 3 models agree — you fix it. If only 1 does — it gets filtered.

---

## The 4 agents

| Agent | Job | Tools | Speed |
|-------|-----|-------|-------|
| **Scanner** | Maps the full attack surface across all file types | glob, grep, file_read, bash, think | Fast |
| **Analyst** | Finds vulnerabilities + cross-modal correlation | file_read, grep, think | Thorough |
| **Consensus** | Independently validates every HIGH/CRITICAL finding | think | Precise |
| **Fixer** | Writes patches, diffs, asks approval, commits | file_read, file_edit, file_write, git_diff, git_commit | Careful |

---

## Skills

OpenSec ships with built-in security knowledge injected into every agent:

| Skill | What it gives agents |
|-------|---------------------|
| `owasp-top10` | Full OWASP Top 10 reference — injection, broken auth, SSRF, and more |
| `secret-patterns` | 200+ regex patterns for API keys, tokens, passwords, certificates |
| `infra-checks` | Dockerfile, Kubernetes, Terraform security rules and misconfig patterns |
| `cross-modal` | Rules for correlating findings across code + infra + config together |

---

## What gets scanned

| Category | File types |
|----------|-----------|
| **Code** | `.py` `.js` `.ts` `.go` `.rb` `.java` `.php` `.rs` `.cpp` `.cs` |
| **Infrastructure** | `Dockerfile` `docker-compose.yml` `*.tf` `*.hcl` `*.toml` |
| **Kubernetes / Config** | `*.yaml` `*.yml` `openapi.*` `*.json` (API specs) |
| **Secrets** | `.env` `.env.*` `*.pem` `*.key` `*.p12` `*.pfx` |
| **CI/CD** | `.github/workflows/*.yml` `.gitlab-ci.yml` `Jenkinsfile` |

---

## Local vs Cloud

| Mode | Cost | Privacy | When to use | Command |
|------|------|---------|-------------|---------|
| **Local** | Free | 100% private | Daily scans, CI, private repos | `opensec scan ./` |
| **Quick** | Free | 100% private | Fast sweep, pre-commit | `opensec scan ./ --quick` |
| **Cloud** | API cost | Analyst + Consensus only sent | Critical audits, max accuracy | `opensec scan ./ --cloud` |

Cloud mode keeps Scanner and Fixer fully local. Only Analyst and Consensus touch the cloud.

---

## MCP Integration

OpenSec exposes an MCP server for IDE and tool integration:

```bash
# Start MCP server
opensec serve --port 4141

# Connect from any MCP client
# http://localhost:4141/v1/stream
```

Available MCP tools:

| Tool | What it does |
|------|-------------|
| `scan_repo` | Trigger a full or quick scan on any path |
| `get_findings` | Retrieve last scan results as structured JSON |
| `apply_fix` | Apply a specific validated fix |
| `get_report` | Generate HTML report of findings |
| `get_status` | Ollama connection, model, mode status |

---

## Highlights

| | Feature | |
|---|---|---|
| 🔒 | **Local-first** | All inference on your hardware via Ollama — zero cloud dependency |
| 🤖 | **4-agent pipeline** | Scanner → Analyst → Consensus → Fixer, fully sequential |
| 🧠 | **Cross-modal analysis** | Code + Docker + k8s + Terraform + secrets analyzed together |
| ✅ | **Consensus scoring** | Every finding validated by multiple models, 0.7+ threshold |
| 🛠 | **20 built-in tools** | Files, grep, glob, bash, git, think, web fetch, RAG, MCP |
| 🔌 | **MCP server** | Exposes scan/fix/report as MCP tools for IDE integration |
| 💾 | **Session persistence** | Resume scans, checkpoints, branches |
| ↩️ | **Undo** | Revert any fix the agent applied |
| 🌐 | **HTTP API** | `opensec serve` exposes REST + SSE endpoints |
| 🎯 | **Effort levels** | `--effort low\|medium\|high\|max` controls scan depth |
| 🔍 | **RAG indexing** | Index your codebase for faster repeated scans |
| 👁️ | **Daemon mode** | Watch files and auto-scan on change |
| 🧩 | **VS Code ready** | Works with VS Code via MCP integration |
| 🖼️ | **Vision** | Attach architecture diagrams for visual security review |
| 🌿 | **Branching** | Fork scan sessions, compare findings across branches |
| 📊 | **Token tracking** | `/cost` for per-scan usage breakdown |

---

## Model recommendations

| Model | Pull command | Best for |
|-------|-------------|----------|
| `qwen2.5-coder:14b` | `ollama pull qwen2.5-coder:14b` | Best overall security analysis |
| `deepseek-r1:14b` | `ollama pull deepseek-r1:14b` | Consensus reasoning |
| `llama3.2:3b` | `ollama pull llama3.2:3b` | Fast scanner, low RAM |
| `codellama:13b` | `ollama pull codellama:13b` | Balanced speed + accuracy |

**Minimum spec:** 8GB RAM for `llama3.2:3b`. 16GB for `qwen2.5-coder:14b`.

---

## CLI reference

```bash
opensec scan [path]           # Full 4-agent scan (default: ./)
opensec scan [path] --quick   # Scanner agent only
opensec scan [path] --cloud   # Cloud models for analyst + consensus
opensec fix                   # Apply fixes from last scan
opensec report                # HTML report of findings
opensec serve [--port 4141]   # Start HTTP + MCP server
opensec -m <model>            # Set Ollama model
opensec --effort <level>      # low | medium | high | max
opensec daemon start          # Watch mode — scan on file change
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security researchers, AI engineers, and open source contributors welcome.

---

<div align="center">

**OpenSec Intelligence** — open source under MIT License.

*By [Prabinder Singh](https://github.com/prabindersinghh)*

</div>
