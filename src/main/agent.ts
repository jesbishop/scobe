import { gatewayUrl, cloudToken } from './cloudAi'
import { resolveChatModel } from '../shared/chatModels'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { Tool } from '@anthropic-ai/sdk/resources/messages'
import { app } from 'electron'
import type { AgentEvent } from '../shared/types'
import { runCanvasTool, type CanvasToolContext } from './canvasTools'
import { chatCanvasTools, validateCanvasTool, toolAnnotations } from './canvasToolRegistry'
import { friendlyAgentError, runCanvasAgentLoop } from './canvasAgentLoop'
import { DESIGN_GUIDE } from '../shared/designGuide'
import { AGENT_BUILD_REPLY, CHAT_BUILD_POLICY, needsConnectedAgent } from '../shared/chatBuildPolicy'



function keyFile(): string {
  return join(app.getPath('userData'), 'anthropic.json')
}

function storedKey(): string | null {
  try {
    if (!existsSync(keyFile())) return null
    return (JSON.parse(readFileSync(keyFile(), 'utf8')) as { key?: string }).key?.trim() || null
  } catch {
    return null
  }
}

function resolveKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || storedKey()
}

export function agentStatus(): { configured: boolean } {
  return { configured: Boolean(gatewayUrl() || resolveKey()) }
}

export function setAgentKey(key: string): { configured: boolean } {
  writeFileSync(keyFile(), JSON.stringify({ key: key.trim() }), 'utf8')
  return agentStatus()
}

const TOOLS: Tool[] = [...chatCanvasTools(), {
  name: 'connect_canvas_agent',
  description: 'Stop a large canvas build and show the external-agent connection popup. Use before starting full pages, app screens, or complex builds. Normal chat and quick edits stay in Scobe.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false }
}]
const conversationNotes = new Map<string, string[]>()

const SYSTEM_BASE = `You are Scobe’s helpful conversational AI assistant, powered by Claude. Answer questions, explain ideas, brainstorm, and carry on natural multi-turn conversations. Use the conversation history to understand follow-ups. Only call canvas tools when the user asks for canvas work or when inspecting the canvas is needed to answer their question. Never interpret ordinary conversation as an instruction to modify the canvas. For general questions, answer directly with appropriate detail and readable formatting.

You operate Scobe, an infinite canvas of real website browsers plus a Paper-like design layer.

Browsers: open, list, and navigate URLs. Do not click or type inside pages — there is no computer-use / screenshot click loop.

Design: build UI on the canvas with frames, auto-layout, shapes, and text — like Paper/Figma.
- Prefer nested frames with vertical/horizontal auto-layout over one giant image when generating from scratch.
- Creation tools accept world x/y even with parentId. Stored children use parent-relative coordinates: update_design patches local x/y; move_design uses world x/y unless relative=true.
- list_design returns parentId, layout, and world bounds.
- Use snapshot_browser_to_frame / snapshot_to_canvas to bring a live page region into the canvas via Scobe Snapshot (editable layers). Do not flat-screenshot for “snapshot” requests.
- Icons are vector layers: add_icon with a Lucide name or Iconify id (search_icons finds them). Logos and illustrations: add_svg with markup or an .svg URL. Recolor vectors with set_svg_color, not update_design.
- Design objects sit behind browsers and never replace a live page.
- Do not close, move, or resize browsers unless the user asks.
- The user's message may end with a [Canvas context] block listing the selected layers. "This", "it", and "these" mean those layers. Edit them in place with update_design instead of rebuilding them.
- Start with get_basic_info and get_tokens before designing. Never enumerate the entire file for a new design. Use get_tree_summary for a relevant subtree and get_node_info for individual layers. list_design is paginated; follow nextOffset only when needed. Build big things in passes: container frame first, then sections, then content. Issue independent tool calls together in one response to reduce round trips. Reuse actual returned layer IDs; never invent IDs.
- When you build or restyle a design, finish with render_node on its top-level frame, check the image against the review checklist below, fix what fails, and render again. One review pass at minimum; stop after three.
- Small single-property edits (one color, one size) don't need a render.
- Complete only quick, focused edits here. Never claim completion before visual review. Call finish_working_on_nodes after editing.
- Work quickly and silently; after the last tool call, reply with one or two plain sentences saying what you built or changed.`

