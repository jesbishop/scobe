import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Paint } from '../shared/paint'
import type { ImageAdjust } from '../shared/imageAdjust'
import { AdjustedImage } from './AdjustedImage'

type ImagePaint = Extract<Paint, { type: 'image' }>
type AdjustKey = keyof ImageAdjust

const ADJUSTMENTS: Array<{ key: AdjustKey; label: string }> = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'tint', label: 'Tint' },
  { key: 'saturation', label: 'Saturation' }
]

/** Horizontal space the popup spends outside the photo: fill-media padding, the rail, and the gap beside it. */
const STUDIO_CHROME_X = 32 + 72 + 6
/** The Replace image row under the photo (24px) plus its 12px gap. */
const STUDIO_FOOT = 36
/** Tall enough for the whole rail. */
export const STUDIO_MIN_HEIGHT = 300

/** Width / height of an image, so the studio can keep the photo's proportions. Defaults to 4:3 while loading. */
export function useImageAspect(src?: string): number {
  const [aspect, setAspect] = useState(4 / 3)
  useEffect(() => {
    if (!src) return
    let alive = true
    const image = new Image()
    image.onload = () => {
      if (alive && image.naturalWidth && image.naturalHeight) setAspect(image.naturalWidth / image.naturalHeight)
    }
    image.src = src
    return () => {
      alive = false
    }
  }, [src])
  return aspect
}

/** Studio height for a popup width: the photo fills the stage width at its own aspect ratio. */
export function studioHeightFor(popupWidth: number, aspect: number): number {
  const stageWidth = Math.max(1, popupWidth - STUDIO_CHROME_X)
  return Math.max(STUDIO_MIN_HEIGHT, Math.round(stageWidth / Math.max(0.05, aspect)) + STUDIO_FOOT)
}

/** Widest popup whose photo still fits in `maxHeight`. */
export function studioWidthForHeight(maxHeight: number, aspect: number): number {
  return Math.round((maxHeight - STUDIO_FOOT) * aspect) + STUDIO_CHROME_X
}

/**
 * A handle's horizontal position on the photo is its value: the left edge is -100, the centre 0, the
 * right edge +100. Positions are fractions of the photo, so the full range is reachable at any size.
 */
const X_SPAN = 0.44
const valueToX = (value: number) => 0.5 + (value / 100) * X_SPAN
const xToValue = (x: number) => Math.round(((x - 0.5) / X_SPAN) * 100)
/** Below this a press on the rail is a click (toggle the handle), not a drag. */
const CLICK_SLOP = 3

type Point = { x: number; y: number }
type Rect = { left: number; top: number; width: number; height: number }
type Layout = { stage: Rect; anchors: Partial<Record<AdjustKey, Point>> }

function display(value: number): string {
  const abs = String(Math.abs(value)).padStart(2, '0')
  return value < 0 ? `-${abs}` : abs
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Where the photo is drawn inside the stage: contained, centred across, pinned to the top. */
function photoRect(stage: Rect, aspect: number): Rect {
  const width = Math.min(stage.width, stage.height * aspect)
  const height = width / Math.max(0.05, aspect)
  return { left: stage.left + (stage.width - width) / 2, top: stage.top, width, height }
}

/** Height of a newly shown handle (fraction of the photo), staggered so handles don't stack. */
function defaultY(key: AdjustKey): number {
  const index = ADJUSTMENTS.findIndex((item) => item.key === key)
  return (index + 1) / (ADJUSTMENTS.length + 1)
}

/**
 * The rail number. A click belongs to the rail item (show/hide the handle); double-click to type a value,
 * Enter or click away to apply, Escape to cancel, ↑/↓ to nudge.
 */
function ValueField({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const step = (event: { shiftKey: boolean }, direction: 1 | -1) => {
    const next = clamp(value + direction * (event.shiftKey ? 10 : 1), -100, 100)
    onCommit(next)
    setDraft(String(next))
  }
  if (draft == null) {
    return (
      <span
        className="img-studio-value"
        title={`Double-click to type a ${label.toLowerCase()} value`}
        onDoubleClick={(event) => {
          event.stopPropagation()
          cancelled.current = false
          setDraft(String(value))
        }}
      >
        {display(value)}
      </span>
    )
  }
  return (
    <span className="img-studio-value-edit">
      <input
        autoFocus
        value={draft}
        inputMode="numeric"
        aria-label={label}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onFocus={(event) => {
          const input = event.currentTarget
          window.requestAnimationFrame(() => input.select())
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number.parseInt(draft, 10)
          if (!cancelled.current && Number.isFinite(parsed)) onCommit(clamp(parsed, -100, 100))
          setDraft(null)
        }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          cancelled.current = true
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          step(event, 1)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          step(event, -1)
        }
      }}
      />
    </span>
  )
}

