'use strict'
/**
 * stdio MCP server for agents (Cursor, Claude Code, Claude Desktop).
 * Scobe installs this to ~/.scobe/bridge and runs it with its own Electron binary in Node mode,
 * so users need nothing else installed. It relays to the Scobe app while it is open and answers
 * from the last saved tool list when it is not, so the agent still sees Scobe's tools.
 * Plain Node, no dependencies: stdout carries JSON-RPC only; logs go to stderr.
 */
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { join } = require('node:path')
const readline = require('node:readline')

const PORT = Number(process.env.SCOBE_MCP_PORT) || 29980
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`
const CACHE_FILE = join(homedir(), '.scobe', 'mcp-cache.json')
const OFFLINE_TEXT = 'Scobe is not open. Open the Scobe app, then try again.'
const FALLBACK_PROTOCOL = '2025-06-18'
const ICON_URL = 'https://raw.githubusercontent.com/jesbishop/scobe/main/resources/icon.png'

let sessionId = null
let upstreamStarting = null
let clientInitialize = null

function log(...args) {
  process.stderr.write(`[scobe-mcp] ${args.join(' ')}\n`)
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
  } catch {
    return null
  }
}

class Offline extends Error {}

function parseSse(text) {
  const messages = []
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try {
      messages.push(JSON.parse(data))
    } catch {
      /* keep-alive or partial event */
    }
  }
  return messages
}

async function post(body) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (sessionId) headers['mcp-session-id'] = sessionId
  let res
  try {
    res = await fetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    throw new Offline(OFFLINE_TEXT)
  }
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  if (res.status === 202) return []
  if (!res.ok) {
    const error = new Error(`Scobe answered ${res.status}: ${(await res.text()).slice(0, 300)}`)
    error.status = res.status
    throw error
  }
  const type = res.headers.get('content-type') || ''
  if (type.includes('text/event-stream')) return parseSse(await res.text())
  const data = await res.json()
  return Array.isArray(data) ? data : [data]
}

/** Our own session with the app, opened lazily so the agent can start before Scobe does. */
function ensureUpstream() {
  if (sessionId) return Promise.resolve()
  if (!upstreamStarting) {
    upstreamStarting = (async () => {
      const params = clientInitialize || {
        protocolVersion: FALLBACK_PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'scobe-mcp-bridge', version: '1.0.0' }
      }
      await post({ jsonrpc: '2.0', id: 'scobe-bridge-initialize', method: 'initialize', params })
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })().finally(() => {
      upstreamStarting = null
    })
  }
  return upstreamStarting
}

async function forward(message, retried = false) {
  try {
    await ensureUpstream()
    return await post(message)
  } catch (error) {
    // Scobe restarted, so our session is gone: open a fresh one once.
    if (!retried && (error.status === 400 || error.status === 404)) {
      sessionId = null
      return forward(message, true)
    }
    throw error
  }
}

function initializeResult(params) {
  const cache = readCache()
  return {
    protocolVersion: params?.protocolVersion || FALLBACK_PROTOCOL,
    capabilities: { tools: { listChanged: false } },
    serverInfo: cache?.serverInfo || {
      name: 'scobe',
      title: 'Scobe',
      version: cache?.version || '0.0.0',
      icons: [{ src: ICON_URL, mimeType: 'image/png', sizes: ['256x256'] }]
    },
    ...(cache?.instructions ? { instructions: cache.instructions } : {})
  }
}

async function handleRequest(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    clientInitialize = params || null
    sessionId = null
    return send({ jsonrpc: '2.0', id, result: initializeResult(params) })
  }
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
  try {
    for (const reply of await forward(message)) send(reply)
  } catch (error) {
    if (error instanceof Offline) {
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: readCache()?.tools || [] } })
      if (method === 'tools/call') {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: OFFLINE_TEXT }], isError: true } })
      }
      return send({ jsonrpc: '2.0', id, error: { code: -32000, message: OFFLINE_TEXT } })
    }
    log(error.message)
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message } })
  }
}

function handle(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return
  if (typeof message.method !== 'string') return
  if (message.id === undefined || message.id === null) {
    // Upstream gets its own `initialized`; other notifications (cancellations) are best effort.
    if (message.method === 'notifications/initialized' || !sessionId) return
    void post(message).catch(() => undefined)
    return
  }
  void handleRequest(message)
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  const text = line.trim()
  if (!text) return
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  if (Array.isArray(parsed)) parsed.forEach(handle)
  else handle(parsed)
})

// Exit by letting the event loop drain: process.exit() while fetch sockets close aborts on Windows.
input.on('close', () => {
  setTimeout(() => process.exit(0), 3000).unref()
  if (!sessionId) return
  const headers = { 'mcp-session-id': sessionId }
  void fetch(ENDPOINT, { method: 'DELETE', headers, signal: AbortSignal.timeout(1500) }).catch(() => undefined)
})
