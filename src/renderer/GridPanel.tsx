import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DesignNode, GridTrack } from '../shared/types'
import { childrenOf } from '../shared/layoutEngine'
import {
  addGridTrack,
  formatTrackSize,
  gridTracksOf,
  moveGridTrackLayout,
  planGridFrame,
  removeGridTrack,
  reorderedGridChildIds,
  setGridPanel,
  setGridTrackLayout,
  useGridPanel,
  type GridAxis
} from './gridTracks'

type TrackKind = 'fixed' | 'hug' | 'fill'

function trackKind(track: GridTrack): TrackKind {
  return typeof track === 'number' ? 'fixed' : track
}

export function trackKindLabel(track: GridTrack): string {
  const kind = trackKind(track)
  return kind === 'fixed' ? 'Fixed' : kind === 'fill' ? 'Fill' : 'Hug'
}

function TrackKindIcon({ kind, axis }: { kind: TrackKind; axis: GridAxis }) {
  const d =
    kind === 'fixed'
      ? 'M2 3.5v5M10 3.5v5M2 6h8'
      : kind === 'hug'
        ? 'M1.5 3.5 4 6 1.5 8.5M10.5 3.5 8 6l2.5 2.5M4 6h4'
        : 'M1.5 6h9M3.5 4 1.5 6l2 2M8.5 4l2 2-2 2'
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      style={axis === 'row' ? { transform: 'rotate(90deg)' } : undefined}
    >
      <path d={d} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Fixed / Hug / Fill choices for one grid track (Figma's track sizing menu). */
export function GridTrackMenu({
  axis,
  track,
  size,
  onPick,
  className = ''
}: {
  axis: GridAxis
  track: GridTrack
  size: number
  onPick: (track: GridTrack) => void
  className?: string
}) {
  const current = trackKind(track)
  const items: Array<{ kind: TrackKind; label: string }> = [
    { kind: 'fixed', label: `Fixed ${axis === 'col' ? 'width' : 'height'} (${formatTrackSize(size)})` },
    { kind: 'hug', label: 'Hug contents' },
    { kind: 'fill', label: 'Fill container (1fr)' }
  ]
  return (
    <div className={`grid-track-kind-menu ${className}`} role="listbox" onPointerDown={(event) => event.stopPropagation()}>
      {items.map((item) => (
        <button
          key={item.kind}
          type="button"
          role="option"
          aria-selected={current === item.kind}
          className={current === item.kind ? 'is-on' : undefined}
          onClick={(event) => {
            event.stopPropagation()
            if (item.kind === 'fixed') onPick(typeof track === 'number' ? track : Math.max(1, Math.round(size * 100) / 100))
            else onPick(item.kind)
          }}
        >
          <span className="grid-track-kind-check">
            {current === item.kind && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <TrackKindIcon kind={item.kind} axis={axis} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function TrackKindSelect({
  axis,
  track,
  size,
  onPick
}: {
  axis: GridAxis
  track: GridTrack
  size: number
  onPick: (track: GridTrack) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="grid-panel-kind" ref={rootRef}>
      <button type="button" className={`grid-panel-kind-btn${open ? ' is-open' : ''}`} onClick={() => setOpen(!open)}>
        <span>{trackKindLabel(track)}</span>
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <GridTrackMenu
          axis={axis}
          track={track}
          size={size}
          onPick={(next) => {
            onPick(next)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

function TrackValue({ track, size, onFixed }: { track: GridTrack; size: number; onFixed: (value: number) => void }) {
  const shown = typeof track === 'number' ? formatTrackSize(track) : formatTrackSize(size)
  const [draft, setDraft] = useState<string | null>(null)

  if (track === 'fill') {
    return <div className="grid-panel-value is-fr">1fr</div>
  }

  const commit = () => {
    if (draft == null) return
    const next = Number(draft)
    setDraft(null)
    if (Number.isFinite(next) && next > 0 && next !== size) onFixed(next)
  }

  return (
    <label className={`grid-panel-value${typeof track === 'number' ? '' : ' is-derived'}`}>
      <input
        value={draft ?? shown}
        onFocus={(event) => {
          setDraft(shown)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = Number(event.target.value)
          if (typeof track === 'number' && Number.isFinite(next) && next > 0) onFixed(next)
        }}
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

export function GridPanel({
  frame,
  nodes,
  onPatchNode,
  onReorderChildren
}: {
  frame: DesignNode
  nodes: DesignNode[]
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
  onReorderChildren?: (parentId: string, orderedChildIds: string[], parentPatch?: Partial<DesignNode>) => void
}) {
  const panel = useGridPanel()
  const layout = frame.layout!
  const plan = planGridFrame(frame, nodes)
  const [drag, setDrag] = useState<{ axis: GridAxis; from: number; to: number } | null>(null)

  const selectTrack = (axis: GridAxis, index: number | null) =>
    setGridPanel({ frameId: frame.id, axis: index == null ? null : axis, index })

  const startDrag = (axis: GridAxis, index: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    selectTrack(axis, index)
    const row = event.currentTarget.closest('.grid-panel-row') as HTMLElement | null
    const rowH = row?.getBoundingClientRect().height || 30
    const count = axis === 'col' ? plan.columns : plan.rows
    const originY = event.clientY
    let target = index
    const move = (next: PointerEvent) => {
      target = Math.max(0, Math.min(count - 1, index + Math.round((next.clientY - originY) / rowH)))
      setDrag({ axis, from: index, to: target })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDrag(null)
      if (target === index) return
      const nextLayout = moveGridTrackLayout(layout, plan, axis, index, target)
      const ids = reorderedGridChildIds(plan, childrenOf(nodes, frame.id), axis, index, target)
      if (ids && onReorderChildren) onReorderChildren(frame.id, ids, { layout: nextLayout })
      else onPatchNode(frame.id, { layout: nextLayout })
      selectTrack(axis, target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const renderSection = (axis: GridAxis) => {
    const tracks = gridTracksOf(layout, plan, axis)
    const sizes = axis === 'col' ? plan.colSizes : plan.rowSizes
    return (
      <section className="grid-panel-section">
        <div className="grid-panel-section-head">
          <span>{axis === 'col' ? 'Columns' : 'Rows'}</span>
          <button
            type="button"
            className="grid-panel-icon-btn"
            title={axis === 'col' ? 'Add column' : 'Add row'}
            onClick={() => {
              onPatchNode(frame.id, { layout: addGridTrack(layout, plan, axis) })
              selectTrack(axis, tracks.length)
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {tracks.map((track, i) => {
          const selected = panel?.axis === axis && panel.index === i
          const dropBefore = drag?.axis === axis && drag.to !== drag.from && drag.to === i && drag.to < drag.from
          const dropAfter = drag?.axis === axis && drag.to !== drag.from && drag.to === i && drag.to > drag.from
          return (
            <div
              key={i}
              className={`grid-panel-row${selected ? ' is-selected' : ''}${dropBefore ? ' is-drop-before' : ''}${dropAfter ? ' is-drop-after' : ''}`}
              onPointerDown={() => selectTrack(axis, i)}
            >
              <span className="grid-panel-index" onPointerDown={startDrag(axis, i)} title="Drag to reorder">
                <span className="grid-panel-index-num">{i + 1}</span>
                <svg className="grid-panel-index-grip" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.5 3h7M1.5 5h7M1.5 7h7" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </span>
              <TrackKindSelect
                axis={axis}
                track={track}
                size={sizes[i]}
                onPick={(next) => onPatchNode(frame.id, { layout: setGridTrackLayout(layout, plan, axis, i, next) })}
              />
              <TrackValue
                track={track}
                size={sizes[i]}
                onFixed={(value) => onPatchNode(frame.id, { layout: setGridTrackLayout(layout, plan, axis, i, value) })}
              />
              <button
                type="button"
                className="grid-panel-icon-btn grid-panel-remove"
                title={axis === 'col' ? 'Remove column' : 'Remove row'}
                disabled={tracks.length <= 1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  onPatchNode(frame.id, { layout: removeGridTrack(layout, plan, axis, i) })
                  selectTrack(axis, null)
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2 6h8" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <div className="grid-panel">
      <div className="grid-panel-head">
        <span className="grid-panel-title">Grid</span>
        <button type="button" className="grid-panel-icon-btn" title="Close grid settings" onClick={() => setGridPanel(null)}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {renderSection('col')}
      {renderSection('row')}
    </div>
  )
}
