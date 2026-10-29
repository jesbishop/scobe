import type { DesignNode } from '../shared/types'

type Bounds = { x: number; y: number; width: number; height: number }
type Input = Record<string, unknown>
const pageNumber = (value: unknown, fallback: number, max: number) => Math.max(0, Math.min(max, Math.floor(Number(value) || fallback)))

/** Bounded canvas reads shared by chat and MCP. No images, SVG markup, or whole-file dumps. */
export function inspectCanvas(nodes: DesignNode[], name: string, input: Input, world: (node: DesignNode) => Bounds): string {
  const rootId = input.id == null ? null : String(input.id)
  const offset = pageNumber(input.offset, 0, nodes.length)
  const limit = pageNumber(input.limit, name === 'get_tree_summary' ? 100 : 50, name === 'get_tree_summary' ? 200 : 100)
  const children = new Map<string | null, DesignNode[]>()
  for (const node of nodes) {
    const parent = node.parentId || null
    const siblings = children.get(parent)
    if (siblings) siblings.push(node)
    else children.set(parent, [node])
  }
  if (rootId && !nodes.some(node => node.id === rootId)) throw new Error('Node not found')
  if (name === 'get_basic_info') {
    const roots = nodes.filter(node => !node.parentId && ['frame', 'section'].includes(node.type))
    return JSON.stringify({ nodeCount: nodes.length, artboardCount: roots.length,
      artboards: roots.slice(offset, offset + limit).map(node => ({ id: node.id, name: node.name, type: node.type, ...world(node), childCount: children.get(node.id)?.length || 0 })),
      nextOffset: offset + limit < roots.length ? offset + limit : null,
      hint: 'Use get_tree_summary with an artboard id, then get_node_info for individual layers. list_design is paginated.' })
  }
  if (name === 'get_tree_summary') {
    const depth = Math.max(1, pageNumber(input.depth, 2, 8))
    const lines: string[] = []
    const visited = new Set<string>()
    const walk = (parent: string | null, level: number) => {
      if (level > depth) return
      for (const node of children.get(parent) || []) {
        if (visited.has(node.id)) continue
        visited.add(node.id)
        lines.push(`${'  '.repeat(level)}- ${node.type} ${(node.name || node.text || '').slice(0, 100).replace(/\s+/g, ' ')} (${node.id})`)
        walk(node.id, level + 1)
      }
    }
    if (rootId) {
      const root = nodes.find(node => node.id === rootId)!
      visited.add(root.id)
      lines.push(`${root.type} ${(root.name || '').slice(0, 100)} (${root.id})`)
      walk(rootId, 1)
    } else walk(null, 0)
    return JSON.stringify({ id: rootId, depth, total: lines.length, lines: lines.slice(offset, offset + limit), nextOffset: offset + limit < lines.length ? offset + limit : null })
  }
  let selected = nodes
  if (rootId) {
    const ids = new Set([rootId])
    const pending = [rootId]
    while (pending.length) {
      for (const child of children.get(pending.pop()!) || []) {
        if (!ids.has(child.id)) { ids.add(child.id); pending.push(child.id) }
      }
    }
    selected = nodes.filter(node => ids.has(node.id))
  }
  return JSON.stringify({ nodeCount: selected.length, offset, nodes: selected.slice(offset, offset + limit).map(node => ({
    id: node.id, type: node.type, name: node.name, text: node.text?.slice(0, 200), parentId: node.parentId || null,
    layout: node.layout || null, clipsContent: node.clipsContent,
    local: { x: node.x, y: node.y, width: node.width, height: node.height }, world: world(node)
  })), nextOffset: offset + limit < selected.length ? offset + limit : null })
}
