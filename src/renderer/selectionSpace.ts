import type { AutoLayoutAlign, AutoLayoutJustify, DesignNode } from '../shared/types'
import { childrenOf, isAutoLayout, normalizePadding, resolveWorldRect, type Rect } from '../shared/layoutEngine'
import { selectionRoots } from './alignGuides'

export type GapBand = {
  axis: 'x' | 'y'
  gap: number
  x: number
  y: number
  width: number
  height: number
}

export type SpacingMeasure = {
  bands: GapBand[]
  hGap: number | 'mixed' | null
  vGap: number | 'mixed' | null
  /** When set, applying a gap updates this auto-layout frame instead of freeform positions. */
  autoLayoutId?: string
}

type Item = { node: DesignNode; rect: Rect }

function overlaps(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0)
}

function clusterRows(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
  const rows: Item[][] = []
  for (const item of sorted) {
    const row = rows.find((group) => {
      const top = Math.min(...group.map((entry) => entry.rect.y))
      const bottom = Math.max(...group.map((entry) => entry.rect.y + entry.rect.height))
      const overlap = overlaps(top, bottom, item.rect.y, item.rect.y + item.rect.height)
      return overlap > Math.min(item.rect.height, bottom - top) * 0.35
    })
    if (row) row.push(item)
    else rows.push([item])
  }
  for (const row of rows) row.sort((a, b) => a.rect.x - b.rect.x)
  return rows
}

function clusterCols(items: Item[]): Item[][] {
  const sorted = [...items].sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y)
  const cols: Item[][] = []
  for (const item of sorted) {
    const col = cols.find((group) => {
      const left = Math.min(...group.map((entry) => entry.rect.x))
      const right = Math.max(...group.map((entry) => entry.rect.x + entry.rect.width))
      const overlap = overlaps(left, right, item.rect.x, item.rect.x + item.rect.width)
      return overlap > Math.min(item.rect.width, right - left) * 0.35
    })
    if (col) col.push(item)
    else cols.push([item])
  }
  for (const col of cols) col.sort((a, b) => a.rect.y - b.rect.y)
  return cols
}

function uniform(values: number[]): number | 'mixed' | null {
  if (!values.length) return null
  const first = values[0]
  return values.every((value) => Math.abs(value - first) < 0.6) ? first : 'mixed'
}

function bandBetween(a: Rect, b: Rect, axis: 'x' | 'y', gap: number): GapBand {
  if (axis === 'x') {
    const top = Math.max(a.y, b.y)
    const bottom = Math.min(a.y + a.height, b.y + b.height)
    const y = bottom > top + 1 ? top : Math.min(a.y, b.y)
    const height = bottom > top + 1 ? bottom - top : Math.max(a.height, b.height)
    return { axis, gap, x: a.x + a.width, y, width: Math.max(0, gap), height }
  }
  const left = Math.max(a.x, b.x)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const x = right > left + 1 ? left : Math.min(a.x, b.x)
  const width = right > left + 1 ? right - left : Math.max(a.width, b.width)
  return { axis, gap, x, y: a.y + a.height, width, height: Math.max(0, gap) }
}

function flowKids(nodes: DesignNode[], frameId: string): DesignNode[] {
  return childrenOf(nodes, frameId).filter((node) => !node.layoutAbsolute && node.type !== 'comment')
}

function sharedAutoLayoutParent(nodes: DesignNode[], roots: DesignNode[]): DesignNode | null {
  if (roots.length < 2) return null
  const parentId = roots[0].parentId
  if (!parentId || roots.some((node) => node.parentId !== parentId)) return null
  const parent = nodes.find((node) => node.id === parentId)
  return parent && isAutoLayout(parent) ? parent : null
}

