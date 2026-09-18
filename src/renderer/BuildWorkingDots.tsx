import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/** Sharp tick + block progress strip above host artboards only. */
const MARKS = 28

function markKind(tick: number, i: number): 'off' | 'tick' | 'block' {
  const wave = (tick + i * 2) % 11
  if (wave === 0 || wave === 1) return 'block'
  if (wave === 2 || wave === 5 || wave === 8) return 'tick'
  if ((tick + i) % 4 === 0) return 'tick'
  return 'off'
}

export function BuildWorkingDots({
  width,
  active
}: {
  width: number
  active: boolean
}) {
  const reduce = useReducedMotion()
  const [tick, setTick] = useState(0)
  const stripWidth = Math.max(140, Math.min(width * 0.55, 360))

  useEffect(() => {
    if (!active || reduce) return
    const id = window.setInterval(() => setTick((t) => t + 1), 110)
    return () => window.clearInterval(id)
  }, [active, reduce])

  const marks = useMemo(
    () => Array.from({ length: MARKS }, (_, i) => markKind(tick, i)),
    [tick]
  )

  const scanX = ((tick * 14) % (stripWidth + 40)) - 20

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          className="build-working-dots"
          style={{ width: stripWidth }}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 2 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden
        >
          <div className="build-working-track">
            {marks.map((kind, i) => (
              <span
                key={i}
                className={`build-mark build-mark-${kind}`}
                style={{ opacity: kind === 'off' ? 0.18 : 1 }}
              />
            ))}
            {!reduce ? (
              <span className="build-working-scanner" style={{ transform: `translateX(${scanX}px)` }} />
            ) : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
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
