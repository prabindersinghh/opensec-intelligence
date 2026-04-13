# Usage

[← Back to README](../README.md)

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `-m, --model <name>` | Set the Ollama model |
| `-u, --ollama-url <url>` | Ollama server URL |
| `-p, --prompt <text>` | Run a single prompt and exit |
| `-r, --resume <id>` | Resume a previous session |
| `-c, --continue` | Resume most recent session for this directory |
| `-t, --team <preset>` | Run with a multi-agent team (`review`, `fullstack`, `security`) |
| `-e, --effort <level>` | Set effort level: `low`, `medium`, `high`, `max` |
| `-i, --image <path>` | Attach an image to the prompt (base64-encoded) |
| `--fast` | Alias for `--effort low` |
| `--browser` | Enable Playwright browser tools |
| `--no-buddy` | Disable the buddy companion |
| `--cwd <path>` | Set working directory |
| `--verbose` | Print full tool output |
| `--dangerously-skip-permissions` | Auto-approve all tool calls |
| `--max-turns <n>` | Limit agent tool-call turns |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Subcommands

### `cmdr serve`

Start an HTTP API server.

```bash
cmdr serve --port 3120 --host 127.0.0.1 --model qwen3-coder:latest
```

| Flag | Default | Description |
|------|---------|-------------|
| `--port <n>` | `3120` | Server port |
| `--host <addr>` | `127.0.0.1` | Bind address |
| `-m, --model <name>` | — | Model to use |

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat` | Send a message, get a JSON response |
| `POST` | `/v1/stream` | Send a message, get SSE stream |
| `GET` | `/health` | Health check (status, model, uptime) |
| `GET` | `/v1/models` | List available models |

### `cmdr daemon`

Background file watcher with command execution.

```bash
cmdr daemon start --watch src --on-change "npm test"
cmdr daemon status
cmdr daemon stop
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/model <name>` | Switch model |
| `/models` | List available Ollama models |
| `/status` | Show session info |
| `/context` | Show context window usage |
| `/compact` | Manually trigger compaction |
| `/cost` | Show token usage breakdown |
| `/undo` | Revert the last file change made by the agent |
| `/diff` | Show git diff |
| `/review [staged\|range\|path]` | AI-powered code review |
| `/effort <level>` | Set effort level (`low`, `medium`, `high`, `max`) |
| `/fast` | Alias for `/effort low` |
| `/image <path>` | Attach an image to the next prompt |
| `/checkpoint save\|list\|restore\|delete` | Manage conversation checkpoints |
| `/fork [name]` | Fork the conversation into a branch |
| `/branches` | List conversation branches |
| `/switch <branch>` | Switch to a branch |
| `/merge <branch>` | Merge a branch into current |
| `/index [path]` | Index a directory for RAG search |
| `/search <query>` | Semantic search over indexed documents |
| `/team [preset]` | Switch to a multi-agent team |
| `/agents` | Show active agents and status |
| `/tasks` | Show task queue status |
| `/config` | View configuration |
| `/plugin list` | List loaded plugins |
| `/mcp list` | List MCP server connections |
| `/session save` | Save current session |
| `/session resume <id>` | Resume a session |
| `/sessions` | List saved sessions |
| `/permissions [mode]` | View/set permission mode |
| `/init` | Create CMDR.md template |
| `/clear` | Clear conversation |
| `/quit` | Exit |

## Built-in Tools

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands with timeout and error handling |
| `file_read` | Read file contents with offset/limit support |
| `file_write` | Create or overwrite files (auto-creates directories) |
| `file_edit` | Surgical string replacement in files |
| `grep` | Regex search (uses ripgrep when available) |
| `glob` | Find files by pattern |
| `git_diff` | Show working tree, staged, or range changes |
| `git_log` | Recent commit history |
| `git_commit` | Stage and commit files |
| `git_branch` | Create, switch, or list branches |
| `web_fetch` | Fetch a URL (SSRF-protected) |
| `ask_user` | Ask the user a question |
| `think` | Extended reasoning scratchpad (no side effects) |
| `rag_search` | Semantic search over indexed documents |
| `browser_open` | Open a URL in a browser (requires `--browser`) |
| `browser_screenshot` | Take a screenshot of the current page |
| `browser_click` | Click an element by CSS selector |
| `browser_fill` | Fill an input field |
| `browser_text` | Extract text from the page |

## Effort Levels

Control how much reasoning the model applies:

| Level | Thinking | Temperature | Description |
|-------|----------|-------------|-------------|
| `low` | Off | 0.3 | Fast responses, minimal reasoning |
| `medium` | Off | 0.7 | Balanced (default) |
| `high` | On | 0.7 | Extended thinking enabled |
| `max` | On | 1.0 | Maximum reasoning with higher token budget |

```bash
cmdr --effort max "design a caching layer"
cmdr --fast "rename x to count"
```

## Vision

Attach images to prompts for multimodal analysis:

```bash
# CLI flag
cmdr --image screenshot.png "what's wrong with this UI?"

# In REPL
/image path/to/diagram.png
> explain this architecture
```

Supported by Ollama (images field), OpenAI (image_url), and Anthropic (image content blocks).

---

**Next:** [Multi-Agent Teams →](multi-agent.md)
