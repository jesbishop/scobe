export type LayoutGridPattern = 'GRID' | 'COLUMNS' | 'ROWS'

/** Columns use MIN/MAX as Left/Right; rows use them as Top/Bottom. */
export type LayoutGridAlignment = 'MIN' | 'MAX' | 'CENTER' | 'STRETCH'

export type LayoutGrid = {
  id: string
  pattern: LayoutGridPattern
  visible?: boolean
  /** Hex color, e.g. #FF0000 */
  color: string
  /** 0..1 */
  opacity: number
  /** Grid cell size (GRID only). */
  size?: number
  /** Number of columns / rows, or 'auto' to fit as many as possible (fixed-width alignments only). */
  count?: number | 'auto'
  alignment?: LayoutGridAlignment
  /** Column width / row height for non-stretch alignments. */
  sectionSize?: number
  /** Margin (stretch) or offset (left/right/top/bottom). */
  offset?: number
  gutter?: number
}

export const LAYOUT_GRID_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export function newLayoutGridId(): string {
  return `lg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function defaultLayoutGrid(pattern: LayoutGridPattern = 'GRID'): LayoutGrid {
  const base = { id: newLayoutGridId(), visible: true, color: '#FF0000', opacity: 0.1 }
  if (pattern === 'GRID') return { ...base, pattern, size: 10 }
  return { ...base, pattern, count: 5, alignment: 'STRETCH', offset: 0, gutter: 20, sectionSize: 64 }
}

export function layoutGridLabel(pattern: LayoutGridPattern): string {
  return pattern === 'GRID' ? 'Grid' : pattern === 'COLUMNS' ? 'Columns' : 'Rows'
}

export function layoutGridAlignmentLabel(pattern: LayoutGridPattern, alignment: LayoutGridAlignment): string {
  if (alignment === 'STRETCH') return 'Stretch'
  if (alignment === 'CENTER') return 'Center'
  if (pattern === 'ROWS') return alignment === 'MIN' ? 'Top' : 'Bottom'
  return alignment === 'MIN' ? 'Left' : 'Right'
}

export function layoutGridSummary(grid: LayoutGrid): string {
  if (grid.pattern === 'GRID') return `${grid.size ?? 10}px`
  const count = grid.count === 'auto' ? 'Auto' : String(grid.count ?? 5)
  return `${count} · ${layoutGridAlignmentLabel(grid.pattern, grid.alignment || 'STRETCH')}`
}

/** Resolve column / row bands along one axis of `length` px. Returns [start, size] pairs. */
export function layoutGridBands(grid: LayoutGrid, length: number): Array<[number, number]> {
  if (grid.pattern === 'GRID' || length <= 0) return []
  const alignment = grid.alignment || 'STRETCH'
  const gutter = Math.max(0, grid.gutter ?? 20)
  const offset = Math.max(0, grid.offset ?? 0)
  const out: Array<[number, number]> = []

  if (alignment === 'STRETCH') {
    const count = Math.max(1, grid.count === 'auto' ? 1 : grid.count ?? 5)
    const size = (length - offset * 2 - gutter * (count - 1)) / count
    if (size <= 0) return []
    for (let i = 0; i < count; i += 1) out.push([offset + i * (size + gutter), size])
    return out
  }

  const size = Math.max(1, grid.sectionSize ?? 64)
  const lead = alignment === 'CENTER' ? 0 : offset
  const count =
    grid.count === 'auto'
      ? Math.max(1, Math.floor((length - lead + gutter) / (size + gutter)))
      : Math.max(1, grid.count ?? 5)
  const total = count * size + (count - 1) * gutter
  const start = alignment === 'MIN' ? offset : alignment === 'MAX' ? length - offset - total : (length - total) / 2
  for (let i = 0; i < count; i += 1) out.push([start + i * (size + gutter), size])
  return out
}

/** Stretch column width for the current frame size, used when switching to a fixed alignment. */
export function stretchSectionSize(grid: LayoutGrid, length: number): number {
  const count = Math.max(1, grid.count === 'auto' ? 1 : grid.count ?? 5)
  const gutter = Math.max(0, grid.gutter ?? 20)
  const offset = Math.max(0, grid.offset ?? 0)
  return Math.max(1, Math.round((length - offset * 2 - gutter * (count - 1)) / count))
}