function measureAutoLayoutGaps(nodes: DesignNode[], frame: DesignNode): SpacingMeasure {
  const kids = flowKids(nodes, frame.id)
  if (kids.length < 2) return { bands: [], hGap: null, vGap: null }
  const axis: 'x' | 'y' = frame.layout?.mode === 'vertical' ? 'y' : 'x'
  const layoutGap = typeof frame.layout?.gap === 'number' ? Math.max(0, frame.layout.gap) : 0
  const items = kids
    .map((node) => ({ node, rect: resolveWorldRect(node, nodes) }))
    .sort((a, b) => (axis === 'x' ? a.rect.x - b.rect.x || a.rect.y - b.rect.y : a.rect.y - b.rect.y || a.rect.x - b.rect.x))
  const bands: GapBand[] = []
  const values: number[] = []
  for (let index = 0; index < items.length - 1; index++) {
    const a = items[index].rect
    const b = items[index + 1].rect
    const measured = axis === 'x' ? b.x - (a.x + a.width) : b.y - (a.y + a.height)
    if (measured < -1) continue
    const gap = frame.layout?.gap === 'auto' || frame.layout?.justifyContent === 'space-between' ? measured : layoutGap
    values.push(gap)
    bands.push(bandBetween(a, b, axis, Math.max(0, gap)))
  }
  const uniformGap = uniform(values)
  return {
    bands,
    hGap: axis === 'x' ? uniformGap : null,
    vGap: axis === 'y' ? uniformGap : null,
    autoLayoutId: frame.id
  }
}

/** Measure pink gap bands for a multi-selection or a selected auto-layout frame. */
export function measureSelectionGaps(nodes: DesignNode[], selectedIds: string[]): SpacingMeasure {
  if (selectedIds.length === 1) {
    const frame = nodes.find((node) => node.id === selectedIds[0])
    if (frame && isAutoLayout(frame)) return measureAutoLayoutGaps(nodes, frame)
    return { bands: [], hGap: null, vGap: null }
  }

  const roots = selectionRoots(nodes, selectedIds).filter((node) => node.type !== 'comment')
  if (roots.length < 2) return { bands: [], hGap: null, vGap: null }

  const autoParent = sharedAutoLayoutParent(nodes, roots)
  if (autoParent) {
    const axis: 'x' | 'y' = autoParent.layout?.mode === 'vertical' ? 'y' : 'x'
    const layoutGap = typeof autoParent.layout?.gap === 'number' ? Math.max(0, autoParent.layout.gap) : 0
    const items = roots
      .map((node) => ({ node, rect: resolveWorldRect(node, nodes) }))
      .sort((a, b) => (axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
    const bands: GapBand[] = []
    const values: number[] = []
    for (let index = 0; index < items.length - 1; index++) {
      const a = items[index].rect
      const b = items[index + 1].rect
      const measured = axis === 'x' ? b.x - (a.x + a.width) : b.y - (a.y + a.height)
      if (measured < -1) continue
      const gap =
        autoParent.layout?.gap === 'auto' || autoParent.layout?.justifyContent === 'space-between'
          ? measured
          : layoutGap
      values.push(gap)
      bands.push(bandBetween(a, b, axis, Math.max(0, gap)))
    }
    const uniformGap = uniform(values)
    return {
      bands,
      hGap: axis === 'x' ? uniformGap : null,
      vGap: axis === 'y' ? uniformGap : null,
      autoLayoutId: autoParent.id
    }
  }

  const items = roots.map((node) => ({ node, rect: resolveWorldRect(node, nodes) }))
  const bands: GapBand[] = []
  const hValues: number[] = []
  const vValues: number[] = []

  for (const row of clusterRows(items)) {
    for (let index = 0; index < row.length - 1; index++) {
      const a = row[index].rect
      const b = row[index + 1].rect
      const gap = b.x - (a.x + a.width)
      if (gap < -1) continue
      hValues.push(gap)
      bands.push(bandBetween(a, b, 'x', gap))
    }
  }
  for (const col of clusterCols(items)) {
    for (let index = 0; index < col.length - 1; index++) {
      const a = col[index].rect
      const b = col[index + 1].rect
      const gap = b.y - (a.y + a.height)
      if (gap < -1) continue
      vValues.push(gap)
      bands.push(bandBetween(a, b, 'y', gap))
    }
  }
  return { bands, hGap: uniform(hValues), vGap: uniform(vValues) }
}

function shiftNode(node: DesignNode, dx: number, dy: number, absolute: boolean): DesignNode {
  return {
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    layoutAbsolute: absolute ? true : node.layoutAbsolute,
    points:
      node.parentId || !node.points
        ? node.points
        : node.points.map((point) => ({
            ...point,
            x: point.x + dx,
            y: point.y + dy,
            inX: point.inX != null ? point.inX + dx : undefined,
            inY: point.inY != null ? point.inY + dy : undefined,
            outX: point.outX != null ? point.outX + dx : undefined,
            outY: point.outY != null ? point.outY + dy : undefined
          }))
  }
}

export function applyAutoLayoutGap(nodes: DesignNode[], frameId: string, gap: number): DesignNode[] {
  const nextGap = Math.max(0, gap)
  return nodes.map((node) => {
    if (node.id !== frameId || !node.layout) return node
    return {
      ...node,
      layout: {
        ...node.layout,
        gap: nextGap,
        justifyContent: node.layout.justifyContent === 'space-between' ? 'start' : node.layout.justifyContent
      }
    }
  })
}

/** Set spacing for a multi-selection or auto-layout frame. Returns whether auto-layout reflow is required. */
export function applySelectionGap(
  nodes: DesignNode[],
  selectedIds: string[],
  axis: 'x' | 'y',
  gap: number
): { nodes: DesignNode[]; reflow: boolean } {
  const nextGap = Math.max(0, gap)
  const measured = measureSelectionGaps(nodes, selectedIds)
  if (measured.autoLayoutId) {
    const frame = nodes.find((node) => node.id === measured.autoLayoutId)
    const vertical = frame?.layout?.mode === 'vertical'
    if ((axis === 'y' && vertical) || (axis === 'x' && !vertical) || measured.bands.every((band) => band.axis === axis)) {
      return { nodes: applyAutoLayoutGap(nodes, measured.autoLayoutId, nextGap), reflow: true }
    }
  }

  const roots = selectionRoots(nodes, selectedIds).filter((node) => node.type !== 'comment')
  if (roots.length < 2) return { nodes, reflow: false }
  const items = roots.map((node) => ({ node, rect: resolveWorldRect(node, nodes) }))
  const groups = axis === 'x' ? clusterRows(items) : clusterCols(items)
  const deltas = new Map<string, { dx: number; dy: number }>()

  for (const group of groups) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (axis === 'x' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y))
    let cursor = axis === 'x' ? sorted[0].rect.x : sorted[0].rect.y
    for (const item of sorted) {
      const dx = axis === 'x' ? cursor - item.rect.x : 0
      const dy = axis === 'y' ? cursor - item.rect.y : 0
      deltas.set(item.node.id, { dx, dy })
      cursor += (axis === 'x' ? item.rect.width : item.rect.height) + nextGap
    }
  }

  return {
    nodes: nodes.map((node) => {
      const delta = deltas.get(node.id)
      if (!delta) return node
      const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : null
      const absolute = Boolean(parent && isAutoLayout(parent))
      if (delta.dx === 0 && delta.dy === 0) {
        return absolute && !node.layoutAbsolute ? { ...node, layoutAbsolute: true } : node
      }
      return shiftNode(node, delta.dx, delta.dy, absolute)
    }),
    reflow: false
  }
}

