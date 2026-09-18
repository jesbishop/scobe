/** Figma-style paint / fill model for design nodes. */

export type ColorFormat = 'hex' | 'rgb' | 'css' | 'hsl' | 'hsb'

export type GradientKind = 'linear' | 'radial' | 'angular' | 'diamond'

export type GradientStop = {
  id: string
  /** 0–1 along the gradient */
  position: number
  color: string
  opacity: number
}

export type SolidPaint = {
  type: 'solid'
  color: string
  opacity: number
  visible?: boolean
}

export type GradientPaint = {
  type: 'gradient'
  gradientKind: GradientKind
  stops: GradientStop[]
  /** Degrees for linear / angular */
  angle: number
  opacity: number
  visible?: boolean
}

export type ImagePaint = {
  type: 'image'
  imageDataUrl?: string
  scaleMode?: 'fill' | 'fit' | 'crop' | 'tile'
  opacity: number
  visible?: boolean
  exposure?: number
  contrast?: number
  saturation?: number
  temperature?: number
  tint?: number
  highlights?: number
  shadows?: number
}

export type VideoPaint = {
  type: 'video'
  videoDataUrl?: string
  opacity: number
  visible?: boolean
}

export type ShaderKind =
  | 'mesh-gradient'
  | 'grain-gradient'
  | 'dot-orbit'
  | 'waves'
  | 'simplex-noise'
  | 'neuro-noise'
  | 'swirl'
  | 'god-rays'
  | 'smoke-ring'
  | 'paper-texture'

export type ShaderPaint = {
  type: 'shader'
  shader: ShaderKind
  colors: string[]
  opacity: number
  visible?: boolean
  speed?: number
  /** Shader-specific numeric params (0–1 or free range depending on shader) */
  params: Record<string, number>
}

export type Paint = SolidPaint | GradientPaint | ImagePaint | VideoPaint | ShaderPaint

export type FillTypeId =
  | 'solid'
  | 'linear'
  | 'radial'
  | 'angular'
  | 'diamond'
  | 'image'
  | 'video'
  | 'shader'

export function newStopId() {
  return crypto.randomUUID()
}

export function defaultSolid(color = '#D9D9D9', opacity = 1): SolidPaint {
  return { type: 'solid', color, opacity, visible: true }
}

export function defaultGradient(kind: GradientKind = 'linear'): GradientPaint {
  return {
    type: 'gradient',
    gradientKind: kind,
    angle: kind === 'linear' ? 90 : 0,
    opacity: 1,
    visible: true,
    stops: [
      { id: newStopId(), position: 0, color: '#7D324C', opacity: 1 },
      { id: newStopId(), position: 1, color: '#E35B8A', opacity: 1 }
    ]
  }
}

export function defaultImage(): ImagePaint {
  return {
    type: 'image',
    opacity: 1,
    visible: true,
    scaleMode: 'fill',
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0
  }
}

export function defaultVideo(): VideoPaint {
  return { type: 'video', opacity: 1, visible: true }
}

export function defaultShader(shader: ShaderKind = 'mesh-gradient'): ShaderPaint {
  const presets: Record<ShaderKind, { colors: string[]; params: Record<string, number>; speed: number }> = {
    'mesh-gradient': {
      colors: ['#5100ff', '#00ff80', '#ffcc00', '#ea00ff'],
      params: { distortion: 0.8, swirl: 0.5, grainMixer: 0, grainOverlay: 0 },
      speed: 0.35
    },
    'grain-gradient': {
      colors: ['#0b1026', '#3d5afe', '#00e5ff', '#ff4081'],
      params: { softness: 0.5, intensity: 0.55 },
      speed: 0.25
    },
    'dot-orbit': {
      colors: ['#d2822d', '#0c3b7e', '#b31a57', '#37a066'],
      params: { scale: 0.35, size: 0.4 },
      speed: 0.4
    },
    waves: {
      colors: ['#1a1a2e', '#e94560', '#0f3460'],
      params: { frequency: 0.5, amplitude: 0.45, softness: 0.3 },
      speed: 0
    },
    'simplex-noise': {
      colors: ['#111111', '#4a00e0', '#8e2de2', '#ff0080'],
      params: { scale: 0.6 },
      speed: 0.3
    },
    'neuro-noise': {
      colors: ['#050505', '#00f5d4', '#7b2cbf'],
      params: { scale: 0.55, brightness: 0.7 },
      speed: 0.2
    },
    swirl: {
      colors: ['#0f0c29', '#302b63', '#24243e', '#ff6bcb'],
      params: { bandCount: 0.5 },
      speed: 0.35
    },
    'god-rays': {
      colors: ['#000000', '#ff9a3c', '#ffe66d'],
      params: { density: 0.5, spotty: 0.3, midSize: 0.4 },
      speed: 0.25
    },
    'smoke-ring': {
      colors: ['#0a0a0a', '#5b8def', '#c084fc'],
      params: { thickness: 0.45, radius: 0.55, noiseScale: 0.5 },
      speed: 0.3
    },
    'paper-texture': {
      colors: ['#f4f0e6', '#d9d2c5'],
      params: { fiber: 0.5, roughness: 0.35, contrast: 0.4 },
      speed: 0
    }
  }
  const preset = presets[shader]
  return {
    type: 'shader',
    shader,
    colors: preset.colors,
    params: preset.params,
    speed: preset.speed,
    opacity: 1,
    visible: true
  }
}

export function paintFromLegacy(fill?: string, fillOpacity?: number): Paint {
  return defaultSolid(fill || '#D9D9D9', fillOpacity ?? 1)
}

