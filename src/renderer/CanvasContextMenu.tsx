import { useEffect, useRef, useState } from 'react'
import type { DesignNode } from '../shared/types'
import { isAutoLayout } from '../shared/layoutEngine'

export type ContextMenuState = {
  x: number
  y: number
  worldX: number
  worldY: number
  layers: DesignNode[]
}

type Props = {
  menu: ContextMenuState
  selectedIds: string[]
  selectedNodes: DesignNode[]
  canPaste: boolean
  canPasteStyles: boolean
  onClose: () => void
  onSelectLayer: (id: string) => void
  onSelectParent: () => void
  onSelectChildren: () => void
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
  onDelete: () => void
}

function shortcutLabel(keys: string) {
  return keys
}

export function CanvasContextMenu({
  menu,
  selectedIds,
  selectedNodes,
  canPaste,
  canPasteStyles,
  onClose,
  onSelectLayer,
  onSelectParent,
  onSelectChildren,
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
  onDelete
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [layerOpen, setLayerOpen] = useState(false)
  const [copyAsOpen, setCopyAsOpen] = useState(false)
  const hasSelection = selectedIds.length > 0
  const primary = selectedNodes[selectedNodes.length - 1] || null
  const hasParent = Boolean(primary?.parentId)
  const canSelectChildren =
    selectedNodes.length === 1 &&
    (primary?.type === 'frame' || primary?.type === 'section')
  const allFlex = selectedNodes.length > 0 && selectedNodes.every((node) => isAutoLayout(node))
  const singleFrameNoFlex =
    selectedNodes.length === 1 && primary?.type === 'frame' && !isAutoLayout(primary)
  void singleFrameNoFlex
  const copyLabel =
    selectedIds.length > 1 ? `Copy ${selectedIds.length} elements` : 'Copy'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad)
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [menu.x, menu.y, layerOpen, copyAsOpen])

  const run = (action: () => void) => () => {
    action()
    onClose()
  }

  return (
    <div
      ref={root}
      className="ctx-menu"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="ctx-section">
        <div
          className={`ctx-item has-sub${menu.layers.length ? '' : ' is-disabled'}`}
          onMouseEnter={() => menu.layers.length && setLayerOpen(true)}
          onMouseLeave={() => setLayerOpen(false)}
        >
          <span>Select layer…</span>
          <em className="ctx-chevron">›</em>
          {layerOpen && menu.layers.length > 0 && (
            <div className="ctx-submenu">
              {[...menu.layers].reverse().map((layer) => (
                <button key={layer.id} type="button" className="ctx-item" onClick={run(() => onSelectLayer(layer.id))}>
                  <span>{layer.name || layer.type}</span>
                  <em className="ctx-muted">{layer.type}</em>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`ctx-item${!hasParent ? ' is-disabled' : ''}`}
          disabled={!hasParent}
          onClick={run(onSelectParent)}
        >
          <span>Select parent</span>
          <kbd>{shortcutLabel('Esc')}</kbd>
        </button>
        <button
          type="button"
          className={`ctx-item${!canSelectChildren ? ' is-disabled' : ''}`}
          disabled={!canSelectChildren}
          onClick={run(onSelectChildren)}
        >
          <span>Select children</span>
          <kbd>Enter</kbd>
        </button>
      </div>

      <div className="ctx-section">
        <button type="button" className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopy)}>
          <span>{copyLabel}</span>
          <kbd>Ctrl + C</kbd>
        </button>
        <button type="button" className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopyLink)}>
          <span>Copy link</span>
          <kbd>Ctrl + L</kbd>
        </button>
        <div
          className={`ctx-item has-sub${!hasSelection ? ' is-disabled' : ''}`}
          onMouseEnter={() => hasSelection && setCopyAsOpen(true)}
          onMouseLeave={() => setCopyAsOpen(false)}
        >
          <span>Copy as…</span>
          <em className="ctx-chevron">›</em>
          {copyAsOpen && hasSelection && (
            <div className="ctx-submenu">
              <button type="button" className="ctx-item" onClick={run(onCopyAsPng)}>
                <span>Copy as PNG</span>
                <kbd>Ctrl + Shift + C</kbd>
              </button>
              <button type="button" className="ctx-item" onClick={run(onCopyAsTailwind)}>
                <span>Copy as Tailwind</span>
              </button>
              <button type="button" className="ctx-item" onClick={run(onCopyAsReact)}>
                <span>Copy as React CSS</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ctx-section">
        <button type="button" className={`ctx-item${!canPaste ? ' is-disabled' : ''}`} disabled={!canPaste} onClick={run(onPaste)}>
          <span>Paste</span>
          <kbd>Ctrl + V</kbd>
        </button>
        <button type="button" className={`ctx-item${!canPaste ? ' is-disabled' : ''}`} disabled={!canPaste} onClick={run(onPasteOnTop)}>
          <span>Paste on top</span>
          <kbd>Ctrl + Shift + V</kbd>
        </button>
        <button
          type="button"
          className={`ctx-item${!canPaste || !hasSelection ? ' is-disabled' : ''}`}
          disabled={!canPaste || !hasSelection}
          onClick={run(onPasteReplace)}
        >
          <span>Paste to replace</span>
          <kbd>Ctrl + Shift + R</kbd>
        </button>
        <button type="button" className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onDuplicate)}>
          <span>Duplicate</span>
          <kbd>Ctrl + D</kbd>
        </button>
      </div>

      <div className="ctx-section">
        <button type="button" className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onCopyStyles)}>
          <span>Copy styles</span>
          <kbd>Ctrl + Alt + C</kbd>
        </button>
        <button
          type="button"
          className={`ctx-item${!canPasteStyles || !hasSelection ? ' is-disabled' : ''}`}
          disabled={!canPasteStyles || !hasSelection}
          onClick={run(onPasteStyles)}
        >
          <span>Paste styles</span>
          <kbd>Ctrl + Alt + V</kbd>
        </button>
      </div>

      <div className="ctx-section">
        <button type="button" className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`} disabled={!hasSelection} onClick={run(onFrameSelection)}>
          <span>Frame selection</span>
          <kbd>Shift + F</kbd>
        </button>
        <button
          type="button"
          className={`ctx-item${!hasSelection ? ' is-disabled' : ''}`}
          disabled={!hasSelection}
          onClick={run(allFlex ? onRemoveFlex : onWrapFlex)}
        >
          <span>{allFlex ? 'Remove auto layout' : singleFrameNoFlex ? 'Add auto layout' : 'Add auto layout'}</span>
          <kbd>{allFlex ? 'Shift + Alt + A' : 'Shift + A'}</kbd>
        </button>
      </div>

      {hasSelection && (
        <div className="ctx-section">
          <button type="button" className="ctx-item is-danger" onClick={run(onDelete)}>
            <span>Delete</span>
            <kbd>Del</kbd>
          </button>
        </div>
      )}
    </div>
  )
}
