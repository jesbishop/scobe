import type { AutoLayout, DesignNode } from './types'
import { DEFAULT_PAGE } from './types'
import { defaultFrameLayout, reflowAutoLayout } from './layoutEngine'

export type CanvasSidebarOptions = {
  x?: number
  y?: number
  width?: number
  height?: number
  sidebarWidth?: number
  pageId?: string
  name?: string
  /** Nav labels in the sidebar; first item is active. */
  items?: string[]
  idFactory?: () => string
}

const DEFAULT_ITEMS = ['Home', 'Explore', 'Library', 'Settings'] as const

function sequentialIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `sb-${n}`
  }
}

function verticalLayout(overrides: Partial<AutoLayout> = {}): AutoLayout {
  return {
    ...defaultFrameLayout(),
    mode: 'vertical',
    gap: 4,
    padding: 12,
    alignItems: 'stretch',
    justifyContent: 'start',
    sizingH: 'fixed',
    sizingV: 'fixed',
    ...overrides
  }
}

function horizontalLayout(overrides: Partial<AutoLayout> = {}): AutoLayout {
  return {
    ...defaultFrameLayout(),
    mode: 'horizontal',
    gap: 0,
    padding: 0,
    alignItems: 'stretch',
    justifyContent: 'start',
    sizingH: 'fixed',
    sizingV: 'fixed',
    ...overrides
  }
}

function navRow(
  id: () => string,
  parentId: string,
  pageId: string,
  label: string,
  active: boolean
): DesignNode[] {
  const rowId = id()
  const iconId = id()
  const textId = id()
  return [
    {
      id: rowId,
      type: 'frame',
      name: `Nav — ${label}`,
      parentId,
      pageId,
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      fill: active ? '#EEF6FF' : '#FFFFFF',
      radius: 8,
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 12,
        padding: { t: 8, r: 12, b: 8, l: 12 },
        alignItems: 'center',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: iconId,
      type: 'rect',
      name: `${label} icon`,
      parentId: rowId,
      pageId,
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      fill: active ? '#0D99FF' : '#8D8D8D',
      radius: 4,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: textId,
      type: 'text',
      name: label,
      parentId: rowId,
      pageId,
      x: 0,
      y: 0,
      width: 120,
      height: 18,
      text: label,
      fill: active ? '#0C8CE9' : '#1A1A1A',
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: active ? 600 : 500,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    }
  ]
}

/**
 * Place a left sidebar as a nested child of a parent artboard on the canvas.
 * Main content uses Fill W/H; sidebar is fixed width + Fill height.
 */
export function buildSidebarNodes(options: CanvasSidebarOptions = {}): DesignNode[] {
  const id = options.idFactory || sequentialIds()
  const pageId = options.pageId || DEFAULT_PAGE.id
  const x = options.x ?? 80
  const y = options.y ?? 80
  const width = options.width ?? 960
  const height = options.height ?? 640
  const sidebarWidth = options.sidebarWidth ?? 240
  const items = options.items?.length ? options.items : [...DEFAULT_ITEMS]
  const shellName = options.name || 'Sidebar shell'

  const rootId = id()
  const sidebarId = id()
  const headerId = id()
  const headerTextId = id()
  const mainId = id()
  const mainLabelId = id()

  const nodes: DesignNode[] = [
    {
      id: rootId,
      type: 'frame',
      name: shellName,
      pageId,
      x,
      y,
      width,
      height,
      fill: '#F5F5F5',
      clipsContent: true,
      layout: horizontalLayout({
        gap: 0,
        padding: 0,
        alignItems: 'stretch',
        sizingH: 'fixed',
        sizingV: 'fixed'
      })
    },
    {
      id: sidebarId,
      type: 'frame',
      name: 'Sidebar',
      parentId: rootId,
      pageId,
      x: 0,
      y: 0,
      width: sidebarWidth,
      height,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fill',
      layout: verticalLayout({
        gap: 6,
        padding: { t: 16, r: 12, b: 16, l: 12 },
        alignItems: 'stretch',
        sizingH: 'fixed',
        sizingV: 'fill'
      })
    },
    {
      id: headerId,
      type: 'frame',
      name: 'Sidebar header',
      parentId: sidebarId,
      pageId,
      x: 0,
      y: 0,
      width: sidebarWidth - 24,
      height: 36,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 8,
        padding: { t: 4, r: 4, b: 4, l: 4 },
        alignItems: 'center',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: headerTextId,
      type: 'text',
      name: 'Sidebar title',
      parentId: headerId,
      pageId,
      x: 0,
      y: 0,
      width: 120,
      height: 22,
      text: 'Sidebar',
      fill: '#1A1A1A',
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 700,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    }
  ]

  for (const [index, label] of items.entries()) {
    nodes.push(...navRow(id, sidebarId, pageId, label, index === 0))
  }

  nodes.push(
    {
      id: mainId,
      type: 'frame',
      name: 'Main',
      parentId: rootId,
      pageId,
      x: sidebarWidth,
      y: 0,
      width: Math.max(8, width - sidebarWidth),
      height,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fill',
      layout: verticalLayout({
        gap: 12,
        padding: 24,
        alignItems: 'start',
        sizingH: 'fill',
        sizingV: 'fill'
      })
    },
    {
      id: mainLabelId,
      type: 'text',
      name: 'Main label',
      parentId: mainId,
      pageId,
      x: 0,
      y: 0,
      width: 200,
      height: 24,
      text: 'Main content',
      fill: '#737373',
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: 500,
      layoutSizingH: 'hug',
      layoutSizingV: 'hug'
    }
  )

  return reflowAutoLayout(nodes)
}

export function canvasSidebarId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => node.name === 'Sidebar')?.id
}

export function canvasSidebarRootId(nodes: DesignNode[]): string | undefined {
  const sidebar = nodes.find((node) => node.name === 'Sidebar')
  if (!sidebar?.parentId) return nodes.find((node) => !node.parentId)?.id
  return sidebar.parentId
}

export function canvasSidebarMainId(nodes: DesignNode[]): string | undefined {
  const rootId = canvasSidebarRootId(nodes)
  return nodes.find((node) => node.name === 'Main' && node.parentId === rootId)?.id
}
