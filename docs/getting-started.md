# Getting Started

[← Back to README](../README.md)

---

## Prerequisites

- **Node.js** ≥ 20
- **Ollama** — [ollama.ai](https://ollama.ai)

## Install

```bash
# 1. Pull a model
ollama pull qwen3-coder:latest

# 2. Install cmdr
npm install -g cmdr-agent
```

## First Run

```bash
cmdr
```

cmdr launches an interactive REPL. On startup it detects your locally available Ollama models and lets you pick one.

### One-shot mode

Pass a prompt directly to run a single task and exit:

```bash
cmdr "fix the failing tests"
```

### Continue a session

```bash
cmdr -c                       # Resume most recent session
cmdr --resume <session-id>    # Resume a specific session
```

## Verify Installation

```bash
cmdr --version
cmdr --help
```

---

**Next:** [Usage →](usage.md)
