import {
  Component,
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode
} from 'react'
import type { ShaderPaint } from '../shared/paint'
import { ShaderFill } from './ShaderFill'

/** Chromium typically allows ~8–16 WebGL contexts; keep popup under the limit. */
const MAX_THUMB_CONTEXTS = 6
let activeThumbContexts = 0
const waitQueue: Array<() => void> = []

function acquireThumbSlot(): Promise<() => void> {
  const release = () => {
    activeThumbContexts = Math.max(0, activeThumbContexts - 1)
    const next = waitQueue.shift()
    if (next) next()
  }

  if (activeThumbContexts < MAX_THUMB_CONTEXTS) {
    activeThumbContexts += 1
    return Promise.resolve(release)
  }

  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeThumbContexts += 1
      resolve(release)
    })
  })
}

class ShaderThumbBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* keep popup usable when a single mount fails */
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

function thumbFallback(paint: ShaderPaint): CSSProperties {
  const colors = paint.colors.length ? paint.colors : ['#333', '#111']
  if (colors.length === 1) return { background: colors[0] }
  return {
    background: `linear-gradient(135deg, ${colors.join(', ')})`
  }
}

/**
 * Lazily mounts a Paper shader only while visible, and shares a small pool of
 * WebGL contexts so the fills popup does not blank earlier tiles.
 */
export function ShaderThumb({
  paint,
  className,
  style
}: {
  paint: ShaderPaint
  className?: string
  style?: CSSProperties
}) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const view = node.ownerDocument.defaultView
    if (!view?.IntersectionObserver) {
      setVisible(true)
      return
    }
    const scrollRoot =
      node.closest('.shader-fills-body') ||
      node.closest('[data-chrome-overlay]') ||
      null
    const observer = new view.IntersectionObserver(
      ([entry]) => {
        setVisible(Boolean(entry?.isIntersecting))
      },
      { root: scrollRoot instanceof Element ? scrollRoot : null, rootMargin: '80px 0px', threshold: 0.05 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      setMounted(false)
      return
    }

    let cancelled = false
    let release: (() => void) | null = null

    acquireThumbSlot().then((slotRelease) => {
      if (cancelled) {
        slotRelease()
        return
      }
      release = slotRelease
      setMounted(true)
    })

    return () => {
      cancelled = true
      setMounted(false)
      release?.()
      release = null
    }
  }, [visible, paint.shader])

  // Freeze motion in the picker; canvas spawn still uses full speed.
  const previewPaint: ShaderPaint = {
    ...paint,
    speed: 0
  }

  const fallback = <span className="shader-fills-thumb-fallback" style={thumbFallback(paint)} aria-hidden />

  return (
    <span ref={hostRef} className={className} style={{ position: 'absolute', inset: 0, ...style }}>
      {fallback}
      {mounted && (
        <ShaderThumbBoundary fallback={fallback}>
          <ShaderFill
            paint={previewPaint}
            frame={8000}
            maxPixelCount={160 * 160}
            minPixelRatio={1}
            style={{ zIndex: 1 }}
          />
        </ShaderThumbBoundary>
      )}
    </span>
  )
}
