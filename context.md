# CMDR Codebase Context

> **Model**: Ollama (llama3.1, qwen3-coder, etc.)
> **Author**: Reyyan Ahmed
> **License**: MIT

---

## Project Overview

**cmdr** is a local-first, multi-agent AI coding assistant that runs entirely on your machine via Ollama. No API keys, no cloud. Features include:

- 33+ built-in tools (file_read, file_write, file_edit, bash, grep, glob, git, web-fetch, web-search, think, todo-tool, task-tools, plan-tools, cron-tools, memory, pdf-report, notebook, diagnostics, mcp-resource-tools, rag-search, ask_user, git-log, git-diff, git-commit, git-worktree, graph-tools, bash-security, browser)
- Multi-agent teams (review, full-stack, security audit presets)
- Session persistence with branches and checkpoints
- HTTP API server (`cmdr serve`)
- VS Code extension with chat, inline completions, and code actions
- RAG indexing for codebase search
- Vision input support (--image)
- Effort levels (low/medium/high/max)
- Buddy system (ASCII pet companion)

---

## Directory Structure

```
cmdr/
├── src/
│   ├── agents/           # Multi-agent system (executor, registry, subagent-tool)
│   ├── cli/              # CLI entry, ink UI, args, commands, daemon, buddy
│   ├── commands/         # Slash command loader
│   ├── communication/    # Message bus, task queue, shared memory
│   ├── config/           # Config loading, MCP registry, schema, defaults
│   ├── core/             # Agent, orchestrator, hooks, intent, team, types
│   ├── llm/              # LLM adapters (Ollama, OpenAI, Anthropic), tool parsing
│   ├── memory/           # Memory management, consolidation
│   ├── plugins/          # MCP client, plugin manager
│   ├── scheduling/       # Task scheduling, semaphores
│   ├── server/           # HTTP API server (cmdr serve)
│   ├── session/          # Session management, branches, checkpoints, prompt builder
│   ├── skills/           # Skill injection and loader
│   ├── tools/            # Tool registry and executor
│   │   └── built-in/     # All 33+ tools
│   └── vscode/           # VS Code extension
│       ├── chat/         # Chat panel, message handler, stream client
│       ├── webview/      # Webview hooks and utils
│       ├── extension.ts  # Main extension entry
│       ├── inline-provider.ts
│       ├── code-action.ts
│       ├── status-bar.ts
│       └── server-manager.ts
├── dist/                 # Compiled output
├── docs/                 # Documentation
├── eval/                 # Evaluation datasets and runners
├── bin/cmdr.ts           # CLI entry point
└── package.json
```

---

## Key Entry Points

- **CLI**: `bin/cmdr.ts` → `src/cli/commands.ts`
- **Agent**: `src/core/agent.ts` → `src/core/orchestrator.ts`
- **Server**: `src/server/index.ts`
- **VS Code**: `src/vscode/extension.ts`

---

## Commands & Tools

### Slash Commands
- `/help` - List commands
- `/continue` - Continue last session
- `/exit`, `/quit` - Exit
- `/clear` - Clear session
- `/undo` - Undo last file change
- `/cost` - Show token usage
- `/model` - Switch model
- `/effort` - Set effort level
- `/review` - Review git changes
- `/checkpoint save/restore/list` - Checkpoint management
- `/fork`, `/switch`, `/merge` - Branch management
- `/index`, `/search` - RAG operations
- `/image` - Attach image to prompt
- `/browser` - Toggle browser agent
- `/think` - Think step

### Built-in Tools (33+)
`file_read`, `file_write`, `file_edit`, `glob`, `grep`, `bash`, `git_log`, `git_diff`, `git_commit`, `git_worktree`, `web_fetch`, `web_search`, `think`, `todo_tool`, `task_create`, `task_stop`, `task_list`, `cron_create`, `cron_delete`, `cron_list`, `memory_read`, `memory_write`, `pdf_report`, `notebook_read`, `notebook_edit`, `notebook_run`, `diagnostics`, `mcp_list_resources`, `mcp_read_resource`, `rag_search`, `ask_user`, `graph_impact`, `graph_query`, `graph_review`, `browser`

---

## Configuration

- Config file: `CMDR.md` (project root), `.cmdr.toml` (home), environment variables
- Model: `--model` / `-m` flag, defaults to `qwen3-coder:latest`
- Effort: `--effort low|medium|high|max`
- Port: `cmdr serve --port 4200`

---

## VS Code Extension

The extension (`src/vscode/`) provides:
- Chat participant (`@cmdr`)
- Inline completions (FIM via Ollama)
- Code actions (explain, fix, refactor, test)
- Status bar indicator
- **Goal**: Full custom webview chat panel (like GitHub Copilot Chat)

---

## Development

```bash
npm install
npm run build    # Compile TypeScript
npm run dev      # Watch mode
npm test         # Run tests
npm start        # Run CLI
cmdr serve       # Start HTTP server
```

---

## Current Status

- **Version**: 3.0.0
- **npm downloads**: 1,800+/week
- **VS Code extension**: Basic scaffold exists (v3.0.0), full webview panel under development
- **Active task**: Build full custom chat panel for VS Code extension