export function getNodePaints(node: {
  fills?: Paint[]
  fill?: string
  fillOpacity?: number
}): Paint[] {
  if (node.fills?.length) return node.fills
  if (node.fill || node.fillOpacity != null) return [paintFromLegacy(node.fill, node.fillOpacity)]
  return []
}

export function legacyFromPaints(paints: Paint[]): { fill?: string; fillOpacity?: number } {
  const first = paints.find((paint) => paint.visible !== false)
  if (!first) return { fill: undefined, fillOpacity: 0 }
  if (first.type === 'solid') return { fill: first.color, fillOpacity: first.opacity }
  if (first.type === 'gradient') {
    const stop = first.stops[0]
    return { fill: stop?.color || '#D9D9D9', fillOpacity: first.opacity }
  }
  return { fill: '#D9D9D9', fillOpacity: first.opacity }
}

export function fillTypeOf(paint: Paint | null | undefined): FillTypeId {
  if (!paint) return 'solid'
  if (paint.type === 'solid') return 'solid'
  if (paint.type === 'gradient') return paint.gradientKind
  if (paint.type === 'image') return 'image'
  if (paint.type === 'video') return 'video'
  return 'shader'
}

export function paintForFillType(type: FillTypeId, previous?: Paint | null): Paint {
  if (type === 'solid') {
    if (previous?.type === 'solid') return previous
    if (previous?.type === 'gradient') {
      const stop = previous.stops[0]
      return defaultSolid(stop?.color || '#D9D9D9', previous.opacity)
    }
    return defaultSolid()
  }
  if (type === 'linear' || type === 'radial' || type === 'angular' || type === 'diamond') {
    if (previous?.type === 'gradient') return { ...previous, gradientKind: type }
    if (previous?.type === 'solid') {
      const g = defaultGradient(type)
      g.stops[0] = { ...g.stops[0], color: previous.color, opacity: previous.opacity }
      return g
    }
    return defaultGradient(type)
  }
  if (type === 'image') return previous?.type === 'image' ? previous : defaultImage()
  if (type === 'video') return previous?.type === 'video' ? previous : defaultVideo()
  return previous?.type === 'shader' ? previous : defaultShader()
}

function stopCss(stop: GradientStop) {
  const alpha = Math.max(0, Math.min(1, stop.opacity))
  const color = stop.color.startsWith('#') ? stop.color : `#${stop.color}`
  const r = Number.parseInt(color.slice(1, 3), 16)
  const g = Number.parseInt(color.slice(3, 5), 16)
  const b = Number.parseInt(color.slice(5, 7), 16)
  const pct = `${Math.round(stop.position * 1000) / 10}%`
  if (!Number.isFinite(r)) return `${stop.color} ${pct}`
  return `rgba(${r}, ${g}, ${b}, ${alpha}) ${pct}`
}

export function gradientCss(paint: GradientPaint): string {
  const stops = [...paint.stops]
    .sort((a, b) => a.position - b.position)
    .map(stopCss)
    .join(', ')
  const angle = paint.angle ?? 90
  if (paint.gradientKind === 'linear') return `linear-gradient(${angle}deg, ${stops})`
  if (paint.gradientKind === 'radial') return `radial-gradient(circle at center, ${stops})`
  if (paint.gradientKind === 'angular') return `conic-gradient(from ${angle}deg at center, ${stops})`
  // Diamond: Chebyshev-style look via a squashed radial (closest approximation in CSS)
  return `radial-gradient(ellipse farthest-corner at center, ${stops})`
}

export function paintPreviewCss(paint: Paint): string {
  if (paint.type === 'solid') {
    const color = paint.color.startsWith('#') ? paint.color : `#${paint.color}`
    const r = Number.parseInt(color.slice(1, 3), 16)
    const g = Number.parseInt(color.slice(3, 5), 16)
    const b = Number.parseInt(color.slice(5, 7), 16)
    if (!Number.isFinite(r)) return paint.color
    return `rgba(${r}, ${g}, ${b}, ${paint.opacity})`
  }
  if (paint.type === 'gradient') return gradientCss(paint)
  if (paint.type === 'image' && paint.imageDataUrl) return `center / cover no-repeat url("${paint.imageDataUrl}")`
  if (paint.type === 'shader') {
    return `linear-gradient(135deg, ${paint.colors[0] || '#888'}, ${paint.colors[1] || '#444'})`
  }
  return 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 12px 12px'
}

export function paintLabel(paint: Paint): string {
  if (paint.type === 'solid') return (paint.color || '#000000').replace('#', '').toUpperCase()
  if (paint.type === 'gradient') {
    const kind = paint.gradientKind
    return kind.charAt(0).toUpperCase() + kind.slice(1)
  }
  if (paint.type === 'image') return 'Image'
  if (paint.type === 'video') return 'Video'
  return 'Shader'
}

export const SHADER_OPTIONS: Array<{ id: ShaderKind; label: string }> = [
  { id: 'mesh-gradient', label: 'Mesh Gradient' },
  { id: 'grain-gradient', label: 'Grain Gradient' },
  { id: 'dot-orbit', label: 'Dot Orbit' },
  { id: 'waves', label: 'Waves' },
  { id: 'simplex-noise', label: 'Simplex Noise' },
  { id: 'neuro-noise', label: 'Neuro Noise' },
  { id: 'swirl', label: 'Swirl' },
  { id: 'god-rays', label: 'God Rays' },
  { id: 'smoke-ring', label: 'Smoke Ring' },
  { id: 'paper-texture', label: 'Paper Texture' }
]