export type PadSide = 't' | 'r' | 'b' | 'l'

export type PadBand = {
  side: PadSide
  value: number
  x: number
  y: number
  width: number
  height: number
  /** Padding on the two perpendicular sides, so the inner-edge line can span the whole frame. */
  lead: number
  trail: number
  /** The frame hugs on this side's axis, so more padding pushes the outer edge out instead of the content in. */
  grows: boolean
}

/** Padding strips for the selected auto-layout frame. The hit target stays on the inner edge so border resize handles stay usable. */
export function measurePaddingBands(nodes: DesignNode[], selectedIds: string[]): PadBand[] {
  if (selectedIds.length !== 1) return []
  const frame = nodes.find((node) => node.id === selectedIds[0])
  if (!frame || !isAutoLayout(frame)) return []
  const box = resolveWorldRect(frame, nodes)
  const pad = normalizePadding(frame.layout?.padding)
  const kids = flowKids(nodes, frame.id)
  const grid = Boolean(frame.layout?.grid)
  const hugH =
    frame.layout?.sizingH === 'hug' &&
    (grid || !kids.some((kid) => kid.layoutSizingH === 'fill' || kid.layoutSizingH === 'relative'))
  const hugV =
    frame.layout?.sizingV === 'hug' &&
    (grid || !kids.some((kid) => kid.layoutSizingV === 'fill' || kid.layoutSizingV === 'relative'))
  const top = box.y + pad.t
  const left = box.x + pad.l
  const right = box.x + box.width - pad.r
  const bottom = box.y + box.height - pad.b
  const innerW = Math.max(1, right - left)
  const innerH = Math.max(1, bottom - top)
  return [
    { side: 't', value: pad.t, x: left, y: box.y, width: innerW, height: Math.max(0, pad.t), lead: pad.l, trail: pad.r, grows: hugV },
    { side: 'r', value: pad.r, x: right, y: top, width: Math.max(0, pad.r), height: innerH, lead: pad.t, trail: pad.b, grows: hugH },
    { side: 'b', value: pad.b, x: left, y: bottom, width: innerW, height: Math.max(0, pad.b), lead: pad.l, trail: pad.r, grows: hugV },
    { side: 'l', value: pad.l, x: box.x, y: top, width: Math.max(0, pad.l), height: innerH, lead: pad.t, trail: pad.b, grows: hugH }
  ]
}

