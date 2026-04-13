# CMDR Skills Integration + Multi-Tier Eval Framework

> **For**: Claude Opus 4 via Claude Code
> **Repo**: ~/Documents/GitHub/cmdr
> **Prereqs**: Phase 1 complete, cmdr compiles, REPL works, tools functional

---

## PART A: SKILLS SYSTEM INTEGRATION

### A1. What Skills Are

Skills are folders of instructions (SKILL.md), scripts, and resources that the agent loads dynamically to improve performance on specialized tasks. They come from https://github.com/anthropics/skills. Each skill has:

```
skill-name/
├── SKILL.md          # Markdown with YAML frontmatter (name, description) + instructions
├── scripts/          # Optional helper scripts (Python, shell, JS)
├── templates/        # Optional template files
├── REFERENCE.md      # Optional detailed reference docs
└── LICENSE.txt
```

cmdr must be able to load skills from three sources:
1. **Bundled skills**: Ship with cmdr in `skills/` directory (the core set below)
2. **User skills**: From `~/.cmdr/skills/` (user-installed)
3. **Project skills**: From `.cmdr/skills/` in the project root (project-specific)

### A2. Core Skills to Bundle

Clone or vendor the following from https://github.com/anthropics/skills into cmdr's `skills/` directory. For each, adapt the SKILL.md to work with cmdr's tool system (replace any Claude Code-specific references with cmdr equivalents):

| Skill | Purpose | Key Files |
|---|---|---|
| `pdf` | Create, fill, merge, split, watermark, encrypt PDFs | SKILL.md, scripts/create_pdf.py, REFERENCE.md, FORMS.md |
| `docx` | Create/edit Word documents with formatting, TOC, headers | SKILL.md, scripts/ |
| `xlsx` | Create/edit Excel spreadsheets, charts, formulas | SKILL.md, scripts/ |
| `pptx` | Create PowerPoint presentations | SKILL.md, scripts/, editing.md |
| `frontend-design` | Build production-grade web UIs, React components, HTML/CSS | SKILL.md |
| `webapp-testing` | Test web applications end-to-end | SKILL.md |
| `mcp-builder` | Generate MCP server implementations | SKILL.md |
| `skill-creator` | Meta-skill: create and evaluate new skills | SKILL.md, agents/, scripts/ |

### A3. Skills Loader Implementation

**Create `src/skills/loader.ts`**:

```typescript
export interface Skill {
  name: string
  description: string
  instructions: string       // The full SKILL.md content (minus frontmatter)
  scripts: string[]          // Paths to helper scripts
  references: string[]       // Paths to reference docs
  source: 'bundled' | 'user' | 'project'
}

export class SkillsLoader {
  private skills: Map<string, Skill> = new Map()

  // Load skills from all three sources (project > user > bundled priority)
  async loadAll(projectRoot: string): Promise<void>

  // Get a specific skill by name
  get(name: string): Skill | undefined

  // List all available skills
  list(): Skill[]

  // Find skills relevant to a task (search name + description)
  search(query: string): Skill[]

  // Parse SKILL.md: extract YAML frontmatter (name, description) and markdown body
  private parseSkillMd(content: string): { name: string; description: string; instructions: string }
}
```

**Create `src/skills/injector.ts`**:

```typescript
// Decides which skills to inject into the prompt based on the user's message
export class SkillInjector {
  // Given a user message, determine which skills are relevant
  // Rules:
  //   - If message mentions "pdf", "document", "word doc" -> inject pdf/docx skill
  //   - If message mentions "spreadsheet", "excel", "csv" -> inject xlsx skill
  //   - If message mentions "presentation", "slides", "powerpoint" -> inject pptx skill
  //   - If message mentions "frontend", "react", "html", "css", "ui" -> inject frontend-design
  //   - If message mentions "test", "testing", "e2e" -> inject webapp-testing
  //   - If message mentions "mcp", "server", "protocol" -> inject mcp-builder
  //   - Max 2 skills injected per turn (to avoid context bloat)
  //   - Skills are injected AFTER system prompt, BEFORE conversation history
  selectSkills(message: string, available: Skill[]): Skill[]
}
```

**Modify `src/session/prompt-builder.ts`**:
- After the system prompt and CMDR.md workspace instructions, inject selected skills
- Wrap each skill in clear delimiters:
  ```
  <skill name="pdf">
  {SKILL.md content}
  </skill>
  ```
- If a skill has scripts, add a note: "Helper scripts are available at: {paths}"

### A4. Skills Slash Commands

Add to `src/cli/commands.ts`:

| Command | Description |
|---|---|
| `/skills` | List all available skills with source (bundled/user/project) |
| `/skill info <name>` | Show a skill's description and instructions summary |
| `/skill install <path-or-url>` | Copy a skill folder to ~/.cmdr/skills/ |
| `/skill create <name>` | Scaffold a new skill from template in .cmdr/skills/ |

