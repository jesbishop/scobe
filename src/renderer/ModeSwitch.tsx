import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { GestureIcon, NearMeIcon, SparkleIcon } from './lucideIcons'
import type { SwitchMode } from '../shared/types'

const FIGMA_SPRING = { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.55 }

export function ModeSwitch({ mode, onMode }: { mode: SwitchMode; onMode: (mode: SwitchMode) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [pill, setPill] = useState({ x: 2, width: 28 })

  const items: Array<{ id: SwitchMode; label: string; icon: ReactNode }> = [
    { id: 'design', label: 'Design', icon: <NearMeIcon sx={{ fontSize: 18 }} /> },
    { id: 'draw', label: 'Draw', icon: <GestureIcon sx={{ fontSize: 18 }} /> },
    { id: 'chat', label: 'Chat', icon: <SparkleIcon sx={{ fontSize: 18 }} /> }
  ]

  useLayoutEffect(() => {
    const track = trackRef.current
    const btn = btnRefs.current[items.findIndex((item) => item.id === mode)]
    if (!track || !btn) return
    const trackBox = track.getBoundingClientRect()
    const btnBox = btn.getBoundingClientRect()
    setPill({ x: btnBox.left - trackBox.left, width: btnBox.width })
  }, [mode])

  return (
    <div ref={trackRef} className="canvas-toolbar-switch" role="tablist" aria-label="Workspace mode">
      <motion.span
        className="mode-switch-pill"
        initial={false}
        animate={{ x: pill.x, width: pill.width }}
        transition={FIGMA_SPRING}
      />
      {items.map((item, index) => {
        const active = mode === item.id
        return (
          <button
            key={item.id}
            ref={(node) => {
              btnRefs.current[index] = node
            }}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'is-on' : ''}
            title={item.label}
            onClick={() => onMode(item.id)}
          >
            <motion.span
              className="mode-switch-icon"
              animate={{ color: active ? 'var(--mode-switch-on)' : 'var(--mode-switch-off)' }}
              transition={{ duration: 0.18 }}
            >
              {item.icon}
            </motion.span>
          </button>
        )
      })}
    </div>
  )
}
