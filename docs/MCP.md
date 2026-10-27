# Scobe MCP

Scobe runs an MCP server while the app is open, so coding agents (Cursor, Claude Code, Codex) can build on the live canvas. It works like Paper's: people install a plugin for their agent, and the plugin connects to the Scobe app on their computer.

## How it connects

Every time Scobe starts it installs, under `~/.scobe`:

| Path | What it is |
| --- | --- |
| `bin/scobe` | The command agents run. On Windows `bin` is a junction to the install folder, so it resolves to `Scobe.exe`. On macOS and Linux it is a small script that starts Scobe's runtime. |
| `bridge/scobe-mcp.cjs` | A stdio MCP server, run with `ELECTRON_RUN_AS_NODE=1`, that relays to the open app. |
| `mcp-cache.json` | The last tool list, so agents still see Scobe's tools when the app is closed. |

The app's own endpoint is `http://127.0.0.1:29980/mcp`. Cursor and Claude Code reach it through the bridge; Codex connects to it directly, as Paper's Codex plugin does. When Scobe is closed, tool calls answer "Scobe is not open" instead of failing.

## Agent plugins

The plugin package is in [`agent-plugins/`](../agent-plugins), laid out like [paper-design/agent-plugins](https://github.com/paper-design/agent-plugins) so it can be pushed as its own public repo (`jesbishop/scobe-plugins`) and submitted to each marketplace:

- `plugins/scobe/.cursor-plugin`, `.claude-plugin`, `.codex-plugin`: one manifest per agent.
- `plugins/scobe/mcp.cursor.json`, `mcp.claude.json`, `mcp.codex.json`: the server each agent starts.
- `.cursor-plugin/marketplace.json`, `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`: marketplace indexes at the repo root.

Cursor's config uses `${env:HOME}${env:USERPROFILE}` rather than `${userHome}`, because Cursor expands `${userHome}` to `/c:/Users/...` on Windows and the spawn fails.

## Connect without the plugin

**Inside Scobe:** Connect your agent → pick the agent → Add. This writes the same `scobe` entry to `~/.cursor/mcp.json`, `~/.claude.json`, or `~/.codex/config.toml`, and removes old `vanta` entries.

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "scobe": {
      "command": "${env:HOME}${env:USERPROFILE}/.scobe/bin/scobe",
      "args": ["${env:HOME}${env:USERPROFILE}/.scobe/bridge/scobe-mcp.cjs"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add scobe --scope user -e ELECTRON_RUN_AS_NODE=1 -- ~/.scobe/bin/scobe ~/.scobe/bridge/scobe-mcp.cjs
```

**Codex:**

```bash
codex mcp add scobe --url http://127.0.0.1:29980/mcp
```

## Try it

With Scobe open, ask your agent:

> Create a login card in Scobe: a frame with auto-layout, title, email/password fields, and a button.

New nodes shimmer as they appear. Agents should call `finish_working_on_nodes` when done.

## Web agents (v0, cursor.com/agents, claude.ai)

Web agents run in the cloud and can't reach the app on your computer. They will connect through a hosted Scobe MCP service with sign-in (planned). Until then, the in-app sidebar uses a temporary Cloudflare tunnel for them.
