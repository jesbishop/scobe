import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { AgentEvent } from '../shared/types'
import { runCanvasTool, type CanvasToolContext } from './canvasTools'

const TOOLS: Tool[] = [
  {
    name: 'list_browsers',
    description: 'List browser windows and tabs currently on the Vanta canvas.',
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
      'Bring a live browser region into the canvas with Vanta Snapshot (DOM → editable layers, not a flat PNG). Optional CSS selector for sidebars.',
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
    name: 'snapshot_to_canvas',
    description: 'Alias of snapshot_browser_to_frame — Vanta Snapshot layered paste onto the canvas.',
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

const SYSTEM = `You operate Vanta, an infinite canvas of real website browsers plus a Paper-like design layer.

Browsers: open, list, and navigate URLs. Do not click or type inside pages — there is no computer-use / screenshot click loop.

Design: build UI on the canvas with frames, auto-layout, shapes, and text — like Paper/Figma.
- Prefer nested frames with vertical/horizontal auto-layout over one giant image when generating from scratch.
- Children of a parent use parent-relative x/y when parentId is set.
- list_design returns parentId, layout, and world bounds.
- Use snapshot_browser_to_frame / snapshot_to_canvas to bring a live page region into the canvas via Vanta Snapshot (editable layers). Do not flat-screenshot for “snapshot” requests.
- Design objects sit behind browsers and never replace a live page.
- Do not close, move, or resize browsers unless the user asks.`

export async function runAgent(
  messages: Array<{ role: 'user' | 'assistant'; text: string }>,
  emit: (event: AgentEvent) => void,
  openBrowser: (url: string) => Promise<string>,
  resolveBrowserGeometry?: CanvasToolContext['resolveBrowserGeometry']
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    emit({
      type: 'error',
      message: 'Set ANTHROPIC_API_KEY in a .env file next to the project, then restart Vanta.'
    })
    return
  }
  const client = new Anthropic({ apiKey })
  const thread: MessageParam[] = messages.map((message) => ({
    role: message.role,
    content: message.text
  }))
  const ctx: CanvasToolContext = { openBrowser, resolveBrowserGeometry }

  for (let step = 0; step < 16; step++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
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
  if (name === 'resize_design') return `${data.id} ${data.width}×${data.height}`
  if (name === 'snapshot_browser_to_frame' || name === 'snapshot_to_canvas') {
    return String(data.browserId || data.selector || '')
  }
  return name
}
