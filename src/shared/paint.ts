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

export type GradientPoint = { x: number; y: number }

export type GradientPaint = {
  type: 'gradient'
  gradientKind: GradientKind
  stops: GradientStop[]
  /** Degrees for linear / angular */
  angle: number
  /** On-canvas handles as fractions of the node box; derived from `angle` when unset. */
  handles?: { start: GradientPoint; end: GradientPoint }
  opacity: number
  visible?: boolean
}

/** Image placement for Crop mode, as fractions of the layer box (x/y offset, w/h size). */
export type ImageBox = { x: number; y: number; w: number; h: number }

export type ImagePaint = {
  type: 'image'
  imageDataUrl?: string
  scaleMode?: 'fill' | 'fit' | 'crop' | 'tile'
  imageBox?: ImageBox
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
  | 'static-mesh-gradient'
  | 'static-radial-gradient'
  | 'grain-gradient'
  | 'dot-orbit'
  | 'dot-grid'
  | 'metaballs'
  | 'waves'
  | 'simplex-noise'
  | 'perlin-noise'
  | 'neuro-noise'
  | 'voronoi'
  | 'warp'
  | 'swirl'
  | 'spiral'
  | 'god-rays'
  | 'smoke-ring'
  | 'dithering'
  | 'color-panels'
  | 'pulsing-border'
  | 'gem-smoke'
  | 'paper-texture'
  | 'heatmap'
  | 'liquid-metal'

export type ShaderPaint = {
  type: 'shader'
  shader: ShaderKind
  colors: string[]
  /** Background / secondary named colors used by some Paper shaders */
  colorBack?: string
  colorFront?: string
  colorMid?: string
  colorInner?: string
  colorGlow?: string
  colorGap?: string
  colorFill?: string
  colorStroke?: string
  opacity: number
  visible?: boolean
  speed?: number
  /** Shader-specific numeric params (0–1 or free range depending on shader) */
  params: Record<string, number>
  /** Enum-like Paper options (shape, type, fit, …) */
  options?: Record<string, string>
  /** Custom shape image (data URL) for shaders that trace an input shape. */
  image?: string
  imageName?: string
  imageWidth?: number
  imageHeight?: number
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
    'static-mesh-gradient': {
      colors: ['#ffad0a', '#6200ff', '#e2a3ff', '#ff99fd'],
      params: { positions: 2, waveX: 1, waveXShift: 0.6, waveY: 1, waveYShift: 0.21, mixing: 0.93 },
      speed: 0
    },
    'static-radial-gradient': {
      colors: ['#00bbff', '#00ffe1', '#ffffff'],
      params: { radius: 0.8, focalDistance: 0.99, falloff: 0.24, mixing: 0.5 },
      speed: 0
    },
    'grain-gradient': {
      colors: ['#2A00FF', '#00BFFF', '#EBA8FF'],
      params: { softness: 0.5, intensity: 0.5, noise: 0.25 },
      speed: 1
    },
    'dot-orbit': {
      colors: ['#d2822d', '#0c3b7e', '#b31a57', '#37a066'],
      params: { scale: 1, size: 0.4, spreading: 0.5 },
      speed: 1
    },
    'dot-grid': {
      colors: ['#000000', '#ffffff', '#ffaa00'],
      params: { size: 2, gapX: 32, gapY: 32, strokeWidth: 0, sizeRange: 0, opacityRange: 0 },
      speed: 0
    },
    metaballs: {
      colors: ['#6e33cc', '#ff5500', '#ffc105', '#ffc800', '#f585ff'],
      params: { count: 10, size: 0.83, scale: 1 },
      speed: 1
    },
    waves: {
      colors: ['#1a1a2e', '#e94560', '#0f3460'],
      params: { shape: 1, frequency: 0.5, amplitude: 0.45, softness: 0.3, spacing: 0.5, proportion: 0.5 },
      speed: 0
    },
    'simplex-noise': {
      colors: ['#111111', '#4a00e0', '#8e2de2', '#ff0080'],
      params: { softness: 0.4, stepsPerColor: 1 },
      speed: 1
    },
    'perlin-noise': {
      colors: ['#632ad5', '#fccff7'],
      params: { proportion: 0.35, softness: 0.1, octaveCount: 2, persistence: 1, lacunarity: 2 },
      speed: 1
    },
    'neuro-noise': {
      colors: ['#050505', '#00f5d4', '#7b2cbf'],
      params: { brightness: 0.7, contrast: 0.5 },
      speed: 1
    },
    voronoi: {
      colors: ['#ff8247', '#ffe53d'],
      params: { distortion: 0.4, gap: 0.04, glow: 0, stepsPerColor: 2 },
      speed: 1
    },
    warp: {
      colors: ['#121212', '#9470ff', '#121212', '#8838ff'],
      params: { proportion: 0.45, softness: 1, distortion: 0.25, swirl: 0.8, swirlIterations: 10, shapeScale: 0.1 },
      speed: 1
    },
    swirl: {
      colors: ['#0f0c29', '#302b63', '#24243e', '#ff6bcb'],
      params: { bandCount: 6, twist: 0.6, softness: 0.4, proportion: 0.5 },
      speed: 1
    },
    spiral: {
      colors: ['#001429', '#79D1FF'],
      params: { density: 1, distortion: 0, strokeWidth: 0.5, softness: 0 },
      speed: 1
    },
    'god-rays': {
      colors: ['#000000', '#ff9a3c', '#ffe66d'],
      params: { density: 0.5, spotty: 0.3, midSize: 0.4, midIntensity: 0.5, intensity: 0.7, bloom: 0.3 },
      speed: 1
    },
    'smoke-ring': {
      colors: ['#0a0a0a', '#5b8def', '#c084fc'],
      params: { thickness: 0.45, radius: 0.55, noiseScale: 1.5, innerShape: 1, noiseIterations: 4 },
      speed: 1
    },
    dithering: {
      colors: ['#000000', '#00b2ff'],
      params: { size: 2 },
      speed: 1
    },
    'color-panels': {
      colors: ['#ff9d00', '#fd4f30', '#809bff', '#6d2eff', '#333aff', '#f15cff', '#ffd557'],
      params: { length: 1.1, fadeIn: 1, fadeOut: 0.3, density: 3, blur: 0.25, gradient: 0.5 },
      speed: 1
    },
    'pulsing-border': {
      colors: ['#0dc1fd', '#d915ef', '#ff3f2e'],
      params: {
        roundness: 0.25,
        thickness: 0.1,
        softness: 0.75,
        intensity: 0.2,
        bloom: 0.25,
        pulse: 0.25,
        smoke: 0.3,
        spots: 4,
        spotSize: 0.5,
        smokeSize: 0.5
      },
      speed: 1
    },
    'gem-smoke': {
      colors: ['#333333', '#e7e6df'],
      params: { outerGlow: 0.55, innerGlow: 1, size: 0.8, innerDistortion: 0.3, outerDistortion: 0.3 },
      speed: 1
    },
    'paper-texture': {
      colors: ['#f4f0e6', '#d9d2c5'],
      params: { fiber: 0.5, crumples: 0.35, contrast: 0.4, roughness: 0.3, folds: 0.25, foldCount: 5 },
      speed: 0
    },
    heatmap: {
      colors: ['#11206a', '#1f3ba2', '#2f63e7', '#6bd7ff', '#ffe679', '#ff991e', '#ff4c00'],
      params: { scale: 0.75, contour: 0.5, angle: 0, noise: 0, innerGlow: 0.5, outerGlow: 0.5 },
      speed: 1
    },
    'liquid-metal': {
      colors: ['#ffffff'],
      params: {
        scale: 0.6,
        repetition: 2,
        softness: 0.1,
        shiftRed: 0.3,
        shiftBlue: 0.3,
        distortion: 0.07,
        contour: 0.4,
        angle: 70
      },
      speed: 1
    }
  }
  const preset = presets[shader]
  const sizing = {
    scale: preset.params.scale ?? 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0
  }
  const options: Record<string, string> = {}
  if (shader === 'grain-gradient') options.shape = 'corners'
  if (shader === 'dot-grid') options.shape = 'circle'
  if (shader === 'warp') options.shape = 'checks'
  if (shader === 'dithering') {
    options.shape = 'sphere'
    options.type = '4x4'
  }
  if (shader === 'gem-smoke' || shader === 'heatmap' || shader === 'liquid-metal') options.shape = 'diamond'

  // Paper treats 100% speed as 1 — animate immediately for motion shaders.
  const animated = ![
    'static-mesh-gradient',
    'static-radial-gradient',
    'dot-grid',
    'waves',
    'paper-texture'
  ].includes(shader)

  return {
    type: 'shader',
    shader,
    colors: preset.colors,
    colorBack:
      shader === 'paper-texture' || shader === 'gem-smoke'
        ? '#f0efea'
        : shader === 'liquid-metal'
          ? '#AAAAAC'
          : '#000000',
    params: { ...sizing, ...preset.params },
    options: Object.keys(options).length ? options : undefined,
    speed: animated ? 1 : 0,
    opacity: 1,
    visible: true
  }
}