const SYSTEM_FIELDS = `update_design accepts any of these layer fields in "patch" (omit what you don't change):
- Geometry: x, y, width, height, rotation (deg), flipX, flipY, aspectLocked, radius, cornerRadii {tl,tr,br,bl}.
- Fill: fill (hex), fillOpacity (0-1), fills [{type:"solid",color,opacity} | {type:"gradient",gradientKind:"linear"|"radial"|"angular"|"diamond",angle,opacity,stops:[{id,position 0-1,color,opacity}]}].
- Stroke: stroke (hex), strokeWidth, strokeAlign "inside"|"center"|"outside", strokeDash, strokeGap, strokeCap "none"|"round"|"square", strokeJoin "miter"|"round"|"bevel".
- Effects: effects [{id,type:"DROP_SHADOW"|"INNER_SHADOW"|"LAYER_BLUR"|"BACKGROUND_BLUR",visible:true,color,opacity 0-1,offsetX,offsetY,radius,spread}].
- Appearance: opacity (0-1), blendMode (e.g. "Multiply"), visible, locked, name.
- Text: text, fontFamily (any Google Font), fontSize, fontWeight (100-900), fontStyle "normal"|"italic", fill (text color), lineHeight (px, 0 = auto), letterSpacing + letterSpacingUnit "percent"|"px", textAlign "left"|"center"|"right"|"justify", textAlignVertical "top"|"middle"|"bottom", textDecoration "none"|"underline"|"line-through", textCase "none"|"upper"|"lower"|"title"|"small-caps", textResize "auto-width"|"auto-height"|"fixed", listStyle "none"|"ordered"|"unordered", paragraphSpacing, maxLines, textTruncation.
- Auto layout on frames: layout {mode:"none"|"horizontal"|"vertical", gap (number or "auto"), padding (number or {t,r,b,l}), alignItems "start"|"center"|"end"|"stretch", justifyContent "start"|"center"|"end"|"space-between", wrap, sizingH/sizingV "fixed"|"hug"}.
- Children of auto layout: layoutSizingH/layoutSizingV "fixed"|"fill", layoutAbsolute.
- Constraints: constraintH "left"|"right"|"left-right"|"center"|"scale", constraintV "top"|"bottom"|"top-bottom"|"center"|"scale". Frames: clipsContent.`

const SYSTEM = `${SYSTEM_BASE}

${SYSTEM_FIELDS}

${DESIGN_GUIDE}

${CHAT_BUILD_POLICY}`

