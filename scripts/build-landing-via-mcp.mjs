/**
 * Build a demo landing page on the live Vanta canvas via MCP.
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
  if (text) console.log(`  ${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`)
  return sid
}

async function main() {
  const init = await rpc(undefined, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vanta-demo', version: '1.0.0' }
  })
  let sid = init.sessionId
  if (!sid) throw new Error('No mcp-session-id from initialize')
  await request(
    'POST',
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    sid
  )

  // Hero artboard
  sid = await callTool(sid, 10, 'create_artboard', {
    x: 80,
    y: 80,
    width: 1280,
    height: 900,
    name: 'Landing — Hero',
    autoLayout: true
  })

  // Nested content card
  sid = await callTool(sid, 11, 'add_design_frame', {
    x: 120,
    y: 140,
    width: 560,
    height: 420,
    name: 'Hero copy',
    parentId: undefined
  })

  // Parse last create for ids via list
  const listed = await rpc(sid, 12, 'tools/call', { name: 'list_design', arguments: {} })
  sid = listed.sessionId
  const nodes = JSON.parse(listed.result.content.find((c) => c.type === 'text').text)
  const artboard =
    nodes.artboards?.find((a) => a.name === 'Landing — Hero') ||
    nodes.nodes?.find((n) => n.name === 'Landing — Hero')
  const artboardId = artboard?.id
  if (!artboardId) throw new Error('Could not find hero artboard id')

  sid = await callTool(sid, 13, 'set_layout', {
    id: artboardId,
    mode: 'vertical',
    gap: 24,
    padding: 64,
    alignItems: 'start',
    justifyContent: 'center'
  })

  sid = await callTool(sid, 14, 'add_design_text', {
    x: 0,
    y: 0,
    text: 'Design at the speed of code',
    parentId: artboardId,
    fontSize: 56,
    fill: '#111111'
  })

  sid = await callTool(sid, 15, 'add_design_text', {
    x: 0,
    y: 0,
    text: 'Vanta is an infinite canvas of live browsers and Paper-like frames. Prompt your coding agent — watch the UI appear.',
    parentId: artboardId,
    fontSize: 20,
    fill: '#444444'
  })

  sid = await callTool(sid, 16, 'add_design_frame', {
    x: 0,
    y: 0,
    width: 280,
    height: 52,
    name: 'CTA row',
    parentId: artboardId
  })

  const listed2 = await rpc(sid, 17, 'tools/call', { name: 'list_design', arguments: {} })
  sid = listed2.sessionId
  const nodes2 = JSON.parse(listed2.result.content.find((c) => c.type === 'text').text)
  const cta = nodes2.nodes?.find((n) => n.name === 'CTA row')
  const ctaId = cta?.id

  if (ctaId) {
    sid = await callTool(sid, 18, 'set_layout', {
      id: ctaId,
      mode: 'horizontal',
      gap: 12,
      padding: 0,
      alignItems: 'stretch'
    })
    sid = await callTool(sid, 19, 'add_design_rect', {
      x: 0,
      y: 0,
      width: 160,
      height: 48,
      name: 'Primary CTA',
      parentId: ctaId,
      fill: '#111111'
    })
    sid = await callTool(sid, 20, 'add_design_rect', {
      x: 0,
      y: 0,
      width: 160,
      height: 48,
      name: 'Secondary CTA',
      parentId: ctaId,
      fill: '#EEEEEE'
    })
    sid = await callTool(sid, 21, 'add_design_text', {
      x: 24,
      y: 14,
      text: 'Start building',
      parentId: ctaId,
      fontSize: 16,
      fill: '#FFFFFF'
    })
  }

  // Feature strip artboard
  sid = await callTool(sid, 30, 'create_artboard', {
    x: 80,
    y: 1040,
    width: 1280,
    height: 420,
    name: 'Landing — Features',
    autoLayout: true
  })

  const listed3 = await rpc(sid, 31, 'tools/call', { name: 'list_design', arguments: {} })
  sid = listed3.sessionId
  const nodes3 = JSON.parse(listed3.result.content.find((c) => c.type === 'text').text)
  const features = nodes3.nodes?.find((n) => n.name === 'Landing — Features')
  const featuresId = features?.id

  if (featuresId) {
    sid = await callTool(sid, 32, 'set_layout', {
      id: featuresId,
      mode: 'horizontal',
      gap: 24,
      padding: 48,
      alignItems: 'stretch'
    })
    for (const [i, title] of ['Live browsers', 'Auto layout', 'Agent MCP'].entries()) {
      sid = await callTool(sid, 40 + i, 'add_design_frame', {
        x: 0,
        y: 0,
        width: 360,
        height: 300,
        name: `Feature ${i + 1}`,
        parentId: featuresId
      })
    }
    const listed4 = await rpc(sid, 50, 'tools/call', { name: 'list_design', arguments: {} })
    sid = listed4.sessionId
    const nodes4 = JSON.parse(listed4.result.content.find((c) => c.type === 'text').text)
    const cards = (nodes4.nodes || []).filter((n) => String(n.name || '').startsWith('Feature '))
    const blurbs = [
      'Real Chromium pages on an infinite canvas — not screenshots.',
      'Frames that reflow like Figma / Paper flex containers.',
      'Cursor & Claude Code drive the canvas over local MCP.'
    ]
    let toolId = 60
    for (const [i, card] of cards.entries()) {
      sid = await callTool(sid, toolId++, 'set_layout', {
        id: card.id,
        mode: 'vertical',
        gap: 12,
        padding: 24,
        alignItems: 'start'
      })
      sid = await callTool(sid, toolId++, 'update_design', {
        id: card.id,
        patch: { fill: '#F7F7F7', radius: 16 }
      })
      sid = await callTool(sid, toolId++, 'add_design_text', {
        x: 0,
        y: 0,
        text: ['Live browsers', 'Auto layout', 'Agent MCP'][i],
        parentId: card.id,
        fontSize: 28,
        fill: '#111111'
      })
      sid = await callTool(sid, toolId++, 'add_design_text', {
        x: 0,
        y: 0,
        text: blurbs[i],
        parentId: card.id,
        fontSize: 16,
        fill: '#555555'
      })
    }
  }

  sid = await callTool(sid, 99, 'finish_working_on_nodes', {})
  console.log('\nDone. Check Vanta — landing frames should be on the canvas.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
