import { useSyncExternalStore } from 'react'
import type { AutoLayout, DesignNode, GridTrack } from '../shared/types'
import { childrenOf, gridTrackAt, planGrid, type GridPlan } from '../shared/layoutEngine'

export type GridAxis = 'col' | 'row'

/** Grid settings panel: which grid frame it edits and which track (if any) is selected. */
export type GridPanelState = { frameId: string; axis: GridAxis | null; index: number | null }

let panelState: GridPanelState | null = null
const listeners = new Set<() => void>()

export function getGridPanel(): GridPanelState | null {
  return panelState
}

export function setGridPanel(next: GridPanelState | null): void {
  if (
    next === panelState ||
    (next && panelState && next.frameId === panelState.frameId && next.axis === panelState.axis && next.index === panelState.index)
  ) {
    return
  }
  panelState = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGridPanel(): GridPanelState | null {
  return useSyncExternalStore(subscribe, getGridPanel)
}

export function planGridFrame(frame: DesignNode, nodes: DesignNode[]): GridPlan {
  const layout = frame.layout!
  return planGrid(layout, childrenOf(nodes, frame.id), frame, {
    h: (layout.sizingH || 'fixed') !== 'hug',
    v: (layout.sizingV || 'fixed') !== 'hug'
  })
}

export function gridTracksOf(layout: AutoLayout, plan: GridPlan, axis: GridAxis): GridTrack[] {
  const count = axis === 'col' ? plan.columns : plan.rows
  return Array.from({ length: count }, (_, i) => gridTrackAt(layout, axis, i))
}

function withTracks(layout: AutoLayout, axis: GridAxis, tracks: GridTrack[]): AutoLayout {
  const grid = layout.grid!
  return { ...layout, grid: axis === 'col' ? { ...grid, columnTracks: tracks } : { ...grid, rowTracks: tracks } }
}

/**
 * Set one track's sizing. A Fill track needs a definite frame size on that axis, so a Hug frame
 * switches to Fixed there; the other tracks are written out so they keep their current sizing.
 */
export function setGridTrackLayout(layout: AutoLayout, plan: GridPlan, axis: GridAxis, index: number, track: GridTrack): AutoLayout {
  const tracks = gridTracksOf(layout, plan, axis)
  tracks[index] = track
  let next = withTracks(layout, axis, tracks)
  const sizingKey = axis === 'col' ? 'sizingH' : 'sizingV'
  if (track === 'fill' && next[sizingKey] === 'hug') next = { ...next, [sizingKey]: 'fixed' }
  return next
}

export function addGridTrack(layout: AutoLayout, plan: GridPlan, axis: GridAxis): AutoLayout {
  const grid = layout.grid!
  if (axis === 'col') return { ...layout, grid: { ...grid, columns: plan.columns + 1 } }
  return { ...layout, grid: { ...grid, rows: plan.rows + 1 } }
}

export function removeGridTrack(layout: AutoLayout, plan: GridPlan, axis: GridAxis, index: number): AutoLayout {
  const grid = layout.grid!
  const count = axis === 'col' ? plan.columns : plan.rows
  if (count <= 1) return layout
  const explicit = axis === 'col' ? grid.columnTracks : grid.rowTracks
  const tracks = explicit ? explicit.filter((_, i) => i !== index) : undefined
  return axis === 'col'
    ? { ...layout, grid: { ...grid, columns: count - 1, columnTracks: tracks } }
    : { ...layout, grid: { ...grid, rows: count - 1, rowTracks: tracks } }
}

export function moveGridTrackLayout(layout: AutoLayout, plan: GridPlan, axis: GridAxis, from: number, to: number): AutoLayout {
  const tracks = gridTracksOf(layout, plan, axis)
  const [moved] = tracks.splice(from, 1)
  tracks.splice(to, 0, moved)
  return withTracks(layout, axis, tracks)
}

/** Child order after moving one column/row to a new index (span-1 grids only). */
export function reorderedGridChildIds(
  plan: GridPlan,
  kids: DesignNode[],
  axis: GridAxis,
  from: number,
  to: number
): string[] | null {
  const flowing = kids.filter((kid) => !kid.layoutAbsolute)
  if (flowing.some((kid) => (kid.gridColumnSpan || 1) > 1 || (kid.gridRowSpan || 1) > 1)) return null
  const cells: Array<Array<string | null>> = Array.from({ length: plan.rows }, () => Array(plan.columns).fill(null))
  for (const kid of flowing) {
    const cell = plan.cells.get(kid.id)
    if (cell) cells[cell.row][cell.col] = kid.id
  }
  if (axis === 'col') {
    for (const row of cells) {
      const [moved] = row.splice(from, 1)
      row.splice(to, 0, moved)
    }
  } else {
    const [moved] = cells.splice(from, 1)
    cells.splice(to, 0, moved)
  }
  return cells.flat().filter((id): id is string => Boolean(id))
}

export function formatTrackSize(size: number): string {
  return String(Math.round(size * 100) / 100)
}
