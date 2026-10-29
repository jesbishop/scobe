import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type * as z from 'zod'
import { CANVAS_TOOLS, toolAnnotations } from './canvasToolRegistry'
import { emitBuild } from './buildBus'
import { getMcpToken, isMcpRequestAuthorized } from './mcpAuth'
import { runCanvasTool, type CanvasToolContext } from './canvasTools'
import { DESIGN_GUIDE, DESIGN_GUIDE_SUMMARY } from '../shared/designGuide'

export const VANTA_MCP_PORT = 29980
export const VANTA_MCP_URL = `http://127.0.0.1:${VANTA_MCP_PORT}/mcp`

const SCOBE_WEBSITE = 'https://github.com/jesbishop/scobe'
const SCOBE_ICON_URL = 'https://raw.githubusercontent.com/jesbishop/scobe/main/resources/icon.png'

type ServerIcon = { src: string; mimeType: string; sizes: string[] }

let iconDataUri: string | null | undefined

/** Clients that only accept https icons get the GitHub copy; the inline copy works offline. */
function scobeIcons(): ServerIcon[] {
  if (iconDataUri === undefined) {
    try {
      iconDataUri = `data:image/png;base64,${readFileSync(join(app.getAppPath(), 'resources', 'icon.png')).toString('base64')}`
    } catch {
      iconDataUri = null
    }
  }
  const remote: ServerIcon = { src: SCOBE_ICON_URL, mimeType: 'image/png', sizes: ['256x256'] }
  return iconDataUri ? [{ src: iconDataUri, mimeType: 'image/png', sizes: ['256x256'] }, remote] : [remote]
}

/** How Scobe introduces itself in `initialize`, so agents show its name and icon. */
export function scobeServerInfo() {
  return { name: 'scobe', title: 'Scobe', version: app.getVersion(), websiteUrl: SCOBE_WEBSITE, icons: scobeIcons() }
}

type Session = {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

let httpServer: ReturnType<typeof createServer> | null = null
const sessions = new Map<string, Session>()

function textResult(text: string, image?: string) {
  if (!image) return { content: [{ type: 'text' as const, text }] }
  return {
    content: [
      { type: 'text' as const, text },
      { type: 'image' as const, data: image, mimeType: 'image/png' as const }
    ]
  }
}

function registerTools(server: McpServer, ctx: CanvasToolContext) {
  const tool = (
    name: string,
    description: string,
    schema: z.ZodRawShape,
    handler: (args: Record<string, unknown>) => Promise<{ content: string; image?: string }>
  ) => {
    server.registerTool(name, { description, inputSchema: schema, annotations: toolAnnotations(name) }, async (args) => {
      emitBuild({ type: 'build:start', label: name })
      try {
        const result = await handler(args as Record<string, unknown>)
        return textResult(result.content, result.image)
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          isError: true
        }
      }
    })
  }

  const run = (name: string) => (args: Record<string, unknown>) => runCanvasTool(name, args, ctx)

  for (const definition of CANVAS_TOOLS) {
    tool(definition.name, definition.description, definition.schema, run(definition.name))
  }
}

export const SCOBE_MCP_INSTRUCTIONS =
  'You are connected to the Scobe desktop design canvas (NOT Cursor\'s canvas feature, NOT a code repo file). ' +
  'Never use read-canvas or write-canvas — those do not control Scobe. ' +
  'Build UI with Scobe tools only: get_design_guide + get_tokens → get_basic_info → create_artboard / add_design_frame → add_design_* → set_layout / update_styles → render_node to review → fix → finish_working_on_nodes. ' +
  'To bring a live page region into the canvas, use snapshot_browser_to_frame / snapshot_to_canvas (Scobe Snapshot → editable layers). Never use flat screenshot-only paste for “snapshot” / “bring into canvas”. ' +
  'Prefer auto-layout frames. Live browsers stay open; design sits on the canvas beside them. ' +
  'For icons use add_icon (Lucide names, or Iconify ids like mdi:home; search_icons finds them). For logos and illustrations use add_svg with markup or an .svg URL. Never fake icons with emoji, text or colored circles. ' +
  DESIGN_GUIDE_SUMMARY

