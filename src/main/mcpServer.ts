import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import * as z from 'zod'
import { emitBuild } from './buildBus'
import { getMcpToken, isMcpRequestAuthorized } from './mcpAuth'
import { runCanvasTool, type CanvasToolContext } from './canvasTools'

export const VANTA_MCP_PORT = 29980
export const VANTA_MCP_URL = `http://127.0.0.1:${VANTA_MCP_PORT}/mcp`

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
    server.registerTool(name, { description, inputSchema: schema }, async (args) => {
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

  tool('get_basic_info', 'File overview: node count and artboards/frames with sizes.', {}, run('get_basic_info'))
  tool('list_design', 'List all design nodes with parentId, layout, and world bounds.', {}, run('list_design'))
  tool(
    'get_tree_summary',
    'Compact hierarchy summary of the canvas or a subtree.',
    {
      id: z.string().optional().describe('Root node id; omit for whole canvas'),
      depth: z.number().optional().describe('Max depth (default 4)')
    },
    run('get_tree_summary')
  )
  tool(
    'get_node_info',
    'Details for a design node by id.',
    { id: z.string().describe('Node id') },
    run('get_node_info')
  )
  tool(
    'get_screenshot',
    'Screenshot a live browser tab by id (base64 PNG).',
    { id: z.string().describe('Browser tab id'), browserId: z.string().optional() },
    run('get_screenshot')
  )
  tool('list_browsers', 'List live browsers/tabs on the Scobe canvas.', {}, run('list_browsers'))
  tool(
    'create_artboard',
    'Create a design frame (artboard). Prefer auto-layout for UI builds.',
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fill: z.string().optional(),
      autoLayout: z.boolean().optional()
    },
    run('create_artboard')
  )
  tool(
    'add_design_frame',
    'Add a design frame with optional auto-layout and parentId.',
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fill: z.string().optional()
    },
    run('add_design_frame')
  )
  tool(
    'add_design_rect',
    'Add a rectangle.',
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fill: z.string().optional()
    },
    run('add_design_rect')
  )
  tool(
    'add_design_ellipse',
    'Add an ellipse.',
    {
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fill: z.string().optional()
    },
    run('add_design_ellipse')
  )
  tool(
    'add_design_text',
    'Add text on the canvas.',
    {
      x: z.number(),
      y: z.number(),
      text: z.string(),
      parentId: z.string().optional(),
      fontSize: z.number().optional(),
      fill: z.string().optional()
    },
    run('add_design_text')
  )
  tool(
    'set_text_content',
    'Set text on an existing text node, or create text if only x/y/text are given.',
    {
      id: z.string().optional(),
      text: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      parentId: z.string().optional(),
      fontSize: z.number().optional(),
      fill: z.string().optional()
    },
    run('set_text_content')
  )
  tool(
    'update_design',
    'Patch fields on a design node.',
    { id: z.string(), patch: z.record(z.string(), z.unknown()) },
    run('update_design')
  )
  tool(
    'update_styles',
    'Update style-like fields on a node (fill, opacity, radius, etc).',
    { id: z.string(), styles: z.record(z.string(), z.unknown()).optional(), fill: z.string().optional() },
    run('update_styles')
  )
  tool(
    'set_layout',
    'Set auto-layout on a frame.',
    {
      id: z.string(),
      mode: z.enum(['none', 'horizontal', 'vertical']),
      gap: z.number().optional(),
      padding: z.number().optional(),
      alignItems: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      justifyContent: z.enum(['start', 'center', 'end', 'space-between']).optional()
    },
    run('set_layout')
  )
  tool(
    'set_parent',
    'Reparent a node under a frame/section (or null).',
    { id: z.string(), parentId: z.string().nullable().optional() },
    run('set_parent')
  )
  tool(
    'move_design',
    'Move a node. World coords unless relative=true.',
    { id: z.string(), x: z.number(), y: z.number(), relative: z.boolean().optional() },
    run('move_design')
  )
  tool(
    'resize_design',
    'Resize a node.',
    { id: z.string(), width: z.number(), height: z.number() },
    run('resize_design')
  )
  tool(
    'rename_nodes',
    'Rename a layer.',
    { id: z.string(), name: z.string() },
    run('rename_nodes')
  )
  tool(
    'duplicate_nodes',
    'Duplicate a node.',
    { id: z.string() },
    run('duplicate_nodes')
  )
  tool(
    'delete_nodes',
    'Delete nodes. keepChildren unparents instead of cascading.',
    { ids: z.array(z.string()).optional(), id: z.string().optional(), keepChildren: z.boolean().optional() },
    run('delete_nodes')
  )
  tool(
    'snapshot_browser_to_frame',
    'Bring a live browser region into the canvas using Scobe’s real Snapshot tool (DOM → editable layers, not a flat PNG). Prefer selector for sidebars (e.g. ytd-guide-renderer). Place beside the browser by default.',
    {
      browserId: z.string().describe('Browser window id or tab id from list_browsers'),
      selector: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('CSS selector(s) to snapshot. Defaults to common nav/sidebar landmarks.'),
      pointX: z.number().optional().describe('Optional CSS viewport X to pick an element'),
      pointY: z.number().optional().describe('Optional CSS viewport Y to pick an element'),
      x: z.number().optional().describe('Canvas X for the pasted root'),
      y: z.number().optional().describe('Canvas Y for the pasted root'),
      name: z.string().optional()
    },
    run('snapshot_browser_to_frame')
  )
  tool(
    'snapshot_to_canvas',
    'Alias of snapshot_browser_to_frame — use Scobe Snapshot (layered) to paste a browser region onto the design canvas.',
    {
      browserId: z.string(),
      selector: z.union([z.string(), z.array(z.string())]).optional(),
      pointX: z.number().optional(),
      pointY: z.number().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      name: z.string().optional()
    },
    run('snapshot_to_canvas')
  )
  tool(
    'open_browser',
    'Open a live browser on the canvas.',
    { url: z.string() },
    run('open_browser')
  )
  tool(
    'navigate',
    'Navigate a browser tab.',
    { browserId: z.string(), url: z.string() },
    run('navigate')
  )
  tool(
    'screenshot',
    'Screenshot a browser for click coordinates.',
    { browserId: z.string() },
    run('screenshot')
  )
  tool(
    'finish_working_on_nodes',
    'Clear Paper-like working indicators after a build pass. Call when done building.',
    { ids: z.array(z.string()).optional() },
    run('finish_working_on_nodes')
  )
  tool(
    'open_coding_agent',
    'Open a coding agent in the Scobe left sidebar (cursor, claude-code, codex, or v0).',
    {
      agentId: z.enum(['cursor', 'claude-code', 'codex', 'v0']).describe('Which agent to open'),
      projectName: z.string().optional()
    },
    run('open_coding_agent')
  )
}

export const SCOBE_MCP_INSTRUCTIONS =
  'You are connected to the Scobe desktop design canvas (NOT Cursor\'s canvas feature, NOT a code repo file). ' +
  'Never use read-canvas or write-canvas — those do not control Scobe. ' +
  'Build UI with Scobe tools only: get_basic_info → create_artboard / add_design_frame → add_design_* → set_layout / update_styles → finish_working_on_nodes. ' +
  'To bring a live page region into the canvas, use snapshot_browser_to_frame / snapshot_to_canvas (Scobe Snapshot → editable layers). Never use flat screenshot-only paste for “snapshot” / “bring into canvas”. ' +
  'Prefer auto-layout frames. Live browsers stay open; design sits on the canvas beside them.'

function newServer(ctx: CanvasToolContext): McpServer {
  const server = new McpServer({ name: 'scobe', version: app.getVersion() }, { instructions: SCOBE_MCP_INSTRUCTIONS })
  registerTools(server, ctx)
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
