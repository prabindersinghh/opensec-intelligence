<div align="center">

<pre>
 ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗ 
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔════╝ 
██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║      
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ██║      
╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗ 
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝ 
</pre>

**The Claude Code of security. Local-first. Model-agnostic. Free forever with Ollama.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![Ollama](https://img.shields.io/badge/powered%20by-Ollama-blue)](https://ollama.com)

</div>

---

## What it does

OpenSec Intelligence is a local-first AI security engine that finds, validates, and fixes vulnerabilities across your entire codebase in one command. It runs four specialized agents in sequence — Scanner, Analyst, Consensus, and Fixer — across code, infrastructure, configuration, and secrets simultaneously. No cloud required; runs free on any machine with Ollama.

---

## Quick start

```bash
# Install
npm install -g opensec-intelligence

# Pull a recommended model
ollama pull qwen2.5-coder:14b

# Scan your project
opensec scan ./
```

---

## Two modes

### Local (free)
Runs entirely on your machine using Ollama. No API keys. No data leaves your environment.

```bash
opensec scan ./                    # Full 4-agent scan, local model
opensec scan ./ --quick            # Scanner agent only, <2 min
```

**Recommended models:** `qwen2.5-coder:14b`, `deepseek-r1:14b`, `codellama:13b`

### Cloud (hybrid)
Uses your Anthropic or OpenAI key for the Analyst and Consensus agents only — the most reasoning-intensive steps. Scanner and Fixer stay local.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
opensec scan ./ --cloud            # Cloud-powered analysis
```

---

## The 4 agents

| Agent | Role | Output |
|-------|------|--------|
| **Scanner** | Maps the full attack surface — finds all code, config, secret, and infra files | Structured JSON: file paths + risk categories |
| **Analyst** | Cross-modal vulnerability analysis — OWASP Top 10, Dockerfiles, k8s YAML, .env secrets, cross-file correlation | JSON findings: `{file, line_start, line_end, severity, type, cross_refs[]}` |
| **Consensus** | Re-examines every HIGH/CRITICAL finding independently. Scores confidence 0.0–1.0. Filters anything below 0.7 | Validated findings with `exploit_scenario` + `cvss_estimate` |
| **Fixer** | Writes exact code fixes with before/after diffs. Asks for human approval before each write. Summarizes via `git diff` | Patched files + change summary |

---

## Supported file types

| Category | File types |
|----------|-----------|
| Code | `.py`, `.js`, `.ts`, `.go`, `.rb`, `.java`, `.php`, `.rs` |
| Infrastructure | `Dockerfile`, `docker-compose.yml`, `*.tf` (Terraform), `*.hcl` |
| Kubernetes / Config | `*.yaml`, `*.yml`, `openapi.*`, `*.json` (configs) |
| Secrets | `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12` |

---

## Model recommendations (Ollama)

| Use case | Recommended model |
|----------|------------------|
| Best overall | `qwen2.5-coder:14b` |
| Deep reasoning | `deepseek-r1:14b` |
| Fast sweep | `qwen2.5-coder:7b` |
| Low RAM (<8 GB) | `codellama:7b` |

---

## All commands

```bash
opensec scan [path]           Full 4-agent security scan
opensec scan [path] --quick   Scanner agent only (fast sweep)
opensec scan [path] --cloud   Cloud model for analyst + consensus
opensec fix                   Apply fixer agent to last scan results
opensec report                Generate HTML findings report
opensec                       Interactive REPL (general security assistant)
```

---

## Credits

Built on **[cmdr](https://github.com/reyyanxahmed/cmdr)** by [Reyyan Ahmed](https://github.com/reyyanxahmed) — an open-source multi-agent coding tool for the terminal, powered by Ollama. OpenSec Intelligence extends cmdr with a security-specialized agent pipeline, new CLI subcommands, and the OPENSEC.md configuration layer.
