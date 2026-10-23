import type { DesignNode } from '../shared/types'
import { expandWithDescendants, resolveWorldRect, type Rect } from '../shared/layoutEngine'

export type AlignGuide = {
  x1: number
  y1: number
  x2: number
  y2: number
  dots: Array<{ x: number; y: number }>
}

export type AlignAction = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

const SNAP_PX = 6

type Edge = { pos: number; at: 'start' | 'center' | 'end' }

function xEdges(rect: Rect): Edge[] {
  return [
    { pos: rect.x, at: 'start' },
    { pos: rect.x + rect.width / 2, at: 'center' },
    { pos: rect.x + rect.width, at: 'end' }
  ]
}

function yEdges(rect: Rect): Edge[] {
  return [
    { pos: rect.y, at: 'start' },
    { pos: rect.y + rect.height / 2, at: 'center' },
    { pos: rect.y + rect.height, at: 'end' }
  ]
}

function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

function overlapsY(a: Rect, b: Rect): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y
}

function overlapsX(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
}

function bestShift(moving: Edge[], targets: Edge[], threshold: number): number {
  let best = 0
  let bestAbs = Infinity
  for (const from of moving) {
    for (const to of targets) {
      const delta = to.pos - from.pos
      const abs = Math.abs(delta)
      if (abs <= threshold && abs < bestAbs) {
        bestAbs = abs
        best = delta
      }
    }
  }
  return bestAbs <= threshold ? best : 0
}

function gapShift(
  moving: Rect,
  targets: Rect[],
  axis: 'x' | 'y',
  threshold: number
): number {
  const horizontal = axis === 'x'
  const peers = targets.filter((target) => (horizontal ? overlapsY(moving, target) : overlapsX(moving, target)))
  if (!peers.length) return 0

  const start = (rect: Rect) => (horizontal ? rect.x : rect.y)
  const end = (rect: Rect) => (horizontal ? rect.x + rect.width : rect.y + rect.height)
  const size = horizontal ? moving.width : moving.height
  const origin = start(moving)

  const before = peers
    .filter((rect) => end(rect) <= origin + 0.5)
    .sort((a, b) => end(b) - end(a))
  const after = peers
    .filter((rect) => start(rect) >= end(moving) - 0.5)
    .sort((a, b) => start(a) - start(b))

  let best = 0
  let bestAbs = threshold + 1

  const consider = (delta: number) => {
    const abs = Math.abs(delta)
    if (abs <= threshold && abs < bestAbs) {
      best = delta
      bestAbs = abs
    }
  }

  const left = before[0]
  const right = after[0]
  if (left && right) {
    const span = start(right) - end(left)
    if (span >= size) consider(end(left) + (span - size) / 2 - origin)
  }
  if (left && before[1]) {
    const ref = start(left) - end(before[1])
    if (ref >= 0) consider(end(left) + ref - origin)
  }
  if (right && after[1]) {
    const ref = start(after[1]) - end(right)
    if (ref >= 0) consider(start(right) - ref - size - origin)
  }
  return bestAbs <= threshold ? best : 0
}

/** Merge guides on the same line so one continuous stroke spans every aligned object (Figma). */
function pushGuide(guides: AlignGuide[], guide: AlignGuide) {
  const vertical = Math.abs(guide.x1 - guide.x2) < 0.01
  const existing = guides.find((item) => {
    const itemVertical = Math.abs(item.x1 - item.x2) < 0.01
    if (itemVertical !== vertical) return false
    return vertical ? Math.abs(item.x1 - guide.x1) < 0.5 : Math.abs(item.y1 - guide.y1) < 0.5
  })
  if (!existing) {
    guides.push({ ...guide, dots: [...guide.dots] })
    return
  }
  if (vertical) {
    existing.y1 = Math.min(existing.y1, existing.y2, guide.y1, guide.y2)
    existing.y2 = Math.max(existing.y1, existing.y2, guide.y1, guide.y2)
  } else {
    existing.x1 = Math.min(existing.x1, existing.x2, guide.x1, guide.x2)
    existing.x2 = Math.max(existing.x1, existing.x2, guide.x1, guide.x2)
  }
  for (const dot of guide.dots) {
    if (!existing.dots.some((item) => Math.abs(item.x - dot.x) < 0.5 && Math.abs(item.y - dot.y) < 0.5)) {
      existing.dots.push(dot)
    }
  }
}

/** Points where a rect meets an alignment line: both corners for an edge, the midpoint for the moving centre. */
function linePoints(rect: Rect, at: Edge['at'], axis: 'x' | 'y', moving: boolean): number[] {
  const start = axis === 'x' ? rect.y : rect.x
  const size = axis === 'x' ? rect.height : rect.width
  if (at === 'center' && moving) return [start + size / 2]
  return [start, start + size]
}

