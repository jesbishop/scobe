/** Cursor one-click MCP install (adds server so it can show under Agents MCP / Connectors). */

export function buildCursorInstallMcpUrl(mcpUrl: string): string {
  const config = {
    type: 'http',
    url: mcpUrl
  }
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64')
  return `https://cursor.com/install-mcp?name=${encodeURIComponent('vanta')}&config=${encodeURIComponent(encoded)}`
}

export function buildCursorMcpDeeplink(mcpUrl: string): string {
  const config = {
    type: 'http',
    url: mcpUrl
  }
  const encoded = Buffer.from(JSON.stringify(config), 'utf8').toString('base64url')
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent('vanta')}&config=${encoded}`
}

export function buildCursorAgentsUrl(): string {
  return 'https://cursor.com/agents'
}
