import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { AutoLayoutAlign, AutoLayoutJustify, DesignNode, DesignTool, PathPoint } from '../shared/types'
import { getCommentPerson } from '../shared/comments'
import { cssBlendMode, cssIsolation } from '../shared/blendModes'
import { blurRadius, getNodeEffects, type DesignEffect } from '../shared/effects'
import { layersAtPoint, resolveWorldRect } from '../shared/layoutEngine'
import { getNodePaints, gradientCss } from '../shared/paint'
import {
  borderRadiusCss,
  clampCornerRadii,
  resolveCornerRadii
} from '../shared/corners'
import { BuildRevealShell, BuildWorkingDots } from './BuildWorkingDots'
import { handleOrigin, nodeBounds, scaleFactorFromDrag } from './canvasMath'
import { toHex, withAlpha } from './DesignInspector'
import { brushFills, pathDFromPoints } from './drawBrushes'
import { ShaderFill } from './ShaderFill'
import { AdjustedImage, type ImageFit } from './AdjustedImage'
import {
  alignmentForOffset,
  measureAlignTarget,
  measurePaddingBands,
  measureSelectionGaps,
  type AlignTarget,
  type GapBand,
  type PadBand,
  type PadSide
} from './selectionSpace'
import { ensureGoogleFontLoaded, cssFontFamily } from './googleFonts'
import {
  isTextOnPath,
  measurePlainText,
  offsetAlongPath,
  pointAtPathOffset,
  textPathD
} from './textPath'

type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const RESIZE_HANDLES: Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']
const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']

function canDragNode(tool: DesignTool) {
  return tool === 'pointer' || tool === 'frame' || tool === 'section' || tool === 'browser'
}

function nodeBorderRadiusCss(node: DesignNode, width: number, height: number, fallback = 0): string {
  return borderRadiusCss(clampCornerRadii(resolveCornerRadii(node, fallback), width, height))
}

function imageFit(mode?: string): ImageFit {
  if (mode === 'fit') return 'contain'
  if (mode === 'tile') return 'tile'
  if (mode === 'crop') return 'cover'
  return 'cover'
}

function NodeImage({ node, fit, className }: { node: DesignNode; fit: ImageFit; className: string }) {
  const paint = getNodePaints(node).find((item) => item.type === 'image' && item.visible !== false)
  const src = paint?.type === 'image' ? paint.imageDataUrl || node.imageDataUrl : node.imageDataUrl
  if (!src) return null
  return (
    <AdjustedImage
      src={src}
      adjust={paint?.type === 'image' ? paint : undefined}
      fit={
        paint?.type === 'image' && paint.scaleMode && paint.scaleMode !== 'fill' ? imageFit(paint.scaleMode) : fit
      }
      opacity={paint?.type === 'image' ? paint.opacity : 1}
      className={className}
    />
  )
}

function resolveLetterSpacingPx(node: DesignNode, fontSize: number): number {
  const value = node.letterSpacing || 0
  if (!value) return 0
  const unit = node.letterSpacingUnit || (value > 3 ? 'px' : 'percent')
  return unit === 'percent' ? (value / 100) * fontSize : value
}

function formatTextCase(text: string, textCase?: DesignNode['textCase']): string {
  if (!textCase || textCase === 'none' || textCase === 'small-caps') return text
  if (textCase === 'upper') return text.toUpperCase()
  if (textCase === 'lower') return text.toLowerCase()
  if (textCase === 'title') {
    return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  }
  return text
}

type SelectHandler = (
  id: string,
  additive: boolean,
  opts?: { deep?: boolean; drill?: boolean; clientX?: number; clientY?: number }
) => void

function selectFromPointer(
  onSelect: SelectHandler,
  id: string,
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number }
) {
  onSelect(id, event.shiftKey, {
    deep: event.metaKey || event.ctrlKey,
    clientX: event.clientX,
    clientY: event.clientY
  })
}

function drillFromPointer(
  onSelect: SelectHandler,
  id: string,
  event: { clientX: number; clientY: number }
) {
  onSelect(id, false, {
    drill: true,
    clientX: event.clientX,
    clientY: event.clientY
  })
}

function stackingZIndex(
  node: DesignNode,
  selectedIds: Set<string>,
  byId: Map<string, DesignNode>
): number | undefined {
  if (selectedIds.has(node.id)) return 40
  let depth = 0
  let parentId = node.parentId
  const seen = new Set<string>()
  while (parentId) {
    if (seen.has(parentId)) break
    seen.add(parentId)
    depth += 1
    // Keep children above a selected ancestor frame so they don't disappear under it.
    if (selectedIds.has(parentId)) return 40 + depth
    parentId = byId.get(parentId)?.parentId
  }
  return undefined
}

