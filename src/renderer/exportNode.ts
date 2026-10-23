import type { DesignNode, ExportFormat, ExportSetting } from '../shared/types'
import { getNodePaints } from '../shared/paint'
import { absoluteBounds, childIndexOf } from '../shared/layoutEngine'
import { clampCornerRadii, cornersAreIndependent, resolveCornerRadii, roundedRectPath } from '../shared/corners'
import { imageAdjustActive, imageAdjustFilterMarkup } from '../shared/imageAdjust'
import { hexToRgb, parseHex, rgbToHsl, withAlpha } from './colorMath'

/** Light near-neutral surfaces that should follow the themed page fill in dark thumbs. */
function isLightSurfaceHex(hex: string): boolean {
  const value = parseHex(hex, '#000000').toLowerCase()
  const { l, s } = rgbToHsl(hexToRgb(value))
  // Broad net: any near-neutral mid→light grey used as UI chrome.
  return l >= 48 && s <= 22
}

function darkSurfaceForLight(hex: string, pageFill: string): string {
  const { l } = rgbToHsl(hexToRgb(parseHex(hex, '#FFFFFF')))
  if (l >= 96) return '#3a3a3a'
  if (l >= 88) return '#333333'
  if (l >= 70) return '#2f2f2f'
  return pageFill
}

function nodeSolidHex(node: DesignNode, fallback = ''): string {
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const solid = paints.find((paint) => paint.type === 'solid')
  if (solid && solid.type === 'solid') return toHex(solid.color, fallback || '#000000')
  if (node.fill) return toHex(node.fill, fallback || '#000000')
  return fallback
}

/** Remap light UI chrome + dark type so dark-mode thumbs match a dark canvas. */
function themeNodesForThumb(
  nodes: DesignNode[],
  theme: 'light' | 'dark',
  pageFill: string,
  rootId?: string
): DesignNode[] {
  if (theme !== 'dark') return nodes
  return nodes.map((node) => {
    if (node.type === 'comment' || node.visible === false) return node
    if (node.type === 'image') return node

    if (node.type === 'text') {
      const hex = nodeSolidHex(node, '#000000')
      const { l, s } = rgbToHsl(hexToRgb(hex))
      if (l <= 42) return { ...node, fill: '#F1F1F1', fills: [] }
      if (l <= 72 && s <= 20) return { ...node, fill: '#B3B3B3', fills: [] }
      return node
    }

    // Transparent root frames still need an opaque dark surface in the thumb.
    const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
    const solid = paints.find((paint) => paint.type === 'solid')
    const hex =
      solid && solid.type === 'solid'
        ? toHex(solid.color, '')
        : node.fill
          ? toHex(node.fill, '')
          : ''

    if (!hex) {
      // Only the root artboard needs an opaque dark surface when it has no fill.
      if (node.id === rootId) return { ...node, fill: pageFill, fills: [] }
      return node
    }
    if (!isLightSurfaceHex(hex)) return node
    const next = darkSurfaceForLight(hex, pageFill)
    if (paints.length) {
      return {
        ...node,
        fill: next,
        fills: paints.map((paint) =>
          paint.type === 'solid' && paint.visible !== false
            ? { ...paint, color: isLightSurfaceHex(paint.color) ? darkSurfaceForLight(paint.color, pageFill) : paint.color }
            : paint
        )
      }
    }
    return { ...node, fill: next, fills: [] }
  })
}

