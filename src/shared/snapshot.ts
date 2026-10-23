import type { AutoLayout, DesignNode, LayoutSizing } from './types'
import type { Paint } from './paint'
import { applyAutoLayout } from './layoutEngine'

/** Element captured from a live browser, in Paper Snapshot shape. */
export type SnapshotFill =
  | { type: 'solid'; hex: string; opacity: number }
  | { type: 'image'; dataUrl: string }
  | {
      type: 'linear'
      angle: number
      stops: Array<{ hex: string; opacity: number; position: number }>
    }

export type SnapshotShadow = {
  x: number
  y: number
  blur: number
  spread: number
  hex: string
  opacity: number
  inset?: boolean
}

export type SnapshotNode = {
  kind: 'frame' | 'text' | 'image'
  tag: string
  name: string
  x: number
  y: number
  width: number
  height: number
  opacity?: number
  radius?: number
  cornerRadii?: { tl: number; tr: number; br: number; bl: number }
  fill?: SnapshotFill | null
  /** Text color when `kind` is text. */
  color?: { hex: string; opacity: number } | null
  stroke?: { hex: string; opacity: number } | null
  strokeWidth?: number
  text?: string
  fontFamily?: string
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textAlignVertical?: 'top' | 'middle' | 'bottom'
  textDecoration?: 'none' | 'underline' | 'line-through'
  /** e.g. `"FILL" 1, "wght" 400` for Material Symbols glyph icons. */
  fontVariationSettings?: string
  /** Text node is an icon-font glyph (ligature or private-use codepoint). */
  iconGlyph?: boolean
  /** Sanitized, scalable SVG markup for vector icons. */
  svg?: string
  shadow?: SnapshotShadow | null
  layerBlur?: number
  backgroundBlur?: number
  /** CSS flow of the element, used to rebuild auto layout on import. */
  flow?: SnapshotFlow | null
  /** `position: absolute | fixed` — sits outside its parent's flow. */
  abs?: boolean
  /** `flex-grow > 0` */
  grow?: boolean
  children: SnapshotNode[]
}

export type SnapshotFlow = {
  kind: 'flex' | 'block' | 'grid'
  dir?: 'row' | 'column'
  reverse?: boolean
  wrap?: boolean
  justify?: string
  /** Padding + border, in CSS px. */
  pad: { t: number; r: number; b: number; l: number }
}

export type SnapshotEvent =
  | { tabId: string; tree: SnapshotNode }
  | { tabId: string; cancelled: true }
  | { tabId: string; error: string }

function paintsFromFill(fill: SnapshotFill | null | undefined, nextId: () => string): Paint[] | undefined {
  if (!fill) return undefined
  if (fill.type === 'solid') {
    return [{ type: 'solid', color: fill.hex, opacity: fill.opacity, visible: true }]
  }
  if (fill.type === 'image' && fill.dataUrl) {
    return [{ type: 'image', imageDataUrl: fill.dataUrl, scaleMode: 'crop', opacity: 1, visible: true }]
  }
  if (fill.type === 'linear' && fill.stops.length >= 2) {
    return [
      {
        type: 'gradient',
        gradientKind: 'linear',
        angle: fill.angle,
        opacity: 1,
        visible: true,
        stops: fill.stops.map((stop) => ({
          id: nextId(),
          position: stop.position,
          color: stop.hex,
          opacity: stop.opacity
        }))
      }
    ]
  }
  return undefined
}

