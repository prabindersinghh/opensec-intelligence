# CMDR Phase 2: Multi-Agent + UI Overhaul + Extensions

> **For**: Claude Opus 4 via Claude Code
> **Repo**: ~/Documents/GitHub/cmdr
> **Current version**: v1.3.0 (Grade S: 42/50 eval, 95.7% HumanEval)
> **Target version**: v2.0.0
> **Reference**: https://github.com/google-gemini/gemini-cli (architecture, subagents, A2A, UI patterns, theming, extensions)
> **Time estimate**: 5-7 Claude Code sessions across 2-3 days

---

## OVERVIEW

Phase 2 transforms cmdr from a single-agent coding tool into a multi-agent platform with:
- Subagents as tools (from Gemini CLI's architecture)
- A2A protocol for remote agent communication
- Complete UI overhaul with theming, status bar, collapsible tool output
- Custom commands from markdown files
- Extension system for distributable plugins
- Plan mode for safe task planning
- Hierarchical context files (CMDR.md at multiple levels)

---

## PART 1: SUBAGENT SYSTEM

### 1.1 Architecture

Subagents are specialized agents that run in their own context window and are exposed to the main agent as callable tools. This is Gemini CLI's exact pattern.

```
Main Agent (solo-coder)
  |
  |-- calls tool "investigator" (which is a subagent)
  |     |-- runs in separate AgentRunner with own system prompt
  |     |-- has restricted tool set (read-only)
  |     |-- returns findings as tool result
  |     |-- its conversation history does NOT pollute main agent's context
  |
  |-- calls tool "reviewer" (another subagent)
  |     |-- separate context, separate system prompt
  |     |-- read-only tools only
  |     |-- returns review as tool result
  |
  |-- continues with main task using subagent results
```

### 1.2 Agent Definition Format

Subagents are defined as markdown files with YAML frontmatter (matching Gemini CLI's format):

```markdown
---
name: investigator
description: Deep codebase analysis, reverse engineering, and dependency mapping.
kind: local
tools:
  - file_read
  - grep
  - glob
  - git_log
  - git_diff
  - think
model: null          # null = use same model as main agent
temperature: 0.3
max_turns: 15
---

You are a Codebase Investigator. Your job is to deeply analyze code and report findings.

## Your approach:
1. Start with glob to understand project structure
2. Use grep to find patterns and connections
3. Read key files to understand architecture
4. Map dependencies between modules
5. Report your findings clearly and concisely

## Rules:
- You are READ-ONLY. Do not create, modify, or delete any files.
- Be thorough but focused. Don't read every file, just the relevant ones.
- When reporting, use file_path:line_number references.
- Organize findings into sections: Architecture, Dependencies, Key Patterns, Issues Found.
```

### 1.3 Loading Locations

Three sources, in priority order (project overrides user overrides bundled):

```
.cmdr/agents/*.md          # Project-level (shared with team)
~/.cmdr/agents/*.md        # User-level (personal agents)
src/agents/bundled/*.md     # Bundled with cmdr (shipped defaults)
```

### 1.4 Implementation Files

**Create `src/agents/registry.ts`**:

```typescript
interface AgentDefinition {
  name: string;                    // Unique slug: lowercase, hyphens, underscores
  description: string;             // Visible to main agent for delegation decisions
  kind: 'local' | 'remote';       // local = in-process, remote = A2A protocol
  tools: string[];                 // Restricted tool set for this agent
  model: string | null;            // null = inherit from main agent
  temperature: number;
  maxTurns: number;
  systemPrompt: string;            // The markdown body after frontmatter
  source: 'bundled' | 'user' | 'project';
  filePath: string;                // Where the .md file was loaded from
}

class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();

  // Load all agent definitions from all three sources
  async loadAll(projectRoot: string): Promise<void>;

  // Get a specific agent by name
  get(name: string): AgentDefinition | undefined;

  // List all registered agents
  list(): AgentDefinition[];

  // Parse a markdown file into an AgentDefinition
  private parseAgentFile(content: string, filePath: string, source: string): AgentDefinition;

  // Register a runtime-defined agent (for programmatic use)
  register(def: AgentDefinition): void;
}
```

**Create `src/agents/executor.ts`**:

```typescript
class AgentExecutor {
  // Run a subagent to completion with its own isolated context
  async execute(
    definition: AgentDefinition,
    task: string,
    parentModel: string,
    ollamaAdapter: OllamaAdapter,
    toolRegistry: ToolRegistry,
    toolExecutor: ToolExecutor,
  ): Promise<{ output: string; tokensUsed: { in: number; out: number }; turns: number }> {
    // 1. Create a restricted ToolRegistry with only the agent's allowed tools
    const agentTools = new ToolRegistry();
    for (const toolName of definition.tools) {
      const tool = toolRegistry.get(toolName);
      if (tool) agentTools.register(tool);
    }

    // 2. Create Agent with the subagent's config
    const agentConfig = {
      name: definition.name,
      model: definition.model ?? parentModel,
      systemPrompt: definition.systemPrompt,
      tools: definition.tools,
      maxTurns: definition.maxTurns,
      temperature: definition.temperature,
    };

    // 3. Create a fresh AgentRunner (isolated context)
    const agent = new Agent(agentConfig, ollamaAdapter, agentTools, toolExecutor);

    // 4. Run to completion, collect all text output
    let output = '';
    for await (const event of agent.stream(task)) {
      if (event.type === 'text') output += event.data;
    }

    return { output, tokensUsed: { in: 0, out: 0 }, turns: 0 };
  }
}
```

**Create `src/agents/subagent-tool.ts`**:

```typescript
// This wraps a subagent as a standard tool that the main agent can call
import { z } from 'zod';

export function createSubagentTool(definition: AgentDefinition, executor: AgentExecutor) {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: z.object({
      task: z.string().describe('The specific task or question to delegate to this agent'),
    }),
    permission: 'read' as const,  // Subagent tools are always "safe" from HITL perspective
    execute: async (input: { task: string }, context: ToolContext) => {
      const result = await executor.execute(
        definition,
        input.task,
        context.model,     // Parent's current model
        context.adapter,
        context.toolRegistry,
        context.toolExecutor,
      );
      return { data: result.output, isError: false };
    },
  };
}
```

### 1.5 `@agent` Syntax

When the user types `@investigator explain the auth flow`, the REPL:
1. Detects the `@name` prefix
2. Looks up `name` in the AgentRegistry
3. Injects a system note into the user message: `[System: The user has requested the "${name}" subagent. Please immediately call the "${name}" tool with the user's task.]`
4. The main agent calls the subagent tool, which runs in isolation

### 1.6 Built-in Subagents

Ship 4 bundled subagents in `src/agents/bundled/`:

**investigator.md** — Deep codebase analysis (read-only tools: file_read, grep, glob, git_log, think)
**reviewer.md** — Code review specialist (read-only, reviews recent changes)
**planner.md** — Task decomposition into steps (think tool only, no file ops)
**security.md** — Security audit (read-only, reports vulnerabilities)

### 1.7 Slash Commands

```
/agents              — List all registered agents with description and source
/agent info <name>   — Show agent's full system prompt and config
/agent create <name> — Scaffold a new agent .md file in .cmdr/agents/
```

---

## PART 2: THEMED UI SYSTEM

### 2.1 Theme Structure

Replace cmdr's hardcoded colors in `src/cli/theme.ts` with a structured theme system:

```typescript
interface CmdrTheme {
  name: string;
  type: 'dark' | 'light' | 'custom';

  background: {
    primary: string;       // Main background (#000000 for AMOLED)
    secondary: string;     // Slightly lighter for cards/panels (#0A0A0A)
    input: string;         // Input area background (#0F0F0F)
  };

  text: {
    primary: string;       // Main text (#E0E0E0)
    secondary: string;     // Dim text for metadata (#666666)
    accent: string;        // Highlighted text, links (#BF40FF purple)
    muted: string;         // Very dim text (#444444)
  };

  syntax: {
    keyword: string;       // Language keywords (#FF6B9D)
    string: string;        // String literals (#98C379)
    number: string;        // Numbers (#D19A66)
    comment: string;       // Comments (#5C6370)
    function: string;      // Function names (#61AFEF)
    type: string;          // Type names (#E5C07B)
  };

  status: {
    success: string;       // Pass, complete (#00FF41 green)
    error: string;         // Fail, error (#FF4444)
    warning: string;       // Caution (#FFB800)
    info: string;          // Neutral info (#00BFFF cyan)
    thinking: string;      // Spinner/thinking state (#BF40FF)
  };

  tool: {
    name: string;          // Tool name color (#00BFFF)
    executing: string;     // While running (#FFB800)
    result: string;        // Collapsed result (#666666)
    border: string;        // Tool output border (#333333)
  };

  ui: {
    border: string;        // UI borders, separators (#333333)
    prompt: string;        // The ❯ prompt character (#00FF41)
    banner: string;        // ASCII art gradient start (#00FF41)
    bannerAccent: string;  // ASCII art gradient end (#BF40FF)
    badge: string;         // Permission badges (#FF6B9D)
    scrollbar: string;     // Scrollbar track (#222222)
  };
}
```

### 2.2 Built-in Themes

Ship 5 themes:

```typescript
const THEMES: Record<string, CmdrTheme> = {
  'cmdr-dark': { /* AMOLED black + green + purple (current default) */ },
  'cmdr-light': { /* Light mode with dark text */ },
  'monokai': { /* Monokai-inspired dark theme */ },
  'nord': { /* Nord color palette */ },
  'solarized-dark': { /* Solarized dark */ },
};
```

### 2.3 Custom Themes

Users define custom themes in `.cmdr.toml` or `~/.cmdr/config.toml`:

```toml
[ui.theme]
name = "my-theme"
type = "dark"

[ui.theme.background]
primary = "#1a1b26"
secondary = "#24283b"

[ui.theme.text]
primary = "#c0caf5"
accent = "#7aa2f7"

[ui.theme.status]
success = "#9ece6a"
error = "#f7768e"
```

### 2.4 `/theme` Slash Command

```
/theme              — Show current theme and list available themes
/theme <name>       — Switch to a named theme
/theme preview      — Preview all themes with sample output
```

### 2.5 Footer Status Bar

Add a persistent status bar at the bottom of the terminal (Gemini CLI style):

```
 qwen3-coder:latest │ 12.4k/65k tokens (19%) │ .cmdr/agents: 4 │ CMDR.md loaded │ ~/projects/cmdr
```

Components:
- Model name (clickable to switch via /model)
- Token usage with context % bar
- Loaded agents count
- CMDR.md indicator
- Current working directory

### 2.6 Collapsible Tool Output

Tool results should render as collapsible sections:

```
  ▶ file_read  src/main.ts (142 lines)                     # Collapsed (default)
  ▼ file_read  src/main.ts (142 lines)                     # Expanded on click/keypress
    1 │ import { startRepl } from './cli/repl.js';
    2 │ import { parseArgs } from './cli/args.js';
    ...
```

In the current non-Ink readline REPL, implement this as:
- Default: single-line summary (already done)
- `--verbose` flag or `/verbose` toggle: show full output
- Future (Ink): actual collapsible React components

### 2.7 Tool Status Lifecycle

Show distinct indicators for each tool state:

```
  ◌ file_read  src/main.ts          # Pending (queued)
  ⟳ file_read  src/main.ts          # Executing (spinner)
  ✓ file_read  src/main.ts (142 ln) # Success (green)
  ✗ bash  npm test (exit 1)         # Error (red)
  ⊘ file_write  denied by user      # Cancelled (dim)
```

### 2.8 Markdown Toggle

Add `Alt+M` (or `/raw`) to toggle between rendered markdown and raw markdown output. When raw mode is active, show an indicator above the input prompt:

```
  raw markdown mode (Alt+M to toggle)
  ❯ 
```

---

## PART 3: CUSTOM COMMANDS

### 3.1 Format

Custom commands are markdown files in `.cmdr/commands/` or `~/.cmdr/commands/`:

```markdown
---
name: review
description: Review code for quality and security issues
---

You are a senior engineer performing a code review. Review the following code for:
- Logic errors and edge cases
- Security vulnerabilities
- Performance issues
- Code style violations

Focus specifically on: {{args}}

Context:
@{src/main.ts}
```

### 3.2 Template Variables

- `{{args}}` — Everything after the command name (e.g., `/review error handling` -> `error handling`)
- `@{path/to/file}` — Inline file content (read at command execution time)
- `!{shell command}` — Inline shell command output (e.g., `!{git diff --cached}`)

### 3.3 Loading and Execution

```typescript
class CommandLoader {
  // Discover .md files in .cmdr/commands/ and ~/.cmdr/commands/
  async loadAll(projectRoot: string): Promise<CustomCommand[]>;

  // Execute a custom command
  async execute(name: string, args: string): Promise<string>;
    // 1. Load the .md file
    // 2. Replace {{args}} with user's arguments
    // 3. Replace @{path} with file contents
    // 4. Replace !{cmd} with shell output
    // 5. Send as user message to the agent
}
```

### 3.4 Slash Command Integration

Custom commands are exposed as slash commands:
```
/review error handling in auth.ts    — Runs the "review" custom command
/commands                            — List all custom commands
/command create <name>               — Scaffold a new command .md file
```

---

## PART 4: PLAN MODE

### 4.1 How It Works

Plan mode restricts the agent to read-only operations. It can analyze, propose, but never modify.

Activate via `/plan` toggle or `--plan` CLI flag.

When active:
- Agent gets ONLY read-only tools: file_read, grep, glob, git_log, git_diff, think
- System prompt prepend: "You are in PLAN MODE. Analyze the request and produce a numbered step-by-step plan. Do NOT make any changes. Present the plan for user approval."
- The plan is displayed as a numbered list
- User can approve (`y`), edit (`e`), or reject (`n`)
- On approval, plan mode deactivates and the agent executes the plan with full tools

### 4.2 Plan Display

```
  ╔═══ Plan ════════════════════════════════════════╗
  ║                                                  ║
  ║  1. Read src/auth.ts to understand current flow  ║
  ║  2. Add input validation for email field         ║
  ║  3. Add rate limiting middleware                  ║
  ║  4. Write tests for new validation               ║
  ║  5. Run existing test suite to verify no breaks   ║
  ║                                                  ║
  ╚══════════════════════════════════════════════════╝

  Approve this plan? [y]es / [e]dit / [n]o: 
```

---

## PART 5: HIERARCHICAL CONTEXT FILES

### 5.1 Multiple CMDR.md Levels

Like Gemini CLI's GEMINI.md system, support context files at multiple directory levels:

```
~/.cmdr/CMDR.md                    # Global (applies to all projects)
~/projects/my-app/CMDR.md          # Project root
~/projects/my-app/src/CMDR.md      # Scoped to src/
~/projects/my-app/src/api/CMDR.md  # Scoped to src/api/
```

All found files are concatenated (with path separators) and injected into the system prompt. More specific files take priority.

### 5.2 Import Syntax

CMDR.md files can import other markdown files:

```markdown
# Project Rules

@shared/coding-standards.md
@.cmdr/api-conventions.md

## Local Rules
- Always use Zod for validation in this directory
```

### 5.3 Memory Commands

```
/memory show         — Display all loaded context (concatenated CMDR.md files)
/memory refresh      — Re-scan and reload all context files
/memory edit         — Open the project's CMDR.md in $EDITOR
```

---

## PART 6: PARALLEL TOOL EXECUTION

### 6.1 Implementation

When the model returns multiple tool_use blocks in a single response, check if they're independent (no data dependencies) and execute them concurrently:

```typescript
// In AgentRunner, after collecting all tool_use blocks from a response:
const toolCalls = response.content.filter(b => b.type === 'tool_use');

// Group into independent and dependent
const independent = toolCalls.filter(tc =>
  !toolCalls.some(other => other !== tc && dependsOn(tc, other))
);
const dependent = toolCalls.filter(tc => !independent.includes(tc));

// Execute independent calls in parallel
const parallelResults = await Promise.all(
  independent.map(tc => executor.execute(tc.name, tc.input, context))
);

// Execute dependent calls sequentially
const sequentialResults = [];
for (const tc of dependent) {
  sequentialResults.push(await executor.execute(tc.name, tc.input, context));
}
```

### 6.2 Safe Concurrency

Only parallelize tools that are safe to run concurrently:
- `file_read` + `file_read` = safe (both read-only)
- `file_read` + `grep` = safe
- `file_write` + `file_write` = NOT safe (may conflict)
- `bash` + anything = NOT safe (side effects)

```typescript
const SAFE_PARALLEL_TOOLS = new Set(['file_read', 'grep', 'glob', 'git_diff', 'git_log', 'think']);

function canParallelize(toolCalls: ToolUseBlock[]): boolean {
  return toolCalls.every(tc => SAFE_PARALLEL_TOOLS.has(tc.name));
}
```

---

## PART 7: OUTPUT FORMATS

### 7.1 JSON Output

Add `--output-format json` for structured output (critical for CI/CD, scripting, piping):

```bash
cmdr -p "Explain this codebase" --output-format json
```

Output:
```json
{
  "model": "qwen3-coder:latest",
  "response": "This is a TypeScript project...",
  "tools_called": ["glob", "file_read", "file_read"],
  "tokens": { "input": 4521, "output": 312 },
  "duration_ms": 8432
}
```

### 7.2 Stream JSON

Add `--output-format stream-json` for streaming structured events:

```bash
cmdr -p "Fix the tests" --output-format stream-json
```

Each line is a JSON event:
```json
{"type":"text","data":"Let me check the test files..."}
{"type":"tool_use","name":"glob","input":{"pattern":"**/*.test.*"}}
{"type":"tool_result","name":"glob","data":"tests/math.test.ts\ntests/api.test.ts"}
{"type":"text","data":"Found 2 test files. Let me read them..."}
{"type":"done","tokens":{"input":8912,"output":1234},"duration_ms":12000}
```

This enables piping cmdr output into other tools, CI systems, or dashboards.

---

## PART 8: A2A PROTOCOL (EXPERIMENTAL)

### 8.1 A2A Client

Add ability for cmdr to communicate with remote agents via the Agent-to-Agent protocol:

```typescript
// src/a2a/client.ts
class A2AClient {
  // Discover agent capabilities via .well-known/agent.json
  async discover(url: string): Promise<AgentCard>;

  // Send a task to a remote agent
  async sendTask(url: string, message: string): Promise<TaskResult>;
}

// src/a2a/types.ts — JSON-RPC 2.0 message types for A2A protocol
```

### 8.2 Remote Subagents

Agent definitions can reference remote agents:

```markdown
---
name: cloud-analyzer
description: Runs deep analysis in the cloud with more compute
kind: remote
url: https://my-agent-server.com
---
```

When the main agent calls this subagent, cmdr uses the A2AClient to communicate.

---

## EXECUTION ORDER

### Session 1: Subagent Foundation (2-3 hours)
1. Create `src/agents/registry.ts` — load agent .md files from 3 locations
2. Create `src/agents/executor.ts` — run subagents in isolated context
3. Create `src/agents/subagent-tool.ts` — wrap subagents as tools
4. Create 4 bundled subagent .md files
5. Wire into REPL: load registry on startup, register subagent tools
6. Implement `@agent` syntax in input parsing
7. Add `/agents` slash commands
8. Test: `@investigator explain the auth flow` should work

### Session 2: UI Overhaul (2-3 hours)
9. Create theme system with structured CmdrTheme interface
10. Create 5 built-in themes
11. Create theme loader from config files
12. Add `/theme` command
13. Add footer status bar (model, tokens, agents, CMDR.md, cwd)
14. Add tool status lifecycle indicators
15. Add markdown raw/rendered toggle

### Session 3: Commands + Plan Mode + Parallel (2 hours)
16. Create custom command loader (.cmdr/commands/*.md)
17. Implement template variables ({{args}}, @{file}, !{shell})
18. Add `/commands` and custom command execution
19. Implement plan mode (/plan toggle + --plan flag)
20. Implement parallel tool execution for independent read-only tools
21. Implement hierarchical CMDR.md loading with imports

### Session 4: Output Formats + Polish (1-2 hours)
22. Add --output-format json
23. Add --output-format stream-json
24. A2A client (experimental, basic implementation)
25. Version bump to v2.0.0
26. Run full eval suite, update README with results
27. Push, let CI publish

---

## SUCCESS CRITERIA FOR v2.0.0

1. `@investigator explain how the tool system works` delegates to subagent, returns detailed analysis
2. `@reviewer check my last changes` runs code review in isolated context
3. `/plan add authentication to the API` produces a plan without making changes
4. `/theme nord` switches the color scheme live
5. Custom command `/review error handling` loads and executes the review.md template
6. Footer shows model + token usage + agent count
7. `cmdr -p "Fix tests" --output-format json` produces valid JSON
8. Eval score maintained at 42/50 or better (subagents should help, not hurt)
9. `@security audit this codebase` runs the security subagent

---

*This is cmdr's transition from "coding tool" to "coding platform."
The subagent system is the foundation for everything that follows:
multi-agent teams, autonomous workflows, and CI/CD integration.*