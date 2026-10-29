import * as z from 'zod'

/** Tools that only read the canvas or browsers; agents can treat them as safe to auto-approve. */
const READ_ONLY_TOOLS = new Set([
  'get_basic_info',
  'list_design',
  'get_tree_summary',
  'get_node_info',
  'get_screenshot',
  'list_browsers',
  'get_design_guide',
  'get_tokens',
  'render_node',
  'search_icons',
  'screenshot'
])
/** Tools that reach the internet (Iconify, SVG URLs, live pages). */
const OPEN_WORLD_TOOLS = new Set(['add_icon', 'add_svg', 'search_icons', 'open_browser', 'navigate', 'snapshot_browser_to_frame', 'snapshot_to_canvas'])

export function toolAnnotations(name: string) {
  const readOnly = READ_ONLY_TOOLS.has(name)
  return {
    readOnlyHint: readOnly,
    ...(readOnly ? {} : { destructiveHint: name === 'delete_nodes', idempotentHint: false }),
    openWorldHint: OPEN_WORLD_TOOLS.has(name)
  }
}

export type CanvasToolDefinition = { name: string; description: string; schema: z.ZodRawShape }

export const CANVAS_TOOLS: CanvasToolDefinition[] = []
const layoutSchema = z.object({ mode: z.enum(['none', 'horizontal', 'vertical']), gap: z.union([z.number(), z.literal('auto')]).optional(), padding: z.union([z.number(), z.object({ t: z.number(), r: z.number(), b: z.number(), l: z.number() })]).optional(), alignItems: z.enum(['start','center','end','stretch']).optional(), justifyContent: z.enum(['start','center','end','space-between']).optional(), wrap: z.boolean().optional(), sizingH: z.enum(['fixed','hug']).optional(), sizingV: z.enum(['fixed','hug']).optional() })
function tool(name: string, description: string, schema: z.ZodRawShape): void { CANVAS_TOOLS.push({ name, description, schema }) }
tool('get_basic_info', 'Compact file overview: node count and top-level artboards with sizes. Start here; inspect specific subtrees with get_tree_summary and get_node_info.', { offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() })
tool('list_design', 'Paged design nodes with parentId, layout, and world bounds. Prefer get_basic_info first. Returns nextOffset when more nodes exist.', { id: z.string().optional().describe('Optional subtree root'), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() })
tool(
  'get_tree_summary',
  'Compact hierarchy summary of the canvas or a subtree.',
  {
    id: z.string().optional().describe('Root node id; omit for whole canvas'),
    depth: z.number().int().min(1).max(8).optional().describe('Max depth (default 2)'), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional()
  }
)
tool(
  'get_node_info',
  'Details for a design node by id.',
  { id: z.string().describe('Node id') }
)
tool(
  'get_screenshot',
  'Screenshot a live browser tab by id (base64 PNG).',
  { id: z.string().describe('Browser tab id'), browserId: z.string().optional() }
)
tool('list_browsers', 'List live browsers/tabs on the Scobe canvas.', {})
tool(
  'get_design_guide',
  'The Scobe design guide: process, spacing and type scales, color, components, what to avoid, and the review checklist. Read it before designing.',
  {}
)
tool(
  'get_tokens',
  'Design tokens from the Tokens panel plus the colors, fonts, sizes, radii and spacing the file already uses most. Reuse these so new work matches.',
  {}
)
tool(
  'render_node',
  'Render a design layer (usually the top-level frame you built) to a PNG so you can see it. Use after building, review against the design guide checklist, fix issues, and render again. Omit id to render the newest top-level frame on the current page.',
  {
    id: z.string().optional().describe('Layer id to render; omit for the newest top-level frame'),
    maxEdge: z.number().optional().describe('Longest edge of the image in px (default 1568)')
  }
)
tool(
  'create_artboard',
  'Create a design frame (artboard). Prefer auto-layout for UI builds.',
  {
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
    parentId: z.string().optional(),
    fill: z.string().optional(),
    autoLayout: z.boolean().optional(),
    layout: layoutSchema.optional()
  }
)
tool(
  'add_design_frame',
  'Add a design frame with optional layout and parentId. x/y are world coordinates.',
  {
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
    parentId: z.string().optional(),
    fill: z.string().optional(),
    layout: layoutSchema.optional()
  }
)
tool(
  'add_design_rect',
  'Add a rectangle.',
  {
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
    parentId: z.string().optional(),
    fill: z.string().optional()
  }
)
tool(
  'add_design_ellipse',
  'Add an ellipse.',
  {
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
    parentId: z.string().optional(),
    fill: z.string().optional()
  }
)
tool(
  'add_design_text',
  'Add text on the canvas.',
  {
    x: z.number(),
    y: z.number(),
    text: z.string(),
    parentId: z.string().optional(),
    fontSize: z.number().optional(),
    fill: z.string().optional()
  }
)
tool(
  'add_icon',
  'Add an icon as a vector layer. Any Lucide icon by name ("settings", "arrow-right", "chevron-down"), or any Iconify id ("mdi:home", "tabler:bolt", "ph:house", "simple-icons:github" for brand logos). Use search_icons to find names. Recolor later with set_svg_color.',
  {
    name: z.string().describe('Lucide name or Iconify prefix:name'),
    x: z.number(),
    y: z.number(),
    size: z.number().optional().describe('Width and height in px (default 24; 16-20 next to text)'),
    color: z.string().optional().describe('Hex color (default #0a0a0a); match the text it sits with'),
    strokeWidth: z.number().optional().describe('Lucide stroke width (default 2; 1.5 for a lighter look)'),
    parentId: z.string().optional(),
    layerName: z.string().optional()
  }
)
tool(
  'search_icons',
  'Find icon names for add_icon. Returns Lucide names (preferred, one consistent outline style) and Iconify ids from 150+ other sets.',
  {
    query: z.string().describe('What the icon shows, e.g. "settings", "upload cloud", "credit card"'),
    limit: z.number().optional().describe('Max results per library (default 24)'),
    library: z.enum(['lucide', 'all']).optional().describe('lucide = offline Lucide only; all (default) also searches Iconify')
  }
)
tool(
  'add_svg',
  'Add SVG artwork (logos, illustrations, custom icons, charts) as a vector layer, from markup or from a URL to an .svg file. Size defaults to the drawing\'s own size; pass width or height to scale it proportionally.',
  {
    svg: z.string().optional().describe('Full <svg>…</svg> markup'),
    url: z.string().optional().describe('http(s) URL of an .svg file, used when svg is omitted'),
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional(),
    color: z.string().optional().describe('Recolor every fill and stroke to this hex (single-color art)'),
    name: z.string().optional(),
    parentId: z.string().optional()
  }
)
tool(
  'set_svg_color',
  'Recolor a vector layer (icon, SVG, or a vector from Snapshot): every fill and stroke becomes the given color.',
  { id: z.string(), color: z.string().describe('Hex color, e.g. #2563eb') }
)
tool(
  'set_text_content',
  'Set text on an existing text node, or create text if only x/y/text are given.',
  {
    id: z.string().optional(),
    text: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    parentId: z.string().optional(),
    fontSize: z.number().optional(),
    fill: z.string().optional()
  }
)
tool(
  'update_design',
  'Patch fields on a design node.',
  { id: z.string(), patch: z.record(z.string(), z.unknown()) }
)
tool(
  'update_styles',
  'Update style-like fields on a node (fill, opacity, radius, etc).',
  { id: z.string(), styles: z.record(z.string(), z.unknown()).optional(), fill: z.string().optional() }
)
tool(
  'set_layout',
  'Set auto-layout on a frame.',
  {
    id: z.string(),
    mode: z.enum(['none', 'horizontal', 'vertical']),
    gap: z.number().optional(),
    padding: z.number().optional(),
    alignItems: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    justifyContent: z.enum(['start', 'center', 'end', 'space-between']).optional(),
    wrap: z.boolean().optional()
  }
)
tool(
  'set_parent',
  'Reparent a node under a frame/section (or null).',
  { id: z.string(), parentId: z.string().nullable().optional() }
)
tool(
  'move_design',
  'Move a node. World coords unless relative=true.',
  { id: z.string(), x: z.number(), y: z.number(), relative: z.boolean().optional() }
)
tool(
  'resize_design',
  'Resize a node.',
  { id: z.string(), width: z.number(), height: z.number() }
)
tool(
  'rename_nodes',
  'Rename a layer.',
  { id: z.string(), name: z.string() }
)
tool(
  'duplicate_nodes',
  'Duplicate a node.',
  { id: z.string() }
)
tool(
  'delete_nodes',
  'Delete nodes. keepChildren unparents instead of cascading.',
  { ids: z.array(z.string()).optional(), id: z.string().optional(), keepChildren: z.boolean().optional() }
)
tool(
  'snapshot_browser_to_frame',
  'Bring a live browser region into the canvas using Scobe’s real Snapshot tool (DOM → editable layers, not a flat PNG). Prefer selector for sidebars (e.g. ytd-guide-renderer). Place beside the browser by default.',
  {
    browserId: z.string().describe('Browser window id or tab id from list_browsers'),
    selector: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('CSS selector(s) to snapshot. Defaults to common nav/sidebar landmarks.'),
    pointX: z.number().optional().describe('Optional CSS viewport X to pick an element'),
    pointY: z.number().optional().describe('Optional CSS viewport Y to pick an element'),
    x: z.number().optional().describe('Canvas X for the pasted root'),
    y: z.number().optional().describe('Canvas Y for the pasted root'),
    name: z.string().optional()
  }
)
tool(
  'snapshot_to_canvas',
  'Alias of snapshot_browser_to_frame — use Scobe Snapshot (layered) to paste a browser region onto the design canvas.',
  {
    browserId: z.string(),
    selector: z.union([z.string(), z.array(z.string())]).optional(),
    pointX: z.number().optional(),
    pointY: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    name: z.string().optional()
  }
)
tool(
  'open_browser',
  'Open a live browser on the canvas.',
  { url: z.string() }
)
tool(
  'navigate',
  'Navigate a browser tab.',
  { browserId: z.string(), url: z.string() }
)
tool(
  'screenshot',
  'Screenshot a browser for click coordinates.',
  { browserId: z.string() }
)
tool(
  'finish_working_on_nodes',
  'Clear Paper-like working indicators after a build pass. Call when done building.',
  { ids: z.array(z.string()).optional() }
)
tool(
  'open_coding_agent',
  'Open a coding agent in the Scobe left sidebar (cursor, claude-code, codex, or v0).',
  {
    agentId: z.enum(['cursor', 'claude-code', 'codex', 'v0']).describe('Which agent to open'),
    projectName: z.string().optional()
  }
)
tool('add_design_comment', 'Pin a comment on the design canvas.', { x: z.number(), y: z.number(), text: z.string() })

export function validateCanvasTool(name: string, input: unknown): Record<string, unknown> {
  const definition = CANVAS_TOOLS.find(tool => tool.name === name)
  if (!definition) throw new Error('Unknown canvas tool: ' + name)
  return z.object(definition.schema).parse(input)
}

export function chatCanvasTools() {
  return CANVAS_TOOLS.map(tool => ({ name: tool.name, description: tool.description, input_schema: z.toJSONSchema(z.object(tool.schema), { target: 'draft-7', io: 'input' }) as { type: 'object'; [key: string]: unknown } }))
}
