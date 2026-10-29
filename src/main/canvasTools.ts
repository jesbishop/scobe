import { inspectCanvas } from './canvasInspection'
import { randomUUID } from 'node:crypto'
import type { AutoLayout, DesignNode } from '../shared/types'
import { DEFAULT_PAGE } from '../shared/types'
import { importSnapshot } from '../shared/snapshot'
import { chromeHost } from './chrome'
import { addDesign, deleteDesign, getDesign, setDesign, updateDesign } from './designStore'
import {
  defaultFrameLayout,
  duplicateSelection,
  findContainingParent,
  resolveWorldRect,
  toRelative
} from '../shared/layoutEngine'
import { normalizeUrl } from '../shared/url'
import { finishWorking, stageCreate, emitBuild } from './buildBus'
import { DESIGN_GUIDE } from '../shared/designGuide'
import { DEFAULT_TOKENS } from '../shared/designTokens'
import { prepareSvg, recolorSvg, svgIntrinsicSize } from '../shared/svgMarkup'
import { fetchSvg, iconSvg, searchIconify, searchLucide } from './icons'

export type BrowserGeometry = {
  x: number
  y: number
  width: number
  height: number
  title?: string
}

export type CanvasToolContext = {
  openBrowser: (url: string) => Promise<string>
  resolveBrowserGeometry?: (browserId: string) => BrowserGeometry | null
  /** Map window id / tab id → chrome page id (tab id). */
  resolveChromeTabId?: (browserId: string) => string | null
  listBrowsers?: () => unknown
  /** Render a design layer to PNG in the canvas window (agents review their own work). */
  renderNode?: (id: string | undefined, maxEdge?: number) => Promise<RenderedNode>
  /** Tokens from the Tokens panel. */
  getTokens?: () => Promise<{ tokens: Array<{ name: string; kind: string; value: string }> }>
}

export type RenderedNode = { id: string; name: string; base64: string; width: number; height: number; scale: number }

/** What the file already uses most, so new work matches it: colors, fonts, sizes, radii, spacing. */
function fileStyleSummary(nodes: DesignNode[]) {
  const tally = (values: Array<string | number | undefined | null>, top = 8) => {
    const counts = new Map<string, number>()
    for (const value of values) {
      if (value == null || value === '' || value === 0) continue
      const key = String(value).toLowerCase()
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([value, uses]) => ({ value, uses }))
  }
  const texts = nodes.filter((node) => node.type === 'text')
  const shapes = nodes.filter((node) => node.type !== 'text' && node.type !== 'comment' && node.type !== 'image')
  const pad = (node: DesignNode) => {
    const p = node.layout?.padding
    return typeof p === 'number' ? p : p ? Math.max(p.t, p.r, p.b, p.l) : undefined
  }
  return {
    textColors: tally(texts.map((node) => node.fill)),
    surfaceColors: tally(shapes.map((node) => node.fill)),
    strokeColors: tally(shapes.filter((node) => (node.strokeWidth || 0) > 0).map((node) => node.stroke)),
    fontFamilies: tally(texts.map((node) => node.fontFamily || 'Inter'), 4),
    fontSizes: tally(texts.map((node) => node.fontSize), 10),
    fontWeights: tally(texts.map((node) => node.fontWeight), 5),
    radii: tally(shapes.map((node) => node.radius), 6),
    gaps: tally(nodes.map((node) => (typeof node.layout?.gap === 'number' ? node.layout.gap : undefined)), 8),
    paddings: tally(nodes.map(pad), 8)
  }
}

export type CanvasToolResult = { content: string; image?: string; createdIds?: string[]; reviewedId?: string }

