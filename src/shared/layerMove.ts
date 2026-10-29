import type { DesignNode } from './types'
import { canParent, hasWorldPoints, isAutoLayout, nodeIndexOf, resolveWorldRect, toRelative } from './layoutEngine'

/**
 * Where dragged layers land, in node-array terms (later in the array = higher in the stack and
 * higher in the Layers panel). Exactly one of `before`, `after` or `top` applies.
 */
export type LayerDropTarget = {
  parentId: string | null
  /** Insert just before this sibling in the array (just below it in the panel). */
  before?: string
  /** Insert just after this sibling in the array (just above it in the panel). */
  after?: string
  /** Insert above every sibling (top of the panel, last in flow). */
  top?: boolean
}

function isInside(nodeId: string, ancestorId: string, byId: Map<string, DesignNode>): boolean {
  let current = byId.get(nodeId)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = byId.get(current.parentId)
  }
  return false
}

/** Dragged ids minus any whose ancestor is also dragged (the ancestor carries them). */
export function topLevelIds(nodes: DesignNode[], ids: string[]): string[] {
  const byId = nodeIndexOf(nodes)
  const set = new Set(ids)
  return ids.filter((id) => byId.has(id) && !ids.some((other) => other !== id && set.has(other) && isInside(id, other, byId)))
}

/** False when the drop would put a layer inside itself, inside a non-container, or nowhere new. */
export function canDropLayers(nodes: DesignNode[], ids: string[], target: LayerDropTarget): boolean {
  const byId = nodeIndexOf(nodes)
  const moving = topLevelIds(nodes, ids)
  if (!moving.length) return false
  if (target.parentId) {
    const parent = byId.get(target.parentId)
    if (!parent || !canParent(parent)) return false
    if (moving.includes(parent.id) || moving.some((id) => isInside(parent.id, id, byId))) return false
  }
  const anchor = target.before || target.after
  if (anchor && moving.includes(anchor)) return false
  return true
}

/**
 * Move layers into, out of, or within frames like Figma's Layers panel: the stack/flow order follows
 * the drop, and layers keep their place on the canvas unless the new parent is auto layout.
 */
export function moveLayers(nodes: DesignNode[], ids: string[], target: LayerDropTarget): DesignNode[] | null {
  if (!canDropLayers(nodes, ids, target)) return null
  const byId = nodeIndexOf(nodes)
  const moving = topLevelIds(nodes, ids)
  const movingSet = new Set(moving)
  const parent = target.parentId ? byId.get(target.parentId)! : null
  const parentWorld = parent ? resolveWorldRect(parent, byId) : null
  const intoFlow = parent ? isAutoLayout(parent) : false

  const ordered = nodes.filter((node) => movingSet.has(node.id))
  const moved = ordered.map((node): DesignNode => {
    const next: DesignNode = { ...node, parentId: parent ? parent.id : undefined }
    if (parent?.pageId) next.pageId = parent.pageId
    if (!hasWorldPoints(node)) {
      const world = resolveWorldRect(node, byId)
      const pos = parentWorld ? toRelative({ x: world.x, y: world.y }, parentWorld) : { x: world.x, y: world.y }
      next.x = pos.x
      next.y = pos.y
    }
    if (!intoFlow && node.layoutAbsolute) delete next.layoutAbsolute
    if (!parent || !intoFlow) {
      if (next.layoutSizingH === 'fill') next.layoutSizingH = 'fixed'
      if (next.layoutSizingV === 'fill') next.layoutSizingV = 'fixed'
    }
    return next
  })

  const rest = nodes.filter((node) => !movingSet.has(node.id))
  const pageId = parent?.pageId || ordered[0]?.pageId
  const isSibling = (node: DesignNode) =>
    (node.parentId || null) === (target.parentId || null) && (parent || (node.pageId || pageId) === pageId)

  let insertAt: number
  const anchorIndex = (id: string | undefined) => (id ? rest.findIndex((node) => node.id === id) : -1)
  if (target.before && anchorIndex(target.before) >= 0) {
    insertAt = anchorIndex(target.before)
  } else if (target.after && anchorIndex(target.after) >= 0) {
    insertAt = anchorIndex(target.after) + 1
  } else {
    let last = -1
    rest.forEach((node, index) => {
      if (isSibling(node)) last = index
    })
    if (last >= 0) insertAt = last + 1
    else if (parent) insertAt = rest.findIndex((node) => node.id === parent.id) + 1
    else insertAt = rest.length
  }
  return [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]
}
