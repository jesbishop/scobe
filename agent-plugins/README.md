# Scobe agent plugins

Use Scobe with your coding agent. Install [Scobe](https://github.com/jesbishop/scobe/releases/latest), open it once, then add the plugin for your agent.

## Cursor

```sh
/add-plugin scobe
```

Until the Cursor Marketplace listing is live, use **Connect your agent → Cursor** inside Scobe, which adds the same server to `~/.cursor/mcp.json`.

## Claude Code

**Add the marketplace**

```sh
/plugin marketplace add jesbishop/scobe-plugins
```

**Install the plugin**

```sh
/plugin install scobe@scobe
```

## Codex

Install **Scobe** from the Codex plugin directory once it's listed. Until then:

```sh
codex mcp add scobe --url http://127.0.0.1:29980/mcp
```

## How it connects

Scobe installs a `scobe` command in `~/.scobe/bin` every time it starts. Cursor and Claude Code run that command; it relays your agent's requests to the open Scobe app. Codex connects to the app's MCP endpoint directly. Keep Scobe open while your agent works; if it's closed, tools reply with "Scobe is not open".
