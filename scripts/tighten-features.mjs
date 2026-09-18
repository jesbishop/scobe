import fs from 'node:fs'

const BASE = 'http://127.0.0.1:29979/mcp'
const FILE_ID = '01M2CKQER4ZX1V92ZWWM1NXSYF'
let sessionId = null
let id = 1

async function rpc(method, params) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params })
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) sessionId = sid
  const text = await res.text()
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
  const msg = JSON.parse(dataLine.slice(6))
  if (msg.error) throw new Error(JSON.stringify(msg.error))
  return msg.result
}

async function call(name, args) {
  return rpc('tools/call', { name, arguments: args })
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'tighten', version: '1' }
})
await fetch(BASE, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'mcp-session-id': sessionId
  },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
})
await call('open_file', { fileId: FILE_ID, pageId: '2-0' })
await call('update_styles', {
  fileId: FILE_ID,
  updates: [
    { nodeIds: ['K-0', 'O-0', 'S-0'], styles: { height: 'fit-content', paddingBottom: '28px' } },
    { nodeIds: ['J-0'], styles: { height: 'fit-content' } }
  ]
})
const shot = await call('get_screenshot', { nodeId: 'J-0', scale: 2 })
const img = shot.content.find((c) => c.type === 'image')
fs.mkdirSync('scripts/.paper-shots', { recursive: true })
fs.writeFileSync('scripts/.paper-shots/features-s2.jpg', Buffer.from(img.data, 'base64'))
await call('finish_working_on_nodes', { fileId: FILE_ID })
console.log('tightened features')
