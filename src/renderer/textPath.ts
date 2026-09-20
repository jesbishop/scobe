import type { DesignNode, PathPoint } from '../shared/types'
import { flattenPathPoints, pathDFromPoints } from './drawBrushes'
import { nodeBounds } from './canvasMath'

export function isTextOnPath(node: DesignNode): boolean {
  return node.type === 'text' && Boolean(node.points?.length)
}

export function canHostTextPath(node: DesignNode): boolean {
  if (node.type === 'path') return (node.points?.length || 0) >= 2
  // Frames hold content — don't convert them into text paths.
  return (
    node.type === 'ellipse' ||
    node.type === 'rect' ||
    node.type === 'polygon' ||
    node.type === 'star' ||
    node.type === 'line' ||
    node.type === 'arrow'
  )
}

export function pathPointsFromNode(node: DesignNode): { points: PathPoint[]; closed: boolean } | null {
  if (node.type === 'path' && node.points && node.points.length >= 2) {
    return { points: node.points.map((point) => ({ ...point })), closed: Boolean(node.closed) }
  }
  const box = nodeBounds(node)
  if (box.width < 1 || box.height < 1) return null
  if (node.type === 'ellipse') {
    return { points: ellipsePoints(box.x, box.y, box.width, box.height), closed: true }
  }
  if (node.type === 'rect' || node.type === 'frame') {
    return {
      points: [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height }
      ],
      closed: true
    }
  }
  if (node.type === 'polygon') {
    return {
      points: [
        { x: box.x + box.width / 2, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height }
      ],
      closed: true
    }
  }
  if (node.type === 'star') {
    return { points: starPathPoints(box.x, box.y, box.width, box.height), closed: true }
  }
  if (node.type === 'line' || node.type === 'arrow') {
    const points = node.points
    if (points && points.length >= 2) {
      return { points: points.map((point) => ({ ...point })), closed: false }
    }
    return {
      points: [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y + box.height }
      ],
      closed: false
    }
  }
  return null
}

export function textPathD(points: PathPoint[], closed = false, flip = false): string {
  const source = flip ? reversePoints(points) : points
  return pathDFromPoints(source, closed)
}

export function findTextPathTarget(
  point: { x: number; y: number },
  nodes: DesignNode[],
  threshold = 14
): DesignNode | null {
  let best: DesignNode | null = null
  let bestDist = threshold
  for (const node of nodes) {
    if (!canHostTextPath(node)) continue
    const geom = pathPointsFromNode(node)
    if (!geom) continue
    const dist = distanceToPath(point, geom.points, geom.closed)
    if (dist < bestDist) {
      bestDist = dist
      best = node
    }
  }
  return best
}

export function offsetAlongPath(
  point: { x: number; y: number },
  points: PathPoint[],
  closed = false
): number {
  const samples = samplePath(points, closed, 240)
  if (samples.length < 2) return 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const dist = Math.hypot(point.x - sample.x, point.y - sample.y)
    if (dist < bestDist) {
      bestDist = dist
      best = sample.t
    }
  }
  return Math.max(0, Math.min(100, best * 100))
}

export function pointAtPathOffset(
  points: PathPoint[],
  closed: boolean,
  offsetPercent: number,
  flip = false
): { x: number; y: number } | null {
  const source = flip ? reversePoints(points) : points
  const samples = samplePath(source, closed, 240)
  if (!samples.length) return null
  const t = Math.max(0, Math.min(1, offsetPercent / 100))
  let best = samples[0]
  let bestDelta = Infinity
  for (const sample of samples) {
    const delta = Math.abs(sample.t - t)
    if (delta < bestDelta) {
      bestDelta = delta
      best = sample
    }
  }
  return { x: best.x, y: best.y }
}

import { cssFontFamily } from './googleFonts'

let measureCanvas: HTMLCanvasElement | null = null

export function measurePlainText(
  text: string,
  fontFamily: string,
  fontWeight: number | string,
  fontSize: number,
  letterSpacing = 0,
  lineHeight?: number,
  fontStyle: 'normal' | 'italic' = 'normal'
): { width: number; height: number } {
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return { width: Math.max(8, fontSize * 0.55), height: lineHeight || Math.round(fontSize * 1.2) }
  const family = /['",]/.test(fontFamily || '') ? fontFamily : cssFontFamily(fontFamily || 'Inter')
  ctx.font = `${fontStyle === 'italic' ? 'italic ' : ''}${fontWeight || 400} ${fontSize}px ${family}`
  const lines = (text || '').split('\n')
  const width = Math.max(
    8,
    ...lines.map((line) => {
      const metrics = ctx.measureText(line || ' ')
      const tracking = Math.max(0, (line.length - 1) * letterSpacing)
      return metrics.width + tracking
    })
  )
  const height = Math.max(lineHeight || Math.round(fontSize * 1.2), lines.length * (lineHeight || Math.round(fontSize * 1.2)))
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

function ellipsePoints(x: number, y: number, width: number, height: number, steps = 64): PathPoint[] {
  const cx = x + width / 2
  const cy = y + height / 2
  const rx = width / 2
  const ry = height / 2
  const points: PathPoint[] = []
  for (let i = 0; i < steps; i++) {
    const angle = -Math.PI / 2 + (i / steps) * Math.PI * 2
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry })
  }
  return points
}

function starPathPoints(x: number, y: number, width: number, height: number, spikes = 5): PathPoint[] {
  const cx = x + width / 2
  const cy = y + height / 2
  const outer = Math.min(width, height) / 2
  const inner = outer * 0.4
  const points: PathPoint[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
  }
  return points
}

function reversePoints(points: PathPoint[]): PathPoint[] {
  return points
    .slice()
    .reverse()
    .map((point) => ({
      x: point.x,
      y: point.y,
      inX: point.outX,
      inY: point.outY,
      outX: point.inX,
      outY: point.inY
    }))
}

function distanceToPath(point: { x: number; y: number }, points: PathPoint[], closed: boolean): number {
  const samples = samplePath(points, closed, 160)
  let best = Infinity
  for (const sample of samples) {
    best = Math.min(best, Math.hypot(point.x - sample.x, point.y - sample.y))
  }
  return best
}

function samplePath(points: PathPoint[], closed: boolean, count: number): Array<{ x: number; y: number; t: number }> {
  if (points.length < 2) return points.map((point, index) => ({ x: point.x, y: point.y, t: index }))
  const flat = flattenPathPoints(points, closed)
  if (flat.length <= 1) return flat.map((point, index) => ({ ...point, t: index }))
  const lengths: number[] = [0]
  for (let i = 1; i < flat.length; i++) {
    lengths[i] = lengths[i - 1] + Math.hypot(flat[i].x - flat[i - 1].x, flat[i].y - flat[i - 1].y)
  }
  const totalLen = lengths[lengths.length - 1] || 1
  const out: Array<{ x: number; y: number; t: number }> = []
  for (let i = 0; i <= count; i++) {
    const target = (i / count) * totalLen
    let index = 0
    while (index < lengths.length - 1 && lengths[index + 1] < target) index++
    const a = flat[index]
    const b = flat[Math.min(flat.length - 1, index + 1)]
    const span = lengths[Math.min(lengths.length - 1, index + 1)] - lengths[index] || 1
    const local = (target - lengths[index]) / span
    out.push({
      x: a.x + (b.x - a.x) * local,
      y: a.y + (b.y - a.y) * local,
      t: i / count
    })
  }
  return out
}