function ResizeHandles({
  onStart,
  cornersOnly = false
}: {
  onStart: (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => void
  cornersOnly?: boolean
}) {
  const handles = cornersOnly ? CORNER_HANDLES : RESIZE_HANDLES
  return (
    <>
      {handles.map((handle) => (
        <span key={handle} className={`design-handle ${handle}`} onPointerDown={onStart(handle)} />
      ))}
    </>
  )
}

export function DesignLayer({
  nodes,
  selectedIds,
  tool,
  draft,
  hoverPoint,
  pathHoverId,
  revealId = null,
  revealIds = [],
  buildingIds = [],
  deepHoverId = null,
  dropParentId = null,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
  onResize,
  onScaleStart,
  onScale,
  onEdit,
  onRemove,
  onSpace,
  onSpaceEnd,
  onPad,
  onPadEnd,
  onLayoutAlign,
  flexDrop = null
}: {
  nodes: DesignNode[]
  selectedIds: string[]
  tool: DesignTool
  draft: DesignNode | null
  hoverPoint?: PathPoint | null
  pathHoverId?: string | null
  revealId?: string | null
  revealIds?: string[]
  buildingIds?: string[]
  deepHoverId?: string | null
  dropParentId?: string | null
  onSelect: (
    id: string,
    additive: boolean,
    opts?: { deep?: boolean; drill?: boolean; clientX?: number; clientY?: number }
  ) => void
  onMoveStart: (id: string) => string | void
  onMove: (id: string, worldX: number, worldY: number, snap?: boolean) => void
  onMoveEnd?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
  onSpace?: (axis: 'x' | 'y', gap: number) => void
  onSpaceEnd?: () => void
  onPad?: (side: PadSide, value: number) => void
  onPadEnd?: () => void
  onLayoutAlign?: (justify: AutoLayoutJustify, align: AutoLayoutAlign) => void
  flexDrop?: {
    axis: 'x' | 'y'
    line: { x: number; y: number; width: number; height: number }
    slot: { x: number; y: number; width: number; height: number }
  } | null
}) {
  const selected = new Set(selectedIds)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const revealing = new Set([...(revealIds || []), ...(revealId ? [revealId] : [])])
  const building = new Set(buildingIds || [])
  const paths = [...nodes, draft].filter((node): node is DesignNode => Boolean(node && node.type === 'path'))
  const group = selectedIds.length > 1 ? unionWorldBounds(nodes.filter((node) => selected.has(node.id)), nodes) : null
  const spacing = tool === 'pointer' && selectedIds.length >= 1 ? measureSelectionGaps(nodes, selectedIds) : null
  const gaps = spacing?.bands || []
  const pads = tool === 'pointer' && onPad ? measurePaddingBands(nodes, selectedIds) : []
  const alignTarget = tool === 'pointer' && onLayoutAlign ? measureAlignTarget(nodes, selectedIds) : null
  const deepHover =
    deepHoverId && !selected.has(deepHoverId)
      ? nodes.find((node) => node.id === deepHoverId)
      : deepHoverId
        ? nodes.find((node) => node.id === deepHoverId)
        : null
  const deepHoverBox = deepHover ? resolveWorldRect(deepHover, nodes) : null
  const dropParent = dropParentId ? nodes.find((node) => node.id === dropParentId) : null
  const dropParentBox = dropParent ? resolveWorldRect(dropParent, nodes) : null

  return (
    <div className="design-layer">
      {dropParentBox && (
        <div
          className="design-drop-target"
          style={{
            left: dropParentBox.x,
            top: dropParentBox.y,
            width: dropParentBox.width,
            height: dropParentBox.height
          }}
        />
      )}
      <svg className="design-svg" width="1" height="1">
        {paths.map((node) => (
          <DrawnPath
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            pathHover={pathHoverId === node.id}
            hoverPoint={draft?.id === node.id ? hoverPoint : null}
            tool={tool}
            onSelect={onSelect}
          />
        ))}
        {[...nodes, draft].map((node) => {
          if (!node || !isTextOnPath(node)) return null
          return (
            <TextOnPathItem
              key={`path-text-${node.id}`}
              node={node}
              selected={selected.has(node.id)}
              hideSoloChrome={selectedIds.length > 1 && selected.has(node.id)}
              tool={tool}
              onSelect={onSelect}
              onMoveStart={onMoveStart}
              onMove={onMove}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          )
        })}
      </svg>
      {[...nodes, draft].map((node) => {
        if (!node || node.type === 'path' || isTextOnPath(node)) return null
        return (
          <DesignItem
            key={node.id}
            node={node}
            allNodes={nodes}
            selected={selected.has(node.id)}
            stackZ={stackingZIndex(node, selected, byId)}
            hideSoloChrome={selectedIds.length > 1 && selected.has(node.id)}
            pathHover={pathHoverId === node.id}
            tool={tool}
            drafting={draft?.id === node.id}
            reveal={revealing.has(node.id)}
            building={building.has(node.id)}
            onSelect={onSelect}
            onMoveStart={onMoveStart}
            onMove={onMove}
            onMoveEnd={onMoveEnd}
            onResize={onResize}
            onScaleStart={onScaleStart}
            onScale={onScale}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        )
      })}
      {deepHoverBox && (
        <div
          className="design-deep-hover"
          style={{
            left: deepHoverBox.x,
            top: deepHoverBox.y,
            width: deepHoverBox.width,
            height: deepHoverBox.height
          }}
        />
      )}
      {group && (
        <div
          className={`design-group${tool === 'scale' ? ' is-scale' : ''}`}
          style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
        >
          {tool === 'scale' &&
            RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`design-handle ${handle}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  const origin = handleOrigin(group, handle, event.altKey)
                  const startCorner = {
                    x: handle.includes('e')
                      ? group.x + group.width
                      : handle.includes('w')
                        ? group.x
                        : group.x + group.width / 2,
                    y: handle.includes('s')
                      ? group.y + group.height
                      : handle.includes('n')
                        ? group.y
                        : group.y + group.height / 2
                  }
                  const drag = {
                    x: event.clientX,
                    y: event.clientY,
                    origin,
                    startCorner
                  }
                  const target = event.currentTarget
                  const move = (next: PointerEvent) => {
                    const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
                    onScale(
                      drag.origin,
                      scaleFactorFromDrag(
                        drag.origin,
                        drag.startCorner,
                        (next.clientX - drag.x) / scale,
                        (next.clientY - drag.y) / scale
                      )
                    )
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  onScaleStart()
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }}
              />
            ))}
          <div className="design-size">
            {Math.round(group.width)} × {Math.round(group.height)}
          </div>
        </div>
      )}
      {onSpace &&
        gaps.map((band, index) => (
          <SpacingHandle key={`${band.axis}-${index}`} band={band} onSpace={onSpace} onSpaceEnd={onSpaceEnd} />
        ))}
      {pads.map((band) => (
        <PaddingHandle key={`pad-${band.side}`} band={band} onPad={onPad!} onPadEnd={onPadEnd} />
      ))}
      {alignTarget && onLayoutAlign && (
        <AlignHandle target={alignTarget} nodes={nodes} onAlign={onLayoutAlign} onSelect={onSelect} />
      )}
      {flexDrop && (
        <>
          <div
            className="flex-drop-slot"
            style={{
              left: flexDrop.slot.x,
              top: flexDrop.slot.y,
              width: flexDrop.slot.width,
              height: flexDrop.slot.height
            }}
          />
          <div
            className={`flex-drop-line is-${flexDrop.axis}`}
            style={{
              left: flexDrop.line.x,
              top: flexDrop.line.y,
              width: flexDrop.line.width,
              height: flexDrop.line.height
            }}
          />
        </>
      )}
    </div>
  )
}

function SpacingHandle({
  band,
  onSpace,
  onSpaceEnd
}: {
  band: GapBand
  onSpace: (axis: 'x' | 'y', gap: number) => void
  onSpaceEnd?: () => void
}) {
  const [active, setActive] = useState(false)
  return (
    <div
      className={`space-gap is-${band.axis}${active ? ' is-active' : ''}`}
      style={{ left: band.x, top: band.y, width: Math.max(band.width, 1), height: Math.max(band.height, 1) }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setActive(true)
        const start = band.gap
        const origin = band.axis === 'x' ? event.clientX : event.clientY
        const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
        const move = (next: PointerEvent) => {
          const delta = ((band.axis === 'x' ? next.clientX : next.clientY) - origin) / zoom
          onSpace(band.axis, Math.max(0, start + delta))
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          setActive(false)
          onSpaceEnd?.()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      <span className="space-gap-label">{Math.round(band.gap)}</span>
    </div>
  )
}

function PaddingHandle({
  band,
  onPad,
  onPadEnd
}: {
  band: PadBand
  onPad: (side: PadSide, value: number) => void
  onPadEnd?: () => void
}) {
  const [active, setActive] = useState(false)
  const empty = band.value < 0.5
  const across = band.side === 'l' || band.side === 'r'
  return (
    <div
      className={`pad-gap is-${band.side}${empty ? ' is-empty' : ''}${active ? ' is-active' : ''}`}
      style={{
        left: band.x,
        top: band.y,
        width: Math.max(across ? band.width : band.width, 1),
        height: Math.max(across ? band.height : band.height, 1)
      }}
    >
      <div
        className="pad-hit"
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setActive(true)
          const start = band.value
          const origin = across ? event.clientX : event.clientY
          const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
          const move = (next: PointerEvent) => {
            const delta = ((across ? next.clientX : next.clientY) - origin) / zoom
            const signed = band.side === 'r' || band.side === 'b' ? -delta : delta
            onPad(band.side, Math.max(0, start + signed))
          }
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            setActive(false)
            onPadEnd?.()
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
      <span className="space-gap-label">{Math.round(band.value)}</span>
    </div>
  )
}

function AlignHandle({
  target,
  nodes,
  onAlign,
  onSelect
}: {
  target: AlignTarget
  nodes: DesignNode[]
  onAlign: (justify: AutoLayoutJustify, align: AutoLayoutAlign) => void
  onSelect: SelectHandler
}) {
  return (
    <div
      className="align-drag"
      style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
        const localX = target.x + (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
        const localY = target.y + (event.clientY - event.currentTarget.getBoundingClientRect().top) / zoom
        const hit = [...layersAtPoint({ x: localX, y: localY }, nodes)]
          .reverse()
          .find((node) => node.id !== target.frameId && node.parentId === target.frameId)
        // Let flex children receive the drag so they can be reordered.
        if (hit) return
        event.preventDefault()
        event.stopPropagation()
        const originX = event.clientX
        const originY = event.clientY
        const frame = nodes.find((node) => node.id === target.frameId)
        const current = {
          justify: frame?.layout?.justifyContent || 'start',
          align: frame?.layout?.alignItems || 'start'
        }
        let moved = false
        const move = (next: PointerEvent) => {
          const dx = (next.clientX - originX) / zoom
          const dy = (next.clientY - originY) / zoom
          if (!moved && Math.hypot(dx, dy) < 3) return
          moved = true
          const nextAlign = alignmentForOffset(target, target.offsetX + dx, target.offsetY + dy, current)
          onAlign(nextAlign.justifyContent, nextAlign.alignItems)
        }
        const up = (next: PointerEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (moved) return
          const emptyHit = [...layersAtPoint({ x: localX, y: localY }, nodes)]
            .reverse()
            .find((node) => node.id !== target.frameId)
          if (emptyHit) selectFromPointer(onSelect, emptyHit.id, next)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}

function DrawnPath({
  node,
  selected,
  pathHover,
  hoverPoint,
  tool,
  onSelect
}: {
  node: DesignNode
  selected: boolean
  pathHover?: boolean
  hoverPoint?: PathPoint | null
  tool: DesignTool
  onSelect: SelectHandler
}) {
  const points = node.points || []
  const color = toHex(node.stroke || node.fill, '#1A1A1A')
  const weight = Math.max(1, node.strokeWidth || (node.pathTool === 'brush' ? 64 : node.pathTool === 'pencil' ? 6 : 2))
  const style = node.brushStyle || (node.pathTool === 'brush' ? 'heist' : 'basic')
  const useStroke = node.pathTool === 'pen' || style === 'basic' || !node.pathTool
  const fills = useStroke ? [] : brushFills(points, style, weight, node.id, node.closed)
  const line = pathDFromPoints(points, node.closed)
  const last = points[points.length - 1]

  return (
    <g
      className={selected || pathHover ? 'draw-path is-selected' : 'draw-path'}
      opacity={node.opacity ?? 1}
      style={{ mixBlendMode: cssBlendMode(node.blendMode), isolation: cssIsolation(node.blendMode) }}
      onPointerDown={(event) => {
        if (tool === 'text' || tool === 'text-on-path') return
        if (tool !== 'pointer') return
        event.stopPropagation()
        selectFromPointer(onSelect, node.id, event)
      }}
    >
      {fills.map((d, index) => (
        <path key={index} className="draw-brush-fill" d={d} fill={color} />
      ))}
      {(useStroke || !fills.length) && (
        <path
          className="draw-pen-stroke"
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {(selected || pathHover) && line && (
        <path
          className="draw-select-stroke"
          d={line}
          fill="none"
          stroke="#0D99FF"
          strokeWidth={pathHover && !selected ? 1.5 : 1}
          strokeDasharray={pathHover && !selected ? '4 3' : undefined}
        />
      )}
      {node.pathTool === 'pen' &&
        points.map((point, index) => (
          <g key={`${node.id}-${index}`}>
            {point.outX != null && point.outY != null && (
              <>
                <line className="draw-handle-line" x1={point.x} y1={point.y} x2={point.outX} y2={point.outY} />
                <circle className="draw-handle-dot" cx={point.outX} cy={point.outY} r={3.5} />
              </>
            )}
            {point.inX != null && point.inY != null && (
              <>
                <line className="draw-handle-line" x1={point.x} y1={point.y} x2={point.inX} y2={point.inY} />
                <circle className="draw-handle-dot" cx={point.inX} cy={point.inY} r={3.5} />
              </>
            )}
            <rect className="draw-anchor" x={point.x - 3.5} y={point.y - 3.5} width={7} height={7} />
          </g>
        ))}
      {hoverPoint && last && (
        <line className="draw-rubber" x1={last.x} y1={last.y} x2={hoverPoint.x} y2={hoverPoint.y} />
      )}
    </g>
  )
}

function TextOnPathItem({
  node,
  selected,
  hideSoloChrome,
  tool,
  onSelect,
  onMoveStart,
  onMove,
  onEdit,
  onRemove
}: {
  node: DesignNode
  selected: boolean
  hideSoloChrome: boolean
  tool: DesignTool
  onSelect: SelectHandler
  onMoveStart: (id: string) => void
  onMove: (id: string, x: number, y: number, snap?: boolean) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const points = node.points || []
  const closed = Boolean(node.closed)
  const flip = Boolean(node.textPathFlip)
  const d = textPathD(points, closed, flip)
  const pathId = `text-path-${node.id}`
  const box = nodeBounds(node)
  const offset = node.textPathOffset ?? 0
  const start = pointAtPathOffset(points, closed, offset, flip)
  const fontSize = node.fontSize || 12
  const color = withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1)
  ensureGoogleFontLoaded(node.fontFamily || 'Inter', node.fontWeight || 400, node.fontStyle === 'italic')
  const showChrome = (selected || node.editing) && !hideSoloChrome
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef({ x: 0, y: 0, nodeX: node.x, nodeY: node.y })
  const familyCss = cssFontFamily(node.fontFamily || 'Inter')

  useEffect(() => {
    if (!node.editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [node.editing, node.id])

  const finishEdit = (value: string) => {
    const text = value.replace(/\n/g, '')
    if (!text.trim()) {
      onRemove?.(node.id)
      return
    }
    onEdit(node.id, { editing: false, text, name: text })
  }

  return (
    <g
      className={selected || node.editing ? 'text-on-path is-selected' : 'text-on-path'}
      opacity={node.opacity ?? 1}
      style={{ mixBlendMode: cssBlendMode(node.blendMode), isolation: cssIsolation(node.blendMode) }}
      onPointerDown={(event) => {
        if (tool === 'hand') return
        event.stopPropagation()
        selectFromPointer(onSelect, node.id, event)
        if (tool !== 'pointer' || node.editing) return
        onMoveStart(node.id)
        drag.current = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y }
        const target = event.currentTarget
        const move = (next: PointerEvent) => {
          const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
          onMove(
            node.id,
            drag.current.nodeX + (next.clientX - drag.current.x) / scale,
            drag.current.nodeY + (next.clientY - drag.current.y) / scale,
            !next.altKey && !next.ctrlKey && !next.metaKey
          )
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (selected) {
          onEdit(node.id, { editing: true })
          return
        }
        drillFromPointer(onSelect, node.id, event)
      }}
    >
      <defs>
        <path id={pathId} d={d} />
      </defs>
      <path
        className="text-on-path-guide"
        d={d}
        fill="none"
        stroke={showChrome ? '#0D99FF' : 'transparent'}
        strokeWidth={showChrome ? 1.25 : 8}
        strokeDasharray={showChrome ? '5 4' : undefined}
        pointerEvents="stroke"
      />
      <text
        className="text-on-path-label"
        fill={color}
        fontFamily={familyCss}
        fontSize={fontSize}
        fontWeight={node.fontWeight || 400}
        fontStyle={node.fontStyle || 'normal'}
        letterSpacing={node.letterSpacing || 0}
        style={{ pointerEvents: 'none' }}
      >
        <textPath href={`#${pathId}`} startOffset={`${offset}%`}>
          {node.text || (node.editing ? '' : 'Type')}
        </textPath>
      </text>
      {node.editing && start && (
        <foreignObject x={start.x - 4} y={start.y - fontSize - 6} width={Math.max(120, box.width)} height={fontSize + 12} style={{ overflow: 'visible' }}>
          <input
            ref={inputRef}
            className="text-on-path-input"
            value={node.text || ''}
            placeholder=""
            style={{
              fontFamily: familyCss,
              fontSize,
              fontWeight: node.fontWeight || 400,
              fontStyle: node.fontStyle || 'normal',
              color,
              letterSpacing: node.letterSpacing || 0
            }}
            onChange={(event) => onEdit(node.id, { text: event.target.value, name: event.target.value || 'Text' })}
            onBlur={(event) => finishEdit(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </foreignObject>
      )}
      {showChrome && start && (
        <circle
          className="text-path-start"
          cx={start.x}
          cy={start.y}
          r={5}
          onPointerDown={(event) => {
            event.stopPropagation()
            const world = event.currentTarget.closest('.world')
            if (!world) return
            const move = (next: PointerEvent) => {
              const scale = Number(world.getAttribute('data-zoom') || '1')
              const parent = world.parentElement
              if (!parent) return
              const rect = parent.getBoundingClientRect()
              const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform)
              const localX = (next.clientX - rect.left - matrix.e) / scale
              const localY = (next.clientY - rect.top - matrix.f) / scale
              const nextOffset = offsetAlongPath({ x: localX, y: localY }, points, closed)
              onEdit(node.id, { textPathOffset: flip ? ((100 - nextOffset + 100) % 100) : nextOffset })
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
      )}
      {showChrome && (
        <foreignObject
          x={box.x + box.width / 2 - 36}
          y={box.y + box.height + 10}
          width={72}
          height={22}
          style={{ overflow: 'visible' }}
        >
          <div className="design-size text-path-size">
            {Math.round(box.width)} × {Math.round(box.height)}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

function DesignItem({
  node,
  allNodes,
  selected,
  stackZ,
  hideSoloChrome,
  pathHover,
  tool,
  drafting,
  reveal,
  building,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
  onResize,
  onScaleStart,
  onScale,
  onEdit,
  onRemove
}: {
  node: DesignNode
  allNodes: DesignNode[]
  selected: boolean
  stackZ?: number
  hideSoloChrome: boolean
  pathHover?: boolean
  tool: DesignTool
  drafting: boolean
  reveal?: boolean
  building?: boolean
  onSelect: SelectHandler
  onMoveStart: (id: string) => string | void
  onMove: (id: string, worldX: number, worldY: number, snap?: boolean) => void
  onMoveEnd?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const drag = useRef({
    x: 0,
    y: 0,
    nodeX: 0,
    nodeY: 0,
    width: 0,
    height: 0,
    handle: null as Handle | null,
    moveId: '' as string
  })
  const editRef = useRef<HTMLDivElement>(null)
  const [fontTick, setFontTick] = useState(0)
  const showChrome = (selected || drafting || node.editing) && !hideSoloChrome
  const world = resolveWorldRect(node, allNodes)
  const box = world

  useEffect(() => {
    if (node.type !== 'text') return
    let cancelled = false
    void ensureGoogleFontLoaded(node.fontFamily || 'Inter', node.fontWeight || 400, node.fontStyle === 'italic').then(
      () => {
        if (!cancelled) setFontTick((value) => value + 1)
      }
    )
    return () => {
      cancelled = true
    }
  }, [node.type, node.fontFamily, node.fontWeight, node.fontStyle])

  useEffect(() => {
    if (!node.editing || node.type !== 'text' || !editRef.current) return
    const el = editRef.current
    if (el.innerText !== (node.text || '')) el.innerText = node.text || ''
    // Defer focus so the creating click doesn't immediately blur an empty field.
    const focusId = window.requestAnimationFrame(() => {
      el.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    return () => window.cancelAnimationFrame(focusId)
  }, [node.editing, node.id, node.type])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'hand') return
    const creating =
      tool === 'shape' ||
      tool === 'frame' ||
      tool === 'section' ||
      tool === 'pen' ||
      tool === 'pencil' ||
      tool === 'brush' ||
      tool === 'widget' ||
      tool === 'text' ||
      tool === 'text-on-path'
    if (creating) {
      if ((tool === 'text' || tool === 'text-on-path') && node.type === 'text' && !isTextOnPath(node)) {
        event.stopPropagation()
        onSelect(node.id, false)
        onEdit(node.id, { editing: true })
      }
      return
    }
    event.stopPropagation()
    selectFromPointer(onSelect, node.id, event)
    if (tool === 'scale') return
    if (!canDragNode(tool) || node.editing) return
    const moveId = onMoveStart(node.id) || node.id
    const moveNode = allNodes.find((item) => item.id === moveId) || node
    const moveWorld = resolveWorldRect(moveNode, allNodes)
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: moveWorld.x,
      nodeY: moveWorld.y,
      width: moveWorld.width,
      height: moveWorld.height,
      handle: null,
      moveId
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (!canDragNode(tool) && tool !== 'scale') return
    const scale = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
    const start = drag.current
    const dx = (event.clientX - start.x) / scale
    const dy = (event.clientY - start.y) / scale
    if (start.handle) {
      if (tool === 'scale') {
        const scaleBox = { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height }
        const origin = handleOrigin(scaleBox, start.handle, event.altKey)
        const startCorner = {
          x: start.handle.includes('e')
            ? scaleBox.x + scaleBox.width
            : start.handle.includes('w')
              ? scaleBox.x
              : scaleBox.x + scaleBox.width / 2,
          y: start.handle.includes('s')
            ? scaleBox.y + scaleBox.height
            : start.handle.includes('n')
              ? scaleBox.y
              : scaleBox.y + scaleBox.height / 2
        }
        onScale(origin, scaleFactorFromDrag(origin, startCorner, dx, dy))
        return
      }
      onResize(start.moveId || node.id, {
        ...resizeRect(start.nodeX, start.nodeY, start.width, start.height, start.handle, dx, dy, {
          lockAspect: Boolean(node.aspectLocked) || event.shiftKey,
          ratio: start.width / Math.max(1, start.height)
        }),
        world: true
      })
      return
    }
    onMove(
      start.moveId || node.id,
      start.nodeX + dx,
      start.nodeY + dy,
      !event.altKey && !event.ctrlKey && !event.metaKey
    )
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.current.handle) onMoveEnd?.(drag.current.moveId || node.id)
  }

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (drafting || (!canDragNode(tool) && tool !== 'scale')) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(node.id, false)
    if (tool === 'scale') onScaleStart()
    const start = {
      x: event.clientX,
      y: event.clientY,
      nodeX: world.x,
      nodeY: world.y,
      width: world.width,
      height: world.height,
      handle,
      moveId: node.id
    }
    drag.current = start
    const target = event.currentTarget
    const move = (next: PointerEvent) => {
      const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
      const dx = (next.clientX - start.x) / scale
      const dy = (next.clientY - start.y) / scale
      if (tool === 'scale') {
        const scaleBox = { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height }
        const origin = handleOrigin(scaleBox, start.handle, next.altKey)
        const startCorner = {
          x: start.handle.includes('e')
            ? scaleBox.x + scaleBox.width
            : start.handle.includes('w')
              ? scaleBox.x
              : scaleBox.x + scaleBox.width / 2,
          y: start.handle.includes('s')
            ? scaleBox.y + scaleBox.height
            : start.handle.includes('n')
              ? scaleBox.y
              : scaleBox.y + scaleBox.height / 2
        }
        onScale(origin, scaleFactorFromDrag(origin, startCorner, dx, dy))
        return
      }
      onResize(node.id, {
        ...resizeRect(start.nodeX, start.nodeY, start.width, start.height, start.handle, dx, dy, {
          lockAspect: Boolean(node.aspectLocked) || next.shiftKey,
          ratio: start.width / Math.max(1, start.height)
        }),
        world: true
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      drag.current = { ...drag.current, handle: null }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const editText = () => {
    if (node.type === 'comment') {
      const next = window.prompt('Comment', node.text || '')
      if (next !== null) onEdit(node.id, { text: next })
      return
    }
    onEdit(node.id, { editing: true })
  }

  if (node.type === 'comment') {
    const first = node.messages?.[0]
    const author = first ? getCommentPerson(first.authorId) : null
    const showAvatar = Boolean(author && !node.drafting)
    return (
      <div
        className={`design-comment${selected ? ' is-selected' : ''}${node.resolved ? ' is-resolved' : ''}${node.drafting ? ' is-drafting' : ''}`}
        style={{ left: box.x, top: box.y, opacity: node.opacity ?? 1 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={first?.text || 'Comment'}
      >
        {showAvatar && author ? (
          <span className="comment-pin-avatar" style={{ background: author.color }}>
            {author.initial}
          </span>
        ) : (
          <span className="comment-pin-bubble">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M4 6.5C4 4.567 5.567 3 7.5 3h13C22.433 3 24 4.567 24 6.5v9c0 1.933-1.567 3.5-3.5 3.5H12.2L7.1 24.2a.8.8 0 0 1-1.35-.58V19H7.5C5.567 19 4 17.433 4 15.5v-9Z"
                fill="#0D99FF"
                stroke="#0B6FBF"
                strokeWidth="1.2"
              />
            </svg>
          </span>
        )}
      </div>
    )
  }

  if (node.type === 'text') {
    const fontSize = node.fontSize || 12
    const fontFamily = cssFontFamily(node.fontFamily || 'Inter')
    const fontWeight = node.fontWeight || 400
    const fontStyle = node.fontStyle || 'normal'
    ensureGoogleFontLoaded(node.fontFamily || 'Inter', fontWeight, fontStyle === 'italic')
    const letterSpacingPx = resolveLetterSpacingPx(node, fontSize)
    const textResize = node.textResize || 'auto-width'
    const metrics = measurePlainText(
      node.text || (node.editing ? '' : ' '),
      fontFamily,
      fontWeight,
      fontSize,
      letterSpacingPx,
      node.lineHeight && node.lineHeight > 0 ? node.lineHeight : undefined,
      fontStyle
    )
    const width =
      textResize === 'auto-width'
        ? Math.max(node.editing ? 2 : 8, metrics.width)
        : Math.max(8, node.width || metrics.width)
    const height =
      textResize === 'fixed'
        ? Math.max(fontSize, node.height || metrics.height)
        : metrics.height
    const textPaint = getNodePaints(node).find((paint) => paint.visible !== false)
    const textColor =
      textPaint?.type === 'solid'
        ? withAlpha(textPaint.color, textPaint.opacity)
        : withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1)
    const displayText = formatTextCase(node.text || 'Text', node.textCase)
    const finishEdit = () => {
      const text = (editRef.current?.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
      if (!text.trim()) {
        onRemove?.(node.id)
        return
      }
      const size = measurePlainText(
        text,
        fontFamily,
        fontWeight,
        fontSize,
        letterSpacingPx,
        node.lineHeight && node.lineHeight > 0 ? node.lineHeight : undefined,
        fontStyle
      )
      onEdit(node.id, {
        editing: false,
        text,
        name: text,
        width: textResize === 'auto-width' ? size.width : node.width || size.width,
        height: textResize === 'fixed' ? node.height || size.height : size.height,
        textResize
      })
    }
    const wraps = textResize !== 'auto-width' || node.textAlign === 'justify'
    return (
      <BuildRevealShell
        active={Boolean(reveal)}
        className={`design-text${selected || node.editing ? ' is-selected' : ''}${node.editing ? ' is-editing' : ''}${reveal ? ' is-reveal' : ''}`}
        data-font-tick={fontTick}
        style={{
          ...styleFromNode(node, { ...box, width, height }),
          left: box.x,
          top: box.y,
          width,
          height,
          ...(stackZ != null ? { zIndex: stackZ } : {}),
          fontFamily,
          fontWeight,
          fontStyle,
          fontSize,
          lineHeight: node.lineHeight && node.lineHeight > 0 ? `${node.lineHeight}px` : 'normal',
          letterSpacing: letterSpacingPx ? `${letterSpacingPx}px` : undefined,
          textAlign: node.textAlign || 'left',
          textDecoration: node.textDecoration && node.textDecoration !== 'none' ? node.textDecoration : undefined,
          fontVariant: node.textCase === 'small-caps' ? 'small-caps' : undefined,
          textTransform:
            node.textCase === 'upper'
              ? 'uppercase'
              : node.textCase === 'lower'
                ? 'lowercase'
                : node.textCase === 'title'
                  ? 'capitalize'
                  : undefined,
          textIndent: node.paragraphIndent ? `${node.paragraphIndent}px` : undefined,
          display: 'flex',
          flexDirection: 'column',
          justifyContent:
            node.textAlignVertical === 'middle'
              ? 'center'
              : node.textAlignVertical === 'bottom'
                ? 'flex-end'
                : 'flex-start',
          overflow: node.textTruncation || textResize === 'fixed' ? 'hidden' : undefined,
          color: textColor,
          background: 'transparent',
          whiteSpace: wraps ? 'pre-wrap' : 'pre',
          wordBreak: wraps ? 'break-word' : undefined
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.stopPropagation()
          if (selected) {
            editText()
            return
          }
          drillFromPointer(onSelect, node.id, event)
        }}
      >
        <EffectOverlays node={node} radius={0} />
        {node.editing ? (
          <div
            ref={editRef}
            className="design-text-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => {
              const text = (editRef.current?.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
              const size = measurePlainText(
                text || ' ',
                fontFamily,
                fontWeight,
                fontSize,
                letterSpacingPx,
                node.lineHeight && node.lineHeight > 0 ? node.lineHeight : undefined,
                fontStyle
              )
              onEdit(node.id, {
                text,
                name: text || 'Text',
                width: textResize === 'auto-width' ? size.width : Math.max(node.width || size.width, size.width),
                height: textResize === 'fixed' ? Math.max(node.height || size.height, size.height) : size.height
              })
            }}
            onBlur={() => {
              window.requestAnimationFrame(() => {
                if (document.activeElement === editRef.current) return
                finishEdit()
              })
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Enter' && !event.shiftKey && textResize === 'auto-width') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className={`design-text-label${node.textTruncation ? ' is-truncate' : ''}${node.listStyle && node.listStyle !== 'none' ? ` is-list-${node.listStyle}` : ''}`}
            style={{
              ...(node.textTruncation
                ? {
                    display: '-webkit-box',
                    WebkitLineClamp: node.maxLines || 1,
                    WebkitBoxOrient: 'vertical' as const,
                    overflow: 'hidden'
                  }
                : undefined),
              ...(node.paragraphSpacing
                ? { marginBottom: 0 }
                : undefined),
              textIndent: node.paragraphIndent ? `${node.paragraphIndent}px` : undefined
            }}
          >
            {node.listStyle === 'unordered'
              ? displayText
                  .split('\n')
                  .map((line) => (line ? `• ${line}` : line))
                  .join('\n')
              : node.listStyle === 'ordered'
                ? displayText
                    .split('\n')
                    .map((line, index) => (line ? `${index + 1}. ${line}` : line))
                    .join('\n')
                : displayText}
          </span>
        )}
        {showChrome && (
          <>
            <ResizeHandles onStart={startHandle} />
            <div className="design-size">
              {Math.round(width)} × {Math.round(height)}
            </div>
          </>
        )}
      </BuildRevealShell>
    )
  }

  if (node.type === 'widget') {
    return (
      <div
        className={selected ? 'design-widget is-selected' : 'design-widget'}
        style={{
          ...styleFromNode(node, box),
          left: box.x,
          top: box.y,
          width: Math.max(48, node.width || 200),
          height: Math.max(32, node.height || 120),
          ...(stackZ != null ? { zIndex: stackZ } : {})
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span>{node.name || 'Widget'}</span>
      </div>
    )
  }

  if (node.type === 'image') {
    return (
      <BuildRevealShell
        active={Boolean(reveal)}
        className={`design-shape design-image${selected ? ' is-selected' : ''}${reveal ? ' is-reveal' : ''}`}
        style={{
          ...styleFromNode(node, box),
          left: box.x,
          top: box.y,
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
          ...(stackZ != null ? { zIndex: stackZ } : {})
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <EffectOverlays node={node} radius={nodeBorderRadiusCss(node, box.width, box.height)} />
        <NodeImage node={node} fit="stretch" className="design-image-media" />
        {showChrome && (
          <>
            <ResizeHandles onStart={startHandle} />
            <div className="design-size">
              {Math.round(box.width)} × {Math.round(box.height)}
            </div>
          </>
        )}
      </BuildRevealShell>
    )
  }

  const width = Math.max(1, box.width)
  const height = Math.max(1, node.type === 'line' || node.type === 'arrow' ? box.height : Math.max(8, box.height))
  const isFrame = node.type === 'frame'
  const isSection = node.type === 'section'
  const name = node.name || (isSection ? 'Section' : isFrame ? 'New frame name' : node.type)
  const labelColor = isSection ? toHex(node.stroke, '#000000') : undefined
  const showWorkingChrome = Boolean(building && (isFrame || isSection) && !node.parentId)

  return (
    <BuildRevealShell
      active={Boolean(reveal)}
      data-node-id={node.id}
      className={`design-shape design-${node.type}${showChrome || selected ? ' is-selected' : ''}${pathHover ? ' is-path-hover' : ''}${reveal ? ' is-reveal' : ''}${showWorkingChrome ? ' is-build-host' : ''}`}
      style={{
        ...styleFromNode(node, { ...box, width, height }),
        left: box.x,
        top: box.y,
        width,
        height: Math.max(1, height),
        ...(stackZ != null ? { zIndex: stackZ } : {}),
        ...((showWorkingChrome || showChrome) ? { overflow: 'visible' as const } : {})
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation()
        if (selected && node.type === 'text') {
          editText()
          return
        }
        drillFromPointer(onSelect, node.id, event)
      }}
    >
      {showWorkingChrome ? (
        <div className="build-working-anchor" style={{ width }}>
          <BuildWorkingDots width={width} active />
        </div>
      ) : null}
      <PaintLayers node={node} />
      <EffectOverlays
        node={node}
        radius={nodeBorderRadiusCss(node, width, Math.max(1, height), isSection ? 2 : 0)}
      />
      <ShapeGraphic node={node} origin={box} width={width} height={Math.max(1, height)} />
      {isSection && (
        <div
          className="design-section-label"
          style={{
            background: withAlpha(labelColor || '#000000', 0.08),
            color: withAlpha(labelColor || '#000000', 0.75)
          }}
        >
          {name}
        </div>
      )}
      {isFrame &&
        !drafting &&
        !(selected && !hideSoloChrome) &&
        (!node.parentId || allNodes.find((item) => item.id === node.parentId)?.type === 'section') && (
        <div
          className={`design-name${selected ? ' is-selected' : ''}`}
          onPointerDown={(event) => {
            event.stopPropagation()
            selectFromPointer(onSelect, node.id, event)
          }}
        >
          {name}
        </div>
      )}
      {showChrome && (
        <>
          {node.type !== 'line' && node.type !== 'arrow' && <ResizeHandles onStart={startHandle} />}
          <div className="design-size">
            {formatSizeLabel(node, width, Math.max(1, height))}
          </div>
        </>
      )}
    </BuildRevealShell>
  )
}

function ShapeGraphic({
  node,
  origin,
  width,
  height
}: {
  node: DesignNode
  origin: { x: number; y: number }
  width: number
  height: number
}) {
  if (node.type === 'frame' || node.type === 'rect' || node.type === 'section') return null
  const fill = withAlpha(toHex(node.fill, '#D9D9D9'), node.fillOpacity ?? 1)
  const strokeWidth = node.strokeWidth || 0
  const stroke = strokeWidth ? withAlpha(toHex(node.stroke, '#1A1A1A'), node.strokeOpacity ?? 1) : 'none'
  const align =
    node.strokeAlign ||
    (node.type === 'line' || node.type === 'arrow' || node.type === 'path' ? 'center' : 'inside')
  // Approximate inside/outside: SVG strokes are centered; 2× + clip for inside.
  const renderedStroke = strokeWidth && align !== 'center' ? strokeWidth * 2 : strokeWidth
  const clipId = `clip-${node.id}`
  const needsClip = Boolean(strokeWidth && align === 'inside')

  const common = {
    fill,
    stroke,
    strokeWidth: renderedStroke
  }

  let shape: ReactNode = null
  if (node.type === 'ellipse') {
    shape = <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />
  } else if (node.type === 'polygon') {
    shape = <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} {...common} />
  } else if (node.type === 'star') {
    shape = <polygon points={starPoints(width, height)} {...common} />
  } else if (node.type === 'line' || node.type === 'arrow') {
    const points = node.points || [
      { x: origin.x, y: origin.y },
      { x: origin.x + width, y: origin.y + height }
    ]
    const x1 = points[0].x - origin.x
    const y1 = points[0].y - origin.y
    const x2 = points[1].x - origin.x
    const y2 = points[1].y - origin.y
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = 12
    return (
      <svg className="design-shape-svg" width={width} height={Math.max(1, height)}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={toHex(node.stroke || node.fill, '#1A1A1A')} strokeWidth={node.strokeWidth || 2} />
        {node.type === 'arrow' && (
          <polygon
            className="is-filled"
            fill={toHex(node.fill || node.stroke, '#1A1A1A')}
            points={`${x2},${y2} ${x2 - head * Math.cos(angle - 0.4)},${y2 - head * Math.sin(angle - 0.4)} ${x2 - head * Math.cos(angle + 0.4)},${y2 - head * Math.sin(angle + 0.4)}`}
          />
        )}
      </svg>
    )
  }
  if (!shape) return null
  return (
    <svg className="design-shape-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {needsClip && (
        <defs>
          <clipPath id={clipId}>
            {node.type === 'ellipse' ? (
              <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} />
            ) : node.type === 'polygon' ? (
              <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} />
            ) : (
              <polygon points={starPoints(width, height)} />
            )}
          </clipPath>
        </defs>
      )}
      <g clipPath={needsClip ? `url(#${clipId})` : undefined}>{shape}</g>
    </svg>
  )
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

function formatSizeLabel(node: DesignNode, width: number, height: number): string {
  const layout = node.layout
  const axisLabel = (
    layoutSizing: string | undefined,
    frameSizing: string | undefined,
    value: number,
    percent?: number
  ) => {
    if (layoutSizing === 'fill') return `Fill ${Math.round(value)}`
    if (layoutSizing === 'relative') return `${Math.round(percent ?? 100)}%`
    if (frameSizing === 'hug') return `Fit ${Math.round(value)}`
    if (frameSizing === 'fill') return `Fill ${Math.round(value)}`
    return String(Math.round(value))
  }
  if (layout && layout.mode !== 'none') {
    return `${axisLabel(node.layoutSizingH, layout.sizingH, width, node.layoutPercentH)} × ${axisLabel(node.layoutSizingV, layout.sizingV, height, node.layoutPercentV)}`
  }
  if (
    node.layoutSizingH === 'fill' ||
    node.layoutSizingV === 'fill' ||
    node.layoutSizingH === 'relative' ||
    node.layoutSizingV === 'relative'
  ) {
    return `${axisLabel(node.layoutSizingH, undefined, width, node.layoutPercentH)} × ${axisLabel(node.layoutSizingV, undefined, height, node.layoutPercentV)}`
  }
  return `${Math.round(width)} × ${Math.round(height)}`
}

function styleFromNode(node: DesignNode, box: { width: number; height: number }): CSSProperties {
  const isSection = node.type === 'section'
  const isFrame = node.type === 'frame'
  const boxed = isFrame || node.type === 'rect' || node.type === 'widget' || isSection || node.type === 'image'
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const topPaint = paints[0]
  const hasExplicitFill = Boolean(topPaint) || node.fill != null || node.fillOpacity != null
  const fill = toHex(
    node.fill,
    isSection
      ? '#FFFFFF'
      : node.type === 'text'
        ? '#000000'
        : node.type === 'image'
          ? '#FFFFFF'
          : boxed
            ? '#D9D9D9'
            : '#D9D9D9'
  )
  const radii = boxed
    ? clampCornerRadii(resolveCornerRadii(node, isSection ? 2 : 0), box.width, box.height)
    : { tl: 0, tr: 0, br: 0, bl: 0 }
  const radiusCss = borderRadiusCss(radii)
  const stroke = toHex(node.stroke, isSection ? '#000000' : '#1A1A1A')
  const strokeAlpha = node.strokeOpacity ?? (isSection ? 0.1 : 1)
  const strokeWidth = node.strokeWidth || 0
  const strokeAlign =
    node.strokeAlign ||
    (node.type === 'line' || node.type === 'arrow' || node.type === 'path' || isSection ? 'center' : 'inside')
  const strokeColor = withAlpha(stroke, strokeAlpha)
  const shadowParts: string[] = []
  if (boxed && strokeWidth > 0 && !isSection) {
    if (strokeAlign === 'inside') shadowParts.push(`inset 0 0 0 ${strokeWidth}px ${strokeColor}`)
    else if (strokeAlign === 'outside') shadowParts.push(`0 0 0 ${strokeWidth}px ${strokeColor}`)
  }

  const effects = getNodeEffects(node).filter((fx) => fx.visible !== false)
  for (const fx of effects) {
    if (fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW') {
      const sx = fx.offsetX ?? 0
      const sy = fx.offsetY ?? 4
      const sb = fx.radius ?? 4
      const spread = fx.spread ?? 0
      const sc = withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25)
      if (fx.type === 'INNER_SHADOW') shadowParts.push(`inset ${sx}px ${sy}px ${sb}px ${spread}px ${sc}`)
      else if (boxed) shadowParts.push(`${sx}px ${sy}px ${sb}px ${spread}px ${sc}`)
    }
  }
  const shadow = shadowParts.length ? shadowParts.join(', ') : undefined

  const useBorderStroke =
    isSection ||
    (boxed &&
      node.type !== 'text' &&
      node.type !== 'image' &&
      strokeWidth > 0 &&
      (strokeAlign === 'center' || isSection))

  let background: string | undefined = 'transparent'
  // Text uses fill as glyph color, never as a CSS background (that paints a solid bar).
  if (node.type === 'text') {
    background = 'transparent'
  } else if (boxed && node.type === 'image') {
    background = 'transparent'
  } else if (topPaint && boxed) {
    if (topPaint.type === 'solid') background = withAlpha(topPaint.color, topPaint.opacity)
    else if (topPaint.type === 'gradient') background = gradientCss(topPaint)
    else if (topPaint.type === 'shader' || topPaint.type === 'video' || topPaint.type === 'image') {
      background =
        topPaint.type === 'image' && !topPaint.imageDataUrl
          ? 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 12px 12px'
          : 'transparent'
    }
  } else if (hasExplicitFill && boxed && node.type !== 'image') {
    background = withAlpha(fill, node.fillOpacity ?? 1)
  } else if (boxed && !isFrame && !isSection && node.type !== 'image') {
    // Shapes without an explicit fill still need a visible default
    background = withAlpha(fill, node.fillOpacity ?? 1)
  } else if (isSection) {
    background = withAlpha('#FFFFFF', node.fillOpacity ?? 1)
  } else if (isFrame) {
    // Keep a fully transparent fill so empty / no-fill frames still receive clicks
    background = 'rgba(0,0,0,0)'
  } else if (topPaint && !boxed) {
    // Non-boxed vectors (ellipse etc.) still paint via SVG; keep CSS bg clear
    background = 'transparent'
  }

  const filters: string[] = []
  if (!boxed) {
    for (const fx of effects) {
      if (fx.type !== 'DROP_SHADOW') continue
      const drop = `${fx.offsetX ?? 0}px ${fx.offsetY ?? 4}px ${fx.radius ?? 4}px ${withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25)}`
      filters.push(`drop-shadow(${drop})`)
    }
  }
  let layerBlurPx = 0
  let backdropBlurPx = 0
  for (const fx of effects) {
    if (fx.type === 'LAYER_BLUR') layerBlurPx = Math.max(layerBlurPx, blurRadius(fx))
    if (fx.type === 'BACKGROUND_BLUR') backdropBlurPx = Math.max(backdropBlurPx, blurRadius(fx))
    if (fx.type === 'GLASS') backdropBlurPx = Math.max(backdropBlurPx, fx.radius ?? 0)
  }
  if (layerBlurPx > 0) filters.push(`blur(${layerBlurPx}px)`)

  return {
    background,
    border: isSection
      ? `${strokeWidth || 1}px solid ${strokeColor}`
      : node.type === 'text' || node.type === 'image' || !boxed
        ? 'none'
        : useBorderStroke
          ? `${strokeWidth}px solid ${strokeColor}`
          : 'none',
    borderRadius: radiusCss,
    opacity: node.opacity ?? 1,
    boxShadow: boxed ? shadow : undefined,
    filter: filters.length ? filters.join(' ') : undefined,
    backdropFilter: backdropBlurPx > 0 ? `blur(${backdropBlurPx}px)` : undefined,
    WebkitBackdropFilter: backdropBlurPx > 0 ? `blur(${backdropBlurPx}px)` : undefined,
    transform: (() => {
      const parts: string[] = []
      if (node.flipX) parts.push('scaleX(-1)')
      if (node.flipY) parts.push('scaleY(-1)')
      if (node.rotation) parts.push(`rotate(${node.rotation}deg)`)
      return parts.length ? parts.join(' ') : undefined
    })(),
    transformOrigin: 'center center',
    mixBlendMode: cssBlendMode(node.blendMode),
    isolation: cssIsolation(node.blendMode),
    zIndex: isSection ? 0 : 1,
    // Frames keep overflow visible so the name label (above the box) stays
    // hittable — same as auto-layout wraps (`clipsContent: false`). Child
    // nodes are siblings in world space, so CSS overflow never clipped them.
    overflow: isFrame || isSection ? 'visible' : undefined
  }
}

function EffectOverlays({ node, radius }: { node: DesignNode; radius: string | number }) {
  const effects = getNodeEffects(node).filter((fx) => fx.visible !== false && (fx.type === 'NOISE' || fx.type === 'TEXTURE'))
  if (!effects.length) return null
  return (
    <>
      {effects.map((fx) =>
        fx.type === 'NOISE' ? (
          <NoiseOverlay key={fx.id} effect={fx} radius={radius} />
        ) : (
          <TextureOverlay key={fx.id} effect={fx} radius={radius} />
        )
      )}
    </>
  )
}

function NoiseOverlay({ effect, radius }: { effect: DesignEffect; radius: string | number }) {
  const sizeX = Math.max(0.05, effect.noiseSizeX ?? 0.5)
  const sizeY = Math.max(0.05, effect.noiseSizeY ?? sizeX)
  // Figma noiseSize ~ grain scale; map to SVG turbulence baseFrequency (higher = finer)
  const freqX = Math.min(2.5, 0.9 / sizeX)
  const freqY = Math.min(2.5, 0.9 / sizeY)
  const density = Math.max(0, Math.min(1, effect.density ?? 1))
  const opacity = (effect.opacity ?? 0.25) * density
  const color = toHex(effect.color, '#000000')
  const noiseType = effect.noiseType || 'MONOTONE'
  const blend =
    noiseType === 'MULTITONE'
      ? 'soft-light'
      : noiseType === 'DUOTONE'
        ? 'overlay'
        : ((effect.blendMode || 'overlay').toLowerCase() as CSSProperties['mixBlendMode'])
  const uid = effect.id.replace(/[^a-zA-Z0-9_-]/g, '')

  return (
    <div className="design-effect-overlay" style={{ borderRadius: radius, mixBlendMode: blend, opacity }} aria-hidden>
      <svg width="100%" height="100%" preserveAspectRatio="none">
        <defs>
          <filter id={`noise-${uid}`} x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={`${freqX} ${freqY}`} numOctaves="3" stitchTiles="stitch" result="noise" />
            <feColorMatrix
              in="noise"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
              result="mono"
            />
            {noiseType === 'DUOTONE' ? (
              <>
                <feFlood floodColor={color} result="c1" />
                <feFlood floodColor={toHex(effect.secondaryColor, '#FFFFFF')} result="c2" />
                <feBlend in="c1" in2="c2" mode="multiply" result="duo" />
                <feComposite in="duo" in2="mono" operator="in" />
              </>
            ) : (
              <>
                <feFlood floodColor={color} result="flood" />
                <feComposite in="flood" in2="mono" operator="in" />
              </>
            )}
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#noise-${uid})`} />
      </svg>
    </div>
  )
}

function TextureOverlay({ effect, radius }: { effect: DesignEffect; radius: string | number }) {
  // Lightweight placeholder until full texture rendering ships — soft grain grid.
  const size = Math.max(0.05, effect.noiseSizeX ?? 0.5)
  const cell = Math.max(2, Math.round(8 * size))
  const clip = effect.clipToShape !== false
  return (
    <div
      className="design-effect-overlay"
      style={{
        borderRadius: clip ? radius : 0,
        opacity: 0.18,
        backgroundImage: `radial-gradient(circle at 30% 30%, rgba(0,0,0,0.45) 0 0.6px, transparent 1px)`,
        backgroundSize: `${cell}px ${cell}px`,
        mixBlendMode: 'overlay',
        filter: effect.radius ? `blur(${effect.radius}px)` : undefined
      }}
      aria-hidden
    />
  )
}

function PaintLayers({ node }: { node: DesignNode }) {
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const top = paints[0]
  const media = paints.filter((paint) => paint.type === 'shader' || (paint.type === 'video' && paint.videoDataUrl))
  const image = top?.type === 'image' && top.imageDataUrl ? top : null
  if (!media.length && !image) return null
  return (
    <>
      {image ? (
        <AdjustedImage
          src={image.imageDataUrl}
          adjust={image}
          fit={imageFit(image.scaleMode)}
          opacity={image.opacity}
          className="design-paint-media"
        />
      ) : null}
      {media.map((paint, index) => {
        if (paint.type === 'shader') {
          return <ShaderFill key={`shader-${index}`} paint={paint} />
        }
        if (paint.type === 'video' && paint.videoDataUrl) {
          return (
            <video
              key={`video-${index}`}
              className="design-paint-media"
              src={paint.videoDataUrl}
              muted
              loop
              autoPlay
              playsInline
              style={{ opacity: paint.opacity }}
            />
          )
        }
        return null
      })}
    </>
  )
}

function unionWorldBounds(
  nodes: DesignNode[],
  all: DesignNode[]
): { x: number; y: number; width: number; height: number } | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const box = resolveWorldRect(node, all)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function resizeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  handle: Handle,
  dx: number,
  dy: number,
  options?: { lockAspect?: boolean; ratio?: number }
): { x: number; y: number; width: number; height: number } {
  let nextX = x
  let nextY = y
  let nextW = width
  let nextH = height
  if (handle.includes('w')) {
    nextX = x + dx
    nextW = width - dx
  }
  if (handle.includes('e')) nextW = width + dx
  if (handle.includes('n')) {
    nextY = y + dy
    nextH = height - dy
  }
  if (handle.includes('s')) nextH = height + dy
  if (nextW < 0) {
    nextX += nextW
    nextW = Math.abs(nextW)
  }
  if (nextH < 0) {
    nextY += nextH
    nextH = Math.abs(nextH)
  }
  nextW = Math.max(8, nextW)
  nextH = Math.max(8, nextH)

  if (options?.lockAspect && options.ratio && options.ratio > 0) {
    const ratio = options.ratio
    const fromWidth = handle === 'e' || handle === 'w' || Math.abs(dx) >= Math.abs(dy)
    if (fromWidth || handle.length === 1) {
      const lockedH = Math.max(8, nextW / ratio)
      if (handle.includes('n')) nextY = y + height - lockedH
      nextH = lockedH
      if (handle === 'n' || handle === 's') {
        // side handles already set width; keep
      }
    } else {
      const lockedW = Math.max(8, nextH * ratio)
      if (handle.includes('w')) nextX = x + width - lockedW
      nextW = lockedW
    }
    // Corner handles: prefer the axis with larger delta
    if (handle.length === 2) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        nextH = Math.max(8, nextW / ratio)
        if (handle.includes('n')) nextY = y + height - nextH
      } else {
        nextW = Math.max(8, nextH * ratio)
        if (handle.includes('w')) nextX = x + width - nextW
      }
    }
  }

  return { x: nextX, y: nextY, width: nextW, height: nextH }
}