export function paintFromLegacy(fill?: string, fillOpacity?: number): Paint {
  return defaultSolid(fill || '#D9D9D9', fillOpacity ?? 1)
}

export function getNodePaints(node: {
  type?: string
  fills?: Paint[]
  fill?: string
  fillOpacity?: number
  imageDataUrl?: string
}): Paint[] {
  if (node.fills?.length) return node.fills
  if (node.type === 'image') {
    return [{ ...defaultImage(), imageDataUrl: node.imageDataUrl, opacity: node.fillOpacity ?? 1, scaleMode: 'fill' }]
  }
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

function stopCss(stop: GradientStop, position = stop.position) {
  const alpha = Math.max(0, Math.min(1, stop.opacity))
  const color = stop.color.startsWith('#') ? stop.color : `#${stop.color}`
  const r = Number.parseInt(color.slice(1, 3), 16)
  const g = Number.parseInt(color.slice(3, 5), 16)
  const b = Number.parseInt(color.slice(5, 7), 16)
  const pct = `${Math.round(position * 1000) / 10}%`
  if (!Number.isFinite(r)) return `${stop.color} ${pct}`
  return `rgba(${r}, ${g}, ${b}, ${alpha}) ${pct}`
}

/** Figma gradient handles: linear runs edge to edge through the centre; the others start at the centre. */
export function gradientHandles(paint: GradientPaint): { start: GradientPoint; end: GradientPoint } {
  if (paint.handles) return paint.handles
  const rad = ((paint.angle ?? 90) * Math.PI) / 180
  const dx = Math.sin(rad) * 0.5
  const dy = -Math.cos(rad) * 0.5
  if (paint.gradientKind === 'linear') {
    return { start: { x: 0.5 - dx, y: 0.5 - dy }, end: { x: 0.5 + dx, y: 0.5 + dy } }
  }
  return { start: { x: 0.5, y: 0.5 }, end: { x: 0.5 + dx, y: 0.5 + dy } }
}

/** CSS angle (0 = up, clockwise) of the start→end handle direction in pixels. */
export function gradientHandleAngle(
  handles: { start: GradientPoint; end: GradientPoint },
  size: { width: number; height: number }
): number {
  const vx = (handles.end.x - handles.start.x) * size.width
  const vy = (handles.end.y - handles.start.y) * size.height
  const deg = (Math.atan2(vx, -vy) * 180) / Math.PI
  return Math.round(((deg % 360) + 360) % 360 * 10) / 10
}

/** Gradient CSS for a node of `size`, following its handles so the canvas matches the on-canvas editor. */
export function gradientCss(paint: GradientPaint, size?: { width: number; height: number }): string {
  const sorted = [...paint.stops].sort((a, b) => a.position - b.position)
  if (size && size.width > 0 && size.height > 0) {
    const W = size.width
    const H = size.height
    const { start, end } = gradientHandles(paint)
    const sx = start.x * W
    const sy = start.y * H
    const ex = end.x * W
    const ey = end.y * H
    const len = Math.hypot(ex - sx, ey - sy)
    if (len > 0.5) {
      const deg = gradientHandleAngle({ start, end }, size)
      if (paint.gradientKind === 'linear') {
        const ux = (ex - sx) / len
        const uy = (ey - sy) / len
        const lineLength = Math.abs(W * ux) + Math.abs(H * uy)
        const along = (x: number, y: number) => ((x - W / 2) * ux + (y - H / 2) * uy) / lineLength + 0.5
        const t0 = along(sx, sy)
        const t1 = along(ex, ey)
        const stops = sorted.map((stop) => stopCss(stop, t0 + stop.position * (t1 - t0))).join(', ')
        return `linear-gradient(${deg}deg, ${stops})`
      }
      const stops = sorted.map((stop) => stopCss(stop)).join(', ')
      if (paint.gradientKind === 'angular') return `conic-gradient(from ${deg}deg at ${sx}px ${sy}px, ${stops})`
      // Radial / diamond: a circle in box space, i.e. an ellipse that keeps the node's aspect.
      const r = Math.hypot(end.x - start.x, end.y - start.y)
      return `radial-gradient(ellipse ${r * W}px ${r * H}px at ${sx}px ${sy}px, ${stops})`
    }
  }
  const stops = sorted.map((stop) => stopCss(stop)).join(', ')
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
  { id: 'static-mesh-gradient', label: 'Static Mesh' },
  { id: 'static-radial-gradient', label: 'Static Radial' },
  { id: 'grain-gradient', label: 'Grain Gradient' },
  { id: 'dot-orbit', label: 'Dot Orbit' },
  { id: 'dot-grid', label: 'Dot Grid' },
  { id: 'metaballs', label: 'Metaballs' },
  { id: 'waves', label: 'Waves' },
  { id: 'simplex-noise', label: 'Simplex Noise' },
  { id: 'perlin-noise', label: 'Perlin Noise' },
  { id: 'neuro-noise', label: 'Neuro Noise' },
  { id: 'voronoi', label: 'Voronoi' },
  { id: 'warp', label: 'Warp' },
  { id: 'swirl', label: 'Swirl' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'god-rays', label: 'God Rays' },
  { id: 'smoke-ring', label: 'Smoke Ring' },
  { id: 'dithering', label: 'Dithering' },
  { id: 'color-panels', label: 'Color Panels' },
  { id: 'pulsing-border', label: 'Pulsing Border' },
  { id: 'gem-smoke', label: 'Gem Smoke' },
  { id: 'paper-texture', label: 'Paper Texture' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'liquid-metal', label: 'Liquid Metal' }
]
