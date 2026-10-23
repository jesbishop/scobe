import type { Rect } from '../shared/types'

export type MeasureEdge = 'n' | 's' | 'e' | 'w'

export type MeasureLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  labelX: number
  labelY: number
  /** Horizontal line slides on Y; vertical slides on X. */
  axis: 'h' | 'v'
  /** Allowed range for the free axis while sliding the line. */
  slideMin: number
  slideMax: number
  dashed?: boolean
  guides?: Array<{ x1: number; y1: number; x2: number; y2: number }>
}

export type MeasureAnchor = {
  nodeId: string
  edge: MeasureEdge
  x: number
  y: number
}

function roundPx(n: number): string {
  return String(Math.round(n))
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  )
}

function overlapX(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
}

function overlapY(a: Rect, b: Rect): boolean {
  return a.y < b.y + b.height && a.y + a.height > b.y
}

function hLine(
  id: string,
  x1: number,
  x2: number,
  y: number,
  slideMin: number,
  slideMax: number,
  guides?: MeasureLine['guides']
): MeasureLine {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  return {
    id,
    x1: left,
    y1: y,
    x2: right,
    y2: y,
    label: roundPx(right - left),
    labelX: (left + right) / 2,
    labelY: y,
    axis: 'h',
    slideMin,
    slideMax,
    guides
  }
}

function vLine(
  id: string,
  y1: number,
  y2: number,
  x: number,
  slideMin: number,
  slideMax: number,
  guides?: MeasureLine['guides']
): MeasureLine {
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  return {
    id,
    x1: x,
    y1: top,
    x2: x,
    y2: bottom,
    label: roundPx(bottom - top),
    labelX: x,
    labelY: (top + bottom) / 2,
    axis: 'v',
    slideMin,
    slideMax,
    guides
  }
}

/** Apply a perpendicular offset to a measurement line (Figma drag-to-reposition). */
export function offsetMeasureLine(line: MeasureLine, offset: number): MeasureLine {
  const clamped = Math.min(line.slideMax, Math.max(line.slideMin, offset))
  if (line.axis === 'h') {
    return {
      ...line,
      y1: clamped,
      y2: clamped,
      labelY: clamped
    }
  }
  return {
    ...line,
    x1: clamped,
    x2: clamped,
    labelX: clamped
  }
}

/** Size callouts for a single selected rect (Figma self-measure). */
export function sizeMeasurements(rect: Rect): MeasureLine[] {
  const lines: MeasureLine[] = []
  if (rect.width > 0) {
    const y = rect.y + rect.height + 14
    lines.push(
      hLine('w', rect.x, rect.x + rect.width, y, rect.y - 40, rect.y + rect.height + 60, [
        { x1: rect.x, y1: rect.y + rect.height, x2: rect.x, y2: y },
        { x1: rect.x + rect.width, y1: rect.y + rect.height, x2: rect.x + rect.width, y2: y }
      ])
    )
  }
  if (rect.height > 0) {
    const x = rect.x - 14
    lines.push(
      vLine('h', rect.y, rect.y + rect.height, x, rect.x - 60, rect.x + rect.width + 40, [
        { x1: x, y1: rect.y, x2: rect.x, y2: rect.y },
        { x1: x, y1: rect.y + rect.height, x2: rect.x, y2: rect.y + rect.height }
      ])
    )
  }
  return lines
}

