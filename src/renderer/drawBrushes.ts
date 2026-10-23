import type { BrushStyleId, PathPoint, StrokeProfile } from '../shared/types'

export type Point = { x: number; y: number }

export type BrushDef = {
  id: BrushStyleId
  name: string
  group: 'basic' | 'stretch'
  taper: number
  roughness: number
  angleWidth: number
  strands: number
  strandGap: number
  dryness: number
  velocityThin: number
  roundness: number
}

export const BRUSH_STYLES: BrushDef[] = [
  { id: 'basic', name: 'Basic', group: 'basic', taper: 0.08, roughness: 0, angleWidth: 0, strands: 1, strandGap: 0, dryness: 0, velocityThin: 0.08, roundness: 1 },
  { id: 'heist', name: 'Heist', group: 'stretch', taper: 0.22, roughness: 0.38, angleWidth: 0.28, strands: 1, strandGap: 0, dryness: 0.12, velocityThin: 0.22, roundness: 0.72 },
  { id: 'blockbuster', name: 'Blockbuster', group: 'stretch', taper: 0.16, roughness: 0.16, angleWidth: 0.12, strands: 1, strandGap: 0, dryness: 0.04, velocityThin: 0.12, roundness: 0.92 },
  { id: 'grindhouse', name: 'Grindhouse', group: 'stretch', taper: 0.18, roughness: 0.55, angleWidth: 0.18, strands: 2, strandGap: 0.18, dryness: 0.28, velocityThin: 0.18, roundness: 0.45 },
  { id: 'biopic', name: 'Biopic', group: 'stretch', taper: 0.42, roughness: 0.1, angleWidth: 0.62, strands: 1, strandGap: 0, dryness: 0, velocityThin: 0.08, roundness: 0.55 },
  { id: 'spaghetti-western', name: 'Spaghetti Western', group: 'stretch', taper: 0.08, roughness: 0.22, angleWidth: 0.06, strands: 3, strandGap: 0.42, dryness: 0.08, velocityThin: 0.1, roundness: 0.35 },
  { id: 'slasher', name: 'Slasher', group: 'stretch', taper: 0.55, roughness: 0.42, angleWidth: 0.48, strands: 2, strandGap: 0.12, dryness: 0.2, velocityThin: 0.28, roundness: 0.2 },
  { id: 'hardboiled', name: 'Hardboiled', group: 'stretch', taper: 0.2, roughness: 0.2, angleWidth: 0.22, strands: 1, strandGap: 0, dryness: 0.06, velocityThin: 0.16, roundness: 0.8 },
  { id: 'verite', name: 'Verite', group: 'stretch', taper: 0.14, roughness: 0.48, angleWidth: 0.1, strands: 1, strandGap: 0, dryness: 0.16, velocityThin: 0.32, roundness: 0.6 },
  { id: 'epic', name: 'Epic', group: 'stretch', taper: 0.5, roughness: 0.14, angleWidth: 0.38, strands: 1, strandGap: 0, dryness: 0.02, velocityThin: 0.1, roundness: 0.7 },
  { id: 'screwball', name: 'Screwball', group: 'stretch', taper: 0.28, roughness: 0.3, angleWidth: 0.55, strands: 1, strandGap: 0, dryness: 0.1, velocityThin: 0.4, roundness: 0.85 },
  { id: 'rom-com', name: 'Rom Com', group: 'stretch', taper: 0.24, roughness: 0.08, angleWidth: 0.08, strands: 1, strandGap: 0, dryness: 0, velocityThin: 0.06, roundness: 1 },
  { id: 'noir', name: 'Noir', group: 'stretch', taper: 0.34, roughness: 0.26, angleWidth: 0.4, strands: 1, strandGap: 0, dryness: 0.08, velocityThin: 0.14, roundness: 0.4 },
  { id: 'propaganda', name: 'Propaganda', group: 'stretch', taper: 0.06, roughness: 0.12, angleWidth: 0.04, strands: 1, strandGap: 0, dryness: 0.02, velocityThin: 0.04, roundness: 0.95 },
  { id: 'melodrama', name: 'Melodrama', group: 'stretch', taper: 0.46, roughness: 0.2, angleWidth: 0.7, strands: 1, strandGap: 0, dryness: 0.04, velocityThin: 0.2, roundness: 0.5 },
  { id: 'new-wave', name: 'New Wave', group: 'stretch', taper: 0.2, roughness: 0.62, angleWidth: 0.2, strands: 2, strandGap: 0.28, dryness: 0.36, velocityThin: 0.24, roundness: 0.3 }
]

