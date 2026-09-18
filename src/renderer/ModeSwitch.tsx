import { useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import GestureIcon from '@mui/icons-material/Gesture'
import NearMeIcon from '@mui/icons-material/NearMe'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import type { SwitchMode } from '../shared/types'

const SWITCH: Array<{ id: SwitchMode; label: string; Icon: typeof GestureIcon }> = [
  { id: 'draw', label: 'Draw', Icon: GestureIcon },
  { id: 'design', label: 'Design', Icon: NearMeIcon },
  { id: 'chat', label: 'Chat', Icon: ForumOutlinedIcon }
]

const FIGMA_SPRING = { type: 'spring' as const, stiffness: 520, damping: 38, mass: 0.55 }

export function ModeSwitch({ mode, onMode }: { mode: SwitchMode; onMode: (mode: SwitchMode) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [pill, setPill] = useState({ x: 3, width: 34 })

  useLayoutEffect(() => {
    const track = trackRef.current
    const btn = btnRefs.current[SWITCH.findIndex((item) => item.id === mode)]
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
      {SWITCH.map((item, index) => {
        const Icon = item.Icon
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
              animate={{ color: active ? 'var(--blue-text)' : 'var(--muted)' }}
              transition={{ duration: 0.18 }}
            >
              <Icon sx={{ fontSize: 18 }} />
            </motion.span>
          </button>
        )
      })}
    </div>
  )
}