function applyCommon(node: DesignNode, snap: SnapshotNode): DesignNode {
  if (snap.opacity != null && snap.opacity < 0.999) node.opacity = Math.max(0, Math.min(1, snap.opacity))
  if (snap.radius && snap.radius > 0) node.radius = Math.round(snap.radius * 10) / 10
  if (snap.cornerRadii) {
    const round = (n: number) => Math.round(n * 10) / 10
    node.cornerRadii = {
      tl: round(snap.cornerRadii.tl),
      tr: round(snap.cornerRadii.tr),
      br: round(snap.cornerRadii.br),
      bl: round(snap.cornerRadii.bl)
    }
    node.radius = node.cornerRadii.tl
  }
  if (snap.stroke && snap.strokeWidth && snap.strokeWidth > 0) {
    node.stroke = snap.stroke.hex
    node.strokeOpacity = snap.stroke.opacity
    node.strokeWidth = snap.strokeWidth
    node.strokeAlign = 'inside'
  }
  if (snap.shadow && snap.shadow.inset && snap.shadow.blur + Math.abs(snap.shadow.x) + Math.abs(snap.shadow.y) > 0) {
    node.shadow = true
    node.shadowType = 'inner'
    node.shadowX = snap.shadow.x
    node.shadowY = snap.shadow.y
    node.shadowBlur = snap.shadow.blur
    node.shadowSpread = snap.shadow.spread
    node.shadowColor = snap.shadow.hex
    node.shadowOpacity = snap.shadow.opacity
  }
  if (snap.layerBlur && snap.layerBlur > 0) node.layerBlur = snap.layerBlur
  if (snap.backgroundBlur && snap.backgroundBlur > 0) node.backgroundBlur = snap.backgroundBlur
  return node
}

type LayoutPlan = {
  layout: AutoLayout
  /** Children in flow order (flowing first, by main-axis position), then absolutes. */
  order: SnapshotNode[]
  sizing: Map<SnapshotNode, { h?: LayoutSizing; v?: LayoutSizing; span?: number; margin?: Margin }>
  absolute: Set<SnapshotNode>
}

/** Max px a child may move when rebuilt as auto layout: exact first, then a near-exact retry. */
const STRICT_TOLERANCE = 1.5
const LOOSE_TOLERANCE = 3
let LAYOUT_TOLERANCE = STRICT_TOLERANCE

const roundedBox = (snap: SnapshotNode) => ({
  x: Math.round(snap.x || 0),
  y: Math.round(snap.y || 0),
  w: Math.max(1, Math.round(snap.width || 0)),
  h: Math.max(1, Math.round(snap.height || 0))
})

/**
 * Rebuild Paper-style auto layout for a captured frame. The plan is only kept when
 * Vanta's layout engine puts every child back where the browser rendered it, so a
 * snapshot never shifts — frames that can't be expressed stay absolutely placed.
 */
function planLayout(snap: SnapshotNode): LayoutPlan | null {
  const flow = snap.flow
  const kids = snap.children || []
  if (!flow || !kids.length) return null
  if (flow.kind === 'flex' && flow.reverse) return null
  // Overlays (a badge on a thumbnail, a play button on a card) sit on top of a sibling —
  // they become Absolute position so the rest can still flow.
  const overlays = new Set(kids.filter((kid) => !kid.abs && kids.some((other) => other !== kid && covers(other, kid))))
  const flowing = kids.filter((kid) => !kid.abs && !overlays.has(kid))
  if (!flowing.length) return null
  const absolute = new Set(kids.filter((kid) => kid.abs || overlays.has(kid)))
  try {
    for (const tolerance of [STRICT_TOLERANCE, LOOSE_TOLERANCE]) {
      LAYOUT_TOLERANCE = tolerance
      // Wrapping rows and CSS grids become Vanta grids (arrow keys move cells / rows, like Paper).
      if (flow.kind === 'grid' || (flow.kind === 'flex' && flow.wrap) || flowing.length >= 4) {
        const grid = planGridLayout(snap, flow, flowing)
        if (grid) return { ...grid, order: [...grid.order, ...absolute], absolute }
      }
      if (flow.kind === 'grid') continue
      for (const mode of flowModes(flow)) {
        const plan = planMode(snap, flow, flowing, mode)
        if (plan) return { ...plan, order: [...plan.order, ...absolute], absolute }
      }
    }
    const modes = flowModes(flow)
    // Uneven spacing / mixed alignment: keep the flex frame and carry the difference as
    // per-child margins (what the page's CSS does) — exact, like Paper.
    LAYOUT_TOLERANCE = STRICT_TOLERANCE
    if (flow.kind !== 'grid') {
      for (const mode of modes) {
        const plan = planStack(snap, flow, flowing, mode)
        if (plan) return { ...plan, order: [...plan.order, ...absolute], absolute }
      }
    }
    return null
  } finally {
    LAYOUT_TOLERANCE = STRICT_TOLERANCE
  }
}

