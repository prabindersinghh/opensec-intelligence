# CMDR v3.0: The Platform Release (Updated)

> **For**: Claude Opus 4 via Claude Code
> **Repo**: ~/Documents/GitHub/cmdr
> **Current**: v2.5.4 (33 tools, 3 providers, 10 MCP servers, 1,867 weekly npm downloads)
> **Target**: v3.0.0
> **Scope**: 12 features + VS Code extension (anti-Cursor local-first IDE plugin)
> **Sessions**: 6-8 across 3-4 days

---

## ARCHITECTURE: VS CODE IN SAME REPO

Keep flat structure. Add `src/vscode/` as self-contained extension. It talks to `cmdr serve` (Feature 8) via HTTP/SSE. Extension starts the server as a child process on activation, kills on deactivation. Publish to VS Code Marketplace as `cmdr-vscode`.

---

## FEATURE 1: OUTPUT FORMATS

Add `--output-format json|stream-json` to args.ts.

**json**: Suppress terminal UI. After agent completes, write single JSON to stdout:
```json
{"model":"qwen3-coder","response":"...","tools_called":[{"name":"file_write","duration_ms":12}],"files_modified":["hello.txt"],"tokens":{"input":4521,"output":312},"duration_ms":8432,"exit_code":0}
```

**stream-json**: Newline-delimited JSON events:
```
{"type":"text","data":"Let me check...","timestamp":1712345678}
{"type":"tool_use","tool":"glob","input":{"pattern":"**/*.ts"}}
{"type":"tool_result","tool":"glob","output":"src/main.ts"}
{"type":"done","tokens":{"input":8912,"output":1234},"duration_ms":12000}
```

Test: `cmdr -p "hi" --output-format json --fast | python3 -c "import sys,json; print(json.load(sys.stdin)['response'])"`

---

## FEATURE 2: /review COMMAND

Slash command reviewing git diffs. `/review` = HEAD~1..HEAD. `/review --staged` = staged changes. `/review HEAD~3..HEAD` = custom range. `/review src/` = directory scope. Reads diff, wraps in structured prompt (logic errors, security, performance, style, error handling), sends as user message.

---

## FEATURE 3: EFFORT LEVELS

Replace `--think/--no-think/--fast` with `--effort low|medium|high|max`:

| Level | think | temp | num_predict | Use case |
|---|---|---|---|---|
| low | false | 0.1 | default | Trivial, fast |
| medium | model default | 0.3 | default | Normal |
| high | true | 0.3 | default | Complex |
| max | true | 0.5 | 2x default | Deep analysis |

Keep `--fast` as alias for `--effort low`. Add `/effort` slash command.

---

## FEATURE 4: CHECKPOINTING

`CheckpointManager`: save(label, messages, model), restore(id), list(), delete(id). Persist to `~/.cmdr/sessions/{sessionId}/checkpoints/*.json`. Slash commands: `/checkpoint save "before refactor"`, `/checkpoint list`, `/checkpoint restore <id>`. Auto-checkpoint before every compaction.

---

## FEATURE 5: RAG / DOCUMENT INDEXING

`IndexManager` using Ollama `/api/embed` with `nomic-embed-text`. Store in SQLite via `better-sqlite3`. 512-token chunks, 64 overlap. Cosine similarity search.

Create `rag_search` tool. Commands: `/index src/`, `/index status`, `/index clear`, `/search "auth flow"`. Auto-index from `.cmdr/index.json`.

Add `better-sqlite3` as optional dependency. If not installed, `/index` prints install instructions.

---

## FEATURE 6: VISION INPUT

`--image`/`-i` flag. Convert to base64. Ollama: `images` field. OpenAI/Anthropic: `image_url` content blocks. Works with llava, gemma4, minicpm-v. REPL: `/image path.png` loads for next prompt.

```bash
cmdr --image screenshot.png "What's wrong with this UI?"
```

---

## FEATURE 7: CONVERSATION BRANCHING

`BranchManager`: fork(name, messages), switch(id), list(), merge(id, targetId), delete(id). Commands: `/fork "try-A"`, `/branches`, `/switch <id>`, `/merge <id>`.

---

## FEATURE 8: cmdr serve

```bash
cmdr serve --port 4200 --model qwen3-coder
```

`POST /v1/chat` (JSON), `POST /v1/stream` (SSE), `GET /health`, `GET /v1/models`. Node.js `http.createServer`, no Express. This bridges the VS Code extension.

---

## FEATURE 9: SDK / LIBRARY MODE

Export from package entry: Agent, AgentRunner, OllamaAdapter, OpenAIAdapter, AnthropicAdapter, createAdapter, ToolRegistry, defineTool, SessionManager, MemoryManager, globalEventBus, all types.

```typescript
import { Agent, OllamaAdapter } from 'cmdr-agent';
```

---

## FEATURE 10: BUDDY SYSTEM

Deterministic ASCII pet from machine ID hash. 16 species. XP: sessions +5, tool calls +1, tasks +10. Achievements. Startup greeting. `--no-buddy` to disable.

```
  /\_/\
 ( o.o )   Ember the Fox (Lv.3, 245 XP)
  > ^ <    "Ready to code!"
```

---

## FEATURE 11: DAEMON MODE

```bash
cmdr daemon start --watch src/ --on-change "npm run lint --fix"
cmdr daemon status
cmdr daemon stop
```

fs.watch, cron tasks, auto memory consolidation. Config in `.cmdr.toml [daemon]`.

---

## FEATURE 12: BROWSER AGENT

