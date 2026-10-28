import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { app } from 'electron'
import type { AgentEvent } from '../shared/types'
import { runCanvasTool, type CanvasToolContext } from './canvasTools'
import { DESIGN_GUIDE } from '../shared/designGuide'

const MODEL = 'claude-sonnet-4-5'

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
  return { configured: Boolean(resolveKey()) }
}

export function setAgentKey(key: string): { configured: boolean } {
  writeFileSync(keyFile(), JSON.stringify({ key: key.trim() }), 'utf8')
  return agentStatus()
}

const TOOLS: Tool[] = [
  {
    name: 'list_browsers',
    description: 'List browser windows and tabs currently on the Scobe canvas.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'open_browser',
    description: 'Open a new real browser on the canvas.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url']
    }
  },
  {
    name: 'navigate',
    description: 'Navigate a canvas browser to a URL.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        url: { type: 'string' }
      },
      required: ['browserId', 'url']
    }
  },
  {
    name: 'list_design',
    description: 'List design nodes with parentId, layout, and world bounds.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'add_design_frame',
    description: 'Add a design frame. Optional auto-layout and parentId.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
        parentId: { type: 'string' }
      },
      required: ['x', 'y', 'width', 'height']
    }
  },
  {
    name: 'add_design_rect',
    description: 'Add a rectangle on the design canvas.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
        parentId: { type: 'string' },
        fill: { type: 'string' }
      },
      required: ['x', 'y', 'width', 'height']
    }
  },
  {
    name: 'add_design_ellipse',
    description: 'Add an ellipse on the design canvas.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' },
        parentId: { type: 'string' },
        fill: { type: 'string' }
      },
      required: ['x', 'y', 'width', 'height']
    }
  },
  {
    name: 'add_design_text',
    description: 'Add text on the design canvas.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' },
        parentId: { type: 'string' },
        fontSize: { type: 'number' },
        fill: { type: 'string' }
      },
      required: ['x', 'y', 'text']
    }
  },
  {
    name: 'add_design_comment',
    description: 'Pin a comment on the design canvas.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        text: { type: 'string' }
      },
      required: ['x', 'y', 'text']
    }
  },
  {
    name: 'update_design',
    description: 'Patch any fields on a design node.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object' }
      },
      required: ['id', 'patch']
    }
  },
  {
    name: 'delete_design',
    description: 'Delete design nodes by id.',
    input_schema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        keepChildren: { type: 'boolean' }
      },
      required: ['ids']
    }
  },
  {
    name: 'set_parent',
    description: 'Reparent a node under a frame/section.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        parentId: { type: ['string', 'null'] }
      },
      required: ['id']
    }
  },
  {
    name: 'set_layout',
    description: 'Set flex / auto-layout on a frame (direction, gap, align, justify, wrap).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        mode: { type: 'string', enum: ['none', 'horizontal', 'vertical'] },
        gap: { type: 'number' },
        padding: { type: 'number' },
        alignItems: { type: 'string', enum: ['start', 'center', 'end', 'stretch'] },
        justifyContent: { type: 'string', enum: ['start', 'center', 'end', 'space-between'] },
        wrap: { type: 'boolean' }
      },
      required: ['id', 'mode']
    }
  },
  {
    name: 'move_design',
    description: 'Move a design node.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        relative: { type: 'boolean' }
      },
      required: ['id', 'x', 'y']
    }
  },
  {
    name: 'resize_design',
    description: 'Resize a design node.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' }
      },
      required: ['id', 'width', 'height']
    }
  },
  {
    name: 'snapshot_browser_to_frame',
    description:
      'Bring a live browser region into the canvas with Scobe Snapshot (DOM → editable layers, not a flat PNG). Optional CSS selector for sidebars.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        selector: { type: 'string', description: 'CSS selector to snapshot (e.g. ytd-guide-renderer)' },
        pointX: { type: 'number' },
        pointY: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        name: { type: 'string' }
      },
      required: ['browserId']
    }
  },
  {
    name: 'get_tokens',
    description:
      'Design tokens from the Tokens panel plus the colors, fonts, sizes, radii and spacing this file already uses most. Call before designing and reuse them.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'render_node',
    description:
      'Render a design layer (usually the top-level frame you built) to an image so you can see it. Review it against the design guide checklist, fix issues, and render again. Omit id to render the newest top-level frame.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Layer id; omit for the newest top-level frame' },
        maxEdge: { type: 'number', description: 'Longest image edge in px (default 1568)' }
      }
    }
  },
  {
    name: 'snapshot_to_canvas',
    description: 'Alias of snapshot_browser_to_frame — Scobe Snapshot layered paste onto the canvas.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        selector: { type: 'string' },
        pointX: { type: 'number' },
        pointY: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
        name: { type: 'string' }
      },
      required: ['browserId']
    }
  }
]

