import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { gradientHandleAngle, gradientHandles, newStopId, type GradientPaint, type GradientPoint } from '../shared/paint'
import { withAlpha } from './colorMath'
import { getGradientEdit, type GradientEdit } from './gradientEdit'

type Box = { x: number; y: number; width: number; height: number }

/** Screen-pixel distance of the stop swatches from the gradient line (Figma). */
const STOP_OFFSET = 18

/**
 * Figma's on-object gradient editor: a line between the start and end handles, with a swatch per stop
 * beside it. Drag the end dots to move the gradient, drag a swatch along the line to move that stop,
 * click the line to add a stop.
 */
export function GradientHandles({ box, transform, edit }: { box: Box; transform?: string; edit: Exclude<GradientEdit, null> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const W = Math.max(1, box.width)
  const H = Math.max(1, box.height)
  const { paint, activeStopId } = edit
  const handles = gradientHandles(paint)
  const S = { x: handles.start.x * W, y: handles.start.y * H }
  const E = { x: handles.end.x * W, y: handles.end.y * H }
  const len = Math.max(0.001, Math.hypot(E.x - S.x, E.y - S.y))
  const normal = { x: (E.y - S.y) / len, y: -(E.x - S.x) / len }
  const sorted = [...paint.stops].sort((a, b) => a.position - b.position)
  const radial = paint.gradientKind !== 'linear'

  const toLocal = (clientX: number, clientY: number): GradientPoint | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: point.x, y: point.y }
  }

  const latest = (): GradientPaint | null => {
    const live = getGradientEdit()
    return live?.paint ?? null
  }

  const commit = (next: GradientPaint) => {
    getGradientEdit()?.onChange(next)
  }

  const withHandles = (base: GradientPaint, start: GradientPoint, end: GradientPoint): GradientPaint => {
    const nextHandles = { start, end }
    return { ...base, handles: nextHandles, angle: gradientHandleAngle(nextHandles, { width: W, height: H }) }
  }

  const drag = (event: ReactPointerEvent, onMove: (local: GradientPoint) => void) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const originX = event.clientX
    const originY = event.clientY
    let moved = false
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - originX, next.clientY - originY) < 3) return
      moved = true
      document.body.classList.add('is-gradient-drag')
      const local = toLocal(next.clientX, next.clientY)
      if (local) onMove(local)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-gradient-drag')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startEndpoint = (event: ReactPointerEvent, which: 'start' | 'end') => {
    const base = latest()
    if (!base) return
    const from = gradientHandles(base)
    drag(event, (local) => {
      const current = latest() || base
      const point = { x: local.x / W, y: local.y / H }
      if (which === 'end') {
        commit(withHandles(current, gradientHandles(current).start, point))
        return
      }
      // Radial kinds move as a whole from their centre; linear moves just the start.
      if (radial) {
        const dx = point.x - from.start.x
        const dy = point.y - from.start.y
        commit(withHandles(current, point, { x: from.end.x + dx, y: from.end.y + dy }))
        return
      }
      commit(withHandles(current, point, gradientHandles(current).end))
    })
  }

  const positionAt = (local: GradientPoint) => {
    const vx = E.x - S.x
    const vy = E.y - S.y
    const t = ((local.x - S.x) * vx + (local.y - S.y) * vy) / (len * len)
    return Math.max(0, Math.min(1, t))
  }

  const startStop = (event: ReactPointerEvent, id: string) => {
    edit.onActiveStop(id)
    drag(event, (local) => {
      const current = latest()
      if (!current) return
      const position = positionAt(local)
      commit({ ...current, stops: current.stops.map((stop) => (stop.id === id ? { ...stop, position } : stop)) })
    })
  }

  const addStopAt = (event: ReactPointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const local = toLocal(event.clientX, event.clientY)
    const current = latest()
    if (!local || !current) return
    const position = positionAt(local)
    const before = [...current.stops].filter((stop) => stop.position <= position).sort((a, b) => b.position - a.position)[0]
    const source = before || sorted[0]
    const stop = { id: newStopId(), position, color: source?.color || '#FFFFFF', opacity: source?.opacity ?? 1 }
    commit({ ...current, stops: [...current.stops, stop] })
    getGradientEdit()?.onActiveStop(stop.id)
  }

  const at = (point: GradientPoint) => ({ left: point.x, top: point.y })

  return (
    <div
      className="gradient-handles"
      data-gradient-handles
      style={{ left: box.x, top: box.y, width: W, height: H, transform, transformOrigin: 'center center' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <svg ref={svgRef} className="gradient-handles-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <line className="gradient-line-shadow" x1={S.x} y1={S.y} x2={E.x} y2={E.y} />
        <line className="gradient-line" x1={S.x} y1={S.y} x2={E.x} y2={E.y} />
        <line className="gradient-line-hit" x1={S.x} y1={S.y} x2={E.x} y2={E.y} onPointerDown={addStopAt} />
      </svg>
      <span className="gradient-dot-anchor" style={at(S)}>
        <span className="gradient-dot" onPointerDown={(event) => startEndpoint(event, 'start')} />
      </span>
      <span className="gradient-dot-anchor" style={at(E)}>
        <span className="gradient-dot" onPointerDown={(event) => startEndpoint(event, 'end')} />
      </span>
      {sorted.map((stop) => {
        const point = { x: S.x + (E.x - S.x) * stop.position, y: S.y + (E.y - S.y) * stop.position }
        const active = stop.id === activeStopId
        return (
          <span key={stop.id} className={`gradient-stop-anchor${active ? ' is-active' : ''}`} style={at(point)}>
            <span
              className={`gradient-stop${active ? ' is-active' : ''}`}
              style={{
                transform: `translate(${normal.x * STOP_OFFSET}px, ${normal.y * STOP_OFFSET}px)`,
                ['--stop-color' as string]: withAlpha(stop.color, stop.opacity)
              }}
              onPointerDown={(event) => startStop(event, stop.id)}
            />
          </span>
        )
      })}
    </div>
  )
}