Playwright tools (optional, `--browser` flag): browser_open, browser_screenshot, browser_click, browser_fill, browser_text. `playwright-core` as optional peer dep.

---

## FEATURE 13: VS CODE EXTENSION

### Core Architecture

Extension starts `cmdr serve` as child process. All communication via HTTP/SSE to localhost:4200.

### Files: src/vscode/

**extension.ts**: Activate = start server + register all providers. Deactivate = kill server.

**server-manager.ts**: `spawn('node', ['dist/bin/cmdr.js', 'serve', '--port', '4200'])`. Health check polling. Auto-restart on crash.

**chat-provider.ts**: VS Code Chat API participant `@cmdr`. On request: read active editor file as context, POST to /v1/stream, stream markdown back. Include workspace folder structure in system context.

**inline-provider.ts**: `InlineCompletionItemProvider`. On trigger: extract prefix (text before cursor) and suffix (text after cursor). POST to Ollama `/api/generate` with FIM format. Model: `qwen2.5-coder:7b` (configurable). Debounce 300ms. Cancel in-flight on new keystroke. Temp 0.1, max 128 tokens, stop at `\n\n`.

**code-action.ts**: `CodeActionProvider`. When diagnostics present: "Fix with cmdr". Always available: "Explain this code", "Refactor this code", "Write tests for this". Each sends selection + context to server, applies result as workspace edit.

**status-bar.ts**: `$(hubot) cmdr: qwen3-coder | effort: medium | connected`. Click: quick pick for model switch, effort change, toggle completions.

**commands.ts**: Command palette entries: cmdr.chat, cmdr.explain, cmdr.refactor, cmdr.writeTests, cmdr.fixDiagnostic, cmdr.review, cmdr.switchModel.

### Extension Settings

```json
{
  "cmdr.model": "qwen3-coder",
  "cmdr.completionModel": "qwen2.5-coder:7b",
  "cmdr.effort": "medium",
  "cmdr.ollamaUrl": "http://localhost:11434",
  "cmdr.inlineCompletions": true,
  "cmdr.autoStart": true,
  "cmdr.port": 4200
}
```

### package.json (extension manifest)

```json
{
  "name": "cmdr-vscode",
  "displayName": "cmdr - Local AI Coding Assistant",
  "description": "Local-first alternative to Copilot. Your models, your machine, your data.",
  "version": "0.1.0",
  "publisher": "reyyanxahmed",
  "engines": {"vscode": "^1.90.0"},
  "categories": ["AI", "Programming Languages"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "chatParticipants": [{"id":"cmdr.chat","name":"cmdr","description":"Local AI assistant","isSticky":true}],
    "commands": [
      {"command":"cmdr.chat","title":"cmdr: Open Chat"},
      {"command":"cmdr.explain","title":"cmdr: Explain Selection"},
      {"command":"cmdr.refactor","title":"cmdr: Refactor Selection"},
      {"command":"cmdr.writeTests","title":"cmdr: Write Tests"},
      {"command":"cmdr.fixDiagnostic","title":"cmdr: Fix Error"},
      {"command":"cmdr.review","title":"cmdr: Review Changes"},
      {"command":"cmdr.switchModel","title":"cmdr: Switch Model"}
    ],
    "configuration": {
      "title": "cmdr",
      "properties": {
        "cmdr.model": {"type":"string","default":"qwen3-coder"},
        "cmdr.completionModel": {"type":"string","default":"qwen2.5-coder:7b"},
        "cmdr.effort": {"type":"string","enum":["low","medium","high","max"],"default":"medium"},
        "cmdr.ollamaUrl": {"type":"string","default":"http://localhost:11434"},
        "cmdr.inlineCompletions": {"type":"boolean","default":true},
        "cmdr.port": {"type":"number","default":4200}
      }
    }
  }
}
```

---

## EXECUTION ORDER

### Session 1: Output + Review + Effort (1.5h)
1-3. Output formats, /review, effort levels. Build, commit.

### Session 2: Checkpointing + RAG (2h)
4-5. CheckpointManager, IndexManager + rag_search tool. Build, commit.

### Session 3: Vision + Branching + Server (2h)
6-8. --image flag, BranchManager, cmdr serve. Build, commit.

### Session 4: SDK + Buddy + Daemon + Browser (2h)
9-12. SDK exports, BuddyManager, CmdrDaemon, browser tools. Build, commit.

### Session 5: VS Code Extension (2-3h)
13. Full extension: chat participant, inline completions, code actions, status bar. Build .vsix.

### Session 6: Ship (1h)
Version bump v3.0.0. README. Eval suite. Publish npm + vsix. Launch post.

---

## SUCCESS CRITERIA

1. `cmdr -p "hi" --output-format json` = valid JSON
2. `/review` = code review of last commit
3. `--effort max` = extended reasoning
4. `/checkpoint save` + `/checkpoint restore` = works
5. `/index src/` + `/search "agent"` = relevant chunks
6. `cmdr --image screen.png "fix"` = works with llava
7. `/fork` + `/switch` = separate states
8. `curl localhost:4200/health` = OK
9. `import { Agent } from 'cmdr-agent'` = works
10. Buddy on startup
11. `cmdr daemon start` = watches files
12. `cmdr --browser` = Playwright tools
13. VS Code: @cmdr chat + inline completions + code actions

---

*v1.0: Terminal agent. v2.0: Multi-agent platform. v3.0: Complete local-first AI dev environment.*
*The VS Code extension turns 1,867 weekly CLI downloads into 100,000+ IDE installs. Ship it.*