/** Distances between selected (a) and target (b), Figma-style. */
export function distanceMeasurements(a: Rect, b: Rect): MeasureLine[] {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return []
  if (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  ) {
    return sizeMeasurements(a)
  }

  const lines: MeasureLine[] = []

  if (contains(b, a)) {
    const left = a.x - b.x
    const right = b.x + b.width - (a.x + a.width)
    const top = a.y - b.y
    const bottom = b.y + b.height - (a.y + a.height)
    const midY = a.y + a.height / 2
    const midX = a.x + a.width / 2
    if (left > 0.5) {
      lines.push(
        hLine('in-l', b.x, a.x, midY, a.y, a.y + a.height, [
          { x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.height },
          { x1: a.x, y1: a.y, x2: a.x, y2: a.y + a.height }
        ])
      )
    }
    if (right > 0.5) {
      lines.push(
        hLine('in-r', a.x + a.width, b.x + b.width, midY, a.y, a.y + a.height, [
          { x1: a.x + a.width, y1: a.y, x2: a.x + a.width, y2: a.y + a.height },
          { x1: b.x + b.width, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }
        ])
      )
    }
    if (top > 0.5) {
      lines.push(
        vLine('in-t', b.y, a.y, midX, a.x, a.x + a.width, [
          { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y },
          { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y }
        ])
      )
    }
    if (bottom > 0.5) {
      lines.push(
        vLine('in-b', a.y + a.height, b.y + b.height, midX, a.x, a.x + a.width, [
          { x1: a.x, y1: a.y + a.height, x2: a.x + a.width, y2: a.y + a.height },
          { x1: b.x, y1: b.y + b.height, x2: b.x + b.width, y2: b.y + b.height }
        ])
      )
    }
    return lines.length ? lines : sizeMeasurements(a)
  }

  if (contains(a, b)) return distanceMeasurements(b, a)

  if (b.x >= a.x + a.width - 0.5) {
    const yy = overlapY(a, b) ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 : a.y + a.height / 2
    const yMin = overlapY(a, b) ? Math.max(a.y, b.y) : Math.min(a.y, b.y)
    const yMax = overlapY(a, b) ? Math.min(a.y + a.height, b.y + b.height) : Math.max(a.y + a.height, b.y + b.height)
    lines.push(
      hLine('gap-r', a.x + a.width, b.x, yy, yMin, yMax, [
        { x1: a.x + a.width, y1: a.y, x2: a.x + a.width, y2: a.y + a.height },
        { x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.height }
      ])
    )
  } else if (a.x >= b.x + b.width - 0.5) {
    const yy = overlapY(a, b) ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 : a.y + a.height / 2
    const yMin = overlapY(a, b) ? Math.max(a.y, b.y) : Math.min(a.y, b.y)
    const yMax = overlapY(a, b) ? Math.min(a.y + a.height, b.y + b.height) : Math.max(a.y + a.height, b.y + b.height)
    lines.push(
      hLine('gap-l', b.x + b.width, a.x, yy, yMin, yMax, [
        { x1: b.x + b.width, y1: b.y, x2: b.x + b.width, y2: b.y + b.height },
        { x1: a.x, y1: a.y, x2: a.x, y2: a.y + a.height }
      ])
    )
  }

  if (b.y >= a.y + a.height - 0.5) {
    const xx = overlapX(a, b) ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2 : a.x + a.width / 2
    const xMin = overlapX(a, b) ? Math.max(a.x, b.x) : Math.min(a.x, b.x)
    const xMax = overlapX(a, b) ? Math.min(a.x + a.width, b.x + b.width) : Math.max(a.x + a.width, b.x + b.width)
    lines.push(
      vLine('gap-b', a.y + a.height, b.y, xx, xMin, xMax, [
        { x1: a.x, y1: a.y + a.height, x2: a.x + a.width, y2: a.y + a.height },
        { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y }
      ])
    )
  } else if (a.y >= b.y + b.height - 0.5) {
    const xx = overlapX(a, b) ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2 : a.x + a.width / 2
    const xMin = overlapX(a, b) ? Math.max(a.x, b.x) : Math.min(a.x, b.x)
    const xMax = overlapX(a, b) ? Math.min(a.x + a.width, b.x + b.width) : Math.max(a.x + a.width, b.x + b.width)
    lines.push(
      vLine('gap-t', b.y + b.height, a.y, xx, xMin, xMax, [
        { x1: b.x, y1: b.y + b.height, x2: b.x + b.width, y2: b.y + b.height },
        { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y }
      ])
    )
  }

  if (lines.length) {
    lines.push(...sizeMeasurements(a).filter((line) => line.id === 'h' || line.id === 'w'))
  }

  return lines
}

