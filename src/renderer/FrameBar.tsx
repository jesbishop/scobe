import { useEffect, useRef, useState } from 'react'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import StraightenIcon from '@mui/icons-material/Straighten'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import GridOnIcon from '@mui/icons-material/GridOn'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
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
  onResize,
  snapshot,
  measure
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
  snapshot?: {
    active: boolean
    onToggle: () => void
  }
  measure?: {
    active: boolean
    inspect: boolean
    xray: boolean
    onToggle: () => void
    onInspect: () => void
    onXray: () => void
  }
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const skipRename = useRef(false)
  const presets = sizeCatalog === 'all' ? ALL_FRAME_PRESETS : DEVICE_PRESETS
  const current = matchPreset(presets, width, height)
  const currentCategory = categoryFor(presets, width, height)
  const designMode = sizeCatalog === 'all'
  const sizeLabel = current?.label || (designMode ? `${width} × ${height}` : currentCategory)

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

  const top = anchor.top - offset
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

  const commitRename = (value: string) => {
    if (skipRename.current) {
      skipRename.current = false
      setEditing(false)
      return
    }
    const next = value.trim()
    if (next && next !== title) onRename?.(next)
    setEditing(false)
  }

  const nameField =
    editing && renameable ? (
      <input
        autoFocus
        className="frame-action-title-input"
        defaultValue={title}
        aria-label="Frame name"
        style={{ width: `${Math.min(28, Math.max(10, title.length + 1))}ch` }}
        onPointerDown={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commitRename(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            skipRename.current = true
            event.currentTarget.blur()
          }
        }}
      />
    ) : renameable ? (
      <button
        type="button"
        className="frame-action-title"
        title="Rename frame"
        onClick={() => {
          setOpen(false)
          setEditing(true)
        }}
      >
        {title}
      </button>
    ) : (
      <span className="frame-action-title" title={title}>
        {title}
      </span>
    )

  return (
    <div ref={root} className="frame-action-wrap" style={{ top, left }} onPointerDown={(event) => event.stopPropagation()}>
      <div className="frame-action-bar">
        {nameField}
        {showDevice && (
          <div className="frame-action-size-wrap">
            <button
              type="button"
              className={`frame-action-size${open ? ' is-on' : ''}`}
              title="Screen size"
              onClick={() => setOpen((value) => !value)}
            >
              {!designMode && <DeviceIcon category={currentCategory} />}
              <span className="frame-action-size-label">{sizeLabel}</span>
              <KeyboardArrowDownIcon sx={{ fontSize: 16, opacity: 0.55 }} />
            </button>
            {sizeMenu}
          </div>
        )}
        {measure && (
          <>
            <span className="frame-action-divider" aria-hidden />
            <button
              type="button"
              className={`frame-action-icon${measure.active ? ' is-on' : ''}`}
              title={measure.active ? 'Measure — hold Alt for spacing' : 'Measure'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                measure.onToggle()
              }}
            >
              <StraightenIcon sx={{ fontSize: 18 }} />
            </button>
            {measure.active && (
              <>
                <button
                  type="button"
                  className={`frame-action-measure${measure.inspect ? ' is-on' : ''}`}
                  title="Inspect"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    measure.onInspect()
                  }}
                >
                  <CenterFocusStrongIcon sx={{ fontSize: 16 }} />
                  <span>Inspect</span>
                </button>
                <button
                  type="button"
                  className={`frame-action-measure${measure.xray ? ' is-on' : ''}`}
                  title="X-ray"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    measure.onXray()
                  }}
                >
                  <GridOnIcon sx={{ fontSize: 16 }} />
                  <span>X-ray</span>
                </button>
              </>
            )}
          </>
        )}
        {snapshot && (
          <>
            <span className="frame-action-divider" aria-hidden />
            <button
              type="button"
              className={`frame-action-measure${snapshot.active ? ' is-on' : ''}`}
              title={snapshot.active ? 'Snapshot — click an element, ↑ parent, ↓ child, Esc cancels' : 'Snapshot'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                snapshot.onToggle()
              }}
            >
              <PhotoCameraOutlinedIcon sx={{ fontSize: 16 }} />
              <span>Snapshot</span>
            </button>
          </>
        )}
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
      {snapshot?.active && (
        <div className="frame-action-hint">Click anything on the page to paste it onto the canvas · ↑ parent · ↓ child · Esc</div>
      )}
    </div>
  )
}
