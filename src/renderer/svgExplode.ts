import type { DesignNode } from '../shared/types'

const SHAPE_SEL = 'path, rect, circle, ellipse, polygon, polyline, line'
/** Paper-style pull-apart — keep enough shapes for color bands without freezing. */
const MAX_EXPLODE_SHAPES = 120

function parseViewBox(svg: SVGSVGElement): { minX: number; minY: number; width: number; height: number } {
  const raw = svg.getAttribute('viewBox')
  if (raw) {
    const parts = raw.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { minX: parts[0], minY: parts[1], width: Math.max(1, parts[2]), height: Math.max(1, parts[3]) }
    }
  }
  const width = Number(svg.getAttribute('width')) || 512
  const height = Number(svg.getAttribute('height')) || 512
  return { minX: 0, minY: 0, width: Math.max(1, width), height: Math.max(1, height) }
}

function mountSvg(root: SVGSVGElement): { clone: SVGSVGElement; dispose: () => void } {
  const host = document.createElement('div')
  host.style.cssText =
    'position:absolute;left:-10000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;visibility:hidden'
  const clone = root.cloneNode(true) as SVGSVGElement
  // Give the SVG real layout size so getBBox is reliable.
  clone.setAttribute('width', '1000')
  clone.setAttribute('height', '1000')
  host.appendChild(clone)
  document.body.appendChild(host)
  return {
    clone,
    dispose: () => host.remove()
  }
}

function listPaintShapes(root: SVGSVGElement): SVGGraphicsElement[] {
  return [...root.querySelectorAll(SHAPE_SEL)].filter((el) => {
    return !el.closest('defs, clipPath, mask, pattern, symbol')
  }) as SVGGraphicsElement[]
}

function shapeBBox(el: SVGGraphicsElement): DOMRect | null {
  try {
    const bbox = el.getBBox()
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) return null
    if (bbox.width < 0.25 && bbox.height < 0.25) return null
    return bbox
  } catch {
    return null
  }
}

function isFullBleedBackground(
  el: SVGGraphicsElement,
  vb: { minX: number; minY: number; width: number; height: number }
): boolean {
  const tag = el.tagName.toLowerCase()
  if (tag !== 'rect' && tag !== 'path') return false
  const bbox = shapeBBox(el)
  if (!bbox) return false
  const coversW = bbox.width >= vb.width * 0.92
  const coversH = bbox.height >= vb.height * 0.92
  if (!coversW || !coversH) return false
  const fill = (el.getAttribute('fill') || '').trim().toLowerCase()
  if (!fill || fill === 'none' || fill === 'transparent') return false
  // Near-white / cream pads Quiver often adds around icons — treat as frame chrome, not art.
  if (/^#(?:fff(?:fff)?|f[0-9a-f]{5}|f[5-9a-f]{2}e[0-9a-f]|f[2-9a-f]eed)$/i.test(fill)) return true
  if (fill === 'white' || fill === 'rgb(255,255,255)' || fill === 'rgb(255, 255, 255)') return true
  return coversW && coversH && Math.abs(bbox.x - vb.minX) < vb.width * 0.05
}

function unionContentBox(
  shapes: SVGGraphicsElement[],
  vb: { minX: number; minY: number; width: number; height: number }
): { minX: number; minY: number; width: number; height: number; bgFill: string | null } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let bgFill: string | null = null
  let counted = 0

  for (const el of shapes) {
    if (isFullBleedBackground(el, vb)) {
      const fill = el.getAttribute('fill')
      if (fill && fill !== 'none') bgFill = fill
      continue
    }
    const bbox = shapeBBox(el)
    if (!bbox) continue
    counted += 1
    minX = Math.min(minX, bbox.x)
    minY = Math.min(minY, bbox.y)
    maxX = Math.max(maxX, bbox.x + bbox.width)
    maxY = Math.max(maxY, bbox.y + bbox.height)
  }

  if (!counted || !Number.isFinite(minX)) {
    return { ...vb, bgFill }
  }

  const pad = Math.max(0.5, Math.min(vb.width, vb.height) * 0.004)
  return {
    minX: minX - pad,
    minY: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2),
    bgFill
  }
}