export const STRETCH_BRUSHES = BRUSH_STYLES.filter((item) => item.group === 'stretch')

export function brushById(id?: BrushStyleId | null): BrushDef {
  return BRUSH_STYLES.find((item) => item.id === id) || BRUSH_STYLES[0]
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619)
  return hash >>> 0
}

function rng(seed: number): () => number {
  let value = seed || 1
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

export function smoothPoints(points: Point[], passes = 2): Point[] {
  if (points.length < 3) return points
  let current = points
  for (let pass = 0; pass < passes; pass++) {
    const next: Point[] = [current[0]]
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i]
      const b = current[i + 1]
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    next.push(current[current.length - 1])
    current = next
  }
  return current
}

export function densifyPoints(points: Point[], spacing: number): Point[] {
  if (points.length < 2) return points
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]
    const next = points[i]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const dist = Math.hypot(dx, dy)
    const steps = Math.max(1, Math.round(dist / Math.max(0.8, spacing)))
    for (let step = 1; step <= steps; step++) {
      const t = step / steps
      out.push({ x: prev.x + dx * t, y: prev.y + dy * t })
    }
  }
  return out
}

type Sample = Point & { nx: number; ny: number; t: number; speed: number; angle: number }

function samplesFrom(points: Point[]): Sample[] {
  if (points.length === 0) return []
  const speeds: number[] = [0]
  let length = 0
  const lengths = [0]
  for (let i = 1; i < points.length; i++) {
    const speed = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    speeds.push(speed)
    length += speed
    lengths.push(length)
  }
  const total = Math.max(1, length)
  return points.map((point, i) => {
    const prev = points[Math.max(0, i - 1)]
    const next = points[Math.min(points.length - 1, i + 1)]
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const mag = Math.hypot(tx, ty) || 1
    return {
      ...point,
      nx: -ty / mag,
      ny: tx / mag,
      t: lengths[i] / total,
      speed: speeds[i],
      angle: Math.atan2(ty, tx)
    }
  })
}

function widthAt(sample: Sample, brush: BrushDef, weight: number, random: () => number): number {
  const taper = brush.taper > 0 ? Math.pow(Math.sin(sample.t * Math.PI), 1 + brush.taper * 1.6) * (1 - brush.taper * 0.15) + brush.taper * 0.15 : 1
  const calligraphy = 1 + brush.angleWidth * Math.abs(Math.sin(sample.angle * 2))
  const velocity = 1 - brush.velocityThin * Math.min(1, sample.speed / 18)
  const noise = brush.roughness ? 1 + (random() - 0.5) * brush.roughness * 0.55 : 1
  return Math.max(0.35, weight * taper * calligraphy * velocity * noise)
}

function ribbon(samples: Sample[], widths: number[], offset: number, cap: BrushCap = 'round'): string {
  if (samples.length < 2) return ''
  const left: Point[] = []
  const right: Point[] = []
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]
    const radius = widths[i] / 2
    left.push({
      x: sample.x + sample.nx * (radius + offset),
      y: sample.y + sample.ny * (radius + offset)
    })
    right.push({
      x: sample.x - sample.nx * (radius - offset),
      y: sample.y - sample.ny * (radius - offset)
    })
  }
  const last = samples.length - 1
  const fmt = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  const capTo = (from: Point, to: Point, sample: Sample, r: number, dir: 1 | -1): string => {
    if (cap === 'round') return `A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${fmt(to)}`
    if (cap === 'square') {
      const tx = sample.ny * dir * r
      const ty = -sample.nx * dir * r
      return `L ${fmt({ x: from.x + tx, y: from.y + ty })} L ${fmt({ x: to.x + tx, y: to.y + ty })} L ${fmt(to)}`
    }
    return `L ${fmt(to)}`
  }
  const parts = [`M ${fmt(left[0])}`]
  for (let i = 1; i < left.length; i++) parts.push(`L ${fmt(left[i])}`)
  parts.push(capTo(left[last], right[last], samples[last], widths[last] / 2, 1))
  for (let i = right.length - 2; i >= 0; i--) parts.push(`L ${fmt(right[i])}`)
  parts.push(capTo(right[0], left[0], samples[0], widths[0] / 2, -1))
  parts.push('Z')
  return parts.join(' ')
}

