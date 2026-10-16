/**
 * Place the YouTube sidebar shell on a live Vanta canvas via MCP.
 * Requires Vanta running with MCP at http://127.0.0.1:29980/mcp
 */
import http from 'node:http'

const HOST = '127.0.0.1'
const PORT = 29980
const PATH = '/mcp'

function request(method, body, sessionId) {
  const payload = body == null ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: PATH,
        method,
        headers: {
          Accept: 'application/json, text/event-stream',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
          ...(sessionId ? { 'mcp-session-id': sessionId } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            sessionId: res.headers['mcp-session-id'],
            raw: data
          })
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function parseSseJson(raw) {
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data:'))
  if (!line) throw new Error(`No SSE data in response:\n${raw}`)
  return JSON.parse(line.slice(5).trim())
}

async function rpc(sessionId, id, method, params) {
  const res = await request('POST', { jsonrpc: '2.0', id, method, params }, sessionId)
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${res.raw}`)
  const msg = parseSseJson(res.raw)
  if (msg.error) throw new Error(JSON.stringify(msg.error))
  return { sessionId: res.sessionId || sessionId, result: msg.result }
}

async function callTool(sessionId, id, name, args) {
  console.log(`→ ${name}`)
  const { sessionId: sid, result } = await rpc(sessionId, id, 'tools/call', {
    name,
    arguments: args
  })
  const text = result?.content?.find((c) => c.type === 'text')?.text
  if (text) console.log(`  ${text.slice(0, 240)}${text.length > 240 ? '…' : ''}`)
  return sid
}

async function main() {
  const init = await rpc(undefined, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vanta-youtube-sidebar', version: '1.0.0' }
  })
  let sid = init.sessionId
  if (!sid) throw new Error('No mcp-session-id from initialize')
  await request('POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, sid)

  sid = await callTool(sid, 10, 'build_youtube_sidebar', {
    x: 80,
    y: 80,
    width: 1440,
    height: 900
  })
  sid = await callTool(sid, 11, 'finish_working_on_nodes', {})
  console.log('\nDone. YouTube sidebar shell should be on the Vanta canvas.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
