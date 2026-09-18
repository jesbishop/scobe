import { useEffect, useRef, useState } from 'react'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import { ALL_FRAME_PRESETS, DEVICE_PRESETS } from '../shared/framePresets'
import { IconCode, IconDesktop, IconMenu, IconPhone, IconSparkle, IconTablet } from './icons'

type SizePreset = {
  id: string
  label: string
  category: string
  width: number
  height: number
}

function matchPreset(presets: SizePreset[], width: number, height: number) {
  return presets.find((preset) => preset.width === width && preset.height === height) || null
}

function categoryFor(presets: SizePreset[], width: number, height: number): string {
  const match = matchPreset(presets, width, height)
  if (match) return match.category
  if (width <= 480) return 'Phone'
  if (width <= 1100) return 'Tablet'
  if (width >= 1800 && height <= 1200) return 'Presentation'
  return 'Desktop'
}

function DeviceIcon({ category }: { category: string }) {
  if (category === 'Tablet') return <IconTablet />
  if (category === 'Phone') return <IconPhone />
  return <IconDesktop />
}

export function FrameActionBar({
  id,
  width,
  height,
  title,
  anchor,
  offset = 52,
  showDevice = true,
  sizeCatalog = 'browser',
  renameable = false,
  onRename,
  onConvert,
  onResize
}: {
  id: string
  width: number
  height: number
  title: string
  anchor: DOMRect | null
  offset?: number
  showDevice?: boolean
  /** `all` = full Figma frame list; `browser` = phone/tablet/desktop/presentation subset */
  sizeCatalog?: 'all' | 'browser'
  renameable?: boolean
  onRename?: (name: string) => void
  onConvert?: () => void
  onResize: (size: { width: number; height: number; name?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const presets = sizeCatalog === 'all' ? ALL_FRAME_PRESETS : DEVICE_PRESETS
  const current = matchPreset(presets, width, height)
  const currentCategory = categoryFor(presets, width, height)
  const designMode = sizeCatalog === 'all'

  useEffect(() => {
    setOpen(false)
    setEditing(false)
  }, [id])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (!anchor || anchor.width < 8) return null

  const top = Math.max(52, anchor.top - offset)
  const left = anchor.left + anchor.width / 2
  const categories = Array.from(new Set(presets.map((preset) => preset.category)))

  const sizeMenu = open && showDevice && (
    <div className="frame-action-menu frame-action-menu-sizes">
      {categories.map((category) => (
        <div key={category} className="frame-action-menu-group">
          <div className="frame-action-menu-label">{category}</div>
          {presets
            .filter((preset) => preset.category === category)
            .map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={current?.id === preset.id ? 'is-on' : ''}
                onClick={() => {
                  onResize({ width: preset.width, height: preset.height, name: preset.label })
                  setOpen(false)
                }}
              >
                <DeviceIcon category={preset.category} />
                <span>{preset.label}</span>
                <em>
                  {preset.width} × {preset.height}
                </em>
              </button>
            ))}
        </div>
      ))}
    </div>
  )

  return (
    <div ref={root} className="frame-action-wrap" style={{ top, left }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="frame-action-bar">
        {showDevice && designMode && (
          editing && renameable ? (
            <input
              autoFocus
              className="frame-action-title-input"
              defaultValue={title}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim()
                if (next && next !== title) onRename?.(next)
                setEditing(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <button
              type="button"
              className={`frame-action-size${open ? ' is-on' : ''}`}
              title="Screen size"
              onClick={() => setOpen((value) => !value)}
              onDoubleClick={(event) => {
                if (!renameable) return
                event.preventDefault()
                event.stopPropagation()
                setOpen(false)
                setEditing(true)
              }}
            >
              <span className="frame-action-size-label">{title}</span>
              <KeyboardArrowDownIcon sx={{ fontSize: 16, opacity: 0.55 }} />
            </button>
          )
        )}
        {showDevice && !designMode && (
          <button
            type="button"
            className={`frame-action-size${open ? ' is-on' : ''}`}
            title="Screen size"
            onClick={() => setOpen((value) => !value)}
          >
            <DeviceIcon category={currentCategory} />
            <span className="frame-action-size-label">{current?.label || currentCategory}</span>
            <KeyboardArrowDownIcon sx={{ fontSize: 16, opacity: 0.55 }} />
          </button>
        )}
        {!designMode &&
          (renameable && editing ? (
            <input
              autoFocus
              className="frame-action-title-input"
              defaultValue={title}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={(event) => {
                const next = event.currentTarget.value.trim()
                if (next && next !== title) onRename?.(next)
                setEditing(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <span className="frame-action-title">{title}</span>
          ))}
        <span className="frame-action-divider" aria-hidden />
        <button
          type="button"
          className="frame-action-icon"
          title={onConvert ? 'Convert to design' : 'AI'}
          disabled={!onConvert}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onConvert?.()
          }}
        >
          <IconSparkle />
        </button>
        <button type="button" className="frame-action-icon" title="Code" disabled>
          <IconCode />
        </button>
        <button type="button" className="frame-action-icon" title="Menu" disabled>
          <IconMenu />
        </button>
      </div>
      {sizeMenu}
    </div>
  )
}
