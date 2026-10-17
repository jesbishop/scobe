import type { AutoLayout, DesignNode } from './types'
import { DEFAULT_PAGE } from './types'
import { defaultFrameLayout, reflowAutoLayout } from './layoutEngine'

export type YoutubeHomepageOptions = {
  x?: number
  y?: number
  width?: number
  height?: number
  pageId?: string
  /** Stable id generator for tests; defaults to sequential ids. */
  idFactory?: () => string
}

/** @deprecated Use {@link YoutubeHomepageOptions}. */
export type YoutubeSidebarOptions = YoutubeHomepageOptions

const NAV_PRIMARY = ['Home', 'Shorts', 'Subscriptions'] as const
const NAV_LIBRARY = ['You', 'History', 'Playlists', 'Your videos', 'Watch later', 'Liked videos'] as const

const CHIPS = ['All', 'Music', 'Mixes', 'Live', 'Gaming', 'News', 'Cooking', 'Podcasts', 'Recently uploaded'] as const

const VIDEOS: Array<{ title: string; channel: string; meta: string; thumb: string; duration: string }> = [
  {
    title: 'Building an infinite canvas from scratch',
    channel: 'Design Systems Daily',
    meta: '128K views · 2 days ago',
    thumb: '#1A1A1A',
    duration: '14:22'
  },
  {
    title: 'Auto-layout tips that actually stick',
    channel: 'Figma Workshop',
    meta: '84K views · 5 days ago',
    thumb: '#2C2C2C',
    duration: '8:05'
  },
  {
    title: 'Why nested Fill beats fixed pixels',
    channel: 'Layout Lab',
    meta: '41K views · 1 week ago',
    thumb: '#111827',
    duration: '11:47'
  },
  {
    title: 'Electron + Chromium: real pages on a canvas',
    channel: 'Desktop Dev',
    meta: '62K views · 3 days ago',
    thumb: '#1F2937',
    duration: '22:10'
  },
  {
    title: 'MCP agents that design UIs live',
    channel: 'Agentic UI',
    meta: '19K views · 12 hours ago',
    thumb: '#374151',
    duration: '9:33'
  },
  {
    title: 'YouTube home — component teardown',
    channel: 'Pixel & Path',
    meta: '210K views · 2 weeks ago',
    thumb: '#0F172A',
    duration: '18:01'
  },
  {
    title: 'Responsive grids without media-query soup',
    channel: 'CSS Craft',
    meta: '55K views · 4 days ago',
    thumb: '#312E81',
    duration: '12:56'
  },
  {
    title: 'Shipping a design system in a weekend',
    channel: 'Ship Club',
    meta: '97K views · 6 days ago',
    thumb: '#3F3F46',
    duration: '16:40'
  }
]

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

function chip(
  id: () => string,
  parentId: string,
  pageId: string,
  label: string,
  active: boolean
): DesignNode[] {
  const chipId = id()
  const textId = id()
  const frame: DesignNode = {
    id: chipId,
    type: 'frame',
    name: `Chip — ${label}`,
    parentId,
    pageId,
    x: 0,
    y: 0,
    width: Math.max(48, 28 + label.length * 8),
    height: 32,
    fill: active ? '#0F0F0F' : '#F2F2F2',
    radius: 8,
    clipsContent: true,
    layoutSizingH: 'hug',
    layoutSizingV: 'fixed',
    layout: horizontalLayout({
      gap: 0,
      padding: { t: 6, r: 12, b: 6, l: 12 },
      alignItems: 'center',
      justifyContent: 'center',
      sizingH: 'hug',
      sizingV: 'fixed'
    })
  }
  const text: DesignNode = {
    id: textId,
    type: 'text',
    name: label,
    parentId: chipId,
    pageId,
    x: 0,
    y: 0,
    width: Math.max(24, label.length * 7),
    height: 18,
    text: label,
    fill: active ? '#FFFFFF' : '#0F0F0F',
    fontFamily: 'Roboto',
    fontSize: 13,
    fontWeight: 500,
    layoutSizingH: 'hug',
    layoutSizingV: 'hug'
  }
  return [frame, text]
}

