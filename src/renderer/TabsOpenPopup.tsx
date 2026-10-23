import { useEffect } from 'react'
import { CropSquareIcon, FullscreenIcon } from './lucideIcons'

export function TabsOpenPopup({
  open,
  busy,
  onClose,
  onOpenInCanvas,
  onOpenToLeft
}: {
  open: boolean
  busy?: boolean
  onClose: () => void
  onOpenInCanvas: () => void
  onOpenToLeft: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="ca-popup-backdrop tabs-open-popup-backdrop"
      data-chrome-overlay=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ca-popup-stage" data-chrome-overlay="">
        <div className="ca-popup" role="dialog" aria-modal="true" aria-labelledby="tabs-popup-title" data-chrome-overlay="">
          <div className="ca-popup-title-row">
            <h2 id="tabs-popup-title">Open tab</h2>
            <button type="button" className="ca-popup-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="ca-recent-list" aria-label="Open tab options">
            <button
              type="button"
              className="ca-menu-item"
              onClick={onOpenInCanvas}
              disabled={busy}
            >
              <span className="ca-tabs-option-icon" aria-hidden="true">
                <CropSquareIcon sx={{ fontSize: 22 }} />
              </span>
              <span className="ca-recent-label">
                <strong>Open tab in canvas</strong>
              </span>
              <span className="ca-menu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
            <button
              type="button"
              className="ca-menu-item"
              onClick={onOpenToLeft}
              disabled={busy}
            >
              <span className="ca-tabs-option-icon" aria-hidden="true">
                <FullscreenIcon sx={{ fontSize: 22 }} />
              </span>
              <span className="ca-recent-label">
                <strong>Open tab to the left</strong>
              </span>
              <span className="ca-menu-arrow" aria-hidden="true">
                ›
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
