import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { besidePopoverMotion } from './popoverMotion'
import { AddIcon, RemoveIcon } from './lucideIcons'
import {
  fillTypeOf,
  newStopId,
  paintForFillType,
  paintPreviewCss,
  type ColorFormat,
  type FillTypeId,
  type GradientStop,
  type Paint
} from '../shared/paint'
import { setGradientEdit } from './gradientEdit'
import { setShaderEdit } from './shaderEdit'
import { ImageStudio, STUDIO_MIN_HEIGHT, studioHeightFor, studioWidthForHeight, useImageAspect } from './ImageStudio'
import { ShaderEditor } from './ShaderEditor'
import {
  checkerboardCss,
  clamp,
  hexToHsb,
  hexToRgb,
  hsbToHex,
  hslToRgb,
  parseHex,
  rgbToHex,
  rgbToHsl,
  withAlpha
} from './colorMath'

export type PaintKind = 'solid' | 'gradient' | 'pattern' | 'image' | 'video' | 'shader'

const PAINT_KINDS: Array<{ id: PaintKind; title: string; fillType?: FillTypeId }> = [
  { id: 'solid', title: 'Solid', fillType: 'solid' },
  { id: 'gradient', title: 'Gradient', fillType: 'linear' },
  { id: 'pattern', title: 'Pattern' },
  { id: 'image', title: 'Image', fillType: 'image' },
  { id: 'video', title: 'Video', fillType: 'video' },
  { id: 'shader', title: 'Shader', fillType: 'shader' }
]

const FORMAT_LABELS: Record<ColorFormat, string> = {
  hex: 'Hex',
  rgb: 'RGB',
  css: 'CSS',
  hsl: 'HSL',
  hsb: 'HSB'
}

const PICKER_CHECKER = 'repeating-conic-gradient(#e6e6e6 0% 25%, #fff 0% 50%) 50% / 8px 8px'

/** Image editing popup width; the user drags it bigger and it's remembered. Height follows the photo. */
const STUDIO_SIZE_KEY = 'scobe.imageStudioSize'
const STUDIO_MIN_WIDTH = 420
const STUDIO_MAX_WIDTH = 1400

/** Image editing never rises above the app's tab bar. */
function studioTopLimit(): number {
  const bar = document.querySelector('.file-tabs')
  return Math.round(bar?.getBoundingClientRect().bottom ?? 0) + 8
}

function loadStudioWidth(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(STUDIO_SIZE_KEY) || 'null') as { width?: number } | null
    if (saved && Number.isFinite(saved.width)) return Math.max(STUDIO_MIN_WIDTH, saved.width!)
  } catch {
    /* fall back to the default size */
  }
  return STUDIO_MIN_WIDTH
}

function saveStudioWidth(width: number): void {
  try {
    localStorage.setItem(STUDIO_SIZE_KEY, JSON.stringify({ width }))
  } catch {
    /* storage unavailable; the size just won't persist */
  }
}

type Props = {
  strokeMode?: boolean
  above?: boolean
  paint: Paint
  pageColors?: Array<{ color: string; opacity: number }>
  /** Named color sources (the page, then each frame); replaces `pageColors` when given. */
  colorSets?: ColorSet[]
  onChange: (paint: Paint) => void
  onClose: () => void
  anchor?: DOMRect | null
  /** Only solid colors (e.g. strokes); hides paint-type switching and visibility. */
  solidOnly?: boolean
  /** Hide opacity controls for colors that are always fully opaque (e.g. the page background). */
  opaque?: boolean
  /** Open to the left of `anchor` (e.g. from inside another floating popover) instead of beside the inspector. */
  beside?: boolean
  /** Restrict the paint types offered (others show disabled). Defaults to every type. */
  kinds?: PaintKind[]
  /** Show on-canvas gradient handles on the selection (off when the paint isn't a node fill). */
  canvasHandles?: boolean
}