function flowModes(flow: SnapshotFlow): Array<'horizontal' | 'vertical'> {
  return flow.kind === 'flex' ? [flow.dir === 'column' ? 'vertical' : 'horizontal'] : ['vertical', 'horizontal']
}

/**
 * Children in sequence along one axis with uneven gaps or mixed cross offsets. The smallest gap
 * becomes the frame's gap; each child's extra spacing and cross offset become its margins.
 */
function planStack(
  snap: SnapshotNode,
  flow: SnapshotFlow,
  flowing: SnapshotNode[],
  mode: 'horizontal' | 'vertical'
): Omit<LayoutPlan, 'absolute'> | null {
  const vertical = mode === 'vertical'
  const W = Math.max(1, Math.round(snap.width || 0))
  const H = Math.max(1, Math.round(snap.height || 0))
  const boxes = flowing.map((kid) => ({ snap: kid, ...roundedBox(kid) }))
  const main = (b: (typeof boxes)[number]) => (vertical ? b.y : b.x)
  const mainSize = (b: (typeof boxes)[number]) => (vertical ? b.h : b.w)
  const cross = (b: (typeof boxes)[number]) => (vertical ? b.x : b.y)
  const crossSize = (b: (typeof boxes)[number]) => (vertical ? b.w : b.h)
  const sorted = [...boxes].sort((a, b) => main(a) - main(b))
  const gaps: number[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    // Items must still come one after another; small overlaps (tall text line boxes) become negative margins.
    const prevEnd = main(sorted[i]) + mainSize(sorted[i])
    const nextEnd = main(sorted[i + 1]) + mainSize(sorted[i + 1])
    if (main(sorted[i + 1]) < main(sorted[i]) + LAYOUT_TOLERANCE || nextEnd < prevEnd + LAYOUT_TOLERANCE) return null
    gaps.push(main(sorted[i + 1]) - prevEnd)
  }
  const outerMain = vertical ? H : W
  const outerCross = vertical ? W : H
  const css = flow.pad
  const cssMainStart = vertical ? css.t : css.l
  const cssMainEnd = vertical ? css.b : css.r
  const cssCrossStart = vertical ? css.l : css.t
  const cssCrossEnd = vertical ? css.r : css.b
  const lead = Math.max(0, main(sorted[0]))
  const last = sorted[sorted.length - 1]
  const trail = Math.max(0, outerMain - (main(last) + mainSize(last)))
  const gap = gaps.length ? Math.max(0, Math.min(...gaps)) : 0
  const padMainStart = Math.max(0, Math.min(cssMainStart, lead))
  const padMainEnd = Math.max(0, Math.min(cssMainEnd, trail))
  const minCross = Math.min(...boxes.map(cross))
  const padCrossStart = Math.max(0, Math.min(cssCrossStart, minCross))
  const padCrossEnd = Math.max(0, Math.min(cssCrossEnd, outerCross - Math.max(...boxes.map((b) => cross(b) + crossSize(b)))))
  const innerCross = outerCross - padCrossStart - padCrossEnd

  const sizing = new Map<SnapshotNode, { h?: LayoutSizing; v?: LayoutSizing; margin?: Margin }>()
  sorted.forEach((box, index) => {
    const leadSpace = index === 0 ? lead - padMainStart : gaps[index - 1] - gap
    const crossStart = Math.max(0, cross(box) - padCrossStart)
    const margin: Margin = vertical
      ? { t: index === 0 ? Math.max(0, leadSpace) : leadSpace, r: 0, b: 0, l: crossStart }
      : { t: crossStart, r: 0, b: 0, l: index === 0 ? Math.max(0, leadSpace) : leadSpace }
    // Blocks that run to the far edge read as Fill (full-width rows, like Paper).
    const fill = innerCross > 0 && Math.abs(crossStart + crossSize(box) - innerCross) <= LAYOUT_TOLERANCE && crossStart <= LAYOUT_TOLERANCE
    const entry: { h?: LayoutSizing; v?: LayoutSizing; margin?: Margin } = {}
    if (margin.t || margin.l) entry.margin = margin
    if (fill) {
      if (vertical) entry.h = 'fill'
      else entry.v = 'fill'
    }
    if (entry.margin || entry.h || entry.v) sizing.set(box.snap, entry)
  })
  // Hug only when the content really ends inside the frame (overflowing/clipped content stays fixed).
  const rawTrail = outerMain - (main(last) + mainSize(last))
  const mainHug = rawTrail >= -LAYOUT_TOLERANCE && Math.abs(trail - cssMainEnd) <= LAYOUT_TOLERANCE
  const layout: AutoLayout = {
    mode,
    gap: Math.round(gap * 100) / 100,
    padding: vertical
      ? { t: padMainStart, r: padCrossEnd, b: padMainEnd, l: padCrossStart }
      : { t: padCrossStart, r: padMainEnd, b: padCrossEnd, l: padMainStart },
    alignItems: 'start',
    justifyContent: 'start',
    sizingH: vertical ? 'fixed' : mainHug ? 'hug' : 'fixed',
    sizingV: vertical ? (mainHug ? 'hug' : 'fixed') : 'fixed'
  }
  if (!verifyLayout(W, H, layout, sorted, sizing)) return null
  return { layout, order: sorted.map((box) => box.snap), sizing }
}

