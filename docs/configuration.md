# Configuration

[← Back to README](../README.md)

---

## Config Files

| Scope | Path |
|-------|------|
| User | `~/.cmdr/config.toml` |
| Project | `.cmdr.toml` |

```toml
defaultModel = "qwen3-coder:latest"
ollamaUrl = "http://localhost:11434"

[effort]
default = "medium"   # low, medium, high, max

[spinner]
speed = 150

[buddy]
enabled = true       # set false to disable the buddy companion

[telemetry]
enabled = false      # opt-in local-only usage stats
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CMDR_MODEL` | `qwen2.5-coder:14b` | Default model |
| `CMDR_OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |

## Permission Modes

| Mode | Behavior |
|------|----------|
| **normal** (default) | Read-only tools auto-approved; write/bash require confirmation |
| **yolo** | All tools auto-approved (`--dangerously-skip-permissions`) |
| **strict** | All tools require approval (`/permissions strict`) |

## CMDR.md

Create a `CMDR.md` file in your project root to give cmdr project-specific instructions:

```markdown
# CMDR Instructions

## Project Overview
A TypeScript web app using Next.js and Prisma.

## Code Style
- Use bun instead of npm
- Prefer functional components with hooks
- Always add JSDoc comments

## Testing
Run `vitest` after every change.

## Rules
- Never modify files in /core without asking
- Always run linting before committing
```

You can also use `.cmdr/instructions.md` — both files are loaded and concatenated.

## Persistent Storage

cmdr stores data under `~/.cmdr/`:

| Path | Description |
|------|-------------|
| `~/.cmdr/config.toml` | User configuration |
| `~/.cmdr/sessions/` | Session data, checkpoints, branches |
| `~/.cmdr/buddy.json` | Buddy companion state (XP, level, achievements) |
| `~/.cmdr/index/` | RAG document index cache |
| `~/.cmdr/daemon/` | Daemon PID files |

## Server Configuration

When running `cmdr serve`, the server binds to `127.0.0.1:3120` by default:

```bash
cmdr serve --port 8080 --host 0.0.0.0 --model qwen3-coder:latest
```

## VS Code Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cmdr.model` | `qwen3-coder:latest` | Model for chat and code actions |
| `cmdr.completionModel` | `qwen2.5-coder:7b` | Model for inline completions |
| `cmdr.effort` | `medium` | Default effort level |
| `cmdr.ollamaUrl` | `http://localhost:11434` | Ollama server URL |
| `cmdr.inlineCompletions` | `true` | Enable inline completions |
| `cmdr.autoStart` | `true` | Auto-start cmdr serve on activation |
| `cmdr.port` | `3120` | Server port |

---

**Next:** [Benchmarks →](benchmarks.md)