function toHex(color: string | undefined, fallback = '#DDDDDD'): string {
  return parseHex(color || fallback, fallback)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function fillCss(node: DesignNode): string {
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const top = paints[0]
  if (top?.type === 'solid') return withAlpha(top.color, top.opacity)
  if (top?.type === 'image' && top.imageDataUrl) return 'none'
  // Match canvas: frames/sections with no fill stay transparent (not #DDDDDD).
  if (!top && (node.type === 'frame' || node.type === 'section')) return 'none'
  if (!node.fill && node.fillOpacity == null && !top) {
    if (node.type === 'frame' || node.type === 'section') return 'none'
  }
  return withAlpha(toHex(node.fill, '#DDDDDD'), node.fillOpacity ?? 1)
}

function strokeAttrs(node: DesignNode): string {
  const width = node.strokeWidth || 0
  if (!width) return 'stroke="none"'
  const color = withAlpha(toHex(node.stroke, '#1A1A1A'), node.strokeOpacity ?? 1)
  const align = node.strokeAlign || 'center'
  // SVG only supports center strokes; approximate inside/outside with 2× weight.
  const sw = align === 'center' ? width : width * 2
  return `stroke="${escapeXml(color)}" stroke-width="${sw}"`
}

/** Base64 data URLs are XML-safe already; escaping copies megabytes of image data per node. */
function escapeHref(value: string): string {
  return /^data:[\w/+.-]+;base64,[A-Za-z0-9+/=]*$/.test(value.slice(0, 64)) && !/["<>&']/.test(value)
    ? value
    : escapeXml(value)
}

function shapeMarkup(node: DesignNode, width: number, height: number, allNodes: DesignNode[] = []): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapeInner(node, width, height, allNodes)}</svg>`
}

function shapeInner(node: DesignNode, width: number, height: number, allNodes: DesignNode[]): string {
  const fill = fillCss(node)
  const stroke = strokeAttrs(node)
  const opacity = node.opacity ?? 1
  const radii = clampCornerRadii(resolveCornerRadii(node), width, height)
  const independent = cornersAreIndependent(radii)
  const imagePaint = getNodePaints(node).find((p) => p.type === 'image' && p.imageDataUrl)
  const img =
    node.type === 'image' && node.imageDataUrl
      ? node.imageDataUrl
      : imagePaint && imagePaint.type === 'image'
        ? imagePaint.imageDataUrl
        : undefined

  let body = ''
  if (node.type === 'ellipse') {
    body = `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(fill)}" ${stroke} />`
  } else if (node.type === 'polygon') {
    body = `<polygon points="${width / 2},0 ${width},${height} 0,${height}" fill="${escapeXml(fill)}" ${stroke} />`
  } else if (node.type === 'star') {
    body = `<polygon points="${starPoints(width, height)}" fill="${escapeXml(fill)}" ${stroke} />`
  } else if (node.type === 'line' || node.type === 'arrow') {
    const color = escapeXml(withAlpha(toHex(node.stroke || node.fill, '#1A1A1A'), node.strokeOpacity ?? 1))
    body = `<line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="${color}" stroke-width="${node.strokeWidth || 2}" />`
  } else if (node.type === 'text') {
    const size = node.fontSize || 12
    const family = escapeXml(node.fontFamily || 'Inter')
    const weight = node.fontWeight || 400
    const color = escapeXml(withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1))
    const align = node.textAlign || 'left'
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
    const x = align === 'center' ? width / 2 : align === 'right' ? width : 0
    body = `<text x="${x}" y="${size}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(node.text || '')}</text>`
  } else {
    // frame / rect / section / widget / image
    if (independent || radii.tl > 0) {
      if (independent) {
        body = `<path d="${roundedRectPath(width, height, radii)}" fill="${escapeXml(fill)}" ${stroke} />`
      } else {
        body = `<rect width="${width}" height="${height}" rx="${radii.tl}" ry="${radii.tl}" fill="${escapeXml(fill)}" ${stroke} />`
      }
    } else {
      body = `<rect width="${width}" height="${height}" fill="${escapeXml(fill)}" ${stroke} />`
    }
    if (img) {
      const clipId = `clip-${node.id}`
      const adjustOn = imagePaint?.type === 'image' && imageAdjustActive(imagePaint)
      const adjustId = `ia-${node.id}`
      const clip =
        independent || radii.tl > 0
          ? independent
            ? `<clipPath id="${clipId}"><path d="${roundedRectPath(width, height, radii)}" /></clipPath>`
            : `<clipPath id="${clipId}"><rect width="${width}" height="${height}" rx="${radii.tl}" ry="${radii.tl}" /></clipPath>`
          : ''
      const cropBox = imagePaint?.type === 'image' && imagePaint.scaleMode === 'crop' ? imagePaint.imageBox : undefined
      // Crop mode places the image explicitly and always clips to the layer box.
      const clipMarkup =
        clip || (cropBox ? `<clipPath id="${clipId}"><rect width="${width}" height="${height}" /></clipPath>` : '')
      body += clipMarkup
      const aspect = node.type === 'image' || cropBox ? 'none' : 'xMidYMid slice'
      const placement = cropBox
        ? `x="${cropBox.x * width}" y="${cropBox.y * height}" width="${cropBox.w * width}" height="${cropBox.h * height}"`
        : `width="${width}" height="${height}"`
      body += `<image href="${escapeHref(img)}" ${placement} preserveAspectRatio="${aspect}"${
        clipMarkup ? ` clip-path="url(#${clipId})"` : ''
      }${adjustOn ? ` filter="url(#${adjustId})"` : ''} />`
    }
  }

  // Nested children (local coords relative to this node)
  if (node.type === 'frame' || node.type === 'section') {
    const kids = childIndexOf(allNodes).get(node.id) || []
    for (const child of kids) {
      const cw = Math.max(1, Math.round(child.width || 1))
      const ch = Math.max(1, Math.round(child.height || (child.type === 'text' ? child.fontSize || 12 : 1)))
      body += `<g transform="translate(${child.x || 0} ${child.y || 0})">${shapeInner(child, cw, ch, allNodes)}</g>`
    }
  }

  const filters: string[] = []
  if (imagePaint?.type === 'image' && imageAdjustActive(imagePaint)) {
    filters.push(
      `<filter id="ia-${escapeXml(node.id)}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">${imageAdjustFilterMarkup(imagePaint)}</filter>`
    )
  }
  const effects = (node.effects || []).filter((fx) => fx.visible !== false)
  const dropShadows = effects.filter((fx) => fx.type === 'DROP_SHADOW')
  const legacyDrop = !effects.length && node.shadow && node.shadowType !== 'inner'
  if (dropShadows.length || legacyDrop) {
    const fx = dropShadows[0]
    const dx = fx?.offsetX ?? node.shadowX ?? 0
    const dy = fx?.offsetY ?? node.shadowY ?? 8
    const blur = ((fx?.radius ?? node.shadowBlur) || 16) / 2
    const color = withAlpha(toHex(fx?.color || node.shadowColor, '#000000'), fx?.opacity ?? node.shadowOpacity ?? 0.28)
    filters.push(
      `<filter id="sh-${escapeXml(node.id)}"><feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${blur}" flood-color="${escapeXml(color)}" /></filter>`
    )
  }
  const layerBlurFx = effects.find((fx) => fx.type === 'LAYER_BLUR')
  const layerBlur = layerBlurFx ? (layerBlurFx.radius ?? 0) : node.layerBlur || 0
  if (layerBlur > 0) {
    filters.push(`<filter id="bl-${escapeXml(node.id)}"><feGaussianBlur stdDeviation="${layerBlur / 2}" /></filter>`)
  }
  const filterAttr = dropShadows.length || legacyDrop
    ? `filter="url(#sh-${escapeXml(node.id)})"`
    : layerBlur > 0
      ? `filter="url(#bl-${escapeXml(node.id)})"`
      : ''
  const defs = filters.length ? `<defs>${filters.join('')}</defs>` : ''
  return `${defs}<g opacity="${opacity}" ${filterAttr}>${body}</g>`
}