### A5. Skill Script Execution

Some skills (pdf, docx, xlsx, pptx) have Python helper scripts. cmdr needs to:

1. Check if Python 3 is available on the system
2. If a skill's instructions reference a script, the agent should use the `bash` tool to run it
3. Auto-install required pip packages (the scripts typically need `python-docx`, `openpyxl`, `python-pptx`, `reportlab`, `PyPDF2`)
4. The skill instructions already tell the agent how to use the scripts, so cmdr just needs to make them accessible

Add a `skills` field to `ProjectContext`:
```typescript
interface ProjectContext {
  // ... existing fields
  activeSkills: Skill[]     // Skills loaded for this session
  skillScriptPaths: string[] // Paths where skill scripts can be found
}
```

---

## PART B: MULTI-TIER EVAL FRAMEWORK

### B1. Architecture

```
evals/
├── cmdr-eval.ts              # Main eval runner CLI
├── lib/
│   ├── runner.ts             # Core eval execution engine
│   ├── scorer.ts             # Scoring and grading logic
│   ├── reporter.ts           # Terminal + JSON + PDF report generation
│   ├── workspace.ts          # Temp workspace setup/teardown
│   ├── verifier.ts           # Verification strategies (file check, test run, output match)
│   └── types.ts              # Eval type definitions
├── tasks/
│   ├── tier-1-basic/         # 10 tasks
│   ├── tier-2-intermediate/  # 10 tasks
│   ├── tier-3-advanced/      # 10 tasks
│   ├── tier-4-hard/          # 10 tasks
│   ├── tier-5-expert/        # 5 tasks
│   └── tier-6-extreme/       # 5 tasks
├── reports/                  # Generated reports go here
│   ├── report-2026-04-03-qwen3-coder.json
│   └── report-2026-04-03-qwen3-coder.pdf
└── README.md
```

### B2. Type Definitions

**Create `evals/lib/types.ts`**:

```typescript
export type Tier = 'basic' | 'intermediate' | 'advanced' | 'hard' | 'expert' | 'extreme'
export type VerifyStrategy = 'file_exists' | 'file_contains' | 'test_passes' | 'output_matches' | 'script_verify' | 'diff_check'
export type TaskCategory = 'file_ops' | 'code_gen' | 'code_edit' | 'debugging' | 'refactoring' | 'multi_file' | 'testing' | 'architecture' | 'security' | 'performance' | 'skill_use'

export interface EvalTask {
  id: string                          // e.g. "t1-01-create-file"
  name: string                        // Human-readable name
  tier: Tier
  category: TaskCategory
  description: string                 // What the task tests
  prompt: string                      // The exact prompt sent to cmdr
  timeout: number                     // Max seconds
  expectedTools: string[]             // Tools the agent should use
  verify: VerificationSpec[]          // How to check success
  setup?: string                      // Optional setup script path (relative to task dir)
  tags: string[]
  points: number                      // Score weight (basic=1, intermediate=2, advanced=3, hard=5, expert=8, extreme=13)
  requiresSkill?: string              // If this task tests a skill (e.g., "pdf", "frontend-design")
}

export interface VerificationSpec {
  strategy: VerifyStrategy
  target: string                      // file path, grep pattern, test command, etc.
  expected?: string                   // expected value for file_contains/output_matches
  script?: string                     // path to verify script for script_verify
}

export interface TaskResult {
  taskId: string
  passed: boolean
  score: number                       // 0 or task.points
  duration: number                    // seconds
  tokensIn: number
  tokensOut: number
  toolsCalled: string[]
  error?: string                      // if failed, why
  agentOutput: string                 // full agent response
  verifyDetails: string               // verification output
}

export interface EvalRun {
  id: string                          // e.g. "eval-2026-04-03-143052"
  model: string
  ollamaUrl: string
  startedAt: string
  completedAt: string
  tasks: TaskResult[]
  summary: EvalSummary
}

export interface EvalSummary {
  totalTasks: number
  passed: number
  failed: number
  score: number                       // sum of points earned
  maxScore: number                    // sum of all possible points
  percentage: number
  byTier: Record<Tier, { passed: number; total: number; score: number; maxScore: number }>
  byCategory: Record<string, { passed: number; total: number }>
  totalDuration: number
  totalTokensIn: number
  totalTokensOut: number
  averageTimePerTask: number
}
```

### B3. The 50 Eval Tasks

#### Tier 1: Basic (10 tasks, 1 point each)
Tests: single tool use, basic file operations, simple code generation

