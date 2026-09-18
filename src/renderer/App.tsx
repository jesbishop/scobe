import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { BrowserFrame } from './BrowserFrame'
import { CanvasToolbar } from './CanvasToolbar'
import { DesignLayer } from './DesignLayer'
import { CommentCursor, CommentResolveToast, CommentThreadCard, CURRENT_USER } from './CommentOverlays'
import { CommentsPanel } from './CommentsPanel'
import { MeasureOverlay } from './MeasureOverlay'
import { distanceMeasurements, hitTestRect, sizeMeasurements } from './measureMath'
import { clampZoom, fitFrames, intersectRects, nodeBounds, rectContains, rectsOverlap, scaleNodeAround, screenToWorld, wheelPan, wheelZoomFactor, worldRectToScreen, worldToScreen, zoomAt } from './canvasMath'
import { ChatBrowserPanel, ChatWorkspace, createChatSession, type ChatSession } from './ChatView'
import { FileTabs, HomeScreen, LeftSidebar, RightSidebar, type LayerItem, type ProjectFile, type RailTab } from './shell'
import { FrameActionBar } from './FrameBar'
import { loadCodingAgents, rememberCodingAgent } from './codingAgents'
import {
  findTextPathTarget,
  isTextOnPath,
  measurePlainText,
  offsetAlongPath,
  pathPointsFromNode
} from './textPath'
import {
  DEFAULT_PAGE,
  DEFAULT_VIEWPORT,
  MIN_VIEWPORT,
  type AgentEvent,
  type BrowserFrame as Frame,
  type Camera,
  type ChromeStatus,
  type DesignNode,
  type DesignPage,
  type BrushStyleId,
  type DesignTool,
  type InspectInfo,
  type BuildUiEvent,
  type McpStatus,
  type PathPoint,
  type ShapeKind,
  type SwitchMode
} from '../shared/types'
import { CHAT_BROWSER_HOME, CHAT_BROWSER_ID, getCodingAgentMeta, SIDEBAR_BROWSER_ID, type CodingAgentId } from '../shared/codingAgents'
import { nextCommentNumber } from '../shared/comments'
import type { FramePreset } from '../shared/framePresets'
import { CanvasContextMenu, type ContextMenuState } from './CanvasContextMenu'
import { copyNodeAsPng } from './exportNode'
import {
  addOrWrapFlex,
  childrenOf,
  defaultFrameLayout,
  duplicateSelection,
  expandWithDescendants,
  findContainingParent,
  isAutoLayout,
  layersAtPoint,
  reflowAutoLayout,
  removeFlexFromSelection,
  resolveWorldRect,
  toRelative,
  wrapSelectionInFrame
} from '../shared/layoutEngine'

function attachToParent(node: DesignNode, nodes: DesignNode[]): DesignNode {
  const width = Math.max(1, node.width || (node.type === 'text' ? 40 : 1))
  const height = Math.max(1, node.height || (node.type === 'text' ? node.fontSize || 12 : 1))
  const center = { x: node.x + width / 2, y: node.y + height / 2 }
  const parent = findContainingParent(center, nodes, new Set([node.id]))
  if (!parent) return { ...node, parentId: undefined }
  const parentWorld = resolveWorldRect(parent, nodes)
  const rel = toRelative({ x: node.x, y: node.y }, parentWorld)
  return { ...node, parentId: parent.id, x: rel.x, y: rel.y }
}

function reparentMovedNode(node: DesignNode, nodes: DesignNode[], exclude: Set<string>): DesignNode {
  const world = resolveWorldRect(node, nodes)
  const center = { x: world.x + world.width / 2, y: world.y + world.height / 2 }
  const parent = findContainingParent(center, nodes, exclude)
  if (!parent) {
    if (!node.parentId) return node
    return { ...node, parentId: undefined, x: world.x, y: world.y }
  }
  if (parent.id === node.parentId) return node
  const parentWorld = resolveWorldRect(parent, nodes)
  const rel = toRelative({ x: world.x, y: world.y }, parentWorld)
  return { ...node, parentId: parent.id, x: rel.x, y: rel.y }
}

function reorderAutoLayoutChildren(nodes: DesignNode[], parentId: string): DesignNode[] {
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent || !isAutoLayout(parent)) return nodes
  const kids = childrenOf(nodes, parentId)
  if (kids.length < 2) return nodes
  const vertical = parent.layout?.mode === 'vertical'
  const sorted = [...kids].sort((a, b) => {
    const aw = resolveWorldRect(a, nodes)
    const bw = resolveWorldRect(b, nodes)
    const ac = vertical ? aw.y + aw.height / 2 : aw.x + aw.width / 2
    const bc = vertical ? bw.y + bw.height / 2 : bw.x + bw.width / 2
    return ac - bc
  })
  const kidIds = new Set(kids.map((node) => node.id))
  const result: DesignNode[] = []
  let inserted = false
  for (const node of nodes) {
    if (kidIds.has(node.id)) {
      if (!inserted) {
        result.push(...sorted)
        inserted = true
      }
      continue
    }
    result.push(node)
  }
  return result
}

