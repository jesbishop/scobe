import type { DesignNode } from '../shared/types'
import { reflowAutoLayout } from '../shared/layoutEngine'

let nodes: DesignNode[] = []
const listeners = new Set<(next: DesignNode[]) => void>()

export function getDesign(): DesignNode[] {
  return nodes
}

export function setDesign(next: DesignNode[]): DesignNode[] {
  nodes = reflowAutoLayout(next)
  for (const listener of listeners) listener(nodes)
  return nodes
}

export function addDesign(node: DesignNode): DesignNode[] {
  return setDesign([...nodes, node])
}

export function updateDesign(id: string, patch: Partial<DesignNode>): DesignNode[] {
  return setDesign(nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)))
}

export function deleteDesign(ids: string[], keepChildren = false): DesignNode[] {
  const remove = new Set(ids)
  if (!keepChildren) {
    let changed = true
    while (changed) {
      changed = false
      for (const node of nodes) {
        if (node.parentId && remove.has(node.parentId) && !remove.has(node.id)) {
          remove.add(node.id)
          changed = true
        }
      }
    }
    return setDesign(nodes.filter((node) => !remove.has(node.id)))
  }
  return setDesign(
    nodes
      .filter((node) => !remove.has(node.id))
      .map((node) => (node.parentId && remove.has(node.parentId) ? { ...node, parentId: null } : node))
  )
}

export function onDesignChange(listener: (next: DesignNode[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
