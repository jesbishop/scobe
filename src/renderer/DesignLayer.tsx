import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { DesignNode, DesignTool, PathPoint } from '../shared/types'
import { getCommentPerson } from '../shared/comments'
import { resolveWorldRect } from '../shared/layoutEngine'
import { BuildRevealShell, BuildWorkingDots } from './BuildWorkingDots'
import { handleOrigin, nodeBounds, scaleFactorFromDrag } from './canvasMath'
import { toHex, withAlpha } from './DesignInspector'
import { brushFills, pathDFromPoints } from './drawBrushes'
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
  nodes: DesignNode[]
  selectedIds: string[]
  tool: DesignTool
  draft: DesignNode | null
  hoverPoint?: PathPoint | null
  pathHoverId?: string | null
  revealId?: string | null
  revealIds?: string[]
  buildingIds?: string[]
  onSelect: (id: string, additive: boolean) => void
  onMoveStart: (id: string) => void
  onMove: (id: string, worldX: number, worldY: number) => void
  onMoveEnd?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const selected = new Set(selectedIds)
  const revealing = new Set([...(revealIds || []), ...(revealId ? [revealId] : [])])
  const building = new Set(buildingIds || [])
  const paths = [...nodes, draft].filter((node): node is DesignNode => Boolean(node && node.type === 'path'))
  const group = selectedIds.length > 1 ? unionWorldBounds(nodes.filter((node) => selected.has(node.id)), nodes) : null

  return (
    <div className="design-layer">
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
    </div>
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
  onSelect: (id: string, additive: boolean) => void
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
      onPointerDown={(event) => {
        if (tool === 'text' || tool === 'text-on-path') return
        if (tool !== 'pointer') return
        event.stopPropagation()
        onSelect(node.id, event.shiftKey)
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
  onSelect: (id: string, additive: boolean) => void
  onMoveStart: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
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
  const showChrome = (selected || node.editing) && !hideSoloChrome
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef({ x: 0, y: 0, nodeX: node.x, nodeY: node.y })

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
      onPointerDown={(event) => {
        if (tool === 'hand') return
        event.stopPropagation()
        onSelect(node.id, event.shiftKey)
        if (tool !== 'pointer' || node.editing) return
        onMoveStart(node.id)
        drag.current = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y }
        const target = event.currentTarget
        const move = (next: PointerEvent) => {
          const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
          onMove(node.id, drag.current.nodeX + (next.clientX - drag.current.x) / scale, drag.current.nodeY + (next.clientY - drag.current.y) / scale)
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
        onEdit(node.id, { editing: true })
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
        fontFamily={node.fontFamily || 'Inter, system-ui, sans-serif'}
        fontSize={fontSize}
        fontWeight={node.fontWeight || 400}
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
              fontFamily: node.fontFamily || 'Inter, system-ui, sans-serif',
              fontSize,
              fontWeight: node.fontWeight || 400,
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
  hideSoloChrome: boolean
  pathHover?: boolean
  tool: DesignTool
  drafting: boolean
  reveal?: boolean
  building?: boolean
  onSelect: (id: string, additive: boolean) => void
  onMoveStart: (id: string) => void
  onMove: (id: string, worldX: number, worldY: number) => void
  onMoveEnd?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const drag = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0, width: 0, height: 0, handle: null as Handle | null })
  const editRef = useRef<HTMLDivElement>(null)
  const showChrome = (selected || drafting || node.editing) && !hideSoloChrome
  const world = resolveWorldRect(node, allNodes)
  const box = world

  useEffect(() => {
    if (!node.editing || node.type !== 'text' || !editRef.current) return
    const el = editRef.current
    if (el.innerText !== (node.text || '')) el.innerText = node.text || ''
    el.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [node.editing, node.id, node.type])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'hand') return
    if (tool === 'text' || tool === 'text-on-path') return
    event.stopPropagation()
    onSelect(node.id, event.shiftKey)
    if (tool === 'scale') return
    if (tool !== 'pointer' || node.editing) return
    onMoveStart(node.id)
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: world.x,
      nodeY: world.y,
      width: world.width,
      height: world.height,
      handle: null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || (tool !== 'pointer' && tool !== 'scale')) return
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
      onResize(node.id, { ...resizeRect(start.nodeX, start.nodeY, start.width, start.height, start.handle, dx, dy), world: true })
      return
    }
    onMove(node.id, start.nodeX + dx, start.nodeY + dy)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (!drag.current.handle) onMoveEnd?.(node.id)
  }

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (drafting || (tool !== 'pointer' && tool !== 'scale')) return
    event.stopPropagation()
    onSelect(node.id, false)
    if (tool === 'scale') onScaleStart()
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: world.x,
      nodeY: world.y,
      width: world.width,
      height: world.height,
      handle
    }
    event.currentTarget.setPointerCapture(event.pointerId)
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
    const fontFamily = node.fontFamily || 'Inter, system-ui, sans-serif'
    const fontWeight = node.fontWeight || 400
    const letterSpacing = node.letterSpacing || 0
    const metrics = measurePlainText(node.text || (node.editing ? '' : ' '), fontFamily, fontWeight, fontSize, letterSpacing, node.lineHeight)
    const width = node.textResize === 'fixed' ? Math.max(8, node.width || metrics.width) : Math.max(node.editing ? 2 : 8, metrics.width)
    const height = node.textResize === 'fixed' ? Math.max(fontSize, node.height || metrics.height) : metrics.height
    const finishEdit = () => {
      const text = (editRef.current?.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
      if (!text.trim()) {
        onRemove?.(node.id)
        return
      }
      const size = measurePlainText(text, fontFamily, fontWeight, fontSize, letterSpacing, node.lineHeight)
      onEdit(node.id, {
        editing: false,
        text,
        name: text,
        width: size.width,
        height: size.height,
        textResize: node.textResize || 'auto-width'
      })
    }
    return (
      <BuildRevealShell
        active={Boolean(reveal)}
        className={`design-text${selected || node.editing ? ' is-selected' : ''}${node.editing ? ' is-editing' : ''}${reveal ? ' is-reveal' : ''}`}
        style={{
          ...styleFromNode(node, { ...box, width, height }),
          left: box.x,
          top: box.y,
          width,
          height,
          fontFamily,
          fontWeight,
          fontSize,
          lineHeight: node.lineHeight ? `${node.lineHeight}px` : `${Math.round(fontSize * 1.2)}px`,
          letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
          textAlign: node.textAlign || 'left',
          color: withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={editText}
      >
        {node.editing ? (
          <div
            ref={editRef}
            className="design-text-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={() => {
              const text = (editRef.current?.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
              const size = measurePlainText(text || ' ', fontFamily, fontWeight, fontSize, letterSpacing, node.lineHeight)
              onEdit(node.id, { text, name: text || 'Text', width: size.width, height: size.height })
            }}
            onBlur={finishEdit}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="design-text-label">{node.text || 'Text'}</span>
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
          height: Math.max(32, node.height || 120)
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
          height: Math.max(1, box.height)
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {node.imageDataUrl ? <img className="design-image-media" src={node.imageDataUrl} alt="" draggable={false} /> : null}
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
      className={`design-shape design-${node.type}${showChrome || selected ? ' is-selected' : ''}${pathHover ? ' is-path-hover' : ''}${reveal ? ' is-reveal' : ''}${showWorkingChrome ? ' is-build-host' : ''}`}
      style={{
        ...styleFromNode(node, { ...box, width, height }),
        left: box.x,
        top: box.y,
        width,
        height: Math.max(1, height),
        ...((showWorkingChrome || showChrome) ? { overflow: 'visible' as const } : {})
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        if (!isSection && !isFrame) return
        const next = window.prompt(isSection ? 'Section name' : 'Frame name', name)
        if (next?.trim()) onEdit(node.id, { name: next.trim() })
      }}
    >
      {showWorkingChrome ? (
        <div className="build-working-anchor" style={{ width }}>
          <BuildWorkingDots width={width} active />
        </div>
      ) : null}
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
      {isFrame && !selected && !drafting && <div className="design-name">{name}</div>}
      {showChrome && (
        <>
          {node.type !== 'line' && node.type !== 'arrow' && <ResizeHandles onStart={startHandle} />}
          <div className="design-size">
            {Math.round(width)} × {Math.round(height)}
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
  const stroke = node.strokeWidth ? toHex(node.stroke, '#1A1A1A') : 'none'
  const strokeWidth = node.strokeWidth || 0
  if (node.type === 'ellipse') {
    return (
      <svg className="design-shape-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </svg>
    )
  }
  if (node.type === 'polygon') {
    return (
      <svg className="design-shape-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </svg>
    )
  }
  if (node.type === 'star') {
    return (
      <svg className="design-shape-svg" viewBox={`0 0 ${width} ${height}`}>
        <polygon points={starPoints(width, height)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </svg>
    )
  }
  if (node.type === 'line' || node.type === 'arrow') {
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
  return null
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

function styleFromNode(node: DesignNode, box: { width: number; height: number }): CSSProperties {
  const isSection = node.type === 'section'
  const isFrame = node.type === 'frame'
  const boxed = isFrame || node.type === 'rect' || node.type === 'widget' || isSection || node.type === 'image'
  const fill = toHex(
    node.fill,
    isSection || isFrame || node.type === 'image'
      ? '#FFFFFF'
      : node.type === 'text'
        ? '#000000'
        : boxed
          ? '#DDDDDD'
          : '#D9D9D9'
  )
  const radius = boxed
    ? Math.min(node.radius ?? (isSection ? 2 : 0), Math.min(box.width, box.height) / 2)
    : 0
  const shadow = node.shadow
    ? `${node.shadowX || 0}px ${node.shadowY || 8}px ${node.shadowBlur || 16}px ${withAlpha(toHex(node.shadowColor, '#000000'), 0.28)}`
    : undefined
  const stroke = toHex(node.stroke, isSection ? '#000000' : '#1A1A1A')
  const strokeAlpha = node.strokeOpacity ?? (isSection ? 0.1 : 1)
  const clip = isFrame ? node.clipsContent !== false : false
  return {
    background: boxed && node.type !== 'image' ? withAlpha(fill, node.fillOpacity ?? 1) : node.type === 'image' ? 'transparent' : 'transparent',
    border: isSection
      ? `${node.strokeWidth || 1}px solid ${withAlpha(stroke, strokeAlpha)}`
      : node.type === 'text' || node.type === 'image' || !boxed
        ? 'none'
        : node.strokeWidth
          ? `${node.strokeWidth}px solid ${withAlpha(stroke, strokeAlpha)}`
          : isFrame
            ? '1px solid #d0d0d0'
            : 'none',
    borderRadius: radius,
    opacity: node.opacity ?? 1,
    boxShadow: boxed ? shadow : undefined,
    filter: !boxed && shadow ? `drop-shadow(${shadow})` : undefined,
    transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    transformOrigin: 'center center',
    mixBlendMode: (node.blendMode || 'Normal').toLowerCase() as CSSProperties['mixBlendMode'],
    zIndex: isSection ? 0 : 1,
    overflow: isSection ? 'visible' : clip ? 'hidden' : undefined
  }
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
  dy: number
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
  return { x: nextX, y: nextY, width: Math.max(8, nextW), height: Math.max(8, nextH) }
}
