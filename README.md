<div align="center">

<pre>
 ██████╗ ██████╗ ███████╗███╗   ██╗███████╗███████╗ ██████╗ 
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔════╝██╔════╝ 
██║   ██║██████╔╝█████╗  ██╔██╗ ██║███████╗█████╗  ██║      
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║╚════██║██╔══╝  ██║      
╚██████╔╝██║     ███████╗██║ ╚████║███████║███████╗╚██████╗ 
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚══════╝╚══════╝ ╚═════╝ 
</pre>

**The Claude Code of security. Local-first. Free forever.**

> **Built by [Prabinder Singh](https://github.com/prabindersinghh)**
> B.Tech CS, Thapar Institute · Founder, Leorit.ai
> [github.com/prabindersinghh](https://github.com/prabindersinghh)

[![npm version](https://img.shields.io/npm/v/opensec-intelligence.svg)](https://www.npmjs.com/package/opensec-intelligence)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Powered by Ollama](https://img.shields.io/badge/powered%20by-Ollama-blue)](https://ollama.com)

</div>

---

## Quickstart

```bash
npm install -g opensec-intelligence
ollama pull qwen2.5-coder:14b
opensec scan ./
```

---

## Why OpenSec Intelligence

- **Four-agent pipeline.** Scanner maps the attack surface. Analyst finds the vulnerabilities. Consensus validates each finding independently and scores confidence. Fixer writes the exact patch. Nothing gets through that one model missed.
- **Cross-modal analysis.** Code, Dockerfiles, Kubernetes YAML, Terraform, `.env` secrets, and OpenAPI specs are analyzed together. A weak auth bug in Python + an exposed port in Docker + a public endpoint in OpenAPI gets combined into one elevated finding — automatically.
- **Zero cost by default.** Runs entirely on your machine with Ollama. No API keys. No data leaves your environment. Cloud mode is available when you need maximum accuracy.

---

## Local vs Cloud

| Mode | When to use | Command |
|------|-------------|---------|
| **Local** (free) | Daily scans, CI pipelines, private codebases | `opensec scan ./` |
| **Cloud** (hybrid) | Maximum accuracy on critical audits | `opensec scan ./ --cloud` |

Cloud mode sends only the Analyst and Consensus steps to Anthropic or OpenAI — Scanner and Fixer always stay local.

---

## The 4 agents

| Agent | Job | Speed |
|-------|-----|-------|
| **Scanner** | Maps the full attack surface — every code, config, secret, and infra file | Fast |
| **Analyst** | OWASP Top 10, Dockerfiles, k8s YAML, `.env` secrets, cross-file correlation | Thorough |
| **Consensus** | Re-examines every HIGH/CRITICAL finding independently, scores confidence 0.0–1.0, filters below 0.7 | Precise |
| **Fixer** | Writes exact patches with before/after diffs, asks approval before each write | Careful |

---

## What gets scanned

| Category | Files |
|----------|-------|
| Code | `.py` `.js` `.ts` `.go` `.rb` `.java` `.php` `.rs` |
| Infrastructure | `Dockerfile` `docker-compose.yml` `*.tf` `*.hcl` |
| Kubernetes / Config | `*.yaml` `*.yml` `openapi.*` |
| Secrets | `.env` `.env.*` `*.pem` `*.key` |

---

## Model recommendations

| Model | Best for |
|-------|----------|
| `qwen2.5-coder:14b` | Security analysis — best overall |
| `deepseek-r1:14b` | Consensus reasoning |
| `llama3.2:3b` | Fast scanner, low resource |
| `codellama:13b` | Balanced speed and accuracy |

---

## MCP setup

```bash
opensec serve --port 4141
# Connect your MCP client to: http://localhost:4141/v1/stream
```

---

<sub>OpenSec Intelligence is open source under the MIT License. Infrastructure powered by cmdr.</sub>