export function FillPicker({
  paint, above = false, strokeMode = false,
  pageColors = [],
  colorSets,
  onChange,
  onClose,
  anchor,
  solidOnly = false,
  opaque = false,
  beside = false,
  kinds,
  canvasHandles = true
}: Props) {
  const [tab, setTab] = useState<'custom' | 'libraries'>('custom')
  const [format, setFormat] = useState<ColorFormat>('hex')
  const [formatOpen, setFormatOpen] = useState(false)
  const [activeStopId, setActiveStopId] = useState<string | null>(
    paint.type === 'gradient' ? paint.stops[0]?.id || null : null
  )
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const sets: ColorSet[] = colorSets ?? (pageColors.length ? [{ id: 'page', label: 'On this page', colors: pageColors }] : [])
  const [setId, setSetId] = useState<string | null>(null)
  const activeSet = sets.find((item) => item.id === setId) || sets[0]
  const [studioWidth, setStudioWidth] = useState(loadStudioWidth)
  const resizeAnchor = useRef<{ right: number; bottom: number } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const imageStudioRef = useRef(false)
  imageStudioRef.current = paint.type === 'image' && !strokeMode
  const studioAspect = useImageAspect(paint.type === 'image' ? paint.imageDataUrl : undefined)
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight)
  /** Height of everything in the popup except the photo area (tabs, type row, image mode row, padding). */
  const [studioChrome, setStudioChrome] = useState(200)
  // Width stops where the photo reaches its tallest, so the popup never widens without the image growing.
  // The whole popup, chrome included, has to fit between the tab bar and an 8px bottom margin.
  const studioHeightCap = Math.max(STUDIO_MIN_HEIGHT, viewportHeight - 8 - studioTopLimit() - studioChrome)
  const studioWidthCap = Math.max(STUDIO_MIN_WIDTH, studioWidthForHeight(studioHeightCap, studioAspect))
  const popupWidth = Math.min(studioWidth, studioWidthCap)
  const studioHeight = Math.min(studioHeightFor(popupWidth, studioAspect), studioHeightCap)
  const reduceMotion = useReducedMotion()
  const { exit: _exit, ...enterMotion } = besidePopoverMotion(reduceMotion)
  const type = fillTypeOf(paint)
  const kind: PaintKind = paint.type === 'gradient' ? 'gradient' : (paint.type as PaintKind)
  const visible = paint.visible !== false

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (root.current?.contains(target)) return
      if (target?.closest?.('[data-gradient-handles], .shape-capture-overlay, .shader-fills-popup.is-beside')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    // Nested pickers (a shader's own colors) pass canvasHandles={false} and must not clear the shader's ring.
    if (canvasHandles) setShaderEdit(paint.type === 'shader' && !solidOnly ? { paint, onChange } : null)
    if (paint.type !== 'gradient' || solidOnly || !canvasHandles) {
      setGradientEdit(null)
      return
    }
    setGradientEdit({ paint, activeStopId, onChange, onActiveStop: setActiveStopId })
  })
  const ownsShaderHandles = useRef(canvasHandles)
  ownsShaderHandles.current = canvasHandles
  useEffect(
    () => () => {
      setGradientEdit(null)
      if (ownsShaderHandles.current) setShaderEdit(null)
    },
    []
  )

  const anchorTop = anchor?.top ?? null
  const anchorLeft = anchor?.left ?? null
  const anchorRight = anchor?.right ?? null

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (anchorTop == null || anchorLeft == null || anchorRight == null) {
      setPos({ top: 120, left: 80 })
      return
    }
    if (above) {
      setPos({ left: Math.max(8, Math.min(window.innerWidth - width - 8, anchorLeft)), top: Math.max(8, anchorTop - height - 10) })
      return
    }
    if (beside) {
      const left = Math.max(8, anchorLeft - width - 8)
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, anchorTop))
      setPos({ top, left })
      return
    }
    // Sit just left of the inspector panel, like Figma.
    const panel = el.parentElement?.closest('.rightbar') as HTMLElement | null
    const panelLeft = panel ? panel.getBoundingClientRect().left : anchorLeft - 16
    let left = panelLeft - width - 8
    if (left < 8) left = Math.min(window.innerWidth - width - 8, anchorRight + 8)
    const lowest = window.innerHeight - height - 8
    // Image editing sits on the bottom of the page and grows upward.
    const top = imageStudioRef.current ? Math.max(studioTopLimit(), lowest) : Math.max(8, Math.min(lowest, anchorTop - 48))
    setPos({ top, left })
  }, [anchorTop, anchorLeft, anchorRight, tab, type, sets.length > 0, beside, above])

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Measure the real chrome height so the photo cap leaves room for it.
  useLayoutEffect(() => {
    const el = root.current
    if (!el || paint.type !== 'image' || strokeMode) return
    // scrollHeight, not offsetHeight: once the popup hits its max-height the visible box stops growing,
    // which would under-measure the chrome and leave the photo too tall to fit.
    const chrome = el.scrollHeight - studioHeight
    if (chrome > 0 && Math.abs(chrome - studioChrome) > 1) setStudioChrome(chrome)
  })

  // The popup can grow after it's placed (an image's size loads, a different fill type, the window shrinks):
  // slide it back up so its bottom never runs off the page. Image editing stays pinned to the bottom.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const keepOnScreen = () => {
      if (resizeAnchor.current) return
      const height = el.offsetHeight
      setPos((current) => {
        if (!current) return current
        const lowest = window.innerHeight - height - 8
        const top = imageStudioRef.current ? Math.max(studioTopLimit(), lowest) : Math.max(8, Math.min(current.top, lowest))
        return top === current.top ? current : { ...current, top }
      })
    }
    const observer = new ResizeObserver(keepOnScreen)
    observer.observe(el)
    window.addEventListener('resize', keepOnScreen)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', keepOnScreen)
    }
  }, [])

  // While resizing from the top-left grip, keep the bottom-right corner where it was.
  useLayoutEffect(() => {
    const anchor = resizeAnchor.current
    const el = root.current
    if (!anchor || !el) return
    setPos({ left: anchor.right - el.offsetWidth, top: Math.max(studioTopLimit(), anchor.bottom - el.offsetHeight) })
  }, [popupWidth, studioHeight])

  const activeColor =
    paint.type === 'solid'
      ? { color: paint.color, opacity: paint.opacity }
      : paint.type === 'gradient'
        ? (() => {
            const stop = paint.stops.find((item) => item.id === activeStopId) || paint.stops[0]
            return { color: stop?.color || '#D9D9D9', opacity: stop?.opacity ?? 1 }
          })()
        : paint.type === 'shader'
          ? { color: paint.colors[0] || '#5100ff', opacity: paint.opacity }
          : { color: '#D9D9D9', opacity: paint.opacity }

  const setActiveColor = (color: string, opacity: number) => {
    if (paint.type === 'solid') {
      onChange({ ...paint, color: parseHex(color), opacity })
      return
    }
    if (paint.type === 'gradient') {
      const id = activeStopId || paint.stops[0]?.id
      onChange({
        ...paint,
        stops: paint.stops.map((stop) =>
          stop.id === id ? { ...stop, color: parseHex(color), opacity } : stop
        )
      })
      return
    }
    if (paint.type === 'shader') {
      const colors = [...paint.colors]
      colors[0] = parseHex(color)
      onChange({ ...paint, colors, opacity })
    }
  }

  const imageStudio = paint.type === 'image' && !strokeMode

  // Top-left grip: the bottom-right corner stays put, and pulling left or up both scale the photo.
  const startStudioResize = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !pos || !root.current) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const start = popupWidth
    const right = pos.left + root.current.offsetWidth
    const bottom = pos.top + root.current.offsetHeight
    // Everything above the photo (tabs, type row, image mode row) stays the same height while resizing.
    const chromeY = root.current.scrollHeight - studioHeight
    const tallest = Math.min(studioHeightCap, bottom - studioTopLimit() - chromeY)
    const maxWidth = Math.min(STUDIO_MAX_WIDTH, right - 8, studioWidthCap, studioWidthForHeight(tallest, studioAspect))
    resizeAnchor.current = { right, bottom }
    let latest = start
    const move = (next: PointerEvent) => {
      const grow = Math.max(startX - next.clientX, (startY - next.clientY) * studioAspect)
      latest = clamp(start + grow, STUDIO_MIN_WIDTH, Math.max(STUDIO_MIN_WIDTH, maxWidth))
      setStudioWidth(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-studio-resize')
      resizeAnchor.current = null
      saveStudioWidth(latest)
    }
    document.body.classList.add('is-studio-resize')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <motion.div
      ref={root}
      className={`fill-picker${solidOnly ? ' is-solid-only' : ''}${imageStudio ? ' is-image-studio' : ''}`}
      style={{
        ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' as const }),
        ...(imageStudio ? { width: popupWidth } : null),
        transformOrigin: 'right top'
      }}
      {...enterMotion}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {imageStudio && (
        <span className="fill-picker-resize" title="Drag to resize" onPointerDown={startStudioResize}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
            <path d="M1.5 8.5l7-7M1.5 4.5l3-3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
        </span>
      )}
      <div className="fill-picker-head">
        <div className="fill-picker-tabs">
          {strokeMode ? (
            (['solid', 'gradient'] as const).map(option => <button type="button" key={option} disabled={option === 'gradient' && solidOnly} className={kind === option ? 'is-on' : ''} onClick={() => {
              if (kind === option) return
              const next = paintForFillType(option === 'solid' ? 'solid' : 'linear', paint)
              onChange(next)
              if (next.type === 'gradient') setActiveStopId(next.stops[0]?.id || null)
            }}>{option === 'solid' ? 'Solid' : 'Gradient'}</button>)
          ) : (
            <>
              <button type="button" className={tab === 'custom' ? 'is-on' : ''} onClick={() => setTab('custom')}>
                Custom
              </button>
              <button type="button" className={tab === 'libraries' ? 'is-on' : ''} onClick={() => setTab('libraries')}>
                Libraries
              </button>
            </>
          )}
        </div>
        {!strokeMode && (
          <button type="button" className="fill-picker-icon-btn" title="Create style" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button type="button" className="fill-picker-icon-btn" title="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {tab === 'libraries' ? (
        <div className="fill-picker-empty">Document and team libraries coming soon.</div>
      ) : (
        <>
          {!strokeMode && (
            <div className="fill-type-row">
              {PAINT_KINDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.fillType ? item.title : `${item.title} (coming soon)`}
                  disabled={!item.fillType || (solidOnly && item.id !== 'solid') || (kinds != null && !kinds.includes(item.id))}
                  className={`fill-type-btn${kind === item.id ? ' is-on' : ''}`}
                  onClick={() => {
                    if (!item.fillType || kind === item.id) return
                    const next = paintForFillType(item.fillType, paint)
                    onChange(next)
                    if (next.type === 'gradient') setActiveStopId(next.stops[0]?.id || null)
                  }}
                >
                  <PaintKindIcon id={item.id} />
                </button>
              ))}
              <span className="fill-type-spacer" />
              <button type="button" className="fill-type-btn" title="Blend mode" disabled>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M8 2.2c2.3 2.6 4 4.6 4 6.8a4 4 0 0 1-8 0c0-2.2 1.7-4.2 4-6.8Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                disabled={solidOnly}
                className={`fill-type-btn${visible ? '' : ' is-on'}`}
                title={visible ? 'Hide fill' : 'Show fill'}
                aria-pressed={!visible}
                onClick={() => onChange({ ...paint, visible: !visible })}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M12.6 5.4A5.5 5.5 0 0 1 5.4 12.6M3.4 10.6a5.5 5.5 0 0 1 7.2-7.2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  <path d="M5.2 7.6c1.6-.2 3 .6 3.6 2.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )}

          {paint.type === 'gradient' && (
            <GradientEditor
              strokeMode={strokeMode}
              paint={paint}
              activeStopId={activeStopId}
              onActiveStop={setActiveStopId}
              onChange={onChange}
            />
          )}
          {(paint.type === 'solid' || paint.type === 'gradient') && (
            <ColorWheel
              color={activeColor.color}
              opacity={activeColor.opacity}
              opaque={opaque}
              format={format}
              formatOpen={formatOpen}
              onFormatOpen={setFormatOpen}
              onFormat={setFormat}
              onChange={setActiveColor}
            />
          )}

          {paint.type === 'image' && <ImageFillEditor paint={paint} onChange={onChange} studioHeight={studioHeight} />}
          {paint.type === 'video' && <VideoFillEditor paint={paint} onChange={onChange} />}
          {paint.type === 'shader' && <ShaderFillEditor paint={paint} onChange={onChange} />}

          {activeSet && (paint.type === 'solid' || paint.type === 'gradient') && (
            <div className="fill-page-colors">
              <ColorSetMenu sets={sets} active={activeSet.id} onPick={setSetId} />
              {activeSet.colors.length === 0 && <div className="fill-page-empty">No colors in this frame yet.</div>}
              <div className="fill-page-swatches">
                {activeSet.colors.map(({ color, opacity }) => (
                  <button
                    key={`${color}:${opacity}`}
                    type="button"
                    className="fill-page-swatch"
                    style={{
                      background:
                        opacity < 1
                          ? `linear-gradient(90deg, ${color} 50%, ${withAlpha(color, opacity)} 50%), ${PICKER_CHECKER}`
                          : color
                    }}
                    title={opacity < 1 ? `${color} · ${Math.round(opacity * 100)}%` : color}
                    onClick={() => setActiveColor(color, opacity)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

export type ColorSet = {
  id: string
  label: string
  /** Shown muted after the label, e.g. a frame's size. */
  detail?: string
  colors: Array<{ color: string; opacity: number }>
}

/** Picks which colors the swatches show: the whole page, or one frame on the canvas. */
function ColorSetMenu({ sets, active, onPick }: { sets: ColorSet[]; active: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = sets.find((item) => item.id === active) || sets[0]

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null)
      return
    }
    const rect = rootRef.current?.querySelector('button')?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    // The swatches sit at the bottom of the popup, so the list usually opens upward over the picker.
    if (below >= 180 || below >= above) setPlace({ left: rect.left, width: rect.width, top: rect.bottom + 4, maxHeight: below })
    else setPlace({ left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top + 4, maxHeight: above })
  }, [open])

  if (!current) return null
  return (
    <div className="fill-set-picker" ref={rootRef}>
      <button
        type="button"
        className={`fill-page-select${open ? ' is-open' : ''}`}
        disabled={sets.length < 2}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="fill-set-current">
          <span>{current.label}</span>
          {current.detail ? <span className="fill-set-detail">{current.detail}</span> : null}
        </span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
          <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && place && (
        <div
          className="fill-scale-menu fill-set-menu"
          role="menu"
          style={{ left: place.left, top: place.top, bottom: place.bottom, minWidth: place.width, maxHeight: place.maxHeight }}
        >
          {sets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === current.id}
              onClick={() => {
                setOpen(false)
                onPick(item.id)
              }}
            >
              <span className="fill-scale-check" aria-hidden>
                {item.id === current.id ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7.4 5.7 10 11 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span className="fill-set-label">{item.label}</span>
              {item.detail ? <span className="fill-set-detail">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const GRADIENT_KINDS = [
  { id: 'linear', label: 'Linear' },
  { id: 'radial', label: 'Radial' },
  { id: 'angular', label: 'Angular' },
  { id: 'diamond', label: 'Diamond' }
] as const

function GradientEditor({
  strokeMode = false,
  paint,
  activeStopId,
  onActiveStop,
  onChange
}: {
  strokeMode?: boolean
  paint: Extract<Paint, { type: 'gradient' }>
  activeStopId: string | null
  onActiveStop: (id: string) => void
  onChange: (paint: Paint) => void
}) {
  const sorted = [...paint.stops].sort((a, b) => a.position - b.position)
  const barRef = useRef<HTMLDivElement>(null)
  const kindRef = useRef<HTMLDivElement>(null)
  const [kindOpen, setKindOpen] = useState(false)
  const [kindMenuPos, setKindMenuPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!kindOpen) return
    const onDown = (event: MouseEvent) => {
      if (!kindRef.current?.contains(event.target as Node)) setKindOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setKindOpen(false)
    }
    const onScroll = () => setKindOpen(false)
    const scroller = kindRef.current?.closest('.fill-picker')
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    scroller?.addEventListener('scroll', onScroll)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [kindOpen])

  useLayoutEffect(() => {
    if (!kindOpen) {
      setKindMenuPos(null)
      return
    }
    const button = kindRef.current?.querySelector('button')
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuHeight = GRADIENT_KINDS.length * 28 + 14
    const below = rect.bottom + 4
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - menuHeight) : below
    setKindMenuPos({ top, left: rect.left, width: rect.width })
  }, [kindOpen])

  const setStop = (id: string, patch: Partial<GradientStop>) => {
    onChange({
      ...paint,
      stops: paint.stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop))
    })
  }

  const addStop = () => {
    const mid = 0.5
    const stop: GradientStop = {
      id: newStopId(),
      position: mid,
      color: sorted[0]?.color || '#FFFFFF',
      opacity: 1
    }
    onChange({ ...paint, stops: [...paint.stops, stop] })
    onActiveStop(stop.id)
  }

  const removeStop = (id: string) => {
    if (paint.stops.length <= 2) return
    const next = paint.stops.filter((stop) => stop.id !== id)
    onChange({ ...paint, stops: next })
    if (activeStopId === id) onActiveStop(next[0]?.id || '')
  }

  const reverse = () => {
    onChange({
      ...paint,
      stops: paint.stops.map((stop) => ({ ...stop, position: 1 - stop.position }))
    })
  }

  const rotate = () => {
    const angle = ((paint.angle || 0) + 90) % 360
    if (!paint.handles) {
      onChange({ ...paint, angle })
      return
    }
    // Quarter turn clockwise around the box centre.
    const turn = (point: { x: number; y: number }) => ({ x: 0.5 - (point.y - 0.5), y: 0.5 + (point.x - 0.5) })
    onChange({ ...paint, angle, handles: { start: turn(paint.handles.start), end: turn(paint.handles.end) } })
  }

  return (
    <div className="fill-gradient">
      <div className="fill-gradient-toolbar">
        <div className="fill-format-select fill-kind-select" ref={kindRef}>
          <button type="button" className={kindOpen ? 'is-open' : undefined} onClick={() => setKindOpen((open) => !open)}>
            <span>{GRADIENT_KINDS.find((item) => item.id === paint.gradientKind)?.label ?? 'Linear'}</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {kindOpen && kindMenuPos && (
            <div
              className="fill-format-menu"
              style={{ top: kindMenuPos.top, left: kindMenuPos.left, minWidth: kindMenuPos.width }}
            >
              {GRADIENT_KINDS.filter(item => !strokeMode || item.id === 'linear' || item.id === 'radial').map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={paint.gradientKind === item.id ? 'is-on' : ''}
                  onClick={() => {
                    if (item.id !== paint.gradientKind) onChange({ ...paint, gradientKind: item.id, handles: undefined })
                    setKindOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" title="Reverse" onClick={reverse}>
          ⇄
        </button>
        <button type="button" title="Rotate" onClick={rotate}>
          ↻
        </button>
      </div>
      <div
        ref={barRef}
        className="fill-gradient-bar"
        style={{ background: paintPreviewCss(paint) }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).dataset.stop) return
          const rect = barRef.current?.getBoundingClientRect()
          if (!rect) return
          const position = clamp((event.clientX - rect.left) / rect.width)
          const stop: GradientStop = {
            id: newStopId(),
            position,
            color: sorted[0]?.color || '#FFFFFF',
            opacity: 1
          }
          onChange({ ...paint, stops: [...paint.stops, stop] })
          onActiveStop(stop.id)
        }}
      >
        {sorted.map((stop) => (
          <button
            key={stop.id}
            type="button"
            data-stop="1"
            className={`fill-gradient-stop${stop.id === activeStopId ? ' is-on' : ''}`}
            style={{ left: `${stop.position * 100}%`, background: withAlpha(stop.color, stop.opacity) }}
            onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              onActiveStop(stop.id)
              const rect = barRef.current?.getBoundingClientRect()
              if (!rect) return
              const move = (next: PointerEvent) => {
                const position = clamp((next.clientX - rect.left) / rect.width)
                setStop(stop.id, { position })
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
        ))}
      </div>
      <div className="fill-stops-head">
        <span>Stops</span>
        <button type="button" onClick={addStop} title="Add stop">
          <AddIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      <div className="fill-stops-list">
        {sorted.map((stop) => (
          <div key={stop.id} className={`fill-stop-row${stop.id === activeStopId ? ' is-on' : ''}`}>
            <input
              className="fill-stop-pos"
              value={Math.round(stop.position * 100)}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                setStop(stop.id, { position: clamp(next / 100) })
              }}
            />
            <span className="fill-stop-pct">%</span>
            <button
              type="button"
              className="fill-stop-swatch"
              style={{ background: withAlpha(stop.color, stop.opacity) }}
              onClick={() => onActiveStop(stop.id)}
            />
            <input
              className="fill-stop-hex"
              value={stop.color.replace('#', '').toUpperCase()}
              spellCheck={false}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                if (raw.length === 6) setStop(stop.id, { color: `#${raw.toUpperCase()}` })
              }}
            />
            <input
              className="fill-stop-opacity"
              value={Math.round(stop.opacity * 100)}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                setStop(stop.id, { opacity: clamp(next / 100) })
              }}
            />
            <span className="fill-stop-pct">%</span>
            <button type="button" className="fill-stop-remove" onClick={() => removeStop(stop.id)}>
              <RemoveIcon sx={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ColorWheel({
  color,
  opacity,
  opaque = false,
  format,
  formatOpen,
  onFormatOpen,
  onFormat,
  onChange
}: {
  color: string
  opacity: number
  opaque?: boolean
  format: ColorFormat
  formatOpen: boolean
  onFormatOpen: (open: boolean) => void
  onFormat: (format: ColorFormat) => void
  onChange: (color: string, opacity: number) => void
}) {
  const hsb = hexToHsb(color)
  const formatRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!formatOpen) return
    const onDown = (event: MouseEvent) => {
      if (!formatRef.current?.contains(event.target as Node)) onFormatOpen(false)
    }
    const onScroll = () => onFormatOpen(false)
    const scroller = formatRef.current?.closest('.fill-picker')
    window.addEventListener('mousedown', onDown, true)
    scroller?.addEventListener('scroll', onScroll)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      scroller?.removeEventListener('scroll', onScroll)
    }
  }, [formatOpen, onFormatOpen])

  // The menu is fixed-positioned so it can extend past the picker's scroll area.
  useLayoutEffect(() => {
    if (!formatOpen) {
      setMenuPos(null)
      return
    }
    const button = formatRef.current?.querySelector('button')
    if (!button) return
    const rect = button.getBoundingClientRect()
    const menuHeight = 5 * 28 + 14
    const below = rect.bottom + 4
    const top = below + menuHeight > window.innerHeight - 8 ? Math.max(8, rect.top - 4 - menuHeight) : below
    setMenuPos({ top, left: rect.left })
  }, [formatOpen])

  const setHsb = (next: { h?: number; s?: number; b?: number }, nextOpacity = opacity) => {
    onChange(hsbToHex({ h: next.h ?? hsb.h, s: next.s ?? hsb.s, b: next.b ?? hsb.b }), nextOpacity)
  }

  const pickSv = (event: ReactPointerEvent | PointerEvent, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect()
    const s = clamp((event.clientX - rect.left) / rect.width) * 100
    const b = (1 - clamp((event.clientY - rect.top) / rect.height)) * 100
    setHsb({ s, b })
  }

  const drag = (event: ReactPointerEvent<HTMLDivElement>, apply: (clientX: number, rect: DOMRect) => void) => {
    const el = event.currentTarget
    const run = (clientX: number) => apply(clientX, el.getBoundingClientRect())
    run(event.clientX)
    const move = (next: PointerEvent) => run(next.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Slider thumbs are 16px and stay fully inside the track.
  const trackValue = (clientX: number, rect: DOMRect) => clamp((clientX - rect.left - 8) / Math.max(1, rect.width - 16))
  const thumbLeft = (value: number) => `calc(8px + (100% - 16px) * ${clamp(value)})`

  const eyeDrop = async () => {
    const EyeDropperCtor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!EyeDropperCtor) return
    try {
      const result = await new EyeDropperCtor().open()
      onChange(parseHex(result.sRGBHex), opacity)
    } catch {
      /* cancelled */
    }
  }

  const rgb = hexToRgb(color)
  const hsl = rgbToHsl(rgb)
  const wide = format === 'hex' || format === 'css'

  return (
    <div className="fill-color-wheel">
      <div
        className="fill-sv"
        style={{ backgroundColor: hsbToHex({ h: hsb.h, s: 100, b: 100 }) }}
        onPointerDown={(event) => {
          const el = event.currentTarget
          pickSv(event, el)
          const move = (next: PointerEvent) => pickSv(next, el)
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <div className="fill-sv-white" />
        <div className="fill-sv-black" />
        <span
          className="fill-sv-thumb"
          style={{
            left: `${hsb.s}%`,
            top: `${100 - hsb.b}%`,
            background: color
          }}
        />
      </div>

      <div className="fill-sliders">
        <button type="button" className="fill-eyedropper" title="Eyedropper" onClick={() => void eyeDrop()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M9.6 4.1 11.1 2.6a1.7 1.7 0 0 1 2.4 2.4l-1.5 1.5.6.6-1 1-4-4 1-1 .6.6ZM8.4 5.9 3.6 10.7c-.3.3-.4.6-.4 1v.9l-.9.9.9.9.9-.9h.9c.4 0 .7-.1 1-.4l4.8-4.8"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="fill-slider-stack">
          <div className="fill-hue" onPointerDown={(event) => drag(event, (x, rect) => setHsb({ h: trackValue(x, rect) * 360 }))}>
            <span
              className="fill-slider-thumb"
              style={{ left: thumbLeft(hsb.h / 360), background: hsbToHex({ h: hsb.h, s: 100, b: 100 }) }}
            />
          </div>
          {!opaque && (
            <div
              className="fill-alpha"
              style={{ background: `linear-gradient(to right, ${withAlpha(color, 0)}, ${withAlpha(color, 1)}), ${PICKER_CHECKER}` }}
              onPointerDown={(event) => drag(event, (x, rect) => onChange(color, trackValue(x, rect)))}
            >
              <span
                className="fill-slider-thumb"
                style={{
                  left: thumbLeft(opacity),
                  background: `linear-gradient(${withAlpha(color, opacity)}, ${withAlpha(color, opacity)}), ${PICKER_CHECKER}`
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="fill-format-row">
        <div className="fill-format-select" ref={formatRef}>
          <button type="button" className={formatOpen ? 'is-open' : undefined} onClick={() => onFormatOpen(!formatOpen)}>
            <span>{FORMAT_LABELS[format]}</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {formatOpen && menuPos && (
            <div className="fill-format-menu" style={{ top: menuPos.top, left: menuPos.left }}>
              {(['hex', 'rgb', 'css', 'hsl', 'hsb'] as ColorFormat[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={format === item ? 'is-on' : ''}
                  onClick={() => {
                    onFormat(item)
                    onFormatOpen(false)
                  }}
                >
                  {FORMAT_LABELS[item]}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`fill-values${wide ? ' is-wide' : ''}`}>
          {format === 'hex' && (
            <TextCell
              value={color.replace('#', '').toUpperCase()}
              onCommit={(raw) => {
                const clean = raw.replace(/[^0-9a-fA-F]/g, '')
                if (clean.length === 3 || clean.length === 6) onChange(parseHex(`#${clean}`), opacity)
              }}
            />
          )}
          {format === 'css' && (
            <TextCell
              value={`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(opacity * 100) / 100})`}
              onCommit={(raw) => {
                const match = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i)
                if (!match) return
                onChange(
                  rgbToHex({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }),
                  match[4] != null ? clamp(Number(match[4])) : opacity
                )
              }}
            />
          )}
          {format === 'rgb' && (
            <>
              <Num value={rgb.r} onChange={(r) => onChange(rgbToHex({ ...rgb, r }), opacity)} />
              <Num value={rgb.g} onChange={(g) => onChange(rgbToHex({ ...rgb, g }), opacity)} />
              <Num value={rgb.b} onChange={(b) => onChange(rgbToHex({ ...rgb, b }), opacity)} />
            </>
          )}
          {format === 'hsl' && (
            <>
              <Num value={Math.round(hsl.h)} onChange={(h) => onChange(rgbToHex(hslToRgb({ ...hsl, h })), opacity)} />
              <Num value={Math.round(hsl.s)} onChange={(s) => onChange(rgbToHex(hslToRgb({ ...hsl, s })), opacity)} />
              <Num value={Math.round(hsl.l)} onChange={(l) => onChange(rgbToHex(hslToRgb({ ...hsl, l })), opacity)} />
            </>
          )}
          {format === 'hsb' && (
            <>
              <Num value={Math.round(hsb.h)} onChange={(h) => setHsb({ h })} />
              <Num value={Math.round(hsb.s)} onChange={(s) => setHsb({ s })} />
              <Num value={Math.round(hsb.b)} onChange={(b) => setHsb({ b })} />
            </>
          )}
          {!opaque && <Num value={Math.round(opacity * 100)} suffix="%" onChange={(v) => onChange(color, clamp(v / 100))} />}
        </div>
      </div>
    </div>
  )
}

function Num({
  value,
  suffix,
  onChange
}: {
  value: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="fill-val">
      <input
        value={draft ?? String(value)}
        onFocus={(event) => {
          setDraft(String(value))
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = Number(event.target.value)
          if (event.target.value.trim() !== '' && Number.isFinite(next)) onChange(next)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {suffix ? <span>{suffix}</span> : null}
    </label>
  )
}

function TextCell({ value, onCommit }: { value: string; onCommit: (raw: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft != null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  return (
    <label className="fill-val">
      <input
        value={draft ?? value}
        spellCheck={false}
        data-arrow-step="off"
        onFocus={(event) => {
          setDraft(value)
          event.currentTarget.select()
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

function PaintKindIcon({ id }: { id: PaintKind }) {
  const frame = <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.1" />
  if (id === 'solid') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {frame}
        <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="0.75" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  }
  if (id === 'gradient') {
    const dots: Array<[number, number]> = [
      [5, 5], [8, 5], [11, 5], [6.5, 6.5], [9.5, 6.5], [5, 8], [8, 8], [11, 8],
      [6.5, 9.5], [9.5, 9.5], [5, 11], [8, 11], [11, 11]
    ]
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {frame}
        {dots.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.65" fill="currentColor" />
        ))}
      </svg>
    )
  }
  if (id === 'pattern') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {frame}
        <path d="M2.5 6h11M2.5 10h11M5.5 2.5V6M10.5 2.5V6M8 6v4M5.5 10v3.5M10.5 10v3.5" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  }
  if (id === 'image') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {frame}
        <path d="M4.5 11.5 7 8.5l2 2 1-1 1.5 2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10.6" cy="5.4" r="1" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    )
  }
  if (id === 'video') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {frame}
        <path d="M6.5 5.6v4.8L10.4 8 6.5 5.6Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {frame}
      <path
        d="M5 6c1-.9 2-.9 3 0s2 .9 3 0M5 8.25c1-.9 2-.9 3 0s2 .9 3 0M5 10.5c1-.9 2-.9 3 0s2 .9 3 0"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

type ScaleMode = NonNullable<Extract<Paint, { type: 'image' }>['scaleMode']>

const SCALE_MODES: Array<{ id: ScaleMode; label: string }> = [
  { id: 'fill', label: 'Fill' },
  { id: 'fit', label: 'Fit' },
  { id: 'crop', label: 'Crop' },
  { id: 'tile', label: 'Tile' }
]

const SCALE_ITEM_H = 28
const SCALE_MENU_PAD = 6

/** Figma-style mode menu: opens over the trigger with the current mode lined up on it. */
function ScaleModeMenu({ mode, onPick }: { mode: ScaleMode; onPick: (mode: ScaleMode) => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const label = SCALE_MODES.find((item) => item.id === mode)?.label || 'Fill'

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const button = rootRef.current?.querySelector('button')
    if (!button) return
    const rect = button.getBoundingClientRect()
    const index = Math.max(0, SCALE_MODES.findIndex((item) => item.id === mode))
    const height = SCALE_MODES.length * SCALE_ITEM_H + SCALE_MENU_PAD * 2
    const aligned = rect.top + rect.height / 2 - (SCALE_MENU_PAD + index * SCALE_ITEM_H + SCALE_ITEM_H / 2)
    const top = Math.min(Math.max(8, aligned), window.innerHeight - height - 8)
    setPos({ top, left: Math.max(8, rect.left - 4) })
  }, [open, mode])

  return (
    <div className="fill-media-mode" ref={rootRef}>
      <button type="button" className={open ? 'is-open' : undefined} onClick={() => setOpen((value) => !value)}>
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
          <path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos && (
        <div className="fill-scale-menu" role="menu" style={{ top: pos.top, left: pos.left }}>
          {SCALE_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === mode}
              onClick={() => {
                setOpen(false)
                if (item.id !== mode) onPick(item.id)
                else if (item.id === 'crop') onPick(item.id)
              }}
            >
              <span className="fill-scale-check" aria-hidden>
                {item.id === mode ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7.4 5.7 10 11 4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ImageFillEditor({
  paint,
  onChange,
  studioHeight
}: {
  paint: Extract<Paint, { type: 'image' }>
  onChange: (paint: Paint) => void
  studioHeight: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mode = paint.scaleMode || 'fill'

  // Figma's rotate button turns the image 90° clockwise; baking it keeps exports and thumbnails in sync.
  const rotate = () => {
    const src = paint.imageDataUrl
    if (!src) return
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalHeight
      canvas.height = image.naturalWidth
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.translate(canvas.width, 0)
      ctx.rotate(Math.PI / 2)
      ctx.drawImage(image, 0, 0)
      const lossy = /^data:image\/jpe?g/i.test(src)
      onChange({ ...paint, imageDataUrl: lossy ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png') })
    }
    image.src = src
  }

  return (
    <div className="fill-media">
      <div className="fill-media-head">
        <ScaleModeMenu
          mode={mode}
          onPick={(next) => {
            onChange({ ...paint, scaleMode: next })
            // Crop opens the on-canvas crop editor with the bar above the toolbar.
            if (next === 'crop') window.setTimeout(() => window.dispatchEvent(new Event('vanta:image-crop')), 0)
          }}
        />
        <button
          type="button"
          className="fill-picker-icon-btn"
          title="Rotate 90°"
          disabled={!paint.imageDataUrl}
          onClick={rotate}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M5.6 3.4 8 1.5l2.4 1.9-2.4 1.9" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
            <path
              d="M8 3.4h.4a4.6 4.6 0 0 1 4.6 4.6M3 8a5 5 0 0 0 5 5 5 5 0 0 0 4.6-3"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            <rect x="5.3" y="6.6" width="5.4" height="3.8" rx="0.8" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        </button>
      </div>
      <ImageStudio paint={paint} onChange={onChange} onUpload={() => inputRef.current?.click()} height={studioHeight} />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            onChange({ ...paint, imageDataUrl: String(reader.result || '') })
          }
          reader.readAsDataURL(file)
        }}
      />
    </div>
  )
}

function VideoFillEditor({
  paint,
  onChange
}: {
  paint: Extract<Paint, { type: 'video' }>
  onChange: (paint: Paint) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="fill-media">
      <div className="fill-media-preview" style={{ background: checkerboardCss(10) }}>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Upload video
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => onChange({ ...paint, videoDataUrl: String(reader.result || '') })
          reader.readAsDataURL(file)
        }}
      />
      {paint.videoDataUrl ? <video className="fill-video-preview" src={paint.videoDataUrl} muted loop autoPlay /> : null}
    </div>
  )
}

function ShaderFillEditor({
  paint,
  onChange
}: {
  paint: Extract<Paint, { type: 'shader' }>
  onChange: (paint: Paint) => void
}) {
  return (
    <div className="fill-shader">
      <ShaderEditor paint={paint} pickerBeside onChange={onChange} />
    </div>
  )
}
