import type { MeasureLine } from './measureMath'

export function MeasureOverlay({
  lines,
  zoom,
  selectedRect,
  hoverRect
}: {
  lines: MeasureLine[]
  zoom: number
  selectedRect?: { x: number; y: number; width: number; height: number } | null
  hoverRect?: { x: number; y: number; width: number; height: number } | null
}) {
  const inv = 1 / Math.max(0.0001, zoom)
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
      <svg className="measure-svg">
        {lines.map((line) => (
          <g key={line.id}>
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
            {/* end caps */}
            {line.x1 === line.x2 ? (
              <>
                <line className="measure-cap" x1={line.x1 - 4} y1={line.y1} x2={line.x1 + 4} y2={line.y1} />
                <line className="measure-cap" x1={line.x2 - 4} y1={line.y2} x2={line.x2 + 4} y2={line.y2} />
              </>
            ) : (
              <>
                <line className="measure-cap" x1={line.x1} y1={line.y1 - 4} x2={line.x1} y2={line.y1 + 4} />
                <line className="measure-cap" x1={line.x2} y1={line.y2 - 4} x2={line.x2} y2={line.y2 + 4} />
              </>
            )}
          </g>
        ))}
      </svg>
      {lines.map((line) => (
        <div
          key={`${line.id}-label`}
          className="measure-label"
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