export type NormalizeSvgResult = {
  markup: string
  /** Dominant full-bleed background color stripped from the SVG, if any. */
  background: string | null
}

/**
 * Cheap stretch-to-fill — no DOM mount. Safe to call on every Quiver draft.
 * Uses `slice` so incomplete drafts still cover the frame instead of sitting
 * as a thin strip at the top with empty/black space below.
 */
export function normalizeSvgMarkup(svg: string, width: number, height: number): string {
  let trimmed = svg.trim()
  if (!trimmed) return ''
  if (!/<svg[\s>]/i.test(trimmed)) {
    trimmed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${trimmed}</svg>`
  }
  if (!/<\/svg>\s*$/i.test(trimmed)) trimmed = `${trimmed}</svg>`
  if (!/\sxmlns=/i.test(trimmed)) {
    trimmed = trimmed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return trimmed.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let next = String(attrs)
      .replace(/\spreserveAspectRatio\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\swidth\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sheight\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    if (!/\sviewBox\s*=/i.test(next)) {
      next += ` viewBox="0 0 ${width} ${height}"`
    }
    return `<svg${next} width="100%" height="100%" preserveAspectRatio="xMidYMid slice">`
  })
}

/**
 * Crop Quiver padding out of the viewBox and stretch the art to fill the host frame.
 * Returns transparent-friendly markup (no forced white plate).
 * Expensive (DOM getBBox) — only call on final commit, never on every draft.
 */
export function fitSvgMarkup(
  svg: string,
  width: number,
  height: number,
  opts?: { crop?: boolean }
): NormalizeSvgResult {
  let trimmed = svg.trim()
  if (!trimmed) return { markup: '', background: null }
  if (!/<svg[\s>]/i.test(trimmed)) {
    trimmed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${trimmed}</svg>`
  }
  if (!/<\/svg>\s*$/i.test(trimmed)) trimmed = `${trimmed}</svg>`
  if (!/\sxmlns=/i.test(trimmed)) {
    trimmed = trimmed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  let viewBox = `0 0 ${width} ${height}`
  let background: string | null = null
  const crop = opts?.crop === true

  if (crop && typeof document !== 'undefined') {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(trimmed, 'image/svg+xml')
      const root = doc.querySelector('svg')
      if (root) {
        const { clone, dispose } = mountSvg(root as SVGSVGElement)
        try {
          const vb = parseViewBox(clone)
          const shapes = listPaintShapes(clone)
          const box = unionContentBox(shapes, vb)
          background = box.bgFill
          // Drop full-bleed pad rects so they don't reappear as white margins.
          for (const el of listPaintShapes(clone)) {
            if (isFullBleedBackground(el, vb)) el.remove()
          }
          viewBox = `${box.minX} ${box.minY} ${box.width} ${box.height}`
          clone.setAttribute('viewBox', viewBox)
          clone.removeAttribute('width')
          clone.removeAttribute('height')
          clone.setAttribute('width', '100%')
          clone.setAttribute('height', '100%')
          clone.setAttribute('preserveAspectRatio', 'none')
          trimmed = new XMLSerializer().serializeToString(clone)
        } finally {
          dispose()
        }
      }
    } catch {
      // Fall through to attribute-only normalize.
    }
  }

  trimmed = trimmed.replace(/<svg\b([^>]*)>/i, (_match, attrs: string) => {
    let next = String(attrs)
      .replace(/\spreserveAspectRatio\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\swidth\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sheight\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sviewBox\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    next += ` viewBox="${viewBox}"`
    return `<svg${next} width="100%" height="100%" preserveAspectRatio="none">`
  })

  return { markup: trimmed, background }
}

function pickExplodeShapes(shapes: SVGGraphicsElement[]): SVGGraphicsElement[] {
  // Drop dust / hairline noise first, preserve paint order (layering).
  const meaningful = shapes.filter((el) => {
    const bbox = shapeBBox(el)
    if (!bbox) return false
    return bbox.width * bbox.height >= 4
  })
  if (meaningful.length <= MAX_EXPLODE_SHAPES) return meaningful

  // Prefer top-level groups when Quiver nests bands that way.
  const root = meaningful[0]?.ownerSVGElement
  if (root) {
    const groups = [...root.children].filter((el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'defs' || tag === 'title' || tag === 'desc' || tag === 'metadata') return false
      return Boolean(el.querySelector(SHAPE_SEL) || SHAPE_SEL.split(', ').includes(tag))
    }) as SVGGraphicsElement[]
    if (groups.length >= 2 && groups.length <= MAX_EXPLODE_SHAPES) {
      return groups
    }
  }

  // Over the cap: keep largest shapes but never subsample (that nuked color bands).
  const ranked = meaningful
    .map((el) => {
      const bbox = shapeBBox(el)
      const area = bbox ? bbox.width * bbox.height : 0
      return { el, area }
    })
    .sort((a, b) => b.area - a.area)
  return ranked.slice(0, MAX_EXPLODE_SHAPES).map((item) => item.el)
}