export function applyFramePadding(nodes: DesignNode[], frameId: string, side: PadSide, value: number): DesignNode[] {
  const next = Math.max(0, value)
  return nodes.map((node) => {
    if (node.id !== frameId || !node.layout) return node
    const pad = normalizePadding(node.layout.padding)
    return { ...node, layout: { ...node.layout, padding: { ...pad, [side]: next } } }
  })
}

export type AlignTarget = {
  frameId: string
  x: number
  y: number
  width: number
  height: number
  slackX: number
  slackY: number
  offsetX: number
  offsetY: number
  vertical: boolean
}

/** Content cluster inside a fixed auto-layout frame that still has room to realign. */
export function measureAlignTarget(nodes: DesignNode[], selectedIds: string[]): AlignTarget | null {
  if (selectedIds.length !== 1) return null
  const frame = nodes.find((node) => node.id === selectedIds[0])
  if (!frame || !isAutoLayout(frame)) return null
  const kids = flowKids(nodes, frame.id)
  if (!kids.length) return null
  const box = resolveWorldRect(frame, nodes)
  const pad = normalizePadding(frame.layout?.padding)
  const inner = {
    x: box.x + pad.l,
    y: box.y + pad.t,
    width: Math.max(0, box.width - pad.l - pad.r),
    height: Math.max(0, box.height - pad.t - pad.b)
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const kid of kids) {
    const rect = resolveWorldRect(kid, nodes)
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  const content = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  const slackX = inner.width - content.width
  const slackY = inner.height - content.height
  if (slackX < 8 && slackY < 8) return null
  return {
    frameId: frame.id,
    x: content.x,
    y: content.y,
    width: content.width,
    height: content.height,
    slackX,
    slackY,
    offsetX: content.x - inner.x,
    offsetY: content.y - inner.y,
    vertical: frame.layout?.mode === 'vertical'
  }
}

function alignSlot(offset: number, slack: number, current: 'start' | 'center' | 'end' | 'stretch'): 'start' | 'center' | 'end' | 'stretch' {
  if (slack < 8) return current
  const spots = [
    { id: 'start' as const, at: 0 },
    { id: 'center' as const, at: slack / 2 },
    { id: 'end' as const, at: slack }
  ]
  return spots.reduce((best, spot) => (Math.abs(offset - spot.at) < Math.abs(offset - best.at) ? spot : best)).id
}

export function alignmentForOffset(
  target: AlignTarget,
  offsetX: number,
  offsetY: number,
  current: { justify: AutoLayoutJustify; align: AutoLayoutAlign }
): { justifyContent: AutoLayoutJustify; alignItems: AutoLayoutAlign } {
  const main = alignSlot(target.vertical ? offsetY : offsetX, target.vertical ? target.slackY : target.slackX, current.justify === 'space-between' ? 'start' : current.justify)
  const cross = alignSlot(target.vertical ? offsetX : offsetY, target.vertical ? target.slackX : target.slackY, current.align)
  const justifyContent: AutoLayoutJustify = main === 'stretch' ? 'start' : main
  const alignItems: AutoLayoutAlign = cross
  return { justifyContent, alignItems }
}

export function applyLayoutAlignment(
  nodes: DesignNode[],
  frameId: string,
  justifyContent: AutoLayoutJustify,
  alignItems: AutoLayoutAlign
): DesignNode[] {
  return nodes.map((node) => {
    if (node.id !== frameId || !node.layout) return node
    return {
      ...node,
      layout: {
        ...node.layout,
        justifyContent,
        alignItems,
        gap: justifyContent === 'space-between' ? node.layout.gap : node.layout.gap === 'auto' ? 0 : node.layout.gap
      }
    }
  })
}

