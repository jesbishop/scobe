import type { AutoLayout, DesignNode } from './types'

export type Rect = { x: number; y: number; width: number; height: number }

export function localBounds(node: DesignNode): Rect {
  if (node.points?.length && !node.parentId) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of node.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }
  return {
    x: node.x,
    y: node.y,
    width: Math.max(node.type === 'text' ? 1 : 0, node.width || (node.type === 'text' ? 40 : 0)),
    height: Math.max(node.type === 'text' ? 1 : 0, node.height || (node.type === 'text' ? node.fontSize || 12 : 0))
  }
}

export function childrenOf(nodes: DesignNode[], parentId: string): DesignNode[] {
  return nodes.filter((node) => node.parentId === parentId)
}

export function indexById(nodes: DesignNode[]): Map<string, DesignNode> {
  const map = new Map<string, DesignNode>()
  for (const node of nodes) map.set(node.id, node)
  return map
}

/** World-space rect for a node (walks parent chain). */
export function resolveWorldRect(node: DesignNode, nodes: DesignNode[] | Map<string, DesignNode>): Rect {
  const byId = nodes instanceof Map ? nodes : indexById(nodes)
  const local = localBounds(node)
  let x = local.x
  let y = local.y
  let current: DesignNode | undefined = node
  const seen = new Set<string>()
  while (current?.parentId) {
    if (seen.has(current.parentId)) break
    seen.add(current.parentId)
    const parent = byId.get(current.parentId)
    if (!parent) break
    x += parent.x
    y += parent.y
    current = parent
  }
  return { x, y, width: local.width, height: local.height }
}

export function absoluteBounds(node: DesignNode, nodes: DesignNode[] | Map<string, DesignNode>): Rect {
  return resolveWorldRect(node, nodes)
}

export function normalizePadding(padding: AutoLayout['padding']): { t: number; r: number; b: number; l: number } {
  if (padding == null) return { t: 0, r: 0, b: 0, l: 0 }
  if (typeof padding === 'number') return { t: padding, r: padding, b: padding, l: padding }
  return padding
}

export function isAutoLayout(node: DesignNode): boolean {
  return node.type === 'frame' && Boolean(node.layout && node.layout.mode !== 'none')
}

export function canParent(node: DesignNode): boolean {
  return node.type === 'frame' || node.type === 'section'
}

/** Convert world position to parent-relative. */
export function toRelative(world: { x: number; y: number }, parentWorld: Rect): { x: number; y: number } {
  return { x: world.x - parentWorld.x, y: world.y - parentWorld.y }
}

/** Convert parent-relative position to world. */
export function toWorld(local: { x: number; y: number }, parentWorld: Rect): { x: number; y: number } {
  return { x: local.x + parentWorld.x, y: local.y + parentWorld.y }
}

type SizedChild = { child: DesignNode; w: number; h: number }

function placeLine(
  line: SizedChild[],
  vertical: boolean,
  pad: { t: number; r: number; b: number; l: number },
  innerMain: number,
  innerCross: number,
  crossOrigin: number,
  gap: number,
  align: NonNullable<AutoLayout['alignItems']>,
  justify: NonNullable<AutoLayout['justifyContent']>,
  parentId: string
): DesignNode[] {
  const totalMain = line.reduce((sum, item) => sum + (vertical ? item.h : item.w), 0) + gap * Math.max(0, line.length - 1)
  const free = Math.max(0, innerMain - totalMain)
  let mainOffset = vertical ? pad.t : pad.l
  if (justify === 'center') mainOffset += free / 2
  else if (justify === 'end') mainOffset += free
  const between = justify === 'space-between' && line.length > 1 ? free / (line.length - 1) : gap
  let cursor = mainOffset

  return line.map(({ child, w, h }) => {
    let cross = crossOrigin
    let nextW = w
    let nextH = h
    if (vertical) {
      if (align === 'center') cross = pad.l + (innerCross - w) / 2
      else if (align === 'end') cross = pad.l + innerCross - w
      else if (align === 'stretch') {
        cross = pad.l
        nextW = Math.max(1, innerCross)
      }
      const patched: DesignNode = {
        ...child,
        x: cross,
        y: cursor,
        width: nextW,
        height: nextH,
        parentId
      }
      cursor += nextH + between
      return patched
    }
    if (align === 'center') cross = pad.t + (innerCross - h) / 2
    else if (align === 'end') cross = pad.t + innerCross - h
    else if (align === 'stretch') {
      cross = pad.t
      nextH = Math.max(1, innerCross)
    }
    const patched: DesignNode = {
      ...child,
      x: cursor,
      y: cross,
      width: nextW,
      height: nextH,
      parentId
    }
    cursor += nextW + between
    return patched
  })
}

/**
 * Apply auto-layout to direct children of a frame.
 * Returns patched child nodes (same order / ids). Does not resize the parent.
 */