export async function runAgent(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  emit: (event: AgentEvent) => void,
  openBrowser: (url: string) => Promise<string>,
  resolveBrowserGeometry?: CanvasToolContext['resolveBrowserGeometry'],
  canvas?: Pick<CanvasToolContext, 'renderNode' | 'getTokens'>,
  model?: string,
  conversationId?: string
): Promise<void> {
  const handoff = () => {
    emit({ type: 'tool', name: 'connect_canvas_agent', summary: 'Connect your agent for larger canvas builds.' })
    emit({ type: 'text', text: AGENT_BUILD_REPLY })
  }
  const latestRequest = [...messages].reverse().find(message => message.role === 'user')?.text || ''
  if (needsConnectedAgent(latestRequest)) {
    handoff()
    emit({ type: 'done' })
    return
  }
  if (conversationId && messages.length <= 1) conversationNotes.delete(conversationId)
  const cloud = gatewayUrl()
  let apiKey: string | null
  if (cloud) emit({ type: 'tool', name: 'connect_ai', summary: 'Connecting to Scobe AI; the hosted service may take a moment to wake up.' })
  try { apiKey = cloud ? await cloudToken() : resolveKey() } catch (error) { emit({ type: 'error', message: friendlyAgentError(error) }); return }
  if (!apiKey) {
    emit({
      type: 'error',
      message: 'Claude needs an API key. Get one at console.anthropic.com/settings/keys, add ANTHROPIC_API_KEY to the project .env, and restart Scobe.'
    })
    return
  }
  const client = new Anthropic({ apiKey, ...(cloud ? { baseURL: cloud + '/claude', maxRetries: 0, timeout: 300000 } : {}) })
  const ctx: CanvasToolContext = { openBrowser, resolveBrowserGeometry, ...canvas }
  let editCalls = 0
  await runCanvasAgentLoop({
    messages, emit, summarize,
    maxSteps: 12,
    stepLimitMessage: 'This edit needs more work than chat can handle. Your changes are saved. Connect your agent to finish the larger canvas task.',
    stopTool: name => {
      if (name !== 'connect_canvas_agent') return false
      handoff()
      return true
    },
    allowTools: names => {
      editCalls += names.filter(name => !toolAnnotations(name).readOnlyHint && name !== 'finish_working_on_nodes').length
      if (editCalls <= 8) return true
      handoff()
      return false
    },
    remember: notes => {
      if (!conversationId || !notes.length) return
      const previous = conversationNotes.get(conversationId) || []
      conversationNotes.delete(conversationId)
      conversationNotes.set(conversationId, [...previous, ...notes].slice(-30))
      if (conversationNotes.size > 20) conversationNotes.delete(conversationNotes.keys().next().value!)
    },
    request: async (thread, onText) => {
      const stream = client.messages.stream({
        model: resolveChatModel(model), max_tokens: 8000, system: SYSTEM + (conversationId && messages.length > 1 && conversationNotes.has(conversationId) ? '\n\nPrior tool results in this chat (may be stale; verify live layers before editing):\n' + conversationNotes.get(conversationId)!.join('\n') : ''), tools: TOOLS, messages: thread
      }).on('text', onText)
      return stream.finalMessage()
    },
    execute: (name, input) => runCanvasTool(name, validateCanvasTool(name, name === 'render_node' ? { maxEdge: 1024, ...input } : input), ctx)
  })
}

function summarize(name: string, input: unknown): string {
  const data = (input || {}) as Record<string, unknown>
  if (name === 'navigate') return `${data.browserId} → ${data.url}`
  if (name === 'click') return `${data.browserId} @ ${data.x},${data.y}`
  if (name === 'press_key') return `${data.browserId} ${data.key}`
  if (name === 'open_browser') return String(data.url || '')
  if (name === 'add_design_frame') return `${data.name || 'Frame'} ${data.width}×${data.height}`
  if (name === 'add_design_rect' || name === 'add_design_ellipse') return `${data.width}×${data.height}`
  if (name === 'add_design_text') return String(data.text || 'text')
  if (name === 'add_design_comment') return String(data.text || 'comment')
  if (name === 'add_icon') return `${data.name} icon`
  if (name === 'search_icons') return `Looking for “${data.query}” icons`
  if (name === 'add_svg') return String(data.name || data.url || 'SVG')
  if (name === 'set_svg_color') return `${data.id} → ${data.color}`
  if (name === 'update_design' || name === 'delete_design' || name === 'set_parent' || name === 'set_layout') {
    return String(data.id || data.ids || name)
  }
  if (name === 'move_design') return `${data.id} → ${data.x},${data.y}`
  if (name === 'render_node') return 'Looking at the result'
  if (name === 'get_tokens') return 'Reading the file’s colors, type and spacing'
  if (name === 'resize_design') return `${data.id} ${data.width}×${data.height}`
  if (name === 'snapshot_browser_to_frame' || name === 'snapshot_to_canvas') {
    return String(data.browserId || data.selector || '')
  }
  return name
}
