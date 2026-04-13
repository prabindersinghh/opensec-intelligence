# Contributing to cmdr

Thanks for your interest in contributing to cmdr!

## Development Setup

```bash
git clone https://github.com/reyyanxahmed/cmdr.git
cd cmdr
npm install
npm run build
```

## Running Locally

```bash
# Start with a specific model
node dist/bin/cmdr.js -m qwen3-coder:latest

# Watch mode
npm run dev
```

## Project Structure

```
bin/          CLI entry point
src/
  cli/        REPL, commands, args, spinner, theme, renderer
  core/       Agent, AgentRunner, types, presets, permissions
  llm/        OllamaAdapter, model registry, token counter
  session/    SessionManager, compaction, persistence, project context
  tools/      ToolRegistry, ToolExecutor, built-in tools
evals/        Evaluation harness and tasks
```

## Code Style

- TypeScript strict mode, ES2022 target, ESM
- No semicolons (TSC enforces)
- 2-space indentation
- Prefer `const` over `let`
- Minimal dependencies — think twice before adding one

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run build` to verify no type errors
4. Run `npm test` if tests exist for the area you changed
5. Open a pull request

## Adding a Tool

1. Create a file in `src/tools/built-in/`
2. Use `defineTool()` with a Zod schema for parameters
3. Register it in `src/tools/built-in/index.ts`
4. Assign a risk level in `src/core/permissions.ts`

## Adding a Slash Command

1. Add a `registerCommand()` call in `src/cli/commands.ts`
2. If the command needs REPL-level access, return a sentinel string and handle it in `src/cli/repl.ts`

## Reporting Issues

Open an issue on GitHub with:
- Your OS and Node.js version
- The Ollama model you're using
- Steps to reproduce
- Expected vs actual behavior
