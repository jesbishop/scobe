/** Canvas rendering for layer effects that CSS alone can't express: glass, progressive blur, noise, texture. */
import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { DesignNode } from '../shared/types'
import { getNodeEffects, progressiveLine, type DesignEffect } from '../shared/effects'
import { clampCornerRadii, resolveCornerRadii } from '../shared/corners'
import { cssBlendMode } from '../shared/blendModes'
import { getBlurEdit, type BlurEdit } from './blurEdit'
import { toHex, withAlpha } from './DesignInspector'

type Point = { x: number; y: number }

/** Shapes drawn as SVG outlines (not CSS boxes) — their effects follow the outline via clip paths. */
export function isOutlineShape(node: DesignNode): boolean {
  return node.type === 'ellipse' || node.type === 'polygon' || node.type === 'star'
}

export function starVertices(width: number, height: number, spikes = 5): Point[] {
  const cx = width / 2
  const cy = height / 2
  const outer = Math.min(width, height) / 2
  const inner = outer * 0.4
  const points: Point[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes
    points.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius })
  }
  return points
}

function polygonVertices(node: DesignNode, width: number, height: number): Point[] | null {
  if (node.type === 'polygon') return [{ x: width / 2, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  if (node.type === 'star') return starVertices(width, height)
  return null
}

function boxRadii(node: DesignNode, width: number, height: number) {
  return clampCornerRadii(resolveCornerRadii(node, node.type === 'section' ? 2 : 0), width, height)
}

/** The layer's outline as an SVG path in local px (also valid for CSS `clip-path: path()`). */
export function outlinePath(node: DesignNode, width: number, height: number): string {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  if (node.type === 'ellipse') {
    return `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`
  }
  const poly = polygonVertices(node, w, h)
  if (poly) return `M${poly.map((p) => `${p.x} ${p.y}`).join('L')}Z`
  const { tl, tr, br, bl } = boxRadii(node, w, h)
  return (
    `M${tl} 0H${w - tr}A${tr} ${tr} 0 0 1 ${w} ${tr}V${h - br}A${br} ${br} 0 0 1 ${w - br} ${h}` +
    `H${bl}A${bl} ${bl} 0 0 1 0 ${h - bl}V${tl}A${tl} ${tl} 0 0 1 ${tl} 0Z`
  )
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '')
}

function effectId(kind: string, node: DesignNode, fx: DesignEffect): string {
  return `fx-${kind}-${safeId(node.id)}-${safeId(fx.id)}`
}

function seedOf(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash) % 997
}

function visibleEffects(node: DesignNode): DesignEffect[] {
  return getNodeEffects(node).filter((fx) => fx.visible !== false)
}

function isProgressive(fx: DesignEffect): boolean {
  return fx.blurMode === 'PROGRESSIVE'
}

/* ------------------------------------------------------------------ */
/* Bitmap inputs for feImage (displacement map, blur weight gradient)  */
/* ------------------------------------------------------------------ */

const bitmapCache = new Map<string, string>()

function cachedBitmap(key: string, draw: () => string): string {
  const hit = bitmapCache.get(key)
  if (hit) return hit
  const url = draw()
  bitmapCache.set(key, url)
  if (bitmapCache.size > 96) bitmapCache.delete(bitmapCache.keys().next().value as string)
  return url
}