```
t1-01-create-file
  prompt: "Create a file called src/hello.ts that exports a function greet(name: string): string which returns 'Hello, {name}!'"
  verify: file_exists src/hello.ts, file_contains "export function greet", file_contains "Hello,"
  expectedTools: [file_write]
  category: file_ops

t1-02-read-and-answer
  prompt: "Read package.json and tell me the project name. Write your answer to answer.txt"
  verify: file_exists answer.txt, file_contains the actual project name from workspace package.json
  expectedTools: [file_read, file_write]
  category: file_ops

t1-03-list-files
  prompt: "List all TypeScript files in the src/ directory and write the list to filelist.txt, one per line"
  verify: file_exists filelist.txt, file_contains "index.ts" (from workspace)
  expectedTools: [glob, file_write]
  category: file_ops

t1-04-run-command
  prompt: "Run 'node --version' and write the output to version.txt"
  verify: file_exists version.txt, file_contains "v"
  expectedTools: [bash, file_write]
  category: file_ops

t1-05-simple-function
  prompt: "Create src/math.ts with functions add(a,b), subtract(a,b), multiply(a,b), divide(a,b) that work with numbers. Handle division by zero by throwing an Error."
  verify: file_exists src/math.ts, file_contains "export function add", file_contains "export function divide", file_contains "throw"
  expectedTools: [file_write]
  category: code_gen

t1-06-git-info
  prompt: "What branch am I on? Write just the branch name to branch.txt"
  verify: file_exists branch.txt, file_contains "main" (workspace is initialized with git on main)
  expectedTools: [bash OR git_diff, file_write]
  category: file_ops

t1-07-find-pattern
  prompt: "Find all files that contain the word 'TODO' and write the filenames to todos.txt"
  verify: file_exists todos.txt, file_contains the file that has TODO in workspace
  expectedTools: [grep, file_write]
  category: file_ops

t1-08-json-manipulation
  prompt: "Read config.json, add a new field 'version' with value '2.0.0', and save it back"
  verify: file_contains config.json "version", file_contains config.json "2.0.0"
  expectedTools: [file_read, file_write]
  category: code_gen

t1-09-create-directory-structure
  prompt: "Create a project structure: src/components/, src/utils/, src/types/, tests/, and an empty index.ts in each src/ subdirectory"
  verify: file_exists src/components/index.ts, file_exists src/utils/index.ts, file_exists src/types/index.ts, file_exists tests/
  expectedTools: [bash OR file_write]
  category: file_ops

t1-10-copy-and-rename
  prompt: "Read src/old-module.ts, rename the exported class from OldModule to NewModule everywhere in the file, and save it as src/new-module.ts"
  verify: file_exists src/new-module.ts, file_contains "NewModule", NOT file_contains "OldModule"
  expectedTools: [file_read, file_write]
  category: code_edit
```

#### Tier 2: Intermediate (10 tasks, 2 points each)
Tests: multi-step operations, code editing, basic reasoning

```
t2-01-add-function-to-existing
  prompt: "Add a function 'capitalize(str: string): string' to src/utils.ts that capitalizes the first letter of each word. Don't modify existing functions."
  verify: file_contains src/utils.ts "capitalize", file_contains "function capitalize", previous functions still present
  expectedTools: [file_read, file_edit]
  category: code_edit

t2-02-fix-syntax-error
  prompt: "src/broken.ts has a syntax error. Find and fix it."
  workspace: broken.ts with a missing closing brace
  verify: bash "npx tsc --noEmit src/broken.ts" exits 0
  expectedTools: [file_read, file_edit, bash]
  category: debugging

t2-03-add-imports
  prompt: "src/app.ts uses 'readFileSync' and 'writeFileSync' but is missing the import from 'fs'. Add the correct import."
  verify: file_contains src/app.ts "import", file_contains "readFileSync", bash "npx tsc --noEmit" exits 0
  expectedTools: [file_read, file_edit]
  category: code_edit

t2-04-write-interface
  prompt: "Create src/types/user.ts with a TypeScript interface User that has: id (number), name (string), email (string), createdAt (Date), roles (string array), and an optional field 'avatar' (string). Export it."
  verify: file_contains "interface User", file_contains "roles: string[]", file_contains "avatar?", bash "npx tsc --noEmit" exits 0
  expectedTools: [file_write]
  category: code_gen

t2-05-implement-from-interface
  prompt: "Read src/types/api.ts which defines a UserService interface. Create src/services/user-service.ts that implements all methods of the interface. Use stub implementations that throw 'Not implemented' for now."
  workspace: api.ts with interface UserService { getUser(id: number): Promise<User>; createUser(data: CreateUserInput): Promise<User>; deleteUser(id: number): Promise<void> }
  verify: file_exists src/services/user-service.ts, file_contains "getUser", file_contains "createUser", file_contains "deleteUser"
  expectedTools: [file_read, file_write]
  category: code_gen

t2-06-regex-replace
  prompt: "In src/legacy.ts, replace all console.log() calls with a proper logger.info() call. Import logger from './logger' at the top."
  workspace: legacy.ts with 5 console.log calls
  verify: NOT file_contains "console.log", file_contains "logger.info", file_contains "import.*logger"
  expectedTools: [file_read, file_edit]
  category: code_edit

t2-07-environment-config
  prompt: "Create a src/config.ts that reads environment variables DATABASE_URL, PORT (default 3000), and NODE_ENV (default 'development'). Export them as a typed config object. Include validation that DATABASE_URL must be set."
  verify: file_contains "DATABASE_URL", file_contains "PORT", file_contains "process.env", file_contains "throw" OR file_contains "Error"
  expectedTools: [file_write]
  category: code_gen

t2-08-convert-callback-to-promise
  prompt: "Refactor src/data.ts: the function 'loadData' currently uses a callback pattern (err, data). Convert it to return a Promise instead. Update the function signature and implementation."
  workspace: data.ts with callback-style function
  verify: file_contains "Promise", file_contains "resolve" OR file_contains "async", NOT file_contains "callback"
  expectedTools: [file_read, file_edit]
  category: refactoring

t2-09-add-error-handling
  prompt: "src/api-client.ts has a fetch() call with no error handling. Wrap it in try/catch, handle network errors, check response.ok, and throw typed errors with status codes."
  workspace: api-client.ts with bare fetch
  verify: file_contains "try", file_contains "catch", file_contains "response.ok" OR file_contains "status"
  expectedTools: [file_read, file_edit]
  category: code_edit

t2-10-npm-script
  prompt: "Add a 'lint' script to package.json that runs 'tsc --noEmit && echo Lint passed'. Then run it and tell me if it passes."
  verify: file_contains package.json "lint", file_contains "tsc --noEmit"
  expectedTools: [file_read, file_edit, bash]
  category: file_ops
```

