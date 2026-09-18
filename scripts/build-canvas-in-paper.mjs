/**
 * Build the Vanta "Canvas" page in Paper Desktop (file: Vanta) via local MCP :29979
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
  return { text: texts.join('\n'), images, raw: result }
}

async function call(name, args) {
  console.log(`→ ${name}`, args?.name || args?.topic || args?.targetNodeId || '')
  return toolParts(await rpc('tools/call', { name, arguments: args }))
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function firstCreatedId(text) {
  const j = parseJson(text)
  return j?.createdNodes?.[0]?.id || j?.id || j?.createdNodeIds?.[0] || null
}

async function screenshot(nodeId, label) {
  const { text, images } = await call('get_screenshot', { nodeId, fileId: FILE_ID })
  fs.mkdirSync(OUT, { recursive: true })
  if (images[0]?.data) {
    const file = path.join(OUT, `${label}.png`)
    fs.writeFileSync(file, Buffer.from(images[0].data, 'base64'))
    console.log(`  screenshot → ${file}`)
    return file
  }
  console.log('  screenshot text:', text.slice(0, 200))
  return null
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vanta-paper-canvas', version: '1.0.0' }
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

  await call('open_file', { fileId: FILE_ID })

  const pageRes = await call('create_page', { name: 'Canvas', fileId: FILE_ID })
  const page = parseJson(pageRes.text)
  const pageId = page?.pageId || page?.id
  console.log('page', pageRes.text)
  if (pageId) {
    await call('open_file', { fileId: FILE_ID, pageId })
  }

  await call('get_font_family_info', {
    familyNames: ['Syne', 'Instrument Sans']
  })

  // —— Artboard: product canvas ——
  const ab = await call('create_artboard', {
    name: 'Canvas — App',
    fileId: FILE_ID,
    styles: {
      width: '1440px',
      height: '900px',
      backgroundColor: '#111113',
      display: 'flex',
      flexDirection: 'column',
      padding: '0px',
      gap: '0px',
      overflow: 'hidden'
    }
  })
  const artboardId =
    parseJson(ab.text)?.id ||
    parseJson(ab.text)?.nodeId ||
    ab.text.match(/"[A-Z0-9-]+"/)?.[0]?.replace(/"/g, '')
  console.log('artboard', ab.text)
  if (!artboardId) throw new Error('No artboard id')

  // Top chrome
  let r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: artboardId,
    mode: 'insert-children',
    html: `<div layer-name="Top bar" style="display:flex; flex-direction:row; align-items:center; justify-content:space-between; width:1440px; height:48px; padding:0px 16px; background-color:#0B0B0C; border-bottom:1px solid #1F1F22;">
  <div style="display:flex; flex-direction:row; align-items:center; gap:12px;">
    <div style="font-family:Syne; font-weight:700; font-size:18px; color:#F5F5F4; letter-spacing:-0.02em;">Vanta</div>
    <div style="font-family:Instrument Sans; font-weight:500; font-size:12px; color:#78716C;">Untitled canvas</div>
  </div>
</div>`
  })
  const topId = parseJson(r.text)?.createdNodeIds?.[0] || parseJson(r.text)?.ids?.[0]

  // Add MCP pill into top bar trailing side via a full replace of top if needed — instead add as sibling row content
  // Re-write top with trailing controls in one group was already done partially; add right cluster
  const tree = await call('get_children', { nodeId: artboardId, fileId: FILE_ID })
  console.log('children after top', tree.text.slice(0, 500))

  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: topId || artboardId,
    mode: topId ? 'insert-children' : 'insert-children',
    html: `<div layer-name="Top actions" style="display:flex; flex-direction:row; align-items:center; gap:10px; margin-left:auto;">
  <div style="display:flex; flex-direction:row; align-items:center; gap:6px; padding:4px 10px; background-color:#14532D; border-radius:999px;">
    <div style="width:6px; height:6px; border-radius:999px; background-color:#4ADE80;"></div>
    <div style="font-family:Instrument Sans; font-weight:500; font-size:11px; color:#BBF7D0;">MCP live</div>
  </div>
  <div style="font-family:Instrument Sans; font-weight:500; font-size:12px; color:#A8A29E;">100%</div>
</div>`
  })

  // Body: rail + canvas
  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: artboardId,
    mode: 'insert-children',
    html: `<div layer-name="Workspace" style="display:flex; flex-direction:row; width:1440px; height:852px; gap:0px; background-color:#111113;"></div>`
  })
  const workspaceId =
    parseJson(r.text)?.createdNodeIds?.[0] ||
    parseJson(r.text)?.ids?.[0] ||
    (await (async () => {
      const ch = parseJson((await call('get_children', { nodeId: artboardId, fileId: FILE_ID })).text)
      const kids = ch?.children || ch || []
      const last = Array.isArray(kids) ? kids[kids.length - 1] : null
      return last?.id
    })())
  console.log('workspace', r.text, workspaceId)

  // Left rail shell
  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: workspaceId,
    mode: 'insert-children',
    html: `<div layer-name="Coding agents" style="display:flex; flex-direction:column; width:220px; height:852px; padding:16px 12px; gap:12px; background-color:#0B0B0C; border-right:1px solid #1F1F22;"></div>`
  })
  const railId = parseJson(r.text)?.createdNodeIds?.[0] || parseJson(r.text)?.ids?.[0]
  console.log('rail', r.text)

  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: railId,
    mode: 'insert-children',
    html: `<div layer-name="Rail title" style="font-family:Instrument Sans; font-weight:600; font-size:11px; color:#78716C; letter-spacing:0.08em; text-transform:uppercase;">Coding agents</div>`
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

  // Canvas stage
  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: workspaceId,
    mode: 'insert-children',
    html: `<div layer-name="Infinite canvas" style="display:flex; flex-direction:column; width:1220px; height:852px; padding:48px 56px; gap:28px; background-color:#161618; position:relative; overflow:hidden;"></div>`
  })
  const canvasId = parseJson(r.text)?.createdNodeIds?.[0] || parseJson(r.text)?.ids?.[0]
  console.log('canvas', r.text)

  // Decorative dots (subtle, not full cover)
  await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Grid hint" style="position:absolute; left:24px; top:24px; width:120px; height:12px; font-family:Instrument Sans; font-weight:500; font-size:11px; color:#57534E;">−200 · 80</div>`
  })

  // Design frame on canvas
  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Frame — Hero" style="display:flex; flex-direction:column; width:720px; height:420px; padding:40px; gap:20px; background-color:#0B0B0C; border:1px solid #292524; border-radius:4px; justify-content:center;"></div>`
  })
  const frameId = parseJson(r.text)?.createdNodeIds?.[0] || parseJson(r.text)?.ids?.[0]

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

  // Browser frame beside / below
  r = await call('write_html', {
    fileId: FILE_ID,
    targetNodeId: canvasId,
    mode: 'insert-children',
    html: `<div layer-name="Browser — Live" style="display:flex; flex-direction:column; width:480px; height:280px; background-color:#0B0B0C; border:1px solid #292524; border-radius:8px; overflow:hidden;"></div>`
  })
  const browserId = parseJson(r.text)?.createdNodeIds?.[0] || parseJson(r.text)?.ids?.[0]

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
    html: `<div layer-name="Browser body" style="display:flex; flex-direction:column; flex:1; padding:28px; gap:12px; background-color:#FAFAF9; height:244px;">
  <div style="font-family:Syne; font-weight:700; font-size:22px; color:#0B0B0C;">Live Chromium</div>
  <div style="font-family:Instrument Sans; font-weight:400; font-size:13px; color:#57534E; line-height:20px; width:360px;">Real web content sits on the infinite canvas beside design frames — inspect, navigate, convert.</div>
</div>`
  })

  await screenshot(artboardId, 'canvas-app-v1')

  // —— Second artboard: Features strip (marketing) ——
  const feat = await call('create_artboard', {
    name: 'Canvas — Features',
    fileId: FILE_ID,
    styles: {
      width: '1440px',
      height: '520px',
      backgroundColor: '#FAFAF9',
      display: 'flex',
      flexDirection: 'row',
      padding: '56px',
      gap: '28px'
    }
  })
  const featId = parseJson(feat.text)?.id || parseJson(feat.text)?.nodeId
  console.log('features artboard', feat.text)

  const cards = [
    ['Live browsers', 'Real Chromium tabs on an infinite canvas — inspect, navigate, measure.'],
    ['Structured frames', 'Auto-layout frames nest like Paper. Agents build UI, not screenshots.'],
    ['Cursor MCP', 'This page was generated from Cursor talking to Paper over localhost MCP.']
  ]

  if (featId) {
    for (const [title, blurb] of cards) {
      r = await call('write_html', {
        fileId: FILE_ID,
        targetNodeId: featId,
        mode: 'insert-children',
        html: `<div layer-name="${title}" style="display:flex; flex-direction:column; width:400px; height:408px; padding:28px; gap:16px; background-color:#FFFFFF; border-radius:18px; border:1px solid #E7E5E4;">
  <div style="font-family:Syne; font-weight:700; font-size:28px; color:#0B0B0C; letter-spacing:-0.02em;">${title}</div>
  <div style="font-family:Instrument Sans; font-weight:400; font-size:16px; color:#57534E; line-height:24px;">${blurb}</div>
</div>`
      })
    }
    await screenshot(featId, 'canvas-features-v1')
  }

  await call('finish_working_on_nodes', { fileId: FILE_ID })
  console.log('Done. Page: Canvas — artboards Canvas — App + Canvas — Features')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