export type BrushCap = 'none' | 'square' | 'round'

export type BrushShape = {
  profile?: StrokeProfile
  flip?: boolean
  cap?: BrushCap
}

function jitterRibbon(
  samples: Sample[],
  widths: number[],
  brush: BrushDef,
  random: () => number,
  offset: number,
  cap: BrushCap = 'round'
): string {
  if (!brush.roughness) return ribbon(samples, widths, offset, cap)
  const noisy = samples.map((sample, i) => {
    const jolt = (random() - 0.5) * widths[i] * brush.roughness * 0.22
    return {
      ...sample,
      x: sample.x + sample.nx * jolt,
      y: sample.y + sample.ny * jolt
    }
  })
  return ribbon(noisy, widths, offset, cap)
}

export function pathDFromPoints(points: PathPoint[], closed = false): string {
  if (points.length === 0) return ''
  const first = points[0]
  const parts = [`M ${first.x} ${first.y}`]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const next = points[i]
    if (prev.outX != null && prev.outY != null && next.inX != null && next.inY != null) {
      parts.push(`C ${prev.outX} ${prev.outY} ${next.inX} ${next.inY} ${next.x} ${next.y}`)
    } else if (prev.outX != null && prev.outY != null) {
      parts.push(`Q ${prev.outX} ${prev.outY} ${next.x} ${next.y}`)
    } else {
      parts.push(`L ${next.x} ${next.y}`)
    }
  }
  if (closed && points.length > 2) {
    const last = points[points.length - 1]
    if (last.outX != null && last.outY != null && first.inX != null && first.inY != null) {
      parts.push(`C ${last.outX} ${last.outY} ${first.inX} ${first.inY} ${first.x} ${first.y}`)
    } else {
      parts.push('Z')
    }
  }
  return parts.join(' ')
}

export function flattenPathPoints(points: PathPoint[], closed = false): Point[] {
  if (points.length < 2) return points.map((point) => ({ x: point.x, y: point.y }))
  const out: Point[] = []
  const lastIndex = closed ? points.length : points.length - 1
  for (let i = 0; i < lastIndex; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const steps = a.outX != null || b.inX != null ? 12 : 1
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      if (a.outX != null && a.outY != null && b.inX != null && b.inY != null) {
        const x =
          (1 - t) ** 3 * a.x +
          3 * (1 - t) ** 2 * t * a.outX +
          3 * (1 - t) * t ** 2 * b.inX +
          t ** 3 * b.x
        const y =
          (1 - t) ** 3 * a.y +
          3 * (1 - t) ** 2 * t * a.outY +
          3 * (1 - t) * t ** 2 * b.inY +
          t ** 3 * b.y
        out.push({ x, y })
      } else {
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      }
    }
  }
  out.push({ x: points[closed ? 0 : points.length - 1].x, y: points[closed ? 0 : points.length - 1].y })
  return out
}

export function brushFills(
  points: PathPoint[],
  style: BrushStyleId | undefined,
  weight: number,
  seed: string,
  closed = false,
  shape: BrushShape = {}
): string[] {
  const brush = brushById(style)
  const raw = flattenPathPoints(points, closed)
  if (raw.length < 2) return []
  const spacing = Math.max(1.2, Math.min(4.5, weight * 0.08))
  const samples = samplesFrom(densifyPoints(smoothPoints(raw, brush.id === 'basic' ? 1 : 2), spacing))
  const random = rng(hashString(seed + brush.id))
  const profile = shape.profile || 'uniform'
  const along = (t: number) => (profile === 'uniform' ? 1 : Math.max(0.01, profileWidth(profile, shape.flip ? 1 - t : t)))
  const fills: string[] = []
  const strandCount = Math.max(1, brush.strands)
  for (let strand = 0; strand < strandCount; strand++) {
    const center = (strand - (strandCount - 1) / 2) * weight * brush.strandGap
    const widths = samples.map((sample) => {
      if (brush.dryness && random() < brush.dryness * 0.08) return Math.max(0.4, weight * 0.12) * along(sample.t)
      return widthAt(sample, brush, weight * (strandCount > 1 ? 0.42 : 1), random) * along(sample.t)
    })
    fills.push(jitterRibbon(samples, widths, brush, random, center, shape.cap || 'round'))
  }
  return fills.filter(Boolean)
}