export function edgePoint(rect: Rect, edge: MeasureEdge): { x: number; y: number } {
  if (edge === 'n') return { x: rect.x + rect.width / 2, y: rect.y }
  if (edge === 's') return { x: rect.x + rect.width / 2, y: rect.y + rect.height }
  if (edge === 'w') return { x: rect.x, y: rect.y + rect.height / 2 }
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 }
}

export function nearestEdge(
  rect: Rect,
  point: { x: number; y: number },
  threshold: number
): MeasureEdge | null {
  const distN = Math.abs(point.y - rect.y)
  const distS = Math.abs(point.y - (rect.y + rect.height))
  const distW = Math.abs(point.x - rect.x)
  const distE = Math.abs(point.x - (rect.x + rect.width))
  const insideX = point.x >= rect.x - threshold && point.x <= rect.x + rect.width + threshold
  const insideY = point.y >= rect.y - threshold && point.y <= rect.y + rect.height + threshold
  const candidates: Array<{ edge: MeasureEdge; dist: number; ok: boolean }> = [
    { edge: 'n', dist: distN, ok: insideX && distN <= threshold },
    { edge: 's', dist: distS, ok: insideX && distS <= threshold },
    { edge: 'w', dist: distW, ok: insideY && distW <= threshold },
    { edge: 'e', dist: distE, ok: insideY && distE <= threshold }
  ]
  let best: { edge: MeasureEdge; dist: number } | null = null
  for (const item of candidates) {
    if (!item.ok) continue
    if (!best || item.dist < best.dist) best = item
  }
  return best?.edge || null
}

/** Build an axis-aligned measurement between two edge anchors. */
export function measurementBetweenAnchors(
  id: string,
  a: MeasureAnchor,
  b: MeasureAnchor,
  offset?: number
): MeasureLine | null {
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  // Prefer the dominant axis; ties go horizontal if both edges are vertical, etc.
  const preferVertical =
    a.edge === 'n' || a.edge === 's' || b.edge === 'n' || b.edge === 's'
      ? dy >= dx * 0.35
      : dy > dx
  if (preferVertical) {
    const xDefault = (a.x + b.x) / 2
    const x = offset != null ? offset : xDefault
    const top = Math.min(a.y, b.y)
    const bottom = Math.max(a.y, b.y)
    if (bottom - top < 0.5) return null
    return vLine(id, top, bottom, x, Math.min(a.x, b.x) - 40, Math.max(a.x, b.x) + 40, [
      { x1: a.x, y1: a.y, x2: x, y2: a.y },
      { x1: b.x, y1: b.y, x2: x, y2: b.y }
    ])
  }
  const yDefault = (a.y + b.y) / 2
  const y = offset != null ? offset : yDefault
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  if (right - left < 0.5) return null
  return hLine(id, left, right, y, Math.min(a.y, b.y) - 40, Math.max(a.y, b.y) + 40, [
    { x1: a.x, y1: a.y, x2: a.x, y2: y },
    { x1: b.x, y1: b.y, x2: b.x, y2: y }
  ])
}

export function hitTestMeasureLine(
  lines: MeasureLine[],
  point: { x: number; y: number },
  threshold: number
): MeasureLine | null {
  let best: { line: MeasureLine; dist: number } | null = null
  for (const line of lines) {
    let dist = Infinity
    if (line.axis === 'h') {
      const left = Math.min(line.x1, line.x2)
      const right = Math.max(line.x1, line.x2)
      if (point.x >= left - threshold && point.x <= right + threshold) {
        dist = Math.abs(point.y - line.y1)
      }
    } else {
      const top = Math.min(line.y1, line.y2)
      const bottom = Math.max(line.y1, line.y2)
      if (point.y >= top - threshold && point.y <= bottom + threshold) {
        dist = Math.abs(point.x - line.x1)
      }
    }
    if (dist <= threshold && (!best || dist < best.dist)) best = { line, dist }
  }
  return best?.line || null
}

export function hitTestRect(
  rects: Array<{ id: string; rect: Rect }>,
  point: { x: number; y: number }
): string | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const item = rects[i]
    const r = item.rect
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return item.id
  }
  return null
}