function placeNode(node: DesignNode, parentId?: string | null): DesignNode {
  const nodes = getDesign()
  const withPage = { ...node, pageId: node.pageId || DEFAULT_PAGE.id }
  if (parentId) {
    const parent = nodes.find((item) => item.id === parentId)
    if (!parent) throw new Error(`Parent ${parentId} not found`)
    const parentWorld = resolveWorldRect(parent, nodes)
    const rel = toRelative({ x: withPage.x, y: withPage.y }, parentWorld)
    return {
      ...withPage,
      parentId,
      x: rel.x,
      y: rel.y,
      pageId: parent.pageId || withPage.pageId
    }
  }
  const width = Math.max(1, withPage.width || 1)
  const height = Math.max(1, withPage.height || 1)
  const center = { x: withPage.x + width / 2, y: withPage.y + height / 2 }
  const parent = findContainingParent(center, nodes, new Set([withPage.id]))
  if (!parent) return { ...withPage, parentId: undefined }
  const parentWorld = resolveWorldRect(parent, nodes)
  const rel = toRelative({ x: withPage.x, y: withPage.y }, parentWorld)
  return {
    ...withPage,
    parentId: parent.id,
    x: rel.x,
    y: rel.y,
    pageId: parent.pageId || withPage.pageId
  }
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** Vector layers are image nodes carrying live SVG, the same thing Snapshot and Create SVG make. */
function addVector(
  svg: string,
  box: { x: number; y: number; width: number; height: number },
  name: string,
  parentId?: string
): DesignNode {
  const node = placeNode(
    {
      id: randomUUID(),
      type: 'image',
      x: box.x,
      y: box.y,
      width: Math.max(1, box.width),
      height: Math.max(1, box.height),
      name,
      svgMarkup: svg,
      imageDataUrl: svgDataUrl(svg)
    },
    parentId
  )
  addDesign(node)
  return node
}

function vectorScope(): string {
  return `sv${randomUUID().slice(0, 8)}`
}

function compactNode(node: DesignNode) {
  const { svgMarkup: _svg, imageDataUrl: _img, ...rest } = node
  return rest
}

function parseLayout(input: Record<string, unknown> | undefined): AutoLayout | undefined {
  if (!input) return undefined
  const mode = String(input.mode || 'none')
  if (mode !== 'none' && mode !== 'horizontal' && mode !== 'vertical') return undefined
  const gapRaw = input.gap
  const gap =
    gapRaw === 'auto' || gapRaw === 'Auto'
      ? ('auto' as const)
      : gapRaw != null
        ? Number(gapRaw)
        : undefined
  return {
    mode,
    gap: gap != null && (gap === 'auto' || Number.isFinite(gap)) ? gap : undefined,
    counterGap: input.counterGap != null ? Number(input.counterGap) : undefined,
    padding: input.padding != null ? Number(input.padding) : undefined,
    alignItems: input.alignItems as AutoLayout['alignItems'],
    justifyContent: input.justifyContent as AutoLayout['justifyContent'],
    wrap: input.wrap != null ? Boolean(input.wrap) : undefined,
    sizingH: input.sizingH as AutoLayout['sizingH'],
    sizingV: input.sizingV as AutoLayout['sizingV']
  }
}

export async function runCanvasTool(
  name: string,
  input: Record<string, unknown>,
  ctx: CanvasToolContext,
  opts?: { animate?: boolean }
): Promise<CanvasToolResult> {
  const animate = opts?.animate !== false
  const stage = async (ids: string[], result: CanvasToolResult): Promise<CanvasToolResult> => {
    if (animate && ids.length) {
      const nodes = getDesign()
      const hosts = new Set<string>()
      for (const id of ids) {
        let current = nodes.find((node) => node.id === id)
        if (!current) continue
        // Walk to the root; only top-level frames/sections get working chrome
        let guard = 0
        while (current?.parentId && guard++ < 12) {
          current = nodes.find((node) => node.id === current!.parentId)
        }
        if (current && (current.type === 'frame' || current.type === 'section') && !current.parentId) {
          hosts.add(current.id)
        }
      }
      await stageCreate(ids, [...hosts])
    }
    return { ...result, createdIds: ids }
  }

  if (['get_basic_info', 'list_design', 'get_tree_summary'].includes(name)) {
    const nodes = getDesign()
    return { content: inspectCanvas(nodes, name, input, node => resolveWorldRect(node, nodes)) }
  }

  if (name === 'get_node_info') {
    const id = String(input.id || '')
    const nodes = getDesign()
    const node = nodes.find((item) => item.id === id)
    if (!node) throw new Error('Node not found')
    return {
      content: JSON.stringify(
        {
          ...node,
          imageDataUrl: node.imageDataUrl ? `[data-url ${node.imageDataUrl.length} chars]` : undefined,
          world: resolveWorldRect(node, nodes),
          children: nodes.filter((item) => item.parentId === id).map((item) => item.id)
        },
        null,
        2
      )
    }
  }

  if (name === 'get_screenshot') {
    const id = String(input.id || input.browserId || '')
    const shot = await chromeHost.screenshot(id, { skipIdle: true })
    const image = shot.dataUrl.replace(/^data:image\/png;base64,/, '')
    return {
      content: `Screenshot ${shot.width}x${shot.height}`,
      image
    }
  }

  if (name === 'list_browsers') {
    return { content: JSON.stringify(ctx.listBrowsers?.() ?? chromeHost.list(), null, 2) }
  }

  if (name === 'get_design_guide') {
    return { content: DESIGN_GUIDE }
  }

  if (name === 'render_node') {
    if (!ctx.renderNode) throw new Error('Rendering design layers needs the Scobe canvas window open.')
    const id = input.id ? String(input.id) : undefined
    const maxEdge = input.maxEdge != null ? Number(input.maxEdge) : undefined
    const shot = await ctx.renderNode(id, maxEdge)
    return {
      content:
        `Rendered “${shot.name}” (${shot.id}), ${shot.width}×${shot.height} at ${shot.scale}x. ` +
        'Review it against the design guide checklist: focal point, alignment, spacing rhythm, type sizes, contrast, accent use. Fix what fails, then render again.',
      image: shot.base64,
      reviewedId: shot.id
    }
  }

  if (name === 'get_tokens') {
    const panel = ctx.getTokens ? await ctx.getTokens().catch(() => ({ tokens: [] })) : { tokens: [] }
    return {
      content: JSON.stringify(
        {
          tokens: panel.tokens,
          usedInFile: fileStyleSummary(getDesign()),
          defaultsWhenEmpty: DEFAULT_TOKENS,
          note:
            'Reuse tokens first, then what the file already uses most. If both are empty, use defaultsWhenEmpty and the design guide scales.'
        },
        null,
        2
      )
    }
  }

  if (name === 'add_design_frame' || name === 'create_artboard') {
    if (name === 'create_artboard') {
      emitBuild({ type: 'ui:set-page', pageId: DEFAULT_PAGE.id })
    }
    const layout = parseLayout(input.layout as Record<string, unknown> | undefined)
    const node = placeNode(
      {
        id: randomUUID(),
        type: 'frame',
        x: Number(input.x) || 0,
        y: Number(input.y) || 0,
        width: Math.max(8, Number(input.width) || 320),
        height: Math.max(8, Number(input.height) || 200),
        name: String(input.name || 'Frame'),
        fill: String(input.fill || '#FFFFFF'),
        clipsContent: true,
        pageId: DEFAULT_PAGE.id,
        layout: layout ?? (input.autoLayout ? defaultFrameLayout() : { mode: 'none' })
      },
      input.parentId != null ? String(input.parentId) : undefined
    )
    addDesign(node)
    return stage([node.id], { content: JSON.stringify(node) })
  }

  if (name === 'add_design_rect' || name === 'add_design_ellipse') {
    const node = placeNode(
      {
        id: randomUUID(),
        type: name === 'add_design_rect' ? 'rect' : 'ellipse',
        x: Number(input.x) || 0,
        y: Number(input.y) || 0,
        width: Math.max(8, Number(input.width) || 120),
        height: Math.max(8, Number(input.height) || 80),
        name: String(input.name || (name === 'add_design_rect' ? 'Rectangle' : 'Ellipse')),
        fill: String(input.fill || '#DDDDDD')
      },
      input.parentId != null ? String(input.parentId) : undefined
    )
    addDesign(node)
    return stage([node.id], { content: JSON.stringify(node) })
  }

  if (name === 'add_design_text' || name === 'set_text_content') {
    if (name === 'set_text_content' && input.id) {
      const id = String(input.id)
      updateDesign(id, { text: String(input.text || ''), name: String(input.text || 'Text') })
      return { content: JSON.stringify(getDesign().find((node) => node.id === id) || null) }
    }
    const text = String(input.text || '')
    const fontSize = Math.max(8, Number(input.fontSize) || 14)
    const node = placeNode(
      {
        id: randomUUID(),
        type: 'text',
        x: Number(input.x) || 0,
        y: Number(input.y) || 0,
        width: Math.max(40, text.length * fontSize * 0.55),
        height: Math.round(fontSize * 1.2),
        text,
        name: text || 'Text',
        fill: String(input.fill || '#000000'),
        fontFamily: 'Inter',
        fontSize,
        fontWeight: 400
      },
      input.parentId != null ? String(input.parentId) : undefined
    )
    addDesign(node)
    return stage([node.id], { content: JSON.stringify(node) })
  }

  if (name === 'add_icon') {
    const size = Math.max(8, Number(input.size) || 24)
    const color = String(input.color || '#0a0a0a')
    const strokeWidth = Math.min(4, Math.max(0.5, Number(input.strokeWidth) || 2))
    const icon = await iconSvg(String(input.name || input.icon || ''), { color, strokeWidth })
    const svg = prepareSvg(icon.svg, vectorScope())
    const node = addVector(
      svg,
      { x: Number(input.x) || 0, y: Number(input.y) || 0, width: size, height: size },
      String(input.layerName || `${icon.id} icon`),
      input.parentId != null ? String(input.parentId) : undefined
    )
    return stage([node.id], { content: JSON.stringify({ ...compactNode(node), icon: icon.id, source: icon.source, color }) })
  }

  if (name === 'add_svg') {
    const url = input.url ? String(input.url) : ''
    const raw = input.svg ? String(input.svg) : url ? await fetchSvg(url) : ''
    if (!raw.trim()) throw new Error('Pass svg markup or a url to an .svg file')
    const color = input.color ? String(input.color) : undefined
    const svg = prepareSvg(raw, vectorScope(), { color })
    const intrinsic = svgIntrinsicSize(svg) || { width: 120, height: 120 }
    const aspect = intrinsic.width / intrinsic.height
    let width = Number(input.width) || 0
    let height = Number(input.height) || 0
    if (width && !height) height = width / aspect
    else if (height && !width) width = height * aspect
    else if (!width && !height) {
      const scale = Math.min(1, 800 / Math.max(intrinsic.width, intrinsic.height))
      width = intrinsic.width * scale
      height = intrinsic.height * scale
    }
    const fallbackName = url ? decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || 'SVG').replace(/\.svg$/i, '') : 'SVG'
    const node = addVector(
      svg,
      { x: Number(input.x) || 0, y: Number(input.y) || 0, width: Math.round(width), height: Math.round(height) },
      String(input.name || fallbackName),
      input.parentId != null ? String(input.parentId) : undefined
    )
    return stage([node.id], { content: JSON.stringify(compactNode(node)) })
  }

  if (name === 'search_icons') {
    const query = String(input.query || '').trim()
    if (!query) throw new Error('Pass a query, e.g. "settings" or "arrow right"')
    const limit = Math.min(64, Math.max(1, Number(input.limit) || 24))
    const lucideHits = searchLucide(query, limit)
    let iconifyHits: string[] = []
    let iconifyError: string | undefined
    if (input.library !== 'lucide') {
      try {
        iconifyHits = await searchIconify(query, limit)
      } catch (error) {
        iconifyError = error instanceof Error ? error.message : String(error)
      }
    }
    return {
      content: JSON.stringify({
        lucide: lucideHits,
        iconify: iconifyHits,
        ...(iconifyError ? { iconifyError } : {}),
        note: 'Pass a Lucide name ("settings") or an Iconify id ("mdi:cog") to add_icon. Prefer Lucide so a screen keeps one icon style.'
      })
    }
  }

  if (name === 'set_svg_color') {
    const id = String(input.id || '')
    const node = getDesign().find((item) => item.id === id)
    if (!node) throw new Error('Node not found')
    if (!node.svgMarkup?.trim()) throw new Error('That layer is not a vector (no SVG markup)')
    const color = String(input.color || '')
    if (!color) throw new Error('Pass a color, e.g. #2563eb')
    const svg = recolorSvg(node.svgMarkup, color)
    updateDesign(id, { svgMarkup: svg, imageDataUrl: svgDataUrl(svg) })
    const next = getDesign().find((item) => item.id === id)
    return { content: JSON.stringify(next ? compactNode(next) : null) }
  }

  if (name === 'add_design_comment') {
    const node: DesignNode = {
      id: randomUUID(),
      type: 'comment',
      x: Number(input.x) || 0,
      y: Number(input.y) || 0,
      text: String(input.text || ''),
      messages: [{ id: randomUUID(), authorId: 'agent', text: String(input.text || ''), createdAt: Date.now() }],
      unread: true
    }
    addDesign(node)
    return stage([node.id], { content: JSON.stringify(node) })
  }

  if (name === 'update_design' || name === 'update_styles') {
    const id = String(input.id || '')
    const patch = ((input.patch || input.styles || input) as Partial<DesignNode>)
    const { id: _id, patch: _p, styles: _s, ...rest } = patch as Record<string, unknown>
    updateDesign(id, (input.patch || input.styles || rest) as Partial<DesignNode>)
    return { content: JSON.stringify(getDesign().find((node) => node.id === id) || null) }
  }

  if (name === 'delete_design' || name === 'delete_nodes') {
    const ids = Array.isArray(input.ids)
      ? input.ids.map(String)
      : input.id != null
        ? [String(input.id)]
        : []
    deleteDesign(ids, Boolean(input.keepChildren))
    finishWorking(ids)
    return { content: JSON.stringify({ deleted: ids }) }
  }

  if (name === 'set_parent' || name === 'move_nodes') {
    const id = String(input.id || '')
    const nodes = getDesign()
    const node = nodes.find((item) => item.id === id)
    if (!node) throw new Error('Node not found')
    const world = resolveWorldRect(node, nodes)
    if (input.x != null || input.y != null) {
      const nextX = input.x != null ? Number(input.x) : world.x
      const nextY = input.y != null ? Number(input.y) : world.y
      if (input.parentId === undefined) {
        if (!node.parentId || input.relative) {
          updateDesign(id, { x: nextX, y: nextY })
        } else {
          const parent = nodes.find((item) => item.id === node.parentId)
          if (!parent) updateDesign(id, { x: nextX, y: nextY })
          else {
            const parentWorld = resolveWorldRect(parent, nodes)
            const rel = toRelative({ x: nextX, y: nextY }, parentWorld)
            updateDesign(id, { x: rel.x, y: rel.y })
          }
        }
        return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
      }
    }
    const parentId = input.parentId == null || input.parentId === '' ? null : String(input.parentId)
    if (!parentId) {
      updateDesign(id, { parentId: null, x: world.x, y: world.y })
    } else {
      const parent = nodes.find((item) => item.id === parentId)
      if (!parent) throw new Error('Parent not found')
      const parentWorld = resolveWorldRect(parent, nodes)
      const rel = toRelative({ x: world.x, y: world.y }, parentWorld)
      updateDesign(id, { parentId, x: rel.x, y: rel.y })
    }
    return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
  }

  if (name === 'set_layout') {
    const id = String(input.id || '')
    const layout: AutoLayout = {
      ...(parseLayout(input) || defaultFrameLayout()),
      mode: String(input.mode || 'none') as AutoLayout['mode']
    }
    updateDesign(id, { layout, clipsContent: true })
    return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
  }

  if (name === 'move_design') {
    const id = String(input.id || '')
    const nodes = getDesign()
    const node = nodes.find((item) => item.id === id)
    if (!node) throw new Error('Node not found')
    if (input.relative || !node.parentId) {
      updateDesign(id, { x: Number(input.x) || 0, y: Number(input.y) || 0 })
    } else {
      const parent = nodes.find((item) => item.id === node.parentId)
      if (!parent) {
        updateDesign(id, { x: Number(input.x) || 0, y: Number(input.y) || 0 })
      } else {
        const parentWorld = resolveWorldRect(parent, nodes)
        const rel = toRelative({ x: Number(input.x) || 0, y: Number(input.y) || 0 }, parentWorld)
        updateDesign(id, { x: rel.x, y: rel.y })
      }
    }
    return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
  }

  if (name === 'resize_design') {
    const id = String(input.id || '')
    updateDesign(id, {
      width: Math.max(1, Number(input.width) || 1),
      height: Math.max(1, Number(input.height) || 1)
    })
    return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
  }

  if (name === 'rename_nodes') {
    const id = String(input.id || '')
    updateDesign(id, { name: String(input.name || '') })
    return { content: JSON.stringify(getDesign().find((item) => item.id === id) || null) }
  }

  if (name === 'duplicate_nodes') {
    const id = String(input.id || '')
    const nodes = getDesign()
    const source = nodes.find((item) => item.id === id)
    if (!source) throw new Error('Node not found')
    const result = duplicateSelection(nodes, [id])
    if (!result) throw new Error('Duplicate failed')
    setDesign(result.nodes)
    const copy = result.nodes.find((item) => item.id === result.newIds[0])
    return stage(result.newIds, { content: JSON.stringify(copy || null) })
  }

  if (name === 'snapshot_browser_to_frame' || name === 'snapshot_to_canvas') {
    const rawId = String(input.browserId || input.id || '')
    const tabId = ctx.resolveChromeTabId?.(rawId) || rawId
    if (!tabId) throw new Error('Browser is not available')
    const geom = ctx.resolveBrowserGeometry?.(rawId) || ctx.resolveBrowserGeometry?.(tabId)
    const selectorInput = input.selector
    const selectors =
      typeof selectorInput === 'string'
        ? [selectorInput]
        : Array.isArray(selectorInput)
          ? selectorInput.map(String)
          : undefined
    const captured = await chromeHost.captureSnapshot(tabId, {
      selector: selectors,
      x: input.pointX != null ? Number(input.pointX) : undefined,
      y: input.pointY != null ? Number(input.pointY) : undefined
    })
    const placeX =
      input.x != null
        ? Number(input.x)
        : (geom?.x ?? 0) + (geom?.width ?? (captured.tree.width || 320)) + 48
    const placeY = input.y != null ? Number(input.y) : geom?.y ?? 0
    if (input.name && typeof input.name === 'string' && input.name.trim()) {
      captured.tree.name = input.name.trim().slice(0, 64)
    }
    const imported = importSnapshot(
      captured.tree,
      { x: placeX, y: placeY, pageId: DEFAULT_PAGE.id },
      () => randomUUID()
    )
    if (!imported.nodes.length || !imported.rootId) {
      throw new Error('Snapshot had nothing to paste onto the canvas')
    }
    setDesign([...getDesign(), ...imported.nodes])
    emitBuild({ type: 'ui:set-page', pageId: DEFAULT_PAGE.id })
    return stage(imported.nodes.map((node) => node.id), {
      content: JSON.stringify({
        rootId: imported.rootId,
        nodeCount: imported.nodes.length,
        selector: captured.selector || null,
        name: captured.tree.name,
        x: placeX,
        y: placeY
      })
    })
  }

  if (name === 'finish_working_on_nodes') {
    const ids = Array.isArray(input.ids) ? input.ids.map(String) : undefined
    finishWorking(ids)
    return { content: JSON.stringify({ cleared: ids || 'all' }) }
  }

  if (name === 'open_coding_agent') {
    const agentId = String(input.agentId || 'cursor')
    const projectName = String(input.projectName || 'Scobe')
    emitBuild({ type: 'ui:open-coding-agent', agentId, projectName })
    return { content: JSON.stringify({ opened: agentId, projectName }) }
  }

  if (name === 'open_browser') {
    const id = await ctx.openBrowser(normalizeUrl(String(input.url || '')))
    return { content: `Opened browser ${id}` }
  }

  const browserId = String(input.browserId || '')
  if (name === 'navigate') {
    await chromeHost.navigate(browserId, String(input.url || ''))
    return { content: 'Navigated' }
  }
  if (name === 'screenshot') {
    const shot = await chromeHost.screenshot(browserId, { skipIdle: true })
    const image = shot.dataUrl.replace(/^data:image\/png;base64,/, '')
    return {
      content: `Screenshot ${shot.width}x${shot.height}. Click using these pixel coordinates.`,
      image
    }
  }
  if (name === 'click') {
    await chromeHost.click(browserId, Number(input.x), Number(input.y))
    return { content: 'Clicked' }
  }
  if (name === 'type_text') {
    await chromeHost.typeText(browserId, String(input.text || ''))
    return { content: 'Typed' }
  }
  if (name === 'scroll') {
    await chromeHost.scroll(browserId, Number(input.deltaY))
    return { content: 'Scrolled' }
  }
  if (name === 'press_key') {
    await chromeHost.pressKey(browserId, String(input.key || ''))
    return { content: `Pressed ${input.key}` }
  }

  throw new Error(`Unknown tool ${name}`)
}