type Margin = { t: number; r: number; b: number; l: number }

/** `outer` fully contains `inner` (and is bigger), i.e. `inner` is painted on top of it. */
function covers(outer: SnapshotNode, inner: SnapshotNode): boolean {
  const a = roundedBox(outer)
  const b = roundedBox(inner)
  if (a.w * a.h <= b.w * b.h) return false
  const slack = LOOSE_TOLERANCE
  return b.x >= a.x - slack && b.y >= a.y - slack && b.x + b.w <= a.x + a.w + slack && b.y + b.h <= a.y + a.h + slack
}

/**
 * Rows × columns with uniform gaps (CSS grid, flex-wrap card grids) → Vanta grid layout with
 * fixed tracks. Only kept when the engine places every cell back where the browser had it.
 */
function planGridLayout(
  snap: SnapshotNode,
  flow: SnapshotFlow,
  flowing: SnapshotNode[]
): Omit<LayoutPlan, 'absolute'> | null {
  const W = Math.max(1, Math.round(snap.width || 0))
  const H = Math.max(1, Math.round(snap.height || 0))
  const boxes = flowing
    .map((kid) => ({ snap: kid, ...roundedBox(kid) }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: Array<typeof boxes> = []
  for (const box of boxes) {
    const row = rows[rows.length - 1]
    if (row && Math.abs(box.y - row[0].y) <= LAYOUT_TOLERANCE) row.push(box)
    else rows.push([box])
  }
  if (rows.length < 2) return null
  for (const row of rows) row.sort((a, b) => a.x - b.x)
  const columns = Math.max(...rows.map((row) => row.length))
  if (columns < 2) return null
  const full = rows.find((row) => row.length === columns)!
  const colStarts = full.map((box) => box.x)
  const near = (a: number, b: number) => Math.abs(a - b) <= LAYOUT_TOLERANCE
  const cellRows = rows.filter((row) => row.length > 1 || near(row[0].w, full[0].w))
  const colWidths = colStarts.map((_, col) => Math.max(...cellRows.map((row) => (row[col] ? row[col].w : 0))))
  const spanWidth = colStarts[columns - 1] + colWidths[columns - 1] - colStarts[0]
  // Full-width rows (YouTube shelves like "Top news") span every column; only the last row may be short.
  const spans = new Set<SnapshotNode>()
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && near(row[0].x, colStarts[0]) && row[0].w >= spanWidth - LAYOUT_TOLERANCE && columns > 1) {
      spans.add(row[0].snap)
      continue
    }
    if (row.length !== columns && r !== rows.length - 1) return null
    if (row.some((box, col) => !near(box.x, colStarts[col]))) return null
  }
  const rowStarts = rows.map((row) => row[0].y)
  const rowHeights = rows.map((row) => Math.max(...row.map((box) => box.h)))
  const gapsBetween = (starts: number[], sizes: number[]) =>
    starts.slice(1).map((start, i) => start - (starts[i] + sizes[i]))
  const colGaps = gapsBetween(colStarts, colWidths)
  const rowGaps = gapsBetween(rowStarts, rowHeights)
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  const colGap = mean(colGaps)
  const rowGap = mean(rowGaps)
  if (colGap < -LAYOUT_TOLERANCE || rowGap < -LAYOUT_TOLERANCE) return null
  if (colGaps.some((gap) => Math.abs(gap - colGap) > LAYOUT_TOLERANCE)) return null
  if (rowGaps.some((gap) => Math.abs(gap - rowGap) > LAYOUT_TOLERANCE)) return null

  const ordered = rows.flat()
  const layout: AutoLayout = {
    mode: 'horizontal',
    gap: Math.round(Math.max(0, colGap) * 100) / 100,
    counterGap: Math.round(Math.max(0, rowGap) * 100) / 100,
    padding: {
      t: Math.max(0, rowStarts[0]),
      l: Math.max(0, colStarts[0]),
      r: Math.max(0, Math.min(flow.pad.r, W - (colStarts[columns - 1] + colWidths[columns - 1]))),
      b: Math.max(0, Math.min(flow.pad.b, H - (rowStarts[rows.length - 1] + rowHeights[rows.length - 1])))
    },
    alignItems: 'start',
    justifyContent: 'start',
    sizingH: 'fixed',
    sizingV: 'fixed',
    grid: { columns, rows: 'auto', columnTracks: colWidths, rowTracks: rowHeights }
  }
  // Cards that fill their cell read as Fill (Paper's badge), the rest keep their size.
  const sizing = new Map<SnapshotNode, { h?: LayoutSizing; v?: LayoutSizing; span?: number }>()
  rows.forEach((row, r) =>
    row.forEach((box, c) => {
      const spanning = spans.has(box.snap)
      const cellWidth = spanning ? spanWidth : colWidths[c]
      const h = near(box.w, cellWidth) ? 'fill' : undefined
      const v = near(box.h, rowHeights[r]) ? 'fill' : undefined
      if (h || v || spanning) sizing.set(box.snap, { h, v, span: spanning ? columns : undefined })
    })
  )
  if (!verifyLayout(W, H, layout, ordered, sizing)) return null
  return { layout, order: ordered.map((box) => box.snap), sizing }
}

