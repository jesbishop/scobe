import type { DesignNode } from '../shared/types'

export type HistorySource = 'you' | 'chat' | 'agent'

export type HistoryEntry = {
  id: string
  at: number
  label: string
  source: HistorySource
  snapshot: DesignNode[]
}

const GEOMETRY = new Set(['x', 'y', 'width', 'height'])
const IGNORED = new Set(['editing'])

function layerName(node: DesignNode): string {
  const raw = node.name || node.text || (node.type === 'frame' ? 'Frame' : node.type)
  const name = raw.replace(/\s+/g, ' ').trim()
  return `“${name.length > 28 ? `${name.slice(0, 27)}…` : name}”`
}

function changedKeys(a: DesignNode, b: DesignNode): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: string[] = []
  for (const key of keys) {
    if (IGNORED.has(key)) continue
    const av = (a as Record<string, unknown>)[key]
    const bv = (b as Record<string, unknown>)[key]
    if (av === bv) continue
    if (typeof av === 'object' || typeof bv === 'object') {
      if (JSON.stringify(av) === JSON.stringify(bv)) continue
    } else if (typeof av === 'number' && typeof bv === 'number' && Math.abs(av - bv) < 0.01) {
      continue
    }
    out.push(key)
  }
  return out
}

/** Only the outermost of a set of layers (children ride along with their parent). */
function outermost(ids: Set<string>, byId: Map<string, DesignNode>): string[] {
  return [...ids].filter((id) => {
    let parent = byId.get(id)?.parentId
    while (parent) {
      if (ids.has(parent)) return false
      parent = byId.get(parent)?.parentId
    }
    return true
  })
}

function editVerb(keys: string[], node: DesignNode, after: Map<string, DesignNode>): string {
  const has = (...names: string[]) => names.some((name) => keys.includes(name))
  const name = layerName(node)
  if (has('parentId')) {
    const parent = node.parentId ? after.get(node.parentId) : null
    return parent ? `Moved ${name} into ${layerName(parent)}` : `Moved ${name} out of its frame`
  }
  if (has('text')) return `Edited text in ${name}`
  if (has('name') && keys.length === 1) return `Renamed a layer to ${name}`
  if (has('svgMarkup')) return `Changed the vector ${name}`
  if (has('fill', 'fills', 'fillOpacity')) return `Changed the fill of ${name}`
  if (has('stroke', 'strokeWidth', 'strokePaint', 'strokeAlign', 'strokeDash')) return `Changed the stroke of ${name}`
  if (has('effects', 'shadow', 'layerBlur', 'backgroundBlur')) return `Changed effects on ${name}`
  if (has('fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign')) return `Changed the type of ${name}`
  if (has('layout', 'layoutSizingH', 'layoutSizingV')) return `Changed the layout of ${name}`
  if (has('radius', 'cornerRadii')) return `Changed the corners of ${name}`
  if (has('rotation', 'flipX', 'flipY')) return `Rotated ${name}`
  if (has('visible')) return `${node.visible === false ? 'Hid' : 'Showed'} ${name}`
  if (has('locked')) return `${node.locked ? 'Locked' : 'Unlocked'} ${name}`
  if (has('opacity', 'blendMode')) return `Changed the opacity of ${name}`
  if (keys.every((key) => key === 'x' || key === 'y')) return `Moved ${name}`
  if (keys.every((key) => GEOMETRY.has(key))) return `Resized ${name}`
  return `Edited ${name}`
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** A short sentence for what changed between two versions, or null when nothing meaningful did. */
export function describeDesignChange(before: DesignNode[], after: DesignNode[]): string | null {
  const beforeById = new Map(before.map((node) => [node.id, node]))
  const afterById = new Map(after.map((node) => [node.id, node]))
  const addedIds = new Set(after.filter((node) => !beforeById.has(node.id)).map((node) => node.id))
  const removedIds = new Set(before.filter((node) => !afterById.has(node.id)).map((node) => node.id))
  const added = outermost(addedIds, afterById)
  const removed = outermost(removedIds, beforeById)

  const edits = new Map<string, string[]>()
  for (const node of after) {
    const prev = beforeById.get(node.id)
    if (!prev || prev === node) continue
    const keys = changedKeys(prev, node)
    if (keys.length) edits.set(node.id, keys)
  }
  // Auto layout reflows siblings when one child changes; report what was actually edited.
  const primary = new Set(
    [...edits.entries()]
      .filter(([id, keys]) => {
        if (keys.some((key) => !GEOMETRY.has(key))) return true
        const parent = afterById.get(id)?.parentId
        const parentNode = parent ? afterById.get(parent) : null
        return !(parentNode?.layout && parentNode.layout.mode !== 'none')
      })
      .map(([id]) => id)
  )
  const edited = outermost(primary.size ? primary : new Set(edits.keys()), afterById)

  const parts: string[] = []
  if (added.length === 1) parts.push(`Added ${layerName(afterById.get(added[0])!)}`)
  else if (added.length > 1) parts.push(`Added ${plural(added.length, 'layer')}`)
  if (removed.length === 1) parts.push(`Deleted ${layerName(beforeById.get(removed[0])!)}`)
  else if (removed.length > 1) parts.push(`Deleted ${plural(removed.length, 'layer')}`)
  if (!parts.length && edited.length === 1) {
    parts.push(editVerb(edits.get(edited[0]) || [], afterById.get(edited[0])!, afterById))
  } else if (edited.length) {
    const verb = parts.length ? 'edited' : 'Edited'
    parts.push(edited.length === 1 ? `${verb} ${layerName(afterById.get(edited[0])!)}` : `${verb} ${plural(edited.length, 'layer')}`)
  }
  if (!parts.length) {
    const reordered = before.length === after.length && before.some((node, i) => after[i]?.id !== node.id)
    return reordered ? 'Reordered layers' : null
  }
  return parts.join(' and ')
}
