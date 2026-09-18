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

type SizedChild = { child: DesignNode; w: number; h: number; growH: boolean; growV: boolean }

function resolveGap(layout: AutoLayout): { gap: number; autoGap: boolean } {
  if (layout.gap === 'auto' || layout.justifyContent === 'space-between') {
    return { gap: 0, autoGap: true }
  }
  return { gap: typeof layout.gap === 'number' ? layout.gap : 0, autoGap: false }
}

function placeLine(
  line: SizedChild[],
  vertical: boolean,
  pad: { t: number; r: number; b: number; l: number },
  innerMain: number,
  innerCross: number,
  crossOrigin: number,
  gap: number,
  autoGap: boolean,
  align: NonNullable<AutoLayout['alignItems']>,
  justify: NonNullable<AutoLayout['justifyContent']>,
  parentId: string
): DesignNode[] {
  const fixedMain = line.reduce((sum, item) => sum + (vertical ? item.h : item.w), 0)
  const growCount = line.filter((item) => (vertical ? item.growV : item.growH)).length
  const gapsBetween = Math.max(0, line.length - 1)
  const freeBeforeGrow = Math.max(0, innerMain - fixedMain - (autoGap ? 0 : gap * gapsBetween))
  const growShare = growCount > 0 ? freeBeforeGrow / growCount : 0

  const sized = line.map((item) => {
    let w = item.w
    let h = item.h
    if (vertical) {
      if (item.growV) h = Math.max(1, item.h + growShare)
      if (item.growH || align === 'stretch') w = Math.max(1, innerCross)
    } else {
      if (item.growH) w = Math.max(1, item.w + growShare)
      if (item.growV || align === 'stretch') h = Math.max(1, innerCross)
    }
    return { ...item, w, h }
  })

  const totalMain =
    sized.reduce((sum, item) => sum + (vertical ? item.h : item.w), 0) +
    (autoGap ? 0 : gap * gapsBetween)
  const free = Math.max(0, innerMain - totalMain)
  let mainOffset = vertical ? pad.t : pad.l
  const effectiveJustify = autoGap ? 'space-between' : justify
  if (effectiveJustify === 'center') mainOffset += free / 2
  else if (effectiveJustify === 'end') mainOffset += free
  const between =
    effectiveJustify === 'space-between' && sized.length > 1 ? free / (sized.length - 1) : gap
  let cursor = mainOffset

  return sized.map(({ child, w, h }) => {
    let cross = crossOrigin
    if (vertical) {
      if (align === 'center') cross = pad.l + (innerCross - w) / 2
      else if (align === 'end') cross = pad.l + innerCross - w
      else cross = pad.l
      const patched: DesignNode = {
        ...child,
        x: cross,
        y: cursor,
        width: w,
        height: h,
        parentId
      }
      cursor += h + between
      return patched
    }
    if (align === 'center') cross = pad.t + (innerCross - h) / 2
    else if (align === 'end') cross = pad.t + innerCross - h
    else cross = pad.t
    const patched: DesignNode = {
      ...child,
      x: cursor,
      y: cross,
      width: w,
      height: h,
      parentId
    }
    cursor += w + between
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

  const flowing = children.filter((child) => !child.layoutAbsolute)
  const absolute = children.filter((child) => child.layoutAbsolute)
  if (!flowing.length) return children

  const pad = normalizePadding(layout.padding)
  const { gap, autoGap } = resolveGap(layout)
  const counterGap = layout.counterGap ?? (typeof layout.gap === 'number' ? layout.gap : 0)
  const align = layout.alignItems || 'start'
  const justify = layout.justifyContent || 'start'
  const vertical = layout.mode === 'vertical'
  const wrap = Boolean(layout.wrap)
  const innerW = Math.max(0, (parent.width || 0) - pad.l - pad.r)
  const innerH = Math.max(0, (parent.height || 0) - pad.t - pad.b)
  const innerMain = vertical ? innerH : innerW
  const innerCross = vertical ? innerW : innerH

  const sizes: SizedChild[] = flowing.map((child) => {
    const box = localBounds(child)
    const sizingH = child.layoutSizingH || 'fixed'
    const sizingV = child.layoutSizingV || 'fixed'
    let w = Math.max(1, box.width)
    let h = Math.max(1, box.height)
    if (vertical && (sizingH === 'fill' || align === 'stretch')) w = Math.max(1, innerCross)
    if (!vertical && (sizingV === 'fill' || align === 'stretch')) h = Math.max(1, innerCross)
    return {
      child,
      w,
      h,
      growH: sizingH === 'fill',
      growV: sizingV === 'fill'
    }
  })

  let placed: DesignNode[]
  if (!wrap) {
    placed = placeLine(
      sizes,
      vertical,
      pad,
      innerMain,
      innerCross,
      vertical ? pad.l : pad.t,
      gap,
      autoGap,
      align,
      justify,
      parent.id
    )
  } else {
    const lines: SizedChild[][] = []
    let current: SizedChild[] = []
    let used = 0
    for (const item of sizes) {
      const main = Math.max(1, vertical ? item.h : item.w)
      const nextUsed = current.length ? used + gap + main : main
      if (current.length && !autoGap && nextUsed > innerMain + 0.5) {
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
      const lineCross = Math.max(1, ...line.map((item) => (vertical ? item.w : item.h)))
      const trackCross = align === 'stretch' ? innerCross : lineCross
      const linePlaced = placeLine(
        line,
        vertical,
        pad,
        innerMain,
        trackCross,
        crossCursor,
        gap,
        autoGap,
        align === 'stretch' ? 'stretch' : 'start',
        justify,
        parent.id
      )
      if (align === 'center' || align === 'end') {
        for (let i = 0; i < linePlaced.length; i++) {
          const crossSize = vertical ? line[i].w : line[i].h
          let cross = crossCursor
          if (align === 'center') cross = crossCursor + (lineCross - crossSize) / 2
          else cross = crossCursor + lineCross - crossSize
          linePlaced[i] = vertical ? { ...linePlaced[i], x: cross } : { ...linePlaced[i], y: cross }
        }
      }
      result.push(...linePlaced)
      crossCursor += lineCross + counterGap
    }
    placed = result
  }

  const byId = new Map(placed.map((node) => [node.id, node]))
  return children.map((child) => byId.get(child.id) || child)
}

/** Infer Figma-style auto layout from a free selection (direction + gap). */
function inferAutoLayoutFromSelection(boxes: Rect[]): {
  mode: 'horizontal' | 'vertical'
  gap: number
  width: number
  height: number
} {
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  const spanX = maxX - minX
  const spanY = maxY - minY
  const mode: 'horizontal' | 'vertical' = spanX >= spanY ? 'horizontal' : 'vertical'

  const ordered = [...boxes].sort((a, b) => {
    if (mode === 'horizontal') {
      const dx = a.x - b.x
      if (Math.abs(dx) > 1) return dx
      return a.y - b.y
    }
    const dy = a.y - b.y
    if (Math.abs(dy) > 1) return dy
    return a.x - b.x
  })

  const gaps: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const next = ordered[i]
    const gap =
      mode === 'horizontal' ? next.x - (prev.x + prev.width) : next.y - (prev.y + prev.height)
    if (Number.isFinite(gap) && gap >= 0) gaps.push(Math.round(gap))
  }
  const gap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 8

  return {
    mode,
    gap,
    width: Math.max(1, spanX),
    height: Math.max(1, spanY)
  }
}

/** Wrap selected nodes in a new auto-layout frame (Figma ⇧A). */
export function wrapSelectionInFlex(
  nodes: DesignNode[],
  selectedIds: string[],
  opts?: { pageId?: string; id?: string; name?: string }
): { nodes: DesignNode[]; frameId: string } | null {
  const selected = selectedIds.filter((id) => nodes.some((node) => node.id === id))
  if (!selected.length) return null

  const selectedSet = new Set(selected)
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

  const worldBoxes = roots.map((id) => resolveWorldRect(nodes.find((item) => item.id === id)!, nodes))
  const inferred = inferAutoLayoutFromSelection(worldBoxes)
  const pad = 0
  const gap = inferred.gap
  const minX = Math.min(...worldBoxes.map((box) => box.x))
  const minY = Math.min(...worldBoxes.map((box) => box.y))
  const frameId = opts?.id || `frame-${Date.now()}`
  const sharedParent = (() => {
    const first = nodes.find((node) => node.id === roots[0])
    const parentId = first?.parentId
    if (!parentId) return null
    return roots.every((id) => nodes.find((node) => node.id === id)?.parentId === parentId)
      ? nodes.find((node) => node.id === parentId) || null
      : null
  })()

  let frameX = minX
  let frameY = minY
  if (sharedParent) {
    const parentWorld = resolveWorldRect(sharedParent, nodes)
    frameX = minX - parentWorld.x
    frameY = minY - parentWorld.y
  }

  // Content-hug size: bounding box of selection (padding 0, like Figma on free selection)
  const frameW = inferred.width
  const frameH = inferred.height

  const frame: DesignNode = {
    id: frameId,
    type: 'frame',
    x: frameX,
    y: frameY,
    width: frameW,
    height: frameH,
    name: opts?.name || 'Frame',
    pageId: opts?.pageId || nodes.find((node) => node.id === roots[0])?.pageId,
    parentId: sharedParent?.id,
    // Figma wrap-in-auto-layout: no fill until the user adds one
    fills: [],
    clipsContent: false,
    layout: {
      mode: inferred.mode,
      gap,
      padding: pad,
      alignItems: 'start',
      justifyContent: 'start',
      wrap: false,
      sizingH: 'hug',
      sizingV: 'hug'
    }
  }

  const frameWorld = sharedParent
    ? {
        x: resolveWorldRect(sharedParent, nodes).x + frameX,
        y: resolveWorldRect(sharedParent, nodes).y + frameY,
        width: frame.width!,
        height: frame.height!
      }
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

/** Wrap selection in a plain frame (Paper ⇧F). */
export function wrapSelectionInFrame(
  nodes: DesignNode[],
  selectedIds: string[],
  opts?: { pageId?: string; id?: string; name?: string }
): { nodes: DesignNode[]; frameId: string } | null {
  const wrapped = wrapSelectionInFlex(nodes, selectedIds, {
    ...opts,
    name: opts?.name || 'Frame',
    id: opts?.id
  })
  if (!wrapped) return null
  return {
    frameId: wrapped.frameId,
    nodes: wrapped.nodes.map((node) =>
      node.id === wrapped.frameId
        ? { ...node, name: opts?.name || 'Frame', layout: { mode: 'none' as const } }
        : node
    )
  }
}

/** Enable flex on selected frames, or wrap non-frames in flex (Paper ⇧A). */
export function addOrWrapFlex(
  nodes: DesignNode[],
  selectedIds: string[],
  opts?: { pageId?: string; id?: string }
): { nodes: DesignNode[]; frameId?: string } | null {
  const selected = selectedIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DesignNode => Boolean(node))
  if (!selected.length) return null

  // Single frame without flex → add flex layout in place
  if (selected.length === 1 && selected[0].type === 'frame' && !isAutoLayout(selected[0])) {
    const id = selected[0].id
    return {
      nodes: reflowAutoLayout(
        nodes.map((node) =>
          node.id === id
            ? {
                ...node,
                layout: defaultFrameLayout(),
                clipsContent: node.clipsContent ?? false
              }
            : node
        )
      ),
      frameId: id
    }
  }

  // Already flex frame(s) only → no-op (caller should remove instead)
  if (selected.every((node) => node.type === 'frame' && isAutoLayout(node))) {
    return null
  }

  return wrapSelectionInFlex(nodes, selectedIds, { ...opts, name: 'Frame' })
}

/** Deep-duplicate selected nodes (and descendants), offset slightly. */
export function duplicateSelection(
  nodes: DesignNode[],
  selectedIds: string[],
  offset = 24
): { nodes: DesignNode[]; newIds: string[] } | null {
  const selectedSet = new Set(selectedIds.filter((id) => nodes.some((node) => node.id === id)))
  if (!selectedSet.size) return null

  const roots = [...selectedSet].filter((id) => {
    let cur = nodes.find((node) => node.id === id)
    while (cur?.parentId) {
      if (selectedSet.has(cur.parentId)) return false
      cur = nodes.find((node) => node.id === cur!.parentId)
    }
    return true
  })
  if (!roots.length) return null

  const cloneIds = new Set<string>()
  for (const rootId of roots) {
    cloneIds.add(rootId)
    let changed = true
    while (changed) {
      changed = false
      for (const node of nodes) {
        if (node.parentId && cloneIds.has(node.parentId) && !cloneIds.has(node.id)) {
          cloneIds.add(node.id)
          changed = true
        }
      }
    }
  }

  const idMap = new Map<string, string>()
  for (const id of cloneIds) idMap.set(id, cryptoRandomId())

  const clones: DesignNode[] = []
  for (const node of nodes) {
    if (!cloneIds.has(node.id)) continue
    const isRoot = roots.includes(node.id)
    const world = resolveWorldRect(node, nodes)
    const nextParentId = node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : node.parentId
    const clone: DesignNode = {
      ...node,
      id: idMap.get(node.id)!,
      parentId: nextParentId,
      name: isRoot ? `${node.name || node.type} copy` : node.name,
      x: isRoot && !node.parentId ? world.x + offset : isRoot && node.parentId ? node.x + offset : node.x,
      y: isRoot && !node.parentId ? world.y + offset : isRoot && node.parentId ? node.y + offset : node.y,
      points: node.points?.map((point) =>
        isRoot ? { ...point, x: point.x + offset, y: point.y + offset } : { ...point }
      )
    }
    clones.push(clone)
  }

  const newIds = roots.map((id) => idMap.get(id)!).filter(Boolean)
  return { nodes: [...nodes, ...clones], newIds }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Collect every node under a world point (top-most last). */
export function layersAtPoint(
  worldPoint: { x: number; y: number },
  nodes: DesignNode[]
): DesignNode[] {
  const hits: DesignNode[] = []
  for (const node of nodes) {
    if (node.type === 'comment') continue
    const box = resolveWorldRect(node, nodes)
    if (
      worldPoint.x >= box.x &&
      worldPoint.y >= box.y &&
      worldPoint.x <= box.x + box.width &&
      worldPoint.y <= box.y + box.height
    ) {
      hits.push(node)
    }
  }
  return hits
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

/** Content size of an auto-layout frame when hugging children (Figma Hug). */
export function measureHugSize(
  layout: AutoLayout,
  children: DesignNode[],
  current?: { width?: number; height?: number }
): { width: number; height: number } {
  const pad = normalizePadding(layout.padding)
  const { gap, autoGap } = resolveGap(layout)
  const spacing = autoGap ? 0 : gap
  const counterGap = layout.counterGap ?? (typeof layout.gap === 'number' ? layout.gap : 0)
  const vertical = layout.mode === 'vertical'
  const wrap = Boolean(layout.wrap)
  const flowing = children.filter((child) => !child.layoutAbsolute)
  const sizes = flowing.map((child) => {
    const box = localBounds(child)
    return { w: Math.max(1, box.width), h: Math.max(1, box.height) }
  })
  if (!sizes.length) {
    return { width: Math.max(1, pad.l + pad.r), height: Math.max(1, pad.t + pad.b) }
  }

  if (wrap && !vertical && (layout.sizingH || 'fixed') === 'fixed' && current?.width) {
    const innerW = Math.max(1, current.width - pad.l - pad.r)
    let lineW = 0
    let lineH = 0
    let totalH = 0
    let lines = 0
    for (const item of sizes) {
      const next = lineW ? lineW + spacing + item.w : item.w
      if (lineW && next > innerW + 0.5) {
        totalH += lineH + (lines ? counterGap : 0)
        lines += 1
        lineW = item.w
        lineH = item.h
      } else {
        lineW = next
        lineH = Math.max(lineH, item.h)
      }
    }
    totalH += lineH
    return {
      width: Math.max(1, current.width),
      height: Math.max(1, pad.t + pad.b + totalH)
    }
  }

  if (vertical) {
    const height =
      pad.t + pad.b + sizes.reduce((sum, item) => sum + item.h, 0) + spacing * Math.max(0, sizes.length - 1)
    const width = pad.l + pad.r + Math.max(...sizes.map((item) => item.w))
    return { width: Math.max(1, width), height: Math.max(1, height) }
  }
  const width =
    pad.l + pad.r + sizes.reduce((sum, item) => sum + item.w, 0) + spacing * Math.max(0, sizes.length - 1)
  const height = pad.t + pad.b + Math.max(...sizes.map((item) => item.h))
  return { width: Math.max(1, width), height: Math.max(1, height) }
}

/** Reflow every auto-layout frame in the document (deepest first so nested hug works). */
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

  const frames = nodes.filter((node) => isAutoLayout(node)).sort((a, b) => depth(b) - depth(a))
  if (!frames.length) return nodes

  let next = [...nodes]
  for (const frame of frames) {
    let parent = next.find((node) => node.id === frame.id) || frame
    const layout = parent.layout!
    const kids = childrenOf(next, frame.id)
    if (!kids.length) continue
    const childFillH = kids.some((child) => !child.layoutAbsolute && child.layoutSizingH === 'fill')
    const childFillV = kids.some((child) => !child.layoutAbsolute && child.layoutSizingV === 'fill')
    // Figma: Fill children force the parent axis to Fixed (can't Hug)
    let sizingH = layout.sizingH || 'fixed'
    let sizingV = layout.sizingV || 'fixed'
    if (childFillH && sizingH === 'hug') sizingH = 'fixed'
    if (childFillV && sizingV === 'hug') sizingV = 'fixed'
    const hugH = sizingH === 'hug'
    const hugV = sizingV === 'hug'
    if (hugH || hugV || sizingH !== (layout.sizingH || 'fixed') || sizingV !== (layout.sizingV || 'fixed')) {
      const measured = measureHugSize(
        { ...layout, sizingH, sizingV },
        kids,
        { width: parent.width, height: parent.height }
      )
      parent = {
        ...parent,
        width: hugH ? measured.width : parent.width,
        height: hugV ? measured.height : parent.height,
        layout: { ...layout, sizingH, sizingV }
      }
    }
    const patched = applyAutoLayout(parent, kids)
    const map = new Map(patched.map((node) => [node.id, node]))
    next = next.map((node) => {
      if (node.id === parent.id) return parent
      return map.get(node.id) || node
    })
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
    padding: 0,
    alignItems: 'start',
    justifyContent: 'start',
    wrap: false,
    sizingH: 'hug',
    sizingV: 'hug'
  }
}