function planMode(
  snap: SnapshotNode,
  flow: SnapshotFlow,
  flowing: SnapshotNode[],
  mode: 'horizontal' | 'vertical'
): Omit<LayoutPlan, 'absolute'> | null {
  const vertical = mode === 'vertical'
  const W = Math.max(1, Math.round(snap.width || 0))
  const H = Math.max(1, Math.round(snap.height || 0))
  const boxes = flowing.map((kid) => ({ snap: kid, ...roundedBox(kid) }))
  const main = (b: (typeof boxes)[number]) => (vertical ? b.y : b.x)
  const mainSize = (b: (typeof boxes)[number]) => (vertical ? b.h : b.w)
  const cross = (b: (typeof boxes)[number]) => (vertical ? b.x : b.y)
  const crossSize = (b: (typeof boxes)[number]) => (vertical ? b.w : b.h)
  const sorted = [...boxes].sort((a, b) => main(a) - main(b))
  const gaps: number[] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const gap = main(sorted[i + 1]) - (main(sorted[i]) + mainSize(sorted[i]))
    if (gap < -LAYOUT_TOLERANCE) return null
    gaps.push(gap)
  }
  const meanGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0
  if (gaps.some((gap) => Math.abs(gap - meanGap) > LAYOUT_TOLERANCE)) return null

  const outerMain = vertical ? H : W
  const outerCross = vertical ? W : H
  const css = flow.pad
  const cssMainEnd = vertical ? css.b : css.r
  const cssCrossStart = vertical ? css.l : css.t
  const cssCrossEnd = vertical ? css.r : css.b
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const lead = Math.max(0, main(first))
  const trail = Math.max(0, outerMain - (main(last) + mainSize(last)))
  const cssMainStart = vertical ? css.t : css.l
  const near = (a: number, b: number) => Math.abs(a - b) <= LAYOUT_TOLERANCE
  type Justify = NonNullable<AutoLayout['justifyContent']>
  const justifies: Array<{ justify: Justify; start: number; end: number }> = []
  if (flow.justify === 'space-between' && sorted.length > 1) {
    justifies.push({ justify: 'space-between', start: lead, end: trail })
  } else {
    const startSlack = lead - cssMainStart
    const endSlack = trail - cssMainEnd
    // Prefer the alignment that explains the free space (centered labels, right-aligned actions).
    if (startSlack > LAYOUT_TOLERANCE && near(startSlack, endSlack)) {
      justifies.push({ justify: 'center', start: cssMainStart, end: cssMainEnd })
    } else if (startSlack > LAYOUT_TOLERANCE && near(endSlack, 0)) {
      justifies.push({ justify: 'end', start: cssMainStart, end: trail })
    }
    justifies.push({ justify: 'start', start: lead, end: Math.max(0, Math.min(cssMainEnd, trail)) })
  }

  const minCross = Math.min(...boxes.map(cross))
  const maxCrossEnd = Math.max(...boxes.map((b) => cross(b) + crossSize(b)))
  type Align = NonNullable<AutoLayout['alignItems']>
  const aligns: Array<{ align: Align; start: number; end: number }> = []
  const allStart = boxes.every((b) => near(cross(b), minCross))
  const allCenter = boxes.every((b) => near(cross(b) + crossSize(b) / 2, outerCross / 2))
  const allEnd = boxes.every((b) => near(cross(b) + crossSize(b), maxCrossEnd))
  const startAlign = { align: 'start' as Align, start: Math.max(0, minCross), end: Math.max(0, Math.min(cssCrossEnd, outerCross - maxCrossEnd)) }
  const even = Math.abs(cssCrossStart - cssCrossEnd) <= 1
  const centerAlign = { align: 'center' as Align, start: even ? cssCrossStart : 0, end: even ? cssCrossEnd : 0 }
  const endAlign = { align: 'end' as Align, start: Math.max(0, Math.min(cssCrossStart, minCross)), end: Math.max(0, outerCross - maxCrossEnd) }
  // Content sitting off the padding edge but centered reads as "center", not a big inset.
  if (allCenter && !near(minCross, cssCrossStart)) aligns.push(centerAlign)
  if (allStart) aligns.push(startAlign)
  if (allCenter && near(minCross, cssCrossStart)) aligns.push(centerAlign)
  if (allEnd) aligns.push(endAlign)
  if (!aligns.length) return null

  const growers = flow.kind === 'flex' ? sorted.filter((b) => b.snap.grow) : []
  for (const { justify, start: mainStart, end: mainEnd } of justifies)
  for (const { align, start, end } of aligns) {
    const innerCross = outerCross - start - end
    const crossFill = new Set(
      sorted.filter((b) => innerCross > 0 && Math.abs(crossSize(b) - innerCross) <= LAYOUT_TOLERANCE).map((b) => b.snap)
    )
    for (const useGrow of growers.length ? [true, false] : [false]) {
      const mainFill = new Set(useGrow ? growers.map((b) => b.snap) : [])
      const padding = vertical
        ? { t: mainStart, r: end, b: mainEnd, l: start }
        : { t: start, r: mainEnd, b: end, l: mainStart }
      const fitsMain = outerMain - (main(last) + mainSize(last)) >= -LAYOUT_TOLERANCE
      const mainHug = fitsMain && !mainFill.size && justify === 'start' && near(trail, cssMainEnd)
      const crossHug = !crossFill.size && align === 'start' && near(outerCross - maxCrossEnd, cssCrossEnd)
      const layout: AutoLayout = {
        mode,
        gap: justify === 'space-between' ? 'auto' : Math.round(Math.max(0, meanGap) * 100) / 100,
        padding,
        alignItems: align,
        justifyContent: justify,
        sizingH: (vertical ? crossHug : mainHug) ? 'hug' : 'fixed',
        sizingV: (vertical ? mainHug : crossHug) ? 'hug' : 'fixed'
      }
      const sizing = new Map<SnapshotNode, { h?: LayoutSizing; v?: LayoutSizing }>()
      for (const b of sorted) {
        const onMain = mainFill.has(b.snap)
        const onCross = crossFill.has(b.snap)
        if (!onMain && !onCross) continue
        sizing.set(
          b.snap,
          vertical
            ? { h: onCross ? 'fill' : undefined, v: onMain ? 'fill' : undefined }
            : { h: onMain ? 'fill' : undefined, v: onCross ? 'fill' : undefined }
        )
      }
      if (verifyLayout(W, H, layout, sorted, sizing)) {
        return { layout, order: sorted.map((b) => b.snap), sizing }
      }
    }
  }
  return null
}

