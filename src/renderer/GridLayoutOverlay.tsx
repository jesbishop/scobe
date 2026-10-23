import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { DesignNode, GridTrack } from '../shared/types'
import { childrenOf, isGridLayout, resolveWorldRect } from '../shared/layoutEngine'
import { GridTrackMenu } from './GridPanel'
import {
  gridTracksOf,
  moveGridTrackLayout,
  planGridFrame,
  reorderedGridChildIds,
  setGridPanel,
  setGridTrackLayout,
  useGridPanel,
  type GridAxis as Axis
} from './gridTracks'

/** Grid frame being edited: the selected grid frame, or the shared grid parent of the selection. */
export function gridOverlayTarget(
  nodes: DesignNode[],
  selectedIds: string[]
): { frame: DesignNode; childMode: boolean } | null {
  if (!selectedIds.length) return null
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (selectedIds.length === 1) {
    const only = byId.get(selectedIds[0])
    if (only && isGridLayout(only)) return { frame: only, childMode: false }
  }
  const parents = new Set(selectedIds.map((id) => byId.get(id)?.parentId || ''))
  if (parents.size !== 1) return null
  const parent = byId.get([...parents][0])
  if (!parent || !isGridLayout(parent)) return null
  return { frame: parent, childMode: true }
}

function trackLabel(track: GridTrack): string {
  if (track === 'fill') return '1fr'
  if (typeof track === 'number') return String(Math.round(track * 100) / 100)
  return 'Hug'
}

function zoomOf(el: Element | null): number {
  return Number(el?.closest('.world')?.getAttribute('data-zoom') || '1') || 1
}

