import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MeasureLine } from './measureMath'
import type { DesignNode } from '../shared/types'

export type MeasureTitle = {
  id: string
  name: string
  kind: DesignNode['type']
  x: number
  y: number
  width: number
  height: number
}

export type MeasureEdgeHighlight = {
  x1: number
  y1: number
  x2: number
  y2: number
}

function TitleIcon({ kind }: { kind: DesignNode['type'] }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 12 12',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.25,
    'aria-hidden': true as const
  }
  if (kind === 'ellipse') {
    return (
      <svg {...common}>
        <ellipse cx="6" cy="6" rx="4.25" ry="4.25" />
      </svg>
    )
  }
  if (kind === 'text') {
    return (
      <svg {...common}>
        <path d="M2.5 3h7M6 3v6.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'frame' || kind === 'section') {
    return (
      <svg {...common}>
        <rect x="1.75" y="1.75" width="8.5" height="8.5" rx="1" />
        <path d="M1.75 4.5h8.5M4.5 1.75v8.5" opacity="0.7" />
      </svg>
    )
  }
  if (kind === 'line' || kind === 'arrow') {
    return (
      <svg {...common}>
        <path d="M2 9.5 10 2.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'image') {
    return (
      <svg {...common}>
        <rect x="1.75" y="2.25" width="8.5" height="7.5" rx="1" />
        <circle cx="4.25" cy="4.75" r="1" fill="currentColor" stroke="none" />
        <path d="M2.5 8.5 5 6.25l1.75 1.5L9.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="1.75" y="1.75" width="8.5" height="8.5" rx="1" />
    </svg>
  )
}

function arrowHead(
  x: number,
  y: number,
  towardX: number,
  towardY: number,
  size = 5
): string {
  const dx = towardX - x
  const dy = towardY - y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const tipX = x
  const tipY = y
  const baseX = x + ux * size
  const baseY = y + uy * size
  return `${tipX},${tipY} ${baseX + px * size * 0.55},${baseY + py * size * 0.55} ${baseX - px * size * 0.55},${baseY - py * size * 0.55}`
}

export function MeasureOverlay({
  lines,
  zoom,
  selectedRect,
  hoverRect,
  titles = [],
  edgeHighlight = null,
  activeLineId = null,
  onLinePointerDown
}: {
  lines: MeasureLine[]
  zoom: number
  selectedRect?: { x: number; y: number; width: number; height: number } | null
  hoverRect?: { x: number; y: number; width: number; height: number } | null
  titles?: MeasureTitle[]
  edgeHighlight?: MeasureEdgeHighlight | null
  activeLineId?: string | null
  onLinePointerDown?: (lineId: string, event: ReactPointerEvent) => void
}) {
  const inv = 1 / Math.max(0.0001, zoom)
  const handleR = 4.5 * inv

  return (
    <div className="measure-layer" aria-hidden>
      {selectedRect && (
        <div
          className="measure-selection"
          style={{
            left: selectedRect.x,
            top: selectedRect.y,
            width: selectedRect.width,
            height: selectedRect.height
          }}
        />
      )}
      {hoverRect && (
        <div
          className="measure-hover"
          style={{
            left: hoverRect.x,
            top: hoverRect.y,
            width: hoverRect.width,
            height: hoverRect.height
          }}
        />
      )}
      {titles.map((title) => (
        <div
          key={`title-${title.id}`}
          className="measure-title"
          style={{
            left: title.x,
            top: title.y,
            transform: `translateY(calc(-100% - 4px)) scale(${inv})`
          }}
        >
          <TitleIcon kind={title.kind} />
          <span>{title.name}</span>
        </div>
      ))}
      <svg className="measure-svg">
        {edgeHighlight && (
          <line
            className="measure-edge"
            x1={edgeHighlight.x1}
            y1={edgeHighlight.y1}
            x2={edgeHighlight.x2}
            y2={edgeHighlight.y2}
          />
        )}
        {lines.map((line) => {
          const active = activeLineId === line.id
          const arrow = 5 * inv
          return (
            <g key={line.id} className={active ? 'is-active' : undefined}>
              {(line.guides || []).map((guide, index) => (
                <line
                  key={`${line.id}-g${index}`}
                  className="measure-guide"
                  x1={guide.x1}
                  y1={guide.y1}
                  x2={guide.x2}
                  y2={guide.y2}
                />
              ))}
              <line
                className="measure-line"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
              />
              <polygon
                className="measure-arrow"
                points={arrowHead(line.x1, line.y1, line.x2, line.y2, arrow)}
              />
              <polygon
                className="measure-arrow"
                points={arrowHead(line.x2, line.y2, line.x1, line.y1, arrow)}
              />
              <line
                className="measure-hit"
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  onLinePointerDown?.(line.id, event)
                }}
                style={{ cursor: line.axis === 'h' ? 'ns-resize' : 'ew-resize' }}
              />
              <circle
                className={`measure-handle${active ? ' is-active' : ''}`}
                cx={line.labelX}
                cy={line.labelY}
                r={handleR}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  onLinePointerDown?.(line.id, event)
                }}
                style={{ cursor: line.axis === 'h' ? 'ns-resize' : 'ew-resize' }}
              />
            </g>
          )
        })}
      </svg>
      {lines.map((line) => (
        <div
          key={`${line.id}-label`}
          className={`measure-label${activeLineId === line.id ? ' is-active' : ''}`}
          style={{
            left: line.labelX,
            top: line.labelY,
            transform: `translate(-50%, -50%) scale(${inv})`
          }}
        >
          {line.label}
        </div>
      ))}
    </div>
  )
}