function verifyLayout(
  W: number,
  H: number,
  layout: AutoLayout,
  boxes: Array<{ snap: SnapshotNode; x: number; y: number; w: number; h: number }>,
  sizing: LayoutPlan['sizing']
): boolean {
  const parent = { id: '__snap', type: 'frame', x: 0, y: 0, width: W, height: H, layout } as DesignNode
  const kids = boxes.map(
    (b, index) =>
      ({
        id: `__kid${index}`,
        type: 'frame',
        x: b.x,
        y: b.y,
        width: b.w,
        height: b.h,
        parentId: parent.id,
        layoutSizingH: sizing.get(b.snap)?.h,
        layoutSizingV: sizing.get(b.snap)?.v,
        gridColumnSpan: sizing.get(b.snap)?.span,
        layoutMargin: sizing.get(b.snap)?.margin
      }) as DesignNode
  )
  const placed = applyAutoLayout(parent, kids)
  return placed.every((node, index) => {
    const b = boxes[index]
    return (
      Math.abs(node.x - b.x) <= LAYOUT_TOLERANCE &&
      Math.abs(node.y - b.y) <= LAYOUT_TOLERANCE &&
      Math.abs((node.width ?? 0) - b.w) <= LAYOUT_TOLERANCE &&
      Math.abs((node.height ?? 0) - b.h) <= LAYOUT_TOLERANCE
    )
  })
}

