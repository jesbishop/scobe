import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  VANTA_BUILD_PROMPT,
  type AgentMcpLinkStatus,
  type CodingAgentId
} from '../shared/codingAgents'
import { VANTA_MCP_URL } from './mcpServer'
import {
  buildCursorAgentsUrl,
  buildCursorInstallMcpUrl,
  buildCursorMcpDeeplink
} from './mcpInstallLinks'
import { ensureMcpTunnel, getPublicMcpUrl, getTunnelError, hasNamedTunnel, stopMcpTunnel } from './mcpTunnel'

export type { AgentMcpLinkStatus }

function cloudSetupSnippet(publicUrl: string | null): string {
  const url = publicUrl || VANTA_MCP_URL
  return [
    'Cursor Agents (cloud) will NOT use ~/.cursor/mcp.json and will NOT see localhost.',
    'They also have a built-in "canvas skill" that is NOT Vanta.',
    '',
    '1) In cursor.com/agents open the MCP menu → Add custom HTTP MCP:',
    `   Name: vanta`,
    `   URL: ${url}`,
    '   Auth: None (the URL carries your private Vanta token — do not share it) → Enable it for this chat',
    '',
    '2) Start a NEW agent chat (old chats keep using Cursor canvas).',
    '',
    '3) Paste this as the first message:',
    VANTA_BUILD_PROMPT
  ].join('\n')
}

function cloudPrefPath(): string {
  return join(homedir(), '.vanta', 'cloud-mcp.json')
}

function isCloudMcpConfirmed(agentId: CodingAgentId): boolean {
  const doc = readJsonFile(cloudPrefPath())
  const entry = doc[agentId]
  return Boolean(entry && typeof entry === 'object' && (entry as { confirmed?: boolean }).confirmed)
}

export function confirmCloudAgentMcp(agentId: CodingAgentId): AgentMcpLinkStatus {
  const doc = readJsonFile(cloudPrefPath())
  doc[agentId] = { confirmed: true, publicUrl: getPublicMcpUrl(), updatedAt: Date.now() }
  writeJsonFile(cloudPrefPath(), doc)
  return getAgentMcpLinkStatus(agentId)
}

function clearCloudMcpConfirmed(agentId: CodingAgentId): void {
  const doc = readJsonFile(cloudPrefPath())
  delete doc[agentId]
  writeJsonFile(cloudPrefPath(), doc)
}

function enrich(status: AgentMcpLinkStatus): AgentMcpLinkStatus {
  const publicUrl = getPublicMcpUrl() || undefined
  const installUrl = publicUrl ? buildCursorInstallMcpUrl(publicUrl) : undefined
  const deeplinkUrl = publicUrl ? buildCursorMcpDeeplink(publicUrl) : undefined
  const openUrl =
    status.agentId === 'cursor'
      ? installUrl || buildCursorAgentsUrl()
      : status.openUrl
  return {
    ...status,
    localUrl: VANTA_MCP_URL,
    publicUrl,
    installUrl,
    deeplinkUrl,
    openUrl,
    buildPrompt: VANTA_BUILD_PROMPT,
    setupSnippet: status.setupSnippet || cloudSetupSnippet(publicUrl || null),
    detail:
      status.detail ||
      (publicUrl
        ? `Tunnel ready (${publicUrl}). Install opens Cursor’s MCP page so Vanta appears under Connectors.`
        : 'Local MCP written. Cloud agent sites still need a public tunnel URL.')
  }
}

async function verifyTunnel(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000)
    })
    // Any HTTP response means Cloudflare reached our machine.
    return res.status > 0
  } catch {
    try {
      const res = await fetch(url.replace(/\/mcp\/?$/, '/'), {
        method: 'GET',
        signal: AbortSignal.timeout(8_000)
      })
      return res.status > 0
    } catch {
      return false
    }
  }
}

function mcpUrlForWrite(): string {
  return getPublicMcpUrl() || VANTA_MCP_URL
}

/** Local config exists, but cloud site still needs tunnel URL + MCP enable. */
function cloudLinkState(
  agentId: CodingAgentId,
  locallyConfigured: boolean,
  detail: string
): AgentMcpLinkStatus {
  if (!locallyConfigured) {
    return enrich({ agentId, state: 'off', detail })
  }
  const publicUrl = getPublicMcpUrl()
  if (!publicUrl || !isCloudMcpConfirmed(agentId)) {
    return enrich({
      agentId,
      state: 'needs-setup',
      detail: publicUrl
        ? `Tunnel on. Add vanta MCP in the Agents MCP menu, enable it, then start a NEW chat with the Vanta prompt — do not use Cursor canvas.`
        : `Local IDE config only. Click Connect to open a cloud tunnel, then add that URL in the Agents MCP menu.`
    })
  }
  return enrich({ agentId, state: 'connected', detail })
}

