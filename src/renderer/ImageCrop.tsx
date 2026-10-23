import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { imageAdjustCss, type ImageAdjust } from '../shared/imageAdjust'

export type CropRect = { x: number; y: number; width: number; height: number }

export type CropAspect = 'free' | 'original' | '1:1' | '4:5' | '3:4' | '2:3' | '9:16' | '5:4' | '4:3' | '3:2' | '16:9'

export const CROP_ASPECTS: Array<{ id: CropAspect; label: string; ratio?: number }> = [
  { id: 'free', label: 'Freeform' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '2:3', label: '2:3', ratio: 2 / 3 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '5:4', label: '5:4', ratio: 5 / 4 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 }
]

export function aspectRatioOf(aspect: CropAspect, natural: { w: number; h: number }): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return natural.w / Math.max(1, natural.h)
  return CROP_ASPECTS.find((item) => item.id === aspect)?.ratio ?? null
}

/** Smallest image rect that fully covers the frame (what "Fill" shows). */
export function coverRect(frame: CropRect, natural: { w: number; h: number }): CropRect {
  const scale = Math.max(frame.width / Math.max(1, natural.w), frame.height / Math.max(1, natural.h))
  const width = natural.w * scale
  const height = natural.h * scale
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height }
}

/** Largest image rect that fits inside the frame (what "Fit" shows). */
export function containRect(frame: CropRect, natural: { w: number; h: number }): CropRect {
  const scale = Math.min(frame.width / Math.max(1, natural.w), frame.height / Math.max(1, natural.h))
  const width = natural.w * scale
  const height = natural.h * scale
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height }
}

/** Slider position ↔ image scale relative to the covering size (0.5× – 4×, log scale). */
export const zoomToScale = (value: number) => 0.5 * Math.pow(8, Math.max(0, Math.min(1, value)))
export const scaleToZoom = (scale: number) => Math.max(0, Math.min(1, Math.log(Math.max(1e-6, scale) / 0.5) / Math.log(8)))

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

function resizeFrame(start: CropRect, handle: Handle, dx: number, dy: number, ratio: number | null): CropRect {
  let { x, y, width, height } = start
  const right = start.x + start.width
  const bottom = start.y + start.height
  if (handle.includes('e')) width = Math.max(4, start.width + dx)
  if (handle.includes('w')) width = Math.max(4, start.width - dx)
  if (handle.includes('s')) height = Math.max(4, start.height + dy)
  if (handle.includes('n')) height = Math.max(4, start.height - dy)
  if (ratio) {
    const horizontalEdge = handle === 'e' || handle === 'w'
    const verticalEdge = handle === 'n' || handle === 's'
    if (verticalEdge) width = height * ratio
    else if (horizontalEdge) height = width / ratio
    else if (width / height > ratio) height = width / ratio
    else width = height * ratio
  }
  if (handle.includes('w')) x = right - width
  else if (handle === 'n' || handle === 's') x = start.x + (start.width - width) / 2
  if (handle.includes('n')) y = bottom - height
  else if (handle === 'e' || handle === 'w') y = start.y + (start.height - height) / 2
  return { x, y, width, height }
}

/**
 * On-canvas crop editor (Figma): the whole image shows dimmed, the crop window shows it crisp.
 * Drag inside to move the image; drag the handles to change the crop window.
 */
export function CropOverlay({
  frame,
  image,
  src,
  adjust,
  ratio,
  onChange
}: {
  frame: CropRect
  image: CropRect
  src: string
  adjust?: ImageAdjust | null
  ratio: number | null
  onChange: (next: { frame: CropRect; image: CropRect }) => void
}) {
  const filter = imageAdjustCss(adjust)
  const begin = (event: ReactPointerEvent<HTMLElement>, handle: Handle | null) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1') || 1
    const startX = event.clientX
    const startY = event.clientY
    const startFrame = frame
    const startImage = image
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - startX) / zoom
      const dy = (next.clientY - startY) / zoom
      if (handle) onChange({ frame: resizeFrame(startFrame, handle, dx, dy, next.shiftKey ? null : ratio), image: startImage })
      else onChange({ frame: startFrame, image: { ...startImage, x: startImage.x + dx, y: startImage.y + dy } })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="crop-overlay" onPointerDown={(event) => begin(event, null)}>
      <img
        className="crop-overlay-ghost"
        src={src}
        alt=""
        draggable={false}
        style={{ left: image.x, top: image.y, width: image.width, height: image.height, filter }}
      />
      <div className="crop-overlay-window" style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
        <div className="crop-overlay-clip">
          <img
            src={src}
            alt=""
            draggable={false}
            style={{
              left: image.x - frame.x,
              top: image.y - frame.y,
              width: image.width,
              height: image.height,
              filter
            }}
          />
        </div>
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className={`crop-handle is-${handle}`}
            onPointerDown={(event) => begin(event, handle)}
          />
        ))}
      </div>
    </div>
  )
}

function AspectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2.5 6.5h11M6.5 6.5v6" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function FitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 6h3V3M13 6h-3V3M3 10h3v3M13 10h-3v3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Figma crop bar that sits above the canvas toolbar while an image is being cropped. */
export function CropBar({
  zoom,
  aspect,
  onZoom,
  onAspect,
  onResizeToFit,
  onCancel,
  onApply
}: {
  zoom: number
  aspect: CropAspect
  onZoom: (value: number) => void
  onAspect: (aspect: CropAspect) => void
  onResizeToFit: () => void
  onCancel: () => void
  onApply: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [menuOpen])
  const pct = Math.round(zoom * 100)

  return (
    <div className="crop-bar" role="toolbar" aria-label="Crop image" onPointerDown={(event) => event.stopPropagation()}>
      <span className="crop-bar-title">Crop</span>
      <div className="crop-bar-zoom" style={{ ['--crop-zoom' as string]: `${pct}%` }}>
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          aria-label="Zoom image"
          onChange={(event) => onZoom(Number(event.target.value) / 100)}
        />
      </div>
      <div className="crop-bar-aspect" ref={menuRef}>
        <button
          type="button"
          className={`crop-bar-btn has-caret${menuOpen ? ' is-on' : ''}`}
          title="Aspect ratio"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <AspectIcon />
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M1.8 3 4 5.2 6.2 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {menuOpen && (
          <div className="crop-bar-menu" role="menu">
            {CROP_ASPECTS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={aspect === item.id}
                className={aspect === item.id ? 'is-on' : undefined}
                onClick={() => {
                  onAspect(item.id)
                  setMenuOpen(false)
                }}
              >
                <span className="crop-bar-check">{aspect === item.id ? '✓' : ''}</span>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="crop-bar-btn" title="Resize to fit" onClick={onResizeToFit}>
        <FitIcon />
      </button>
      <span className="crop-bar-sep" aria-hidden />
      <button type="button" className="crop-bar-cancel" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="crop-bar-apply" title="Apply crop (Enter)" onClick={onApply}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M3 7.4 5.7 10 11 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}