/** Inward distance to the outline and the outward normal at the nearest edge. */
function edgeInfo(node: DesignNode, width: number, height: number): (x: number, y: number) => { dist: number; nx: number; ny: number } {
  const cx = width / 2
  const cy = height / 2
  if (node.type === 'ellipse') {
    const a = Math.max(0.5, width / 2)
    const b = Math.max(0.5, height / 2)
    return (x, y) => {
      const u = (x - cx) / a
      const v = (y - cy) / b
      const len = Math.hypot(u, v)
      const gx = u / a
      const gy = v / b
      const g = Math.hypot(gx, gy)
      if (len < 1e-4 || g < 1e-6) return { dist: Math.min(a, b), nx: 0, ny: 0 }
      return { dist: ((1 - len) * len) / g, nx: gx / g, ny: gy / g }
    }
  }
  const poly = polygonVertices(node, width, height)
  if (poly) {
    return (x, y) => {
      let best = Infinity
      let nx = 0
      let ny = 0
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const ex = b.x - a.x
        const ey = b.y - a.y
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / (ex * ex + ey * ey || 1)))
        const px = a.x + ex * t - x
        const py = a.y + ey * t - y
        const d = Math.hypot(px, py)
        if (d < best) {
          best = d
          nx = d > 1e-6 ? px / d : 0
          ny = d > 1e-6 ? py / d : 0
        }
      }
      return { dist: best, nx, ny }
    }
  }
  const radii = boxRadii(node, width, height)
  return (x, y) => {
    const sx = x < cx ? -1 : 1
    const sy = y < cy ? -1 : 1
    const r = sy < 0 ? (sx < 0 ? radii.tl : radii.tr) : sx < 0 ? radii.bl : radii.br
    const qx = Math.abs(x - cx) - (cx - r)
    const qy = Math.abs(y - cy) - (cy - r)
    if (qx > 0 && qy > 0) {
      const len = Math.hypot(qx, qy)
      return { dist: r - len, nx: (sx * qx) / len, ny: (sy * qy) / len }
    }
    if (qx > qy) return { dist: r - qx, nx: sx, ny: 0 }
    return { dist: r - qy, nx: 0, ny: sy }
  }
}

/**
 * Displacement map for glass refraction: near the outline, pixels sample further inward (like light
 * bending through a lens edge). R/G encode the x/y offset around 0.5. `splay` widens the bend.
 */
