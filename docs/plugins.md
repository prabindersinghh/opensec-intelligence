# Plugins & MCP

[← Back to README](../README.md)

---

## Plugins

Load plugins from npm modules or local paths in `~/.cmdr/config.toml`:

```toml
plugins = ["cmdr-plugin-prettier", "./my-local-plugin.js"]
```

Plugins can provide:

- **Tools** — registered alongside built-in tools
- **Slash commands** — available in the REPL
- **Lifecycle hooks** — `beforePrompt`, `afterResponse`, `onError`, etc.

## MCP (Model Context Protocol)

Connect to MCP servers for extended tool sets:

```toml
[[mcp.servers]]
name = "my-tools"
url = "http://localhost:8080"
```

MCP servers are discovered via the `/tools` endpoint. Their tools are registered with a `mcp_` prefix and appear alongside built-in tools.

### REPL Commands

| Command | Description |
|---------|-------------|
| `/plugin list` | List loaded plugins |
| `/mcp list` | List MCP server connections |

---

**Next:** [Configuration →](configuration.md)