function starPoints(width: number, height: number, spikes = 5): string {
  const cx = width / 2
  const cy = height / 2
  const outer = Math.min(width, height) / 2
  const inner = outer * 0.4
  const points: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`)
  }
  return points.join(' ')
}

export function nodeToSvg(node: DesignNode, allNodes: DesignNode[] = []): string {
  const w = Math.max(1, Math.round(node.width || 1))
  const h = Math.max(
    1,
    Math.round(node.height || (node.type === 'text' ? node.fontSize || 12 : 1))
  )
  return shapeMarkup(node, w, h, allNodes)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function svgToCanvas(svg: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  } finally {
    URL.revokeObjectURL(url)
  }
  return canvas
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to rasterize export'))
    image.src = url
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      type,
      quality
    )
  })
}

/** Minimal PDF with a single embedded JPEG/PNG image (DeviceRGB via JPEG). */
async function pngToPdf(pngBlob: Blob, width: number, height: number): Promise<Blob> {
  // Convert PNG → JPEG for simpler PDF embedding
  const pngUrl = URL.createObjectURL(pngBlob)
  try {
    const image = await loadImage(pngUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0)
    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
    const jpeg = new Uint8Array(await jpegBlob.arrayBuffer())
    return buildPdfWithJpeg(jpeg, width, height)
  } finally {
    URL.revokeObjectURL(pngUrl)
  }
}

function buildPdfWithJpeg(jpeg: Uint8Array, width: number, height: number): Blob {
  const encoder = new TextEncoder()
  const objects: Uint8Array[] = []
  const offsets: number[] = []

  const push = (parts: Array<string | Uint8Array>) => {
    const chunks = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part))
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    objects.push(out)
  }

  push([`<< /Type /Catalog /Pages 2 0 R >>\n`])
  push([`<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n`])
  push([
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>\n`
  ])
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`
  push([`<< /Length ${content.length} >>\nstream\n${content}endstream\n`])
  push([
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    `\nendstream\n`
  ])

  const header = encoder.encode('%PDF-1.4\n')
  let cursor = header.length
  const bodyParts: Uint8Array[] = [header]
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = cursor
    const objHeader = encoder.encode(`${i + 1} 0 obj\n`)
    const objFooter = encoder.encode(`\nendobj\n`)
    bodyParts.push(objHeader, objects[i], objFooter)
    cursor += objHeader.length + objects[i].length + objFooter.length
  }

  const xrefStart = cursor
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  bodyParts.push(encoder.encode(xref))

  const total = bodyParts.reduce((sum, part) => sum + part.length, 0)
  const pdf = new Uint8Array(total)
  let at = 0
  for (const part of bodyParts) {
    pdf.set(part, at)
    at += part.length
  }
  return new Blob([pdf], { type: 'application/pdf' })
}

function safeName(node: DesignNode): string {
  const base = (node.name || node.type || 'export').replace(/[^\w\-]+/g, '-').replace(/-+/g, '-')
  return base.slice(0, 48) || 'export'
}

export async function exportNodeSetting(
  node: DesignNode,
  setting: ExportSetting,
  allNodes: DesignNode[] = []
): Promise<void> {
  const box = absoluteBounds(node, allNodes.length ? allNodes : [node])
  const width = Math.max(1, Math.round(box.width))
  const height = Math.max(1, Math.round(box.height))
  const scale = setting.fixedWidth
    ? setting.fixedWidth / width
    : setting.fixedHeight
      ? setting.fixedHeight / height
      : setting.scale > 0
        ? setting.scale
        : 1
  const svg = nodeToSvg(node, allNodes)
  const name = safeName(node)
  const suffix =
    setting.suffix != null
      ? setting.suffix.replace(/[\\/:*?"<>|]+/g, '')
      : setting.fixedWidth || setting.fixedHeight || scale === 1
        ? ''
        : `@${scale}x`

  if (setting.format === 'SVG') {
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name}${suffix}.svg`)
    return
  }

  const canvas = await svgToCanvas(svg, width, height, scale)
  if (setting.format === 'PNG') {
    const blob = await canvasToBlob(canvas, 'image/png')
    downloadBlob(blob, `${name}${suffix}.png`)
    return
  }
  if (setting.format === 'JPG') {
    const quality = Math.max(1, Math.min(100, setting.quality ?? 92)) / 100
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    downloadBlob(blob, `${name}${suffix}.jpg`)
    return
  }
  // PDF
  const png = await canvasToBlob(canvas, 'image/png')
  const pdf = await pngToPdf(png, canvas.width, canvas.height)
  downloadBlob(pdf, `${name}${suffix}.pdf`)
}

