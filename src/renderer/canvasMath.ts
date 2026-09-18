import { CANVAS_ZOOM_MAX, CANVAS_ZOOM_MIN, FRAME_CHROME_HEIGHT, type BrowserFrame, type Camera, type PathPoint } from '../shared/types'

export function clampZoom(zoom: number): number {
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, zoom))
}

export function screenToWorld(camera: Camera, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom
  }
}

export function worldToScreen(camera: Camera, worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y
  }
}

export function worldRectToScreen(
  camera: Camera,
  canvasRect: DOMRectReadOnly,
  x: number,
  y: number,
  width: number,
  height: number
): DOMRect {
  return new DOMRect(
    canvasRect.left + camera.x + x * camera.zoom,
    canvasRect.top + camera.y + y * camera.zoom,
    width * camera.zoom,
    height * camera.zoom
  )
}

export function zoomAt(camera: Camera, screenX: number, screenY: number, nextZoom: number): Camera {
  const zoom = clampZoom(nextZoom)
  const world = screenToWorld(camera, screenX, screenY)
  return {
    zoom,
    x: screenX - world.x * zoom,
    y: screenY - world.y * zoom
  }
}

export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x + dx, y: camera.y + dy }
}

export function fitFrames(
  frames: BrowserFrame[],
  viewWidth: number,
  viewHeight: number,
  padding = 72
): Camera | null {
  if (!frames.length || viewWidth < 8 || viewHeight < 8) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const frame of frames) {
    minX = Math.min(minX, frame.x)
    minY = Math.min(minY, frame.y)
    maxX = Math.max(maxX, frame.x + frame.width)
    maxY = Math.max(maxY, frame.y + frame.height + FRAME_CHROME_HEIGHT)
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const zoom = clampZoom(Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height, 1))
  return {
    zoom,
    x: (viewWidth - width * zoom) / 2 - minX * zoom,
    y: (viewHeight - height * zoom) / 2 - minY * zoom
  }
}

export function wheelPan(deltaX: number, deltaY: number, deltaMode: number): { x: number; y: number } {
  const line = deltaMode === 1 ? 16 : 1
  return { x: -deltaX * line, y: -deltaY * line }
}

export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.00135)
}

export function nodeBounds(node: {
  x: number
  y: number
  width?: number
  height?: number
  points?: Array<{ x: number; y: number }>
}): { x: number; y: number; width: number; height: number } {
  if (node.points?.length) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of node.points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
  }
  return { x: node.x, y: node.y, width: Math.max(0, node.width || 0), height: Math.max(0, node.height || 0) }
}

export function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function intersectRects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const width = Math.min(a.x + a.width, b.x + b.width) - x
  const height = Math.min(a.y + a.height, b.y + b.height) - y
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/** True when `inner` is fully inside `outer` (with a small tolerance). */
export function rectContains(
  outer: { x: number; y: number; width: number; height: number },
  inner: { x: number; y: number; width: number; height: number },
  pad = 0.5
): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.width <= outer.x + outer.width + pad &&
    inner.y + inner.height <= outer.y + outer.height + pad
  )
}

export function handleOrigin(
  box: { x: number; y: number; width: number; height: number },
  handle: 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se',
  fromCenter = false
): { x: number; y: number } {
  if (fromCenter) return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  if (handle === 'se') return { x: box.x, y: box.y }
  if (handle === 'sw') return { x: box.x + box.width, y: box.y }
  if (handle === 'ne') return { x: box.x, y: box.y + box.height }
  if (handle === 'nw') return { x: box.x + box.width, y: box.y + box.height }
  if (handle === 'n') return { x: cx, y: box.y + box.height }
  if (handle === 's') return { x: cx, y: box.y }
  if (handle === 'e') return { x: box.x, y: cy }
  return { x: box.x + box.width, y: cy }
}

export function scaleFactorFromDrag(
  origin: { x: number; y: number },
  start: { x: number; y: number },
  dx: number,
  dy: number
): number {
  const before = Math.hypot(start.x - origin.x, start.y - origin.y) || 1
  return Math.max(0.02, Math.min(32, Math.hypot(start.x + dx - origin.x, start.y + dy - origin.y) / before))
}

export function scaleNodeAround<T extends {
  x: number
  y: number
  width?: number
  height?: number
  radius?: number
  fontSize?: number
  strokeWidth?: number
  letterSpacing?: number
  points?: PathPoint[]
}>(node: T, originX: number, originY: number, factor: number): T {
  const f = Math.max(0.02, factor)
  return {
    ...node,
    x: originX + (node.x - originX) * f,
    y: originY + (node.y - originY) * f,
    width: node.width == null ? node.width : Math.max(1, node.width * f),
    height: node.height == null ? node.height : Math.max(1, node.height * f),
    radius: node.radius == null ? node.radius : node.radius * f,
    fontSize: node.fontSize == null ? node.fontSize : Math.max(1, node.fontSize * f),
    strokeWidth: node.strokeWidth == null ? node.strokeWidth : Math.max(0.5, node.strokeWidth * f),
    letterSpacing: node.letterSpacing == null ? node.letterSpacing : node.letterSpacing * f,
    points: node.points?.map((point) => ({
      ...point,
      x: originX + (point.x - originX) * f,
      y: originY + (point.y - originY) * f,
      inX: point.inX == null ? point.inX : originX + (point.inX - originX) * f,
      inY: point.inY == null ? point.inY : originY + (point.inY - originY) * f,
      outX: point.outX == null ? point.outX : originX + (point.outX - originX) * f,
      outY: point.outY == null ? point.outY : originY + (point.outY - originY) * f
    }))
  }
}
