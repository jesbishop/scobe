export type Camera = {
  x: number
  y: number
  zoom: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserTab = {
  id: string
  url: string
  title: string
  favicon: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
}

export type BrowserFrame = {
  id: string
  x: number
  y: number
  width: number
  height: number
  activeTabId: string
  tabs: BrowserTab[]
}

export type PageState = {
  id: string
  windowId: string
  url: string
  title: string
  favicon: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  width: number
  height: number
}

export type DesignPage = {
  id: string
  name: string
  fill?: string
}

export type Workspace = {
  version: 2
  camera: Camera
  browsers: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    activeTabId: string
    tabs: Array<{ id: string; url: string }>
  }>
  design: DesignNode[]
  pages: DesignPage[]
  activePageId: string
}

export type DesignTool =
  | 'pointer'
  | 'hand'
  | 'scale'
  | 'frame'
  | 'section'
  | 'browser'
  | 'shape'
  | 'pen'
  | 'pencil'
  | 'brush'
  | 'text'
  | 'text-on-path'
  | 'comment'
  | 'measure'
  | 'widget'
export type SwitchMode = 'draw' | 'design' | 'chat'
export type ShapeKind = 'rect' | 'line' | 'arrow' | 'ellipse' | 'polygon' | 'star'
export type DrawPathTool = 'pen' | 'pencil' | 'brush'
export type BrushStyleId =
  | 'basic'
  | 'heist'
  | 'blockbuster'
  | 'grindhouse'
  | 'biopic'
  | 'spaghetti-western'
  | 'slasher'
  | 'hardboiled'
  | 'verite'
  | 'epic'
  | 'screwball'
  | 'rom-com'
  | 'noir'
  | 'propaganda'
  | 'melodrama'
  | 'new-wave'

export type PathPoint = {
  x: number
  y: number
  inX?: number
  inY?: number
  outX?: number
  outY?: number
}

export type DesignNode = {
  id: string
  type:
    | 'section'
    | 'frame'
    | 'rect'
    | 'ellipse'
    | 'line'
    | 'arrow'
    | 'polygon'
    | 'star'
    | 'path'
    | 'text'
    | 'comment'
    | 'widget'
    | 'image'
  x: number
  y: number
  width?: number
  height?: number
  points?: PathPoint[]
  pathTool?: DrawPathTool
  brushStyle?: BrushStyleId
  closed?: boolean
  text?: string
  name?: string
  pageId?: string
  /** Parent frame or section id. Child x/y are parent-relative when set. */
  parentId?: string | null
  fill?: string
  fillOpacity?: number
  opacity?: number
  radius?: number
  rotation?: number
  stroke?: string
  strokeWidth?: number
  strokeOpacity?: number
  shadow?: boolean
  shadowX?: number
  shadowY?: number
  shadowBlur?: number
  shadowColor?: string
  blendMode?: string
  fontFamily?: string
  fontWeight?: number | string
  fontSize?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: 'left' | 'center' | 'right'
  textResize?: 'auto-width' | 'auto-height' | 'fixed'
  /** 0–100 start position for text on a path */
  textPathOffset?: number
  textPathFlip?: boolean
  editing?: boolean
  /** Clip overflowing children (frames default true). */
  clipsContent?: boolean
  /** Auto-layout / flex container settings (frames only). */
  layout?: AutoLayout
  /** PNG/JPEG data URL for type === 'image'. */
  imageDataUrl?: string
  /** Comment thread fields (type === 'comment') */
  commentNumber?: number
  resolved?: boolean
  unread?: boolean
  drafting?: boolean
  messages?: CommentMessage[]
}

export type AutoLayoutAlign = 'start' | 'center' | 'end' | 'stretch'
export type AutoLayoutJustify = 'start' | 'center' | 'end' | 'space-between'

export type AutoLayout = {
  mode: 'none' | 'horizontal' | 'vertical'
  gap?: number
  padding?: number | { t: number; r: number; b: number; l: number }
  alignItems?: AutoLayoutAlign
  justifyContent?: AutoLayoutJustify
  wrap?: boolean
}

export type CommentMessage = {
  id: string
  authorId: string
  text: string
  createdAt: number
  attachments?: Array<{ name: string; url: string }>
}

export const SECTION_COLORS = ['#7B61FF', '#0D99FF', '#14AE5C', '#F24822', '#FFCD29', '#9747FF'] as const

export const DEFAULT_PAGE: DesignPage = { id: 'page-1', name: 'Page 1', fill: '#EEEEEE' }

export type ChromeStatus =
  | { state: 'starting' }
  | { state: 'ready' }
  | { state: 'error'; message: string }

export type LayoutSyncItem = {
  id: string
  hole: Rect
  clip: Rect
  viewport: { width: number; height: number }
  visible: boolean
  z: number
}

export type InspectInfo = {
  browserId: string
  tag: string
  id: string
  className: string
  text: string
  href: string | null
  rect: Rect
  styles: Record<string, string>
  pinned: boolean
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export type McpStatus = {
  running: boolean
  url: string
  port: number
}

export type BuildUiEvent =
  | { type: 'build:start'; label?: string }
  | { type: 'build:working'; nodeIds: string[] }
  | { type: 'build:reveal'; nodeIds: string[] }
  | { type: 'build:finish'; nodeIds?: string[] }
  | { type: 'mcp:status'; running: boolean; url: string; port: number }
  | { type: 'ui:open-coding-agent'; agentId: string; projectName?: string }
  | { type: 'ui:set-page'; pageId: string }

export const DEFAULT_VIEWPORT = { width: 1100, height: 720 }
export const MIN_VIEWPORT = { width: 320, height: 200 }
export { DEVICE_PRESETS, type DevicePresetId } from './framePresets'
export const TAB_STRIP_HEIGHT = 32
export const NAV_HEIGHT = 36
export const FRAME_CHROME_HEIGHT = TAB_STRIP_HEIGHT + NAV_HEIGHT
export const DEFAULT_URL = 'https://www.google.com'
export const NEW_TAB_URL = 'about:blank'
export const CANVAS_ZOOM_MIN = 0.1
export const CANVAS_ZOOM_MAX = 8
export const BROWSER_PARTITION = 'persist:vanta-browser'
