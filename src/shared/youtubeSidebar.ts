import type { AutoLayout, DesignNode } from './types'
import { DEFAULT_PAGE } from './types'
import { defaultFrameLayout, reflowAutoLayout } from './layoutEngine'

export type YoutubeSidebarOptions = {
  x?: number
  y?: number
  width?: number
  height?: number
  pageId?: string
  /** Stable id generator for tests; defaults to randomUUID-like sequential ids. */
  idFactory?: () => string
}

const NAV_PRIMARY = ['Home', 'Shorts', 'Subscriptions'] as const
const NAV_LIBRARY = ['You', 'History', 'Playlists', 'Your videos', 'Watch later', 'Liked videos'] as const

function sequentialIds(): () => string {
  let n = 0
  return () => {
    n += 1
    return `yt-${n}`
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

function navItem(
  id: () => string,
  parentId: string,
  pageId: string,
  label: string,
  active: boolean
): DesignNode[] {
  const rowId = id()
  const iconId = id()
  const textId = id()
  const row: DesignNode = {
    id: rowId,
    type: 'frame',
    name: `Nav — ${label}`,
    parentId,
    pageId,
    x: 0,
    y: 0,
    width: 216,
    height: 40,
    fill: active ? '#F2F2F2' : '#FFFFFF',
    radius: 10,
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
  }
  const icon: DesignNode = {
    id: iconId,
    type: 'rect',
    name: `${label} icon`,
    parentId: rowId,
    pageId,
    x: 0,
    y: 0,
    width: 24,
    height: 24,
    fill: active ? '#0F0F0F' : '#606060',
    radius: 6,
    layoutSizingH: 'fixed',
    layoutSizingV: 'fixed'
  }
  const text: DesignNode = {
    id: textId,
    type: 'text',
    name: label,
    parentId: rowId,
    pageId,
    x: 0,
    y: 0,
    width: 140,
    height: 20,
    text: label,
    fill: '#0F0F0F',
    fontFamily: 'Roboto',
    fontSize: 14,
    fontWeight: active ? 500 : 400,
    layoutSizingH: 'fill',
    layoutSizingV: 'hug'
  }
  return [row, icon, text]
}

/**
 * Build a YouTube-like desktop shell as nested canvas frames.
 * Left sidebar is a child of the artboard (frame-in-frame); main content uses Fill W/H.
 */
export function buildYoutubeSidebarNodes(options: YoutubeSidebarOptions = {}): DesignNode[] {
  const id = options.idFactory || sequentialIds()
  const pageId = options.pageId || DEFAULT_PAGE.id
  const x = options.x ?? 80
  const y = options.y ?? 80
  const width = options.width ?? 1440
  const height = options.height ?? 900
  const sidebarWidth = 240

  const rootId = id()
  const sidebarId = id()
  const logoRowId = id()
  const logoMarkId = id()
  const logoTextId = id()
  const dividerId = id()
  const mainId = id()
  const topBarId = id()
  const searchId = id()
  const contentId = id()
  const gridId = id()

  const nodes: DesignNode[] = [
    {
      id: rootId,
      type: 'frame',
      name: 'YouTube — Home',
      pageId,
      x,
      y,
      width,
      height,
      fill: '#FFFFFF',
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
      name: 'YouTube Sidebar',
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
        gap: 4,
        padding: { t: 12, r: 12, b: 12, l: 12 },
        alignItems: 'stretch',
        sizingH: 'fixed',
        sizingV: 'fill'
      })
    },
    {
      id: logoRowId,
      type: 'frame',
      name: 'Logo',
      parentId: sidebarId,
      pageId,
      x: 0,
      y: 0,
      width: sidebarWidth - 24,
      height: 40,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 10,
        padding: { t: 4, r: 8, b: 4, l: 8 },
        alignItems: 'center',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: logoMarkId,
      type: 'rect',
      name: 'YT mark',
      parentId: logoRowId,
      pageId,
      x: 0,
      y: 0,
      width: 28,
      height: 20,
      fill: '#FF0000',
      radius: 4,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: logoTextId,
      type: 'text',
      name: 'YouTube',
      parentId: logoRowId,
      pageId,
      x: 0,
      y: 0,
      width: 90,
      height: 22,
      text: 'YouTube',
      fill: '#0F0F0F',
      fontFamily: 'Roboto',
      fontSize: 18,
      fontWeight: 700,
      layoutSizingH: 'hug',
      layoutSizingV: 'hug'
    }
  ]

  for (const [index, label] of NAV_PRIMARY.entries()) {
    nodes.push(...navItem(id, sidebarId, pageId, label, index === 0))
  }

  nodes.push({
    id: dividerId,
    type: 'rect',
    name: 'Sidebar divider',
    parentId: sidebarId,
    pageId,
    x: 0,
    y: 0,
    width: sidebarWidth - 24,
    height: 1,
    fill: '#E5E5E5',
    layoutSizingH: 'fill',
    layoutSizingV: 'fixed'
  })

  for (const label of NAV_LIBRARY) {
    nodes.push(...navItem(id, sidebarId, pageId, label, false))
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
      width: width - sidebarWidth,
      height,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fill',
      layout: verticalLayout({
        gap: 0,
        padding: 0,
        alignItems: 'stretch',
        sizingH: 'fill',
        sizingV: 'fill'
      })
    },
    {
      id: topBarId,
      type: 'frame',
      name: 'Top bar',
      parentId: mainId,
      pageId,
      x: 0,
      y: 0,
      width: width - sidebarWidth,
      height: 56,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 16,
        padding: { t: 8, r: 24, b: 8, l: 24 },
        alignItems: 'center',
        justifyContent: 'center',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: searchId,
      type: 'rect',
      name: 'Search',
      parentId: topBarId,
      pageId,
      x: 0,
      y: 0,
      width: 480,
      height: 40,
      fill: '#F8F8F8',
      stroke: '#CCCCCC',
      strokeWidth: 1,
      radius: 20,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed'
    },
    {
      id: contentId,
      type: 'frame',
      name: 'Content',
      parentId: mainId,
      pageId,
      x: 0,
      y: 56,
      width: width - sidebarWidth,
      height: height - 56,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fill',
      layout: verticalLayout({
        gap: 16,
        padding: 24,
        alignItems: 'stretch',
        sizingH: 'fill',
        sizingV: 'fill'
      })
    },
    {
      id: gridId,
      type: 'frame',
      name: 'Video grid',
      parentId: contentId,
      pageId,
      x: 0,
      y: 0,
      width: width - sidebarWidth - 48,
      height: height - 56 - 48,
      fill: '#F9F9F9',
      radius: 12,
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fill',
      layout: horizontalLayout({
        gap: 16,
        padding: 16,
        alignItems: 'start',
        wrap: true,
        sizingH: 'fill',
        sizingV: 'fill'
      })
    }
  )

  // Placeholder video cards — fixed size children inside the fill grid
  for (let i = 0; i < 6; i++) {
    const cardId = id()
    const thumbId = id()
    const titleId = id()
    nodes.push(
      {
        id: cardId,
        type: 'frame',
        name: `Video ${i + 1}`,
        parentId: gridId,
        pageId,
        x: 0,
        y: 0,
        width: 280,
        height: 220,
        fill: '#FFFFFF',
        radius: 8,
        clipsContent: true,
        layoutSizingH: 'fixed',
        layoutSizingV: 'fixed',
        layout: verticalLayout({
          gap: 10,
          padding: 0,
          alignItems: 'stretch',
          sizingH: 'fixed',
          sizingV: 'fixed'
        })
      },
      {
        id: thumbId,
        type: 'rect',
        name: `Thumb ${i + 1}`,
        parentId: cardId,
        pageId,
        x: 0,
        y: 0,
        width: 280,
        height: 158,
        fill: i % 2 === 0 ? '#212121' : '#3F3F3F',
        radius: 8,
        layoutSizingH: 'fill',
        layoutSizingV: 'fixed'
      },
      {
        id: titleId,
        type: 'text',
        name: `Title ${i + 1}`,
        parentId: cardId,
        pageId,
        x: 0,
        y: 0,
        width: 260,
        height: 40,
        text: `Sample video title ${i + 1}`,
        fill: '#0F0F0F',
        fontFamily: 'Roboto',
        fontSize: 14,
        fontWeight: 500,
        layoutSizingH: 'fill',
        layoutSizingV: 'hug'
      }
    )
  }

  return reflowAutoLayout(nodes)
}

/** Root artboard id from a tree produced by {@link buildYoutubeSidebarNodes}. */
export function youtubeSidebarRootId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => !node.parentId && node.name === 'YouTube — Home')?.id
}

/** Left sidebar frame id. */
export function youtubeSidebarId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => node.name === 'YouTube Sidebar')?.id
}