function edgeGuides(moving: Rect, targets: Rect[]): AlignGuide[] {
  const guides: AlignGuide[] = []
  const eps = 0.75

  for (const target of targets) {
    for (const from of xEdges(moving)) {
      for (const to of xEdges(target)) {
        if (Math.abs(from.pos - to.pos) > eps) continue
        const x = to.pos
        const ys = [...linePoints(moving, from.at, 'x', true), ...linePoints(target, to.at, 'x', false)]
        pushGuide(guides, {
          x1: x,
          y1: Math.min(...ys),
          x2: x,
          y2: Math.max(...ys),
          dots: ys.map((y) => ({ x, y }))
        })
      }
    }
    for (const from of yEdges(moving)) {
      for (const to of yEdges(target)) {
        if (Math.abs(from.pos - to.pos) > eps) continue
        const y = to.pos
        const xs = [...linePoints(moving, from.at, 'y', true), ...linePoints(target, to.at, 'y', false)]
        pushGuide(guides, {
          x1: Math.min(...xs),
          y1: y,
          x2: Math.max(...xs),
          y2: y,
          dots: xs.map((x) => ({ x, y }))
        })
      }
    }
  }
  return guides
}

function spacingGuides(moving: Rect, targets: Rect[], axis: 'x' | 'y'): AlignGuide[] {
  const guides: AlignGuide[] = []
  const horizontal = axis === 'x'
  const peers = targets.filter((target) => (horizontal ? overlapsY(moving, target) : overlapsX(moving, target)))
  const start = (rect: Rect) => (horizontal ? rect.x : rect.y)
  const end = (rect: Rect) => (horizontal ? rect.x + rect.width : rect.y + rect.height)
  const before = peers.filter((rect) => end(rect) <= start(moving) + 0.5).sort((a, b) => end(b) - end(a))
  const after = peers.filter((rect) => start(rect) >= end(moving) - 0.5).sort((a, b) => start(a) - start(b))
  const left = before[0]
  const right = after[0]
  const eps = 0.75

  const addGap = (a: Rect, b: Rect) => {
    const gapStart = end(a)
    const gapEnd = start(b)
    if (gapEnd - gapStart < 1) return
    if (horizontal) {
      const mid = moving.y + moving.height / 2
      guides.push({
        x1: gapStart,
        y1: mid,
        x2: gapEnd,
        y2: mid,
        dots: [
          { x: gapStart, y: mid },
          { x: gapEnd, y: mid }
        ]
      })
    } else {
      const mid = moving.x + moving.width / 2
      guides.push({
        x1: mid,
        y1: gapStart,
        x2: mid,
        y2: gapEnd,
        dots: [
          { x: mid, y: gapStart },
          { x: mid, y: gapEnd }
        ]
      })
    }
  }

  if (left && right) {
    const gapL = start(moving) - end(left)
    const gapR = start(right) - end(moving)
    if (gapL > 1 && gapR > 1 && Math.abs(gapL - gapR) <= eps) {
      addGap(left, moving)
      addGap(moving, right)
    }
  }
  if (left && before[1]) {
    const ref = start(left) - end(before[1])
    const gap = start(moving) - end(left)
    if (ref > 1 && gap > 1 && Math.abs(ref - gap) <= eps) {
      addGap(before[1], left)
      addGap(left, moving)
    }
  }
  if (right && after[1]) {
    const ref = start(after[1]) - end(right)
    const gap = start(right) - end(moving)
    if (ref > 1 && gap > 1 && Math.abs(ref - gap) <= eps) {
      addGap(moving, right)
      addGap(right, after[1])
    }
  }
  return guides
}

/** Snap a proposed world rect to other objects. Alt/Ctrl should skip this. */
export function snapRect(proposed: Rect, targets: Rect[], zoom: number): { x: number; y: number; guides: AlignGuide[] } {
  const threshold = SNAP_PX / Math.max(0.02, zoom)
  const edgeDx = bestShift(xEdges(proposed), targets.flatMap(xEdges), threshold)
  const edgeDy = bestShift(yEdges(proposed), targets.flatMap(yEdges), threshold)
  const gapDx = gapShift(proposed, targets, 'x', threshold)
  const gapDy = gapShift(proposed, targets, 'y', threshold)
  const dx = Math.abs(edgeDx) > 0 && (Math.abs(gapDx) === 0 || Math.abs(edgeDx) <= Math.abs(gapDx)) ? edgeDx : gapDx
  const dy = Math.abs(edgeDy) > 0 && (Math.abs(gapDy) === 0 || Math.abs(edgeDy) <= Math.abs(gapDy)) ? edgeDy : gapDy
  const snapped = { ...proposed, x: proposed.x + dx, y: proposed.y + dy }
  return {
    x: snapped.x,
    y: snapped.y,
    guides: [...edgeGuides(snapped, targets), ...spacingGuides(snapped, targets, 'x'), ...spacingGuides(snapped, targets, 'y')]
  }
}

export function selectionRoots(nodes: DesignNode[], selectedIds: string[]): DesignNode[] {
  const seed = new Set(selectedIds)
  return nodes.filter((node) => seed.has(node.id) && (!node.parentId || !seed.has(node.parentId)))
}

