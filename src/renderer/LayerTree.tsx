import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { LayerDropTarget } from '../shared/layerMove'
import { IconCaret } from './icons'
import type { LayerItem } from './shell'

const INDENT = 14
const ROW_PAD = 4
const CARET = 16
const DRAG_SLOP = 4
const EXPAND_DELAY = 550

type DropPreview = {
  target: LayerDropTarget
  /** Insertion line, in list coordinates. */
  line?: { top: number; left: number }
  /** Container row highlighted for "drop inside". */
  insideId?: string
}

type DragState = { ids: string[]; preview: DropPreview | null }

function rowIndent(depth: number): number {
  return ROW_PAD + depth * INDENT
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement || null
  while (current) {
    const overflow = getComputedStyle(current).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && current.scrollHeight > current.clientHeight) return current
    current = current.parentElement
  }
  return null
}

/**
 * Figma/Paper-style layer tree: disclosure carets, selection reveal, and drag to reorder or to move
 * layers into and out of frames. The insertion line's indent shows the parent the layer will land in.
 */
export function LayerTree({
  layers,
  collapseToken = 0,
  onSelectLayer,
  onRenameLayer,
  onOpenMenu,
  renderIcon,
  renderActions,
  onMoveLayers
}: {
  layers: LayerItem[]
  collapseToken?: number
  onSelectLayer: (id: string, kind: LayerItem['kind']) => void
  onRenameLayer: (id: string, name: string) => void
  onOpenMenu: (layer: LayerItem, target: HTMLElement) => void
  renderIcon: (layer: LayerItem) => ReactNode
  renderActions: (layer: LayerItem) => ReactNode
  onMoveLayers?: (ids: string[], target: LayerDropTarget) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [drag, setDrag] = useState<DragState | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const suppressClick = useRef(false)

  const byId = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers])
  const hasKids = useMemo(() => {
    const parents = new Set<string>()
    for (const layer of layers) if (layer.parentId) parents.add(layer.parentId)
    return parents
  }, [layers])

  useEffect(() => {
    if (collapseToken > 0) setExpanded(new Set())
  }, [collapseToken])

  // Selecting a nested layer (on the canvas or by an agent) opens its parents, like Figma.
  const selectedKey = layers
    .filter((layer) => layer.selected)
    .map((layer) => layer.id)
    .join('|')
  useEffect(() => {
    if (!selectedKey) return
    setExpanded((prev) => {
      let next: Set<string> | null = null
      for (const id of selectedKey.split('|')) {
        let parentId = byId.get(id)?.parentId
        while (parentId) {
          if (!prev.has(parentId) && !next?.has(parentId)) {
            next ??= new Set(prev)
            next.add(parentId)
          }
          parentId = byId.get(parentId)?.parentId
        }
      }
      return next || prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const visible = useMemo(() => {
    const rows: LayerItem[] = []
    let hiddenBelow = Infinity
    for (const layer of layers) {
      const depth = layer.depth || 0
      if (depth > hiddenBelow) continue
      hiddenBelow = Infinity
      rows.push(layer)
      if (hasKids.has(layer.id) && !expanded.has(layer.id)) hiddenBelow = depth
    }
    return rows
  }, [layers, expanded, hasKids])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const draggable = (layer: LayerItem) => layer.kind !== 'browser' && layer.kind !== 'comment'

  /** True when `id` is one of the dragged layers or sits inside one. */
  const insideDragged = (id: string | null | undefined, ids: string[]) => {
    let current = id
    while (current) {
      if (ids.includes(current)) return true
      current = byId.get(current)?.parentId
    }
    return false
  }

  const computeDrop = (clientX: number, clientY: number, ids: string[], rows: LayerItem[]): DropPreview | null => {
    const list = listRef.current
    if (!list) return null
    const listRect = list.getBoundingClientRect()
    const designRows = rows.filter((layer) => layer.kind !== 'browser')
    const measured = designRows
      .map((layer) => ({ layer, rect: rowRefs.current.get(layer.id)?.getBoundingClientRect() }))
      .filter((row): row is { layer: LayerItem; rect: DOMRect } => Boolean(row.rect))
    if (!measured.length) return null
    const lineAt = (y: number, depth: number) => ({ top: y - listRect.top, left: rowIndent(depth) + CARET })

    let index = measured.findIndex((row) => clientY < row.rect.bottom)
    if (index < 0) {
      // Past the last layer: bottom of the page's top level.
      const last = measured[measured.length - 1]
      let anchor = last.layer
      while (anchor.parentId && byId.get(anchor.parentId)) anchor = byId.get(anchor.parentId)!
      if (ids.includes(anchor.id)) return null
      return { target: { parentId: null, before: anchor.id }, line: lineAt(last.rect.bottom, 0) }
    }
    index = Math.max(0, index)
    const { layer, rect } = measured[index]
    const rel = (clientY - rect.top) / Math.max(1, rect.height)
    const depth = layer.depth || 0
    const zone = layer.container
      ? rel < 0.25
        ? 'above'
        : rel > 0.75
          ? 'below'
          : 'inside'
      : rel < 0.5
        ? 'above'
        : 'below'

    let preview: DropPreview
    if (zone === 'inside') {
      preview = { target: { parentId: layer.id, top: true }, insideId: layer.id }
    } else if (zone === 'above') {
      preview = { target: { parentId: layer.parentId || null, after: layer.id }, line: lineAt(rect.top, depth) }
    } else if (layer.container && hasKids.has(layer.id) && expanded.has(layer.id)) {
      // Just under an open frame's row = its first (topmost) child slot.
      preview = { target: { parentId: layer.id, top: true }, line: lineAt(rect.bottom, depth + 1) }
    } else {
      // At the end of a group, dragging left steps out to an outer level (Figma's outdent).
      const next = measured[index + 1]?.layer
      const minDepth = next ? Math.min(depth, next.depth || 0) : 0
      const wanted = Math.round((clientX - listRect.left - ROW_PAD - CARET) / INDENT)
      const level = Math.max(minDepth, Math.min(depth, wanted))
      let anchor: LayerItem = layer
      while ((anchor.depth || 0) > level && anchor.parentId && byId.get(anchor.parentId)) anchor = byId.get(anchor.parentId)!
      preview = { target: { parentId: anchor.parentId || null, before: anchor.id }, line: lineAt(rect.bottom, level) }
    }

    const { target } = preview
    if (insideDragged(target.parentId, ids)) return null
    const anchorId = target.before || target.after
    if (anchorId && ids.includes(anchorId)) return null
    return preview
  }

  const startPointer = (event: ReactPointerEvent<HTMLDivElement>, layer: LayerItem) => {
    if (event.button !== 0 || !onMoveLayers || !draggable(layer)) return
    const target = event.target as HTMLElement
    if (target.closest('.layer-row-action, .layer-caret, input')) return
    const start = { x: event.clientX, y: event.clientY }
    const scroller = scrollParent(listRef.current)
    let state: DragState | null = null
    let pointer = { x: event.clientX, y: event.clientY }
    let raf = 0
    let hover: { id: string; timer: number } | null = null
    // Rows can change while dragging (auto-expand), so read the latest list through the ref.
    const rowsNow = () => visibleRef.current

    const clearHover = () => {
      if (hover) window.clearTimeout(hover.timer)
      hover = null
    }
    const update = () => {
      if (!state) return
      const preview = computeDrop(pointer.x, pointer.y, state.ids, rowsNow())
      state = { ...state, preview }
      setDrag(state)
      const insideId = preview?.insideId
      if (insideId && hasKidsRef.current.has(insideId) && !expandedRef.current.has(insideId)) {
        if (hover?.id !== insideId) {
          clearHover()
          hover = {
            id: insideId,
            timer: window.setTimeout(() => {
              setExpanded((prev) => new Set(prev).add(insideId))
              hover = null
            }, EXPAND_DELAY)
          }
        }
      } else {
        clearHover()
      }
    }
    const tick = () => {
      raf = 0
      if (!state || !scroller) return
      const box = scroller.getBoundingClientRect()
      const edge = 28
      let delta = 0
      if (pointer.y < box.top + edge) delta = -Math.ceil((box.top + edge - pointer.y) / 3)
      else if (pointer.y > box.bottom - edge) delta = Math.ceil((pointer.y - (box.bottom - edge)) / 3)
      if (delta) {
        scroller.scrollTop += delta
        update()
        raf = requestAnimationFrame(tick)
      }
    }
    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      if (!state) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_SLOP) return
        const selectedIds = layer.selected
          ? layersRef.current.filter((item) => item.selected && draggable(item)).map((item) => item.id)
          : [layer.id]
        if (!layer.selected) onSelectLayer(layer.id, layer.kind)
        state = { ids: selectedIds.length ? selectedIds : [layer.id], preview: null }
        suppressClick.current = true
        document.documentElement.classList.add('is-layer-dragging')
      }
      update()
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      if (raf) cancelAnimationFrame(raf)
      clearHover()
      document.documentElement.classList.remove('is-layer-dragging')
      const done = state
      state = null
      setDrag(null)
      if (commit && done?.preview) onMoveLayers(done.ids, done.preview.target)
      window.setTimeout(() => {
        suppressClick.current = false
      }, 0)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !state) return
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
  }

  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const layersRef = useRef(layers)
  layersRef.current = layers
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const hasKidsRef = useRef(hasKids)
  hasKidsRef.current = hasKids

  const dragging = drag ? new Set(drag.ids) : null

  return (
    <div className={`tree-list layer-tree${drag ? ' is-dragging' : ''}`} ref={listRef}>
      {layers.length === 0 && <p className="panel-empty">No layers on this page yet.</p>}
      {visible.map((layer) => {
        const depth = layer.depth || 0
        const open = expanded.has(layer.id)
        const rowClass = [
          'tree-row',
          'layer-row',
          layer.selected ? 'is-active' : '',
          layer.hidden ? 'is-hidden' : '',
          layer.locked ? 'is-locked' : '',
          dragging?.has(layer.id) ? 'is-dragged' : '',
          drag?.preview?.insideId === layer.id ? 'is-drop-inside' : ''
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <div
            key={layer.id}
            ref={(el) => {
              if (el) rowRefs.current.set(layer.id, el)
              else rowRefs.current.delete(layer.id)
            }}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={layer.selected}
            aria-expanded={hasKids.has(layer.id) ? open : undefined}
            tabIndex={0}
            className={rowClass}
            style={{ paddingLeft: rowIndent(depth) }}
            onPointerDown={(event) => startPointer(event, layer)}
            onClick={() => {
              if (suppressClick.current) return
              onSelectLayer(layer.id, layer.kind)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelectLayer(layer.id, layer.kind)
              } else if (hasKids.has(layer.id) && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
                event.preventDefault()
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (event.key === 'ArrowRight') next.add(layer.id)
                  else next.delete(layer.id)
                  return next
                })
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onOpenMenu(layer, event.currentTarget)
            }}
            onDoubleClick={() => {
              if (layer.kind === 'browser') return
              const name = window.prompt('Rename', layer.name)
              if (name?.trim()) onRenameLayer(layer.id, name.trim())
            }}
          >
            <span className="layer-caret-slot">
              {hasKids.has(layer.id) ? (
                <button
                  type="button"
                  className={`layer-caret${open ? ' is-open' : ''}`}
                  aria-label={open ? 'Collapse' : 'Expand'}
                  tabIndex={-1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (event.altKey) {
                      // Alt-click opens or closes the whole subtree, as in Figma.
                      const ids: string[] = []
                      const start = layers.findIndex((item) => item.id === layer.id)
                      for (let i = start + 1; i < layers.length && (layers[i].depth || 0) > depth; i++) {
                        if (hasKids.has(layers[i].id)) ids.push(layers[i].id)
                      }
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        for (const id of [layer.id, ...ids]) {
                          if (open) next.delete(id)
                          else next.add(id)
                        }
                        return next
                      })
                      return
                    }
                    toggle(layer.id)
                  }}
                >
                  <IconCaret size={12} />
                </button>
              ) : null}
            </span>
            {renderIcon(layer)}
            <span className="layer-row-name">{layer.name}</span>
            {renderActions(layer)}
          </div>
        )
      })}
      {drag?.preview?.line ? (
        <div className="layer-drop-line" style={{ top: drag.preview.line.top - 1, left: drag.preview.line.left }} aria-hidden="true" />
      ) : null}
    </div>
  )
}