#### Tier 3: Advanced (10 tasks, 3 points each)
Tests: multi-file coordination, test writing, deeper reasoning

```
t3-01-fix-failing-test
  prompt: "Run 'npm test' -- a test is failing. Find the bug in the source code (not the test) and fix it."
  workspace: vitest test that fails because src/calculator.ts has off-by-one in multiply
  verify: bash "npm test" exits 0
  expectedTools: [bash, file_read, file_edit, grep]
  category: debugging

t3-02-write-tests
  prompt: "Write comprehensive vitest tests for src/string-utils.ts. Cover all exported functions, including edge cases (empty string, null, unicode). Save to tests/string-utils.test.ts"
  workspace: string-utils.ts with 4 functions
  verify: file_exists tests/string-utils.test.ts, bash "npx vitest run tests/string-utils.test.ts" exits 0, file_contains "describe", file_contains "expect"
  expectedTools: [file_read, file_write, bash]
  category: testing

t3-03-extract-shared-function
  prompt: "src/routes/users.ts and src/routes/products.ts both have duplicate validation logic (validatePagination). Extract it into src/middleware/pagination.ts and update both files to import from there."
  workspace: two route files with identical validatePagination function
  verify: file_exists src/middleware/pagination.ts, file_contains src/routes/users.ts "import.*pagination", file_contains src/routes/products.ts "import.*pagination", NOT file_contains src/routes/users.ts "function validatePagination"
  expectedTools: [file_read, file_write, file_edit, grep]
  category: refactoring

t3-04-add-rest-endpoint
  prompt: "Add a GET /api/health endpoint to src/server.ts that returns { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }. Add a test for it."
  workspace: Express server with existing routes
  verify: file_contains src/server.ts "/api/health", file_contains "uptime", tests pass
  expectedTools: [file_read, file_edit, file_write, bash]
  category: code_gen

t3-05-add-validation
  prompt: "Add Zod input validation to the POST /users endpoint in src/routes/users.ts. Validate: name (string, min 1 char), email (valid email), age (number, min 0, max 150). Return 400 with specific error messages on validation failure."
  workspace: Express route with unvalidated endpoint, zod in package.json
  verify: file_contains "z.object" OR file_contains "z.string", file_contains "safeParse" OR file_contains "parse", bash "npm test" exits 0
  expectedTools: [file_read, file_edit, bash]
  category: code_gen

t3-06-debug-runtime-error
  prompt: "The app crashes with 'TypeError: Cannot read properties of undefined' when you run 'npm start'. Find the bug from the stack trace in error.log and fix it."
  workspace: app with a null reference bug, error.log with stack trace
  verify: bash "npm start -- --test-mode" exits 0 (test-mode flag makes it exit after init)
  expectedTools: [file_read, grep, file_edit, bash]
  category: debugging

t3-07-async-refactor
  prompt: "Refactor src/data-pipeline.ts: convert the nested callback pyramid (4 levels deep) into clean async/await with proper error handling at each step."
  workspace: callback hell in data-pipeline.ts
  verify: file_contains "async", file_contains "await", NOT file_contains "callback", file_contains "try" AND file_contains "catch", bash "npx tsc --noEmit" exits 0
  expectedTools: [file_read, file_edit]
  category: refactoring

t3-08-implement-caching
  prompt: "Add an in-memory cache to src/api-client.ts. Cache GET requests for 60 seconds. Cache key should be the URL. Add a clearCache() method. Don't use any external packages."
  verify: file_contains "cache" OR file_contains "Cache", file_contains "60" OR file_contains "ttl", file_contains "clearCache", bash "npx tsc --noEmit" exits 0
  expectedTools: [file_read, file_edit]
  category: code_gen

t3-09-type-narrowing
  prompt: "src/handlers.ts has 5 TypeScript errors because it uses 'any' types and doesn't narrow union types properly. Fix all type errors without using 'any' or @ts-ignore."
  workspace: handlers.ts with union type issues
  verify: bash "npx tsc --noEmit" exits 0, NOT file_contains "any", NOT file_contains "ts-ignore"
  expectedTools: [file_read, file_edit, bash]
  category: debugging

t3-10-generate-documentation
  prompt: "Read all files in src/ and generate a DOCUMENTATION.md with: project overview, file-by-file descriptions, exported API summary, and usage examples."
  workspace: small project with 5 source files
  verify: file_exists DOCUMENTATION.md, file_contains at least 3 source file names, file_contains "```" (code examples), length > 1000 chars
  expectedTools: [glob, file_read, file_write]
  category: code_gen