function videoCard(
  id: () => string,
  parentId: string,
  pageId: string,
  index: number,
  video: (typeof VIDEOS)[number]
): DesignNode[] {
  const cardId = id()
  const thumbWrapId = id()
  const thumbId = id()
  const durationId = id()
  const metaId = id()
  const avatarId = id()
  const copyId = id()
  const titleId = id()
  const channelId = id()
  const statsId = id()

  return [
    {
      id: cardId,
      type: 'frame',
      name: `Video ${index + 1}`,
      parentId,
      pageId,
      x: 0,
      y: 0,
      width: 320,
      height: 286,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed',
      layout: verticalLayout({
        gap: 12,
        padding: 0,
        alignItems: 'stretch',
        sizingH: 'fixed',
        sizingV: 'fixed'
      })
    },
    {
      id: thumbWrapId,
      type: 'frame',
      name: `Thumb wrap ${index + 1}`,
      parentId: cardId,
      pageId,
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      fill: video.thumb,
      radius: 12,
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: {
        mode: 'none'
      }
    },
    {
      id: thumbId,
      type: 'rect',
      name: `Thumb ${index + 1}`,
      parentId: thumbWrapId,
      pageId,
      x: 0,
      y: 0,
      width: 320,
      height: 180,
      fill: video.thumb,
      layoutSizingH: 'fill',
      layoutSizingV: 'fill'
    },
    {
      id: durationId,
      type: 'frame',
      name: `Duration ${index + 1}`,
      parentId: thumbWrapId,
      pageId,
      x: 268,
      y: 152,
      width: 44,
      height: 20,
      fill: 'rgba(0,0,0,0.8)',
      radius: 4,
      clipsContent: true,
      layoutAbsolute: true,
      layout: horizontalLayout({
        gap: 0,
        padding: { t: 2, r: 6, b: 2, l: 6 },
        alignItems: 'center',
        justifyContent: 'center',
        sizingH: 'hug',
        sizingV: 'hug'
      })
    },
    {
      id: id(),
      type: 'text',
      name: video.duration,
      parentId: durationId,
      pageId,
      x: 0,
      y: 0,
      width: 36,
      height: 16,
      text: video.duration,
      fill: '#FFFFFF',
      fontFamily: 'Roboto',
      fontSize: 11,
      fontWeight: 500,
      layoutSizingH: 'hug',
      layoutSizingV: 'hug'
    },
    {
      id: metaId,
      type: 'frame',
      name: `Meta ${index + 1}`,
      parentId: cardId,
      pageId,
      x: 0,
      y: 0,
      width: 320,
      height: 94,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug',
      layout: horizontalLayout({
        gap: 12,
        padding: 0,
        alignItems: 'start',
        sizingH: 'fill',
        sizingV: 'hug'
      })
    },
    {
      id: avatarId,
      type: 'ellipse',
      name: `Avatar ${index + 1}`,
      parentId: metaId,
      pageId,
      x: 0,
      y: 0,
      width: 36,
      height: 36,
      fill: index % 2 === 0 ? '#FF0000' : '#0D99FF',
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: copyId,
      type: 'frame',
      name: `Copy ${index + 1}`,
      parentId: metaId,
      pageId,
      x: 0,
      y: 0,
      width: 272,
      height: 94,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug',
      layout: verticalLayout({
        gap: 4,
        padding: 0,
        alignItems: 'stretch',
        sizingH: 'fill',
        sizingV: 'hug'
      })
    },
    {
      id: titleId,
      type: 'text',
      name: `Title ${index + 1}`,
      parentId: copyId,
      pageId,
      x: 0,
      y: 0,
      width: 272,
      height: 40,
      text: video.title,
      fill: '#0F0F0F',
      fontFamily: 'Roboto',
      fontSize: 14,
      fontWeight: 500,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    },
    {
      id: channelId,
      type: 'text',
      name: `Channel ${index + 1}`,
      parentId: copyId,
      pageId,
      x: 0,
      y: 0,
      width: 272,
      height: 18,
      text: video.channel,
      fill: '#606060',
      fontFamily: 'Roboto',
      fontSize: 12,
      fontWeight: 400,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    },
    {
      id: statsId,
      type: 'text',
      name: `Stats ${index + 1}`,
      parentId: copyId,
      pageId,
      x: 0,
      y: 0,
      width: 272,
      height: 18,
      text: video.meta,
      fill: '#606060',
      fontFamily: 'Roboto',
      fontSize: 12,
      fontWeight: 400,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    }
  ]
}

/**
 * Build a full YouTube homepage on the canvas: sidebar + top bar + chips + video grid.
 * Nested frames use Fill W/H for children that should grow with the parent.
 */
