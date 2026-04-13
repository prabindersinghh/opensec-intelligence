# Architecture

[← Back to README](../README.md)

---

## Project Structure

```
bin/cmdr.ts          CLI entry point (REPL, serve, daemon subcommands)
src/
  cli/               REPL, commands, args, spinner, theme, renderer, buddy, daemon
  core/              Agent, AgentRunner, Orchestrator, Team, presets, permissions
  communication/     MessageBus, SharedMemory, TaskQueue
  scheduling/        Semaphore, agent selection strategies
  config/            Config loader, schema, telemetry
  llm/               OllamaAdapter, OpenAIAdapter, AnthropicAdapter, token counter
  memory/            MemoryManager, IndexManager (RAG)
  plugins/           PluginManager, McpClient
  session/           SessionManager, CheckpointManager, BranchManager, compaction, persistence
  tools/             ToolRegistry, ToolExecutor, built-in tools (inc. browser, RAG)
  server/            HTTP API server (REST + SSE)
  vscode/            VS Code extension (separate build)
```

## Key Subsystems

### HTTP Server (`src/server/`)
Node.js `http.createServer` exposing REST and SSE endpoints. Creates a fresh Agent per request in yolo permission mode. Used by `cmdr serve` and the VS Code extension.

### Session Layer (`src/session/`)
- **SessionManager** — JSONL persistence, compaction, cost tracking
- **CheckpointManager** — Save/restore conversation snapshots
- **BranchManager** — Fork, switch, merge conversation branches

### RAG Indexing (`src/memory/`)
- **IndexManager** — File discovery, 80-line chunking, Ollama embeddings (nomic-embed-text), cosine similarity search, JSON index storage

### LLM Adapters (`src/llm/`)
Three adapters implementing the `LLMAdapter` interface with `chat()` and `stream()` returning `AsyncIterable<StreamEvent>`:
- **OllamaAdapter** — Local inference via Ollama API
- **OpenAIAdapter** — OpenAI-compatible APIs
- **AnthropicAdapter** — Anthropic Messages API

All adapters support vision (image blocks) and effort-level configuration.

### VS Code Extension (`src/vscode/`)
Separate package with its own `package.json` and `tsconfig.json`. Communicates with cmdr via the HTTP server. Provides:
- `@cmdr` chat participant
- Inline completions (Ollama FIM)
- Code actions (fix, explain, refactor, write tests)
- Status bar with quick pick menu
- Command palette integration

## Development

```bash
git clone https://github.com/reyyanxahmed/cmdr.git
cd cmdr
npm install
npm run build
node dist/bin/cmdr.js -m qwen3-coder:latest
```

### Watch mode

```bash
npm run dev
```

### Tests

```bash
npm test
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md).

---

[← Back to README](../README.md)
