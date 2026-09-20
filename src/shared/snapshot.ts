import type { DesignNode } from './types'
import type { Paint } from './paint'

/** Element captured from a live browser, in Paper Snapshot shape. */
export type SnapshotFill =
  | { type: 'solid'; hex: string; opacity: number }
  | { type: 'image'; dataUrl: string }
  | {
      type: 'linear'
      angle: number
      stops: Array<{ hex: string; opacity: number; position: number }>
    }

export type SnapshotShadow = {
  x: number
  y: number
  blur: number
  spread: number
  hex: string
  opacity: number
  inset?: boolean
}

export type SnapshotNode = {
  kind: 'frame' | 'text' | 'image'
  tag: string
  name: string
  x: number
  y: number
  width: number
  height: number
  opacity?: number
  radius?: number
  cornerRadii?: { tl: number; tr: number; br: number; bl: number }
  fill?: SnapshotFill | null
  /** Text color when `kind` is text. */
  color?: { hex: string; opacity: number } | null
  stroke?: { hex: string; opacity: number } | null
  strokeWidth?: number
  text?: string
  fontFamily?: string
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textAlignVertical?: 'top' | 'middle' | 'bottom'
  textDecoration?: 'none' | 'underline' | 'line-through'
  shadow?: SnapshotShadow | null
  layerBlur?: number
  backgroundBlur?: number
  children: SnapshotNode[]
}

export type SnapshotEvent =
  | { tabId: string; tree: SnapshotNode }
  | { tabId: string; cancelled: true }
  | { tabId: string; error: string }

function paintsFromFill(fill: SnapshotFill | null | undefined, nextId: () => string): Paint[] | undefined {
  if (!fill) return undefined
  if (fill.type === 'solid') {
    return [{ type: 'solid', color: fill.hex, opacity: fill.opacity, visible: true }]
  }
  if (fill.type === 'image' && fill.dataUrl) {
    return [{ type: 'image', imageDataUrl: fill.dataUrl, scaleMode: 'crop', opacity: 1, visible: true }]
  }
  if (fill.type === 'linear' && fill.stops.length >= 2) {
    return [
      {
        type: 'gradient',
        gradientKind: 'linear',
        angle: fill.angle,
        opacity: 1,
        visible: true,
        stops: fill.stops.map((stop) => ({
          id: nextId(),
          position: stop.position,
          color: stop.hex,
          opacity: stop.opacity
        }))
      }
    ]
  }
  return undefined
}

function applyCommon(node: DesignNode, snap: SnapshotNode): DesignNode {
  if (snap.opacity != null && snap.opacity < 0.999) node.opacity = Math.max(0, Math.min(1, snap.opacity))
  if (snap.radius && snap.radius > 0) node.radius = Math.round(snap.radius * 10) / 10
  if (snap.cornerRadii) {
    const round = (n: number) => Math.round(n * 10) / 10
    node.cornerRadii = {
      tl: round(snap.cornerRadii.tl),
      tr: round(snap.cornerRadii.tr),
      br: round(snap.cornerRadii.br),
      bl: round(snap.cornerRadii.bl)
    }
    node.radius = node.cornerRadii.tl
  }
  if (snap.stroke && snap.strokeWidth && snap.strokeWidth > 0) {
    node.stroke = snap.stroke.hex
    node.strokeOpacity = snap.stroke.opacity
    node.strokeWidth = snap.strokeWidth
    node.strokeAlign = 'inside'
  }
  if (snap.shadow && snap.shadow.blur + Math.abs(snap.shadow.x) + Math.abs(snap.shadow.y) > 0) {
    node.shadow = true
    node.shadowType = snap.shadow.inset ? 'inner' : 'drop'
    node.shadowX = snap.shadow.x
    node.shadowY = snap.shadow.y
    node.shadowBlur = snap.shadow.blur
    node.shadowSpread = snap.shadow.spread
    node.shadowColor = snap.shadow.hex
    node.shadowOpacity = snap.shadow.opacity
  }
  if (snap.layerBlur && snap.layerBlur > 0) node.layerBlur = snap.layerBlur
  if (snap.backgroundBlur && snap.backgroundBlur > 0) node.backgroundBlur = snap.backgroundBlur
  return node
}

/** Turn a captured DOM tree into parent-relative design nodes. */
export function importSnapshot(
  tree: SnapshotNode,
  place: { x: number; y: number; pageId: string },
  nextId: () => string
): { nodes: DesignNode[]; rootId: string } {
  const nodes: DesignNode[] = []

  const visit = (snap: SnapshotNode, parentId: string | undefined): string | null => {
    const width = Math.max(1, Math.round(snap.width || 0))
    const height = Math.max(1, Math.round(snap.height || 0))
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    const id = nextId()
    const x = parentId ? Math.round(snap.x || 0) : place.x
    const y = parentId ? Math.round(snap.y || 0) : place.y
    const name = (snap.name || snap.tag || 'Layer').slice(0, 64)

    if (snap.kind === 'text') {
      const color = snap.color
      const node: DesignNode = applyCommon(
        {
          id,
          type: 'text',
          x,
          y,
          width,
          height,
          parentId,
          pageId: place.pageId,
          name: (snap.text || name).slice(0, 64),
          text: snap.text || '',
          fill: color?.hex || '#111111',
          fillOpacity: color?.opacity ?? 1,
          fontFamily: snap.fontFamily,
          fontWeight: snap.fontWeight,
          fontStyle: snap.fontStyle,
          fontSize: snap.fontSize,
          lineHeight: snap.lineHeight,
          letterSpacing: snap.letterSpacing,
          letterSpacingUnit: snap.letterSpacing ? 'px' : undefined,
          textAlign: snap.textAlign,
          textAlignVertical: snap.textAlignVertical,
          textDecoration: snap.textDecoration,
          textResize: 'fixed'
        },
        snap
      )
      nodes.push(node)
      return id
    }

    if (snap.kind === 'image' && snap.fill?.type === 'image' && snap.fill.dataUrl) {
      const node: DesignNode = applyCommon(
        {
          id,
          type: 'image',
          x,
          y,
          width,
          height,
          parentId,
          pageId: place.pageId,
          name,
          imageDataUrl: snap.fill.dataUrl,
          radius: snap.radius
        },
        snap
      )
      nodes.push(node)
      return id
    }

    const fills = paintsFromFill(snap.fill, nextId)
    const node: DesignNode = applyCommon(
      {
        id,
        type: 'frame',
        x,
        y,
        width,
        height,
        parentId,
        pageId: place.pageId,
        name,
        clipsContent: false,
        layout: { mode: 'none', sizingH: 'fixed', sizingV: 'fixed' },
        fills
      },
      snap
    )
    if (fills?.[0]?.type === 'solid') {
      node.fill = fills[0].color
      node.fillOpacity = fills[0].opacity
    }
    nodes.push(node)
    for (const child of snap.children || []) visit(child, id)
    return id
  }

  const rootId = visit(tree, undefined)
  if (!rootId) return { nodes: [], rootId: '' }
  return { nodes, rootId }
}
