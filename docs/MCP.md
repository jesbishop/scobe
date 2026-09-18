# Vanta MCP (Paper-style)

Vanta runs a local MCP server while the app is open so coding agents (Cursor, Claude Code, Codex) can build on the live canvas.

## Endpoint

```
http://127.0.0.1:29980/mcp
```

Keep **Vanta open** with a file/workspace loaded. The green **MCP live** pill shows the URL.

## Connect Cursor

This repo includes `.cursor/mcp.json`. Reload Cursor after starting Vanta, then check **Settings → Tools & MCP**.

Or add globally:

```json
{
  "mcpServers": {
    "vanta": {
      "url": "http://127.0.0.1:29980/mcp"
    }
  }
}
```

## Connect Claude Code

```bash
claude mcp add vanta --transport http http://127.0.0.1:29980/mcp --scope user
```

## Try it

With Vanta open, ask your agent:

> Create a login card in Vanta: a frame with auto-layout, title, email/password fields, and a button.

You should see Paper-like shimmer on new nodes as they appear. Agents should call `finish_working_on_nodes` when done.
