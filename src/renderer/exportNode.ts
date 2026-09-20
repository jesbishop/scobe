import type { DesignNode, ExportFormat, ExportSetting } from '../shared/types'
import { getNodePaints } from '../shared/paint'
import { absoluteBounds } from '../shared/layoutEngine'
import { clampCornerRadii, cornersAreIndependent, resolveCornerRadii, roundedRectPath } from '../shared/corners'
import { imageAdjustActive, imageAdjustFilterMarkup } from '../shared/imageAdjust'
import { parseHex, withAlpha } from './colorMath'

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

function shapeMarkup(node: DesignNode, width: number, height: number, allNodes: DesignNode[] = []): string {
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
      body += clip
      const aspect = node.type === 'image' ? 'none' : 'xMidYMid slice'
      body += `<image href="${escapeXml(img)}" width="${width}" height="${height}" preserveAspectRatio="${aspect}"${
        clip ? ` clip-path="url(#${clipId})"` : ''
      }${adjustOn ? ` filter="url(#${adjustId})"` : ''} />`
    }
  }

  // Nested children (local coords relative to this node)
  if (node.type === 'frame' || node.type === 'section') {
    const kids = allNodes.filter((child) => child.parentId === node.id)
    for (const child of kids) {
      const cw = Math.max(1, Math.round(child.width || 1))
      const ch = Math.max(1, Math.round(child.height || (child.type === 'text' ? child.fontSize || 12 : 1)))
      const inner = shapeMarkup(child, cw, ch, allNodes)
      // strip outer svg wrapper from recursive call — use group instead
      const innerBody = inner.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      body += `<g transform="translate(${child.x || 0} ${child.y || 0})">${innerBody}</g>`
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}<g opacity="${opacity}" ${filterAttr}>${body}</g></svg>`
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
  const box = absoluteBounds(node, allNodes.length ? allNodes : [node])
  return shapeMarkup(node, Math.max(1, Math.round(box.width)), Math.max(1, Math.round(box.height)), allNodes)
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
  const scale = setting.scale > 0 ? setting.scale : 1
  const svg = nodeToSvg(node, allNodes)
  const name = safeName(node)
  const suffix = scale === 1 ? '' : `@${scale}x`

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
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
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

export const EXPORT_SCALES = [0.5, 1, 2, 3, 4] as const
export const EXPORT_FORMATS: ExportFormat[] = ['PNG', 'JPG', 'SVG', 'PDF']
