# Multi-Agent Teams

[← Back to README](../README.md)

---

cmdr supports multi-agent collaboration with built-in presets. Each agent has its own system prompt, tool access, and optional model. Results flow through shared memory so downstream agents see what upstream agents produced.

## Built-in Presets

```bash
cmdr --team review      # Coder + Reviewer
cmdr --team fullstack   # Planner + Frontend + Backend + Reviewer
cmdr --team security    # Security Scanner + Reviewer
```

## Switching Mid-Session

```bash
/team review
```

## How It Works

1. The **orchestrator** breaks a task into subtasks
2. Each **agent** picks up its assigned subtask and runs it with its own tool set
3. Results are written to **shared memory**
4. Downstream agents read upstream outputs and continue
5. The final agent produces the consolidated result

---

**Next:** [Plugins & MCP →](plugins.md)