export function buildYoutubeHomepageNodes(options: YoutubeHomepageOptions = {}): DesignNode[] {
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
  const guideId = id()
  const searchId = id()
  const searchBtnId = id()
  const actionsId = id()
  const createId = id()
  const bellId = id()
  const avatarId = id()
  const contentId = id()
  const chipsId = id()
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
        padding: { t: 8, r: 24, b: 8, l: 16 },
        alignItems: 'center',
        justifyContent: 'start',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: guideId,
      type: 'rect',
      name: 'Guide button',
      parentId: topBarId,
      pageId,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: '#F2F2F2',
      radius: 20,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: searchId,
      type: 'frame',
      name: 'Search',
      parentId: topBarId,
      pageId,
      x: 0,
      y: 0,
      width: 540,
      height: 40,
      fill: '#FFFFFF',
      stroke: '#CCCCCC',
      strokeWidth: 1,
      radius: 20,
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 0,
        padding: 0,
        alignItems: 'stretch',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    },
    {
      id: id(),
      type: 'text',
      name: 'Search placeholder',
      parentId: searchId,
      pageId,
      x: 0,
      y: 0,
      width: 200,
      height: 20,
      text: 'Search',
      fill: '#888888',
      fontFamily: 'Roboto',
      fontSize: 16,
      fontWeight: 400,
      layoutSizingH: 'fill',
      layoutSizingV: 'hug'
    },
    {
      id: searchBtnId,
      type: 'rect',
      name: 'Search button',
      parentId: searchId,
      pageId,
      x: 0,
      y: 0,
      width: 64,
      height: 40,
      fill: '#F8F8F8',
      layoutSizingH: 'fixed',
      layoutSizingV: 'fill'
    },
    {
      id: actionsId,
      type: 'frame',
      name: 'Top actions',
      parentId: topBarId,
      pageId,
      x: 0,
      y: 0,
      width: 140,
      height: 40,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'hug',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 12,
        padding: 0,
        alignItems: 'center',
        justifyContent: 'end',
        sizingH: 'hug',
        sizingV: 'fixed'
      })
    },
    {
      id: createId,
      type: 'rect',
      name: 'Create',
      parentId: actionsId,
      pageId,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: '#F2F2F2',
      radius: 20,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: bellId,
      type: 'rect',
      name: 'Notifications',
      parentId: actionsId,
      pageId,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: '#F2F2F2',
      radius: 20,
      layoutSizingH: 'fixed',
      layoutSizingV: 'fixed'
    },
    {
      id: avatarId,
      type: 'ellipse',
      name: 'Account',
      parentId: actionsId,
      pageId,
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      fill: '#0D99FF',
      layoutSizingH: 'fixed',
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
        gap: 12,
        padding: { t: 0, r: 24, b: 24, l: 24 },
        alignItems: 'stretch',
        sizingH: 'fill',
        sizingV: 'fill'
      })
    },
    {
      id: chipsId,
      type: 'frame',
      name: 'Chips',
      parentId: contentId,
      pageId,
      x: 0,
      y: 0,
      width: width - sidebarWidth - 48,
      height: 48,
      fill: '#FFFFFF',
      clipsContent: true,
      layoutSizingH: 'fill',
      layoutSizingV: 'fixed',
      layout: horizontalLayout({
        gap: 12,
        padding: { t: 8, r: 0, b: 8, l: 0 },
        alignItems: 'center',
        sizingH: 'fill',
        sizingV: 'fixed'
      })
    }
  )

  for (const [index, label] of CHIPS.entries()) {
    nodes.push(...chip(id, chipsId, pageId, label, index === 0))
  }

  nodes.push({
    id: gridId,
    type: 'frame',
    name: 'Video grid',
    parentId: contentId,
    pageId,
    x: 0,
    y: 0,
    width: width - sidebarWidth - 48,
    height: height - 56 - 48 - 36,
    fill: '#FFFFFF',
    clipsContent: true,
    layoutSizingH: 'fill',
    layoutSizingV: 'fill',
    layout: horizontalLayout({
      gap: 16,
      padding: 0,
      alignItems: 'start',
      wrap: true,
      counterGap: 24,
      sizingH: 'fill',
      sizingV: 'fill'
    })
  })

  for (const [index, video] of VIDEOS.entries()) {
    nodes.push(...videoCard(id, gridId, pageId, index, video))
  }

  return reflowAutoLayout(nodes)
}

/**
 * Alias for {@link buildYoutubeHomepageNodes} — kept for MCP/agent tool compatibility.
 */
export function buildYoutubeSidebarNodes(options: YoutubeHomepageOptions = {}): DesignNode[] {
  return buildYoutubeHomepageNodes(options)
}

/** Root artboard id from a tree produced by the YouTube homepage factory. */
export function youtubeHomepageRootId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => !node.parentId && node.name === 'YouTube — Home')?.id
}

/** @deprecated Use {@link youtubeHomepageRootId}. */
export function youtubeSidebarRootId(nodes: DesignNode[]): string | undefined {
  return youtubeHomepageRootId(nodes)
}

/** Left sidebar frame id. */
export function youtubeSidebarId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => node.name === 'YouTube Sidebar')?.id
}

/** Chips / filter row id. */
export function youtubeChipsId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => node.name === 'Chips')?.id
}

/** Video grid id. */
export function youtubeGridId(nodes: DesignNode[]): string | undefined {
  return nodes.find((node) => node.name === 'Video grid')?.id
}