function cursorMcpPath(): string {
  return join(homedir(), '.cursor', 'mcp.json')
}

function claudeConfigPath(): string {
  return join(homedir(), '.claude.json')
}

function claudeProjectMcpPath(): string {
  return join(homedir(), '.claude', 'mcp.json')
}

function codexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
}

function codexConfigPath(): string {
  return join(codexHome(), 'config.toml')
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function writeJsonFile(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function mcpServersOf(doc: Record<string, unknown>): Record<string, unknown> {
  const servers = doc.mcpServers
  if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
    return { ...(servers as Record<string, unknown>) }
  }
  return {}
}

function isVantaMcpUrl(url: unknown): boolean {
  return typeof url === 'string' && (url.includes('29980') || url.includes('trycloudflare.com') || url.includes('/mcp'))
}

function cursorHasVanta(): boolean {
  const servers = mcpServersOf(readJsonFile(cursorMcpPath()))
  const entry = servers.vanta
  if (!entry || typeof entry !== 'object') return false
  return isVantaMcpUrl((entry as { url?: string }).url)
}

function claudeHasVanta(): boolean {
  for (const path of [claudeConfigPath(), claudeProjectMcpPath()]) {
    const servers = mcpServersOf(readJsonFile(path))
    const entry = servers.vanta
    if (!entry || typeof entry !== 'object') continue
    if (isVantaMcpUrl((entry as { url?: string }).url)) return true
  }
  return false
}

function codexHasVanta(): boolean {
  const path = codexConfigPath()
  if (!existsSync(path)) return false
  try {
    const text = readFileSync(path, 'utf8')
    const match = text.match(/\[mcp_servers\.vanta\]([\s\S]*?)(?=\n\[|\n*$)/)
    if (!match) return false
    const body = match[1] || ''
    if (!isVantaMcpUrl(body.match(/url\s*=\s*"([^"]*)"/)?.[1])) return false
    if (/enabled\s*=\s*false/.test(body)) return false
    return true
  } catch {
    return false
  }
}

function connectCursor(): AgentMcpLinkStatus {
  const path = cursorMcpPath()
  const doc = readJsonFile(path)
  const servers = mcpServersOf(doc)
  const url = mcpUrlForWrite()
  servers.vanta = { type: 'http', url }
  doc.mcpServers = servers
  writeJsonFile(path, doc)
  return { agentId: 'cursor', state: 'connected', detail: `${path} → ${url}` }
}

function disconnectCursor(): AgentMcpLinkStatus {
  const path = cursorMcpPath()
  const doc = readJsonFile(path)
  const servers = mcpServersOf(doc)
  delete servers.vanta
  doc.mcpServers = servers
  writeJsonFile(path, doc)
  return { agentId: 'cursor', state: 'off', detail: path }
}

function connectClaude(): AgentMcpLinkStatus {
  const path = claudeConfigPath()
  const doc = readJsonFile(path)
  const servers = mcpServersOf(doc)
  const url = mcpUrlForWrite()
  servers.vanta = { type: 'http', url }
  doc.mcpServers = servers
  writeJsonFile(path, doc)
  return { agentId: 'claude-code', state: 'connected', detail: `${path} → ${url}` }
}

function disconnectClaude(): AgentMcpLinkStatus {
  const paths = [claudeConfigPath(), claudeProjectMcpPath()]
  let last = claudeConfigPath()
  for (const path of paths) {
    if (!existsSync(path)) continue
    last = path
    const doc = readJsonFile(path)
    const servers = mcpServersOf(doc)
    if (!('vanta' in servers)) continue
    delete servers.vanta
    doc.mcpServers = servers
    writeJsonFile(path, doc)
  }
  return { agentId: 'claude-code', state: 'off', detail: last }
}

/** Insert or replace [mcp_servers.vanta] block in Codex TOML. */
function upsertCodexVantaToml(text: string, enable: boolean): string {
  const block = `[mcp_servers.vanta]\nurl = "${mcpUrlForWrite()}"\nenabled = ${enable ? 'true' : 'false'}\n`
  const re = /\[mcp_servers\.vanta\][\s\S]*?(?=\n\[|\n*$)/
  if (re.test(text)) {
    return `${text.replace(re, block).replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
  }
  if (!enable) return text
  const trimmed = text.trimEnd()
  return `${trimmed}${trimmed ? '\n\n' : ''}${block}`
}

function connectCodex(): AgentMcpLinkStatus {
  const path = codexConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  const prev = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const next = upsertCodexVantaToml(prev, true)
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
  return { agentId: 'codex', state: 'connected', detail: path }
}

function disconnectCodex(): AgentMcpLinkStatus {
  const path = codexConfigPath()
  if (!existsSync(path)) {
    return { agentId: 'codex', state: 'off', detail: path }
  }
  const prev = readFileSync(path, 'utf8')
  if (!/\[mcp_servers\.vanta\]/.test(prev)) {
    return { agentId: 'codex', state: 'off', detail: path }
  }
  const next = upsertCodexVantaToml(prev, false)
  writeFileSync(path, next.endsWith('\n') ? next : `${next}\n`, 'utf8')
  return { agentId: 'codex', state: 'off', detail: path }
}

function v0Status(connectedHint: boolean): AgentMcpLinkStatus {
  const publicUrl = getPublicMcpUrl()
  return {
    agentId: 'v0',
    state: connectedHint ? 'connected' : 'needs-setup',
    detail:
      'In v0: Settings → Integrations / MCP → add custom server (No Auth). Use the public tunnel URL for cloud v0.',
    setupSnippet: cloudSetupSnippet(publicUrl)
  }
}

/** Track v0 "connected" as a local preference — v0 BYO MCP lives in their UI. */
function v0PrefPath(): string {
  return join(homedir(), '.vanta', 'v0-mcp-linked.json')
}

function v0PrefConnected(): boolean {
  try {
    const doc = readJsonFile(v0PrefPath())
    return doc.linked === true
  } catch {
    return false
  }
}

function setV0Pref(linked: boolean): void {
  writeJsonFile(v0PrefPath(), { linked, url: VANTA_MCP_URL, updatedAt: Date.now() })
}

export function getAgentMcpLinkStatus(agentId: CodingAgentId): AgentMcpLinkStatus {
  switch (agentId) {
    case 'cursor':
      return cloudLinkState(agentId, cursorHasVanta(), cursorMcpPath())
    case 'claude-code':
      return cloudLinkState(agentId, claudeHasVanta(), claudeConfigPath())
    case 'codex':
      return cloudLinkState(agentId, codexHasVanta(), codexConfigPath())
    case 'v0':
      return enrich(v0Status(v0PrefConnected()))
    default:
      return enrich({ agentId, state: 'off' })
  }
}

export async function connectAgentMcp(agentId: CodingAgentId): Promise<AgentMcpLinkStatus> {
  clearCloudMcpConfirmed(agentId)
  const publicUrl = await ensureMcpTunnel()
  // Write configs only after tunnel URL is known so agents get a reachable HTTPS endpoint.
  switch (agentId) {
    case 'cursor':
      connectCursor()
      break
    case 'claude-code':
      connectClaude()
      break
    case 'codex':
      connectCodex()
      break
    case 'v0':
      setV0Pref(true)
      break
    default:
      break
  }

  let tunnelOk = false
  if (publicUrl) {
    tunnelOk = await verifyTunnel(publicUrl)
  }

  if (agentId === 'v0') {
    const status = enrich(v0Status(true))
    status.tunnelOk = tunnelOk
    if (!publicUrl) {
      status.state = 'needs-setup'
      status.detail = getTunnelError() || status.detail
    }
    return status
  }

  const status = enrich({
    agentId,
    state: publicUrl && tunnelOk ? 'connected' : 'needs-setup',
    detail: publicUrl
      ? tunnelOk
        ? `Vanta MCP live at ${publicUrl}. Done opens Cursor’s install page so it appears under Connectors / MCP.`
        : `Tunnel URL ready but not reachable yet (${publicUrl}). Wait a moment and try Add again.`
      : getTunnelError() ||
        'Tunnel failed. Cloud Agents cannot reach localhost — fix cloudflared, then Connect again.'
  })
  status.tunnelOk = tunnelOk
  // Mark cloud-confirmed when tunnel is verified — Done can open the agent install flow.
  if (publicUrl && tunnelOk) {
    const doc = readJsonFile(cloudPrefPath())
    doc[agentId] = { confirmed: false, publicUrl, updatedAt: Date.now() }
    writeJsonFile(cloudPrefPath(), doc)
  }
  return status
}

export function disconnectAgentMcp(agentId: CodingAgentId): AgentMcpLinkStatus {
  // A named tunnel is shared by every agent and started with the app; only quick tunnels are per-connect.
  if (!hasNamedTunnel()) stopMcpTunnel()
  clearCloudMcpConfirmed(agentId)
  switch (agentId) {
    case 'cursor':
      return enrich(disconnectCursor())
    case 'claude-code':
      return enrich(disconnectClaude())
    case 'codex':
      return enrich(disconnectCodex())
    case 'v0':
      setV0Pref(false)
      return enrich({
        agentId: 'v0',
        state: 'off',
        detail: 'Disconnected. Remove the Vanta MCP entry in v0 / Agents MCP settings if you added one.'
      })
    default:
      return enrich({ agentId, state: 'off' })
  }
}
