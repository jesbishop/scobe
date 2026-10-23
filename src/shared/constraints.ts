import type { ConstraintH, ConstraintV, DesignNode } from './types'
import { childrenOf, isAutoLayout, localBounds } from './layoutEngine'

export const CONSTRAINT_H_OPTIONS: { id: ConstraintH; label: string }[] = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'left-right', label: 'Left & Right' },
  { id: 'center', label: 'Center' },
  { id: 'scale', label: 'Scale' }
]

export const CONSTRAINT_V_OPTIONS: { id: ConstraintV; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'top-bottom', label: 'Top & Bottom' },
  { id: 'center', label: 'Center' },
  { id: 'scale', label: 'Scale' }
]

export function resolveConstraintH(node: DesignNode): ConstraintH {
  return node.constraintH || 'left'
}

export function resolveConstraintV(node: DesignNode): ConstraintV {
  return node.constraintV || 'top'
}

/** True when the inspector should show Constraints for this node. */
export function showsConstraints(node: DesignNode, nodes: DesignNode[]): boolean {
  if (!node.parentId || node.type === 'comment') return false
  const parent = nodes.find((item) => item.id === node.parentId)
  if (!parent || parent.type !== 'frame') return false
  // Flowing auto-layout children use Fill/Hug instead of constraints.
  if (isAutoLayout(parent) && !node.layoutAbsolute) return false
  return true
}

function constrainAxis(
  pos: number,
  size: number,
  oldParent: number,
  newParent: number,
  mode: ConstraintH | ConstraintV
): { pos: number; size: number } {
  if (!(oldParent > 0) || Math.abs(newParent - oldParent) < 0.001) return { pos, size }
  const delta = newParent - oldParent
  switch (mode) {
    case 'left':
    case 'top':
      return { pos, size }
    case 'right':
    case 'bottom':
      return { pos: pos + delta, size }
    case 'left-right':
    case 'top-bottom':
      return { pos, size: Math.max(1, size + delta) }
    case 'center':
      return { pos: pos + delta / 2, size }
    case 'scale': {
      const factor = newParent / oldParent
      return { pos: pos * factor, size: Math.max(1, size * factor) }
    }
    default:
      return { pos, size }
  }
}

function applyBoxChange(
  node: DesignNode,
  next: { x: number; y: number; width: number; height: number }
): DesignNode {
  const prev = localBounds(node)
  let out: DesignNode = {
    ...node,
    x: next.x,
    y: next.y,
    width: next.width,
    height: next.height
  }
  if (node.points?.length && prev.width > 0 && prev.height > 0) {
    const sx = next.width / prev.width
    const sy = next.height / prev.height
    out = {
      ...out,
      points: node.points.map((point) => ({
        ...point,
        x: next.x + (point.x - prev.x) * sx,
        y: next.y + (point.y - prev.y) * sy
      }))
    }
  }
  return out
}

/**
 * Reposition / resize immediate children when a parent frame changes size.
 * Recurses into nested frames whose size changed so grandchildren update too.
 */
export function applyConstraintsOnParentResize(
  nodes: DesignNode[],
  parentId: string,
  prevSize: { width: number; height: number },
  nextSize: { width: number; height: number }
): DesignNode[] {
  if (
    Math.abs(prevSize.width - nextSize.width) < 0.001 &&
    Math.abs(prevSize.height - nextSize.height) < 0.001
  ) {
    return nodes
  }

  const parent = nodes.find((node) => node.id === parentId)
  if (!parent || (parent.type !== 'frame' && parent.type !== 'section')) return nodes

  const auto = isAutoLayout(parent)
  const kids = childrenOf(nodes, parentId)
  if (!kids.length) return nodes

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const resizedFrames: { id: string; prev: { width: number; height: number }; next: { width: number; height: number } }[] =
    []

  for (const child of kids) {
    if (child.type === 'comment') continue
    // Auto-layout owns flowing children; only absolute kids use constraints.
    if (auto && !child.layoutAbsolute) continue

    const box = localBounds(child)
    const h = constrainAxis(box.x, box.width, prevSize.width, nextSize.width, resolveConstraintH(child))
    const v = constrainAxis(box.y, box.height, prevSize.height, nextSize.height, resolveConstraintV(child))
    if (
      Math.abs(h.pos - box.x) < 0.001 &&
      Math.abs(v.pos - box.y) < 0.001 &&
      Math.abs(h.size - box.width) < 0.001 &&
      Math.abs(v.size - box.height) < 0.001
    ) {
      continue
    }
    const patched = applyBoxChange(child, { x: h.pos, y: v.pos, width: h.size, height: v.size })
    byId.set(child.id, patched)
    if (child.type === 'frame' || child.type === 'section') {
      resizedFrames.push({
        id: child.id,
        prev: { width: box.width, height: box.height },
        next: { width: h.size, height: v.size }
      })
    }
  }

  let next = nodes.map((node) => byId.get(node.id) || node)
  for (const frame of resizedFrames) {
    next = applyConstraintsOnParentResize(next, frame.id, frame.prev, frame.next)
  }
  return next
}
