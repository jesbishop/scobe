import type { Rect } from '../shared/types'

export type MeasureLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  label: string
  labelX: number
  labelY: number
  dashed?: boolean
  guides?: Array<{ x1: number; y1: number; x2: number; y2: number }>
}

function roundPx(n: number): string {
  const v = Math.round(n)
  return String(v)
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

function hLine(id: string, x1: number, x2: number, y: number, guides?: MeasureLine['guides']): MeasureLine {
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
    guides
  }
}

function vLine(id: string, y1: number, y2: number, x: number, guides?: MeasureLine['guides']): MeasureLine {
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
    guides
  }
}

/** Size callouts for a single selected rect (Figma self-measure). */
export function sizeMeasurements(rect: Rect): MeasureLine[] {
  const lines: MeasureLine[] = []
  if (rect.width > 0) {
    lines.push(
      hLine('w', rect.x, rect.x + rect.width, rect.y + rect.height + 14, [
        { x1: rect.x, y1: rect.y + rect.height, x2: rect.x, y2: rect.y + rect.height + 14 },
        { x1: rect.x + rect.width, y1: rect.y + rect.height, x2: rect.x + rect.width, y2: rect.y + rect.height + 14 }
      ])
    )
  }
  if (rect.height > 0) {
    lines.push(
      vLine('h', rect.y, rect.y + rect.height, rect.x - 14, [
        { x1: rect.x - 14, y1: rect.y, x2: rect.x, y2: rect.y },
        { x1: rect.x - 14, y1: rect.y + rect.height, x2: rect.x, y2: rect.y + rect.height }
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
        hLine('in-l', b.x, a.x, midY, [
          { x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.height },
          { x1: a.x, y1: a.y, x2: a.x, y2: a.y + a.height }
        ])
      )
    }
    if (right > 0.5) {
      lines.push(
        hLine('in-r', a.x + a.width, b.x + b.width, midY, [
          { x1: a.x + a.width, y1: a.y, x2: a.x + a.width, y2: a.y + a.height },
          { x1: b.x + b.width, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }
        ])
      )
    }
    if (top > 0.5) {
      lines.push(
        vLine('in-t', b.y, a.y, midX, [
          { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y },
          { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y }
        ])
      )
    }
    if (bottom > 0.5) {
      lines.push(
        vLine('in-b', a.y + a.height, b.y + b.height, midX, [
          { x1: a.x, y1: a.y + a.height, x2: a.x + a.width, y2: a.y + a.height },
          { x1: b.x, y1: b.y + b.height, x2: b.x + b.width, y2: b.y + b.height }
        ])
      )
    }
    return lines.length ? lines : sizeMeasurements(a)
  }

  if (contains(a, b)) return distanceMeasurements(b, a)

  // Outside gaps
  if (b.x >= a.x + a.width - 0.5) {
    const yy = overlapY(a, b) ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 : a.y + a.height / 2
    lines.push(
      hLine('gap-r', a.x + a.width, b.x, yy, [
        { x1: a.x + a.width, y1: a.y, x2: a.x + a.width, y2: a.y + a.height },
        { x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.height }
      ])
    )
  } else if (a.x >= b.x + b.width - 0.5) {
    const yy = overlapY(a, b) ? (Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2 : a.y + a.height / 2
    lines.push(
      hLine('gap-l', b.x + b.width, a.x, yy, [
        { x1: b.x + b.width, y1: b.y, x2: b.x + b.width, y2: b.y + b.height },
        { x1: a.x, y1: a.y, x2: a.x, y2: a.y + a.height }
      ])
    )
  }

  if (b.y >= a.y + a.height - 0.5) {
    const xx = overlapX(a, b) ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2 : a.x + a.width / 2
    lines.push(
      vLine('gap-b', a.y + a.height, b.y, xx, [
        { x1: a.x, y1: a.y + a.height, x2: a.x + a.width, y2: a.y + a.height },
        { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y }
      ])
    )
  } else if (a.y >= b.y + b.height - 0.5) {
    const xx = overlapX(a, b) ? (Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2 : a.x + a.width / 2
    lines.push(
      vLine('gap-t', b.y + b.height, a.y, xx, [
        { x1: b.x, y1: b.y + b.height, x2: b.x + b.width, y2: b.y + b.height },
        { x1: a.x, y1: a.y, x2: a.x + a.width, y2: a.y }
      ])
    )
  }

  // Always include selected size when comparing to another object (Figma often shows height)
  if (lines.length) {
    lines.push(...sizeMeasurements(a).filter((line) => line.id === 'h' || line.id === 'w'))
  }

  return lines
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