export function GridLayoutOverlay({
  frame,
  nodes,
  selectedIds,
  childMode,
  onSelectIds,
  onEdit,
  onReorder
}: {
  frame: DesignNode
  nodes: DesignNode[]
  selectedIds: string[]
  childMode: boolean
  onSelectIds: (ids: string[]) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onReorder?: (parentId: string, orderedChildIds: string[], parentPatch?: Partial<DesignNode>) => void
}) {
  const layout = frame.layout!
  const kids = childrenOf(nodes, frame.id)
  const plan = planGridFrame(frame, nodes)
  const box = resolveWorldRect(frame, nodes)
  const panel = useGridPanel()
  const picked = panel?.frameId === frame.id && panel.axis && panel.index != null ? { axis: panel.axis, index: panel.index } : null
  const [hot, setHot] = useState<{ axis: Axis; index: number } | null>(null)
  const [menu, setMenu] = useState<{ axis: Axis; index: number } | null>(null)
  const [drag, setDrag] = useState<{ axis: Axis; from: number; to: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setMenu(null)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [menu])

  const selected = new Set(selectedIds)
  const selectedCells = kids.filter((kid) => selected.has(kid.id)).map((kid) => plan.cells.get(kid.id)).filter(Boolean)
  const colInSelection = (col: number) =>
    selectedCells.some((cell) => cell && col >= cell.col && col < cell.col + cell.colSpan)
  const rowInSelection = (row: number) =>
    selectedCells.some((cell) => cell && row >= cell.row && row < cell.row + cell.rowSpan)

  const tracksOf = (axis: Axis): GridTrack[] => gridTracksOf(layout, plan, axis)

  const setTrack = (axis: Axis, index: number, track: GridTrack) => {
    onEdit(frame.id, { layout: setGridTrackLayout(layout, plan, axis, index, track) })
  }

  const selectTrack = (axis: Axis, index: number) => {
    if (childMode || selectedIds.length !== 1 || selectedIds[0] !== frame.id) onSelectIds([frame.id])
    setGridPanel({ frameId: frame.id, axis, index })
  }

  const trackIndexAt = (axis: Axis, local: number) => {
    const starts = axis === 'col' ? plan.colStarts : plan.rowStarts
    const sizes = axis === 'col' ? plan.colSizes : plan.rowSizes
    let best = 0
    for (let i = 0; i < starts.length; i++) {
      if (local >= starts[i] + sizes[i] / 2) best = i
    }
    if (local < starts[0] + sizes[0] / 2) return 0
    return best
  }

  const startChipDrag = (axis: Axis, index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const zoom = zoomOf(event.currentTarget)
    const originX = event.clientX
    const originY = event.clientY
    const startLocal =
      axis === 'col'
        ? plan.colStarts[index] + plan.colSizes[index] / 2
        : plan.rowStarts[index] + plan.rowSizes[index] / 2
    let moved = false
    let target = index
    const move = (next: PointerEvent) => {
      const delta = axis === 'col' ? next.clientX - originX : next.clientY - originY
      if (!moved && Math.abs(delta) < 4) return
      moved = true
      target = trackIndexAt(axis, startLocal + delta / zoom)
      setDrag({ axis, from: index, to: target })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (!moved) {
        selectTrack(axis, index)
        return
      }
      if (target === index || !onReorder) return
      const ids = reorderedGridChildIds(plan, kids, axis, index, target)
      if (!ids) return
      onReorder(frame.id, ids, { layout: moveGridTrackLayout(layout, plan, axis, index, target) })
      if (picked?.axis === axis && picked.index === index) setGridPanel({ frameId: frame.id, axis, index: target })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const single = selectedIds.length === 1 ? kids.find((kid) => kid.id === selectedIds[0]) : undefined
  const singleCell = single ? plan.cells.get(single.id) : undefined

  const startSpanDrag = (axis: Axis) => (event: ReactPointerEvent<HTMLElement>) => {
    if (!single || !singleCell) return
    event.preventDefault()
    event.stopPropagation()
    const zoom = zoomOf(event.currentTarget)
    const originX = event.clientX
    const originY = event.clientY
    const startEdge =
      axis === 'col'
        ? plan.colStarts[singleCell.col + singleCell.colSpan - 1] + plan.colSizes[singleCell.col + singleCell.colSpan - 1]
        : plan.rowStarts[singleCell.row + singleCell.rowSpan - 1] + plan.rowSizes[singleCell.row + singleCell.rowSpan - 1]
    const move = (next: PointerEvent) => {
      const edge = startEdge + (axis === 'col' ? next.clientX - originX : next.clientY - originY) / zoom
      const first = axis === 'col' ? singleCell.col : singleCell.row
      const starts = axis === 'col' ? plan.colStarts : plan.rowStarts
      const sizes = axis === 'col' ? plan.colSizes : plan.rowSizes
      let span = 1
      for (let i = first + 1; i < starts.length; i++) {
        if (edge >= starts[i] + sizes[i] / 2) span = i - first + 1
      }
      if (axis === 'col') {
        span = Math.min(span, plan.columns - first)
        if (span !== (single.gridColumnSpan || 1)) onEdit(single.id, { gridColumnSpan: span })
      } else if (span !== (single.gridRowSpan || 1)) {
        onEdit(single.id, { gridRowSpan: span })
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const innerW = plan.colStarts.length
    ? plan.colStarts[plan.columns - 1] + plan.colSizes[plan.columns - 1] - plan.pad.l
    : 0
  const innerH = plan.rowStarts.length ? plan.rowStarts[plan.rows - 1] + plan.rowSizes[plan.rows - 1] - plan.pad.t : 0

  const renderTrack = (axis: Axis, index: number) => {
    const tracks = tracksOf(axis)
    const start = axis === 'col' ? plan.colStarts[index] : plan.rowStarts[index]
    const size = axis === 'col' ? plan.colSizes[index] : plan.rowSizes[index]
    const isPicked = picked?.axis === axis && picked.index === index
    const isHot =
      (hot?.axis === axis && hot.index === index) || (menu?.axis === axis && menu.index === index) || isPicked
    const showPill = !childMode || (axis === 'col' ? colInSelection(index) : rowInSelection(index)) || isHot
    const style: CSSProperties =
      axis === 'col'
        ? { left: start + size / 2, top: 0 }
        : { top: start + size / 2, left: 0 }
    return (
      <div
        key={`${axis}-${index}`}
        className={`grid-track-handle is-${axis}${isHot ? ' is-hot' : ''}${showPill ? '' : ' is-idle'}`}
        style={style}
        onPointerEnter={() => setHot({ axis, index })}
        onPointerLeave={() => setHot((value) => (value?.axis === axis && value.index === index ? null : value))}
      >
        {isHot ? (
          <div className="grid-track-chip" onPointerDown={(event) => event.stopPropagation()}>
            <button type="button" className="grid-track-chip-label" onPointerDown={startChipDrag(axis, index)}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                {axis === 'col' ? (
                  <path d="M2 1.5v7M5 1.5v7M8 1.5v7" stroke="currentColor" strokeLinecap="round" />
                ) : (
                  <path d="M1.5 2h7M1.5 5h7M1.5 8h7" stroke="currentColor" strokeLinecap="round" />
                )}
              </svg>
              {trackLabel(tracks[index])}
            </button>
            <button
              type="button"
              className="grid-track-chip-caret"
              aria-label="Track sizing"
              onClick={(event) => {
                event.stopPropagation()
                setMenu((value) => (value?.axis === axis && value.index === index ? null : { axis, index }))
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menu?.axis === axis && menu.index === index && (
              <div ref={menuRef} className="grid-track-menu-anchor">
                <GridTrackMenu
                  axis={axis}
                  track={tracks[index]}
                  size={size}
                  onPick={(track) => {
                    setTrack(axis, index, track)
                    setMenu(null)
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          <span className="grid-track-pill" />
        )}
      </div>
    )
  }

  const hotTrack = hot || menu || picked
  const dropLine =
    drag && drag.to !== drag.from
      ? drag.axis === 'col'
        ? {
            left: drag.to > drag.from ? plan.colStarts[drag.to] + plan.colSizes[drag.to] : plan.colStarts[drag.to],
            top: plan.pad.t,
            width: 0,
            height: innerH
          }
        : {
            top: drag.to > drag.from ? plan.rowStarts[drag.to] + plan.rowSizes[drag.to] : plan.rowStarts[drag.to],
            left: plan.pad.l,
            height: 0,
            width: innerW
          }
      : null

  return (
    <div
      className={`grid-overlay${childMode ? ' is-child' : ''}`}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {plan.rowStarts.map((top, r) =>
        plan.colStarts.map((left, c) => (
          <div
            key={`${r}-${c}`}
            className={`grid-overlay-cell${
              picked && (picked.axis === 'col' ? picked.index === c : picked.index === r) ? ' is-picked' : ''
            }`}
            style={{ left, top, width: plan.colSizes[c], height: plan.rowSizes[r] }}
          />
        ))
      )}
      {hotTrack && (
        <div
          className="grid-overlay-track"
          style={
            hotTrack.axis === 'col'
              ? { left: plan.colStarts[hotTrack.index], top: plan.pad.t, width: plan.colSizes[hotTrack.index], height: innerH }
              : { top: plan.rowStarts[hotTrack.index], left: plan.pad.l, height: plan.rowSizes[hotTrack.index], width: innerW }
          }
        />
      )}
      {dropLine && <div className={`grid-overlay-drop is-${drag!.axis}`} style={dropLine} />}
      <div className="grid-track-rail is-col">{plan.colStarts.map((_, i) => renderTrack('col', i))}</div>
      <div className="grid-track-rail is-row">{plan.rowStarts.map((_, i) => renderTrack('row', i))}</div>
      {single && singleCell && (
        <>
          <span
            className="grid-span-handle is-col"
            style={{ left: single.x + (single.width || 0), top: single.y + (single.height || 0) / 2 }}
            onPointerDown={startSpanDrag('col')}
          />
          <span
            className="grid-span-handle is-row"
            style={{ left: single.x + (single.width || 0) / 2, top: single.y + (single.height || 0) }}
            onPointerDown={startSpanDrag('row')}
          />
        </>
      )}
    </div>
  )
}