export const STROKE_PROFILES: Array<{ id: StrokeProfile; name: string }> = [
  { id: 'uniform', name: 'Uniform' },
  { id: 'wedge', name: 'Wedge' },
  { id: 'taper', name: 'Taper' },
  { id: 'swell', name: 'Swell' },
  { id: 'lens', name: 'Lens' },
  { id: 'bulge', name: 'Bulge' }
]

/** Width multiplier (0–1) at position t (0–1) along the stroke. */
export function profileWidth(profile: StrokeProfile, t: number): number {
  switch (profile) {
    case 'wedge':
      return 1 - t
    case 'taper':
      return 1 - 0.5 * t
    case 'swell':
      return t < 0.8 ? 0.5 + 0.5 * (t / 0.8) : (1 - t) / 0.2
    case 'lens':
      return Math.sin(Math.PI * t)
    case 'bulge':
      return 0.55 + 0.45 * Math.sin(Math.PI * t)
    default:
      return 1
  }
}

/** Plain path strokes draw with SVG stroke attributes; brush styles draw as fills. */
export function isPlainStroke(node: { pathTool?: string; brushStyle?: BrushStyleId }): boolean {
  if (!node.pathTool || node.pathTool === 'pen') return true
  return (node.brushStyle || (node.pathTool === 'brush' ? 'heist' : 'basic')) === 'basic'
}

/** Filled outline of a stroke whose width follows `profile`. */
export function profileOutline(
  points: PathPoint[],
  closed: boolean,
  weight: number,
  profile: StrokeProfile,
  flip: boolean,
  cap: 'none' | 'square' | 'round'
): string {
  const raw = flattenPathPoints(points, closed)
  if (raw.length < 2) return ''
  const samples = samplesFrom(densifyPoints(raw, Math.max(0.5, Math.min(3, weight * 0.25))))
  const radii = samples.map((sample) => Math.max(0.005, (weight * profileWidth(profile, flip ? 1 - sample.t : sample.t)) / 2))
  const left = samples.map((s, i) => ({ x: s.x + s.nx * radii[i], y: s.y + s.ny * radii[i] }))
  const right = samples.map((s, i) => ({ x: s.x - s.nx * radii[i], y: s.y - s.ny * radii[i] }))
  const fmt = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`
  if (closed) {
    return `M ${left.map(fmt).join(' L ')} Z M ${[...right].reverse().map(fmt).join(' L ')} Z`
  }
  const last = samples.length - 1
  const endCap = (from: Point, to: Point, sample: Sample, r: number, dir: 1 | -1): string => {
    if (cap === 'round') return `A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${fmt(to)}`
    if (cap === 'square') {
      const tx = sample.ny * dir * r
      const ty = -sample.nx * dir * r
      return `L ${fmt({ x: from.x + tx, y: from.y + ty })} L ${fmt({ x: to.x + tx, y: to.y + ty })} L ${fmt(to)}`
    }
    return `L ${fmt(to)}`
  }
  return [
    `M ${left.map(fmt).join(' L ')}`,
    endCap(left[last], right[last], samples[last], radii[last], 1),
    `L ${right
      .slice(0, last)
      .reverse()
      .map(fmt)
      .join(' L ')}`,
    endCap(right[0], left[0], samples[0], radii[0], -1),
    'Z'
  ].join(' ')
}

export const PREVIEW_CURVE: Point[] = [
  { x: 8, y: 16 },
  { x: 26, y: 8 },
  { x: 48, y: 20 },
  { x: 72, y: 9 },
  { x: 100, y: 15 }
]

export function brushPreviewD(style: BrushStyleId, weight = 10): string[] {
  return brushFills(PREVIEW_CURVE, style, weight, style, false)
}
