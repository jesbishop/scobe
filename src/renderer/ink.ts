import type { DesignNode } from '../shared/types'

/**
 * Pen, pencil and brush drawings. Their color is the node's fill (not a stroke);
 * `strokeWidth` is only the ink thickness.
 */
export function isInkPath(node: Pick<DesignNode, 'type' | 'pathTool'>): boolean {
  return node.type === 'path' && Boolean(node.pathTool)
}

export function inkColor(node: DesignNode): { hex: string; opacity: number } {
  if (node.fill || node.fillOpacity != null) {
    return { hex: node.fill || '#1A1A1A', opacity: node.fill ? (node.fillOpacity ?? 1) : 0 }
  }
  return { hex: node.stroke || '#1A1A1A', opacity: node.strokeOpacity ?? 1 }
}

export function defaultInkWeight(node: Pick<DesignNode, 'pathTool'>): number {
  return node.pathTool === 'brush' ? 64 : node.pathTool === 'pencil' ? 6 : 2
}

/** Drawings saved before ink became a fill kept their color in `stroke`. */
export function migrateInkPaths(nodes: DesignNode[]): DesignNode[] {
  let changed = false
  const next = nodes.map((node) => {
    if (!isInkPath(node) || node.fill || node.fillOpacity != null || !node.stroke) return node
    changed = true
    const { stroke, strokeOpacity, ...rest } = node
    return { ...rest, fill: stroke, fillOpacity: strokeOpacity ?? 1 }
  })
  return changed ? next : nodes
}
