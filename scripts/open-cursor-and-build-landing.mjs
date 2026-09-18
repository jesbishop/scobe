/**
 * Open Cursor in the left sidebar, then build a fresh landing page via Vanta MCP.
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
  if (!line) throw new Error(`No SSE data:\n${raw.slice(0, 400)}`)
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
  console.log(`→ ${name}`, args?.name || args?.text || args?.agentId || '')
  const { sessionId: sid, result } = await rpc(sessionId, id, 'tools/call', { name, arguments: args })
  const text = result?.content?.find((c) => c.type === 'text')?.text
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* plain text */
  }
  return { sid, text, parsed }
}

async function main() {
  // Wait briefly for hot-reload to pick up open_coding_agent
  for (let i = 0; i < 20; i++) {
    try {
      const probe = await request('OPTIONS')
      if (probe.status === 204 || probe.status === 200) break
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  const init = await rpc(undefined, 1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'vanta-landing', version: '1.0.0' }
  })
  let sid = init.sessionId
  await request('POST', { jsonrpc: '2.0', method: 'notifications/initialized' }, sid)

  // Open Cursor in left sidebar
  try {
    ;({ sid } = await callTool(sid, 2, 'open_coding_agent', { agentId: 'cursor', projectName: 'Landing page' }))
  } catch (err) {
    console.warn('open_coding_agent not ready yet (restart Vanta if sidebar stays closed):', err.message)
  }

  const ORIGIN_X = 2200
  const ORIGIN_Y = 80

  let r = await callTool(sid, 10, 'create_artboard', {
    x: ORIGIN_X,
    y: ORIGIN_Y,
    width: 1440,
    height: 960,
    name: 'LP — Hero',
    autoLayout: true
  })
  sid = r.sid
  const heroId = r.parsed?.id
  if (!heroId) throw new Error('No hero id')

  r = await callTool(sid, 11, 'set_layout', {
    id: heroId,
    mode: 'vertical',
    gap: 28,
    padding: 80,
    alignItems: 'start',
    justifyContent: 'center'
  })
  sid = r.sid

  r = await callTool(sid, 12, 'update_design', {
    id: heroId,
    patch: { fill: '#0B0B0C' }
  })
  sid = r.sid

  r = await callTool(sid, 13, 'add_design_text', {
    x: 0,
    y: 0,
    text: 'Ship interfaces while you think',
    parentId: heroId,
    fontSize: 64,
    fill: '#F5F5F4'
  })
  sid = r.sid

  r = await callTool(sid, 14, 'add_design_text', {
    x: 0,
    y: 0,
    text: 'Vanta pairs live browsers with a Paper-like design canvas. Cursor builds on it over MCP.',
    parentId: heroId,
    fontSize: 22,
    fill: '#A8A29E'
  })
  sid = r.sid

  r = await callTool(sid, 15, 'add_design_frame', {
    x: 0,
    y: 0,
    width: 360,
    height: 56,
    name: 'CTA group',
    parentId: heroId
  })
  sid = r.sid
  const ctaId = r.parsed?.id

  if (ctaId) {
    r = await callTool(sid, 16, 'set_layout', {
      id: ctaId,
      mode: 'horizontal',
      gap: 14,
      padding: 0,
      alignItems: 'stretch'
    })
    sid = r.sid
    r = await callTool(sid, 17, 'update_design', { id: ctaId, patch: { fill: 'transparent' } })
    sid = r.sid
    r = await callTool(sid, 18, 'add_design_rect', {
      x: 0,
      y: 0,
      width: 168,
      height: 52,
      name: 'Primary',
      parentId: ctaId,
      fill: '#F5F5F4'
    })
    sid = r.sid
    r = await callTool(sid, 19, 'add_design_rect', {
      x: 0,
      y: 0,
      width: 168,
      height: 52,
      name: 'Ghost',
      parentId: ctaId,
      fill: '#292524'
    })
    sid = r.sid
    r = await callTool(sid, 20, 'add_design_text', {
      x: 0,
      y: 0,
      text: 'Open canvas',
      parentId: ctaId,
      fontSize: 16,
      fill: '#0B0B0C'
    })
    sid = r.sid
  }

  r = await callTool(sid, 30, 'create_artboard', {
    x: ORIGIN_X,
    y: ORIGIN_Y + 1040,
    width: 1440,
    height: 520,
    name: 'LP — Features',
    autoLayout: true
  })
  sid = r.sid
  const featId = r.parsed?.id

  if (featId) {
    r = await callTool(sid, 31, 'set_layout', {
      id: featId,
      mode: 'horizontal',
      gap: 28,
      padding: 56,
      alignItems: 'stretch'
    })
    sid = r.sid
    r = await callTool(sid, 32, 'update_design', { id: featId, patch: { fill: '#FAFAF9' } })
    sid = r.sid

    const cards = [
      ['Live browsers', 'Real Chromium tabs on an infinite canvas — inspect, navigate, measure.'],
      ['Structured frames', 'Auto-layout frames nest like Paper. Agents build UI, not screenshots.'],
      ['Cursor MCP', 'This page was generated from Cursor talking to Vanta over localhost MCP.']
    ]

    let toolId = 40
    const cardIds = []
    for (const [title] of cards) {
      r = await callTool(sid, toolId++, 'add_design_frame', {
        x: 0,
        y: 0,
        width: 400,
        height: 360,
        name: title,
        parentId: featId
      })
      sid = r.sid
      if (r.parsed?.id) cardIds.push({ id: r.parsed.id, title })
    }

    for (let i = 0; i < cardIds.length; i++) {
      const { id, title } = cardIds[i]
      const blurb = cards[i][1]
      r = await callTool(sid, toolId++, 'set_layout', {
        id,
        mode: 'vertical',
        gap: 16,
        padding: 28,
        alignItems: 'start'
      })
      sid = r.sid
      r = await callTool(sid, toolId++, 'update_design', {
        id,
        patch: { fill: '#FFFFFF', radius: 18 }
      })
      sid = r.sid
      r = await callTool(sid, toolId++, 'add_design_text', {
        x: 0,
        y: 0,
        text: title,
        parentId: id,
        fontSize: 28,
        fill: '#0B0B0C'
      })
      sid = r.sid
      r = await callTool(sid, toolId++, 'add_design_text', {
        x: 0,
        y: 0,
        text: blurb,
        parentId: id,
        fontSize: 16,
        fill: '#57534E'
      })
      sid = r.sid
    }
  }

  r = await callTool(sid, 99, 'finish_working_on_nodes', {})
  sid = r.sid
  console.log(`\nDone. Pan to x=${ORIGIN_X} — frames "LP — Hero" and "LP — Features".`)
  console.log('Left sidebar should show Coding agents → Cursor.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