```

#### Tier 4: Hard (10 tasks, 5 points each)
Tests: complex multi-file operations, architecture, performance, security awareness

```
t4-01-split-module
  prompt: "src/monolith.ts is a 300-line file with 3 distinct concerns: UserManager, OrderManager, and NotificationService. Split it into 3 separate files in src/services/ with proper imports between them. Update src/index.ts to re-export everything."
  workspace: monolith.ts with intertwined classes
  verify: file_exists for all 3 files, each contains its class, src/index.ts re-exports, bash "npx tsc --noEmit" exits 0
  expectedTools: [file_read, file_write, file_edit, bash]
  category: architecture

t4-02-database-migration
  prompt: "Create a database migration system. Add src/migrations/ with: a migration runner, a migration template, and implement migration 001_create_users_table.ts that creates a users table with id, name, email, created_at using SQL (for SQLite)."
  verify: file_exists src/migrations/runner.ts, file_exists src/migrations/001_create_users_table.ts, file_contains "CREATE TABLE", file_contains "users"
  expectedTools: [file_write, bash]
  category: architecture

t4-03-fix-security-vulnerability
  prompt: "Review src/auth.ts for security vulnerabilities. I see at least 3 issues. Find and fix them all. Write a SECURITY.md explaining what you found and fixed."
  workspace: auth.ts with SQL injection, plain-text password storage, missing rate limiting
  verify: NOT file_contains "SELECT.*+.*req" (no SQL concat), file_contains "hash" OR file_contains "bcrypt", file_exists SECURITY.md, SECURITY.md length > 500
  expectedTools: [file_read, file_edit, file_write, grep]
  category: security

t4-04-performance-optimization
  prompt: "src/search.ts has a search function that's O(n^2). Optimize it to O(n log n) or better. Add a benchmark test that proves the new version is faster on 10,000 items."
  workspace: search.ts with nested loop search
  verify: NOT file_contains nested loop pattern, file_exists tests/search.bench.ts OR benchmark results, bash "npm test" exits 0
  expectedTools: [file_read, file_edit, file_write, bash]
  category: performance

t4-05-api-integration
  prompt: "Create a complete REST API client for a todo app in src/todo-client.ts. It should have: getTodos(), getTodo(id), createTodo(data), updateTodo(id, data), deleteTodo(id). Use fetch(). Add proper TypeScript types. Add retry logic with exponential backoff. Add comprehensive tests using a mock server."
  verify: all 5 methods exist, types defined, retry logic present, tests exist and pass
  expectedTools: [file_write, file_read, bash]
  category: code_gen

t4-06-event-system
  prompt: "Implement a type-safe event emitter in src/events.ts. It should support: on(event, handler), off(event, handler), emit(event, data), once(event, handler). Events and their payload types should be defined in a type map. Write tests."
  verify: file_contains "EventEmitter" OR file_contains "EventBus", file_contains "on", file_contains "emit", tests pass
  expectedTools: [file_write, bash]
  category: code_gen

t4-07-middleware-chain
  prompt: "src/server.ts has 5 Express routes with duplicated authentication and logging logic. Create a middleware system: auth middleware (check Bearer token), logging middleware (log method, path, duration), error handling middleware (catch all errors, return JSON). Apply them properly."
  workspace: Express server with duplicated auth/logging in every route
  verify: file_exists src/middleware/ with at least 2 files, routes no longer have inline auth, bash "npx tsc --noEmit" exits 0
  expectedTools: [file_read, file_write, file_edit, grep, bash]
  category: refactoring