/** Turn a captured DOM tree into parent-relative design nodes. */
export function importSnapshot(
  tree: SnapshotNode,
  place: { x: number; y: number; pageId: string },
  nextId: () => string
): { nodes: DesignNode[]; rootId: string } {
  const nodes: DesignNode[] = []
  const byId = new Map<string, DesignNode>()

  const visit = (snap: SnapshotNode, parentId: string | undefined): string | null => {
    const width = Math.max(1, Math.round(snap.width || 0))
    const height = Math.max(1, Math.round(snap.height || 0))
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    const id = nextId()
    const x = parentId ? Math.round(snap.x || 0) : place.x
    const y = parentId ? Math.round(snap.y || 0) : place.y
    const name = (snap.name || snap.tag || 'Layer').slice(0, 64)

    if (snap.kind === 'text') {
      const color = snap.color
      const node: DesignNode = applyCommon(
        {
          id,
          type: 'text',
          x,
          y,
          width,
          height,
          parentId,
          pageId: place.pageId,
          name: snap.iconGlyph ? `${(snap.text || 'icon').slice(0, 48)} icon` : (snap.text || name).slice(0, 64),
          text: snap.text || '',
          fontVariationSettings: snap.fontVariationSettings,
          fill: color?.hex || '#111111',
          fillOpacity: color?.opacity ?? 1,
          fontFamily: snap.fontFamily,
          fontWeight: snap.fontWeight,
          fontStyle: snap.fontStyle,
          fontSize: snap.fontSize,
          lineHeight: snap.lineHeight,
          letterSpacing: snap.letterSpacing,
          letterSpacingUnit: snap.letterSpacing ? 'px' : undefined,
          textAlign: snap.textAlign,
          textAlignVertical: snap.textAlignVertical,
          textDecoration: snap.textDecoration,
          textResize: 'fixed'
        },
        snap
      )
      nodes.push(node)
      byId.set(id, node)
      return id
    }

    if (snap.kind === 'image' && snap.fill?.type === 'image' && snap.fill.dataUrl) {
      const node: DesignNode = applyCommon(
        {
          id,
          type: 'image',
          x,
          y,
          width,
          height,
          parentId,
          pageId: place.pageId,
          name,
          imageDataUrl: snap.fill.dataUrl,
          svgMarkup: snap.svg || undefined,
          radius: snap.radius
        },
        snap
      )
      nodes.push(node)
      byId.set(id, node)
      return id
    }

    const fills = paintsFromFill(snap.fill, nextId)
    const plan = planLayout(snap)
    const node: DesignNode = applyCommon(
      {
        id,
        type: 'frame',
        x,
        y,
        width,
        height,
        parentId,
        pageId: place.pageId,
        name,
        clipsContent: false,
        layout: plan?.layout || { mode: 'none', sizingH: 'fixed', sizingV: 'fixed' },
        fills
      },
      snap
    )
    if (fills?.[0]?.type === 'solid') {
      node.fill = fills[0].color
      node.fillOpacity = fills[0].opacity
    }
    nodes.push(node)
    byId.set(id, node)
    for (const child of plan?.order || snap.children || []) {
      const childId = visit(child, id)
      if (!plan || !childId) continue
      const kid = byId.get(childId)
      if (!kid) continue
      if (plan.absolute.has(child)) {
        kid.layoutAbsolute = true
        continue
      }
      const sizing = plan.sizing.get(child)
      if (sizing?.span) kid.gridColumnSpan = sizing.span
      if (sizing?.margin) kid.layoutMargin = sizing.margin
      if (sizing?.h) {
        kid.layoutSizingH = sizing.h
        if (kid.layout?.sizingH === 'hug') kid.layout = { ...kid.layout, sizingH: 'fixed' }
      }
      if (sizing?.v) {
        kid.layoutSizingV = sizing.v
        if (kid.layout?.sizingV === 'hug') kid.layout = { ...kid.layout, sizingV: 'fixed' }
      }
    }
    return id
  }

  const rootId = visit(tree, undefined)
  if (!rootId) return { nodes: [], rootId: '' }
  return { nodes, rootId }
}
