import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { DesignNode } from '../shared/types'
import { isAutoLayout } from '../shared/layoutEngine'

export type LayerMenuState = {
  x: number
  y: number
  layerId: string
}

type Props = {
  menu: LayerMenuState | null
  selectedIds: string[]
  selectedNodes: DesignNode[]
  canPaste: boolean
  canPasteStyles: boolean
  onClose: () => void
  onCopy: () => void
  onCopyLink: () => void
  onCopyAsPng: () => void
  onCopyAsTailwind: () => void
  onCopyAsReact: () => void
  onPaste: () => void
  onPasteOnTop: () => void
  onPasteReplace: () => void
  onDuplicate: () => void
  onCopyStyles: () => void
  onPasteStyles: () => void
  onFrameSelection: () => void
  onWrapFlex: () => void
  onRemoveFlex: () => void
  onUngroup: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onToggleVisible: () => void
  onToggleLock: () => void
  onCollapseAll: () => void
}

export function LayerSidebarMenu({
  menu,
  selectedIds,
  selectedNodes,
  canPaste,
  canPasteStyles,
  onClose,
  onCopy,
  onCopyLink,
  onCopyAsPng,
  onCopyAsTailwind,
  onCopyAsReact,
  onPaste,
  onPasteOnTop,
  onPasteReplace,
  onDuplicate,
  onCopyStyles,
  onPasteStyles,
  onFrameSelection,
  onWrapFlex,
  onRemoveFlex,
  onUngroup,
  onBringToFront,
  onSendToBack,
  onToggleVisible,
  onToggleLock,
  onCollapseAll
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const copyAsRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const hasSelection = selectedIds.length > 0
  const primary = selectedNodes[selectedNodes.length - 1] || null
  const allFlex = selectedNodes.length > 0 && selectedNodes.every((node) => isAutoLayout(node))
  const singleFrameNoFlex =
    selectedNodes.length === 1 && primary?.type === 'frame' && !isAutoLayout(primary)
  const canUngroup =
    selectedNodes.length === 1 &&
    (primary?.type === 'frame' || primary?.type === 'section') &&
    selectedNodes.every((node) => node.type === 'frame' || node.type === 'section')
  const hidden = primary?.visible === false || (primary?.opacity ?? 1) === 0
  const locked = Boolean(primary?.locked)
  const copyLabel = selectedIds.length > 1 ? `Copy ${selectedIds.length} elements` : 'Copy'

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || copyAsRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [menu, onClose])

  useEffect(() => {
    const el = root.current
    if (!el || !menu) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, menu.x - rect.width - 8)
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad)
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [menu])

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  const transition = reduceMotion
    ? { duration: 0.08 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <AnimatePresence>
      {menu ? (
        <motion.div
          key={`${menu.layerId}-${menu.x}-${menu.y}`}
          ref={root}
          className="layer-menu"
          data-chrome-overlay=""
          role="menu"
          aria-label="Layer actions"
          style={{ left: menu.x, top: menu.y }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
          transition={transition}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="layer-menu-section">
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopy)}>
              <span>{copyLabel}</span>
              <kbd>Ctrl + C</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopyLink)}>
              <span>Copy link</span>
              <kbd>Ctrl + L</kbd>
            </button>
            <div className={`layer-menu-item has-sub${!hasSelection ? ' is-disabled' : ''}`}>
              <span>Copy as…</span>
              <em className="layer-menu-chevron">›</em>
              {hasSelection ? (
                <div ref={copyAsRef} className="layer-menu-sub">
                  <button type="button" className="layer-menu-item" onClick={run(onCopyAsPng)}>
                    <span>Copy as PNG</span>
                    <kbd>Ctrl + Shift + C</kbd>
                  </button>
                  <div className="ctx-divider" role="separator" />
                  <button type="button" className="layer-menu-item" onClick={run(onCopyAsTailwind)}>
                    <span>Copy as Tailwind</span>
                    <kbd>Alt + T</kbd>
                  </button>
                  <button type="button" className="layer-menu-item" onClick={run(onCopyAsReact)}>
                    <span>Copy as React CSS</span>
                    <kbd>Alt + R</kbd>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="layer-menu-section">
            <button type="button" className={`layer-menu-item${!canPaste ? ' is-disabled' : ''}`} disabled={!canPaste} onClick={run(onPaste)}>
              <span>Paste</span>
              <kbd>Ctrl + V</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!canPaste ? ' is-disabled' : ''}`} disabled={!canPaste} onClick={run(onPasteOnTop)}>
              <span>Paste on top</span>
              <kbd>Ctrl + Shift + V</kbd>
            </button>
            <button
              type="button"
              className={`layer-menu-item${!canPaste || !hasSelection ? ' is-disabled' : ''}`}
              disabled={!canPaste || !hasSelection}
              onClick={run(onPasteReplace)}
            >
              <span>Paste to replace</span>
              <kbd>Ctrl + Shift + R</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onDuplicate)}>
              <span>Duplicate</span>
              <kbd>Ctrl + D</kbd>
            </button>
          </div>

          <div className="layer-menu-section">
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopyStyles)}>
              <span>Copy styles</span>
              <kbd>Ctrl + Alt + C</kbd>
            </button>
            <button
              type="button"
              className={`layer-menu-item${!canPasteStyles || !hasSelection ? ' is-disabled' : ''}`}
              disabled={!canPasteStyles || !hasSelection}
              onClick={run(onPasteStyles)}
            >
              <span>Paste styles</span>
              <kbd>Ctrl + Alt + V</kbd>
            </button>
          </div>

          <div className="layer-menu-section">
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onFrameSelection)}>
              <span>Frame selection</span>
              <kbd>Shift + F</kbd>
            </button>
            <button
              type="button"
              className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`}
              disabled={!hasSelection}
              onClick={run(allFlex ? onRemoveFlex : onWrapFlex)}
            >
              <span>{allFlex ? 'Remove flex' : singleFrameNoFlex ? 'Add flex' : 'Wrap in flex'}</span>
              <kbd>{allFlex ? 'Shift + Alt + A' : 'Shift + A'}</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!canUngroup ? ' is-disabled' : ''}`} disabled={!canUngroup} onClick={run(onUngroup)}>
              <span>Ungroup</span>
              <kbd>Ctrl + Shift + G</kbd>
            </button>
          </div>

          <div className="layer-menu-section">
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onBringToFront)}>
              <span>Bring to front</span>
              <kbd>]</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onSendToBack)}>
              <span>Send to back</span>
              <kbd>[</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onToggleVisible)}>
              <span>{hidden ? 'Show' : 'Show / hide'}</span>
              <kbd>Ctrl + Shift + H</kbd>
            </button>
            <button type="button" className={`layer-menu-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onToggleLock)}>
              <span>{locked ? 'Unlock' : 'Lock / unlock'}</span>
              <kbd>Ctrl + Shift + L</kbd>
            </button>
          </div>

          <div className="layer-menu-section">
            <button type="button" className="layer-menu-item" onClick={run(onCollapseAll)}>
              <span>Collapse all</span>
              <kbd>Alt + L</kbd>
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