t4-08-state-machine
  prompt: "Implement a finite state machine for an order lifecycle in src/order-fsm.ts. States: draft, pending, confirmed, shipped, delivered, cancelled. Define valid transitions. Throw on invalid transitions. Add an event history log. Write tests for all valid and invalid transitions."
  verify: all states mentioned, transition validation, history, tests exist and pass
  expectedTools: [file_write, bash]
  category: code_gen

t4-09-cli-tool
  prompt: "Create a CLI tool in src/cli.ts that takes a directory path and generates a tree view of its contents (like the 'tree' command). Support flags: --depth N (max depth), --dirs-only (only directories), --ignore <pattern> (glob pattern to ignore). Add --help. Make it work with 'npx tsx src/cli.ts .'"
  verify: bash "npx tsx src/cli.ts . --depth 2" produces output, file_contains "process.argv" OR file_contains "parseArgs", file_contains "--depth"
  expectedTools: [file_write, bash]
  category: code_gen

t4-10-cross-file-refactor
  prompt: "The codebase uses string literal types for status everywhere: 'active', 'inactive', 'pending', 'deleted'. These are duplicated across 6 files. Create a central src/constants/status.ts with a Status enum (or const object), update ALL files to use it, and make sure everything compiles."
  workspace: 6 files with duplicated string literals
  verify: file_exists src/constants/status.ts, all 6 files import from it, bash "npx tsc --noEmit" exits 0, NOT file_contains duplicated string literals in any original file
  expectedTools: [grep, file_read, file_write, file_edit, bash]
  category: refactoring
```

#### Tier 5: Expert (5 tasks, 8 points each)
Tests: full feature implementation, architecture design, complex debugging

```
t5-01-full-crud-api
  prompt: "Build a complete CRUD REST API for a blog platform. Models: Post (id, title, body, authorId, createdAt, updatedAt), Author (id, name, bio). Endpoints for both resources. Include: input validation with Zod, proper error handling, TypeScript types, and a test suite. Use Express and in-memory storage."
  workspace: empty Express project skeleton
  verify: all endpoints exist, types defined, validation present, tests pass (at least 10 tests)
  expectedTools: [file_write, file_read, file_edit, bash, glob]
  category: architecture

t5-02-legacy-modernization
  prompt: "src/ contains a legacy JavaScript project (no types, var everywhere, prototype-based classes, CommonJS requires). Convert it to modern TypeScript: add proper types, convert to ES modules, convert classes to class syntax, replace var with const/let, add tsconfig.json. The project should compile and all existing tests should still pass."
  workspace: legacy JS project with 8 files and tests
  verify: all .ts files exist, tsconfig.json exists, bash "npx tsc --noEmit" exits 0, bash "npm test" exits 0, NOT file_contains "var " in any .ts, NOT file_contains "require(" in any .ts
  expectedTools: [glob, file_read, file_write, bash, grep]
  category: refactoring

t5-03-debug-complex-race-condition
  prompt: "src/queue-processor.ts has a race condition that causes items to be processed twice under load. The test in tests/race-condition.test.ts demonstrates the bug but it's flaky. Find and fix the race condition. Make the test reliable."
  workspace: queue processor with subtle race condition (missing mutex on concurrent dequeue)
  verify: bash "npx vitest run tests/race-condition.test.ts --retry 3" all pass, file_contains "lock" OR file_contains "mutex" OR file_contains "await" with proper guarding
  expectedTools: [file_read, file_edit, bash]
  category: debugging

t5-04-plugin-architecture
  prompt: "Design and implement a plugin system for src/app.ts. Plugins should be able to: register hooks (beforeRequest, afterResponse, onError), add new routes, add middleware, and access shared state. Create the plugin interface, the plugin manager, and 2 example plugins (rate-limiter, request-logger). Write tests."
  verify: plugin interface defined, plugin manager exists, 2 example plugins, hooks work, tests pass
  expectedTools: [file_write, file_read, bash]
  category: architecture

t5-05-generate-pdf-report (SKILL TEST)
  prompt: "Use the PDF skill to create a report.pdf that contains: a title page with 'Q1 2026 Report', a table of contents, 3 sections with sample data, a bar chart showing monthly revenue (Jan: 100k, Feb: 120k, Mar: 95k), and page numbers in the footer."
  requiresSkill: pdf
  verify: file_exists report.pdf, bash "python3 -c 'import PyPDF2; r=PyPDF2.PdfReader(\"report.pdf\"); print(len(r.pages))'" shows >= 4 pages
  expectedTools: [bash, file_write]
  category: skill_use