export async function exportNodeAsPngBlob(node: DesignNode, allNodes: DesignNode[] = [], scale = 2): Promise<Blob> {
  const box = absoluteBounds(node, allNodes.length ? allNodes : [node])
  const svg = nodeToSvg(node, allNodes)
  const canvas = await svgToCanvas(svg, Math.max(1, box.width), Math.max(1, box.height), scale)
  return canvasToBlob(canvas, 'image/png')
}

/** Figma-style page preview: composite the main artboard into a PNG data URL. */
export async function renderPageThumbnailDataUrl(
  nodes: DesignNode[],
  pageId: string,
  options?: {
    maxEdge?: number
    theme?: 'light' | 'dark'
    pageFill?: string
  }
): Promise<string | null> {
  const maxEdge = options?.maxEdge ?? 1600
  const theme = options?.theme ?? 'light'
  const pageFill =
    options?.pageFill || (theme === 'dark' ? '#2c2c2c' : '#eeeeee')

  const pageNodes = nodes.filter((node) => (node.pageId || 'page-1') === pageId)
  const roots = pageNodes.filter(
    (node) => !node.parentId && node.type !== 'comment' && node.visible !== false
  )
  if (!roots.length) return null

  const frames = roots.filter((node) => node.type === 'frame')
  const sections = roots.filter((node) => node.type === 'section')
  const pool = frames.length ? frames : sections.length ? sections : roots

  // Always frame the single largest artboard so the thumb shows main content clearly.
  const target = [...pool].sort(
    (a, b) =>
      Math.max(1, b.width || 1) * Math.max(1, b.height || 1) -
      Math.max(1, a.width || 1) * Math.max(1, a.height || 1)
  )[0]!

  const localW = Math.max(1, Math.round(target.width || 1))
  const localH = Math.max(
    1,
    Math.round(target.height || (target.type === 'text' ? target.fontSize || 12 : 1))
  )

  // Retina-sharp for small artboards, but never past maxEdge — a tall snapshot at 2× is a
  // 20-megapixel PNG encode on every edit.
  const dpr = typeof window !== 'undefined' ? Math.min(2.5, window.devicePixelRatio || 2) : 2
  const fit = maxEdge / Math.max(localW, localH)
  const scale = Math.min(fit, dpr, 3)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(localW * scale))
  canvas.height = Math.max(1, Math.round(localH * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  const paints = getNodePaints(target).filter((paint) => paint.visible !== false)
  const solid = paints.find((paint) => paint.type === 'solid')
  const themedNodes = themeNodesForThumb(pageNodes, theme, pageFill, target.id)
  const renderTarget = themedNodes.find((node) => node.id === target.id) || target
  // Dark thumbs start from the dark page surface; light thumbs use the artboard fill.
  if (theme === 'dark') {
    ctx.fillStyle = pageFill
  } else {
    const rawFill =
      solid && solid.type === 'solid'
        ? withAlpha(solid.color, solid.opacity)
        : target.fill
          ? withAlpha(toHex(target.fill, pageFill), target.fillOpacity ?? 1)
          : pageFill
    ctx.fillStyle = rawFill
  }
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  try {
    const svg = shapeMarkup(renderTarget, localW, localH, themedNodes)
    const raster = await svgToCanvas(svg, localW, localH, scale)
    ctx.drawImage(raster, 0, 0)
  } catch {
    return null
  }

  // PNG keeps UI screenshots crisp (no JPEG blur).
  return canvas.toDataURL('image/png')
}

export async function copyNodeAsPng(node: DesignNode, allNodes: DesignNode[] = []): Promise<void> {
  const blob = await exportNodeAsPngBlob(node, allNodes, 2)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return
  }
  // Fallback: download
  downloadBlob(blob, `${safeName(node)}.png`)
}

