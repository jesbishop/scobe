export type CodingAgentId = 'claude-code' | 'cursor' | 'codex' | 'v0'

export type CodingAgentBinding = {
  id: string
  agentId: CodingAgentId
  projectName: string
  lastUsed: number
}

/** Opt-in link from a Coding Agents website client to the local Vanta MCP canvas server. */
export type AgentMcpLinkState = 'off' | 'connected' | 'needs-setup'

export type AgentMcpLinkStatus = {
  agentId: CodingAgentId
  state: AgentMcpLinkState
  /** Human-readable detail (config path written, or setup steps for v0). */
  detail?: string
  /** Local MCP URL (localhost) — works for desktop IDEs only. */
  localUrl?: string
  /**
   * Public tunnel URL for cloud agent websites (cursor.com/agents, etc.).
   * Cloud VMs cannot reach 127.0.0.1 — this must be added in the site's MCP settings.
   */
  publicUrl?: string
  /** Cursor.com one-click install page (registers Vanta for Connectors / MCP). */
  installUrl?: string
  /** Deep link for Cursor desktop mcp.json install. */
  deeplinkUrl?: string
  /** Preferred first URL to open in the sidebar agent browser after Done. */
  openUrl?: string
  /** Snippet / steps to paste into the agent's MCP UI. */
  setupSnippet?: string
  /** Prompt that steers the agent to Vanta tools (not Cursor's own canvas). */
  buildPrompt?: string
  /** Tunnel responded successfully. */
  tunnelOk?: boolean
}

export const VANTA_BUILD_PROMPT =
  'IMPORTANT: Do NOT use the Cursor canvas skill, read-canvas, write-canvas, or any Cursor canvas. Those edit a different product and will not change what I see. ' +
  'You must use the Scobe MCP server tools only: get_basic_info, create_artboard, add_design_frame, add_design_rect, add_design_ellipse, add_design_text, set_layout, update_styles, set_text_content, snapshot_browser_to_frame, snapshot_to_canvas, finish_working_on_nodes. ' +
  'When asked to snapshot or bring a page/sidebar into the canvas, call snapshot_browser_to_frame or snapshot_to_canvas (Scobe Snapshot → editable layers). Never paste a flat PNG screenshot for that. ' +
  'If Scobe MCP tools are missing, stop and tell me — do not fall back to Cursor canvas. ' +
  'Start with get_basic_info, then build UI frames with auto-layout on the Scobe design canvas.'

export const SIDEBAR_BROWSER_ID = 'vanta-sidebar-agent'
export const AGENT_SIDE_BROWSER_IDS = ['vanta-agent-side-browser', 'vanta-agent-side-browser-2'] as const
export const AGENT_SIDE_BROWSER_ID = AGENT_SIDE_BROWSER_IDS[0]
export const AGENT_SIDE_BROWSER_MAX = AGENT_SIDE_BROWSER_IDS.length
export const AGENT_SIDE_BROWSER_HOME = 'https://www.google.com/'
export const CHAT_BROWSER_ID = 'vanta-chat-browser'
export const CHAT_BROWSER_HOME = 'https://www.google.com/'

export type AgentSideBrowserSlot = {
  id: (typeof AGENT_SIDE_BROWSER_IDS)[number]
  url: string
}

/** Left docked browser session: coding agent web app or a canvas tab mirrored in the sidebar. */
export type DockedBrowserMode = 'coding-agent' | 'docked-tab'

export type DockedTabRef = {
  windowId: string
  tabId: string
}

export const CODING_AGENTS: Array<{
  id: CodingAgentId
  name: string
  webAppUrl: string
  favicon: string
  faviconFallback: string
}> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    webAppUrl: 'https://claude.ai/new',
    favicon: 'https://www.google.com/s2/favicons?domain=claude.ai&sz=128',
    faviconFallback: 'https://www.google.com/s2/favicons?domain=anthropic.com&sz=128'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    webAppUrl: 'https://cursor.com/agents',
    favicon: 'https://www.cursor.com/apple-touch-icon.png',
    faviconFallback: 'https://www.google.com/s2/favicons?domain=cursor.com&sz=128'
  },
  {
    id: 'codex',
    name: 'Codex',
    webAppUrl: 'https://chatgpt.com/codex',
    favicon: 'https://www.google.com/s2/favicons?domain=chatgpt.com&sz=128',
    faviconFallback: 'https://chatgpt.com/favicon.ico'
  },
  {
    id: 'v0',
    name: 'v0',
    webAppUrl: 'https://v0.app',
    favicon: 'https://v0.app/apple-icon.png',
    faviconFallback: 'https://www.google.com/s2/favicons?domain=v0.dev&sz=128'
  }
]

export function getCodingAgentMeta(id: CodingAgentId) {
  return CODING_AGENTS.find((agent) => agent.id === id) || CODING_AGENTS[0]
}