export function snapTargets(nodes: DesignNode[], movingIds: string[], pageId: string): Rect[] {
  const hidden = expandWithDescendants(nodes, new Set(movingIds))
  return nodes
    .filter((node) => (node.pageId || pageId) === pageId)
    .filter((node) => node.type !== 'comment')
    .filter((node) => !hidden.has(node.id))
    .map((node) => resolveWorldRect(node, nodes))
    .filter((rect) => rect.width > 0 || rect.height > 0)
}

export function snapMove(opts: {
  dx: number
  dy: number
  origins: Array<{ worldX: number; worldY: number; width: number; height: number }>
  targets: Rect[]
  zoom: number
}): { dx: number; dy: number; guides: AlignGuide[] } {
  const proposed = opts.origins.map((origin) => ({
    x: origin.worldX + opts.dx,
    y: origin.worldY + opts.dy,
    width: origin.width,
    height: origin.height
  }))
  const box = unionRect(proposed)
  if (!box) return { dx: opts.dx, dy: opts.dy, guides: [] }
  const snapped = snapRect(box, opts.targets, opts.zoom)
  return {
    dx: opts.dx + (snapped.x - box.x),
    dy: opts.dy + (snapped.y - box.y),
    guides: snapped.guides
  }
}

function shiftNode(node: DesignNode, dx: number, dy: number): DesignNode {
  return {
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    points: node.points?.map((point) => ({
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

function sharedGuide(rects: Rect[], action: AlignAction): AlignGuide[] {
  if (!rects.length) return []
  if (action === 'left' || action === 'right' || action === 'hcenter') {
    const x =
      action === 'left'
        ? Math.min(...rects.map((rect) => rect.x))
        : action === 'right'
          ? Math.max(...rects.map((rect) => rect.x + rect.width))
          : rects.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / rects.length
    const ys = rects.flatMap((rect) => [rect.y, rect.y + rect.height])
    return [
      {
        x1: x,
        y1: Math.min(...ys),
        x2: x,
        y2: Math.max(...ys),
        dots: ys.map((y) => ({ x, y }))
      }
    ]
  }
  const y =
    action === 'top'
      ? Math.min(...rects.map((rect) => rect.y))
      : action === 'bottom'
        ? Math.max(...rects.map((rect) => rect.y + rect.height))
        : rects.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / rects.length
  const xs = rects.flatMap((rect) => [rect.x, rect.x + rect.width])
  return [
    {
      x1: Math.min(...xs),
      y1: y,
      x2: Math.max(...xs),
      y2: y,
      dots: xs.map((x) => ({ x, y }))
    }
  ]
}

/** Align selected objects to each other, or one object to its parent frame. */
export function alignNodes(
  nodes: DesignNode[],
  selectedIds: string[],
  action: AlignAction
): { nodes: DesignNode[]; guides: AlignGuide[] } | null {
  const roots = selectionRoots(nodes, selectedIds)
  if (!roots.length) return null
  const rects = roots.map((node) => ({ node, rect: resolveWorldRect(node, nodes) }))
  let anchor: Rect | null = null
  if (rects.length === 1) {
    const parent = nodes.find((node) => node.id === rects[0].node.parentId)
    if (!parent || (parent.type !== 'frame' && parent.type !== 'section')) return null
    anchor = resolveWorldRect(parent, nodes)
  } else {
    anchor = unionRect(rects.map((item) => item.rect))
  }
  if (!anchor) return null

  const deltas = new Map<string, { dx: number; dy: number }>()
  for (const item of rects) {
    let dx = 0
    let dy = 0
    if (action === 'left') dx = anchor.x - item.rect.x
    if (action === 'hcenter') dx = anchor.x + anchor.width / 2 - (item.rect.x + item.rect.width / 2)
    if (action === 'right') dx = anchor.x + anchor.width - (item.rect.x + item.rect.width)
    if (action === 'top') dy = anchor.y - item.rect.y
    if (action === 'vcenter') dy = anchor.y + anchor.height / 2 - (item.rect.y + item.rect.height / 2)
    if (action === 'bottom') dy = anchor.y + anchor.height - (item.rect.y + item.rect.height)
    deltas.set(item.node.id, { dx, dy })
  }

  const next = nodes.map((node) => {
    const delta = deltas.get(node.id)
    return delta ? shiftNode(node, delta.dx, delta.dy) : node
  })
  const aligned = roots
    .map((node) => next.find((item) => item.id === node.id))
    .filter((node): node is DesignNode => Boolean(node))
    .map((node) => resolveWorldRect(node, next))
  const guideRects = rects.length === 1 ? [...aligned, anchor] : aligned
  return { nodes: next, guides: sharedGuide(guideRects, action) }
}

export function canAlignNodes(nodes: DesignNode[], selectedIds: string[]): boolean {
  const roots = selectionRoots(nodes, selectedIds)
  if (roots.length >= 2) return true
  if (roots.length !== 1) return false
  const parent = nodes.find((node) => node.id === roots[0].parentId)
  return Boolean(parent && (parent.type === 'frame' || parent.type === 'section'))
}
