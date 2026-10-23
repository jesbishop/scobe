import type { AutoLayout, DesignNode, GridTrack } from './types'

export type Rect = { x: number; y: number; width: number; height: number }

/** Pen / pencil / brush strokes keep their points in world space, even when parented. */
export function hasWorldPoints(node: DesignNode): boolean {
  return node.type === 'path' && Boolean(node.pathTool) && Boolean(node.points?.length)
}

export function localBounds(node: DesignNode): Rect {
  if (node.points?.length && (!node.parentId || hasWorldPoints(node))) {
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

type NodeIndex = { length: number; byId: Map<string, DesignNode>; kids?: Map<string, DesignNode[]> }
const nodeIndexCache = new WeakMap<DesignNode[], NodeIndex>()

function cachedIndex(nodes: DesignNode[]): NodeIndex {
  const hit = nodeIndexCache.get(nodes)
  if (hit && hit.length === nodes.length) return hit
  const next: NodeIndex = { length: nodes.length, byId: indexById(nodes) }
  nodeIndexCache.set(nodes, next)
  return next
}

/**
 * Id → node for a design array, built once per array. Design arrays are replaced, never
 * mutated, so per-item lookups during render stay O(1) instead of rescanning every node.
 */
export function nodeIndexOf(nodes: DesignNode[]): Map<string, DesignNode> {
  return cachedIndex(nodes).byId
}

/** Parent id → direct children for a design array (cached like `nodeIndexOf`). */
export function childIndexOf(nodes: DesignNode[]): Map<string, DesignNode[]> {
  const index = cachedIndex(nodes)
  if (!index.kids) {
    const kids = new Map<string, DesignNode[]>()
    for (const node of nodes) {
      if (!node.parentId) continue
      const list = kids.get(node.parentId)
      if (list) list.push(node)
      else kids.set(node.parentId, [node])
    }
    index.kids = kids
  }
  return index.kids
}

/** World-space rect for a node (walks parent chain). */
export function resolveWorldRect(node: DesignNode, nodes: DesignNode[] | Map<string, DesignNode>): Rect {
  const byId = nodes instanceof Map ? nodes : nodeIndexOf(nodes)
  const local = localBounds(node)
  if (hasWorldPoints(node)) return local
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

type Margin = { t: number; r: number; b: number; l: number }
type SizedChild = { child: DesignNode; w: number; h: number; growH: boolean; growV: boolean; m: Margin }

const NO_MARGIN: Margin = { t: 0, r: 0, b: 0, l: 0 }

export function marginOf(node: DesignNode): Margin {
  const m = node.layoutMargin
  if (!m) return NO_MARGIN
  return { t: m.t || 0, r: m.r || 0, b: m.b || 0, l: m.l || 0 }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(100, Math.max(0, value))
}

function percentFromSize(size: number, parentInner: number): number {
  if (parentInner <= 0) return 100
  return clampPercent((size / parentInner) * 100)
}

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
  // Margins count as fixed space on the main axis and shrink Fill/stretch on the cross axis (CSS).
  const mainMargin = (m: Margin) => (vertical ? m.t + m.b : m.l + m.r)
  const crossMargin = (m: Margin) => (vertical ? m.l + m.r : m.t + m.b)
  const fixedMain = line.reduce((sum, item) => {
    const grows = vertical ? item.growV : item.growH
    return sum + mainMargin(item.m) + (grows ? 0 : vertical ? item.h : item.w)
  }, 0)
  const growCount = line.filter((item) => (vertical ? item.growV : item.growH)).length
  const gapsBetween = Math.max(0, line.length - 1)
  const freeBeforeGrow = Math.max(0, innerMain - fixedMain - (autoGap ? 0 : gap * gapsBetween))
  const growShare = growCount > 0 ? freeBeforeGrow / growCount : 0

  const sized = line.map((item) => {
    let w = item.w
    let h = item.h
    const crossSpace = Math.max(1, innerCross - crossMargin(item.m))
    if (vertical) {
      if (item.growV) h = Math.max(1, growShare)
      if (item.growH || align === 'stretch') w = crossSpace
    } else {
      if (item.growH) w = Math.max(1, growShare)
      if (item.growV || align === 'stretch') h = crossSpace
    }
    return { ...item, w, h }
  })

  const totalMain =
    sized.reduce((sum, item) => sum + (vertical ? item.h : item.w) + mainMargin(item.m), 0) +
    (autoGap ? 0 : gap * gapsBetween)
  const free = Math.max(0, innerMain - totalMain)
  let mainOffset = vertical ? pad.t : pad.l
  const effectiveJustify = autoGap ? 'space-between' : justify
  if (effectiveJustify === 'center') mainOffset += free / 2
  else if (effectiveJustify === 'end') mainOffset += free
  const between =
    effectiveJustify === 'space-between' && sized.length > 1 ? free / (sized.length - 1) : gap
  let cursor = mainOffset

  return sized.map(({ child, w, h, m }) => {
    let cross = crossOrigin
    if (vertical) {
      const outerW = w + m.l + m.r
      if (align === 'center') cross = crossOrigin + (innerCross - outerW) / 2 + m.l
      else if (align === 'end') cross = crossOrigin + innerCross - w - m.r
      else cross = crossOrigin + m.l
      const patched: DesignNode = {
        ...child,
        x: cross,
        y: cursor + m.t,
        width: w,
        height: h,
        parentId
      }
      cursor += m.t + h + m.b + between
      return patched
    }
    const outerH = h + m.t + m.b
    if (align === 'center') cross = crossOrigin + (innerCross - outerH) / 2 + m.t
    else if (align === 'end') cross = crossOrigin + innerCross - h - m.b
    else cross = crossOrigin + m.t
    const patched: DesignNode = {
      ...child,
      x: cursor + m.l,
      y: cross,
      width: w,
      height: h,
      parentId
    }
    cursor += m.l + w + m.r + between
    return patched
  })
}

export type GridCell = { col: number; row: number; colSpan: number; rowSpan: number }

export type GridPlan = {
  columns: number
  rows: number
  colSizes: number[]
  rowSizes: number[]
  /** Parent-local start of each track (padding included). */
  colStarts: number[]
  rowStarts: number[]
  colGap: number
  rowGap: number
  pad: { t: number; r: number; b: number; l: number }
  cells: Map<string, GridCell>
}

export function isGridLayout(node: DesignNode | undefined): boolean {
  return Boolean(node && isAutoLayout(node) && node.layout?.grid)
}

/**
 * Sizing of a grid track. Unset tracks Hug on a Hug axis and Fill on a fixed axis,
 * so the grid always spans the frame (and its fill) as rows/columns are added.
 */
export function gridTrackAt(layout: AutoLayout, axis: 'col' | 'row', index: number): GridTrack {
  const explicit = (axis === 'col' ? layout.grid?.columnTracks : layout.grid?.rowTracks)?.[index]
  if (explicit != null) return explicit
  return gridDefaultTrack(layout, axis)
}

export function gridDefaultTrack(layout: AutoLayout, axis: 'col' | 'row'): GridTrack {
  const sizing = (axis === 'col' ? layout.sizingH : layout.sizingV) || 'fixed'
  return sizing === 'hug' ? 'hug' : 'fill'
}

/**
 * Figma grid flow: auto-place flowing children row by row (skipping occupied cells for spans),
 * then size tracks — Hug = largest single-span child, Fill = share of leftover space, number = fixed px.
 */
export function planGrid(
  layout: AutoLayout,
  children: DesignNode[],
  frame?: { width?: number; height?: number },
  fill: { h: boolean; v: boolean } = { h: true, v: true }
): GridPlan {
  const grid = layout.grid || { columns: 1, rows: 'auto' as const }
  const pad = normalizePadding(layout.padding)
  const colGap = typeof layout.gap === 'number' ? Math.max(0, layout.gap) : 0
  const rowGap = Math.max(0, layout.counterGap ?? colGap)
  const columns = Math.max(1, Math.round(grid.columns || 1))
  const flowing = children.filter((child) => !child.layoutAbsolute)

  const occupied = new Set<string>()
  const cells = new Map<string, GridCell>()
  let row = 0
  let col = 0
  for (const child of flowing) {
    const colSpan = Math.min(columns, Math.max(1, Math.round(child.gridColumnSpan || 1)))
    const rowSpan = Math.max(1, Math.round(child.gridRowSpan || 1))
    for (let guard = 0; guard < 100000; guard++) {
      if (col + colSpan > columns) {
        row += 1
        col = 0
        continue
      }
      let free = true
      for (let r = row; r < row + rowSpan && free; r++) {
        for (let c = col; c < col + colSpan; c++) {
          if (occupied.has(`${r}:${c}`)) {
            free = false
            break
          }
        }
      }
      if (free) break
      col += 1
    }
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) occupied.add(`${r}:${c}`)
    }
    cells.set(child.id, { col, row, colSpan, rowSpan })
    col += colSpan
  }

  let usedRows = 0
  for (const cell of cells.values()) usedRows = Math.max(usedRows, cell.row + cell.rowSpan)
  const rows = Math.max(1, typeof grid.rows === 'number' ? Math.max(Math.round(grid.rows), usedRows) : usedRows)

  const colTracks = Array.from({ length: columns }, (_, i) => gridTrackAt(layout, 'col', i))
  const rowTracks = Array.from({ length: rows }, (_, i) => gridTrackAt(layout, 'row', i))
  const colSizes = colTracks.map((track) => (typeof track === 'number' ? Math.max(0, track) : 0))
  const rowSizes = rowTracks.map((track) => (typeof track === 'number' ? Math.max(0, track) : 0))
  const colHas = colTracks.map(() => false)
  const rowHas = rowTracks.map(() => false)

  const boxes = new Map(flowing.map((child) => [child.id, localBounds(child)]))
  for (const child of flowing) {
    const cell = cells.get(child.id)!
    const box = boxes.get(child.id)!
    if (cell.colSpan === 1 && typeof colTracks[cell.col] !== 'number') {
      colHas[cell.col] = true
      if (child.layoutSizingH !== 'fill' && child.layoutSizingH !== 'relative') {
        colSizes[cell.col] = Math.max(colSizes[cell.col], Math.max(1, box.width))
      }
    }
    if (cell.rowSpan === 1 && typeof rowTracks[cell.row] !== 'number') {
      rowHas[cell.row] = true
      if (child.layoutSizingV !== 'fill' && child.layoutSizingV !== 'relative') {
        rowSizes[cell.row] = Math.max(rowSizes[cell.row], Math.max(1, box.height))
      }
    }
  }

  const colMins = colSizes.slice()
  const rowMins = rowSizes.slice()

  // Empty Hug tracks borrow the average of their filled siblings so blank cells stay visible.
  const backfill = (sizes: number[], has: boolean[], tracks: typeof colTracks) => {
    const known = sizes.filter((size, i) => typeof tracks[i] !== 'number' && has[i] && size > 0)
    const fallback = known.length ? known.reduce((sum, size) => sum + size, 0) / known.length : 100
    sizes.forEach((size, i) => {
      if (typeof tracks[i] !== 'number' && size <= 0) sizes[i] = fallback
    })
  }
  backfill(colSizes, colHas, colTracks)
  backfill(rowSizes, rowHas, rowTracks)

  // Spanning children grow the last flexible track they cover.
  for (const child of flowing) {
    const cell = cells.get(child.id)!
    const box = boxes.get(child.id)!
    if (cell.colSpan > 1 && child.layoutSizingH !== 'fill') {
      const covered = colSizes.slice(cell.col, cell.col + cell.colSpan).reduce((a, b) => a + b, 0) + colGap * (cell.colSpan - 1)
      const need = box.width - covered
      const target = [...Array(cell.colSpan).keys()].map((i) => cell.col + i).reverse().find((i) => typeof colTracks[i] !== 'number')
      if (need > 0 && target != null) colSizes[target] += need
    }
    if (cell.rowSpan > 1 && child.layoutSizingV !== 'fill') {
      const covered = rowSizes.slice(cell.row, cell.row + cell.rowSpan).reduce((a, b) => a + b, 0) + rowGap * (cell.rowSpan - 1)
      const need = box.height - covered
      const target = [...Array(cell.rowSpan).keys()].map((i) => cell.row + i).reverse().find((i) => typeof rowTracks[i] !== 'number')
      if (need > 0 && target != null) rowSizes[target] += need
    }
  }

  // Fill tracks never shrink below their content (CSS minmax(auto, 1fr)); the rest share what's left.
  const spreadFill = (sizes: number[], mins: number[], tracks: typeof colTracks, inner: number, gap: number) => {
    let flexible = tracks.map((track, i) => (track === 'fill' ? i : -1)).filter((i) => i >= 0)
    if (!flexible.length) return
    const fixed = sizes.reduce((sum, size, i) => (tracks[i] === 'fill' ? sum : sum + size), 0)
    let free = inner - fixed - gap * (tracks.length - 1)
    for (let guard = 0; guard < tracks.length; guard++) {
      const share = free / flexible.length
      const pinned = flexible.filter((i) => mins[i] > share)
      if (!pinned.length) {
        for (const i of flexible) sizes[i] = Math.max(1, share)
        return
      }
      for (const i of pinned) {
        sizes[i] = mins[i]
        free -= mins[i]
      }
      flexible = flexible.filter((i) => !pinned.includes(i))
      if (!flexible.length) return
    }
  }
  if (fill.h && frame?.width) spreadFill(colSizes, colMins, colTracks, Math.max(0, frame.width - pad.l - pad.r), colGap)
  if (fill.v && frame?.height) spreadFill(rowSizes, rowMins, rowTracks, Math.max(0, frame.height - pad.t - pad.b), rowGap)

  const starts = (sizes: number[], origin: number, gap: number) => {
    const out: number[] = []
    let cursor = origin
    for (const size of sizes) {
      out.push(cursor)
      cursor += size + gap
    }
    return out
  }

  return {
    columns,
    rows,
    colSizes,
    rowSizes,
    colStarts: starts(colSizes, pad.l, colGap),
    rowStarts: starts(rowSizes, pad.t, rowGap),
    colGap,
    rowGap,
    pad,
    cells
  }
}

