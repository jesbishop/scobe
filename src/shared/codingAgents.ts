export type CodingAgentId = 'claude-code' | 'cursor' | 'codex' | 'v0'

export type CodingAgentBinding = {
  id: string
  agentId: CodingAgentId
  projectName: string
  lastUsed: number
}

export const SIDEBAR_BROWSER_ID = 'vanta-sidebar-agent'
export const CHAT_BROWSER_ID = 'vanta-chat-browser'
export const CHAT_BROWSER_HOME = 'https://www.google.com/'

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