export function applyAutoLayout(parent: DesignNode, children: DesignNode[]): DesignNode[] {
  const layout = parent.layout
  if (!layout || layout.mode === 'none' || !children.length) return children

  const pad = normalizePadding(layout.padding)
  const gap = layout.gap ?? 0
  const align = layout.alignItems || 'start'
  const justify = layout.justifyContent || 'start'
  const vertical = layout.mode === 'vertical'
  const wrap = Boolean(layout.wrap)
  const innerW = Math.max(0, (parent.width || 0) - pad.l - pad.r)
  const innerH = Math.max(0, (parent.height || 0) - pad.t - pad.b)
  const innerMain = vertical ? innerH : innerW
  const innerCross = vertical ? innerW : innerH

  const sizes: SizedChild[] = children.map((child) => {
    const box = localBounds(child)
    return { child, w: Math.max(1, box.width), h: Math.max(1, box.height) }
  })

  if (!wrap) {
    return placeLine(sizes, vertical, pad, innerMain, innerCross, vertical ? pad.l : pad.t, gap, align, justify, parent.id)
  }

  const lines: SizedChild[][] = []
  let current: SizedChild[] = []
  let used = 0
  for (const item of sizes) {
    const main = vertical ? item.h : item.w
    const nextUsed = current.length ? used + gap + main : main
    if (current.length && nextUsed > innerMain + 0.5) {
      lines.push(current)
      current = [item]
      used = main
    } else {
      current.push(item)
      used = nextUsed
    }
  }
  if (current.length) lines.push(current)

  const result: DesignNode[] = []
  let crossCursor = vertical ? pad.l : pad.t
  for (const line of lines) {
    // Align-items: stretch fills the line track; otherwise place within the line's cross size
    const trackCross = align === 'stretch' ? innerCross : lineCross
    const placed = placeLine(
      line,
      vertical,
      pad,
      innerMain,
      trackCross,
      crossCursor,
      gap,
      align === 'stretch' ? 'stretch' : 'start',
      justify,
      parent.id
    )
    if (align === 'center' || align === 'end') {
      for (let i = 0; i < placed.length; i++) {
        const crossSize = vertical ? line[i].w : line[i].h
        let cross = crossCursor
        if (align === 'center') cross = crossCursor + (lineCross - crossSize) / 2
        else cross = crossCursor + lineCross - crossSize
        placed[i] = vertical ? { ...placed[i], x: cross } : { ...placed[i], y: cross }
      }
    }
    result.push(...placed)
    crossCursor += lineCross + gap
  }
  return result
}

/** Wrap selected nodes in a new flex frame (Paper ⇧A). */
export function wrapSelectionInFlex(
  nodes: DesignNode[],
  selectedIds: string[],
  opts?: { pageId?: string; id?: string; name?: string }
): { nodes: DesignNode[]; frameId: string } | null {
  const selected = selectedIds.filter((id) => nodes.some((node) => node.id === id))
  if (!selected.length) return null

  const selectedSet = new Set(selected)
  // Prefer top-most selected nodes (skip descendants of other selected nodes)
  const roots = selected
    .filter((id) => {
      let cur = nodes.find((node) => node.id === id)
      while (cur?.parentId) {
        if (selectedSet.has(cur.parentId)) return false
        cur = nodes.find((node) => node.id === cur!.parentId)
      }
      return true
    })
    .sort((a, b) => {
      const aw = resolveWorldRect(nodes.find((node) => node.id === a)!, nodes)
      const bw = resolveWorldRect(nodes.find((node) => node.id === b)!, nodes)
      const dy = aw.y - bw.y
      if (Math.abs(dy) > 4) return dy
      return aw.x - bw.x
    })
  if (!roots.length) return null

  const worldBoxes = roots.map((id) => {
    const node = nodes.find((item) => item.id === id)!
    return resolveWorldRect(node, nodes)
  })
  const pad = 16
  const gap = 8
  let minX = Math.min(...worldBoxes.map((box) => box.x))
  let minY = Math.min(...worldBoxes.map((box) => box.y))
  let maxX = Math.max(...worldBoxes.map((box) => box.x + box.width))
  let maxY = Math.max(...worldBoxes.map((box) => box.y + box.height))
  const frameId = opts?.id || `frame-${Date.now()}`
  const sharedParent = (() => {
    const first = nodes.find((node) => node.id === roots[0])
    const parentId = first?.parentId
    if (!parentId) return null
    return roots.every((id) => nodes.find((node) => node.id === id)?.parentId === parentId)
      ? nodes.find((node) => node.id === parentId) || null
      : null
  })()

  let frameX = minX - pad
  let frameY = minY - pad
  if (sharedParent) {
    const parentWorld = resolveWorldRect(sharedParent, nodes)
    frameX = minX - parentWorld.x - pad
    frameY = minY - parentWorld.y - pad
  }

  const frame: DesignNode = {
    id: frameId,
    type: 'frame',
    x: frameX,
    y: frameY,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
    name: opts?.name || 'Flex',
    pageId: opts?.pageId || nodes.find((node) => node.id === roots[0])?.pageId,
    parentId: sharedParent?.id,
    fill: '#FFFFFF',
    clipsContent: true,
    layout: {
      mode: 'horizontal',
      gap,
      padding: pad,
      alignItems: 'start',
      justifyContent: 'start',
      wrap: false
    }
  }

  const frameWorld = sharedParent
    ? { x: resolveWorldRect(sharedParent, nodes).x + frameX, y: resolveWorldRect(sharedParent, nodes).y + frameY, width: frame.width, height: frame.height }
    : { x: frameX, y: frameY, width: frame.width!, height: frame.height! }

  const rootSet = new Set(roots)
  const withoutRoots = nodes.filter((node) => !rootSet.has(node.id))
  const reparented = roots.map((id) => {
    const node = nodes.find((item) => item.id === id)!
    const world = resolveWorldRect(node, nodes)
    const rel = toRelative({ x: world.x, y: world.y }, frameWorld)
    return { ...node, parentId: frameId, x: rel.x, y: rel.y }
  })
  const firstIndex = nodes.findIndex((node) => rootSet.has(node.id))
  const beforeCount = nodes
    .slice(0, firstIndex < 0 ? nodes.length : firstIndex)
    .filter((node) => !rootSet.has(node.id)).length
  const withFrame = [
    ...withoutRoots.slice(0, beforeCount),
    frame,
    ...reparented,
    ...withoutRoots.slice(beforeCount)
  ]
  return { nodes: reflowAutoLayout(withFrame), frameId }
}