function applyGridLayout(parent: DesignNode, layout: AutoLayout, children: DesignNode[]): DesignNode[] {
  const plan = planGrid(layout, children, parent, {
    h: (layout.sizingH || 'fixed') !== 'hug',
    v: (layout.sizingV || 'fixed') !== 'hug'
  })
  const span = (sizes: number[], start: number, count: number, gap: number) =>
    sizes.slice(start, start + count).reduce((sum, size) => sum + size, 0) + gap * (count - 1)
  return children.map((child) => {
    const cell = plan.cells.get(child.id)
    if (!cell) return child
    const box = localBounds(child)
    const cellW = span(plan.colSizes, cell.col, cell.colSpan, plan.colGap)
    const cellH = span(plan.rowSizes, cell.row, cell.rowSpan, plan.rowGap)
    const width =
      child.layoutSizingH === 'fill'
        ? cellW
        : child.layoutSizingH === 'relative'
          ? (cellW * clampPercent(child.layoutPercentH ?? 100)) / 100
          : Math.max(1, box.width)
    const height =
      child.layoutSizingV === 'fill'
        ? cellH
        : child.layoutSizingV === 'relative'
          ? (cellH * clampPercent(child.layoutPercentV ?? 100)) / 100
          : Math.max(1, box.height)
    return {
      ...child,
      x: plan.colStarts[cell.col],
      y: plan.rowStarts[cell.row],
      width: Math.max(1, width),
      height: Math.max(1, height),
      parentId: parent.id
    }
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
  if (layout.grid) return applyGridLayout(parent, layout, children)

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
    // Relative = % of the parent's content box (CSS percentage sizing).
    if (sizingH === 'relative') {
      const pct = clampPercent(child.layoutPercentH ?? percentFromSize(box.width, innerW))
      w = Math.max(1, (innerW * pct) / 100)
    }
    if (sizingV === 'relative') {
      const pct = clampPercent(child.layoutPercentV ?? percentFromSize(box.height, innerH))
      h = Math.max(1, (innerH * pct) / 100)
    }
    const m = marginOf(child)
    // Fill / stretch on the cross axis takes the full cross size (minus the child's margins).
    if (vertical && (sizingH === 'fill' || align === 'stretch')) w = Math.max(1, innerCross - m.l - m.r)
    if (!vertical && (sizingV === 'fill' || align === 'stretch')) h = Math.max(1, innerCross - m.t - m.b)
    // Hug/Fit children keep their intrinsic size (nested flex Fit already reflowed).
    return {
      child,
      w,
      h,
      growH: sizingH === 'fill',
      growV: sizingV === 'fill',
      m
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
      const main = Math.max(1, vertical ? item.h : item.w) + (vertical ? item.m.t + item.m.b : item.m.l + item.m.r)
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
      const lineCross = Math.max(
        1,
        ...line.map((item) => (vertical ? item.w + item.m.l + item.m.r : item.h + item.m.t + item.m.b))
      )
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
  const gap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0

  return {
    mode,
    gap,
    width: Math.max(1, spanX),
    height: Math.max(1, spanY)
  }
}

export type EnableAutoLayoutOpts = {
  mode?: 'horizontal' | 'vertical'
  wrap?: boolean
  grid?: boolean
}

/** Columns for a new grid: how many flowing children sit on the first visual row (Figma). */
export function inferGridColumns(children: DesignNode[]): number {
  const flowing = children.filter((child) => !child.layoutAbsolute && child.type !== 'comment')
  if (!flowing.length) return 2
  const boxes = flowing.map((child) => localBounds(child))
  const top = Math.min(...boxes.map((box) => box.y))
  const first = boxes.filter((box) => box.y < top + Math.max(1, box.height) / 2)
  return Math.max(1, Math.min(12, first.length))
}

function sortChildrenForAutoLayout(
  children: DesignNode[],
  mode: 'horizontal' | 'vertical'
): DesignNode[] {
  return [...children].sort((a, b) => {
    const ab = localBounds(a)
    const bb = localBounds(b)
    if (mode === 'horizontal') {
      const dx = ab.x - bb.x
      if (Math.abs(dx) > 1) return dx
      return ab.y - bb.y
    }
    const dy = ab.y - bb.y
    if (Math.abs(dy) > 1) return dy
    return ab.x - bb.x
  })
}

/**
 * Infer auto-layout for an existing frame from its children's current positions.
 * Preserves visual spacing (gap + padding) and keeps the frame size fixed so
 * enabling auto layout doesn't shrink the artboard (Figma behavior).
 */
export function inferAutoLayoutForFrame(
  frame: DesignNode,
  children: DesignNode[],
  opts?: EnableAutoLayoutOpts
): AutoLayout {
  const flowing = children.filter((child) => !child.layoutAbsolute && child.type !== 'comment')
  if (!flowing.length) {
    return {
      mode: opts?.mode || 'horizontal',
      gap: 0,
      padding: 0,
      alignItems: 'start',
      justifyContent: 'start',
      wrap: Boolean(opts?.wrap),
      sizingH: 'fixed',
      sizingV: 'fixed',
      ...(opts?.grid ? { mode: 'horizontal' as const, wrap: false, grid: { columns: 2, rows: 2 } } : {})
    }
  }

  const boxes = flowing.map((child) => localBounds(child))
  const inferred = inferAutoLayoutFromSelection(boxes)
  const mode = opts?.mode || inferred.mode
  // Recompute gap along the chosen axis (user may force vertical/horizontal).
  const ordered = sortChildrenForAutoLayout(flowing, mode)
  const gaps: number[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = localBounds(ordered[i - 1])
    const next = localBounds(ordered[i])
    const gap =
      mode === 'horizontal' ? next.x - (prev.x + prev.width) : next.y - (prev.y + prev.height)
    if (Number.isFinite(gap) && gap >= 0) gaps.push(Math.round(gap))
  }
  const gap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0

  const frameW = Math.max(1, frame.width || 0)
  const frameH = Math.max(1, frame.height || 0)
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.width))
  const maxY = Math.max(...boxes.map((box) => box.y + box.height))
  const padding = {
    t: Math.max(0, Math.round(minY)),
    l: Math.max(0, Math.round(minX)),
    r: Math.max(0, Math.round(frameW - maxX)),
    b: Math.max(0, Math.round(frameH - maxY))
  }

  if (opts?.grid) {
    return {
      mode: 'horizontal',
      gap: Math.max(0, gap),
      counterGap: Math.max(0, gap),
      padding,
      alignItems: 'start',
      justifyContent: 'start',
      wrap: false,
      sizingH: 'hug',
      sizingV: 'hug',
      grid: { columns: inferGridColumns(flowing), rows: 'auto' }
    }
  }

  return {
    mode,
    gap: Math.max(0, gap),
    padding,
    alignItems: 'start',
    justifyContent: 'start',
    wrap: Boolean(opts?.wrap),
    sizingH: 'fixed',
    sizingV: 'fixed'
  }
}

/** Enable auto layout on a frame, inferring gap/padding from current children. */
export function enableAutoLayoutOnFrame(
  nodes: DesignNode[],
  frameId: string,
  opts?: EnableAutoLayoutOpts
): DesignNode[] {
  const frame = nodes.find((node) => node.id === frameId)
  if (!frame || frame.type !== 'frame') return nodes
  if (isAutoLayout(frame)) return nodes
  const kids = childrenOf(nodes, frameId)
  const layout = inferAutoLayoutForFrame(frame, kids, opts)
  const flowing = kids.filter((child) => !child.layoutAbsolute && child.type !== 'comment')
  const absolute = kids.filter((child) => child.layoutAbsolute || child.type === 'comment')
  const ordered = [
    ...sortChildrenForAutoLayout(flowing, layout.mode === 'vertical' || layout.grid ? 'vertical' : 'horizontal'),
    ...absolute
  ]
  const kidIds = new Set(kids.map((kid) => kid.id))
  const withoutKids = nodes.filter((node) => !kidIds.has(node.id))
  const frameIndex = withoutKids.findIndex((node) => node.id === frameId)
  const insertAt = frameIndex >= 0 ? frameIndex + 1 : withoutKids.length
  const next = [
    ...withoutKids.slice(0, insertAt),
    ...ordered,
    ...withoutKids.slice(insertAt)
  ].map((node) =>
    node.id === frameId
      ? {
          ...node,
          layout,
          clipsContent: node.clipsContent !== false
        }
      : node
  )
  return reflowAutoLayout(next)
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

  // Single frame without flex → add flex layout in place (infer gap/padding)
  if (selected.length === 1 && selected[0].type === 'frame' && !isAutoLayout(selected[0])) {
    const id = selected[0].id
    return {
      nodes: enableAutoLayoutOnFrame(nodes, id),
      frameId: id
    }
  }

  // Already flex frame(s) only → no-op (caller should remove instead)
  if (selected.every((node) => node.type === 'frame' && isAutoLayout(node))) {
    return null
  }

  return wrapSelectionInFlex(nodes, selectedIds, { ...opts, name: 'Frame' })
}

/** Deep-duplicate selected nodes (and descendants), offset slightly.
 *  Nested copies keep their parent — especially auto-layout / flex children,
 *  which are inserted as the next flowing sibling inside that container. */
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

  const byId = indexById(nodes)
  const clonesByRoot = new Map<string, DesignNode[]>()
  for (const node of nodes) {
    if (!cloneIds.has(node.id)) continue
    const isRoot = roots.includes(node.id)
    const world = resolveWorldRect(node, byId)
    // Keep the original parent unless that parent is also being cloned (then map to the clone).
    const nextParentId =
      node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : node.parentId
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const stayingInSameParent = Boolean(isRoot && node.parentId && !idMap.has(node.parentId))
    const parentIsAuto = Boolean(stayingInSameParent && parent && isAutoLayout(parent))
    const clone: DesignNode = {
      ...node,
      id: idMap.get(node.id)!,
      parentId: nextParentId,
      name: isRoot ? `${node.name || node.type} copy` : node.name,
      // Auto-layout children stay in-flow inside the container (no canvas offset).
      layoutAbsolute: parentIsAuto ? false : node.layoutAbsolute,
      x: isRoot && !nextParentId ? world.x + offset : isRoot && nextParentId && !parentIsAuto ? node.x + offset : node.x,
      y: isRoot && !nextParentId ? world.y + offset : isRoot && nextParentId && !parentIsAuto ? node.y + offset : node.y,
      points: node.points?.map((point) =>
        isRoot && !parentIsAuto ? { ...point, x: point.x + offset, y: point.y + offset } : { ...point }
      )
    }
    // Attribute each clone to its selection root for insertion order.
    let rootId = node.id
    if (!isRoot) {
      let cur: DesignNode | undefined = node
      const seen = new Set<string>()
      while (cur) {
        if (roots.includes(cur.id)) {
          rootId = cur.id
          break
        }
        if (!cur.parentId || seen.has(cur.parentId) || !cloneIds.has(cur.parentId)) break
        seen.add(cur.parentId)
        cur = byId.get(cur.parentId)
      }
    }
    const list = clonesByRoot.get(rootId) || []
    list.push(clone)
    clonesByRoot.set(rootId, list)
  }

  // Insert each root's clone tree immediately after that root's subtree so flex
  // sibling order places the duplicate next to the original inside the parent.
  const out: DesignNode[] = []
  const newIds: string[] = []
  const insertedRoots = new Set<string>()
  const subtreeOf = (rootId: string) => {
    const ids = new Set<string>([rootId])
    let grew = true
    while (grew) {
      grew = false
      for (const item of nodes) {
        if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
          ids.add(item.id)
          grew = true
        }
      }
    }
    return ids
  }
  const rootSubtrees = new Map(roots.map((id) => [id, subtreeOf(id)]))

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    out.push(node)
    for (const rootId of roots) {
      if (insertedRoots.has(rootId)) continue
      const subtree = rootSubtrees.get(rootId)!
      if (!subtree.has(node.id)) continue
      // Insert after the last original subtree node.
      const restHasSubtree = nodes.slice(i + 1).some((item) => subtree.has(item.id))
      if (restHasSubtree) continue
      const clones = clonesByRoot.get(rootId) || []
      out.push(...clones)
      const mapped = idMap.get(rootId)
      if (mapped) newIds.push(mapped)
      insertedRoots.add(rootId)
    }
  }

  for (const rootId of roots) {
    if (insertedRoots.has(rootId)) continue
    const clones = clonesByRoot.get(rootId) || []
    out.push(...clones)
    const mapped = idMap.get(rootId)
    if (mapped) newIds.push(mapped)
  }

  return { nodes: out, newIds }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Collect every node under a world point (document order; top-most last). */