export function App() {
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 1 })
  const [browsers, setBrowsers] = useState<Frame[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<ChromeStatus>({ state: 'starting' })
  const [panning, setPanning] = useState(false)
  const [handMode, setHandMode] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [inspectOn, setInspectOn] = useState(false)
  const [inspect, setInspect] = useState<InspectInfo | null>(null)
  const [measureHoverId, setMeasureHoverId] = useState<string | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  const [browserMeasureId, setBrowserMeasureId] = useState<string | null>(null)
  const [browserMeasureInspect, setBrowserMeasureInspect] = useState(true)
  const [browserMeasureXray, setBrowserMeasureXray] = useState(false)
  const [tool, setTool] = useState<DesignTool>('pointer')
  const [switchMode, setSwitchMode] = useState<SwitchMode>('draw')
  const [design, setDesign] = useState<DesignNode[]>([])
  const [designSelectedIds, setDesignSelectedIds] = useState<string[]>([])
  const [snapshotRevealId, setSnapshotRevealId] = useState<string | null>(null)
  const [buildingIds, setBuildingIds] = useState<string[]>([])
  const [revealIds, setRevealIds] = useState<string[]>([])
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [draft, setDraft] = useState<DesignNode | null>(null)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [pencilWeight, setPencilWeight] = useState(6)
  const [brushWeight, setBrushWeight] = useState(64)
  const [pencilStyle, setPencilStyle] = useState<BrushStyleId>('basic')
  const [brushStyle, setBrushStyle] = useState<BrushStyleId>('heist')
  const [penHover, setPenHover] = useState<PathPoint | null>(null)
  const [pathHoverId, setPathHoverId] = useState<string | null>(null)
  const [drawCursor, setDrawCursor] = useState<{ x: number; y: number } | null>(null)
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<ContextMenuState | null>(null)
  const designClipboard = useRef<DesignNode[] | null>(null)
  const styleClipboard = useRef<Partial<DesignNode> | null>(null)
  const [rail, setRail] = useState<RailTab>('file')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('vanta-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })
  const [view, setView] = useState<'canvas' | 'home'>('canvas')
  const [files, setFiles] = useState<ProjectFile[]>([{ id: 'file-1', name: 'Untitled', editedAt: Date.now() }])
  const [activeFileId, setActiveFileId] = useState('file-1')
  const [actionAnchor, setActionAnchor] = useState<DOMRect | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chats, setChats] = useState<ChatSession[]>(() => [createChatSession()])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [chatBrowserUrl, setChatBrowserUrl] = useState(CHAT_BROWSER_HOME)
  const [pages, setPages] = useState<DesignPage[]>([{ ...DEFAULT_PAGE }])
  const [activePageId, setActivePageId] = useState(DEFAULT_PAGE.id)
  const [pageQuery, setPageQuery] = useState('')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftWidth, setLeftWidth] = useState(268)
  const [rightWidth, setRightWidth] = useState(248)
  const [codingActive, setCodingActive] = useState(() => loadCodingAgents().active)
  const [codingRecents, setCodingRecents] = useState(() => loadCodingAgents().recents)
  const [codingPopup, setCodingPopup] = useState(false)
  const [codingFullscreen, setCodingFullscreen] = useState(false)
  const codingFullscreenRef = useRef(false)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentDraftText, setCommentDraftText] = useState('')
  const [commentCursor, setCommentCursor] = useState<{ x: number; y: number } | null>(null)
  const [commentsQuery, setCommentsQuery] = useState('')
  const [commentsShowResolved, setCommentsShowResolved] = useState(false)
  const [resolveToastId, setResolveToastId] = useState<string | null>(null)
  const activeCommentIdRef = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const holes = useRef(new Map<string, HTMLDivElement>())
  const agentHole = useRef<HTMLDivElement | null>(null)
  const chatHole = useRef<HTMLDivElement | null>(null)
  const agentVisibleRef = useRef(false)
  const chatBrowserVisibleRef = useRef(false)
  const layoutQueued = useRef(false)
  const cameraRaf = useRef<number | null>(null)
  const pan = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null)
  const space = useRef(false)
  const cameraRef = useRef(camera)
  const browsersRef = useRef(browsers)
  const selectedRef = useRef(selectedId)
  const toolRef = useRef(tool)
  const designRef = useRef(design)
  const designSelectedRef = useRef(designSelectedIds)
  const shapeRef = useRef(shapeKind)
  const moveStart = useRef(
    new Map<string, { worldX: number; worldY: number; localX: number; localY: number; points?: PathPoint[] }>()
  )
  const scaleStart = useRef<DesignNode[]>([])
  const marquee = useRef<{
    x: number
    y: number
    shift: boolean
    baseIds: string[]
  } | null>(null)
  const drawRef = useRef<{
    id: string
    kind: 'box' | 'path' | 'pen' | 'text'
    type: DesignNode['type']
    startX: number
    startY: number
  } | null>(null)
  const penDrag = useRef<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  const strokeRef = useRef({
    color: '#000000',
    pencilWeight: 6,
    brushWeight: 64,
    pencilStyle: 'basic' as BrushStyleId,
    brushStyle: 'heist' as BrushStyleId
  })
  const persistTimer = useRef<number | null>(null)
  const pagesRef = useRef(pages)
  const activePageRef = useRef(activePageId)
  const draftRef = useRef<DesignNode | null>(null)
  const onCanvasRef = useRef(true)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const activeChatIdRef = useRef<string | null>(activeChatId)
  const chatHistories = useRef(new Map<string, Array<{ role: 'user' | 'assistant'; text: string }>>())
  if (cameraRaf.current == null) cameraRef.current = camera
  browsersRef.current = browsers
  selectedRef.current = selectedId
  toolRef.current = tool
  designRef.current = design
  designSelectedRef.current = designSelectedIds
  shapeRef.current = shapeKind
  draftRef.current = draft
  strokeRef.current = {
    color: strokeColor,
    pencilWeight,
    brushWeight,
    pencilStyle,
    brushStyle
  }
  pagesRef.current = pages
  activePageRef.current = activePageId
  const resolvedChatId = activeChatId || chats[0]?.id || ''
  activeChatIdRef.current = resolvedChatId
  onCanvasRef.current = view === 'canvas' && rail !== 'chat'
  codingFullscreenRef.current = codingFullscreen
  activeCommentIdRef.current = activeCommentId
  agentVisibleRef.current =
    view === 'canvas' &&
    rail === 'coding-agents' &&
    Boolean(codingActive) &&
    !codingPopup &&
    (leftOpen || codingFullscreen)
  chatBrowserVisibleRef.current = view === 'canvas' && rail === 'chat' && rightOpen

  const activeChat = chats.find((chat) => chat.id === resolvedChatId) || chats[0]
  const chatLog = activeChat?.messages || []

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('vanta-theme', theme)
    } catch {
      /* ignore */
    }
    void window.vanta.setTheme?.(theme)
  }, [theme])

  const selected = browsers.find((frame) => frame.id === selectedId) || null
  const activeTabId = selected?.activeTabId || null
  const activeFile = files.find((file) => file.id === activeFileId) || files[0]

  const persistPages = (next: DesignPage[], nextActive = activePageRef.current) => {
    setPages(next)
    setActivePageId(nextActive)
    void window.vanta.setPages?.(next, nextActive)
  }

  const designSelectedId = designSelectedIds[designSelectedIds.length - 1] || null

  const pageNodes = design.filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageId)
  const layers: LayerItem[] = (() => {
    const byParent = new Map<string | null, DesignNode[]>()
    for (const node of pageNodes) {
      const key = node.parentId || null
      const list = byParent.get(key) || []
      list.push(node)
      byParent.set(key, list)
    }
    const items: LayerItem[] = []
    const walk = (parentId: string | null, depth: number) => {
      const kids = byParent.get(parentId) || []
      for (let i = kids.length - 1; i >= 0; i--) {
        const node = kids[i]
        items.push({
          id: node.id,
          kind: node.type,
          name:
            node.name ||
            node.text ||
            (node.type === 'frame' ? 'New frame name' : node.type === 'section' ? 'Section' : node.type),
          selected: designSelectedIds.includes(node.id),
          textOnPath: isTextOnPath(node),
          depth
        })
        walk(node.id, depth + 1)
      }
    }
    walk(null, 0)
    for (const [index, frame] of browsers.entries()) {
      items.push({
        id: frame.id,
        kind: 'browser',
        name: frame.tabs.find((tab) => tab.id === frame.activeTabId)?.title || `Window ${index + 1}`,
        selected: selectedId === frame.id,
        depth: 0
      })
    }
    return items
  })()

  const persistDesign = (next: DesignNode[], opts?: { skipReflow?: boolean }) => {
    const flowed = opts?.skipReflow ? next : reflowAutoLayout(next)
    setDesign(flowed)
    if (opts?.skipReflow) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      void window.vanta.setDesign(flowed)
    }, 200)
  }

  const collectSelectionTree = (ids: string[]) => {
    const seed = new Set(ids)
    const all = expandWithDescendants(designRef.current, seed)
    return designRef.current.filter((node) => all.has(node.id))
  }

  const copySelection = () => {
    const ids = designSelectedRef.current
    if (!ids.length) return
    designClipboard.current = collectSelectionTree(ids).map((node) => structuredClone(node))
    void navigator.clipboard.writeText(JSON.stringify({ vantaDesign: designClipboard.current })).catch(() => undefined)
  }

  const duplicateSelected = () => {
    const result = duplicateSelection(designRef.current, designSelectedRef.current)
    if (!result) return
    persistDesign(result.nodes)
    setDesignSelectedIds(result.newIds)
    setSelectedId(null)
  }

  const frameSelected = () => {
    const wrapped = wrapSelectionInFrame(designRef.current, designSelectedRef.current, {
      pageId: activePageRef.current,
      id: crypto.randomUUID()
    })
    if (!wrapped) return
    persistDesign(wrapped.nodes)
    setDesignSelectedIds([wrapped.frameId])
    setSelectedId(null)
    setRightOpen(true)
  }

  const wrapFlexSelected = () => {
    const result = addOrWrapFlex(designRef.current, designSelectedRef.current, {
      pageId: activePageRef.current,
      id: crypto.randomUUID()
    })
    if (!result) return
    persistDesign(result.nodes)
    if (result.frameId) setDesignSelectedIds([result.frameId])
    setSelectedId(null)
    setRightOpen(true)
  }

  const removeFlexSelected = () => {
    persistDesign(removeFlexFromSelection(designRef.current, designSelectedRef.current))
  }

  const pasteClipboard = (mode: 'default' | 'on-top' | 'replace' = 'default') => {
    const clip = designClipboard.current
    if (!clip?.length) return
    const idMap = new Map<string, string>()
    for (const node of clip) idMap.set(node.id, crypto.randomUUID())
    const selected = designSelectedRef.current
    const target = selected.length === 1 ? designRef.current.find((node) => node.id === selected[0]) : null
    const offset = mode === 'on-top' ? 0 : 24
    let next = [...designRef.current]
    if (mode === 'replace' && selected.length) {
      const remove = expandWithDescendants(next, new Set(selected))
      next = next.filter((node) => !remove.has(node.id))
    }
    const clones = clip.map((node) => {
      const isRoot = !node.parentId || !idMap.has(node.parentId) || !clip.some((item) => item.id === node.parentId)
      // roots are those whose parent isn't in the clipboard
      const parentInClip = Boolean(node.parentId && clip.some((item) => item.id === node.parentId))
      const clone: DesignNode = {
        ...structuredClone(node),
        id: idMap.get(node.id)!,
        parentId: parentInClip ? idMap.get(node.parentId!) : mode === 'on-top' && target ? target.id : undefined,
        pageId: activePageRef.current,
        x: parentInClip ? node.x : node.x + offset,
        y: parentInClip ? node.y : node.y + offset
      }
      if (mode === 'on-top' && target && !parentInClip) {
        clone.parentId = target.id
        clone.x = 16
        clone.y = 16
      }
      void isRoot
      return clone
    })
    const newRoots = clones.filter((node) => !node.parentId || !clones.some((item) => item.id === node.parentId)).map((node) => node.id)
    persistDesign([...next, ...clones])
    setDesignSelectedIds(newRoots)
    setSelectedId(null)
  }

  const copyStylesFromSelection = () => {
    const id = designSelectedRef.current[designSelectedRef.current.length - 1]
    const node = designRef.current.find((item) => item.id === id)
    if (!node) return
    styleClipboard.current = {
      fill: node.fill,
      fillOpacity: node.fillOpacity,
      fills: node.fills,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      strokeOpacity: node.strokeOpacity,
      strokeAlign: node.strokeAlign,
      radius: node.radius,
      opacity: node.opacity,
      blendMode: node.blendMode,
      effects: node.effects,
      shadow: node.shadow,
      shadowType: node.shadowType,
      shadowX: node.shadowX,
      shadowY: node.shadowY,
      shadowBlur: node.shadowBlur,
      shadowSpread: node.shadowSpread,
      shadowColor: node.shadowColor,
      shadowOpacity: node.shadowOpacity,
      layerBlur: node.layerBlur,
      backgroundBlur: node.backgroundBlur,
      fontFamily: node.fontFamily,
      fontSize: node.fontSize,
      fontWeight: node.fontWeight,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing,
      textAlign: node.textAlign
    }
  }

  const pasteStylesToSelection = () => {
    const styles = styleClipboard.current
    if (!styles) return
    const ids = new Set(designSelectedRef.current)
    persistDesign(designRef.current.map((node) => (ids.has(node.id) ? { ...node, ...styles } : node)))
  }

  const deleteSelected = () => {
    const selected = new Set(designSelectedRef.current)
    if (!selected.size) return
    let ids = new Set(selected)
    let changed = true
    while (changed) {
      changed = false
      for (const node of designRef.current) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
          ids.add(node.id)
          changed = true
        }
      }
    }
    persistDesign(designRef.current.filter((node) => !ids.has(node.id)))
    setDesignSelectedIds([])
  }

  const selectParentOfSelection = () => {
    const id = designSelectedRef.current[designSelectedRef.current.length - 1]
    const node = designRef.current.find((item) => item.id === id)
    if (!node?.parentId) return
    setDesignSelectedIds([node.parentId])
  }

  const selectChildrenOfSelection = () => {
    const id = designSelectedRef.current[designSelectedRef.current.length - 1]
    if (!id) return
    const kids = childrenOf(designRef.current, id)
    if (!kids.length) return
    setDesignSelectedIds(kids.map((node) => node.id))
  }

  const nodeCssSnippet = (node: DesignNode, asTailwind: boolean) => {
    const w = Math.round(node.width || 0)
    const h = Math.round(node.height || 0)
    const radius = Math.round(node.radius || 0)
    const fill = node.fill || 'transparent'
    if (asTailwind) {
      return `w-[${w}px] h-[${h}px]${radius ? ` rounded-[${radius}px]` : ''} bg-[${fill}]`
    }
    return `width: ${w}px;\nheight: ${h}px;\n${radius ? `border-radius: ${radius}px;\n` : ''}background: ${fill};`
  }

  const openContextMenu = (event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number; shiftKey: boolean }, world: { x: number; y: number }) => {
    event.preventDefault()
    event.stopPropagation()
    const page = designRef.current.filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
    const layers = layersAtPoint(world, page)
    const top = layers[layers.length - 1]
    if (top) {
      const already = designSelectedRef.current.includes(top.id)
      if (!already) {
        setDesignSelectedIds([top.id])
        setSelectedId(null)
      }
    } else if (!event.shiftKey) {
      setDesignSelectedIds([])
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      layers
    })
    contextMenuRef.current = {
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      layers
    }
  }

  const convertBrowserToDesign = async (frameId: string) => {
    const frame = browsersRef.current.find((item) => item.id === frameId)
    if (!frame) return
    const tabId = frame.activeTabId || frame.tabs[0]?.id
    if (!tabId) {
      window.alert('No active browser tab to convert.')
      return
    }
    if (typeof window.vanta.screenshotBrowser !== 'function') {
      window.alert('Convert to design needs a restart. Quit and reopen Vanta, then try again.')
      return
    }
    try {
      const shot = await window.vanta.screenshotBrowser(tabId)
      const frameIdNew = crypto.randomUUID()
      const imageId = crypto.randomUUID()
      const title = frame.tabs.find((tab) => tab.id === tabId)?.title?.trim() || 'Screenshot'
      const width = Math.max(8, frame.width)
      const height = Math.max(8, frame.height)
      const x = frame.x + frame.width + 48
      const y = frame.y
      const designFrame: DesignNode = {
        id: frameIdNew,
        type: 'frame',
        x,
        y,
        width,
        height,
        name: title,
        pageId: activePageRef.current,
        fill: '#FFFFFF',
        clipsContent: true,
        layout: defaultFrameLayout()
      }
      const imageNode: DesignNode = {
        id: imageId,
        type: 'image',
        x: 0,
        y: 0,
        width,
        height,
        parentId: frameIdNew,
        pageId: activePageRef.current,
        name: title,
        imageDataUrl: shot.dataUrl
      }
      persistDesign([...designRef.current, designFrame, imageNode])
      setSelectedId(null)
      setDesignSelectedIds([frameIdNew])
      setSnapshotRevealId(frameIdNew)
      window.setTimeout(() => setSnapshotRevealId((current) => (current === frameIdNew ? null : current)), 700)

      const canvas = canvasRef.current
      if (canvas) {
        const cam = cameraRef.current
        const mid = worldToScreen(cam, x + width / 2, y + height / 2)
        const pad = 48
        let nextX = cam.x
        let nextY = cam.y
        if (mid.x < pad) nextX += pad - mid.x
        if (mid.x > canvas.clientWidth - pad) nextX -= mid.x - (canvas.clientWidth - pad)
        if (mid.y < pad) nextY += pad - mid.y
        if (mid.y > canvas.clientHeight - pad) nextY -= mid.y - (canvas.clientHeight - pad)
        if (nextX !== cam.x || nextY !== cam.y) applyCamera({ ...cam, x: nextX, y: nextY })
      }
    } catch (error) {
      console.error(error)
      window.alert(error instanceof Error ? error.message : 'Convert to design failed.')
    }
  }

  const worldFromEvent = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return screenToWorld(cameraRef.current, event.clientX - rect.left, event.clientY - rect.top)
  }

  /** Figma-style marquee: L→R intersects, R→L requires full containment. */
  const marqueeHits = (screenBox: { left: number; top: number; width: number; height: number }, dragLeft: boolean) => {
    const cam = cameraRef.current
    const world = {
      ...screenToWorld(cam, screenBox.left, screenBox.top),
      width: screenBox.width / cam.zoom,
      height: screenBox.height / cam.zoom
    }
    const nodes = designRef.current.filter(
      (node) =>
        (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
        node.type !== 'comment' &&
        !node.drafting
    )
    return nodes
      .filter((node) => {
        const bounds = resolveWorldRect(node, designRef.current)
        return dragLeft ? rectContains(world, bounds) : rectsOverlap(world, bounds)
      })
      .map((node) => node.id)
  }

  const syncLayout = useCallback(() => {
    if (layoutQueued.current) return
    layoutQueued.current = true
    requestAnimationFrame(() => {
      layoutQueued.current = false
      const canvas = canvasRef.current?.getBoundingClientRect()
      const canvasClip = canvas
        ? { x: canvas.left, y: canvas.top, width: canvas.width, height: canvas.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      const items = browsersRef.current.flatMap((frame, index) => {
        const hole = holes.current.get(frame.id)
        const box = hole?.getBoundingClientRect()
        const holeRect = box
          ? { x: box.left, y: box.top, width: box.width, height: box.height }
          : { x: 0, y: 0, width: 0, height: 0 }
        const clip = onCanvasRef.current ? intersectRects(holeRect, canvasClip) : null
        const visibleHole = Boolean(clip && clip.width > 2 && clip.height > 2)
        const z = frame.id === selectedRef.current ? 10_000 + index : index
        return frame.tabs.map((tab) => {
          const active = tab.id === frame.activeTabId
          return {
            id: tab.id,
            hole: holeRect,
            clip: active && clip ? clip : { x: 0, y: 0, width: 0, height: 0 },
            viewport: { width: frame.width, height: frame.height },
            visible: active && visibleHole,
            z
          }
        })
      })
      const agentBox = agentHole.current?.getBoundingClientRect()
      const agentRect = agentBox
        ? { x: agentBox.left, y: agentBox.top, width: agentBox.width, height: agentBox.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      // Keep a bottom strip free in fullscreen so the exit chip stays clickable above BrowserView.
      if (codingFullscreenRef.current && agentRect.height > 56) {
        agentRect.height -= 52
      }
      const agentOn = agentVisibleRef.current && agentRect.width > 2 && agentRect.height > 2
      items.push({
        id: SIDEBAR_BROWSER_ID,
        hole: agentRect,
        clip: agentRect,
        viewport: {
          width: Math.max(1, Math.round(agentRect.width)),
          height: Math.max(1, Math.round(agentRect.height))
        },
        visible: agentOn,
        z: 50_000
      })
      const chatBox = chatHole.current?.getBoundingClientRect()
      const chatRect = chatBox
        ? { x: chatBox.left, y: chatBox.top, width: chatBox.width, height: chatBox.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      const chatOn = chatBrowserVisibleRef.current && chatRect.width > 2 && chatRect.height > 2
      items.push({
        id: CHAT_BROWSER_ID,
        hole: chatRect,
        clip: chatRect,
        viewport: {
          width: Math.max(1, Math.round(chatRect.width)),
          height: Math.max(1, Math.round(chatRect.height))
        },
        visible: chatOn,
        z: 50_100
      })
      void window.vanta.syncLayout(items)
    })
  }, [])

  const applyCamera = useCallback(
    (next: Camera) => {
      cameraRef.current = next
      const world = worldRef.current
      if (world) {
        // Imperative transform only — React style must not overwrite this on unrelated re-renders.
        world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`
        world.style.setProperty('--zoom', String(next.zoom))
        world.setAttribute('data-zoom', String(next.zoom))
      }
      syncLayout()
      if (cameraRaf.current != null) window.cancelAnimationFrame(cameraRaf.current)
      cameraRaf.current = window.requestAnimationFrame(() => {
        cameraRaf.current = null
        setCamera({ ...cameraRef.current })
      })
    },
    [syncLayout]
  )

  useEffect(() => {
    void window.vanta.getStatus().then(setStatus)
    const offBrowsers = window.vanta.onBrowsers((next) => {
      setBrowsers((current) =>
        next.map((frame) => {
          const local = current.find((item) => item.id === frame.id)
          return local
            ? { ...frame, x: local.x, y: local.y, width: local.width, height: local.height }
            : frame
        })
      )
    })
    void window.vanta.getBrowsers().then(setBrowsers)
    void window.vanta.getWorkspace().then((workspace) => {
      setCamera(workspace.camera)
      setDesign(workspace.design || [])
      if (workspace.pages?.length) {
        setPages(workspace.pages)
        setActivePageId(workspace.activePageId || workspace.pages[0].id)
      }
    })
    const offStatus = window.vanta.onStatus(setStatus)
    const offLayout = window.vanta.onNeedLayout(() => {
      requestAnimationFrame(() => void syncLayout())
    })
    const offWorkspace = window.vanta.onWorkspace((workspace) => {
      setCamera(workspace.camera)
      setDesign(workspace.design || [])
      if (workspace.pages?.length) {
        setPages(workspace.pages)
        setActivePageId(workspace.activePageId || workspace.pages[0].id)
      }
    })
    const offInspect = window.vanta.onInspect(setInspect)
    const offDesign = window.vanta.onDesign(setDesign)
    const offBuild = window.vanta.onBuild((event: BuildUiEvent) => {
      if (event.type === 'mcp:status') {
        setMcpStatus({ running: event.running, url: event.url, port: event.port })
        return
      }
      if (event.type === 'build:working') {
        setBuildingIds((current) => [...new Set([...current, ...event.nodeIds])])
        return
      }
      if (event.type === 'build:reveal') {
        setRevealIds((current) => [...new Set([...current, ...event.nodeIds])])
        window.setTimeout(() => {
          setRevealIds((current) => current.filter((id) => !event.nodeIds.includes(id)))
        }, 1100)
        return
      }
      if (event.type === 'build:finish') {
        if (event.nodeIds?.length) {
          setBuildingIds((current) => current.filter((id) => !event.nodeIds!.includes(id)))
        } else {
          setBuildingIds([])
        }
        return
      }
      if (event.type === 'ui:open-coding-agent') {
        const agentId = (event.agentId || 'cursor') as CodingAgentId
        setCodingRecents((recents) => {
          const projectName = event.projectName || 'Vanta'
          const stored = rememberCodingAgent(recents, { agentId, projectName })
          setCodingActive(stored.active)
          return stored.recents
        })
        setCodingPopup(false)
        setRail('coding-agents')
        setLeftOpen(true)
        setView('canvas')
        setSwitchMode('design')
      }
      if (event.type === 'ui:set-page') {
        const pageId = event.pageId || DEFAULT_PAGE.id
        setActivePageId(pageId)
        setView('canvas')
      }
    })
    const offAgent = window.vanta.onAgent((event: AgentEvent) => {
      if (event.type === 'text') {
        setChats((current) =>
          current.map((chat) => {
            if (chat.id !== activeChatIdRef.current) return chat
            const last = chat.messages[chat.messages.length - 1]
            if (last?.role === 'assistant') {
              return {
                ...chat,
                messages: [...chat.messages.slice(0, -1), { role: 'assistant', text: last.text + event.text }]
              }
            }
            return { ...chat, messages: [...chat.messages, { role: 'assistant', text: event.text }] }
          })
        )
      }
      if (event.type === 'tool') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === activeChatIdRef.current
              ? { ...chat, messages: [...chat.messages, { role: 'system', text: `${event.name}: ${event.summary}` }] }
              : chat
          )
        )
      }
      if (event.type === 'error') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === activeChatIdRef.current
              ? { ...chat, messages: [...chat.messages, { role: 'system', text: event.message }] }
              : chat
          )
        )
        setAgentBusy(false)
      }
      if (event.type === 'done') {
        setAgentBusy(false)
        const last = historyRef.current
        setChats((current) => {
          const chat = current.find((item) => item.id === activeChatIdRef.current)
          const assistant = chat ? [...chat.messages].reverse().find((item) => item.role === 'assistant') : null
          if (assistant) {
            const next = [...last, { role: 'assistant' as const, text: assistant.text }]
            historyRef.current = next
            if (activeChatIdRef.current) chatHistories.current.set(activeChatIdRef.current, next)
          }
          return current
        })
      }
    })
    void window.vanta.getMcpStatus?.().then(setMcpStatus).catch(() => undefined)
    return () => {
      offBrowsers()
      offStatus()
      offLayout()
      offWorkspace()
      offInspect()
      offAgent()
      offDesign()
      offBuild()
    }
  }, [syncLayout, applyCamera])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.vanta.setCamera(camera)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [camera])

  useEffect(() => {
    void syncLayout()
  }, [camera, browsers, selectedId, view, leftOpen, rightOpen, leftWidth, rightWidth, rail, codingActive, codingPopup, codingFullscreen, syncLayout])

  useEffect(() => {
    if (rail !== 'chat') return
    void window.vanta.openSidebarBrowser(CHAT_BROWSER_ID, CHAT_BROWSER_HOME).then(() => {
      setChatBrowserUrl(CHAT_BROWSER_HOME)
      syncLayout()
    })
  }, [rail, syncLayout])

  useEffect(() => {
    if (selectedId) {
      const hole = holes.current.get(selectedId)
      const box = hole?.parentElement?.getBoundingClientRect()
      setActionAnchor(box && box.width > 2 ? box : null)
      return
    }
    const node = design.find(
      (item) =>
        item.id === designSelectedId &&
        item.type === 'frame' &&
        (item.pageId || DEFAULT_PAGE.id) === activePageId
    )
    const canvas = canvasRef.current
    if (!node || !canvas || view !== 'canvas') {
      setActionAnchor(null)
      return
    }
    const box = worldRectToScreen(
      camera,
      canvas.getBoundingClientRect(),
      node.x,
      node.y,
      Math.max(8, node.width || 8),
      Math.max(8, node.height || 8)
    )
    setActionAnchor(box.width > 2 ? box : null)
  }, [camera, selectedId, design, designSelectedId, activePageId, view, leftOpen, rightOpen, leftWidth, rightWidth])

  useEffect(() => {
    void window.vanta.setInspect(inspectOn && !browserMeasureId ? activeTabId : null)
  }, [inspectOn, activeTabId, browserMeasureId])

  useEffect(() => {
    if (!browserMeasureId) {
      void window.vanta.setMesurer(null, null)
      return
    }
    const frame = browsersRef.current.find((item) => item.id === browserMeasureId)
    const tabId = frame?.activeTabId
    if (!tabId) {
      void window.vanta.setMesurer(null, null)
      return
    }
    void window.vanta.setMesurer(tabId, {
      inspect: browserMeasureInspect,
      xray: browserMeasureXray
    })
  }, [browserMeasureId, browserMeasureInspect, browserMeasureXray, browsers, selectedId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const current = cameraRef.current
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      // Ctrl/Cmd+scroll or trackpad pinch (Chromium reports pinch as ctrl+wheel)
      if (event.ctrlKey || event.metaKey) {
        applyCamera(zoomAt(current, sx, sy, current.zoom * wheelZoomFactor(event.deltaY)))
        return
      }
      const delta = wheelPan(event.deltaX, event.deltaY, event.deltaMode)
      applyCamera({ ...current, x: current.x + delta.x, y: current.y + delta.y })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false, capture: true })
    const observer = new ResizeObserver(() => syncLayout())
    observer.observe(canvas)
    // Seed transform in case React unmounted/remounted the world node
    applyCamera(cameraRef.current)
    return () => {
      canvas.removeEventListener('wheel', onWheel, true)
      observer.disconnect()
    }
  }, [applyCamera, syncLayout, view])

  const fitView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const next = fitFrames(browsersRef.current, canvas.clientWidth, canvas.clientHeight)
    if (next) applyCamera(next)
  }, [applyCamera])

  const zoomBy = (factor: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const current = cameraRef.current
    applyCamera(zoomAt(current, canvas.clientWidth / 2, canvas.clientHeight / 2, current.zoom * factor))
  }

  const zoomTo = (zoom: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    applyCamera(zoomAt(cameraRef.current, canvas.clientWidth / 2, canvas.clientHeight / 2, zoom))
  }

  const openCodingAgent = useCallback(
    (agentId: CodingAgentId, projectName?: string, id?: string) => {
      const fileName = files.find((file) => file.id === activeFileId)?.name || 'Untitled'
      const stored = rememberCodingAgent(codingRecents, {
        agentId,
        projectName: projectName || fileName,
        id
      })
      setCodingActive(stored.active)
      setCodingRecents(stored.recents)
      setCodingPopup(false)
      setRail('coding-agents')
      setLeftOpen(true)
      setView('canvas')
    },
    [activeFileId, codingRecents, files]
  )

  useEffect(() => {
    if (!codingActive) return
    const meta = getCodingAgentMeta(codingActive.agentId)
    void window.vanta.openSidebarBrowser(SIDEBAR_BROWSER_ID, meta.webAppUrl).then(() => syncLayout())
  }, [codingActive, syncLayout])

  useEffect(() => {
    const down = async (event: KeyboardEvent) => {
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || Boolean(target.closest('[contenteditable="true"], .design-text-editor, .text-on-path-input'))))
      if (event.code === 'Space' && !event.repeat && !typing) {
        space.current = true
        setSpaceHeld(true)
        event.preventDefault()
        await window.vanta.setClickThrough(true)
        return
      }
      if (event.key === 'Alt') {
        setAltHeld(true)
      }
      if (typing) return
      if (designRef.current.some((node) => node.editing)) {
        // While editing text, only allow Escape to finish — never tool/layer shortcuts.
        if (event.key === 'Escape') {
          const active = document.activeElement
          if (active instanceof HTMLElement) active.blur()
        }
        return
      }
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key === '0') {
        event.preventDefault()
        zoomTo(1)
      } else if ((meta && event.key === '1') || (event.shiftKey && event.key === '1')) {
        event.preventDefault()
        fitView()
      } else if (meta && (event.key === '=' || event.key === '+')) {
        event.preventDefault()
        zoomBy(1.12)
      } else if (meta && event.key === '-') {
        event.preventDefault()
        zoomBy(1 / 1.12)
      } else if (meta && event.key.toLowerCase() === 't' && selectedRef.current) {
        event.preventDefault()
        const next = await window.vanta.createTab(selectedRef.current)
        setBrowsers((current) => current.map((frame) => (frame.id === next.id ? { ...next, x: frame.x, y: frame.y, width: frame.width, height: frame.height } : frame)))
      } else if (meta && event.key.toLowerCase() === 'w' && selectedRef.current) {
        event.preventDefault()
        const frame = browsersRef.current.find((item) => item.id === selectedRef.current)
        if (!frame) return
        if (frame.tabs.length <= 1) {
          holes.current.delete(frame.id)
          setBrowsers((current) => current.filter((item) => item.id !== frame.id))
          setSelectedId(null)
          void window.vanta.closeBrowser(frame.id)
        } else {
          void window.vanta.closeTab(frame.id, frame.activeTabId)
        }
      } else if (meta && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        void navigator.clipboard.writeText('vanta://file/' + (activeFile?.id || 'untitled')).catch(() => undefined)
      } else if (!meta && event.key.toLowerCase() === 'h' && !event.repeat) {
        setTool((current) => (current === 'hand' ? 'pointer' : 'hand'))
        setHandMode(false)
      } else if (!meta && event.key.toLowerCase() === 'k' && !event.repeat) {
        setTool((current) => (current === 'scale' ? 'pointer' : 'scale'))
        setHandMode(false)
      } else if (!meta && event.key === 'Escape') {
        if (contextMenuRef.current) {
          setContextMenu(null)
          contextMenuRef.current = null
          return
        }
        if (codingFullscreenRef.current) {
          setCodingFullscreen(false)
          return
        }
        const drafting = designRef.current.find((node) => node.type === 'comment' && node.drafting)
        if (drafting || activeCommentIdRef.current) {
          if (drafting) {
            persistDesign(designRef.current.filter((node) => node.id !== drafting.id))
          }
          setActiveCommentId(null)
          setCommentDraftText('')
          return
        }
        if (designSelectedRef.current.length) {
          const id = designSelectedRef.current[designSelectedRef.current.length - 1]
          const node = designRef.current.find((item) => item.id === id)
          if (node?.parentId) {
            event.preventDefault()
            setDesignSelectedIds([node.parentId])
            return
          }
          setDesignSelectedIds([])
          setTool('pointer')
          setDraft(null)
          drawRef.current = null
          setPenHover(null)
          return
        }
        setTool('pointer')
        setDraft(null)
        drawRef.current = null
        setPenHover(null)
      } else if (!meta && event.key === 'Enter' && draftRef.current?.pathTool === 'pen') {
        event.preventDefault()
        const current = draftRef.current
        drawRef.current = null
        setDraft(null)
        setPenHover(null)
        if (current && (current.points?.length || 0) >= 2) {
          persistDesign([...designRef.current, current])
          setDesignSelectedIds([current.id])
        }
      } else if (!meta && event.key === 'Enter' && designSelectedRef.current.length) {
        event.preventDefault()
        selectChildrenOfSelection()
      } else if (!meta && event.key.toLowerCase() === 'v') {
        setTool('pointer')
      } else if (!meta && event.key.toLowerCase() === 'f' && !event.shiftKey) {
        setTool('frame')
        setRightOpen(true)
      } else if (!meta && event.code === 'KeyA' && event.shiftKey) {
        event.preventDefault()
        const ids = designSelectedRef.current
        if (!ids.length) return
        if (event.altKey) {
          removeFlexSelected()
          return
        }
        wrapFlexSelected()
      } else if (!meta && event.key.toLowerCase() === 'f' && event.shiftKey) {
        event.preventDefault()
        if (designSelectedRef.current.length) frameSelected()
      } else if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if (meta && event.key.toLowerCase() === 'c' && !event.altKey && !event.shiftKey) {
        if (designSelectedRef.current.length) {
          event.preventDefault()
          copySelection()
        }
      } else if (meta && event.key.toLowerCase() === 'v' && event.shiftKey) {
        event.preventDefault()
        pasteClipboard('on-top')
      } else if (meta && event.key.toLowerCase() === 'r' && event.shiftKey) {
        event.preventDefault()
        pasteClipboard('replace')
      } else if (meta && event.key.toLowerCase() === 'v' && !event.altKey && !event.shiftKey) {
        if (designClipboard.current?.length) {
          event.preventDefault()
          pasteClipboard('default')
        }
      } else if (meta && event.key.toLowerCase() === 'c' && event.altKey) {
        event.preventDefault()
        copyStylesFromSelection()
      } else if (meta && event.key.toLowerCase() === 'v' && event.altKey) {
        event.preventDefault()
        pasteStylesToSelection()
      } else if (!meta && event.key.toLowerCase() === 's' && event.shiftKey) {
        setTool('section')
      } else if (!meta && event.key.toLowerCase() === 'b') {
        setTool('browser')
        setRightOpen(true)
      } else if (!meta && event.key.toLowerCase() === 'r') {
        setShapeKind('rect')
        setTool('shape')
      } else if (!meta && event.key.toLowerCase() === 'p') {
        setTool(event.shiftKey ? 'pencil' : 'pen')
      } else if (!meta && event.key.toLowerCase() === 't') {
        setTool(event.shiftKey ? 'text-on-path' : 'text')
      } else if (!meta && event.key.toLowerCase() === 'c') {
        setTool('comment')
      } else if (!meta && event.key.toLowerCase() === 'm' && !event.shiftKey) {
        setTool('measure')
      } else if (!meta && event.key.toLowerCase() === 'o') {
        setShapeKind('ellipse')
        setTool('shape')
      } else if (!meta && event.key.toLowerCase() === 'l') {
        setShapeKind(event.shiftKey ? 'arrow' : 'line')
        setTool('shape')
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && designSelectedRef.current.length) {
        event.preventDefault()
        const selected = new Set(designSelectedRef.current)
        const keepChildren = meta
        if (keepChildren) {
          persistDesign(
            designRef.current
              .filter((node) => !selected.has(node.id))
              .map((node) => (node.parentId && selected.has(node.parentId) ? { ...node, parentId: null } : node))
          )
        } else {
          let ids = new Set(selected)
          let changed = true
          while (changed) {
            changed = false
            for (const node of designRef.current) {
              if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
                ids.add(node.id)
                changed = true
              }
            }
          }
          persistDesign(designRef.current.filter((node) => !ids.has(node.id)))
        }
        setDesignSelectedIds([])
      }
    }
    const up = async (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false)
      if (event.code !== 'Space') return
      space.current = false
      setSpaceHeld(false)
      if (!pan.current) await window.vanta.setClickThrough(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [fitView])

  const addBrowser = async (input?: { url?: string; x?: number; y?: number; width?: number; height?: number }) => {
    const canvas = canvasRef.current
    const rect = canvas?.getBoundingClientRect()
    const current = cameraRef.current
    const origin = rect ? screenToWorld(current, 80, 80) : { x: 80, y: 80 }
    const width = input?.width
      ? Math.round(input.width)
      : rect
        ? Math.round(Math.max(MIN_VIEWPORT.width, Math.min(DEFAULT_VIEWPORT.width, (rect.width / current.zoom) * 0.62)))
        : DEFAULT_VIEWPORT.width
    const height = input?.height
      ? Math.round(input.height)
      : rect
        ? Math.round(Math.max(MIN_VIEWPORT.height, Math.min(DEFAULT_VIEWPORT.height, (rect.height / current.zoom) * 0.58)))
        : DEFAULT_VIEWPORT.height
    const offset = input?.x == null ? browsersRef.current.length * 40 : 0
    const x = Math.round(input?.x ?? origin.x + offset)
    const y = Math.round(input?.y ?? origin.y + offset)
    const created = await window.vanta.createBrowser({
      url: input?.url,
      x,
      y,
      width,
      height
    })
    setBrowsers((currentFrames) => [
      ...currentFrames.filter((item) => item.id !== created.id),
      { ...created, x, y, width, height }
    ])
    setSelectedId(created.id)
    setDesignSelectedIds([])
    await window.vanta.updateFrame({ id: created.id, x, y, width, height })
    return created
  }

  const patchFrame = (id: string, patch: Partial<Frame>) => {
    setBrowsers((current) => current.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)))
    void window.vanta.updateFrame({ id, ...patch })
  }

  const chooseTool = (next: DesignTool) => {
    if (toolRef.current === 'pen' && next !== 'pen') finishPen()
    setTool(next)
    setHandMode(false)
    setPenHover(null)
    setPathHoverId(null)
    setDrawCursor(null)
    if (next !== 'measure') setMeasureHoverId(null)
    if (next !== 'pointer' && next !== 'hand' && next !== 'scale' && next !== 'measure') {
      if (next === 'pen' || next === 'pencil' || next === 'brush') setSwitchMode('draw')
      setInspectOn(false)
    }
    if (next === 'frame' || next === 'browser' || next === 'comment') {
      setRightOpen(true)
    }
    if (next !== 'comment') {
      setCommentCursor(null)
      const drafting = designRef.current.find((node) => node.type === 'comment' && node.drafting)
      if (drafting) {
        persistDesign(designRef.current.filter((node) => node.id !== drafting.id))
        if (activeCommentId === drafting.id) setActiveCommentId(null)
        setCommentDraftText('')
      }
    }
  }

  const spawnFramePreset = (preset: FramePreset) => {
    const canvas = canvasRef.current
    const cam = cameraRef.current
    const center = canvas
      ? screenToWorld(cam, canvas.clientWidth / 2, canvas.clientHeight / 2)
      : { x: 120, y: 120 }
    const id = crypto.randomUUID()
    const sameName = designRef.current.filter(
      (node) =>
        node.type === 'frame' &&
        (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
        (node.name === preset.name || node.name?.startsWith(`${preset.name} -`))
    ).length
    const name = `${preset.name} - ${sameName + 1}`
    const node: DesignNode = {
      id,
      type: 'frame',
      x: Math.round(center.x - preset.width / 2),
      y: Math.round(center.y - preset.height / 2),
      width: preset.width,
      height: preset.height,
      name,
      pageId: activePageRef.current,
      fill: '#FFFFFF',
      clipsContent: true,
      layout: defaultFrameLayout()
    }
    persistDesign([...designRef.current, node])
    setDesignSelectedIds([id])
    setSelectedId(null)
  }

  const spawnBrowserPreset = (preset: FramePreset) => {
    const canvas = canvasRef.current
    const cam = cameraRef.current
    const center = canvas
      ? screenToWorld(cam, canvas.clientWidth / 2, canvas.clientHeight / 2)
      : { x: 120, y: 120 }
    void addBrowser({
      x: Math.round(center.x - preset.width / 2),
      y: Math.round(center.y - preset.height / 2),
      width: preset.width,
      height: preset.height
    })
  }

  const openCommentThread = (id: string) => {
    setActiveCommentId(id)
    setDesignSelectedIds([id])
    setSelectedId(null)
    setCommentDraftText('')
    persistDesign(
      designRef.current.map((node) => (node.id === id ? { ...node, unread: false } : node))
    )
  }

  const resolveComment = (id: string) => {
    persistDesign(designRef.current.map((node) => (node.id === id ? { ...node, resolved: true, unread: false } : node)))
    if (activeCommentId === id) setActiveCommentId(null)
    setResolveToastId(id)
  }

  const chooseMode = (next: SwitchMode) => {
    setSwitchMode(next)
    setInspectOn(false)
    if (next === 'chat') {
      setTool('pointer')
      setHandMode(false)
      window.setTimeout(() => {
        setView('canvas')
        setRail('chat')
        setLeftOpen(true)
        setRightOpen(true)
        setRightWidth((width) => Math.max(width, 420))
      }, 220)
      return
    }
    if (rail === 'chat') {
      setRail('file')
      setRightWidth((width) => Math.min(width, 280))
    }
    if (next === 'draw') {
      if (toolRef.current === 'pointer' || toolRef.current === 'hand' || toolRef.current === 'scale') {
        setTool('pen')
      }
      return
    }
    if (next === 'design') {
      if (toolRef.current === 'pen' || toolRef.current === 'pencil' || toolRef.current === 'brush') {
        setTool('pointer')
      }
    }
  }

  const finishPen = () => {
    const current = draftRef.current
    drawRef.current = null
    setDraft(null)
    setPenHover(null)
    if (!current || current.pathTool !== 'pen' || (current.points?.length || 0) < 2) return
    persistDesign([...designRef.current, current])
    setDesignSelectedIds([current.id])
  }

  const commitDraw = () => {
    const gesture = drawRef.current
    const current = draftRef.current
    if (gesture?.kind === 'pen') return
    drawRef.current = null
    setDraft(null)
    if (!gesture || !current) return
    if (gesture.kind === 'text') {
      const fontSize = current.fontSize || 12
      const measured = measurePlainText('', current.fontFamily || 'Inter', current.fontWeight || 400, fontSize)
      const dragged =
        Math.abs((current.x || 0) - gesture.startX) > 2 ||
        Math.abs((current.y || 0) - gesture.startY) > 2 ||
        (current.width || 0) > measured.width + 12 ||
        (current.height || 0) > measured.height + 8
      const node: DesignNode = dragged
        ? {
            ...current,
            width: Math.max(40, current.width || 40),
            height: Math.max(measured.height, current.height || measured.height),
            textResize: 'fixed',
            editing: true
          }
        : {
            ...current,
            x: gesture.startX,
            y: gesture.startY,
            width: measured.width,
            height: measured.height,
            textResize: 'auto-width',
            editing: true
          }
      persistDesign([...designRef.current, attachToParent(node, designRef.current)])
      setDesignSelectedIds([node.id])
      return
    }
    if (gesture.type === 'line' || gesture.type === 'arrow') {
      const length = Math.hypot(current.width || 0, current.height || 0)
      if (length < 8) return
    } else if (gesture.kind === 'box' && Math.min(current.width || 0, current.height || 0) < 8) return
    if (gesture.kind === 'path' && (current.points?.length || 0) < 2) return

    let next = [...designRef.current]
    if (current.type === 'section') {
      const box = {
        x: current.x,
        y: current.y,
        width: Math.max(1, current.width || 1),
        height: Math.max(1, current.height || 1)
      }
      next = next.map((node) => {
        if ((node.pageId || DEFAULT_PAGE.id) !== (current.pageId || DEFAULT_PAGE.id)) return node
        if (node.parentId) return node
        const child = resolveWorldRect(node, next)
        const inside =
          child.x >= box.x - 0.5 &&
          child.y >= box.y - 0.5 &&
          child.x + child.width <= box.x + box.width + 0.5 &&
          child.y + child.height <= box.y + box.height + 0.5
        if (!inside) return node
        return {
          ...node,
          parentId: current.id,
          x: child.x - box.x,
          y: child.y - box.y
        }
      })
      // Section first so it paints under contained nodes.
      next = [current, ...next]
    } else {
      const placed = attachToParent(current, next)
      next = [...next, placed]
    }

    persistDesign(next)
    setDesignSelectedIds([current.id])
    if (gesture.kind === 'box') setTool('pointer')
  }

  const startDesign = (event: ReactPointerEvent<HTMLDivElement>) => {
    const currentTool = toolRef.current
    if (currentTool === 'pointer' || currentTool === 'hand' || currentTool === 'scale') return
    const point = worldFromEvent(event)
    if (currentTool === 'browser') {
      void addBrowser({ x: point.x, y: point.y })
      setTool('pointer')
      return
    }
    const id = crypto.randomUUID()
    if (currentTool === 'text' || currentTool === 'text-on-path' || currentTool === 'comment' || currentTool === 'widget') {
      if (currentTool === 'comment') {
        const drafting = designRef.current.find((node) => node.type === 'comment' && node.drafting)
        const withoutDraft = drafting ? designRef.current.filter((node) => node.id !== drafting.id) : designRef.current
        const node: DesignNode = {
          id,
          type: 'comment',
          x: point.x,
          y: point.y,
          pageId: activePageRef.current,
          drafting: true,
          commentNumber: nextCommentNumber(withoutDraft),
          messages: [],
          unread: true
        }
        persistDesign([...withoutDraft, node])
        setDesignSelectedIds([id])
        setSelectedId(null)
        setActiveCommentId(id)
        setCommentDraftText('')
        setRightOpen(true)
        return
      }
      if (currentTool === 'widget') {
        const node: DesignNode = {
          id,
          type: 'widget',
          x: point.x,
          y: point.y,
          width: 220,
          height: 140,
          name: 'Widget',
          pageId: activePageRef.current,
          fill: '#F4F0FF'
        }
        persistDesign([...designRef.current, attachToParent(node, designRef.current)])
        setDesignSelectedIds([id])
        return
      }
      const pathTarget =
        currentTool === 'text-on-path' || currentTool === 'text'
          ? findTextPathTarget(
              point,
              designRef.current.filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
            )
          : null
      // Text on path tool requires a path. Text tool only places on a path while hovering it.
      const placeOnPath =
        Boolean(pathTarget) &&
        (currentTool === 'text-on-path' || (currentTool === 'text' && pathHoverId === pathTarget?.id))
      if (placeOnPath) {
        if (!pathTarget) return
        const geom = pathPointsFromNode(pathTarget)
        if (!geom) return
        const box = nodeBounds(pathTarget)
        const offset = offsetAlongPath(point, geom.points, geom.closed)
        const node: DesignNode = {
          id,
          type: 'text',
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          points: geom.points,
          closed: geom.closed,
          text: '',
          name: 'Text',
          pageId: activePageRef.current,
          fill: pathTarget.fill && pathTarget.type !== 'path' ? pathTarget.fill : '#000000',
          fontFamily: 'Inter',
          fontSize: 12,
          fontWeight: 400,
          textPathOffset: offset,
          textPathFlip: false,
          editing: true
        }
        const withoutHost = designRef.current.filter((item) => item.id !== pathTarget.id)
        persistDesign([...withoutHost, node])
        setDesignSelectedIds([id])
        setPathHoverId(null)
        return
      }
      if (currentTool === 'text-on-path') return

      // Figma Text tool: click = point text, drag = text box
      const fontSize = 12
      const measured = measurePlainText('', 'Inter', 400, fontSize)
      drawRef.current = { id, kind: 'text', type: 'text', startX: point.x, startY: point.y }
      setDraft({
        id,
        type: 'text',
        x: point.x,
        y: point.y,
        width: measured.width,
        height: measured.height,
        text: '',
        name: 'Text',
        pageId: activePageRef.current,
        fill: '#000000',
        fontFamily: 'Inter',
        fontSize,
        fontWeight: 400,
        textResize: 'auto-width',
        editing: false
      })
      setDesignSelectedIds([id])
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (currentTool === 'pen' || currentTool === 'pencil' || currentTool === 'brush') {
      startDrawPath(event, currentTool, id, point)
      return
    }
    const type: DesignNode['type'] =
      currentTool === 'shape' ? shapeRef.current : currentTool === 'section' ? 'section' : 'frame'
    const count = designRef.current.filter((node) => node.type === type).length + 1
    const name =
      type === 'frame' ? 'New frame name' : type === 'section' ? `Section ${count}` : `${type[0].toUpperCase()}${type.slice(1)} ${count}`
    drawRef.current = { id, kind: 'box', type, startX: point.x, startY: point.y }
    setDraft({
      id,
      type,
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      name,
      pageId: activePageRef.current,
      fill: type === 'section' || type === 'frame' ? '#FFFFFF' : type === 'rect' ? '#DDDDDD' : '#D9D9D9',
      fillOpacity: 1,
      opacity: 1,
      radius: type === 'section' ? 2 : 0,
      stroke: type === 'section' ? '#000000' : undefined,
      strokeWidth: type === 'section' ? 1 : undefined,
      strokeOpacity: type === 'section' ? 0.1 : undefined,
      clipsContent: type === 'frame' ? true : undefined,
      points: type === 'line' || type === 'arrow' ? [point, point] : undefined
    })
    setDesignSelectedIds([id])
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const startDrawPath = (
    event: ReactPointerEvent<HTMLDivElement>,
    pathTool: 'pen' | 'pencil' | 'brush',
    id: string,
    point: PathPoint
  ) => {
    const stroke = strokeRef.current
    const weight = pathTool === 'brush' ? stroke.brushWeight : pathTool === 'pencil' ? stroke.pencilWeight : 2
    const style = pathTool === 'brush' ? stroke.brushStyle : pathTool === 'pencil' ? stroke.pencilStyle : 'basic'
    if (pathTool === 'pen' && draftRef.current?.pathTool === 'pen' && drawRef.current?.kind === 'pen') {
      const current = draftRef.current
      const points = current.points || []
      const last = points[points.length - 1]
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2 / cameraRef.current.zoom) return
      const first = points[0]
      if (first && points.length >= 2 && Math.hypot(point.x - first.x, point.y - first.y) < 10 / cameraRef.current.zoom) {
        persistDesign([...designRef.current, { ...current, closed: true }])
        setDesignSelectedIds([current.id])
        setDraft(null)
        drawRef.current = null
        setPenHover(null)
        return
      }
      penDrag.current = { x: event.clientX, y: event.clientY, worldX: point.x, worldY: point.y }
      setDraft({ ...current, points: [...points, point] })
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    drawRef.current = { id, kind: pathTool === 'pen' ? 'pen' : 'path', type: 'path', startX: point.x, startY: point.y }
    setDraft({
      id,
      type: 'path',
      x: point.x,
      y: point.y,
      points: [point],
      pageId: activePageRef.current,
      pathTool,
      brushStyle: style,
      stroke: stroke.color,
      strokeWidth: weight
    })
    setDesignSelectedIds([id])
    if (pathTool === 'pen') {
      penDrag.current = { x: event.clientX, y: event.clientY, worldX: point.x, worldY: point.y }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const sendChat = async () => {
    const text = chatInput.trim()
    if (!text || agentBusy || !activeChat) return
    if (rail !== 'chat') {
      setSwitchMode('chat')
      setRail('chat')
      setLeftOpen(true)
      setRightOpen(true)
      setRightWidth((width) => Math.max(width, 420))
    }
    setChatInput('')
    const chatId = activeChat.id
    const titled = activeChat.title === 'New chat' ? text.slice(0, 42) : activeChat.title
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? { ...chat, title: titled, messages: [...chat.messages, { role: 'user', text }] }
          : chat
      )
    )
    const nextHistory = [...(chatHistories.current.get(chatId) || historyRef.current), { role: 'user' as const, text }]
    chatHistories.current.set(chatId, nextHistory)
    historyRef.current = nextHistory
    setAgentBusy(true)
    try {
      await window.vanta.runAgent(nextHistory)
    } catch (error) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages, { role: 'system', text: error instanceof Error ? error.message : String(error) }]
              }
            : chat
        )
      )
      setAgentBusy(false)
    }
  }

  const selectChat = (id: string) => {
    if (resolvedChatId) chatHistories.current.set(resolvedChatId, historyRef.current)
    setActiveChatId(id)
    historyRef.current = chatHistories.current.get(id) || []
    setChatInput('')
  }

  const newChat = () => {
    if (resolvedChatId) chatHistories.current.set(resolvedChatId, historyRef.current)
    const session = createChatSession()
    setChats((current) => [session, ...current])
    setActiveChatId(session.id)
    historyRef.current = []
    chatHistories.current.set(session.id, [])
    setChatInput('')
  }

  const beginPan = async (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setPanning(true)
    await window.vanta.setClickThrough(true)
    pan.current = { x: event.clientX, y: event.clientY, camX: camera.x, camY: camera.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const openFile = (id: string) => {
    setActiveFileId(id)
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, editedAt: Date.now() } : file)))
    setView('canvas')
  }

  const addFile = (name?: string) => {
    const id = crypto.randomUUID()
    const nextName = name?.trim() || `File ${files.length + 1}`
    setFiles((current) => [...current, { id, name: nextName.slice(0, 48), editedAt: Date.now() }])
    setActiveFileId(id)
    setView('canvas')
  }

  const closeFile = (id: string) => {
    setFiles((current) => {
      const next = current.filter((file) => file.id !== id)
      const remaining = next.length ? next : [{ id: crypto.randomUUID(), name: 'Untitled', editedAt: Date.now() }]
      const fallback = remaining.find((file) => file.id === activeFileId) || remaining[0]
      setActiveFileId(fallback.id)
      setView('canvas')
      return remaining
    })
  }

  const selectedDesignFrame =
    designSelectedIds.length === 1
      ? pageNodes.find((node) => node.id === designSelectedId && node.type === 'frame') || null
      : null
  const selectedNode = pageNodes.find((node) => node.id === designSelectedId) || null
  const measurePrimary =
    (tool === 'measure' || altHeld) && designSelectedId
      ? pageNodes.find((node) => node.id === designSelectedId) || null
      : null
  const measureTarget =
    measurePrimary && measureHoverId && measureHoverId !== measurePrimary.id
      ? pageNodes.find((node) => node.id === measureHoverId) || null
      : null
  const measureLines = measurePrimary
    ? measureTarget
      ? distanceMeasurements(nodeBounds(measurePrimary), nodeBounds(measureTarget))
      : tool === 'measure'
        ? sizeMeasurements(nodeBounds(measurePrimary))
        : []
    : []
  const measureSelectedRect = measurePrimary ? nodeBounds(measurePrimary) : null
  const measureHoverRect = measureTarget ? nodeBounds(measureTarget) : null
  const activePage = pages.find((page) => page.id === activePageId) || pages[0] || DEFAULT_PAGE
  const pageFill = activePage.fill?.trim() || ''
  const customCanvasFill =
    pageFill && !/^#(?:eee(?:eee)?|2c2c2c)$/i.test(pageFill) ? pageFill : null
  const selectedTab = selected?.tabs.find((tab) => tab.id === selected.activeTabId) || selected?.tabs[0]
  const actionBar = selected
    ? {
        id: selected.id,
        width: selected.width,
        height: selected.height,
        title: selectedTab?.title?.trim() || (selectedTab?.url === 'about:blank' ? 'New tab' : 'Untitled'),
        offset: 52,
        showDevice: true,
        sizeCatalog: 'browser' as const,
        renameable: false,
        onRename: undefined as undefined | ((name: string) => void),
        onConvert: () => {
          void convertBrowserToDesign(selected.id)
        },
        onResize: (size: { width: number; height: number; name?: string }) =>
          patchFrame(selected.id, { width: size.width, height: size.height })
      }
    : selectedDesignFrame
      ? {
          id: selectedDesignFrame.id,
          width: Math.round(selectedDesignFrame.width || 0),
          height: Math.round(selectedDesignFrame.height || 0),
          title: selectedDesignFrame.name || 'New frame name',
          offset: 52,
          showDevice: true,
          sizeCatalog: 'all' as const,
          renameable: true,
          onRename: (name: string) => {
            persistDesign(
              designRef.current.map((node) => (node.id === selectedDesignFrame.id ? { ...node, name } : node))
            )
          },
          onConvert: undefined as undefined | (() => void),
          onResize: (size: { width: number; height: number; name?: string }) => {
            const baseName = size.name
            let nextName = selectedDesignFrame.name
            if (baseName) {
              const siblings = designRef.current.filter(
                (node) =>
                  node.id !== selectedDesignFrame.id &&
                  node.type === 'frame' &&
                  (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                  (node.name === baseName || node.name?.startsWith(`${baseName} -`))
              ).length
              nextName = `${baseName} - ${siblings + 1}`
            }
            persistDesign(
              designRef.current.map((node) =>
                node.id === selectedDesignFrame.id
                  ? { ...node, width: size.width, height: size.height, name: nextName }
                  : node
              )
            )
          }
        }
      : null

  return (
    <div className="app" data-theme={theme}>
      {mcpStatus?.running && (
        <div className="mcp-status-pill" title="Connect Cursor / Claude Code to this URL">
          <span className="mcp-status-dot" />
          <strong>MCP live</strong>
          <code>{mcpStatus.url}</code>
        </div>
      )}
      <FileTabs
        files={files}
        activeId={view === 'home' ? '' : activeFileId}
        onHome={() => {
          setCodingFullscreen(false)
          setView('home')
        }}
        onSelect={openFile}
        onClose={closeFile}
        onNew={addFile}
        onRename={(id, name) => setFiles((current) => current.map((file) => (file.id === id ? { ...file, name } : file)))}
      />
      <div className="workspace">
        {view !== 'home' && (
        <LeftSidebar
          tab={rail}
          onTab={(next) => {
            setRail(next)
            setView('canvas')
            if (next !== 'coding-agents') setCodingFullscreen(false)
            if (next === 'chat') {
              setSwitchMode('chat')
              setLeftOpen(true)
              setRightOpen(true)
              setRightWidth((width) => Math.max(width, 420))
            } else if (rail === 'chat') {
              setSwitchMode((current) => (current === 'chat' ? 'design' : current))
              setRightWidth((width) => Math.min(width, 280))
            }
          }}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          fileName={activeFile?.name || 'Untitled'}
          browsers={browsers}
          onAddBrowser={() => void addBrowser()}
          onFocusWindow={(id) => {
            setSelectedId(id)
            const frame = browsers.find((item) => item.id === id)
            if (frame) void window.vanta.focus(frame.activeTabId)
          }}
          onActivateTab={(windowId, tabId) => {
            setSelectedId(windowId)
            patchFrame(windowId, { activeTabId: tabId })
            void window.vanta.activateTab(windowId, tabId)
          }}
          onCloseTab={(windowId, tabId) => {
            void window.vanta.closeTab(windowId, tabId)
          }}
          chats={chats.map((chat) => ({ id: chat.id, title: chat.title }))}
          activeChatId={resolvedChatId}
          onSelectChat={selectChat}
          onNewChat={newChat}
          pages={pages}
          activePageId={activePageId}
          pageQuery={pageQuery}
          onPageQuery={setPageQuery}
          onSelectPage={(id) => persistPages(pages, id)}
          onAddPage={() => {
            const page = { id: crypto.randomUUID(), name: `Page ${pages.length + 1}` }
            persistPages([...pages, page], page.id)
          }}
          onRenamePage={(id, name) => persistPages(pages.map((page) => (page.id === id ? { ...page, name } : page)))}
          layers={layers}
          onSelectLayer={(id, kind) => {
            if (kind === 'browser') {
              setDesignSelectedIds([])
              setSelectedId(id)
              const frame = browsers.find((item) => item.id === id)
              if (frame) void window.vanta.focus(frame.activeTabId)
              return
            }
            if (kind === 'comment') {
              openCommentThread(id)
              return
            }
            setActiveCommentId(null)
            setSelectedId(null)
            setDesignSelectedIds([id])
          }}
          onRenameLayer={(id, name) => {
            persistDesign(designRef.current.map((node) => (node.id === id ? { ...node, name } : node)))
          }}
          panelOpen={leftOpen}
          panelWidth={leftWidth}
          onTogglePanel={() => setLeftOpen((value) => !value)}
          onResizePanel={setLeftWidth}
          codingActive={codingActive}
          codingRecents={codingRecents}
          codingPopup={codingPopup}
          codingFullscreen={codingFullscreen}
          onCodingPopup={(open) => {
            setCodingPopup(open)
            if (open) setCodingFullscreen(false)
          }}
          onCodingChoose={(agentId) => openCodingAgent(agentId)}
          onCodingResume={(id) => {
            const found = codingRecents.find((item) => item.id === id)
            if (found) openCodingAgent(found.agentId, found.projectName, found.id)
          }}
          onCodingFullscreen={() => {
            setCodingPopup(false)
            setCodingFullscreen((value) => !value)
          }}
          onAgentHole={(el) => {
            agentHole.current = el
            syncLayout()
          }}
        />
        )}
        {view === 'home' ? (
          <HomeScreen
            files={files}
            onOpen={openFile}
            onNew={() => addFile()}
            onCreateFromPrompt={(prompt) => {
              const title = prompt.split(/[.!?]/)[0]?.trim() || 'Untitled'
              addFile(title)
              setChatInput(prompt)
            }}
          />
        ) : rail === 'chat' ? (
          <ChatWorkspace
            messages={chatLog}
            input={chatInput}
            onInput={setChatInput}
            onSend={() => void sendChat()}
            busy={agentBusy}
            mode="chat"
            onMode={chooseMode}
          />
        ) : (
          <div
            ref={canvasRef}
            className={`canvas${panning ? ' is-panning' : ''}${tool === 'hand' || handMode || spaceHeld ? ' is-hand' : ''}${['frame', 'section', 'browser', 'shape', 'pen', 'pencil', 'brush', 'text', 'text-on-path', 'comment', 'widget'].includes(tool) ? ' is-design' : ''}${pathHoverId && (tool === 'text' || tool === 'text-on-path') ? ' is-text-path' : ''}`}
            data-tool={tool}
            style={customCanvasFill ? { background: customCanvasFill } : undefined}
            onContextMenu={(event) => {
              if (view !== 'canvas') return
              const target = event.target as HTMLElement
              if (target.closest('.canvas-toolbar-stack, .canvas-toolbar, .draw-stroke-bar, .ctx-menu')) return
              openContextMenu(event, worldFromEvent(event))
            }}
            onPointerDown={async (event) => {
              const middle = event.button === 1
              const spacePan = event.button === 0 && space.current
              const handPan = event.button === 0 && (handMode || toolRef.current === 'hand')
              if (middle || spacePan || handPan) {
                await beginPan(event)
                return
              }
              if (event.button !== 0) return
              const target = event.target as HTMLElement
              if (target.closest('.canvas-toolbar-stack, .canvas-toolbar, .draw-stroke-bar, .comment-overlay-card, .comment-emoji-picker, .comment-mention-menu, .comment-toast')) {
                return
              }
              if (toolRef.current === 'comment') {
                if (target.closest('.design-comment')) return
                setSelectedId(null)
                startDesign(event)
                return
              }
              const textPathTool = toolRef.current === 'text' || toolRef.current === 'text-on-path'
              if (textPathTool && target.closest('.design-shape, .design-frame, .design-rect, .draw-path, .draw-pen-stroke, .draw-brush-fill, .draw-select-stroke')) {
                setSelectedId(null)
                startDesign(event)
                return
              }
              if (target.closest('.frame, .design-frame, .design-shape, .design-text, .design-comment, .design-widget, .text-on-path')) {
                return
              }
              if (toolRef.current === 'hand' || toolRef.current === 'scale' || toolRef.current === 'measure') {
                setSelectedId(null)
                if (toolRef.current === 'measure') setDesignSelectedIds([])
                else setDesignSelectedIds([])
                setMeasureHoverId(null)
                return
              }
              if (toolRef.current !== 'pointer') {
                setSelectedId(null)
                startDesign(event)
                return
              }
              if (activeCommentIdRef.current) {
                const drafting = designRef.current.find((node) => node.type === 'comment' && node.drafting)
                if (drafting) persistDesign(designRef.current.filter((node) => node.id !== drafting.id))
                setActiveCommentId(null)
                setCommentDraftText('')
              }
              setSelectedId(null)
              if (!event.shiftKey) setDesignSelectedIds([])
              if (switchMode !== 'chat') setInspectOn(false)
              const canvas = canvasRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              marquee.current = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                shift: event.shiftKey,
                baseIds: event.shiftKey ? [...designSelectedRef.current] : []
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const canvas = canvasRef.current
              if (canvas && !pan.current) {
                const rect = canvas.getBoundingClientRect()
                const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
                if (toolRef.current === 'comment') setCommentCursor(screen)
                if (toolRef.current === 'pencil' || toolRef.current === 'brush') setDrawCursor(screen)
                else setDrawCursor(null)
                if (toolRef.current === 'measure' || altHeld) {
                  const point = worldFromEvent(event)
                  const candidates = designRef.current
                    .filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
                    .filter((node) => node.type !== 'comment' || !node.resolved)
                    .map((node) => ({ id: node.id, rect: nodeBounds(node) }))
                  const hit = hitTestRect(candidates, point)
                  setMeasureHoverId(hit)
                } else if (measureHoverId) {
                  setMeasureHoverId(null)
                }
              }
              if (pan.current) {
                applyCamera({
                  ...cameraRef.current,
                  x: pan.current.camX + (event.clientX - pan.current.x),
                  y: pan.current.camY + (event.clientY - pan.current.y)
                })
                return
              }
              if (marquee.current && canvasRef.current) {
                const start = marquee.current
                const rect = canvasRef.current.getBoundingClientRect()
                const x = event.clientX - rect.left
                const y = event.clientY - rect.top
                const left = Math.min(start.x, x)
                const top = Math.min(start.y, y)
                const width = Math.abs(x - start.x)
                const height = Math.abs(y - start.y)
                setMarqueeBox({ left, top, width, height })
                if (width > 2 || height > 2) {
                  const hits = marqueeHits({ left, top, width, height }, x < start.x)
                  setDesignSelectedIds(
                    start.shift ? [...new Set([...start.baseIds, ...hits])] : hits
                  )
                } else if (!start.shift) {
                  setDesignSelectedIds([])
                }
                return
              }
              const point = worldFromEvent(event)
              if (toolRef.current === 'text' || toolRef.current === 'text-on-path') {
                const hit = findTextPathTarget(
                  point,
                  designRef.current.filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
                )
                setPathHoverId(hit?.id || null)
              } else if (pathHoverId) {
                setPathHoverId(null)
              }
              if (toolRef.current === 'pen' && drawRef.current?.kind === 'pen' && !penDrag.current) {
                setPenHover(point)
              }
              if (penDrag.current && drawRef.current?.kind === 'pen') {
                const drag = penDrag.current
                const dx = point.x - drag.worldX
                const dy = point.y - drag.worldY
                if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
                  setDraft((current) => {
                    if (!current?.points?.length) return current
                    const points = current.points.slice()
                    const last = points[points.length - 1]
                    points[points.length - 1] = {
                      ...last,
                      outX: last.x + dx,
                      outY: last.y + dy,
                      inX: last.x - dx,
                      inY: last.y - dy
                    }
                    return { ...current, points }
                  })
                }
                return
              }
              const gesture = drawRef.current
              if (!gesture) return
              if (gesture.kind === 'path') {
                setDraft((current) => {
                  if (!current) return current
                  const points = current.points || []
                  const last = points[points.length - 1]
                  if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1.6 / cameraRef.current.zoom) return current
                  return { ...current, points: [...points, point] }
                })
                return
              }
              if (gesture.type === 'line' || gesture.type === 'arrow') {
                setDraft((current) =>
                  current
                    ? {
                        ...current,
                        x: Math.min(gesture.startX, point.x),
                        y: Math.min(gesture.startY, point.y),
                        width: Math.abs(point.x - gesture.startX),
                        height: Math.abs(point.y - gesture.startY),
                        points: [{ x: gesture.startX, y: gesture.startY }, point]
                      }
                    : current
                )
                return
              }
              const x = Math.min(gesture.startX, point.x)
              const y = Math.min(gesture.startY, point.y)
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      x,
                      y,
                      width: Math.abs(point.x - gesture.startX),
                      height: Math.abs(point.y - gesture.startY)
                    }
                  : current
              )
            }}
            onPointerLeave={() => {
              if (toolRef.current === 'comment') setCommentCursor(null)
              setDrawCursor(null)
              setPathHoverId(null)
              if (!penDrag.current) setPenHover(null)
            }}
            onPointerUp={async (event) => {
              if (marquee.current && canvasRef.current) {
                const start = marquee.current
                marquee.current = null
                const rect = canvasRef.current.getBoundingClientRect()
                const x = event.clientX - rect.left
                const y = event.clientY - rect.top
                const left = Math.min(start.x, x)
                const top = Math.min(start.y, y)
                const width = Math.abs(x - start.x)
                const height = Math.abs(y - start.y)
                setMarqueeBox(null)
                if (width > 4 || height > 4) {
                  const hits = marqueeHits({ left, top, width, height }, x < start.x)
                  setDesignSelectedIds(start.shift ? [...new Set([...start.baseIds, ...hits])] : hits)
                } else if (!start.shift) {
                  setDesignSelectedIds([])
                }
              }
              penDrag.current = null
              if (drawRef.current && drawRef.current.kind !== 'pen') commitDraw()
              pan.current = null
              setPanning(false)
              if (!space.current) await window.vanta.setClickThrough(false)
            }}
          >
            {browsers.length === 0 && status.state === 'ready' && (
              <div className="empty">Scroll to pan · Ctrl+scroll zooms · Add a browser from File</div>
            )}
            {status.state === 'error' && <div className="empty error">{status.message}</div>}
            <div
              ref={(node) => {
                worldRef.current = node
                if (node) {
                  const cam = cameraRef.current
                  node.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})`
                  node.style.setProperty('--zoom', String(cam.zoom))
                  node.setAttribute('data-zoom', String(cam.zoom))
                }
              }}
              className="world"
              data-zoom={camera.zoom}
              style={
                {
                  // Transform is owned by applyCamera so hover/selection re-renders can't reset zoom.
                  ['--zoom' as string]: String(camera.zoom)
                } as CSSProperties
              }
            >
              <DesignLayer
                nodes={pageNodes.filter((node) => node.type !== 'comment' || !node.resolved || commentsShowResolved)}
                selectedIds={designSelectedIds}
                tool={tool}
                draft={draft && (draft.pageId || DEFAULT_PAGE.id) === activePageId ? draft : null}
                hoverPoint={tool === 'pen' ? penHover : null}
                pathHoverId={pathHoverId}
                revealId={snapshotRevealId}
                revealIds={revealIds}
                buildingIds={buildingIds}
                onSelect={(id, additive) => {
                  const hit = designRef.current.find((node) => node.id === id)
                  if (hit?.type === 'comment') {
                    openCommentThread(id)
                    return
                  }
                  setActiveCommentId(null)
                  setSelectedId(null)
                  if (toolRef.current === 'measure') {
                    setDesignSelectedIds([id])
                    return
                  }
                  setDesignSelectedIds((current) => {
                    if (additive) return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
                    if (current.includes(id) && current.length > 1) return current
                    return [id]
                  })
                }}
                onMoveStart={(id) => {
                  const seed = new Set(designSelectedRef.current.includes(id) ? designSelectedRef.current : [id])
                  const roots = [...seed].filter((nodeId) => {
                    const node = designRef.current.find((item) => item.id === nodeId)
                    return Boolean(node && (!node.parentId || !seed.has(node.parentId)))
                  })
                  moveStart.current = new Map(
                    roots.flatMap((nodeId) => {
                      const node = designRef.current.find((item) => item.id === nodeId)
                      if (!node) return []
                      const world = resolveWorldRect(node, designRef.current)
                      return [
                        [
                          nodeId,
                          {
                            worldX: world.x,
                            worldY: world.y,
                            localX: node.x,
                            localY: node.y,
                            points: node.points
                          }
                        ] as const
                      ]
                    })
                  )
                }}
                onMove={(id, x, y) => {
                  const start = moveStart.current.get(id)
                  if (!start) {
                    const node = designRef.current.find((item) => item.id === id)
                    if (!node) return
                    if (!node.parentId) {
                      persistDesign(
                        designRef.current.map((item) => (item.id === id ? { ...item, x, y } : item)),
                        { skipReflow: true }
                      )
                      return
                    }
                    const parent = designRef.current.find((item) => item.id === node.parentId)
                    if (!parent) {
                      persistDesign(
                        designRef.current.map((item) => (item.id === id ? { ...item, x, y } : item)),
                        { skipReflow: true }
                      )
                      return
                    }
                    const parentWorld = resolveWorldRect(parent, designRef.current)
                    const rel = toRelative({ x, y }, parentWorld)
                    persistDesign(
                      designRef.current.map((item) => (item.id === id ? { ...item, x: rel.x, y: rel.y } : item)),
                      { skipReflow: true }
                    )
                    return
                  }
                  const dx = x - start.worldX
                  const dy = y - start.worldY
                  persistDesign(
                    designRef.current.map((node) => {
                      const origin = moveStart.current.get(node.id)
                      if (!origin) return node
                      return {
                        ...node,
                        x: origin.localX + dx,
                        y: origin.localY + dy,
                        points: origin.points?.map((point) => ({
                          ...point,
                          x: point.x + dx,
                          y: point.y + dy,
                          inX: point.inX != null ? point.inX + dx : undefined,
                          inY: point.inY != null ? point.inY + dy : undefined,
                          outX: point.outX != null ? point.outX + dx : undefined,
                          outY: point.outY != null ? point.outY + dy : undefined
                        }))
                      }
                    }),
                    { skipReflow: true }
                  )
                }}
                onMoveEnd={(id) => {
                  const seed = new Set(designSelectedRef.current.includes(id) ? designSelectedRef.current : [id])
                  const roots = [...seed].filter((nodeId) => {
                    const node = designRef.current.find((item) => item.id === nodeId)
                    return Boolean(node && (!node.parentId || !seed.has(node.parentId)))
                  })
                  let next = [...designRef.current]
                  for (const rootId of roots) {
                    const exclude = expandWithDescendants(next, new Set([rootId]))
                    const node = next.find((item) => item.id === rootId)
                    if (!node) continue
                    const patched = reparentMovedNode(node, next, exclude)
                    next = next.map((item) => (item.id === rootId ? patched : item))
                    if (patched.parentId) {
                      const parentNode = next.find((item) => item.id === patched.parentId)
                      if (parentNode && isAutoLayout(parentNode)) {
                        next = reorderAutoLayoutChildren(next, patched.parentId)
                      }
                    }
                  }
                  persistDesign(next)
                  moveStart.current = new Map()
                }}
                onResize={(id, next) => {
                  const { world, ...rect } = next
                  persistDesign(
                    designRef.current.map((node) => {
                      if (node.id !== id) return node
                      if (!world || !node.parentId) return { ...node, ...rect }
                      const parent = designRef.current.find((item) => item.id === node.parentId)
                      if (!parent) return { ...node, ...rect }
                      const parentWorld = resolveWorldRect(parent, designRef.current)
                      const rel = toRelative({ x: rect.x, y: rect.y }, parentWorld)
                      return { ...node, x: rel.x, y: rel.y, width: rect.width, height: rect.height }
                    })
                  )
                }}
                onScaleStart={() => {
                  const ids = new Set(designSelectedRef.current)
                  scaleStart.current = designRef.current.filter((node) => ids.has(node.id))
                }}
                onScale={(origin, factor) => {
                  const starts = scaleStart.current
                  persistDesign(
                    designRef.current.map((node) => {
                      const start = starts.find((item) => item.id === node.id)
                      return start ? scaleNodeAround(start, origin.x, origin.y, factor) : node
                    })
                  )
                }}
                onEdit={(id, patch) => {
                  persistDesign(designRef.current.map((node) => (node.id === id ? { ...node, ...patch } : node)))
                }}
                onRemove={(id) => {
                  persistDesign(designRef.current.filter((node) => node.id !== id))
                  setDesignSelectedIds((current) => current.filter((item) => item !== id))
                }}
              />
              {(tool === 'measure' || altHeld) && measureLines.length > 0 && (
                <MeasureOverlay
                  lines={measureLines}
                  zoom={camera.zoom}
                  selectedRect={measureSelectedRect}
                  hoverRect={measureHoverRect}
                />
              )}
              {browsers.map((frame) => (
                <BrowserFrame
                  key={frame.id}
                  frame={frame}
                  selected={selectedId === frame.id}
                  measureActive={browserMeasureId === frame.id}
                  measureInspect={browserMeasureInspect}
                  measureXray={browserMeasureXray}
                  onToggleMeasure={() => {
                    setSelectedId(frame.id)
                    setDesignSelectedIds([])
                    setInspectOn(false)
                    setBrowserMeasureId((current) => (current === frame.id ? null : frame.id))
                    setBrowserMeasureInspect(true)
                    setBrowserMeasureXray(false)
                  }}
                  onMeasureInspect={() => {
                    setBrowserMeasureInspect((value) => !value)
                  }}
                  onMeasureXray={() => {
                    setBrowserMeasureXray((value) => !value)
                  }}
                  onSelect={() => {
                    setSelectedId(frame.id)
                    setDesignSelectedIds([])
                  }}
                  onChange={(patch) => patchFrame(frame.id, patch)}
                  onNavigate={(tabId, url) => {
                    setBrowsers((current) =>
                      current.map((item) =>
                        item.id === frame.id
                          ? { ...item, tabs: item.tabs.map((tab) => (tab.id === tabId ? { ...tab, url } : tab)) }
                          : item
                      )
                    )
                    void window.vanta.navigate(tabId, url)
                  }}
                  onBack={(tabId) => void window.vanta.back(tabId)}
                  onForward={(tabId) => void window.vanta.forward(tabId)}
                  onReload={(tabId) => void window.vanta.reload(tabId)}
                  onCloseWindow={() => {
                    holes.current.delete(frame.id)
                    setBrowsers((current) => current.filter((item) => item.id !== frame.id))
                    if (selectedId === frame.id) {
                      setInspectOn(false)
                      setSelectedId(null)
                    }
                    void window.vanta.closeBrowser(frame.id)
                  }}
                  onNewTab={() => {
                    void window.vanta.createTab(frame.id).then((next) => {
                      setBrowsers((current) =>
                        current.map((item) =>
                          item.id === next.id ? { ...next, x: item.x, y: item.y, width: item.width, height: item.height } : item
                        )
                      )
                      setSelectedId(frame.id)
                    })
                  }}
                  onActivateTab={(tabId) => {
                    patchFrame(frame.id, { activeTabId: tabId })
                    void window.vanta.activateTab(frame.id, tabId)
                  }}
                  onCloseTab={(tabId) => {
                    void window.vanta.closeTab(frame.id, tabId)
                  }}
                  onHole={(el) => {
                    if (el) holes.current.set(frame.id, el)
                    else holes.current.delete(frame.id)
                  }}
                  onInteractEnd={() => {
                    void syncLayout()
                  }}
                />
              ))}
            </div>
            {marqueeBox && (marqueeBox.width > 2 || marqueeBox.height > 2) && (
              <div
                className="marquee"
                style={{
                  left: marqueeBox.left,
                  top: marqueeBox.top,
                  width: marqueeBox.width,
                  height: marqueeBox.height
                }}
              />
            )}
            {drawCursor && (tool === 'pencil' || tool === 'brush') && (
              <div
                className="draw-cursor"
                style={{
                  left: drawCursor.x,
                  top: drawCursor.y,
                  width: Math.max(6, (tool === 'brush' ? brushWeight : pencilWeight) * camera.zoom),
                  height: Math.max(6, (tool === 'brush' ? brushWeight : pencilWeight) * camera.zoom)
                }}
              />
            )}
            <CommentCursor x={commentCursor?.x || 0} y={commentCursor?.y || 0} visible={tool === 'comment' && Boolean(commentCursor)} />
            {(() => {
              const active = pageNodes.find((node) => node.id === activeCommentId && node.type === 'comment')
              if (!active) return null
              return (
                <CommentThreadCard
                  node={active}
                  camera={camera}
                  pageName={activePage.name}
                  mode={active.drafting ? 'compose' : 'thread'}
                  draftText={commentDraftText}
                  onDraftText={setCommentDraftText}
                  onSubmitDraft={() => {
                    const text = commentDraftText.trim()
                    if (!text) return
                    persistDesign(
                      designRef.current.map((node) =>
                        node.id === active.id
                          ? {
                              ...node,
                              drafting: false,
                              unread: false,
                              text,
                              messages: [
                                {
                                  id: crypto.randomUUID(),
                                  authorId: CURRENT_USER.id,
                                  text,
                                  createdAt: Date.now()
                                }
                              ]
                            }
                          : node
                      )
                    )
                    setCommentDraftText('')
                    setActiveCommentId(active.id)
                  }}
                  onCancelDraft={() => {
                    persistDesign(designRef.current.filter((node) => node.id !== active.id))
                    setActiveCommentId(null)
                    setCommentDraftText('')
                  }}
                  onReply={(text) => {
                    persistDesign(
                      designRef.current.map((node) =>
                        node.id === active.id
                          ? {
                              ...node,
                              messages: [
                                ...(node.messages || []),
                                {
                                  id: crypto.randomUUID(),
                                  authorId: CURRENT_USER.id,
                                  text,
                                  createdAt: Date.now()
                                }
                              ]
                            }
                          : node
                      )
                    )
                  }}
                  onResolve={() => resolveComment(active.id)}
                  onClose={() => setActiveCommentId(null)}
                  onDelete={() => {
                    persistDesign(designRef.current.filter((node) => node.id !== active.id))
                    setActiveCommentId(null)
                  }}
                  onMarkUnread={() => {
                    persistDesign(designRef.current.map((node) => (node.id === active.id ? { ...node, unread: true } : node)))
                  }}
                  onCopyLink={() => {
                    void navigator.clipboard.writeText(`vanta://comment/${active.id}`).catch(() => undefined)
                  }}
                />
              )
            })()}
            <CommentResolveToast
              open={Boolean(resolveToastId)}
              onUndo={() => {
                if (!resolveToastId) return
                persistDesign(
                  designRef.current.map((node) => (node.id === resolveToastId ? { ...node, resolved: false } : node))
                )
                setResolveToastId(null)
              }}
              onClose={() => setResolveToastId(null)}
            />
          </div>
        )}
        {view !== 'home' && (
        <RightSidebar
          zoom={Math.round(clampZoom(camera.zoom) * 100)}
          inspect={inspect}
          inspectOn={inspectOn}
          page={activePage}
          node={selected ? null : selectedNode}
          nodes={design}
          browser={selected}
          tool={tool}
          onPatchPage={(patch) => persistPages(pages.map((page) => (page.id === activePage.id ? { ...page, ...patch } : page)))}
          onPatchNode={(id, patch) => {
            persistDesign(designRef.current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
          }}
          onPatchBrowser={(id, patch) => patchFrame(id, patch)}
          onSpawnFrame={spawnFramePreset}
          onSpawnBrowser={spawnBrowserPreset}
          onZoom={() => zoomTo(1)}
          onCopyLink={() => {
            void navigator.clipboard.writeText(`vanta://file/${activeFileId}`).catch(() => undefined)
          }}
          open={rightOpen}
          width={rightWidth}
          onToggle={() => setRightOpen((value) => !value)}
          onResize={(width) => setRightWidth(Math.min(rail === 'chat' ? 720 : 480, Math.max(200, width)))}
          commentsMode={tool === 'comment' && rail !== 'chat'}
          browserPanel={
            rail === 'chat' ? (
              <ChatBrowserPanel
                url={chatBrowserUrl}
                onUrlChange={setChatBrowserUrl}
                onNavigate={(url) => {
                  setChatBrowserUrl(url)
                  void window.vanta.navigate(CHAT_BROWSER_ID, url)
                }}
                onBack={() => void window.vanta.back(CHAT_BROWSER_ID)}
                onForward={() => void window.vanta.forward(CHAT_BROWSER_ID)}
                onReload={() => void window.vanta.reload(CHAT_BROWSER_ID)}
                onHole={(el) => {
                  chatHole.current = el
                  syncLayout()
                }}
              />
            ) : null
          }
          commentsPanel={
            <CommentsPanel
              comments={pageNodes.filter((node) => node.type === 'comment')}
              pages={pages}
              activeId={activeCommentId}
              showResolved={commentsShowResolved}
              query={commentsQuery}
              onQuery={setCommentsQuery}
              onToggleResolved={() => setCommentsShowResolved((value) => !value)}
              onSelect={(id) => {
                const node = designRef.current.find((item) => item.id === id)
                if (!node) return
                openCommentThread(id)
                const canvas = canvasRef.current
                if (!canvas) return
                const point = worldToScreen(cameraRef.current, node.x, node.y)
                applyCamera({
                  ...cameraRef.current,
                  x: cameraRef.current.x + (canvas.clientWidth / 2 - point.x),
                  y: cameraRef.current.y + (canvas.clientHeight / 2 - point.y)
                })
              }}
              onResolve={resolveComment}
            />
          }
        />
        )}
      </div>
      {view === 'canvas' && rail !== 'chat' && actionBar && (
        <FrameActionBar
          id={actionBar.id}
          width={actionBar.width}
          height={actionBar.height}
          title={actionBar.title}
          anchor={actionAnchor}
          offset={actionBar.offset}
          showDevice={actionBar.showDevice}
          sizeCatalog={actionBar.sizeCatalog}
          renameable={actionBar.renameable}
          onRename={actionBar.onRename}
          onConvert={actionBar.onConvert}
          onResize={actionBar.onResize}
        />
      )}
      {view === 'canvas' && rail !== 'chat' && (
        <CanvasToolbar
          tool={tool}
          shape={shapeKind}
          mode={switchMode}
          strokeColor={strokeColor}
          strokeWeight={tool === 'brush' ? brushWeight : pencilWeight}
          brushStyle={tool === 'brush' ? brushStyle : pencilStyle}
          composerValue={chatInput}
          composerBusy={agentBusy}
          onTool={chooseTool}
          onShape={(next) => {
            setShapeKind(next)
            chooseTool('shape')
          }}
          onMode={chooseMode}
          onStrokeColor={setStrokeColor}
          onStrokeWeight={(weight) => {
            if (tool === 'brush') setBrushWeight(weight)
            else setPencilWeight(weight)
          }}
          onBrushStyle={(style) => {
            if (tool === 'brush') setBrushStyle(style)
            else setPencilStyle(style)
          }}
          onComposerChange={setChatInput}
          onComposerSend={() => void sendChat()}
        />
      )}
      {contextMenu && view === 'canvas' && (
        <CanvasContextMenu
          menu={contextMenu}
          selectedIds={designSelectedIds}
          selectedNodes={designSelectedIds
            .map((id) => design.find((node) => node.id === id))
            .filter((node): node is DesignNode => Boolean(node))}
          canPaste={Boolean(designClipboard.current?.length)}
          canPasteStyles={Boolean(styleClipboard.current)}
          onClose={() => {
            setContextMenu(null)
            contextMenuRef.current = null
          }}
          onSelectLayer={(id) => {
            setDesignSelectedIds([id])
            setSelectedId(null)
          }}
          onSelectParent={selectParentOfSelection}
          onSelectChildren={selectChildrenOfSelection}
          onCopy={copySelection}
          onCopyLink={() => {
            const id = designSelectedIds[designSelectedIds.length - 1]
            void navigator.clipboard
              .writeText(id ? `vanta://node/${id}` : `vanta://file/${activeFileId}`)
              .catch(() => undefined)
          }}
          onCopyAsPng={() => {
            const node = designSelectedIds
              .map((id) => design.find((item) => item.id === id))
              .filter((item): item is DesignNode => Boolean(item))
              .at(-1)
            if (!node) return
            void copyNodeAsPng(node, design).catch(() => undefined)
          }}
          onCopyAsTailwind={() => {
            const nodes = designSelectedIds
              .map((id) => design.find((node) => node.id === id))
              .filter((node): node is DesignNode => Boolean(node))
            const text = nodes.map((node) => nodeCssSnippet(node, true)).join('\n')
            void navigator.clipboard.writeText(text).catch(() => undefined)
          }}
          onCopyAsReact={() => {
            const nodes = designSelectedIds
              .map((id) => design.find((node) => node.id === id))
              .filter((node): node is DesignNode => Boolean(node))
            const text = nodes.map((node) => nodeCssSnippet(node, false)).join('\n\n')
            void navigator.clipboard.writeText(text).catch(() => undefined)
          }}
          onPaste={() => pasteClipboard('default')}
          onPasteOnTop={() => pasteClipboard('on-top')}
          onPasteReplace={() => pasteClipboard('replace')}
          onDuplicate={duplicateSelected}
          onCopyStyles={copyStylesFromSelection}
          onPasteStyles={pasteStylesToSelection}
          onFrameSelection={frameSelected}
          onWrapFlex={wrapFlexSelected}
          onRemoveFlex={removeFlexSelected}
          onDelete={deleteSelected}
        />
      )}
    </div>
  )
}
