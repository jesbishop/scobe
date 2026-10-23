import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardArrowDownIcon } from './lucideIcons'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ALL_FRAME_PRESETS, FRAME_PRESET_CATEGORIES, type FramePreset } from '../shared/framePresets'
import { IconDesktop, IconPhone, IconTablet } from './icons'

function matchPreset(width: number, height: number) {
  return ALL_FRAME_PRESETS.find((preset) => preset.width === width && preset.height === height) || null
}

function DeviceIcon({ category }: { category: string }) {
  if (category === 'Tablet') return <IconTablet />
  if (category === 'Phone') return <IconPhone />
  return <IconDesktop />
}

export function FrameDevicePicker({
  width,
  height,
  onSelect
}: {
  width: number
  height: number
  onSelect: (preset: FramePreset) => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 })
  const reduceMotion = useReducedMotion()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const current = matchPreset(Math.round(width), Math.round(height))
  const label = current?.label || `${Math.round(width)} × ${Math.round(height)}`

  useEffect(() => {
    setOpen(false)
  }, [width, height])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const place = () => {
      const btn = button.current
      const el = menu.current
      if (!btn) return
      const pad = 8
      const btnRect = btn.getBoundingClientRect()
      const menuWidth = el?.offsetWidth || 280
      const menuHeight = el?.offsetHeight || 320
      let left = btnRect.left
      let top = btnRect.bottom + 6
      if (left + menuWidth > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - menuWidth - pad)
      }
      if (top + menuHeight > window.innerHeight - pad) {
        top = Math.max(pad, btnRect.top - menuHeight - 6)
      }
      setMenuPos({ left, top })
    }
    place()
    const frame = requestAnimationFrame(place)
    return () => cancelAnimationFrame(frame)
  }, [open])

  const transition = reduceMotion
    ? { duration: 0.08 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <div className="frame-device-picker" ref={root}>
      <button
        ref={button}
        type="button"
        className={`frame-device-trigger${open ? ' is-on' : ''}`}
        title="Device size"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {current && <DeviceIcon category={current.category} />}
        <span className="frame-device-label">{label}</span>
        <KeyboardArrowDownIcon sx={{ fontSize: 16, opacity: 0.55 }} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              key="frame-device-menu"
              ref={menu}
              className="layer-menu frame-device-menu"
              data-chrome-overlay=""
              role="menu"
              aria-label="Device sizes"
              style={{ left: menuPos.left, top: menuPos.top }}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
              transition={transition}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {FRAME_PRESET_CATEGORIES.map((category) => (
                <div key={category.id} className="layer-menu-section">
                  <div className="frame-device-menu-label">{category.label}</div>
                  {category.presets.map((preset) => {
                    const active =
                      current?.label === preset.name &&
                      current.width === preset.width &&
                      current.height === preset.height
                    return (
                      <button
                        key={`${category.id}:${preset.name}`}
                        type="button"
                        role="menuitem"
                        className={`layer-menu-item frame-device-menu-item${active ? ' is-on' : ''}`}
                        onClick={() => {
                          onSelect(preset)
                          setOpen(false)
                        }}
                      >
                        <span className="frame-device-menu-name">
                          <DeviceIcon category={category.label} />
                          {preset.name}
                        </span>
                        <em>
                          {preset.width} × {preset.height}
                        </em>
                      </button>
                    )
                  })}
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
