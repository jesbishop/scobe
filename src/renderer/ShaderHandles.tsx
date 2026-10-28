import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { ShaderPaint } from '../shared/paint'
import { getShaderEdit, type ShaderEdit } from './shaderEdit'

type Box = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }

/**
 * Paper shaders measure offset and size against the box's shorter side, and rotate clockwise on
 * screen, so the ring sits where the graphic actually is.
 */
export function shaderTransformGeometry(paint: ShaderPaint, width: number, height: number) {
  const unit = Math.max(1, Math.min(width, height))
  const p = paint.params || {}
  const scale = p.scale ?? 1
  const angle = ((p.rotation ?? 0) * Math.PI) / 180
  const center = { x: width / 2 + (p.offsetX ?? 0) * unit, y: height / 2 + (p.offsetY ?? 0) * unit }
  const radius = Math.max(4, (scale * unit) / 2)
  const knob = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }
  return { unit, center, radius, knob }
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/**
 * Paper's on-object shader transform: drag the centre dot to move the shader, drag the dot on the ring
 * to resize and rotate it.
 */
export function ShaderHandles({ box, transform, edit }: { box: Box; transform?: string; edit: Exclude<ShaderEdit, null> }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const W = Math.max(1, box.width)
  const H = Math.max(1, box.height)
  const { center, radius, knob, unit } = shaderTransformGeometry(edit.paint, W, H)

  const toLocal = (clientX: number, clientY: number): Point | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return { x: point.x, y: point.y }
  }

  const commitParams = (patch: Record<string, number>) => {
    const live = getShaderEdit()
    if (!live) return
    live.onChange({ ...live.paint, params: { ...live.paint.params, ...patch } })
  }

  const drag = (event: ReactPointerEvent, onMove: (local: Point, start: Point) => void) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = toLocal(event.clientX, event.clientY)
    if (!start) return
    const move = (next: PointerEvent) => {
      document.body.classList.add('is-gradient-drag')
      const local = toLocal(next.clientX, next.clientY)
      if (local) onMove(local, start)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-gradient-drag')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startMove = (event: ReactPointerEvent) => {
    const from = { ...center }
    drag(event, (local, start) => {
      const x = from.x + local.x - start.x
      const y = from.y + local.y - start.y
      commitParams({ offsetX: round((x - W / 2) / unit, 4), offsetY: round((y - H / 2) / unit, 4) })
    })
  }

  const startKnob = (event: ReactPointerEvent) => {
    const origin = { ...center }
    drag(event, (local) => {
      const dx = local.x - origin.x
      const dy = local.y - origin.y
      const scale = Math.max(0.01, Math.min(4, (Math.hypot(dx, dy) * 2) / unit))
      const degrees = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
      commitParams({ scale: round(scale, 4), rotation: round(degrees, 2) })
    })
  }

  const at = (point: Point) => ({ left: point.x, top: point.y })

  return (
    <div
      className="gradient-handles shader-handles"
      data-gradient-handles
      style={{ left: box.x, top: box.y, width: W, height: H, transform, transformOrigin: 'center center' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <svg ref={svgRef} className="gradient-handles-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <circle className="gradient-line-shadow shader-ring" cx={center.x} cy={center.y} r={radius} />
        <circle className="gradient-line shader-ring" cx={center.x} cy={center.y} r={radius} />
        <line className="gradient-line-shadow" x1={center.x} y1={center.y} x2={knob.x} y2={knob.y} />
        <line className="gradient-line" x1={center.x} y1={center.y} x2={knob.x} y2={knob.y} />
      </svg>
      <span className="gradient-dot-anchor" style={at(center)}>
        <span className="gradient-dot shader-dot-move" title="Move shader" onPointerDown={startMove} />
      </span>
      <span className="gradient-dot-anchor" style={at(knob)}>
        <span className="gradient-dot shader-dot-knob" title="Resize and rotate shader" onPointerDown={startKnob} />
      </span>
    </div>
  )
}