export function layersAtPoint(
  worldPoint: { x: number; y: number },
  nodes: DesignNode[]
): DesignNode[] {
  const hits: DesignNode[] = []
  const byId = indexById(nodes)
  for (const node of nodes) {
    if (node.type === 'comment') continue
    const box = resolveWorldRect(node, byId)
    // Test in the node's untransformed space so flipped/rotated shapes (and children of
    // flipped/rotated frames) hit where they render. Undo outermost ancestor first.
    const chain: DesignNode[] = [node]
    const seen = new Set<string>([node.id])
    let parentId = node.parentId
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      chain.unshift(parent)
      parentId = parent.parentId
    }
    let px = worldPoint.x
    let py = worldPoint.y
    for (const item of chain) {
      if (!item.rotation && !item.flipX && !item.flipY) continue
      const rect = item === node ? box : resolveWorldRect(item, byId)
      const cx = rect.x + rect.width / 2
      const cy = rect.y + rect.height / 2
      let dx = (px - cx) * (item.flipX ? -1 : 1)
      let dy = (py - cy) * (item.flipY ? -1 : 1)
      if (item.rotation) {
        const rad = (-item.rotation * Math.PI) / 180
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad)
        dy = dx * Math.sin(rad) + dy * Math.cos(rad)
        dx = rx
      }
      px = cx + dx
      py = cy + dy
    }
    if (px >= box.x && py >= box.y && px <= box.x + box.width && py <= box.y + box.height) {
      hits.push(node)
    }
  }
  return hits
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function rectContains(outer: Rect, inner: Rect, pad = 0.5): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.width <= outer.x + outer.width + pad &&
    inner.y + inner.height <= outer.y + outer.height + pad
  )
}