function registerGuide(server: McpServer) {
  server.registerResource(
    'design-guide',
    'scobe://design-guide',
    { title: 'Scobe design guide', description: 'How to design well on the Scobe canvas.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DESIGN_GUIDE }] })
  )
  server.registerPrompt(
    'design_on_scobe',
    { title: 'Design on Scobe', description: 'Load the Scobe design guide and process before building on the canvas.' },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `${DESIGN_GUIDE}\n\nFollow this guide for everything you build on the Scobe canvas. Start with get_tokens and get_basic_info; inspect only relevant subtrees with get_tree_summary and get_node_info, and finish each build with render_node and a review pass.`
          }
        }
      ]
    })
  )
}

function newServer(ctx: CanvasToolContext): McpServer {
  const server = new McpServer(scobeServerInfo(), { instructions: SCOBE_MCP_INSTRUCTIONS })
  registerTools(server, ctx)
  registerGuide(server)
  return server
}

/** Tool definitions as agents see them (JSON Schema inputs), for the offline cache. */
export async function listToolDefinitions(ctx: CanvasToolContext): Promise<unknown[]> {
  const server = newServer(ctx)
  const client = new Client({ name: 'scobe-cache', version: app.getVersion() })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  await client.connect(clientSide)
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
    await server.close()
  }
}

function createSession(ctx: CanvasToolContext): Session {
  const server = newServer(ctx)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport })
    }
  })
  transport.onclose = () => {
    const sid = transport.sessionId
    if (sid) sessions.delete(sid)
  }
  return { server, transport }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      if (!chunks.length) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function rejectUnauthorized(res: ServerResponse): void {
  // 403 rather than 401: MCP clients treat 401 as "start OAuth", which Vanta doesn't offer.
  res.writeHead(403, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Forbidden: missing or invalid Scobe MCP token. Reconnect from Scobe to get a fresh URL.' },
      id: null
    })
  )
}

let mcpRunning = false

export async function startVantaMcp(ctx: CanvasToolContext): Promise<{ url: string; port: number }> {
  if (httpServer) {
    mcpRunning = true
    emitBuild({ type: 'mcp:status', running: true, url: VANTA_MCP_URL, port: VANTA_MCP_PORT })
    return { url: VANTA_MCP_URL, port: VANTA_MCP_PORT }
  }

  getMcpToken()
  httpServer = createServer(async (req, res) => {
    // No CORS headers on purpose: web pages must not be able to drive the canvas.
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${VANTA_MCP_PORT}`)
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found. Use /mcp' }))
      return
    }
    if (!isMcpRequestAuthorized(req, url, VANTA_MCP_PORT)) {
      rejectUnauthorized(res)
      return
    }

    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined
      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.transport.handleRequest(req, res, body)
          return
        }
        if (!sessionId && isInitializeRequest(body)) {
          const session = createSession(ctx)
          await session.server.connect(session.transport)
          await session.transport.handleRequest(req, res, body)
          return
        }
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
            id: null
          })
        )
        return
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400).end('Invalid or missing session ID')
          return
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res)
        return
      }

      res.writeHead(405).end('Method not allowed')
    } catch (error) {
      console.error('[vanta-mcp]', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error' },
            id: null
          })
        )
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject)
    httpServer!.listen(VANTA_MCP_PORT, '127.0.0.1', () => resolve())
  })

  emitBuild({ type: 'mcp:status', running: true, url: VANTA_MCP_URL, port: VANTA_MCP_PORT })
  mcpRunning = true
  console.log(`[vanta-mcp] listening on ${VANTA_MCP_URL}`)
  return { url: VANTA_MCP_URL, port: VANTA_MCP_PORT }
}

export function isVantaMcpRunning(): boolean {
  return mcpRunning
}

export async function stopVantaMcp(): Promise<void> {
  for (const session of sessions.values()) {
    try {
      await session.server.close()
    } catch {
      /* ignore */
    }
  }
  sessions.clear()
  if (!httpServer) {
    mcpRunning = false
    return
  }
  const server = httpServer
  httpServer = null
  await new Promise<void>((resolve) => server.close(() => resolve()))
  mcpRunning = false
  emitBuild({ type: 'mcp:status', running: false, url: VANTA_MCP_URL, port: VANTA_MCP_PORT })
}