/**
 * Photo adjustments as a rail beside a large preview. Click a rail item to show or hide its handle on
 * the photo; drag a handle (or drag out of a rail item) left/right to set the value, or type it on the rail.
 */
export function ImageStudio({
  paint,
  onChange,
  onUpload,
  height
}: {
  paint: ImagePaint
  onChange: (paint: Paint) => void
  onUpload: () => void
  height?: number
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  /** Sized to the photo's height so its items centre against the photo. */
  const railRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef(new Map<AdjustKey, HTMLDivElement>())
  const latest = useRef({ paint, onChange })
  latest.current = { paint, onChange }
  const [shown, setShown] = useState<AdjustKey[]>(['exposure'])
  const [rows, setRows] = useState<Partial<Record<AdjustKey, number>>>({})
  const [dragging, setDragging] = useState<AdjustKey | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const aspect = useImageAspect(paint.imageDataUrl)

  useLayoutEffect(() => {
    const root = rootRef.current
    const stage = stageRef.current
    if (!root || !stage) return
    const measure = () => {
      const base = root.getBoundingClientRect()
      const box = stage.getBoundingClientRect()
      const anchors: Layout['anchors'] = {}
      for (const [key, el] of itemRefs.current) {
        const rect = el.getBoundingClientRect()
        anchors[key] = { x: rect.right - base.left, y: rect.top + rect.height / 2 - base.top }
      }
      setLayout({ stage: { left: box.left - base.left, top: box.top - base.top, width: box.width, height: box.height }, anchors })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    observer.observe(stage)
    // The rail re-centres when the photo resizes, which moves the anchors the lines start from.
    if (railRef.current) observer.observe(railRef.current)
    return () => observer.disconnect()
  }, [])

  const valueOf = (key: AdjustKey, source: ImagePaint = paint) => Math.round(((source[key] as number) || 0) * 100)
  const setValue = (key: AdjustKey, value: number) => {
    const { paint: current, onChange: commit } = latest.current
    commit({ ...current, [key]: clamp(value, -100, 100) / 100 })
  }

  /** Pointer position as fractions of the photo itself (not the empty stage around it). */
  const toStage = (clientX: number, clientY: number): Point | null => {
    const box = stageRef.current?.getBoundingClientRect()
    if (!box) return null
    const rect = photoRect(box, aspect)
    return {
      x: clamp((clientX - rect.left) / rect.width, 0.5 - X_SPAN, 0.5 + X_SPAN),
      y: clamp((clientY - rect.top) / rect.height, 0.12, 0.96)
    }
  }

  const toggle = (key: AdjustKey) =>
    setShown((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))

  /** The handle follows the pointer; where it sits across the photo sets the value. */
  const beginDrag = (event: ReactPointerEvent, key: AdjustKey, fromRail: boolean) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    const move = (next: PointerEvent) => {
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) < CLICK_SLOP) return
      if (!moved) {
        moved = true
        setDragging(key)
        setShown((current) => (current.includes(key) ? current : [...current, key]))
        document.body.classList.add('is-image-studio-drag')
      }
      const spot = toStage(next.clientX, next.clientY)
      if (!spot) return
      setValue(key, xToValue(spot.x))
      setRows((current) => ({ ...current, [key]: spot.y }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-image-studio-drag')
      setDragging(null)
      if (!moved && fromRail) toggle(key)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const resetAll = () => {
    const { paint: current, onChange: commit } = latest.current
    const next = { ...current }
    for (const item of ADJUSTMENTS) next[item.key] = 0
    commit(next)
  }

  const hasImage = Boolean(paint.imageDataUrl)
  const photo = layout ? photoRect(layout.stage, aspect) : null
  const handles =
    hasImage && photo
      ? ADJUSTMENTS.filter((item) => shown.includes(item.key)).map((item) => {
          const fx = valueToX(valueOf(item.key))
          const fy = rows[item.key] ?? defaultY(item.key)
          const point = { x: photo.left + fx * photo.width, y: photo.top + fy * photo.height }
          const anchor = layout?.anchors[item.key] || point
          const curve = `M${anchor.x} ${anchor.y} C${anchor.x + 48} ${anchor.y}, ${point.x - 48} ${point.y}, ${point.x} ${point.y}`
          return { ...item, point, curve }
        })
      : []

  return (
    <div className="img-studio" ref={rootRef} style={height ? { height } : undefined}>
      <div
        ref={railRef}
        className="img-studio-rail"
        role="group"
        aria-label="Photo adjustments"
        style={hasImage && photo ? { height: photo.height } : undefined}
      >
        {ADJUSTMENTS.map((item) => {
          const value = valueOf(item.key)
          const isShown = hasImage && shown.includes(item.key)
          return (
            <div
              key={item.key}
              ref={(el) => {
                if (el) itemRefs.current.set(item.key, el)
                else itemRefs.current.delete(item.key)
              }}
              role="button"
              tabIndex={-1}
              aria-pressed={isShown}
              className={`img-studio-item${value !== 0 ? ' is-changed' : ''}${isShown ? ' is-shown' : ''}${dragging === item.key ? ' is-dragging' : ''}`}
              title={`${item.label}: click to show its handle on the photo, drag to adjust. Double-click the number to type it, the name to reset.`}
              onPointerDown={(event) => beginDrag(event, item.key, true)}
              onDoubleClick={() => setValue(item.key, 0)}
            >
              <span className="img-studio-short">{item.label}</span>
              <ValueField value={value} label={item.label} onCommit={(next) => setValue(item.key, next)} />
            </div>
          )
        })}
        <button type="button" className="img-studio-reset" title="Reset all adjustments" onClick={resetAll}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3.2 5.2A4.4 4.4 0 1 1 2.6 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M2.6 2.4v2.9h2.9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="img-studio-main">
        <div ref={stageRef} className={`img-studio-stage${hasImage ? ' has-image' : ''}`}>
          {hasImage ? (
            <AdjustedImage src={paint.imageDataUrl!} adjust={paint} fit="contain" className="img-studio-photo" />
          ) : (
            <button type="button" className="img-studio-upload" onClick={onUpload}>
              Upload from computer
            </button>
          )}
        </div>
        {hasImage && (
          <div className="img-studio-foot">
            <button type="button" className="img-studio-replace" onClick={onUpload}>
              Replace image
            </button>
          </div>
        )}
      </div>

      {handles.length > 0 && (
        <svg className="img-studio-link" aria-hidden>
          {handles.map((handle) => (
            <path key={handle.key} d={handle.curve} className={dragging === handle.key ? 'is-dragging' : undefined} />
          ))}
        </svg>
      )}
      {handles.map((handle) => (
        <div
          key={handle.key}
          className={`img-studio-readout${dragging === handle.key ? ' is-dragging' : ''}`}
          style={{ left: handle.point.x, top: handle.point.y }}
          title={`Drag left or right to set ${handle.label.toLowerCase()}`}
          onPointerDown={(event) => beginDrag(event, handle.key, false)}
          onDoubleClick={() => setValue(handle.key, 0)}
        >
          <span className="img-studio-readout-value">{display(valueOf(handle.key))}</span>
          <span className="img-studio-readout-label">{handle.label}</span>
          <span className="img-studio-readout-dot" />
        </div>
      ))}
    </div>
  )
}