/**
 * Paper/Figma marquee hit list.
 * - Default: top-level only; L→R intersects, R→L contains.
 * - Deep (Ctrl/Cmd): include nested nodes. Frames/sections only when fully enclosed so a
 *   partial drag selects the elements inside, not the parent.
 */
export function marqueeSelectIds(
  nodes: DesignNode[],
  world: Rect,
  opts: { dragLeft?: boolean; deep?: boolean }
): string[] {
  const dragLeft = Boolean(opts.dragLeft)
  const deep = Boolean(opts.deep)
  const byId = indexById(nodes)

  const hits = nodes.filter((node) => {
    if (node.type === 'comment' || node.drafting) return false
    if (!deep) {
      if (node.parentId) {
        const parent = byId.get(node.parentId)
        if (parent && parent.type !== 'section') return false
      }
    }
    const bounds = resolveWorldRect(node, byId)
    // Deep: containers require full enclosure (Figma). Shallow: normal intersect/contain.
    if (deep && canParent(node)) return rectContains(world, bounds)
    return dragLeft ? rectContains(world, bounds) : rectsOverlap(world, bounds)
  })

  const hitIds = new Set(hits.map((node) => node.id))
  return hits
    .filter((node) => {
      let parentId = node.parentId
      const seen = new Set<string>()
      while (parentId) {
        if (seen.has(parentId)) break
        seen.add(parentId)
        if (hitIds.has(parentId)) return false
        parentId = byId.get(parentId)?.parentId
      }
      return true
    })
    .map((node) => node.id)
}

