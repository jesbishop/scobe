/**
 * Fix Canvas — App content after createdNodes id parsing bug.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'http://127.0.0.1:29979/mcp'
const FILE_ID = '01M2CKQER4ZX1V92ZWWM1NXSYF'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '.paper-shots')

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
  if (!dataLine) throw new Error(`No SSE data (${res.status}): ${text.slice(0, 400)}`)
  const msg = JSON.parse(dataLine.slice(6))
  if (msg.error) throw new Error(JSON.stringify(msg.error))
  return msg.result
}

function toolParts(result) {
  const content = result?.content || []
  const texts = []
  const images = []
  for (const c of content) {
    if (c.type === 'text' && c.text) texts.push(c.text)
    if (c.type === 'image' && c.data) images.push(c)
  }
  return { text: texts.join('\n'), images }
}

function parse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function firstCreatedId(text) {
  const j = parse(text)
  return j?.createdNodes?.[0]?.id || j?.id || j?.createdNodeIds?.[0] || null
}

async function call(name, args) {
  console.log(`→ ${name}`, args?.targetNodeId || args?.name || '')
  return toolParts(await rpc('tools/call', { name, arguments: args }))
}

async function screenshot(nodeId, label) {
  const { images } = await call('get_screenshot', { nodeId, fileId: FILE_ID })
  fs.mkdirSync(OUT, { recursive: true })
  if (images[0]?.data) {
    const file = path.join(OUT, `${label}.jpg`)
    fs.writeFileSync(file, Buffer.from(images[0].data, 'base64'))
    console.log('  shot', file)
    return file
  }
  return null
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vanta-paper-fix', version: '1.0.0' }
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

  // Merge Top actions into Top bar: delete misplaced sibling, rebuild top bar
  await call('delete_nodes', { nodeIds: ['7-0'], fileId: FILE_ID })

  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: '2-0',
    mode: 'replace',
    html: `<div layer-name="Top bar" style="display:flex; flex-direction:row; align-items:center; justify-content:space-between; width:1440px; height:48px; padding:0px 16px; background-color:#0B0B0C; border-bottom:1px solid #1F1F22;">
  <div style="display:flex; flex-direction:row; align-items:center; gap:12px;">
    <div style="font-family:Syne; font-weight:700; font-size:18px; color:#F5F5F4; letter-spacing:-0.02em;">Vanta</div>
    <div style="font-family:Instrument Sans; font-weight:500; font-size:12px; color:#78716C;">Untitled canvas</div>
  </div>
  <div style="display:flex; flex-direction:row; align-items:center; gap:10px;">
    <div style="display:flex; flex-direction:row; align-items:center; gap:6px; padding:4px 10px; background-color:#14532D; border-radius:999px;">
      <div style="width:6px; height:6px; border-radius:999px; background-color:#4ADE80;"></div>
      <div style="font-family:Instrument Sans; font-weight:500; font-size:11px; color:#BBF7D0;">MCP live</div>
    </div>
    <div style="font-family:Instrument Sans; font-weight:500; font-size:12px; color:#A8A29E;">100%</div>
  </div>
</div>`
  })

  // Fill coding agents rail
  const railId = 'F-0'
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: railId,
    mode: 'insert-children',
    html: `<div layer-name="Rail title" style="font-family:Instrument Sans; font-weight:600; font-size:11px; color:#78716C; letter-spacing:0.08em;">CODING AGENTS</div>`
  })

  const agents = [
    ['Cursor', true],
    ['Claude', false],
    ['Codex', false],
    ['v0', false]
  ]
  for (const [name, active] of agents) {
    await call('write_html', {
      fileId: FILE_ID,
      targetNodeId: railId,
      mode: 'insert-children',
      html: `<div layer-name="${name}" style="display:flex; flex-direction:row; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; background-color:${active ? '#1C1917' : 'transparent'};">
  <div style="width:8px; height:8px; border-radius:999px; background-color:${active ? '#F5F5F4' : '#44403C'};"></div>
  <div style="font-family:Instrument Sans; font-weight:${active ? 600 : 500}; font-size:14px; color:${active ? '#F5F5F4' : '#A8A29E'};">${name}</div>
</div>`
    })
  }

  // Fill infinite canvas
  const canvasId = 'H-0'
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Coords" style="font-family:Instrument Sans; font-weight:500; font-size:11px; color:#57534E;">-200 · 80</div>`
  })

  let r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Frame — Hero" style="display:flex; flex-direction:column; width:720px; height:400px; padding:40px; gap:20px; background-color:#0B0B0C; border:1px solid #292524; border-radius:4px; justify-content:center;"></div>`
  })
  const frameId = firstCreatedId(r.text)
  console.log('frame', frameId, r.text.slice(0, 200))

  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: frameId,
    mode: 'insert-children',
    html: `<div layer-name="Headline" style="font-family:Syne; font-weight:700; font-size:40px; color:#F5F5F4; letter-spacing:-0.03em; line-height:44px; width:640px;">Ship interfaces while you think</div>`
  })
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: frameId,
    mode: 'insert-children',
    html: `<div layer-name="Subcopy" style="font-family:Instrument Sans; font-weight:400; font-size:16px; color:#A8A29E; line-height:24px; width:520px;">Vanta pairs live browsers with a Paper-like design canvas. Agents build on it over MCP.</div>`
  })
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: frameId,
    mode: 'insert-children',
    html: `<div layer-name="CTA row" style="display:flex; flex-direction:row; gap:12px; padding-top:8px;">
  <div style="display:flex; align-items:center; justify-content:center; width:148px; height:44px; background-color:#F5F5F4; border-radius:8px; font-family:Instrument Sans; font-weight:600; font-size:14px; color:#0B0B0C;">Open canvas</div>
  <div style="display:flex; align-items:center; justify-content:center; width:148px; height:44px; background-color:#292524; border-radius:8px; font-family:Instrument Sans; font-weight:600; font-size:14px; color:#E7E5E4;">Watch demo</div>
</div>`
  })

  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Browser — Live" style="display:flex; flex-direction:column; width:480px; height:280px; background-color:#0B0B0C; border:1px solid #292524; border-radius:8px; overflow:hidden;"></div>`
  })
  const browserId = firstCreatedId(r.text)
  console.log('browser', browserId)

  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: browserId,
    mode: 'insert-children',
    html: `<div layer-name="Browser chrome" style="display:flex; flex-direction:row; align-items:center; gap:8px; height:36px; padding:0px 12px; background-color:#1C1917; border-bottom:1px solid #292524;">
  <div style="width:8px; height:8px; border-radius:999px; background-color:#44403C;"></div>
  <div style="width:8px; height:8px; border-radius:999px; background-color:#44403C;"></div>
  <div style="width:8px; height:8px; border-radius:999px; background-color:#44403C;"></div>
  <div style="display:flex; flex:1; align-items:center; height:22px; padding:0px 10px; background-color:#0B0B0C; border-radius:6px; font-family:Instrument Sans; font-weight:400; font-size:11px; color:#78716C;">localhost:5173</div>
</div>`
  })
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: browserId,
    mode: 'insert-children',
    html: `<div layer-name="Browser body" style="display:flex; flex-direction:column; padding:28px; gap:12px; background-color:#FAFAF9; height:244px;">
  <div style="font-family:Syne; font-weight:700; font-size:22px; color:#0B0B0C;">Live Chromium</div>
  <div style="font-family:Instrument Sans; font-weight:400; font-size:13px; color:#57534E; line-height:20px; width:360px;">Real web content sits on the infinite canvas beside design frames — inspect, navigate, convert.</div>
</div>`
  })

  // Confirm children
  console.log('rail kids', (await call('get_children', { nodeId: railId })).text.slice(0, 400))
  console.log('canvas kids', (await call('get_children', { nodeId: canvasId })).text.slice(0, 400))

  await screenshot('1-0', 'canvas-app-v2')
  await call('finish_working_on_nodes', { fileId: FILE_ID })
  console.log('Fixed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