/**
 * Split an SVG into individually selectable shape nodes inside a frame,
 * so pieces can be moved apart like Paper’s Vectorize result.
 */
export function explodeSvgToNodes(
  svg: string,
  opts: {
    frameId: string
    pageId: string
    x: number
    y: number
    width: number
    height: number
    name?: string
  }
): DesignNode[] {
  const fitted = fitSvgMarkup(svg, opts.width, opts.height, { crop: true })
  if (!fitted.markup) return []

  const parser = new DOMParser()
  const doc = parser.parseFromString(fitted.markup, 'image/svg+xml')
  const root = doc.querySelector('svg')
  if (!root) return []

  const { clone, dispose } = mountSvg(root as SVGSVGElement)
  try {
    const vb = parseViewBox(clone)
    const sx = opts.width / vb.width
    const sy = opts.height / vb.height
    const allShapes = listPaintShapes(clone).filter((el) => !isFullBleedBackground(el, vb))
    const shapes = pickExplodeShapes(allShapes)
    if (!shapes.length) {
      // Fallback: single full-bleed SVG image node.
      return [
        {
          id: opts.frameId,
          type: 'frame',
          name: opts.name || 'Vectorized',
          x: opts.x,
          y: opts.y,
          width: opts.width,
          height: opts.height,
          pageId: opts.pageId,
          fills: fitted.background
            ? [{ type: 'solid', color: fitted.background, opacity: 1 }]
            : [],
          fill: fitted.background || 'transparent',
          clipsContent: true,
          svgMarkup: fitted.markup
        }
      ]
    }

    const frame: DesignNode = {
      id: opts.frameId,
      type: 'frame',
      name: opts.name || 'Vectorized',
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height,
      pageId: opts.pageId,
      fills: fitted.background ? [{ type: 'solid', color: fitted.background, opacity: 1 }] : [],
      fill: fitted.background || 'transparent',
      // Allow drag-apart outside the frame like Paper.
      clipsContent: false
    }

    const children: DesignNode[] = []
    shapes.forEach((el, index) => {
      const bbox = shapeBBox(el)
      if (!bbox) return

      const pad = 1
      const bx = bbox.x - pad
      const by = bbox.y - pad
      const bw = Math.max(1, bbox.width + pad * 2)
      const bh = Math.max(1, bbox.height + pad * 2)
      const localX = Math.round((bx - vb.minX) * sx)
      const localY = Math.round((by - vb.minY) * sy)
      const localW = Math.max(1, Math.round(bw * sx))
      const localH = Math.max(1, Math.round(bh * sy))

      const fill =
        el.getAttribute('fill') && el.getAttribute('fill') !== 'none'
          ? el.getAttribute('fill')!
          : el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none'
            ? el.getAttribute('stroke')!
            : '#888888'

      const shapeMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bx} ${by} ${bw} ${bh}" width="100%" height="100%" preserveAspectRatio="none">${el.outerHTML}</svg>`

      children.push({
        id: crypto.randomUUID(),
        type: 'image',
        name: `Shape ${index + 1}`,
        parentId: opts.frameId,
        x: localX,
        y: localY,
        width: localW,
        height: localH,
        pageId: opts.pageId,
        svgMarkup: shapeMarkup,
        imageDataUrl: '',
        fills: [{ type: 'image', imageDataUrl: '', scaleMode: 'fill', opacity: 1, visible: true }],
        fill
      })
    })

    if (!children.length) return []
    return [frame, ...children]
  } finally {
    dispose()
  }
}