function glassMap(node: DesignNode, width: number, height: number, depth: number, splay: number): string {
  const radii = boxRadii(node, width, height)
  const key = ['glass', node.type, Math.round(width), Math.round(height), depth, splay, radii.tl, radii.tr, radii.br, radii.bl].join('|')
  return cachedBitmap(key, () => {
    const k = Math.min(1, 220 / Math.max(width, height, 1))
    const mw = Math.max(2, Math.round(width * k))
    const mh = Math.max(2, Math.round(height * k))
    const canvas = document.createElement('canvas')
    canvas.width = mw
    canvas.height = mh
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const image = ctx.createImageData(mw, mh)
    const info = edgeInfo(node, width, height)
    const power = Math.max(0.6, 2.2 - (splay / 100) * 1.6)
    for (let j = 0; j < mh; j++) {
      for (let i = 0; i < mw; i++) {
        const x = ((i + 0.5) / mw) * width
        const y = ((j + 0.5) / mh) * height
        const { dist, nx, ny } = info(x, y)
        const t = Math.min(1, Math.max(0, dist / depth))
        const f = Math.pow(1 - t, power)
        const o = (j * mw + i) * 4
        image.data[o] = Math.round(128 - nx * f * 127)
        image.data[o + 1] = Math.round(128 - ny * f * 127)
        image.data[o + 2] = 128
        image.data[o + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL()
  })
}

/** Black → white ramp along the progressive blur line, over a box padded by `pad` on every side. */
function rampMap(width: number, height: number, pad: number, start: Point, end: Point): string {
  const key = ['ramp', Math.round(width), Math.round(height), Math.round(pad), start.x, start.y, end.x, end.y].join('|')
  return cachedBitmap(key, () => {
    const fullW = width + pad * 2
    const fullH = height + pad * 2
    const k = Math.min(1, 160 / Math.max(fullW, fullH, 1))
    const mw = Math.max(2, Math.round(fullW * k))
    const mh = Math.max(2, Math.round(fullH * k))
    const canvas = document.createElement('canvas')
    canvas.width = mw
    canvas.height = mh
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const sx = (pad + start.x * width) * k
    const sy = (pad + start.y * height) * k
    const ex = (pad + end.x * width) * k
    let ey = (pad + end.y * height) * k
    if (Math.hypot(ex - sx, ey - sy) < 0.5) ey = sy + 1
    const gradient = ctx.createLinearGradient(sx, sy, ex, ey)
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(1, '#ffffff')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, mw, mh)
    return canvas.toDataURL()
  })
}

/* ------------------------------------------------------------------ */
/* Filter primitives                                                   */
/* ------------------------------------------------------------------ */

const BLUR_LEVELS = 5

/** Blend between several blur strengths using a ramp image, so blur grows along the progressive line. */
function progressiveBlurPrimitives(
  prefix: string,
  input: string,
  startRadius: number,
  endRadius: number,
  ramp: string,
  region: { x: number; y: number; width: number; height: number }
): { nodes: ReactNode[]; result: string } {
  const nodes: ReactNode[] = [
    <feImage
      key="ramp"
      href={ramp}
      x={region.x}
      y={region.y}
      width={region.width}
      height={region.height}
      preserveAspectRatio="none"
      result={`${prefix}-ramp`}
    />,
    <feColorMatrix
      key="ramp-alpha"
      in={`${prefix}-ramp`}
      type="matrix"
      values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"
      result={`${prefix}-weight`}
    />
  ]
  let sum = ''
  for (let i = 0; i < BLUR_LEVELS; i++) {
    const radius = startRadius + ((endRadius - startRadius) * i) / (BLUR_LEVELS - 1)
    const sigma = Math.max(0, radius / 2)
    const blurred = sigma > 0.05 ? `${prefix}-b${i}` : input
    if (sigma > 0.05) {
      nodes.push(<feGaussianBlur key={`b${i}`} in={input} stdDeviation={sigma} edgeMode="duplicate" result={blurred} />)
    }
    const table = Array.from({ length: BLUR_LEVELS }, (_, j) => (j === i ? 1 : 0)).join(' ')
    nodes.push(
      <feComponentTransfer key={`w${i}`} in={`${prefix}-weight`} result={`${prefix}-w${i}`}>
        <feFuncA type="table" tableValues={table} />
      </feComponentTransfer>,
      <feComposite
        key={`p${i}`}
        in={blurred}
        in2={`${prefix}-w${i}`}
        operator="arithmetic"
        k1={1}
        k2={0}
        k3={0}
        k4={0}
        result={`${prefix}-p${i}`}
      />
    )
    if (i === 0) {
      sum = `${prefix}-p0`
    } else {
      const next = `${prefix}-s${i}`
      nodes.push(
        <feComposite key={`s${i}`} in={sum} in2={`${prefix}-p${i}`} operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result={next} />
      )
      sum = next
    }
  }
  return { nodes, result: sum }
}

function GlassFilter({ id, node, fx, width, height }: { id: string; node: DesignNode; fx: DesignEffect; width: number; height: number }) {
  const depth = Math.max(1, fx.depth ?? 20)
  const map = glassMap(node, width, height, depth, fx.splay ?? 0)
  const shift = (fx.refraction ?? 0.8) * depth * 2
  const dispersion = Math.max(0, Math.min(1, fx.dispersion ?? 0.5))
  const frost = Math.max(0, fx.radius ?? 0) / 2
  const source = frost > 0.05 ? 'frost' : 'SourceGraphic'
  const channel = (name: string, scale: number, matrix: string) => [
    <feDisplacementMap
      key={`${name}-d`}
      in={source}
      in2="map"
      scale={scale}
      xChannelSelector="R"
      yChannelSelector="G"
      result={`${name}-d`}
    />,
    <feColorMatrix key={`${name}-c`} in={`${name}-d`} type="matrix" values={matrix} result={name} />
  ]
  return (
    <filter id={id} x="0" y="0" width={width} height={height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      {frost > 0.05 && <feGaussianBlur in="SourceGraphic" stdDeviation={frost} edgeMode="duplicate" result="frost" />}
      <feImage href={map} x="0" y="0" width={width} height={height} preserveAspectRatio="none" result="map" />
      {dispersion > 0.01 ? (
        <>
          {channel('r', shift * (1 + dispersion * 0.35), '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
          {channel('g', shift, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
          {channel('b', shift * (1 - dispersion * 0.35), '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
          <feBlend in="r" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b" mode="screen" />
        </>
      ) : (
        <feDisplacementMap in={source} in2="map" scale={shift} xChannelSelector="R" yChannelSelector="G" />
      )}
    </filter>
  )
}

function ProgressiveBackdropFilter({ id, fx, width, height }: { id: string; fx: DesignEffect; width: number; height: number }) {
  const { start, end } = progressiveLine(fx)
  const ramp = rampMap(width, height, 0, start, end)
  const { nodes, result } = progressiveBlurPrimitives('pb', 'SourceGraphic', fx.startRadius ?? 0, fx.radius ?? 0, ramp, {
    x: 0,
    y: 0,
    width,
    height
  })
  return (
    <filter id={id} x="0" y="0" width={width} height={height} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      {nodes}
      <feColorMatrix in={result} type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0 1" />
    </filter>
  )
}

function ProgressiveLayerFilter({ id, fx, width, height }: { id: string; fx: DesignEffect; width: number; height: number }) {
  const { start, end } = progressiveLine(fx)
  const pad = Math.ceil(Math.max(fx.startRadius ?? 0, fx.radius ?? 0) * 1.5) + 2
  const ramp = rampMap(width, height, pad, start, end)
  const region = { x: -pad, y: -pad, width: width + pad * 2, height: height + pad * 2 }
  const { nodes, result } = progressiveBlurPrimitives('lb', 'SourceGraphic', fx.startRadius ?? 0, fx.radius ?? 0, ramp, region)
  return (
    <filter id={id} {...region} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      {nodes}
      <feMerge>
        <feMergeNode in={result} />
      </feMerge>
    </filter>
  )
}

function TextureFilter({ id, fx, width, height }: { id: string; fx: DesignEffect; width: number; height: number }) {
  const sizeX = Math.max(0.05, fx.noiseSizeX ?? 0.5)
  const sizeY = Math.max(0.05, fx.noiseSizeY ?? sizeX)
  const radius = Math.max(0, fx.radius ?? 2)
  const pad = Math.ceil(radius * 2) + 2
  return (
    <filter
      id={id}
      x={-pad}
      y={-pad}
      width={width + pad * 2}
      height={height + pad * 2}
      filterUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${Math.min(1, 0.5 / sizeX)} ${Math.min(1, 0.5 / sizeY)}`}
        numOctaves={3}
        seed={seedOf(fx.id)}
        result="noise"
      />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale={radius * 2.5} xChannelSelector="R" yChannelSelector="G" result="rough" />
      {fx.clipToShape ? <feComposite in="rough" in2="SourceGraphic" operator="in" /> : null}
    </filter>
  )
}

/** Hidden filter definitions referenced by the layer's `filter` / `backdrop-filter` styles. */
export function EffectDefs({ node, width, height }: { node: DesignNode; width: number; height: number }) {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const filters: ReactNode[] = []
  for (const fx of visibleEffects(node)) {
    if (fx.type === 'GLASS') {
      filters.push(<GlassFilter key={fx.id} id={effectId('glass', node, fx)} node={node} fx={fx} width={w} height={h} />)
    } else if (fx.type === 'BACKGROUND_BLUR' && isProgressive(fx)) {
      filters.push(<ProgressiveBackdropFilter key={fx.id} id={effectId('pbg', node, fx)} fx={fx} width={w} height={h} />)
    } else if (fx.type === 'LAYER_BLUR' && isProgressive(fx)) {
      filters.push(<ProgressiveLayerFilter key={fx.id} id={effectId('plb', node, fx)} fx={fx} width={w} height={h} />)
    } else if (fx.type === 'TEXTURE') {
      filters.push(<TextureFilter key={fx.id} id={effectId('tex', node, fx)} fx={fx} width={w} height={h} />)
    }
  }
  if (!filters.length) return null
  return (
    <svg className="design-effect-defs" width="0" height="0" aria-hidden>
      <defs>{filters}</defs>
    </svg>
  )
}

/** `backdrop-filter` for background blur + glass (Figma blur radius = 2× CSS standard deviation). */
export function backdropFilterCss(node: DesignNode): string | undefined {
  const parts: string[] = []
  for (const fx of visibleEffects(node)) {
    if (fx.type === 'GLASS') {
      parts.push(`url(#${effectId('glass', node, fx)})`)
    } else if (fx.type === 'BACKGROUND_BLUR') {
      if (isProgressive(fx)) parts.push(`url(#${effectId('pbg', node, fx)})`)
      else if ((fx.radius ?? 0) > 0) parts.push(`blur(${(fx.radius ?? 0) / 2}px)`)
    }
  }
  return parts.length ? parts.join(' ') : undefined
}

/** `filter` parts for texture + layer blur, applied to the layer itself. */
export function layerFilterParts(node: DesignNode): string[] {
  const parts: string[] = []
  for (const fx of visibleEffects(node)) {
    if (fx.type === 'TEXTURE' && (fx.radius ?? 0) > 0) parts.push(`url(#${effectId('tex', node, fx)})`)
  }
  for (const fx of visibleEffects(node)) {
    if (fx.type !== 'LAYER_BLUR') continue
    if (isProgressive(fx)) parts.push(`url(#${effectId('plb', node, fx)})`)
    else if ((fx.radius ?? 0) > 0) parts.push(`blur(${(fx.radius ?? 0) / 2}px)`)
  }
  return parts
}

/* ------------------------------------------------------------------ */
/* Overlays                                                            */
/* ------------------------------------------------------------------ */

function GlassLight({ node, fx, width, height }: { node: DesignNode; fx: DesignEffect; width: number; height: number }) {
  const intensity = Math.max(0, Math.min(1, fx.lightIntensity ?? 0.8))
  if (intensity <= 0) return null
  const rad = (((fx.lightAngle ?? -45) - 90) * Math.PI) / 180
  const lx = Math.cos(rad)
  const ly = Math.sin(rad)
  const reach = Math.hypot(width, height) / 2
  const rim = Math.max(1, Math.min(3, (fx.depth ?? 20) / 14))
  const uid = `${safeId(node.id)}-${safeId(fx.id)}`
  const d = outlinePath(node, width, height)
  return (
    <svg className="design-effect-overlay design-effect-light" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ clipPath: `path('${d}')` }} aria-hidden>
      <defs>
        <linearGradient
          id={`fx-light-${uid}`}
          gradientUnits="userSpaceOnUse"
          x1={width / 2 + lx * reach}
          y1={height / 2 + ly * reach}
          x2={width / 2 - lx * reach}
          y2={height / 2 - ly * reach}
        >
          <stop offset="0" stopColor="#FFFFFF" stopOpacity={intensity} />
          <stop offset="0.38" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="0.62" stopColor="#FFFFFF" stopOpacity={0} />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity={intensity * 0.6} />
        </linearGradient>
        <filter id={`fx-light-soft-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={rim * 2} />
        </filter>
      </defs>
      <path d={d} fill="none" stroke={`url(#fx-light-${uid})`} strokeWidth={rim * 8} opacity={0.35} filter={`url(#fx-light-soft-${uid})`} />
      <path d={d} fill="none" stroke={`url(#fx-light-${uid})`} strokeWidth={rim * 2} />
    </svg>
  )
}

function noiseThresholdTable(density: number): string {
  const threshold = 0.5 + (1 - Math.max(0, Math.min(1, density))) * 0.3
  return Array.from({ length: 64 }, (_, i) => (i / 63 >= threshold ? 1 : 0)).join(' ')
}

function NoiseOverlay({ fx, style }: { fx: DesignEffect; style: CSSProperties }) {
  const sizeX = Math.max(0.05, fx.noiseSizeX ?? 0.5)
  const sizeY = Math.max(0.05, fx.noiseSizeY ?? sizeX)
  const frequency = `${Math.min(1, 0.5 / sizeX)} ${Math.min(1, 0.5 / sizeY)}`
  const kind = fx.noiseType || 'MONOTONE'
  const uid = `noise-${safeId(fx.id)}`
  const seed = seedOf(fx.id)
  return (
    <div
      className="design-effect-overlay"
      style={{
        ...style,
        mixBlendMode: cssBlendMode(fx.blendMode || 'Normal'),
        opacity: kind === 'MULTITONE' ? Math.max(0, Math.min(1, fx.opacity ?? 1)) : undefined
      }}
      aria-hidden
    >
      <svg width="100%" height="100%">
        <defs>
          <filter id={uid} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={2} seed={seed} result="noise" />
            <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="level" />
            <feComponentTransfer in="level" result="mask">
              <feFuncA type="discrete" tableValues={noiseThresholdTable(fx.density ?? 1)} />
            </feComponentTransfer>
            {kind === 'MULTITONE' ? (
              <>
                <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={1} seed={seed + 17} result="hue" />
                <feColorMatrix
                  in="hue"
                  type="matrix"
                  values="5 0 0 0 -2  0 5 0 0 -2  0 0 5 0 -2  0 0 0 0 1"
                  result="colors"
                />
                <feComposite in="colors" in2="mask" operator="in" />
              </>
            ) : (
              <>
                <feFlood floodColor={toHex(fx.color, '#000000')} floodOpacity={fx.opacity ?? 0.25} result="primary" />
                <feComposite in="primary" in2="mask" operator="in" result="specks" />
                {kind === 'DUOTONE' ? (
                  <>
                    <feComponentTransfer in="mask" result="rest">
                      <feFuncA type="table" tableValues="1 0" />
                    </feComponentTransfer>
                    <feFlood floodColor={toHex(fx.secondaryColor, '#FFFFFF')} floodOpacity={fx.secondaryOpacity ?? 0} result="secondary" />
                    <feComposite in="secondary" in2="rest" operator="in" result="base" />
                    <feMerge>
                      <feMergeNode in="base" />
                      <feMergeNode in="specks" />
                    </feMerge>
                  </>
                ) : null}
              </>
            )}
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${uid})`} />
      </svg>
    </div>
  )
}

/** Clip for overlays: rounded box for boxed layers, the exact outline for SVG shapes. */
export function overlayClip(node: DesignNode, width: number, height: number): string | undefined {
  return isOutlineShape(node) ? `path('${outlinePath(node, width, height)}')` : undefined
}

/**
 * Backdrop layer for SVG-outline shapes: they have no CSS box to carry `backdrop-filter`, so blur / glass
 * sit on a clipped layer beneath the outline.
 */
export function OutlineBackdrop({ node, width, height }: { node: DesignNode; width: number; height: number }) {
  if (!isOutlineShape(node)) return null
  const backdrop = backdropFilterCss(node)
  if (!backdrop) return null
  return (
    <div
      className="design-effect-backdrop"
      style={{ clipPath: overlayClip(node, width, height), backdropFilter: backdrop, WebkitBackdropFilter: backdrop }}
      aria-hidden
    />
  )
}

/** Drop shadow that stays visible through transparent fills ("Show behind transparent areas"). */
export function BehindShadows({ node, radius }: { node: DesignNode; radius: string | number }) {
  if (isOutlineShape(node)) return null
  const shadows = visibleEffects(node).filter((fx) => fx.type === 'DROP_SHADOW' && fx.showShadowBehindNode)
  if (!shadows.length) return null
  return (
    <>
      {shadows.map((fx) => {
        const spread = fx.spread ?? 0
        return (
          <div
            key={fx.id}
            className="design-effect-behind"
            style={{
              inset: -spread,
              borderRadius: radius,
              background: withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25),
              transform: `translate(${fx.offsetX ?? 0}px, ${fx.offsetY ?? 4}px)`,
              filter: (fx.radius ?? 0) > 0 ? `blur(${(fx.radius ?? 0) / 2}px)` : undefined
            }}
            aria-hidden
          />
        )
      })}
    </>
  )
}

/** Noise / glass light / shader overlays drawn on top of the layer's fill. */
export function EffectOverlayLayers({
  node,
  width,
  height,
  radius,
  renderShader
}: {
  node: DesignNode
  width: number
  height: number
  radius: string | number
  renderShader: (fx: DesignEffect) => ReactNode
}) {
  const effects = visibleEffects(node)
  if (!effects.length) return null
  const clip = overlayClip(node, width, height)
  const shape: CSSProperties = clip ? { clipPath: clip } : { borderRadius: radius }
  return (
    <>
      {effects.map((fx) => {
        if (fx.type === 'NOISE') return <NoiseOverlay key={fx.id} fx={fx} style={shape} />
        if (fx.type === 'GLASS') {
          return <GlassLight key={fx.id} node={node} fx={fx} width={Math.max(1, width)} height={Math.max(1, height)} />
        }
        if (fx.type === 'SHADER' && fx.shader) {
          return (
            <div
              key={fx.id}
              className="design-effect-overlay"
              style={{ ...shape, mixBlendMode: cssBlendMode(fx.blendMode || 'Normal') }}
              aria-hidden
            >
              {renderShader(fx)}
            </div>
          )
        }
        return null
      })}
    </>
  )
}

/** Drop + inner shadows for SVG-outline shapes, following the outline (with spread). */
export function ShapeShadowFilter({ id, node, width, height }: { id: string; node: DesignNode; width: number; height: number }) {
  const shadows = visibleEffects(node).filter((fx) => fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW')
  if (!shadows.length) return null
  const pad = Math.max(8, ...shadows.map((fx) => Math.abs(fx.offsetX ?? 0) + Math.abs(fx.offsetY ?? 4) + (fx.radius ?? 4) * 1.5 + Math.abs(fx.spread ?? 0)))
  const drops = shadows.filter((fx) => fx.type === 'DROP_SHADOW')
  const inners = shadows.filter((fx) => fx.type === 'INNER_SHADOW')
  const shadow = (fx: DesignEffect, index: number, inner: boolean): ReactNode[] => {
    const key = `${inner ? 'i' : 'd'}${index}`
    const spread = fx.spread ?? 0
    const base = inner ? `${key}-inv` : 'SourceAlpha'
    const out: ReactNode[] = []
    if (inner) {
      out.push(
        <feComponentTransfer key={`${key}-inv`} in="SourceAlpha" result={`${key}-inv`}>
          <feFuncA type="table" tableValues="1 0" />
        </feComponentTransfer>
      )
    }
    let shape = base
    if (spread !== 0) {
      out.push(
        <feMorphology key={`${key}-m`} in={base} operator={spread > 0 ? 'dilate' : 'erode'} radius={Math.abs(spread)} result={`${key}-m`} />
      )
      shape = `${key}-m`
    }
    out.push(
      <feGaussianBlur key={`${key}-b`} in={shape} stdDeviation={Math.max(0, (fx.radius ?? 4) / 2)} result={`${key}-b`} />,
      <feOffset key={`${key}-o`} in={`${key}-b`} dx={fx.offsetX ?? 0} dy={fx.offsetY ?? 4} result={`${key}-o`} />,
      <feFlood key={`${key}-f`} floodColor={toHex(fx.color, '#000000')} floodOpacity={fx.opacity ?? 0.25} result={`${key}-f`} />,
      <feComposite key={`${key}-c`} in={`${key}-f`} in2={`${key}-o`} operator="in" result={inner ? `${key}-c` : key} />
    )
    if (inner) out.push(<feComposite key={`${key}-clip`} in={`${key}-c`} in2="SourceAlpha" operator="in" result={key} />)
    return out
  }
  return (
    <filter id={id} x={-pad} y={-pad} width={width + pad * 2} height={height + pad * 2} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      {drops.map((fx, index) => shadow(fx, index, false))}
      {inners.map((fx, index) => shadow(fx, index, true))}
      <feMerge>
        {drops.map((_, index) => (
          <feMergeNode key={`d${index}`} in={`d${index}`} />
        ))}
        <feMergeNode in="SourceGraphic" />
        {inners.map((_, index) => (
          <feMergeNode key={`i${index}`} in={`i${index}`} />
        ))}
      </feMerge>
    </filter>
  )
}

/* ------------------------------------------------------------------ */
/* On-canvas progressive blur handles                                  */
/* ------------------------------------------------------------------ */

type Box = { x: number; y: number; width: number; height: number }

/** Figma's progressive blur line: drag either end to set where the blur starts and ends. */
export function BlurHandles({ box, transform, edit }: { box: Box; transform?: string; edit: Exclude<BlurEdit, null> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const W = Math.max(1, box.width)
  const H = Math.max(1, box.height)
  const S = { x: edit.start.x * W, y: edit.start.y * H }
  const E = { x: edit.end.x * W, y: edit.end.y * H }

  const drag = (event: ReactPointerEvent, which: 'start' | 'end') => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const move = (next: PointerEvent) => {
      const ctm = svgRef.current?.getScreenCTM()
      const live = getBlurEdit()
      if (!ctm || !live) return
      const local = new DOMPoint(next.clientX, next.clientY).matrixTransform(ctm.inverse())
      const point = { x: local.x / W, y: local.y / H }
      if (which === 'start') live.onChange(point, live.end)
      else live.onChange(live.start, point)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-gradient-drag')
    }
    document.body.classList.add('is-gradient-drag')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className="gradient-handles"
      style={{ left: box.x, top: box.y, width: W, height: H, transform, transformOrigin: 'center center' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <svg ref={svgRef} className="gradient-handles-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line className="gradient-line-shadow" x1={S.x} y1={S.y} x2={E.x} y2={E.y} />
        <line className="gradient-line" x1={S.x} y1={S.y} x2={E.x} y2={E.y} />
      </svg>
      <span className="gradient-dot-anchor" style={{ left: S.x, top: S.y }}>
        <span className="gradient-dot" title="Blur start" onPointerDown={(event) => drag(event, 'start')} />
      </span>
      <span className="gradient-dot-anchor" style={{ left: E.x, top: E.y }}>
        <span className="gradient-dot" title="Blur end" onPointerDown={(event) => drag(event, 'end')} />
      </span>
    </div>
  )
}
