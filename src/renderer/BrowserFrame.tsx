import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import StraightenIcon from '@mui/icons-material/Straighten'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import GridOnIcon from '@mui/icons-material/GridOn'
import { FRAME_CHROME_HEIGHT, MIN_VIEWPORT, type BrowserFrame as Frame, type BrowserTab } from '../shared/types'
import { normalizeUrl } from '../shared/url'
import { TabFavicon } from './tabFavicon'

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type Props = {
  frame: Frame
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Frame>) => void
  onNavigate: (tabId: string, url: string) => void
  onBack: (tabId: string) => void
  onForward: (tabId: string) => void
  onReload: (tabId: string) => void
  onCloseWindow: () => void
  onNewTab: () => void
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onHole: (el: HTMLDivElement | null) => void
  onInteractEnd: () => void
  measureActive?: boolean
  measureInspect?: boolean
  measureXray?: boolean
  onToggleMeasure?: () => void
  onMeasureInspect?: () => void
  onMeasureXray?: () => void
}

function nextRect(frame: Frame, handle: Handle, dx: number, dy: number): Partial<Frame> {
  let { x, y, width, height } = frame
  if (handle.includes('e')) width += dx
  if (handle.includes('s')) height += dy
  if (handle.includes('w')) {
    x += dx
    width -= dx
  }
  if (handle.includes('n')) {
    y += dy
    height -= dy
  }
  if (width < MIN_VIEWPORT.width) {
    if (handle.includes('w')) x -= MIN_VIEWPORT.width - width
    width = MIN_VIEWPORT.width
  }
  if (height < MIN_VIEWPORT.height) {
    if (handle.includes('n')) y -= MIN_VIEWPORT.height - height
    height = MIN_VIEWPORT.height
  }
  return { x, y, width, height }
}

function tabLabel(tab: BrowserTab): string {
  if (tab.title.trim()) return tab.title.trim()
  if (!tab.url || tab.url === 'about:blank') return 'New tab'
  try {
    return new URL(tab.url).hostname.replace(/^www\./, '')
  } catch {
    return tab.url
  }
}

export function BrowserFrame({
  frame,
  selected,
  onSelect,
  onChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onCloseWindow,
  onNewTab,
  onActivateTab,
  onCloseTab,
  onHole,
  onInteractEnd,
  measureActive = false,
  measureInspect = true,
  measureXray = false,
  onToggleMeasure,
  onMeasureInspect,
  onMeasureXray
}: Props) {
  const active = frame.tabs.find((tab) => tab.id === frame.activeTabId) || frame.tabs[0]
  const [draft, setDraft] = useState(active?.url || '')
  const live = useRef(frame)
  const dragging = useRef<{ kind: 'move' | Handle; x: number; y: number } | null>(null)
  live.current = frame

  useEffect(() => {
    setDraft(active?.url || '')
  }, [active?.url, active?.id])

  const onPointerDown = (kind: 'move' | Handle) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    onSelect()
    dragging.current = { kind, x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragging.current
    if (!drag) return
    const scale = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
    const dx = (event.clientX - drag.x) / scale
    const dy = (event.clientY - drag.y) / scale
    drag.x = event.clientX
    drag.y = event.clientY
    const current = live.current
    const patch = drag.kind === 'move' ? { x: current.x + dx, y: current.y + dy } : nextRect(current, drag.kind, dx, dy)
    live.current = { ...current, ...patch }
    onChange(patch)
  }

  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = null
    onInteractEnd()
  }

  if (!active) return null

  return (
    <div
      className={selected ? 'frame is-selected' : 'frame'}
      style={{
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height + FRAME_CHROME_HEIGHT + (measureActive ? 34 : 0)
      }}
      onPointerDown={(event) => {
        if (event.button === 0) onSelect()
      }}
    >
      <div className="tab-strip" onPointerDown={onPointerDown('move')} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {frame.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === active.id ? 'tab is-active' : 'tab'}
            title={tab.url}
            onPointerDown={(event) => {
              event.stopPropagation()
              onSelect()
              onActivateTab(tab.id)
            }}
          >
            <span className="tab-favicon-wrap">
              <TabFavicon tab={tab} />
            </span>
            <span>{tabLabel(tab)}</span>
            <i
              role="button"
              aria-label="Close tab"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(tab.id)
              }}
            >
              ×
            </i>
          </button>
        ))}
        <button
          type="button"
          className="tab-new"
          title="New tab"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onNewTab()
          }}
        >
          +
        </button>
      </div>
      <div className="frame-toolbar" onPointerDown={onPointerDown('move')} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <button
          type="button"
          disabled={!active.canGoBack}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onBack(active.id)}
        >
          ←
        </button>
        <button
          type="button"
          disabled={!active.canGoForward}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onForward(active.id)}
        >
          →
        </button>
        <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onReload(active.id)}>
          ↻
        </button>
        <input
          value={draft}
          spellCheck={false}
          onPointerDown={(event) => {
            event.stopPropagation()
            void window.vanta.focusShell()
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            onSelect()
            void window.vanta.focusShell()
          }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') onNavigate(active.id, normalizeUrl(draft))
          }}
        />
        <button type="button" title="Close window" onPointerDown={(event) => event.stopPropagation()} onClick={onCloseWindow}>
          ×
        </button>
        <button
          type="button"
          className={`frame-measure-btn${measureActive ? ' is-on' : ''}`}
          title="Measure (Mesurer)"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggleMeasure?.()
          }}
        >
          <StraightenIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      {measureActive && (
        <div className="frame-mesurer-bar" onPointerDown={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={measureInspect ? 'is-on' : ''}
            title="Inspect (I)"
            onClick={() => onMeasureInspect?.()}
          >
            <CenterFocusStrongIcon sx={{ fontSize: 16 }} />
            <span>Inspect</span>
          </button>
          <button
            type="button"
            className={measureXray ? 'is-on' : ''}
            title="X-ray (X)"
            onClick={() => onMeasureXray?.()}
          >
            <GridOnIcon sx={{ fontSize: 16 }} />
            <span>X-ray</span>
          </button>
          <em>Hold Alt for spacing</em>
        </div>
      )}
      <div className="frame-hole" ref={onHole} />
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Handle[]).map((handle) => (
        <div
          key={handle}
          className={`handle ${handle}`}
          onPointerDown={onPointerDown(handle)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}
    </div>
  )
}