function ancestorDepth(node: DesignNode, byId: Map<string, DesignNode>): number {
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

/** Deepest (then smallest) node under a point — Ctrl/Cmd deep-select. */
export function pickDeepAtPoint(
  worldPoint: { x: number; y: number },
  nodes: DesignNode[]
): DesignNode | null {
  const hits = layersAtPoint(worldPoint, nodes)
  if (!hits.length) return null
  const byId = indexById(nodes)
  let best = hits[0]
  let bestDepth = ancestorDepth(best, byId)
  let bestArea = resolveWorldRect(best, byId).width * resolveWorldRect(best, byId).height
  for (let i = 1; i < hits.length; i++) {
    const node = hits[i]
    const depth = ancestorDepth(node, byId)
    const box = resolveWorldRect(node, byId)
    const area = box.width * box.height
    if (depth > bestDepth || (depth === bestDepth && area <= bestArea)) {
      best = node
      bestDepth = depth
      bestArea = area
    }
  }
  return best
}

/**
 * Single-click target (Figma): prefer the top-level frame when nothing is
 * selected. With an ancestor selected, advance one level toward the hit.
 * Sibling clicks stay at the same depth under a shared parent.
 */
export function resolveClickTarget(
  hit: DesignNode,
  nodes: DesignNode[],
  selectedIds: string[]
): string {
  const byId = indexById(nodes)
  const selected = new Set(selectedIds)
  const chain: DesignNode[] = []
  let cur: DesignNode | undefined = hit
  const seen = new Set<string>()
  while (cur) {
    chain.push(cur)
    if (!cur.parentId || seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  if (!chain.length) return hit.id

  const selectedIdx = chain.findIndex((node) => selected.has(node.id))
  // Already on the hit — keep it.
  if (selectedIdx === 0) return hit.id
  // Ancestor selected (Figma): one level deeper toward the hit so nested
  // objects are selectable without requiring a double-click first.
  if (selectedIdx > 0) return chain[selectedIdx - 1].id

  // Sibling of the current selection under the same parent → select that sibling.
  for (const selId of selectedIds) {
    const sel = byId.get(selId)
    if (!sel?.parentId) continue
    const parentIdx = chain.findIndex((node) => node.id === sel.parentId)
    if (parentIdx > 0) return chain[parentIdx - 1].id
    if (parentIdx === 0) return hit.id
  }

  // Nothing relevant selected → outermost layer under the cursor.
  return chain[chain.length - 1]?.id || hit.id
}

/**
 * Double-click drill: move one level deeper from the selected ancestor toward the hit.
 * If nothing in the chain is selected, enter one level below the top-level node.
 */
export function resolveDrillIn(
  hit: DesignNode,
  nodes: DesignNode[],
  selectedIds: string[]
): string | null {
  const byId = indexById(nodes)
  const selected = new Set(selectedIds)
  const chain: DesignNode[] = []
  let cur: DesignNode | undefined = hit
  const seen = new Set<string>()
  while (cur) {
    chain.push(cur)
    if (!cur.parentId || seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  if (chain.length < 2) return null

  const selectedIdx = chain.findIndex((node) => selected.has(node.id))
  if (selectedIdx === 0) return null
  if (selectedIdx > 0) return chain[selectedIdx - 1].id
  // Top-level not selected yet — drill from root into its child toward the hit.
  return chain[chain.length - 2]?.id || null
}

/** @deprecated Prefer resolveClickTarget / resolveDrillIn */
export function resolveDrillTarget(
  hit: DesignNode,
  nodes: DesignNode[],
  selectedIds: string[]
): string {
  return resolveClickTarget(hit, nodes, selectedIds)
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
  if (layout.grid) {
    const plan = planGrid(layout, flowing, current, { h: false, v: false })
    const sum = (sizes: number[]) => sizes.reduce((total, size) => total + size, 0)
    return {
      width: Math.max(1, pad.l + pad.r + sum(plan.colSizes) + plan.colGap * Math.max(0, plan.columns - 1)),
      height: Math.max(1, pad.t + pad.b + sum(plan.rowSizes) + plan.rowGap * Math.max(0, plan.rows - 1))
    }
  }
  // Hug measures each child's margin box (CSS).
  const sizes = flowing.map((child) => {
    const box = localBounds(child)
    const m = marginOf(child)
    return { w: Math.max(1, box.width) + m.l + m.r, h: Math.max(1, box.height) + m.t + m.b }
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

/** Reflow every auto-layout frame in the document (deepest first so nested hug works).
 *  A few extra passes propagate Fill/Relative through nested flex after an outer size change. */
export function reflowAutoLayout(nodes: DesignNode[]): DesignNode[] {
  if (!nodes.some((node) => isAutoLayout(node))) return nodes

  const depthOf = (node: DesignNode, byId: Map<string, DesignNode>): number => {
    let d = 0
    let cur: DesignNode | undefined = node
    const seen = new Set<string>()
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) break
      seen.add(cur.parentId)
      d += 1
      cur = byId.get(cur.parentId)
      if (!cur) break
    }
    return d
  }

  /** Cheap stability check — only auto-layout frames and their direct children matter. */
  const layoutSignature = (
    byId: Map<string, DesignNode>,
    frameIds: string[],
    kidsByParent: Map<string, DesignNode[]>
  ) => {
    let sig = ''
    for (const id of frameIds) {
      const frame = byId.get(id)
      if (!frame) continue
      sig += `${id}:${frame.x},${frame.y},${frame.width},${frame.height};`
      const kids = kidsByParent.get(id)
      if (!kids) continue
      for (const kid of kids) {
        const live = byId.get(kid.id) || kid
        sig += `${live.id}:${live.x},${live.y},${live.width},${live.height};`
      }
    }
    return sig
  }

  let next = nodes
  const byId0 = indexById(next)
  let maxDepth = 0
  const frameIds: string[] = []
  for (const node of next) {
    if (!isAutoLayout(node)) continue
    frameIds.push(node.id)
    maxDepth = Math.max(maxDepth, depthOf(node, byId0))
  }
  if (!frameIds.length) return nodes

  // Nested Fill only needs depth+1 passes; hard-cap so large docs stay snappy.
  const maxPasses = Math.min(6, maxDepth + 2)

  for (let pass = 0; pass < maxPasses; pass++) {
    const byId = indexById(next)
    const kidsByParent = new Map<string, DesignNode[]>()
    for (const node of next) {
      if (!node.parentId) continue
      const list = kidsByParent.get(node.parentId)
      if (list) list.push(node)
      else kidsByParent.set(node.parentId, [node])
    }

    const frames = frameIds
      .map((id) => byId.get(id))
      .filter((node): node is DesignNode => Boolean(node && isAutoLayout(node)))
      .sort((a, b) => depthOf(b, byId) - depthOf(a, byId))

    const before = layoutSignature(byId, frameIds, kidsByParent)
    const updates = new Map<string, DesignNode>()

    for (const frame of frames) {
      const parent = updates.get(frame.id) || byId.get(frame.id) || frame
      const layout = parent.layout!
      const kids = (kidsByParent.get(frame.id) || []).map((kid) => updates.get(kid.id) || kid)
      if (!kids.length) continue

      const childFillH = kids.some((child) => !child.layoutAbsolute && child.layoutSizingH === 'fill')
      const childFillV = kids.some((child) => !child.layoutAbsolute && child.layoutSizingV === 'fill')
      const childRelH = kids.some((child) => !child.layoutAbsolute && child.layoutSizingH === 'relative')
      const childRelV = kids.some((child) => !child.layoutAbsolute && child.layoutSizingV === 'relative')

      let sizingH = layout.sizingH || 'fixed'
      let sizingV = layout.sizingV || 'fixed'
      // Grid Fill children fill their cell, not the frame, so Hug stays valid.
      if (!layout.grid && (childFillH || childRelH) && sizingH === 'hug') sizingH = 'fixed'
      if (!layout.grid && (childFillV || childRelV) && sizingV === 'hug') sizingV = 'fixed'
      const hugH = sizingH === 'hug'
      const hugV = sizingV === 'hug'

      let nextParent = parent
      if (hugH || hugV || sizingH !== (layout.sizingH || 'fixed') || sizingV !== (layout.sizingV || 'fixed')) {
        const measured = measureHugSize(
          { ...layout, sizingH, sizingV },
          kids,
          { width: parent.width, height: parent.height }
        )
        nextParent = {
          ...parent,
          width: hugH ? measured.width : parent.width,
          height: hugV ? measured.height : parent.height,
          layout: { ...layout, sizingH, sizingV }
        }
      }

      const patched = applyAutoLayout(nextParent, kids)
      // Only record real geometry changes so untouched nodes keep their identity (cheap re-renders).
      if (
        nextParent !== parent &&
        (nextParent.width !== parent.width ||
          nextParent.height !== parent.height ||
          nextParent.layout?.sizingH !== parent.layout?.sizingH ||
          nextParent.layout?.sizingV !== parent.layout?.sizingV)
      ) {
        updates.set(nextParent.id, nextParent)
      }
      for (let i = 0; i < patched.length; i++) {
        const child = patched[i]
        const before = kids[i]
        if (
          child !== before &&
          (child.x !== before.x ||
            child.y !== before.y ||
            child.width !== before.width ||
            child.height !== before.height ||
            child.parentId !== before.parentId)
        ) {
          updates.set(child.id, child)
        }
      }
    }

    if (!updates.size) break
    next = next.map((node) => updates.get(node.id) || node)

    const byIdAfter = indexById(next)
    const kidsAfter = new Map<string, DesignNode[]>()
    for (const node of next) {
      if (!node.parentId) continue
      const list = kidsAfter.get(node.parentId)
      if (list) list.push(node)
      else kidsAfter.set(node.parentId, [node])
    }
    if (layoutSignature(byIdAfter, frameIds, kidsAfter) === before) break
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
    gap: 0,
    padding: 0,
    alignItems: 'start',
    justifyContent: 'start',
    wrap: false,
    sizingH: 'fixed',
    sizingV: 'fixed'
  }
}

/** Move selected flex siblings earlier/later in order (Figma arrow-key reorder). */
export function reorderFlexByDelta(
  nodes: DesignNode[],
  selectedIds: string[],
  delta: number
): DesignNode[] | null {
  if (!delta || !selectedIds.length) return null
  const selected = new Set(selectedIds)
  const roots = selectedIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is DesignNode => Boolean(node))
    .filter((node) => !node.parentId || !selected.has(node.parentId))
  if (!roots.length) return null
  const parentId = roots[0].parentId
  if (!parentId || roots.some((node) => node.parentId !== parentId)) return null
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent || !isAutoLayout(parent)) return null

  const kids = childrenOf(nodes, parentId).filter((node) => !node.layoutAbsolute)
  const indices = kids.map((node, index) => (selected.has(node.id) ? index : -1)).filter((index) => index >= 0)
  if (!indices.length || indices.length === kids.length) return null

  const moving = indices.map((index) => kids[index])
  const rest = kids.filter((node) => !selected.has(node.id))
  const first = indices[0]
  const baseInRest = kids.slice(0, first).filter((node) => !selected.has(node.id)).length
  const insertAt = Math.max(0, Math.min(rest.length, baseInRest + delta))
  if (insertAt === baseInRest) return null

  const ordered = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)]
  const kidIds = new Set(kids.map((node) => node.id))
  const result: DesignNode[] = []
  let inserted = false
  for (const node of nodes) {
    if (!kidIds.has(node.id)) {
      result.push(node)
      continue
    }
    if (!inserted) {
      result.push(...ordered)
      inserted = true
    }
  }
  return result
}
