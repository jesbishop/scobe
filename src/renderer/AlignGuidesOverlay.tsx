import type { AlignGuide } from './alignGuides'

export function AlignGuidesOverlay({ guides, zoom }: { guides: AlignGuide[]; zoom: number }) {
  if (!guides.length) return null
  const arm = 2.5 / Math.max(0.02, zoom)
  return (
    <svg className="align-guides" aria-hidden>
      {guides.map((guide, index) => (
        <g key={index}>
          <line x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} />
          <path
            className="align-guide-mark"
            d={guide.dots
              .map(
                (dot) =>
                  `M${dot.x - arm} ${dot.y - arm}L${dot.x + arm} ${dot.y + arm}M${dot.x + arm} ${dot.y - arm}L${dot.x - arm} ${dot.y + arm}`
              )
              .join('')}
          />
        </g>
      ))}
    </svg>
  )
}
