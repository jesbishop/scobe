import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/**
 * Pre-build wait: a looping pencil sketch of Van Gogh’s Starry Night
 * (swirls, cypress, village) drawn in the host center.
 */
export function BuildDrawingAnim({ active }: { active: boolean }) {
  const reduce = useReducedMotion()
  const uid = useId().replace(/:/g, '')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active || reduce) return
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
      if (now - last >= 32) {
        last = now
        setTick((t) => t + 1)
      }
      raf = window.requestAnimationFrame(step)
    }
    raf = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(raf)
  }, [active, reduce])

  // ~3.2s cycle: draw → hold → fade → redraw
  const cycle = reduce ? 1 : (tick % 100) / 100
  const drawPhase = clamp01(cycle / 0.68)
  const fade = cycle < 0.78 ? 1 : clamp01(1 - (cycle - 0.78) / 0.22)
  const tipStroke = Math.min(STROKES.length - 1, Math.floor(drawPhase * STROKES.length))
  const tipLocal = clamp01(drawPhase * STROKES.length - tipStroke)
  const tip = tipPoint(STROKES[tipStroke].tip, tipLocal)

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          className="build-drawing-anim"
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          <svg
            className="build-drawing-svg"
            viewBox="0 0 120 90"
            width="100%"
            height="100%"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient id={`ink-${uid}`} x1="8%" y1="12%" x2="92%" y2="88%">
                <stop offset="0%" stopColor="#8a9bb0" stopOpacity="0.5" />
                <stop offset="50%" stopColor="#5c6d84" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#4a5a70" stopOpacity="0.8" />
              </linearGradient>
              <filter id={`soft-${uid}`} x="-15%" y="-15%" width="130%" height="130%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="0.28" />
              </filter>
            </defs>

            <g opacity={0.5 + 0.5 * fade} filter={`url(#soft-${uid})`}>
              {STROKES.map((stroke, i) => {
                const local = clamp01(drawPhase * 1.12 - i * 0.09)
                const drawn = easeOut(local)
                return (
                  <path
                    key={i}
                    d={stroke.d}
                    stroke={`url(#ink-${uid})`}
                    strokeWidth={stroke.w}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={1}
                    strokeDasharray="1"
                    strokeDashoffset={1 - drawn}
                    opacity={(0.28 + 0.72 * drawn) * fade}
                  />
                )
              })}
            </g>

            {!reduce && fade > 0.08 ? (
              <g opacity={0.9 * fade}>
                <circle cx={tip.x} cy={tip.y} r={2.2} fill="#7a8b9e" opacity={0.32} />
                <circle cx={tip.x} cy={tip.y} r={1.05} fill="#4e5f74" />
              </g>
            ) : null}
          </svg>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** Starry Night — cypress, swirling sky, moon, village hills. */
const STROKES: Array<{ d: string; w: number; tip: [number, number][] }> = [
  // Tall cypress (left)
  {
    d: 'M 22 78 C 18 62, 16 48, 18 34 C 20 22, 26 14, 28 22 C 30 34, 26 50, 28 66 C 29 72, 26 78, 22 78',
    w: 1.7,
    tip: [
      [22, 78],
      [17, 48],
      [28, 18],
      [26, 66],
      [22, 78]
    ]
  },
  // Big sky swirl (center)
  {
    d: 'M 38 28 C 48 18, 68 16, 82 24 C 94 32, 96 44, 86 50 C 74 56, 58 48, 52 38 C 48 32, 44 30, 38 28',
    w: 1.55,
    tip: [
      [38, 28],
      [68, 16],
      [94, 36],
      [70, 54],
      [38, 28]
    ]
  },
  // Inner swirl
  {
    d: 'M 54 34 C 60 28, 72 28, 78 34 C 82 38, 80 44, 72 46 C 64 48, 56 42, 54 34',
    w: 1.25,
    tip: [
      [54, 34],
      [72, 28],
      [80, 40],
      [54, 34]
    ]
  },
  // Crescent moon (upper right)
  {
    d: 'M 98 18 C 104 16, 108 22, 106 28 C 104 34, 96 34, 94 28 C 98 30, 102 26, 100 22 C 98 20, 98 18, 98 18',
    w: 1.35,
    tip: [
      [98, 18],
      [108, 22],
      [100, 32],
      [94, 28]
    ]
  },
  // Stars (short dashes as little sparks)
  {
    d: 'M 44 14 L 46 16 M 62 12 L 64 14 M 78 10 L 80 12 M 50 22 L 52 24',
    w: 1.15,
    tip: [
      [44, 14],
      [62, 12],
      [78, 10],
      [52, 24]
    ]
  },
  // Secondary sky wave
  {
    d: 'M 34 42 C 48 36, 70 40, 88 36 C 98 34, 104 40, 100 46',
    w: 1.2,
    tip: [
      [34, 42],
      [70, 38],
      [100, 46]
    ]
  },
  // Hills / village base
  {
    d: 'M 30 72 C 42 66, 58 68, 72 64 C 86 60, 98 64, 108 70',
    w: 1.4,
    tip: [
      [30, 72],
      [72, 64],
      [108, 70]
    ]
  },
  // Church steeple + roofs
  {
    d: 'M 64 72 L 66 58 L 68 72 M 52 74 L 58 70 L 64 74 M 70 74 L 78 68 L 86 74 M 88 74 L 96 70 L 104 76',
    w: 1.2,
    tip: [
      [64, 72],
      [66, 58],
      [58, 70],
      [78, 68],
      [96, 70]
    ]
  }
]

/** @deprecated Prefer BuildDrawingAnim */
export const BuildWorkingDots = BuildDrawingAnim

function tipPoint(pts: [number, number][], t: number): { x: number; y: number } {
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 50, y: pts[0]?.[1] ?? 50 }
  const scaled = clamp01(t) * (pts.length - 1)
  const i = Math.min(pts.length - 2, Math.floor(scaled))
  const local = scaled - i
  const a = pts[i]
  const b = pts[i + 1]
  return {
    x: a[0] + (b[0] - a[0]) * local,
    y: a[1] + (b[1] - a[1]) * local
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function easeOut(t: number) {
  const x = clamp01(t)
  return 1 - Math.pow(1 - x, 2.6)
}

type RevealShellProps = {
  active: boolean
  children: ReactNode
  className?: string
  style?: CSSProperties
} & Record<string, unknown>

export function BuildRevealShell({ active, children, className, style, ...rest }: RevealShellProps) {
  const reduce = useReducedMotion()
  if (!active) {
    return (
      <div className={className} style={style} {...rest}>
        {children}
      </div>
    )
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={
        reduce
          ? { opacity: 0 }
          : {
              opacity: 0,
              y: 8,
              clipPath: 'inset(6% 2% 10% 2%)'
            }
      }
      animate={{
        opacity: 1,
        y: 0,
        clipPath: 'inset(0% 0% 0% 0%)'
      }}
      transition={
        reduce
          ? { duration: 0.18 }
          : { type: 'spring', stiffness: 380, damping: 30, mass: 0.75 }
      }
      {...rest}
    >
      {children}
    </motion.div>
  )
}