export const DEFAULT_EXPORT_SETTING = (): ExportSetting => ({
  id: `export-${Date.now().toString(36)}`,
  format: 'PNG',
  scale: 1
})

export const EXPORT_SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const
export const EXPORT_FIXED_SIZES = [
  { id: '512w', fixedWidth: 512 },
  { id: '512h', fixedHeight: 512 }
] as const
export const EXPORT_FORMATS: ExportFormat[] = ['PNG', 'JPG', 'SVG', 'PDF']

export function exportFormatLabel(format: ExportFormat): string {
  return format === 'JPG' ? 'JPEG' : format
}

export function exportSizeLabel(setting: ExportSetting): string {
  if (setting.fixedWidth) return `${setting.fixedWidth}w`
  if (setting.fixedHeight) return `${setting.fixedHeight}h`
  return `${setting.scale > 0 ? setting.scale : 1}x`
}

/** Parse Figma-style size input: `2`, `2x`, `0.5x`, `512w`, `300h`. */
export function parseExportSize(
  text: string
): Pick<ExportSetting, 'scale' | 'fixedWidth' | 'fixedHeight'> | null {
  const match = text.trim().toLowerCase().match(/^(\d*\.?\d+)\s*(x|w|h)?$/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2] || 'x'
  if (unit === 'w') return { scale: 1, fixedWidth: Math.round(Math.min(16384, value)), fixedHeight: undefined }
  if (unit === 'h') return { scale: 1, fixedWidth: undefined, fixedHeight: Math.round(Math.min(16384, value)) }
  return { scale: Math.min(32, Math.max(0.01, value)), fixedWidth: undefined, fixedHeight: undefined }
}
