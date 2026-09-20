import type { AlignGuide } from './alignGuides'

export function AlignGuidesOverlay({ guides, zoom }: { guides: AlignGuide[]; zoom: number }) {
  if (!guides.length) return null
  const radius = 3.2 / Math.max(0.05, zoom)
  return (
    <svg className="align-guides" aria-hidden>
      {guides.map((guide, index) => (
        <g key={index}>
          <line x1={guide.x1} y1={guide.y1} x2={guide.x2} y2={guide.y2} />
          {guide.dots.map((dot, dotIndex) => (
            <circle key={dotIndex} cx={dot.x} cy={dot.y} r={radius} />
          ))}
        </g>
      ))}
    </svg>
  )
}