const SYSTEM_BASE = `You operate Scobe, an infinite canvas of real website browsers plus a Paper-like design layer.

Browsers: open, list, and navigate URLs. Do not click or type inside pages — there is no computer-use / screenshot click loop.

Design: build UI on the canvas with frames, auto-layout, shapes, and text — like Paper/Figma.
- Prefer nested frames with vertical/horizontal auto-layout over one giant image when generating from scratch.
- Children of a parent use parent-relative x/y when parentId is set.
- list_design returns parentId, layout, and world bounds.
- Use snapshot_browser_to_frame / snapshot_to_canvas to bring a live page region into the canvas via Scobe Snapshot (editable layers). Do not flat-screenshot for “snapshot” requests.
- Design objects sit behind browsers and never replace a live page.
- Do not close, move, or resize browsers unless the user asks.
- The user's message may end with a [Canvas context] block listing the selected layers. "This", "it", and "these" mean those layers. Edit them in place with update_design instead of rebuilding them.
- Start with list_design when you need to see what exists, and get_tokens before designing anything new. Build big things in passes: container frame first, then sections, then content.
- When you build or restyle a design, finish with render_node on its top-level frame, check the image against the review checklist below, fix what fails, and render again. One review pass at minimum; stop after three.
- Small single-property edits (one color, one size) don't need a render.
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

${DESIGN_GUIDE}`

export async function runAgent(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  emit: (event: AgentEvent) => void,
  openBrowser: (url: string) => Promise<string>,
  resolveBrowserGeometry?: CanvasToolContext['resolveBrowserGeometry'],
  canvas?: Pick<CanvasToolContext, 'renderNode' | 'getTokens'>
): Promise<void> {
  const apiKey = resolveKey()
  if (!apiKey) {
    emit({
      type: 'error',
      message: 'Claude needs an API key. Get one at console.anthropic.com/settings/keys, add ANTHROPIC_API_KEY to the project .env, and restart Scobe.'
    })
    return
  }
  const client = new Anthropic({ apiKey })
  const thread: MessageParam[] = messages.map((message) => ({
    role: message.role,
    content: message.text
  }))
  const ctx: CanvasToolContext = { openBrowser, resolveBrowserGeometry, ...canvas }

  for (let step = 0; step < 40; step++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools: TOOLS,
      messages: thread
    })
    const toolUses = response.content.filter((block) => block.type === 'tool_use')
    const texts = response.content.filter((block) => block.type === 'text')
    for (const block of texts) emit({ type: 'text', text: block.text })
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      emit({ type: 'done' })
      return
    }
    thread.push({ role: 'assistant', content: response.content })
    const toolResults: ToolResultBlockParam[] = []
    for (const tool of toolUses) {
      if (tool.type !== 'tool_use') continue
      emit({ type: 'tool', name: tool.name, summary: summarize(tool.name, tool.input) })
      try {
        const output = await runCanvasTool(tool.name, tool.input as Record<string, unknown>, ctx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: output.image
            ? [
                { type: 'text', text: output.content },
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: output.image }
                }
              ]
            : output.content
        })
      } catch (error) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error)
        })
      }
    }
    thread.push({ role: 'user', content: toolResults })
  }
  emit({ type: 'done' })
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