```

#### Tier 6: Extreme (5 tasks, 13 points each)
Tests: end-to-end system building, multi-model-level reasoning

```
t6-01-build-full-app
  prompt: "Build a complete task management CLI app with: 1) SQLite database for persistence, 2) CRUD operations for tasks (title, description, status, priority, due date), 3) CLI with commands: add, list, update, delete, search, stats, 4) Color-coded output by priority, 5) Due date warnings, 6) Export to JSON. Include a full test suite."
  workspace: empty project with sqlite3 and chalk in package.json
  verify: binary runs (bash "npx tsx src/index.ts add --title Test"), tests pass (>15 tests), database file created
  expectedTools: [file_write, file_read, bash, glob]
  category: architecture

t6-02-reverse-engineer-and-document
  prompt: "I have no documentation for this project. Read the entire codebase, understand the architecture, then: 1) Create a comprehensive README.md with setup, usage, and API docs, 2) Create an ARCHITECTURE.md with a system diagram (in mermaid), 3) Add JSDoc comments to all exported functions, 4) Create a CONTRIBUTING.md, 5) Add TypeScript declaration types for the untyped modules."
  workspace: undocumented project with 12 files
  verify: README.md > 2000 chars, ARCHITECTURE.md contains mermaid, JSDoc present in files, CONTRIBUTING.md exists, .d.ts files where needed
  expectedTools: [glob, file_read, file_write, file_edit, grep]
  category: code_gen

t6-03-security-audit
  prompt: "Perform a comprehensive security audit of this Express API. Check for: SQL injection, XSS, CSRF, insecure authentication, missing rate limiting, sensitive data exposure, insecure dependencies, missing security headers. Write a detailed SECURITY_AUDIT.md with findings, severity levels (critical/high/medium/low), and fix each issue you find."
  workspace: deliberately insecure Express app with 8+ vulnerabilities
  verify: SECURITY_AUDIT.md > 3000 chars, at least 5 vulnerabilities documented, fixes applied, bash "npm audit" shows improvement
  expectedTools: [glob, file_read, file_edit, file_write, bash, grep]
  category: security

t6-04-build-mcp-server (SKILL TEST)
  prompt: "Use the MCP builder skill to create a complete MCP server that exposes 3 tools: 'read_csv' (reads a CSV file and returns structured data), 'query_csv' (SQL-like queries on CSV data), and 'csv_stats' (basic statistics: mean, median, min, max for numeric columns). Include proper TypeScript types, error handling, and a test suite."
  requiresSkill: mcp-builder
  verify: MCP server compiles, tools defined, tests pass
  expectedTools: [file_write, file_read, bash]
  category: skill_use

t6-05-create-frontend (SKILL TEST)
  prompt: "Use the frontend-design skill to build a responsive dashboard page in src/dashboard.html. It should have: a sidebar navigation, a header with user avatar, 4 metric cards (users, revenue, orders, conversion rate), a line chart area, a recent activity table with 10 rows, and a dark mode toggle. Use only vanilla HTML, CSS, and JS. Must look professional, not like a template."
  requiresSkill: frontend-design
  verify: file_exists src/dashboard.html, file_contains "<table", file_contains "dark" (dark mode), file size > 5000 chars, bash "node -e 'require(\"fs\").statSync(\"src/dashboard.html\").size > 5000 || process.exit(1)'"
  expectedTools: [file_write, bash]
  category: skill_use
```

### B4. Eval Runner

**Create `evals/cmdr-eval.ts`**:

```typescript
#!/usr/bin/env npx tsx

// Usage:
//   npx tsx evals/cmdr-eval.ts                           # Run all tiers
//   npx tsx evals/cmdr-eval.ts --tier basic               # Run one tier
//   npx tsx evals/cmdr-eval.ts --task t3-01               # Run one task
//   npx tsx evals/cmdr-eval.ts --model qwen3-coder:latest # Specify model
//   npx tsx evals/cmdr-eval.ts --category debugging       # Run by category
//   npx tsx evals/cmdr-eval.ts --pdf                      # Generate PDF report
//   npx tsx evals/cmdr-eval.ts --compare report1.json report2.json  # Compare two runs

// For each task:
// 1. Create temp workspace: cp -r evals/tasks/{tier}/{task}/workspace /tmp/cmdr-eval-{task}
// 2. Run setup.sh if exists
// 3. Execute: node dist/bin/cmdr.js --dangerously-skip-permissions --cwd /tmp/cmdr-eval-{task} -m {model} -p "{task.prompt}"
// 4. Run all verify specs
// 5. Record result
// 6. Cleanup temp dir

// NOTE: This requires cmdr to have a --cwd flag. Add it if missing:
//   --cwd <path>  Override working directory (default: process.cwd())
```

### B5. Verification Engine

**Create `evals/lib/verifier.ts`**:

```typescript
// For each VerificationSpec, run the appropriate check:

// file_exists: fs.existsSync(path.join(workspace, target))
// file_contains: readFileSync(target).includes(expected)
//   - If expected starts with "NOT ", invert the check
//   - If expected starts with "REGEX:", use regex match
// test_passes: execSync(target, { cwd: workspace }) exits 0
// output_matches: run target command, check stdout contains expected
// script_verify: run the script with workspace as arg, exit 0 = pass
// diff_check: git diff in workspace shows expected changes
```

### B6. PDF Report Generator

**Create `evals/lib/reporter.ts`**:

The reporter generates three outputs:

1. **Terminal output** (always): colorized summary with pass/fail bars per tier
2. **JSON report** (always): full EvalRun saved to evals/reports/
3. **PDF report** (when --pdf flag): professional PDF using the PDF skill's scripts

The PDF report should contain:

```
Page 1: Title page
  - "cmdr Eval Report"
  - Model: qwen3-coder:latest
  - Date: 2026-04-03
  - Overall Score: 42/128 (32.8%)

Page 2: Executive Summary
  - Radar chart: score by category (file_ops, code_gen, debugging, etc.)
  - Bar chart: pass rate by tier
  - Key metrics: total time, total tokens, average time per task

Page 3-N: Tier breakdowns
  - For each tier: table of tasks with pass/fail, duration, tokens, tools used
  - Failed tasks get a "Failure reason" column

Page N+1: Model Comparison (if --compare was used)
  - Side-by-side bar charts of two runs
  - Delta table showing improvements/regressions

Last page: Methodology
  - How tasks are scored (point weights by tier)
  - Verification methods used
  - Environment details (Node version, Ollama version, OS)
```

Use the PDF skill's Python scripts to generate the PDF. The reporter should:
1. Generate a JSON data structure with all report data
2. Call a Python script that reads the JSON and produces the PDF using reportlab
3. Save to evals/reports/report-{date}-{model}.pdf

### B7. Package Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "eval": "npx tsx evals/cmdr-eval.ts",
    "eval:basic": "npx tsx evals/cmdr-eval.ts --tier basic",
    "eval:full": "npx tsx evals/cmdr-eval.ts --pdf",
    "eval:compare": "npx tsx evals/cmdr-eval.ts --compare",
    "eval:report": "npx tsx evals/cmdr-eval.ts --pdf --tier all"
  }
}
```

### B8. Prerequisites

Before running evals:
1. `--cwd` flag must be added to cmdr's CLI args
2. `-p` (prompt) flag must work in non-interactive mode (already exists)
3. `--dangerously-skip-permissions` must work (already exists)
4. Python 3 must be installed for PDF generation
5. `npm install -D tsx` for running TypeScript eval scripts directly

### B9. Scoring System

```
Tier 1 (Basic):        10 tasks x  1 point  =  10 points
Tier 2 (Intermediate): 10 tasks x  2 points =  20 points
Tier 3 (Advanced):     10 tasks x  3 points =  30 points
Tier 4 (Hard):         10 tasks x  5 points =  50 points
Tier 5 (Expert):        5 tasks x  8 points =  40 points
Tier 6 (Extreme):       5 tasks x 13 points =  65 points
─────────────────────────────────────────────────────────
Total:                 50 tasks              = 215 points

Grade scale:
  S:   180+ points (83%+)  — Frontier-model level
  A:   140-179    (65-83%) — Production-ready
  B:   100-139    (46-65%) — Useful for simple tasks
  C:    60-99     (28-46%) — Basic capability
  D:    30-59     (14-28%) — Limited utility
  F:    <30       (<14%)   — Not functional
```

---

## EXECUTION ORDER

1. **Add `--cwd` flag to cmdr** (5 min, needed for evals to work)
2. **Build skills loader + injector** (Part A: A2-A5, ~30 min)
3. **Bundle core skills** (clone from anthropics/skills, adapt SKILL.md files, ~15 min)
4. **Build eval type definitions** (B2, ~10 min)
5. **Build eval workspace manager** (B5 workspace.ts, ~10 min)
6. **Build verification engine** (B5 verifier.ts, ~15 min)
7. **Create all 50 task directories with task.json, workspace/, verify.sh** (B3, ~45 min)
8. **Build eval runner** (B4, ~20 min)
9. **Build terminal reporter** (B6 terminal output, ~10 min)
10. **Build PDF reporter** (B6 PDF generation with reportlab, ~20 min)
11. **Run first eval, fix issues, record baseline**
12. **Add eval results to README.md**

Total estimated: ~3 hours of Claude Code time across 2-3 sessions.

---

*After this, you'll have: a skills-aware coding agent with 8 bundled skills, a 50-task eval suite across 6 difficulty tiers, automatic PDF report generation, and a concrete score to publish in the README and iterate against.*