/** Remove flex layout from selected frames (Paper ⌥⇧A). */
export function removeFlexFromSelection(nodes: DesignNode[], selectedIds: string[]): DesignNode[] {
  const strip = new Set<string>()
  for (const id of selectedIds) {
    const node = nodes.find((item) => item.id === id)
    if (!node) continue
    if (node.type === 'frame' && isAutoLayout(node)) {
      strip.add(node.id)
      continue
    }
    if (node.parentId) {
      const parent = nodes.find((item) => item.id === node.parentId)
      if (parent && isAutoLayout(parent)) strip.add(parent.id)
    }
  }
  if (!strip.size) return nodes
  return nodes.map((node) =>
    strip.has(node.id) ? { ...node, layout: { mode: 'none' as const } } : node
  )
}

/** Reflow every auto-layout frame in the document (parents before nested). */
export function reflowAutoLayout(nodes: DesignNode[]): DesignNode[] {
  const byId = indexById(nodes)
  const depth = (node: DesignNode): number => {
    let d = 0
    let cur: DesignNode | undefined = node
    const seen = new Set<string>()
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) break
      seen.add(cur.parentId)
      d += 1
      cur = byId.get(cur.parentId)
    }
    return d
  }

  const frames = nodes.filter((node) => isAutoLayout(node)).sort((a, b) => depth(a) - depth(b))
  if (!frames.length) return nodes

  let next = [...nodes]
  for (const frame of frames) {
    const kids = childrenOf(next, frame.id)
    if (!kids.length) continue
    const parent = next.find((node) => node.id === frame.id) || frame
    const patched = applyAutoLayout(parent, kids)
    const map = new Map(patched.map((node) => [node.id, node]))
    next = next.map((node) => map.get(node.id) || node)
  }
  return next
}

/** Find deepest frame/section whose bounds contain the world point (center). */
export function findContainingParent(
  worldPoint: { x: number; y: number },
  nodes: DesignNode[],
  excludeIds: Set<string> = new Set()
): DesignNode | null {
  const candidates = nodes.filter((node) => canParent(node) && !excludeIds.has(node.id))
  let best: DesignNode | null = null
  let bestArea = Infinity
  for (const node of candidates) {
    const box = resolveWorldRect(node, nodes)
    if (
      worldPoint.x >= box.x &&
      worldPoint.y >= box.y &&
      worldPoint.x <= box.x + box.width &&
      worldPoint.y <= box.y + box.height
    ) {
      const area = box.width * box.height
      if (area < bestArea) {
        bestArea = area
        best = node
      }
    }
  }
  return best
}

export function expandWithDescendants(nodes: DesignNode[], selected: Set<string>): Set<string> {
  const ids = new Set(selected)
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        ids.add(node.id)
        changed = true
      }
    }
  }
  return ids
}

export function defaultFrameLayout(): AutoLayout {
  return {
    mode: 'horizontal',
    gap: 8,
    padding: 16,
    alignItems: 'start',
    justifyContent: 'start',
    wrap: false
  }
}
