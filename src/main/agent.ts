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
    name: 'screenshot',
    description: 'Capture the visible page of a canvas browser. Click coordinates should use this image.',
    input_schema: {
      type: 'object',
      properties: { browserId: { type: 'string' } },
      required: ['browserId']
    }
  },
  {
    name: 'click',
    description: 'Click inside a canvas browser using screenshot pixel coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' }
      },
      required: ['browserId', 'x', 'y']
    }
  },
  {
    name: 'type_text',
    description: 'Type into the focused field of a canvas browser.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        text: { type: 'string' }
      },
      required: ['browserId', 'text']
    }
  },
  {
    name: 'scroll',
    description: 'Scroll a canvas browser. Positive deltaY scrolls down.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        deltaY: { type: 'number' }
      },
      required: ['browserId', 'deltaY']
    }
  },
  {
    name: 'press_key',
    description: 'Press a key in a canvas browser (Enter, Tab, Escape, Backspace, arrows, or a character).',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        key: { type: 'string' }
      },
      required: ['browserId', 'key']
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
    description: 'Screenshot a live browser into a design frame beside it.',
    input_schema: {
      type: 'object',
      properties: {
        browserId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        name: { type: 'string' }
      },
      required: ['browserId']
    }
  },
  {
    name: 'build_sidebar',
    description:
      'Place a left sidebar on the canvas as a nested child of a parent artboard (sidebar fixed width + fill height; main fills remaining space).',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        sidebarWidth: { type: 'number' },
        pageId: { type: 'string' },
        name: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'build_youtube_homepage',
    description:
      'Place a full YouTube homepage on the canvas: nested sidebar, top bar, chips/filters, and video grid with Fill sizing.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        pageId: { type: 'string' }
      }
    }
  },
  {
    name: 'build_youtube_sidebar',
    description: 'Alias of build_youtube_homepage (full YouTube home shell).',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        pageId: { type: 'string' }
      }
    }
  }
]

const SYSTEM = `You operate Vanta, an infinite canvas of real website browsers plus a Paper-like design layer.

Browsers: use screenshot then click/type. Browser click coords are pixels in the latest screenshot.

Design: build UI on the canvas with frames, auto-layout, shapes, and text — like Paper/Figma.
- Prefer nested frames with vertical/horizontal auto-layout over one giant image when generating from scratch.
- Children of a parent use parent-relative x/y when parentId is set.
- list_design returns parentId, layout, and world bounds.
- Use snapshot_browser_to_frame to mirror a live page into a design frame; the live browser stays open.
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
  if (name === 'snapshot_browser_to_frame') return String(data.browserId || '')
  if (name === 'build_sidebar') return 'Canvas sidebar'
  if (name === 'build_youtube_homepage' || name === 'build_youtube_sidebar') return 'YouTube homepage'
  return name
}
