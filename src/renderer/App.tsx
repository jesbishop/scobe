import { resolveChatModel, type ChatModelId } from '../shared/chatModels'
import type { Paint } from '../shared/paint'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BrowserFrame } from './BrowserFrame'
import { CanvasToolbar } from './CanvasToolbar'
import { DesignLayer, pointerEndedTextEdit } from './DesignLayer'
import { CommentCursor, CommentResolveToast, CommentThreadCard, CURRENT_USER } from './CommentOverlays'
import { CommentsPanel } from './CommentsPanel'
import { MeasureOverlay, type MeasureTitle } from './MeasureOverlay'
import { AlignGuidesOverlay } from './AlignGuidesOverlay'
import { alignNodes, snapMove, snapTargets, type AlignAction, type AlignGuide } from './alignGuides'
import { applyFramePadding, applyLayoutAlignment, applySelectionGap } from './selectionSpace'
import {
  distanceMeasurements,
  edgePoint,
  hitTestMeasureLine,
  measurementBetweenAnchors,
  nearestEdge,
  offsetMeasureLine,
  sizeMeasurements,
  type MeasureAnchor,
  type MeasureLine
} from './measureMath'
import { clampZoom, fitFrames, intersectRects, nodeBounds, rectContains, rectsOverlap, scaleNodeAround, screenToWorld, wheelPan, wheelZoomFactor, worldToScreen, zoomAt } from './canvasMath'
import { resolvePageFill } from './colorMath'
import { ChatAgentsPopout, ChatWorkspace, createChatSession, type ChatSession } from './ChatView'
import { CreateSvgPanel, expandCutoutAlpha, rasterizeToPngDataUrl, sampleImageColors, shrinkImageDataUrl, svgToDataUrl, type CreateSvgMenuAction } from './CreateSvgPanel'
import { explodeSvgToNodes, fitSvgMarkup, normalizeSvgMarkup } from './svgExplode'
import type { QuiverGenerateInput, QuiverModelId } from '../shared/quiver'

function isQuiverCancelMessage(message?: string | null): boolean {
  const text = (message || '').trim().toLowerCase()
  if (!text) return false
  return (
    text === 'cancelled' ||
    text === 'canceled' ||
    text === 'aborted' ||
    text.includes('terminat') ||
    text.includes('abort')
  )
}
import { useJev, type CommandResult } from './useJev'
import { commandById, commandRunnable, type CommandId } from './jevCommands'
import { extractColor, extractDimensions } from './jevEngine'
import { FileTabs, HomeScreen, LeftSidebar, NewTabScreen, RightSidebar, type LayerItem, type ProjectFile, type RailTab } from './shell'
import { FrameActionBar } from './FrameBar'
import { loadCodingAgents, rememberCodingAgent } from './codingAgents'
import { recordVisit } from './urlHistory'
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
  FRAME_CHROME_HEIGHT,
  MIN_VIEWPORT,
  type AgentEvent,
  type BrowserFrame as Frame,
  type Camera,
  type ChromeStatus,
  type DesignNode,
  type DesignPage,
  type ExportFormat,
  type BrushStyleId,
  type DesignTool,
  type InspectInfo,
  type BuildUiEvent,
  type McpStatus,
  type PathPoint,
  type ShapeKind,
  type SwitchMode
} from '../shared/types'
import { CHAT_BROWSER_ID, AGENT_SIDE_BROWSER_HOME, AGENT_SIDE_BROWSER_IDS, AGENT_SIDE_BROWSER_MAX, getCodingAgentMeta, SIDEBAR_BROWSER_ID, type AgentSideBrowserSlot, type CodingAgentId, type DockedTabRef } from '../shared/codingAgents'
import { importSnapshot, type SnapshotNode } from '../shared/snapshot'
import { nextCommentNumber } from '../shared/comments'
import type { FramePreset } from '../shared/framePresets'
import { CanvasContextMenu, type ContextMenuState } from './CanvasContextMenu'
import { LayerSidebarMenu, type LayerMenuState } from './LayerSidebarMenu'
import { copyNodeAsPng, exportNodeAsPngBlob, exportNodeSetting, renderPageThumbnailDataUrl } from './exportNode'
import { tokensForAgents } from './tokenStore'
import {
  CropBar,
  aspectRatioOf,
  containRect,
  coverRect,
  scaleToZoom,
  zoomToScale,
  type CropAspect,
  type CropRect
} from './ImageCrop'
import { nodesToReact } from './codeExport'
import { remeasureText } from './textLayout'
import {
  addOrWrapFlex,
  childrenOf,
  duplicateSelection,
  enableAutoLayoutOnFrame,
  expandWithDescendants,
  findContainingParent,
  isAutoLayout,
  hasWorldPoints,
  layersAtPoint,
  marqueeSelectIds,
  nodeIndexOf,
  pickDeepAtPoint,
  planGrid,
  reflowAutoLayout,
  removeFlexFromSelection,
  reorderFlexByDelta,
  resolveClickTarget,
  resolveDrillIn,
  resolveWorldRect,
  toRelative,
  wrapSelectionInFrame
} from '../shared/layoutEngine'
import { applyConstraintsOnParentResize } from '../shared/constraints'
import { moveLayers, type LayerDropTarget } from '../shared/layerMove'
import { describeDesignChange, type HistoryEntry, type HistorySource } from './designHistory'
import { defaultShader, getNodePaints, legacyFromPaints, SHADER_OPTIONS, type ShaderKind } from '../shared/paint'

function findMeasureAnchorAt(
  point: { x: number; y: number },
  nodes: DesignNode[],
  threshold: number
): MeasureAnchor | null {
  let best: { anchor: MeasureAnchor; depth: number; dist: number } | null = null
  for (const node of nodes) {
    if (node.type === 'comment') continue
    const box = resolveWorldRect(node, nodes)
    const edge = nearestEdge(box, point, threshold)
    if (!edge) continue
    const pt = edgePoint(box, edge)
    let depth = 0
    let parentId = node.parentId
    while (parentId) {
      depth += 1
      parentId = nodes.find((item) => item.id === parentId)?.parentId
    }
    const dist =
      edge === 'n' || edge === 's' ? Math.abs(point.y - pt.y) : Math.abs(point.x - pt.x)
    if (
      !best ||
      depth > best.depth ||
      (depth === best.depth && dist < best.dist)
    ) {
      best = { anchor: { nodeId: node.id, edge, x: pt.x, y: pt.y }, depth, dist }
    }
  }
  return best?.anchor || null
}

function freeMeasureAnchor(start: MeasureAnchor, point: { x: number; y: number }): MeasureAnchor {
  if (start.edge === 'e' || start.edge === 'w') {
    return {
      nodeId: '__free__',
      edge: start.edge === 'e' ? 'w' : 'e',
      x: point.x,
      y: start.y
    }
  }
  return {
    nodeId: '__free__',
    edge: start.edge === 's' ? 'n' : 's',
    x: start.x,
    y: point.y
  }
}

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

/** Remap a stroke's world-space points (and bezier handles) from one box onto another. */
function scalePathPoints(
  node: DesignNode,
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number }
): DesignNode {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  const mapX = (value: number) => to.x + (value - from.x) * sx
  const mapY = (value: number) => to.y + (value - from.y) * sy
  return {
    ...node,
    points: node.points?.map((point) => ({
      ...point,
      x: mapX(point.x),
      y: mapY(point.y),
      inX: point.inX != null ? mapX(point.inX) : undefined,
      inY: point.inY != null ? mapY(point.inY) : undefined,
      outX: point.outX != null ? mapX(point.outX) : undefined,
      outY: point.outY != null ? mapY(point.outY) : undefined
    }))
  }
}

function reparentMovedNode(node: DesignNode, nodes: DesignNode[], exclude: Set<string>): DesignNode {
  if (hasWorldPoints(node)) return node
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

// Main may broadcast its own reflow of a design we just sent; that echo must not replace the renderer's layout.
let designSavesInFlight = 0
function sendDesignToMain(nodes: DesignNode[]): void {
  designSavesInFlight += 1
  void window.vanta.setDesign(nodes).finally(() => {
    designSavesInFlight -= 1
  })
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
    if (parent.layout?.grid) {
      // Reading order: rows first, then columns.
      const dy = aw.y + aw.height / 2 - (bw.y + bw.height / 2)
      if (Math.abs(dy) > Math.min(aw.height, bw.height) / 2) return dy
      return aw.x + aw.width / 2 - (bw.x + bw.width / 2)
    }
    const ac = vertical ? aw.y + aw.height / 2 : aw.x + aw.width / 2
    const bc = vertical ? bw.y + bw.height / 2 : bw.x + bw.width / 2
    return ac - bc
  })
  return spliceChildren(nodes, parentId, sorted)
}

type CropSession = {
  nodeId: string
  paintIndex: number
  /** Layer + whole design before cropping (Cancel restores, Apply records one undo step). */
  before: DesignNode
  designBefore: DesignNode[]
  natural: { w: number; h: number }
  src: string
  aspect: CropAspect
  frame: CropRect
  image: CropRect
}

/** Items in the first line of a wrapping flex frame — cross-axis arrow keys jump a whole line. */
function flexLineLength(nodes: DesignNode[], parent: DesignNode): number {
  const vertical = parent.layout?.mode === 'vertical'
  const kids = childrenOf(nodes, parent.id).filter((node) => !node.layoutAbsolute)
  if (!kids.length) return 1
  const cross = (node: DesignNode) => (vertical ? node.x : node.y)
  const first = cross(kids[0])
  let count = 0
  for (const kid of kids) {
    if (Math.abs(cross(kid) - first) > 1) break
    count++
  }
  return Math.max(1, count)
}

/** Grid drop: the cell under the pointer becomes the insert index (row-major, Figma). */
function measureGridDrop(
  nodes: DesignNode[],
  parent: DesignNode,
  movingIds: string[],
  pointer: { x: number; y: number },
  dragSize: { width: number; height: number }
): FlexDropGuide | null {
  const layout = parent.layout!
  const siblings = childrenOf(nodes, parent.id).filter((node) => !movingIds.includes(node.id) && !node.layoutAbsolute)
  const plan = planGrid(layout, childrenOf(nodes, parent.id), parent, {
    h: (layout.sizingH || 'fixed') !== 'hug',
    v: (layout.sizingV || 'fixed') !== 'hug'
  })
  const world = resolveWorldRect(parent, nodes)
  const localX = pointer.x - world.x
  const localY = pointer.y - world.y
  const trackAt = (starts: number[], sizes: number[], value: number) => {
    let index = 0
    for (let i = 0; i < starts.length; i++) if (value >= starts[i]) index = i
    return { index, after: value > starts[index] + sizes[index] / 2 }
  }
  const col = trackAt(plan.colStarts, plan.colSizes, localX)
  const row = trackAt(plan.rowStarts, plan.rowSizes, localY)
  const index = Math.max(0, Math.min(siblings.length, row.index * plan.columns + col.index + (col.after ? 1 : 0)))
  const edgeX = col.after ? plan.colStarts[col.index] + plan.colSizes[col.index] : plan.colStarts[col.index]
  const cellY = plan.rowStarts[row.index]
  return {
    parentId: parent.id,
    index,
    axis: 'x',
    line: { x: world.x + edgeX - 1, y: world.y + cellY, width: 2, height: Math.max(8, plan.rowSizes[row.index]) },
    slot: {
      x: world.x + plan.colStarts[col.index],
      y: world.y + cellY,
      width: Math.max(8, dragSize.width),
      height: Math.max(8, dragSize.height)
    }
  }
}

function spliceChildren(nodes: DesignNode[], parentId: string, orderedKids: DesignNode[]): DesignNode[] {
  const kidIds = new Set(orderedKids.map((node) => node.id))
  const result: DesignNode[] = []
  let inserted = false
  for (const node of nodes) {
    if (kidIds.has(node.id)) {
      if (!inserted) {
        result.push(...orderedKids)
        inserted = true
      }
      continue
    }
    result.push(node)
  }
  return result
}

/** Drop a dragged flex child into a sibling index (CSS flex order by document order). */
function placeFlexChildren(
  nodes: DesignNode[],
  parentId: string,
  movingIds: string[],
  index: number
): DesignNode[] {
  const kids = childrenOf(nodes, parentId)
  const moving = kids.filter((node) => movingIds.includes(node.id))
  const rest = kids.filter((node) => !movingIds.includes(node.id))
  if (!moving.length) return nodes
  const at = Math.max(0, Math.min(index, rest.length))
  const ordered = [
    ...rest.slice(0, at),
    ...moving.map((node) => ({ ...node, layoutAbsolute: false })),
    ...rest.slice(at)
  ]
  return spliceChildren(nodes, parentId, ordered)
}

type FlexDropGuide = {
  parentId: string
  index: number
  axis: 'x' | 'y'
  line: { x: number; y: number; width: number; height: number }
  slot: { x: number; y: number; width: number; height: number }
}

function measureFlexDrop(
  nodes: DesignNode[],
  parentId: string,
  movingIds: string[],
  pointer: { x: number; y: number },
  dragSize: { width: number; height: number }
): FlexDropGuide | null {
  const parent = nodes.find((node) => node.id === parentId)
  if (!parent || !isAutoLayout(parent)) return null
  if (parent.layout?.grid) return measureGridDrop(nodes, parent, movingIds, pointer, dragSize)
  const vertical = parent.layout?.mode === 'vertical'
  const siblings = childrenOf(nodes, parentId).filter(
    (node) => !movingIds.includes(node.id) && !node.layoutAbsolute
  )
  const sorted = [...siblings].sort((a, b) => {
    const aw = resolveWorldRect(a, nodes)
    const bw = resolveWorldRect(b, nodes)
    return vertical ? aw.y - bw.y : aw.x - bw.x
  })
  let index = sorted.length
  for (let i = 0; i < sorted.length; i++) {
    const box = resolveWorldRect(sorted[i], nodes)
    const mid = vertical ? box.y + box.height / 2 : box.x + box.width / 2
    if ((vertical ? pointer.y : pointer.x) < mid) {
      index = i
      break
    }
  }
  const parentWorld = resolveWorldRect(parent, nodes)
  const pad =
    typeof parent.layout?.padding === 'number'
      ? { t: parent.layout.padding, r: parent.layout.padding, b: parent.layout.padding, l: parent.layout.padding }
      : parent.layout?.padding || { t: 0, r: 0, b: 0, l: 0 }
  const gap = typeof parent.layout?.gap === 'number' ? parent.layout.gap : 0
  let slotX = parentWorld.x + (pad.l || 0)
  let slotY = parentWorld.y + (pad.t || 0)
  if (index < sorted.length) {
    const at = resolveWorldRect(sorted[index], nodes)
    if (vertical) {
      slotX = at.x
      slotY = at.y
    } else {
      slotX = at.x
      slotY = at.y
    }
  } else if (sorted.length) {
    const last = resolveWorldRect(sorted[sorted.length - 1], nodes)
    if (vertical) {
      slotX = last.x
      slotY = last.y + last.height + gap
    } else {
      slotX = last.x + last.width + gap
      slotY = last.y
    }
  }
  const slot = {
    x: slotX,
    y: slotY,
    width: Math.max(8, dragSize.width),
    height: Math.max(8, dragSize.height)
  }
  // Center the insert bar in the gap between siblings (or the leading padding at index 0).
  const lead = vertical ? pad.t || 0 : pad.l || 0
  const shift = index === 0 ? Math.min(lead, 8) / 2 : gap / 2
  const along = index < sorted.length ? (vertical ? slot.y : slot.x) - shift : (vertical ? slot.y : slot.x) - gap / 2
  const line = vertical
    ? {
        x: parentWorld.x + (pad.l || 0),
        y: along,
        width: Math.max(8, parentWorld.width - (pad.l || 0) - (pad.r || 0)),
        height: 0
      }
    : {
        x: along,
        y: parentWorld.y + (pad.t || 0),
        width: 0,
        height: Math.max(8, parentWorld.height - (pad.t || 0) - (pad.b || 0))
      }
  return { parentId, index, axis: vertical ? 'y' : 'x', line, slot }
}

/** Screen-space pixel grid: one cell per canvas pixel, fading in from 600% to 1000%. */
function paintPixelGrid(el: HTMLDivElement, camera: Camera) {
  const zoom = camera.zoom
  const opacity = Math.max(0, Math.min(1, (zoom - 6) / 4))
  if (!opacity) {
    el.style.display = 'none'
    return
  }
  el.style.display = 'block'
  el.style.opacity = String(opacity)
  el.style.backgroundSize = `${zoom}px ${zoom}px`
  el.style.backgroundPosition = `${camera.x % zoom}px ${camera.y % zoom}px`
}

type ScreenRect = { x: number; y: number; width: number; height: number }

/** Toolbar exits fully off-screen before agent fullscreen expands. */
const TOOLBAR_FS_ENTER = { type: 'spring' as const, stiffness: 560, damping: 42, mass: 0.65 }
const TOOLBAR_FS_EXIT = { duration: 0.14, ease: [0.4, 0, 1, 1] as [number, number, number, number] }
/** Pause after agent collapses before the toolbar returns. */
const TOOLBAR_FS_RETURN_DELAY_MS = 180

/** Inspector popovers and menus that can float over the canvas. */
const INSPECTOR_POPUP_SELECTOR = [
  '.fill-picker',
  '.fill-format-menu',
  '.fx-pop',
  '.fx-menu',
  '.lg-popover',
  '.lg-menu',
  '.prop-blend-menu',
  '.prop-constraint-menu',
  '.prop-size-mode-menu',
  '.prop-type-size-menu',
  '.prop-font-menu',
  '.prop-font-style-menu',
  '.export-toast'
].join(', ')

/** Native BrowserViews paint above HTML — clip them away from these chrome regions. */
const CHROME_OBSTACLE_SELECTOR = [
  INSPECTOR_POPUP_SELECTOR,
  '.file-tabs',
  '.leftbar',
  '.leftbar-panel',
  '.sidebar-ui-chip',
  '.rightbar',
  '.sidebar-expand',
  '.canvas-toolbar-stack',
  '.canvas-toolbar-shell',
  '.frame-action-wrap',
  '.frame-action-menu',
  '.shape-menu',
  '.draw-stroke-bar',
  '.brush-picker',
  '.ctx-menu',
  '.comment-overlay-card',
  '.comment-emoji-picker',
  '.comment-mention-menu',
  '.ca-popup-backdrop',
  '.ca-popup-stage',
  '.ca-popup',
  '.chat-agents-popout',
  '.chat-popout-btn',
  '.ca-agent-picker',
  '.ca-agent-rail',
  '.ca-fs-popup',
  '.shader-fills-popup',
  '.chat-suggestion-popup',
  '[data-chrome-overlay]'
].join(', ')

function padRect(box: DOMRect | ScreenRect, pad: number): ScreenRect {
  return {
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2
  }
}

function sameNodeValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Design updates from main arrive as fresh IPC copies. Keep the previous object for every
 * node that didn't change so React (and the dev-mode prop diff) only touch real edits.
 */
function reuseUnchangedNodes(prev: DesignNode[], incoming: DesignNode[]): DesignNode[] {
  const byId = nodeIndexOf(prev)
  let allSame = prev.length === incoming.length
  const out = incoming.map((node, index) => {
    const old = byId.get(node.id)
    if (!old) {
      allSame = false
      return node
    }
    const keys = Object.keys(node) as Array<keyof DesignNode>
    const equal =
      keys.length === Object.keys(old).length && keys.every((key) => sameNodeValue(node[key], old[key]))
    if (!equal || prev[index] !== old) allSame = false
    return equal ? old : node
  })
  return allSame ? prev : out
}

function readChromeObstacles(exclude?: string): ScreenRect[] {
  const out: ScreenRect[] = []
  document.querySelectorAll(CHROME_OBSTACLE_SELECTOR).forEach((el) => {
    if (exclude && el.matches(exclude)) return
    const box = el.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return
    const pad = el.matches('.canvas-toolbar-stack, .canvas-toolbar-shell, .file-tabs') ? 14 : 6
    out.push(padRect(box, pad))
  })
  return out
}

/** Comfortable laptop-width column for general browsing (not coding-agent panes). */
const BROWSER_PANE_MAX_WIDTH = 1280

/**
 * Native browser framing for docked tabs / add-browser — zoom 1:1 (no inspect device scale).
 * When the pane is wider than a laptop, letterbox to a centered column so pages
 * don't render like a wall-sized monitor. Coding-agent holes stay full-bleed separately.
 */
function browserPaneFrame(hole: ScreenRect): { hole: ScreenRect; viewport: { width: number; height: number } } {
  const width = Math.min(BROWSER_PANE_MAX_WIDTH, Math.max(1, Math.round(hole.width)))
  const height = Math.max(1, Math.round(hole.height))
  const framed =
    width >= hole.width - 0.5
      ? { x: hole.x, y: hole.y, width: hole.width, height: hole.height }
      : {
          x: hole.x + (hole.width - width) / 2,
          y: hole.y,
          width,
          height: hole.height
        }
  return {
    hole: framed,
    viewport: { width: Math.max(1, Math.round(framed.width)), height }
  }
}

/** Obstacles that must punch through sidebar BrowserViews (agent / side browser / chat). */
function readSidebarBrowserObstacles(): ScreenRect[] {
  const out: ScreenRect[] = []
  document
    .querySelectorAll(
      '.canvas-toolbar-stack, .canvas-toolbar-shell, .frame-action-wrap, .url-omnibox-menu, [data-chrome-overlay]'
    )
    .forEach((el) => {
      const box = el.getBoundingClientRect()
      if (box.width < 2 || box.height < 2) return
      const pad = el.matches('.url-omnibox-menu') ? 8 : 12
      out.push(padRect(box, pad))
    })
  return out
}

/** Largest axis-aligned piece of `source` that does not overlap `block`. */
function largestRectOutside(source: ScreenRect, block: ScreenRect): ScreenRect {
  const ix = Math.max(source.x, block.x)
  const iy = Math.max(source.y, block.y)
  const ir = Math.min(source.x + source.width, block.x + block.width)
  const ib = Math.min(source.y + source.height, block.y + block.height)
  if (ir - ix <= 0 || ib - iy <= 0) return source
  const candidates: ScreenRect[] = [
    { x: source.x, y: source.y, width: source.width, height: iy - source.y },
    { x: source.x, y: ib, width: source.width, height: source.y + source.height - ib },
    { x: source.x, y: source.y, width: ix - source.x, height: source.height },
    { x: ir, y: source.y, width: source.x + source.width - ir, height: source.height }
  ]
  let best = candidates[0]
  let bestArea = Math.max(0, best.width) * Math.max(0, best.height)
  for (const candidate of candidates.slice(1)) {
    const area = Math.max(0, candidate.width) * Math.max(0, candidate.height)
    if (area > bestArea) {
      best = candidate
      bestArea = area
    }
  }
  if (bestArea < 4) return { x: 0, y: 0, width: 0, height: 0 }
  return best
}

function clipAgainstObstacles(source: ScreenRect, obstacles: ScreenRect[]): ScreenRect {
  let clip = source
  // Multiple passes — sequential largest-rect can leave remnants that still overlap earlier blocks.
  for (let pass = 0; pass < 4; pass++) {
    const before = clip
    for (const block of obstacles) {
      if (clip.width < 2 || clip.height < 2) return { x: 0, y: 0, width: 0, height: 0 }
      clip = largestRectOutside(clip, block)
    }
    if (
      Math.abs(clip.x - before.x) < 0.5 &&
      Math.abs(clip.y - before.y) < 0.5 &&
      Math.abs(clip.width - before.width) < 0.5 &&
      Math.abs(clip.height - before.height) < 0.5
    ) {
      break
    }
  }
  return clip
}

/** Full-height side/top chrome strips so BrowserViews never paint over sidebars or file tabs. */
function readShellChromeObstacles(): ScreenRect[] {
  const out: ScreenRect[] = []
  const fileTabs = document.querySelector('.file-tabs')?.getBoundingClientRect()
  if (fileTabs && fileTabs.height > 2) {
    out.push(padRect({ x: 0, y: 0, width: window.innerWidth, height: fileTabs.bottom }, 2))
  }
  const leftbar = document.querySelector('.leftbar')?.getBoundingClientRect()
  const leftPanel = document.querySelector('.leftbar-panel:not(.is-collapsed)')?.getBoundingClientRect()
  const leftRight = Math.max(leftbar?.right ?? 0, leftPanel && leftPanel.width > 2 ? leftPanel.right : 0)
  if (leftRight > 2) {
    out.push({ x: 0, y: 0, width: leftRight + 4, height: window.innerHeight })
  }
  const rightbar = document.querySelector('.rightbar:not(.is-collapsed)')?.getBoundingClientRect()
  if (rightbar && rightbar.width > 2) {
    out.push({
      x: Math.max(0, rightbar.left - 4),
      y: 0,
      width: window.innerWidth - rightbar.left + 4,
      height: window.innerHeight
    })
  }
  return out
}

export function App() {
  const reduceMotion = useReducedMotion()
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 80, zoom: 1 })
  const [browsers, setBrowsers] = useState<Frame[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedBrowserIds, setSelectedBrowserIds] = useState<string[]>([])
  const [status, setStatus] = useState<ChromeStatus>({ state: 'starting' })
  const [panning, setPanning] = useState(false)
  const [handMode, setHandMode] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [deepSelectHeld, setDeepSelectHeld] = useState(false)
  const [deepHoverId, setDeepHoverId] = useState<string | null>(null)
  const deepSelectHeldRef = useRef(false)
  const deepHoverIdRef = useRef<string | null>(null)
  const [inspectOn, setInspectOn] = useState(false)
  const [inspect, setInspect] = useState<InspectInfo | null>(null)
  const [measureHoverId, setMeasureHoverId] = useState<string | null>(null)
  const [measureOffsets, setMeasureOffsets] = useState<Record<string, number>>({})
  const [measurePins, setMeasurePins] = useState<Array<{ id: string; base: MeasureLine; offset: number }>>([])
  const [measureEdgeHover, setMeasureEdgeHover] = useState<MeasureAnchor | null>(null)
  const [measureActiveLineId, setMeasureActiveLineId] = useState<string | null>(null)
  const [measureDraft, setMeasureDraft] = useState<MeasureLine | null>(null)
  const measureLinesRef = useRef<MeasureLine[]>([])
  const measureSlide = useRef<{
    lineId: string
    axis: 'h' | 'v'
    startOffset: number
    startPointer: number
    slideMin: number
    slideMax: number
    pinned: boolean
    offsetKey: string
  } | null>(null)
  const measureCreate = useRef<{
    start: MeasureAnchor
    current: { x: number; y: number }
    target: MeasureAnchor | null
  } | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  const [alignGuides, setAlignGuides] = useState<AlignGuide[]>([])
  const [flexDrop, setFlexDrop] = useState<FlexDropGuide | null>(null)
  const flexDropRef = useRef<FlexDropGuide | null>(null)
  /**
   * Paper-style reorder: flex children stay in their slot (dimmed) while a floating square
   * follows the pointer; the layout only changes on drop.
   */
  const ghostDragRef = useRef<{
    ids: string[]
    parentId: string
    dx: number
    dy: number
    /** Left its flex parent mid-drag: now a free layer under the pointer (siblings closed the gap). */
    detached?: boolean
  } | null>(null)
  /** Figma image crop: the layer box is the crop window, the image moves/zooms behind it. */
  const [cropSession, setCropSessionState] = useState<CropSession | null>(null)
  const cropSessionRef = useRef<CropSession | null>(null)
  const setCropSession = (next: CropSession | null) => {
    cropSessionRef.current = next
    setCropSessionState(next)
  }
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [dragGhostIds, setDragGhostIds] = useState<string[]>([])
  const [dropParentId, setDropParentId] = useState<string | null>(null)
  const dropParentIdRef = useRef<string | null>(null)
  const alignGuideTimer = useRef<number | null>(null)
  const [browserMeasureId, setBrowserMeasureId] = useState<string | null>(null)
  const [browserMeasureInspect, setBrowserMeasureInspect] = useState(true)
  const [browserMeasureXray, setBrowserMeasureXray] = useState(false)
  const [snapshotBrowserId, setSnapshotBrowserId] = useState<string | null>(null)
  const [tool, setTool] = useState<DesignTool>('pointer')
  const [switchMode, setSwitchMode] = useState<SwitchMode>('draw')
  const [chatPoppedOut, setChatPoppedOut] = useState(false)
  const [design, setDesign] = useState<DesignNode[]>([])
  const [designSelectedIds, setDesignSelectedIds] = useState<string[]>([])
  const [snapshotRevealId, setSnapshotRevealId] = useState<string | null>(null)
  const [buildingIds, setBuildingIds] = useState<string[]>([])
  const [revealIds, setRevealIds] = useState<string[]>([])
  const [createSvgOpen, setCreateSvgOpen] = useState(false)
  const [createSvgPrompt, setCreateSvgPrompt] = useState('')
  const [createSvgLastPrompt, setCreateSvgLastPrompt] = useState('')
  const [createSvgModel, setCreateSvgModel] = useState<QuiverModelId>('arrow-2')
  const [createSvgBusy, setCreateSvgBusy] = useState(false)
  const [createSvgStatus, setCreateSvgStatus] = useState<string | null>(null)
  const [createSvgHiddenRefs, setCreateSvgHiddenRefs] = useState<string[]>([])
  const [createSvgHiddenChips, setCreateSvgHiddenChips] = useState<string[]>([])
  /** Frozen composer thumbs while generating — avoids flashing draft SVGs. */
  const [createSvgPinnedRefs, setCreateSvgPinnedRefs] = useState<Array<{ id: string; dataUrl: string }> | null>(
    null
  )
  const [quiverConfigured, setQuiverConfigured] = useState(false)
  /** Create SVG work requested from chat; runs once the panel has the selection as references. */
  const discardJevDraftRef = useRef<(next: DesignNode[]) => DesignNode[]>((next) => next)
  const pendingCreateSvgJob = useRef<{ kind: 'create'; prompt: string } | { kind: 'remove-bg' } | { kind: 'vectorize' } | null>(null)
  const agentConfiguredRef = useRef(false)
  const createSvgImageId = useRef<string | null>(null)
  const createSvgFrameId = useRef<string | null>(null)
  const createSvgSlots = useRef<Array<{ frameId: string; imageId: string }>>([])
  const createSvgApplyRaf = useRef<number | null>(null)
  const createSvgPending = useRef<Map<string, string>>(new Map())
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null)
  const [draft, setDraft] = useState<DesignNode | null>(null)
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect')
  const [strokeColor, setStrokeColor] = useState('#000000')
  const [instrumentColors, setInstrumentColors] = useState({ pen: '#000000', pencil: '#000000', brush: '#000000' })
  const [instrumentPaints, setInstrumentPaints] = useState<Partial<Record<'pen' | 'pencil' | 'brush', Paint>>>({})
  const [penWeight, setPenWeight] = useState(2)
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
  const [layerMenu, setLayerMenu] = useState<LayerMenuState | null>(null)
  const [collapseLayersToken, setCollapseLayersToken] = useState(0)
  const designClipboard = useRef<DesignNode[] | null>(null)
  const styleClipboard = useRef<Partial<DesignNode> | null>(null)
  const [rail, setRail] = useState<RailTab>('file')
  const railRef = useRef<RailTab>('file')
  railRef.current = rail
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('vanta-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  })
  const [view, setView] = useState<'canvas' | 'home' | 'new-tab'>('canvas')
  const [files, setFiles] = useState<ProjectFile[]>([{ id: 'file-1', name: 'Untitled', editedAt: Date.now() }])
  const [activeFileId, setActiveFileId] = useState('file-1')
  const [actionAnchor, setActionAnchor] = useState<DOMRect | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chats, setChats] = useState<ChatSession[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scobe:chats:v1') || 'null')
      if (Array.isArray(saved) && saved.length && saved.every(chat => typeof chat.id === 'string' && typeof chat.title === 'string' && Array.isArray(chat.messages) && chat.messages.every((m: ChatSession['messages'][number]) => ['user', 'assistant', 'system'].includes(m.role) && typeof m.text === 'string'))) return saved
    } catch { /* Start a fresh conversation if local history is unavailable. */ }
    return [createChatSession()]
  })
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem('scobe:chats:v1', JSON.stringify(chats)) } catch { /* Storage can be full or unavailable. */ }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [chats])
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const [pages, setPages] = useState<DesignPage[]>([{ ...DEFAULT_PAGE }])
  const [activePageId, setActivePageId] = useState(DEFAULT_PAGE.id)
  const [pageQuery, setPageQuery] = useState('')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [leftWidth, setLeftWidth] = useState(268)
  const [rightWidth, setRightWidth] = useState(241)
  // Don't restore an active agent session — MCP gate must run before sidebar access.
  const [codingActive, setCodingActive] = useState<ReturnType<typeof loadCodingAgents>['active']>(null)
  const [codingRecents, setCodingRecents] = useState(() => loadCodingAgents().recents)
  const [codingPopup, setCodingPopup] = useState(false)
  const [tabsPopup, setTabsPopup] = useState(false)
  const [codingFullscreen, setCodingFullscreen] = useState(false)
  const [codingAgentUrl, setCodingAgentUrl] = useState('')
  const codingFullscreenRef = useRef(false)
  /** Hide toolbar (with exit animation) before / during agent fullscreen. */
  const [toolbarHiddenForAgentFs, setToolbarHiddenForAgentFs] = useState(false)
  const agentFsPending = useRef<'enter' | 'side-enter' | 'exit' | null>(null)
  const agentFsToolbarTimer = useRef<number | null>(null)
  const rightOpenBeforeAgentFs = useRef(true)
  const [dockedTab, setDockedTab] = useState<DockedTabRef | null>(null)
  const dockedTabRef = useRef<DockedTabRef | null>(null)
  const [sideBrowsers, setSideBrowsers] = useState<AgentSideBrowserSlot[]>([])
  const sideBrowsersRef = useRef<AgentSideBrowserSlot[]>([])
  const autoFsForSplitRef = useRef(false)
  const agentSideHoles = useRef(new Map<string, HTMLDivElement>())
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentDraftText, setCommentDraftText] = useState('')
  const [commentCursor, setCommentCursor] = useState<{ x: number; y: number } | null>(null)
  const [commentsQuery, setCommentsQuery] = useState('')
  const [commentsShowResolved, setCommentsShowResolved] = useState(false)
  const [resolveToastId, setResolveToastId] = useState<string | null>(null)
  const [copyToast, setCopyToast] = useState<string | null>(null)
  const copyToastTimerRef = useRef<number | null>(null)
  const activeCommentIdRef = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const actionAnchorRef = useRef<DOMRect | null>(null)
  const holes = useRef(new Map<string, HTMLDivElement>())
  const agentHole = useRef<HTMLDivElement | null>(null)
  const chatHole = useRef<HTMLDivElement | null>(null)
  const agentVisibleRef = useRef(false)
  const dockedVisibleRef = useRef(false)
  const agentSideVisibleRef = useRef(false)
  const chatBrowserVisibleRef = useRef(false)
  const layoutQueued = useRef(false)
  const cameraRaf = useRef<number | null>(null)
  const zoomSettleTimer = useRef<number | null>(null)
  const pixelGridRef = useRef<HTMLDivElement | null>(null)
  const pan = useRef<{ x: number; y: number; camX: number; camY: number } | null>(null)
  const space = useRef(false)
  const cameraRef = useRef(camera)
  const browsersRef = useRef(browsers)
  const selectedRef = useRef(selectedId)
  const selectedBrowserRef = useRef(selectedBrowserIds)
  const toolRef = useRef(tool)
  const designRef = useRef(design)
  const designSelectedRef = useRef(designSelectedIds)
  const designUndoPastRef = useRef<DesignNode[][]>([])
  const designUndoFutureRef = useRef<DesignNode[][]>([])
  const [, refreshHistory] = useState(0)
  const designHistoryLockRef = useRef(false)
  const designHistoryGestureRef = useRef(false)
  const createSvgBusyRef = useRef(false)
  const buildingIdsRef = useRef<string[]>([])
  const pasteSnapshotRef = useRef<(tabId: string, tree: SnapshotNode) => void>(() => {})
  /** Child to select if a press inside the selected frame ends without dragging. */
  const pendingClickSelectRef = useRef<string | null>(null)
  const shapeRef = useRef(shapeKind)
  const moveStart = useRef(
    new Map<string, { worldX: number; worldY: number; localX: number; localY: number; points?: PathPoint[] }>()
  )
  // Flex/grid children only leave the flow once a press turns into a real drag; a plain click must not lift them.
  const pendingLiftRef = useRef<string[] | null>(null)
  const scaleStart = useRef<DesignNode[]>([])
  const marquee = useRef<{
    x: number
    y: number
    shift: boolean
    deep: boolean
    /** Ctrl/Cmd held at press — only then does a plain click deep-pick under the cursor. */
    pick: boolean
    baseIds: string[]
    baseBrowserIds: string[]
  } | null>(null)
  const drawRef = useRef<{
    id: string
    kind: 'box' | 'path' | 'pen' | 'text' | 'browser'
    type: DesignNode['type']
    startX: number
    startY: number
  } | null>(null)
  const penDrag = useRef<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  const strokeRef = useRef({
    paint: undefined as Paint | undefined,
    color: '#000000',
    penWeight: 2,
    pencilWeight: 6,
    brushWeight: 64,
    pencilStyle: 'basic' as BrushStyleId,
    brushStyle: 'heist' as BrushStyleId
  })
  const persistTimer = useRef<number | null>(null)
  const thumbTimer = useRef<number | null>(null)
  const activeFileIdRef = useRef(activeFileId)
  const designsByFileRef = useRef<Record<string, DesignNode[]>>({ 'file-1': [] })
  const pagesRef = useRef(pages)
  const activePageRef = useRef(activePageId)
  const draftRef = useRef<DesignNode | null>(null)
  const onCanvasRef = useRef(true)
  const agentChatRef = useRef<string | null>(null)
  const agentTextRef = useRef('')
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const activeChatIdRef = useRef<string | null>(activeChatId)
  const chatHistories = useRef(new Map<string, Array<{ role: 'user' | 'assistant'; text: string }>>())
  if (cameraRaf.current == null) cameraRef.current = camera
  browsersRef.current = browsers
  selectedRef.current = selectedId
  selectedBrowserRef.current = selectedBrowserIds
  toolRef.current = tool
  designRef.current = design
  designSelectedRef.current = designSelectedIds
  createSvgBusyRef.current = createSvgBusy
  buildingIdsRef.current = buildingIds
  shapeRef.current = shapeKind
  draftRef.current = draft
  strokeRef.current = {
    paint: tool === 'pen' || tool === 'pencil' || tool === 'brush' ? instrumentPaints[tool] : undefined,
    color: strokeColor,
    penWeight,
    pencilWeight,
    brushWeight,
    pencilStyle,
    brushStyle
  }
  pagesRef.current = pages
  activePageRef.current = activePageId
  activeFileIdRef.current = activeFileId
  const resolvedChatId = activeChatId || chats[0]?.id || ''
  activeChatIdRef.current = resolvedChatId
  onCanvasRef.current = view === 'canvas' && rail !== 'chat'
  codingFullscreenRef.current = codingFullscreen
  sideBrowsersRef.current = sideBrowsers
  dockedTabRef.current = dockedTab
  activeCommentIdRef.current = activeCommentId
  agentVisibleRef.current =
    view === 'canvas' &&
    rail === 'coding-agents' &&
    Boolean(codingActive) &&
    !codingPopup &&
    !tabsPopup &&
    (leftOpen || codingFullscreen)
  dockedVisibleRef.current =
    view === 'canvas' &&
    rail === 'tabs' &&
    Boolean(dockedTab) &&
    !tabsPopup &&
    (leftOpen || codingFullscreen)
  agentSideVisibleRef.current =
    (agentVisibleRef.current || dockedVisibleRef.current) && sideBrowsers.length > 0
  chatBrowserVisibleRef.current = false

  const clearAgentFsToolbarTimer = () => {
    if (agentFsToolbarTimer.current != null) {
      window.clearTimeout(agentFsToolbarTimer.current)
      agentFsToolbarTimer.current = null
    }
  }

  const dismissCanvasToolbar = () => {
    clearAgentFsToolbarTimer()
    setToolbarHiddenForAgentFs(true)
  }

  const restoreCanvasToolbar = () => {
    if (codingFullscreenRef.current || sideBrowsersRef.current.length > 0) return
    clearAgentFsToolbarTimer()
    const delay = reduceMotion ? 0 : TOOLBAR_FS_RETURN_DELAY_MS
    agentFsToolbarTimer.current = window.setTimeout(() => {
      agentFsToolbarTimer.current = null
      if (!codingFullscreenRef.current && sideBrowsersRef.current.length === 0) {
        setToolbarHiddenForAgentFs(false)
      }
    }, delay)
  }

  const clearSideBrowserSlots = () => {
    if (sideBrowsersRef.current.length === 0) return
    for (const item of sideBrowsersRef.current) {
      void window.vanta.closeBrowser(item.id).catch(() => undefined)
    }
    sideBrowsersRef.current = []
    setSideBrowsers([])
    agentSideHoles.current.clear()
  }

  const collapseAgentWorkspace = () => {
    clearAgentFsToolbarTimer()
    agentFsPending.current = null
    autoFsForSplitRef.current = false
    clearSideBrowserSlots()
    if (codingFullscreenRef.current) {
      codingFullscreenRef.current = false
      setCodingFullscreen(false)
      setRightOpen(rightOpenBeforeAgentFs.current)
    }
    restoreCanvasToolbar()
    requestAnimationFrame(() => syncLayout())
  }

  const enterCodingFullscreen = () => {
    if (codingFullscreenRef.current || agentFsPending.current === 'enter') return
    setCodingPopup(false)
    setTabsPopup(false)
    rightOpenBeforeAgentFs.current = rightOpen
    setLeftOpen(true)
    setRightOpen(false)
    clearAgentFsToolbarTimer()
    const toolbarOnScreen = view === 'canvas' && rail !== 'chat' && !toolbarHiddenForAgentFs
    if (reduceMotion || !toolbarOnScreen) {
      setToolbarHiddenForAgentFs(true)
      setCodingFullscreen(true)
      return
    }
    // 1) toolbar exits fully off-screen, 2) then agent expands (onExitComplete)
    agentFsPending.current = 'enter'
    setToolbarHiddenForAgentFs(true)
  }

  const exitCodingFullscreen = () => {
    clearAgentFsToolbarTimer()
    // Cancel an in-progress enter / side-open (toolbar still sliding out).
    if (agentFsPending.current === 'enter' || agentFsPending.current === 'side-enter') {
      agentFsPending.current = null
      autoFsForSplitRef.current = false
      clearSideBrowserSlots()
      setRightOpen(rightOpenBeforeAgentFs.current)
      if (codingFullscreenRef.current) {
        codingFullscreenRef.current = false
        setCodingFullscreen(false)
      }
      setToolbarHiddenForAgentFs(false)
      requestAnimationFrame(() => syncLayout())
      return
    }
    // Side panes lock split layout — exiting FS must tear them down too,
    // otherwise Escape leaves dual-fill with no FS control and a hidden toolbar.
    if (sideBrowsersRef.current.length > 0 || codingFullscreenRef.current) {
      collapseAgentWorkspace()
    }
  }

  const appendSideBrowser = () => {
    const used = new Set(sideBrowsersRef.current.map((item) => item.id))
    const id = AGENT_SIDE_BROWSER_IDS.find((slot) => !used.has(slot))
    if (!id) return
    const next = [...sideBrowsersRef.current, { id, url: AGENT_SIDE_BROWSER_HOME }]
    sideBrowsersRef.current = next
    setSideBrowsers(next)
    setToolbarHiddenForAgentFs(true)
    // 2+ panes → auto fullscreen; hide the fullscreen control while split.
    if (next.length >= 1 && !codingFullscreenRef.current) {
      autoFsForSplitRef.current = true
      enterCodingFullscreen()
    }
  }

  const openAgentSideBrowser = () => {
    if (sideBrowsersRef.current.length >= AGENT_SIDE_BROWSER_MAX) return
    clearAgentFsToolbarTimer()

    const finishOpen = () => {
      agentFsPending.current = null
      appendSideBrowser()
    }

    // Already waiting on toolbar exit — don't stack another pending open.
    if (agentFsPending.current === 'side-enter') return

    const toolbarOnScreen = view === 'canvas' && rail !== 'chat' && !toolbarHiddenForAgentFs
    if (reduceMotion || !toolbarOnScreen || sideBrowsersRef.current.length > 0) {
      finishOpen()
      return
    }
    // 1) toolbar exits fully off-screen, 2) then side browser opens
    agentFsPending.current = 'side-enter'
    setToolbarHiddenForAgentFs(true)
    // Fallback: AnimatePresence onExitComplete can miss if the toolbar wasn't mounted.
    window.setTimeout(() => {
      if (agentFsPending.current === 'side-enter') finishOpen()
    }, 220)
  }

  const closeSideBrowser = (id: string) => {
    if (agentFsPending.current === 'side-enter') {
      agentFsPending.current = null
      autoFsForSplitRef.current = false
      setToolbarHiddenForAgentFs(false)
      return
    }
    const next = sideBrowsersRef.current.filter((item) => item.id !== id)
    sideBrowsersRef.current = next
    setSideBrowsers(next)
    agentSideHoles.current.delete(id)
    void window.vanta.closeBrowser(id).catch(() => undefined)
    if (next.length === 0) {
      autoFsForSplitRef.current = false
      if (codingFullscreenRef.current) {
        clearAgentFsToolbarTimer()
        agentFsPending.current = null
        codingFullscreenRef.current = false
        setCodingFullscreen(false)
        setRightOpen(rightOpenBeforeAgentFs.current)
      }
      restoreCanvasToolbar()
    }
    requestAnimationFrame(() => syncLayout())
  }

  const closeAllSideBrowsers = () => {
    collapseAgentWorkspace()
  }

  const isSidebarBrowserId = (id: string) =>
    id === SIDEBAR_BROWSER_ID || (AGENT_SIDE_BROWSER_IDS as readonly string[]).includes(id)

  const switchOmniboxTab = (windowId: string, tabId: string) => {
    // Coding-agent / side-browser panes — just focus that WebContentsView.
    if (isSidebarBrowserId(tabId) || isSidebarBrowserId(windowId)) {
      const target = isSidebarBrowserId(tabId) ? tabId : windowId
      void window.vanta.focus(target)
      requestAnimationFrame(() => syncLayout())
      return
    }
    // Canvas tab: pull it to the front like Chrome.
    if (codingFullscreenRef.current) exitCodingFullscreen()
    selectBrowsers([windowId])
    setDesignSelectedIds([])
    patchFrame(windowId, { activeTabId: tabId })
    void window.vanta.activateTab(windowId, tabId).then(() => {
      void window.vanta.focus(tabId)
      syncLayout()
    })
  }

  const undockBrowserTab = () => {
    const wasDocked = Boolean(dockedTabRef.current)
    dockedTabRef.current = null
    setDockedTab(null)
    if (!wasDocked) return
    dockedVisibleRef.current = false
    agentSideVisibleRef.current = false
    collapseAgentWorkspace()
  }

  const openFileSidebarIfNoTabs = (remaining?: Frame[]) => {
    const list = remaining ?? browsersRef.current
    if (list.some((frame) => frame.tabs.length > 0)) return
    if (dockedTabRef.current) undockBrowserTab()
    setTabsPopup(false)
    if (railRef.current === 'tabs') {
      railRef.current = 'file'
      setRail('file')
      setLeftOpen(true)
      setView('canvas')
    }
  }

  const openTabsSidebar = () => {
    railRef.current = 'tabs'
    setRail('tabs')
    setLeftOpen(true)
    setView('canvas')
    setTabsPopup(false)
  }

  const closeBrowserTab = (windowId: string, tabId: string) => {
    if (dockedTabRef.current?.tabId === tabId) undockBrowserTab()
    const frame = browsersRef.current.find((item) => item.id === windowId)
    const closingLastInWindow = Boolean(frame && frame.tabs.length <= 1)
    const next = closingLastInWindow
      ? browsersRef.current.filter((item) => item.id !== windowId)
      : browsersRef.current.map((item) =>
          item.id !== windowId
            ? item
            : {
                ...item,
                tabs: item.tabs.filter((tab) => tab.id !== tabId),
                activeTabId:
                  item.activeTabId === tabId
                    ? item.tabs.filter((tab) => tab.id !== tabId).at(-1)?.id || item.activeTabId
                    : item.activeTabId
              }
        )
    if (closingLastInWindow) {
      holes.current.delete(windowId)
      if (selectedBrowserRef.current.includes(windowId)) {
        selectBrowsers(selectedBrowserRef.current.filter((id) => id !== windowId))
      }
    }
    browsersRef.current = next
    setBrowsers(next)
    if (!next.some((frame) => frame.tabs.length > 0)) {
      if (dockedTabRef.current) undockBrowserTab()
      setTabsPopup(false)
      railRef.current = 'file'
      setRail('file')
      setLeftOpen(true)
      setView('canvas')
    }
    void window.vanta.closeTab(windowId, tabId)
  }

  const closeBrowserWindow = (windowId: string) => {
    holes.current.delete(windowId)
    if (dockedTabRef.current?.windowId === windowId) undockBrowserTab()
    const next = browsersRef.current.filter((item) => item.id !== windowId)
    browsersRef.current = next
    setBrowsers(next)
    if (selectedBrowserRef.current.includes(windowId)) {
      setInspectOn(false)
      selectBrowsers(selectedBrowserRef.current.filter((id) => id !== windowId))
    }
    if (!next.some((frame) => frame.tabs.length > 0)) {
      if (dockedTabRef.current) undockBrowserTab()
      setTabsPopup(false)
      railRef.current = 'file'
      setRail('file')
      setLeftOpen(true)
      setView('canvas')
    }
    void window.vanta.closeBrowser(windowId)
  }

  const closeCodingAgent = () => {
    if (!codingActive) return
    agentVisibleRef.current = false
    agentSideVisibleRef.current = false
    collapseAgentWorkspace()
    setCodingActive(null)
    setCodingAgentUrl('')
    void window.vanta.closeBrowser(SIDEBAR_BROWSER_ID).catch(() => undefined)
    setCodingPopup(false)
    // Return to MCP gate in the coding-agents sidebar (not File).
    railRef.current = 'coding-agents'
    setRail('coding-agents')
    setLeftOpen(true)
    setView('canvas')
    requestAnimationFrame(() => syncLayout())
  }

  const dockBrowserTab = (windowId: string, tabId: string) => {
    const already = dockedTabRef.current?.tabId === tabId
    if (already && rail === 'tabs' && (leftOpen || codingFullscreenRef.current)) {
      undockBrowserTab()
      return
    }
    if (codingFullscreenRef.current && !already) exitCodingFullscreen()
    const next = { windowId, tabId }
    dockedTabRef.current = next
    setDockedTab(next)
    openTabsSidebar()
    selectBrowsers([windowId])
    patchFrame(windowId, { activeTabId: tabId })
    void window.vanta.activateTab(windowId, tabId)
    void window.vanta.setTheme?.(theme)
    requestAnimationFrame(() => syncLayout())
  }

  // Empty Tabs section is never shown — fall back to File when the last tab goes away.
  useEffect(() => {
    const hasTabs = browsers.some((frame) => frame.tabs.length > 0)
    if (!hasTabs && railRef.current === 'tabs') {
      openFileSidebarIfNoTabs(browsers)
    }
  }, [browsers])

  useEffect(() => {
    return () => clearAgentFsToolbarTimer()
  }, [])

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
            (node.type === 'frame' ? 'Frame' : node.type === 'section' ? 'Section' : node.type),
          selected: designSelectedIds.includes(node.id),
          textOnPath: isTextOnPath(node),
          vector: node.type === 'image' && Boolean(node.svgMarkup?.trim()),
          depth,
          parentId: node.parentId || null,
          container: node.type === 'frame' || node.type === 'section',
          hidden: node.visible === false,
          locked: Boolean(node.locked)
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
        selected: selectedBrowserIds.includes(frame.id),
        depth: 0
      })
    }
    return items
  })()

  const selectBrowsers = (ids: string[]) => {
    selectedBrowserRef.current = ids
    setSelectedBrowserIds(ids)
    setSelectedId(ids.length ? ids[ids.length - 1]! : null)
  }

  const clearBrowserSelection = () => {
    selectedBrowserRef.current = []
    setSelectedBrowserIds([])
    setSelectedId(null)
  }

  const captureActiveFileThumbnail = useCallback(async (fileId?: string) => {
    const id = fileId || activeFileIdRef.current
    if (!id) return
    try {
      const page =
        pagesRef.current.find((item) => item.id === activePageRef.current) || pagesRef.current[0]
      const design = designsByFileRef.current[id] || designRef.current
      const pageId = activePageRef.current
      const lightUrl = await renderPageThumbnailDataUrl(design, pageId, {
        theme: 'light',
        pageFill: resolvePageFill(page || { fill: '#EEEEEE' }, 'light')
      })
      // Separate tasks so a heavy page never blocks input for both renders at once.
      await new Promise<void>((resolve) => window.requestIdleCallback(() => resolve(), { timeout: 2000 }))
      const darkUrl = await renderPageThumbnailDataUrl(design, pageId, {
        theme: 'dark',
        pageFill: resolvePageFill(page || { fill: '#EEEEEE', fillDark: '#2C2C2C' }, 'dark')
      })
      if (!lightUrl && !darkUrl) return
      setFiles((current) =>
        current.map((file) =>
          file.id === id
            ? {
                ...file,
                thumbnailUrl: lightUrl || file.thumbnailUrl,
                thumbnailDarkUrl: darkUrl || file.thumbnailDarkUrl
              }
            : file
        )
      )
    } catch {
      // Rasterize can fail on exotic fills; keep the previous thumb.
    }
  }, [])

  const scheduleThumbnailCapture = useCallback(
    (fileId?: string) => {
      if (thumbTimer.current) window.clearTimeout(thumbTimer.current)
      // Wait for a pause in editing, then render when the main thread is idle.
      thumbTimer.current = window.setTimeout(() => {
        window.requestIdleCallback(() => void captureActiveFileThumbnail(fileId), { timeout: 4000 })
      }, 1500)
    },
    [captureActiveFileThumbnail]
  )

  // Keep light + dark thumbs fresh so Home swaps instantly on theme toggle.
  useEffect(() => {
    void captureActiveFileThumbnail(activeFileIdRef.current)
    const ids = Object.keys(designsByFileRef.current)
    for (const id of ids) {
      if (id === activeFileIdRef.current) continue
      if ((designsByFileRef.current[id] || []).length) {
        void captureActiveFileThumbnail(id)
      }
    }
  }, [theme, captureActiveFileThumbnail])

  const logCanvasHistory = (text: string) => {
    setChats(current => current.map(chat => chat.id === activeChatIdRef.current ? { ...chat, messages: [...chat.messages, { role: 'assistant' as const, text }] } : chat))
  }

  // Version timeline for the Chat › History panel: one entry per settled change, newest first.
  const [canvasHistory, setCanvasHistory] = useState<HistoryEntry[]>([])
  const canvasHistoryRef = useRef<HistoryEntry[]>([])
  const historyPendingRef = useRef<{ nodes: DesignNode[]; source: HistorySource; label?: string } | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const commitCanvasHistory = (entries: HistoryEntry[]) => {
    canvasHistoryRef.current = entries
    setCanvasHistory(entries)
  }
  const resetCanvasHistory = (nodes: DesignNode[]) => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = null
    historyPendingRef.current = null
    commitCanvasHistory([
      { id: crypto.randomUUID(), at: Date.now(), label: 'Opened the file', source: 'you', snapshot: structuredClone(nodes) }
    ])
  }
  const flushCanvasHistory = () => {
    historyTimerRef.current = null
    const pending = historyPendingRef.current
    historyPendingRef.current = null
    if (!pending) return
    const entries = canvasHistoryRef.current
    const label = pending.label || (entries[0] ? describeDesignChange(entries[0].snapshot, pending.nodes) : 'Started the file')
    if (!label) return
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      at: Date.now(),
      label,
      source: pending.source,
      snapshot: structuredClone(pending.nodes)
    }
    commitCanvasHistory([entry, ...entries].slice(0, 80))
  }
  /** Bursts (a drag, an agent's run of tool calls) settle into one entry. */
  const noteDesignChange = (nodes: DesignNode[], source: HistorySource, label?: string) => {
    historyPendingRef.current = { nodes, source, label: label || historyPendingRef.current?.label }
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = window.setTimeout(flushCanvasHistory, 600)
  }
  const noteDesignChangeRef = useRef(noteDesignChange)
  noteDesignChangeRef.current = noteDesignChange
  const resetCanvasHistoryRef = useRef(resetCanvasHistory)
  resetCanvasHistoryRef.current = resetCanvasHistory
  const pushDesignHistory = (snapshot: DesignNode[]) => {
    designUndoPastRef.current.push(structuredClone(snapshot))
    if (designUndoPastRef.current.length > 80) designUndoPastRef.current.shift()
    designUndoFutureRef.current = []
    refreshHistory(value => value + 1)
    logCanvasHistory('Canvas change recorded. Use Undo to restore the previous version.')
  }

  const clearDesignHistory = () => {
    designUndoPastRef.current = []
    designUndoFutureRef.current = []
    designHistoryGestureRef.current = false
  }

  const isDesignGenerationBusy = () =>
    createSvgBusyRef.current || buildingIdsRef.current.length > 0

  const applyDesignSnapshot = (nodes: DesignNode[]) => {
    designHistoryLockRef.current = true
    designHistoryGestureRef.current = false
    designRef.current = nodes
    setDesign(nodes)
    const fileId = activeFileIdRef.current
    if (fileId) designsByFileRef.current[fileId] = nodes
    setDesignSelectedIds((ids) => ids.filter((id) => nodes.some((node) => node.id === id)))
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    sendDesignToMain(nodes)
    scheduleThumbnailCapture()
    designHistoryLockRef.current = false
  }

  const undoDesign = () => {
    if (isDesignGenerationBusy() || designHistoryLockRef.current) return
    const prev = designUndoPastRef.current.pop()
    if (!prev) return
    designUndoFutureRef.current.push(structuredClone(designRef.current))
    applyDesignSnapshot(prev)
    noteDesignChange(prev, 'you', 'Undid a change')
    refreshHistory(value => value + 1)
    logCanvasHistory('Undid the last canvas change.')
  }

  const redoDesign = () => {
    if (isDesignGenerationBusy() || designHistoryLockRef.current) return
    const next = designUndoFutureRef.current.pop()
    if (!next) return
    designUndoPastRef.current.push(structuredClone(designRef.current))
    applyDesignSnapshot(next)
    noteDesignChange(next, 'you', 'Redid a change')
    refreshHistory(value => value + 1)
    logCanvasHistory('Redid the canvas change.')
  }

  const persistDesign = (
    next: DesignNode[],
    opts?: { skipReflow?: boolean; skipHistory?: boolean; fromJev?: boolean; historyLabel?: string }
  ) => {
    // A hand edit while words sit in the chat composer clears them and their unsent preview.
    if (!opts?.fromJev) next = discardJevDraftRef.current(next)
    const flowed = opts?.skipReflow ? next : reflowAutoLayout(next)
    if (!opts?.skipHistory && !designHistoryLockRef.current && !isDesignGenerationBusy()) {
      if (opts?.skipReflow) {
        // First move/resize tick in a gesture: snapshot the pre-gesture tree once.
        if (!designHistoryGestureRef.current) {
          pushDesignHistory(designRef.current)
          designHistoryGestureRef.current = true
        }
      } else if (!designHistoryGestureRef.current) {
        // Discrete edit. Skip no-op commits that only re-run reflow on the same tree.
        if (next !== designRef.current) pushDesignHistory(designRef.current)
      } else {
        designHistoryGestureRef.current = false
      }
    }
    designRef.current = flowed
    setDesign(flowed)
    const fileId = activeFileIdRef.current
    if (fileId) designsByFileRef.current[fileId] = flowed
    if (!opts?.skipHistory) noteDesignChange(flowed, opts?.fromJev ? 'chat' : 'you', opts?.historyLabel)
    if (opts?.skipReflow) return
    if (persistTimer.current) window.clearTimeout(persistTimer.current)
    persistTimer.current = window.setTimeout(() => {
      sendDesignToMain(flowed)
      scheduleThumbnailCapture()
    }, 200)
  }

  const liftPendingFlexChildren = () => {
    const roots = pendingLiftRef.current
    if (!roots) return
    pendingLiftRef.current = null
    const parentIds = new Set(
      roots
        .map((nodeId) => designRef.current.find((item) => item.id === nodeId)?.parentId)
        .filter((parentId): parentId is string => Boolean(parentId))
    )
    let lifted = false
    let next = designRef.current.map((node) => {
      if (!roots.includes(node.id) || !node.parentId) return node
      const parent = designRef.current.find((item) => item.id === node.parentId)
      if (!parent || !isAutoLayout(parent) || node.layoutAbsolute) return node
      lifted = true
      return { ...node, layoutAbsolute: true }
    })
    if (!lifted) return
    for (const parentId of parentIds) {
      const parent = next.find((node) => node.id === parentId)
      if (parent && isAutoLayout(parent)) next = reorderAutoLayoutChildren(next, parentId)
    }
    persistDesign(next)
  }

  /** Write the crop window (layer box) and image rect back onto the layer as a Crop-mode image fill. */
  const applyCropRects = (session: CropSession, frame: CropRect, image: CropRect) => {
    const nodes = designRef.current
    const node = nodes.find((item) => item.id === session.nodeId)
    if (!node) return
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : null
    const parentWorld = parent ? resolveWorldRect(parent, nodes) : null
    const width = Math.max(1, frame.width)
    const height = Math.max(1, frame.height)
    const fills = getNodePaints(node).map((paint, index) =>
      index === session.paintIndex && paint.type === 'image'
        ? {
            ...paint,
            imageDataUrl: paint.imageDataUrl || session.src,
            scaleMode: 'crop' as const,
            imageBox: {
              x: (image.x - frame.x) / width,
              y: (image.y - frame.y) / height,
              w: image.width / width,
              h: image.height / height
            }
          }
        : paint
    )
    const patched: DesignNode = {
      ...node,
      x: parentWorld ? frame.x - parentWorld.x : frame.x,
      y: parentWorld ? frame.y - parentWorld.y : frame.y,
      width,
      height,
      fills
    }
    persistDesign(
      nodes.map((item) => (item.id === node.id ? patched : item)),
      { skipReflow: true, skipHistory: true }
    )
    setCropSession({ ...session, frame, image })
  }

  const startImageCrop = (nodeId: string) => {
    if (cropSessionRef.current) return
    const node = designRef.current.find((item) => item.id === nodeId)
    if (!node || node.locked) return
    const paints = getNodePaints(node)
    const paintIndex = paints.findIndex((paint) => paint.type === 'image' && (paint.imageDataUrl || node.imageDataUrl))
    if (paintIndex < 0) return
    const paint = paints[paintIndex]
    if (paint.type !== 'image') return
    const src = paint.imageDataUrl || node.imageDataUrl || ''
    const probe = new Image()
    probe.onload = () => {
      const latest = designRef.current.find((item) => item.id === nodeId)
      if (!latest || cropSessionRef.current) return
      const natural = { w: probe.naturalWidth || 1, h: probe.naturalHeight || 1 }
      const frame = resolveWorldRect(latest, designRef.current)
      const current = getNodePaints(latest)[paintIndex]
      const box = current?.type === 'image' && current.scaleMode === 'crop' ? current.imageBox : undefined
      const image: CropRect = box
        ? {
            x: frame.x + box.x * frame.width,
            y: frame.y + box.y * frame.height,
            width: box.w * frame.width,
            height: box.h * frame.height
          }
        : current?.type === 'image' && current.scaleMode === 'fit'
          ? containRect(frame, natural)
          : coverRect(frame, natural)
      const session: CropSession = {
        nodeId,
        paintIndex,
        before: latest,
        designBefore: designRef.current,
        natural,
        src,
        aspect: 'free',
        frame,
        image
      }
      setCropSession(session)
      applyCropRects(session, frame, image)
    }
    probe.src = src
  }

  const finishImageCrop = (apply: boolean) => {
    const session = cropSessionRef.current
    if (!session) return
    setCropSession(null)
    if (apply) {
      pushDesignHistory(session.designBefore)
      persistDesign(designRef.current, { skipHistory: true })
    } else {
      persistDesign(
        designRef.current.map((item) => (item.id === session.nodeId ? session.before : item)),
        { skipHistory: true }
      )
    }
  }

  const startImageCropRef = useRef(startImageCrop)
  startImageCropRef.current = startImageCrop
  const finishImageCropRef = useRef(finishImageCrop)
  finishImageCropRef.current = finishImageCrop

  // Fill picker "Crop" mode opens the on-canvas crop editor for the selected layer.
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (id) {
        startImageCropRef.current(id)
        return
      }
      const ids = designSelectedRef.current
      if (ids.length === 1) startImageCropRef.current(ids[0])
    }
    window.addEventListener('vanta:image-crop', open)
    return () => window.removeEventListener('vanta:image-crop', open)
  }, [])

  // Selecting something else applies the crop (Figma).
  useEffect(() => {
    const session = cropSessionRef.current
    if (session && !designSelectedIds.includes(session.nodeId)) finishImageCropRef.current(true)
  }, [designSelectedIds])

  const moveLayersInPanel = (ids: string[], target: LayerDropTarget) => {
    const next = moveLayers(designRef.current, ids, target)
    if (next) persistDesign(next)
  }

  const reorderDesignChildren = (parentId: string, orderedIds: string[], parentPatch?: Partial<DesignNode>) => {
    const kidIds = new Set(orderedIds)
    const byId = new Map(designRef.current.map((node) => [node.id, node]))
    const ordered = orderedIds.map((id) => byId.get(id)).filter((node): node is DesignNode => Boolean(node))
    let inserted = false
    const next: DesignNode[] = []
    for (const node of designRef.current) {
      if (parentPatch && node.id === parentId) {
        next.push({ ...node, ...parentPatch })
        continue
      }
      if (!kidIds.has(node.id) || node.parentId !== parentId) {
        next.push(node)
        continue
      }
      if (!inserted) {
        next.push(...ordered)
        inserted = true
      }
    }
    persistDesign(next)
  }

  const jev = useJev({
    getCanvas: () => {
      const canvas = canvasRef.current
      return {
        nodes: designRef.current,
        pageId: activePageRef.current,
        defaultPageId: DEFAULT_PAGE.id,
        pointerId: null,
        selectedIds: designSelectedRef.current,
        lastTargetId: null,
        center: canvas
          ? screenToWorld(cameraRef.current, canvas.clientWidth / 2, canvas.clientHeight / 2)
          : { x: 120, y: 120 }
      }
    },
    persist: (nodes) => persistDesign(nodes, { fromJev: true }),
    onOpenSidebar: () => {
      setRightOpen(true)
      setRightWidth((width) => Math.max(width, 300))
    },
    runCommand: (id, request) => runJevCommand(id, request),
    delegate: (request) => delegateToClaude(request),
    canDelegate: () => agentConfiguredRef.current,
    onRequest: (decisionId, request) => {
      const chatId = activeChatIdRef.current
      setChats((current) => {
        const targetId = chatId && current.some((chat) => chat.id === chatId) ? chatId : current[0]?.id
        return current.map((chat) =>
          chat.id === targetId
            ? {
                ...chat,
                title: chat.title === 'New chat' ? request.slice(0, 42) : chat.title,
                messages: [
                  ...chat.messages,
                  { role: 'user', text: request },
                  { role: 'assistant', text: '', jevId: decisionId }
                ]
              }
            : chat
        )
      })
    }
  })
  const jevThread = { onUndo: jev.undo, onEdit: (index: number, text: string) => { void sendChat(text, index) } }
  discardJevDraftRef.current = jev.discardForManualEdit

  // Copy each finished decision into its chat message so history survives after Jev drops old decisions.
  useEffect(() => {
    const byId = new Map(jev.decisions.map((decision) => [decision.id, decision]))
    setChats((current) => {
      let changed = false
      const next = current.map((chat) => {
        let chatChanged = false
        const messages = chat.messages.map((message) => {
          if (!message.jevId) return message
          const decision = byId.get(message.jevId)
          if (!decision || decision === message.jev) return message
          chatChanged = true
          return {
            ...message,
            jev: decision,
            text: decision.status === 'error' ? decision.error || message.text : decision.result || message.text
          }
        })
        if (!chatChanged) return chat
        changed = true
        return { ...chat, messages }
      })
      return changed ? next : current
    })
  }, [jev.decisions])
  const jevComposer = {
    chatModel: resolveChatModel(activeChat?.model),
    onChatModel: (model: ChatModelId) => setChats(current => current.map(chat => chat.id === resolvedChatId ? { ...chat, model } : chat)),
    on: jev.on,
    onToggle: jev.setOn,
    micOn: jev.voice.active,
    onMic: jev.toggleMic,
    onDraft: () => undefined,
    onApplyDraft: (text: string) => {
      setChatInput('')
      void sendChat(text)
    },
    picking: jev.picking,
    onTogglePick: () => {
      const next = !jev.picking
      jev.setPicking(next)
      if (next) {
        setTool('pointer')
        setHandMode(false)
      }
    },
    selectionCount:
      designSelectedIds.length > 0 ? designSelectedIds.length : jev.pointerId ? 1 : 0,
    pointerLabel: jev.pointerLabel,
    locked: jev.locked,
    voiceState: jev.voice.state,
    level: jev.voice.level,
    voiceError: jev.voice.error,
    model: jev.voice.model,
    configured: jev.configured,
    onToggleLock: jev.toggleLock,
    onClearTarget: () => {
      jev.clearTarget()
      designSelectedRef.current = []
      setDesignSelectedIds([])
    },
    onSaveKey: (key: string) => void jev.saveKey(key),
    clearTick: jev.draftClearTick
  }

  useEffect(() => {
    void window.vanta.quiverStatus().then((status) => setQuiverConfigured(status.configured))
    void window.vanta.agentStatus?.().then((status) => {
      agentConfiguredRef.current = status.configured
    })
  }, [])

  // Agents (Claude in chat, MCP coding agents) ask the canvas to render layers so they can see their work.
  useEffect(() => {
    if (typeof window.vanta.onRpc !== 'function') return
    const target = (id: string | undefined) => {
      const nodes = designRef.current
      const onPage = nodes.filter((node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
      // No id: the most recently added top-level frame on this page, which is usually what was just built.
      const node = id
        ? nodes.find((item) => item.id === id)
        : [...onPage].reverse().find((item) => !item.parentId && (item.type === 'frame' || item.type === 'section'))
      if (!node) throw new Error(id ? `No layer with id ${id}.` : 'There is no frame on this page to render.')
      return { node, nodes, onPage: (node.pageId || DEFAULT_PAGE.id) === activePageRef.current }
    }
    let savedCamera: Camera | null = null
    return window.vanta.onRpc(async (method, args) => {
      // Real pixels: fit the layer in view, hide Scobe's own chrome, and let main photograph the window.
      if (method === 'beginCapture') {
        const { id } = (args || {}) as { id?: string }
        const { node, nodes, onPage } = target(id)
        const canvas = canvasRef.current
        if (!onPage) throw new Error('layer is on another page')
        if (!canvas) throw new Error('the canvas is not open')
        const box = resolveWorldRect(node, nodes)
        const area = canvas.getBoundingClientRect()
        // The sidebars float over the canvas; fit the layer in the part that's actually visible.
        const shownRects = (selector: string) =>
          Array.from(document.querySelectorAll(selector))
            .map((el) => el.getBoundingClientRect())
            .filter((rect) => rect.width > 1 && rect.height > 1)
        // The left side is a narrow rail plus a separate panel; take whichever reaches furthest right.
        const leftCovers = shownRects('.leftbar, .leftbar-rail, .leftbar-panel:not(.is-collapsed)')
        const rightCovers = shownRects('.rightbar:not(.is-collapsed)')
        const visibleLeft = Math.max(area.left, ...leftCovers.map((rect) => rect.right))
        const visibleRight = Math.min(area.right, ...rightCovers.map((rect) => rect.left))
        const visibleWidth = Math.max(80, visibleRight - visibleLeft)
        const pad = 32
        const zoom = clampZoom(Math.min(2, (visibleWidth - pad * 2) / Math.max(1, box.width), (area.height - pad * 2) / Math.max(1, box.height)))
        const camera: Camera = {
          zoom,
          x: visibleLeft - area.left + (visibleWidth - box.width * zoom) / 2 - box.x * zoom,
          y: (area.height - box.height * zoom) / 2 - box.y * zoom
        }
        savedCamera = savedCamera || cameraRef.current
        applyCamera(camera)
        document.body.classList.add('scobe-capturing')
        // Two frames for layout, then time for the zoom re-raster so text is crisp. A covered window
        // gets no animation frames, so don't wait on them forever (main's capture forces a repaint).
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          new Promise((resolve) => window.setTimeout(resolve, 120))
        ])
        await new Promise((resolve) => window.setTimeout(resolve, 380))
        return {
          id: node.id,
          name: node.name || node.type,
          width: Math.round(box.width),
          height: Math.round(box.height),
          rect: {
            x: area.left + camera.x + box.x * zoom,
            y: area.top + camera.y + box.y * zoom,
            width: box.width * zoom,
            height: box.height * zoom
          }
        }
      }
      if (method === 'endCapture') {
        document.body.classList.remove('scobe-capturing')
        if (savedCamera) applyCamera(savedCamera)
        savedCamera = null
        return true
      }
      if (method === 'renderNode') {
        const { id, maxEdge } = (args || {}) as { id?: string; maxEdge?: number }
        const { node, nodes } = target(id)
        const box = resolveWorldRect(node, nodes)
        const longest = Math.max(1, box.width, box.height)
        const scale = Math.max(0.2, Math.min(2, (maxEdge || 1568) / longest))
        const blob = await exportNodeAsPngBlob(node, nodes, scale)
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''))
          reader.onerror = () => reject(new Error('Could not read the rendered image.'))
          reader.readAsDataURL(blob)
        })
        return {
          id: node.id,
          name: node.name || node.type,
          base64,
          width: Math.round(box.width),
          height: Math.round(box.height),
          scale: Math.round(scale * 100) / 100
        }
      }
      if (method === 'getTokens') return { tokens: tokensForAgents() }
      throw new Error(`Unknown canvas request: ${method}`)
    })
  }, [])

  // Runs after the panel opens so Create SVG sees the current selection as its references.
  useEffect(() => {
    const job = pendingCreateSvgJob.current
    if (!job || !createSvgOpen || createSvgBusy) return
    pendingCreateSvgJob.current = null
    if (job.kind === 'remove-bg') {
      void runRemoveBackground()
      return
    }
    if (job.kind === 'vectorize') {
      void runVectorizeImages()
      return
    }
    void runCreateSvg({
      model: createSvgModel,
      prompt: job.prompt,
      n: 1,
      temperature: 0.4,
      reasoningEffort: 'medium',
      instructions:
        'Clean vector illustration, flat shapes, no raster effects. Fill the entire viewBox edge-to-edge — no white margins or padding around the artwork.',
      referenceBase64: selectedImageRef?.dataUrl || null
    })
  })

  useEffect(() => {
    if (!createSvgOpen) {
      setCreateSvgHiddenRefs([])
      setCreateSvgHiddenChips([])
      setCreateSvgPinnedRefs(null)
      return
    }
    // Warm the cutout model while the composer is open so Remove background is snappy.
    void window.vanta.warmRemoveBackground?.()
  }, [createSvgOpen])

  const createSvgContext = (() => {
    if (!createSvgOpen) {
      return {
        references: [] as Array<{ id: string; dataUrl: string }>,
        textChips: [] as Array<{ id: string; label: string }>,
        source: null as DesignNode | null,
        generationPrompt: ''
      }
    }
    // While generating, keep showing the original reference thumbs — not the draft SVG.
    if (createSvgBusy && createSvgPinnedRefs?.length) {
      const pinnedIds = new Set(createSvgPinnedRefs.map((ref) => ref.id.split(':')[0]))
      let generationPrompt = createSvgLastPrompt
      for (const id of designSelectedIds) {
        const node = design.find((item) => item.id === id)
        if (node?.generationPrompt?.trim()) {
          generationPrompt = node.generationPrompt.trim()
          break
        }
      }
      return {
        references: createSvgPinnedRefs,
        textChips: [] as Array<{ id: string; label: string }>,
        source: design.find((node) => pinnedIds.has(node.id)) || null,
        generationPrompt
      }
    }
    const selected = designSelectedIds.length
      ? designSelectedIds
      : jev.pointerId
        ? [jev.pointerId]
        : []
    const building = new Set(buildingIds)
    const tree = selected.length
      ? design.filter((node) => expandWithDescendants(design, new Set(selected)).has(node.id))
      : []
    const hiddenRefs = new Set(createSvgHiddenRefs)
    const hiddenChips = new Set(createSvgHiddenChips)
    const references: Array<{ id: string; dataUrl: string }> = []
    const seenUrls = new Set<string>()
    // Cap how many refs we surface — huge selections were freezing the composer.
    const MAX_REFS = 24
    for (const node of tree) {
      if (references.length >= MAX_REFS) break
      // Never show in-progress placeholder SVGs in the composer.
      if (building.has(node.id)) continue
      if (node.type === 'image') {
        const dataUrl =
          node.imageDataUrl ||
          (node.svgMarkup?.trim() ? svgToDataUrl(node.svgMarkup) : '')
        if (dataUrl && !hiddenRefs.has(node.id) && !seenUrls.has(dataUrl)) {
          seenUrls.add(dataUrl)
          references.push({ id: node.id, dataUrl })
        }
      } else if (
        (node.type === 'frame' || node.type === 'rect') &&
        node.svgMarkup?.trim() &&
        !node.imageDataUrl
      ) {
        // Generated SVG sometimes lives on the frame itself (LiveSvg).
        const dataUrl = svgToDataUrl(node.svgMarkup)
        if (!hiddenRefs.has(node.id) && !seenUrls.has(dataUrl)) {
          seenUrls.add(dataUrl)
          references.push({ id: node.id, dataUrl })
        }
      }
      for (const paint of getNodePaints(node)) {
        if (references.length >= MAX_REFS) break
        if (paint.type !== 'image' || !paint.imageDataUrl || paint.visible === false) continue
        const id = `${node.id}:paint`
        if (hiddenRefs.has(id) || seenUrls.has(paint.imageDataUrl)) continue
        seenUrls.add(paint.imageDataUrl)
        references.push({ id, dataUrl: paint.imageDataUrl })
      }
    }
    const textChips: Array<{ id: string; label: string }> = []
    const seenLabels = new Set<string>()
    const pushChip = (id: string, raw: string) => {
      if (textChips.length >= 60) return
      const label = raw.replace(/\s+/g, ' ').trim()
      if (!label) return
      if (hiddenChips.has(id) || seenLabels.has(label)) return
      seenLabels.add(label)
      textChips.push({ id, label })
    }
    // Surface selected roots so the composer grows for frames/elements/text —
    // images already appear as reference thumbs above.
    for (const id of selected) {
      const node = design.find((item) => item.id === id)
      if (!node || node.type === 'comment') continue
      if (node.type === 'image') {
        // Generation prompt is shown in the Create SVG header (Paper), not as a chip.
        if (node.generationPrompt?.trim()) continue
        if (node.name) pushChip(`name:${node.id}`, node.name)
        continue
      }
      if (node.type === 'text') {
        pushChip(node.id, node.text || node.name || 'Text')
        continue
      }
      pushChip(
        `sel:${node.id}`,
        node.name ||
          (node.type === 'frame'
            ? 'Frame'
            : node.type === 'section'
              ? 'Section'
              : `${node.type[0].toUpperCase()}${node.type.slice(1)}`)
      )
    }
    return {
      references,
      textChips,
      source: references[0]
        ? design.find((node) => node.id === references[0].id.split(':')[0]) || null
        : selected[0]
          ? design.find((node) => node.id === selected[0]) || null
          : null,
      generationPrompt: (() => {
        for (const id of selected) {
          const node = design.find((item) => item.id === id)
          if (node?.generationPrompt?.trim()) return node.generationPrompt.trim()
        }
        for (const ref of references) {
          const node = design.find((item) => item.id === ref.id.split(':')[0])
          if (node?.generationPrompt?.trim()) return node.generationPrompt.trim()
        }
        return ''
      })()
    }
  })()

  const createSvgHeaderPrompt = createSvgContext.generationPrompt || createSvgLastPrompt

  const selectedImageRef = createSvgContext.source
    ? {
        node: createSvgContext.source,
        dataUrl: createSvgContext.references[0]?.dataUrl || ''
      }
    : null

  const runExtractMagicSwatches = async () => {
    const refs = createSvgContext.references
    if (!refs.length) {
      setCreateSvgStatus('Select one or more images to extract colors.')
      return
    }
    const pageId = activePageRef.current
    const nodes = designRef.current
    const SWATCH_W = 100
    const SWATCH_H = 60
    const SWATCH_GAP = 8
    const PAD = 16
    const OUTER_GAP = 28
    const ROW_GAP = 16
    type Placed = { dataUrl: string; box: { x: number; y: number; width: number; height: number } }
    const placed: Placed[] = []
    for (const ref of refs) {
      const nodeId = ref.id.split(':')[0]
      const node = nodes.find((item) => item.id === nodeId)
      if (!node) continue
      placed.push({ dataUrl: ref.dataUrl, box: resolveWorldRect(node, nodes) })
    }
    if (!placed.length) {
      setCreateSvgStatus('Select one or more images to extract colors.')
      return
    }
    const minX = Math.min(...placed.map((item) => item.box.x))
    const minY = Math.min(...placed.map((item) => item.box.y))
    const maxX = Math.max(...placed.map((item) => item.box.x + item.box.width))
    const maxY = Math.max(...placed.map((item) => item.box.y + item.box.height))
    const multi = placed.length > 1
    const added: DesignNode[] = []
    const frameIds: string[] = []
    let cursorY = multi ? minY : maxY + OUTER_GAP
    let stackX = multi ? maxX + OUTER_GAP : minX

    try {
      for (let index = 0; index < placed.length; index++) {
        const item = placed[index]
        const colors = await sampleImageColors(item.dataUrl, 6)
        if (!colors.length) continue
        const frameW = PAD * 2 + colors.length * SWATCH_W + (colors.length - 1) * SWATCH_GAP
        const frameH = PAD * 2 + SWATCH_H
        const frameId = crypto.randomUUID()
        let x: number
        let y: number
        if (multi) {
          x = Math.round(stackX)
          y = Math.round(cursorY)
          cursorY += frameH + ROW_GAP
        } else {
          x = Math.round(item.box.x + (item.box.width - frameW) / 2)
          y = Math.round(item.box.y + item.box.height + OUTER_GAP)
        }
        added.push({
          id: frameId,
          type: 'frame',
          name: 'Magic Swatches',
          x,
          y,
          width: frameW,
          height: frameH,
          pageId,
          fills: [{ type: 'solid', color: '#FFFFFF', opacity: 1 }],
          fill: '#FFFFFF',
          clipsContent: false
        })
        colors.forEach((color, colorIndex) => {
          added.push({
            id: crypto.randomUUID(),
            type: 'rect',
            name: color.toUpperCase(),
            parentId: frameId,
            x: PAD + colorIndex * (SWATCH_W + SWATCH_GAP),
            y: PAD,
            width: SWATCH_W,
            height: SWATCH_H,
            pageId,
            fills: [{ type: 'solid', color, opacity: 1 }],
            fill: color,
            radius: 4
          })
        })
        frameIds.push(frameId)
      }
    } catch {
      setCreateSvgStatus('Couldn’t extract colors from those images.')
      return
    }

    if (!added.length) {
      setCreateSvgStatus('Couldn’t extract colors from those images.')
      return
    }

    persistDesign([...designRef.current, ...added])
    setDesignSelectedIds(frameIds)
    setSelectedId(null)
    setCreateSvgStatus(null)
    const first = added[0]
    if (first.width && first.height) {
      nudgeIntoView(first.x, first.y, first.width, first.height)
    }
  }

  const createSvgPanel =
    createSvgOpen ? (
      <CreateSvgPanel
        open={createSvgOpen}
        prompt={createSvgPrompt}
        onPrompt={setCreateSvgPrompt}
        lastPrompt={createSvgHeaderPrompt}
        onCopyPrompt={() => undefined}
        onStartOverPrompt={() => {
          const text = createSvgHeaderPrompt.trim()
          if (!text) return
          setCreateSvgLastPrompt(text)
          setCreateSvgPrompt(text)

          // Prefer sources stored on the selected generated SVG.
          const selected = designSelectedRef.current
          let sourceIds: string[] = []
          for (const id of selected) {
            const node = designRef.current.find((item) => item.id === id)
            if (node?.generationSourceIds?.length) {
              sourceIds = node.generationSourceIds.filter((sourceId) =>
                designRef.current.some((item) => item.id === sourceId)
              )
              break
            }
          }
          if (!sourceIds.length) {
            for (const ref of createSvgContext.references) {
              const node = designRef.current.find((item) => item.id === ref.id.split(':')[0])
              if (node?.generationSourceIds?.length) {
                sourceIds = node.generationSourceIds.filter((sourceId) =>
                  designRef.current.some((item) => item.id === sourceId)
                )
                break
              }
            }
          }

          if (sourceIds.length) {
            setCreateSvgHiddenRefs((hidden) =>
              hidden.filter((id) => !sourceIds.some((sourceId) => id === sourceId || id.startsWith(`${sourceId}:`)))
            )
            setCreateSvgHiddenChips([])
            setDesignSelectedIds(sourceIds)
            setSelectedId(null)
            const first = designRef.current.find((item) => item.id === sourceIds[0])
            if (first) {
              const box = resolveWorldRect(first, designRef.current)
              nudgeIntoView(box.x, box.y, box.width, box.height)
            }
          }
        }}
        references={createSvgContext.references}
        onRemoveReference={(id) => setCreateSvgHiddenRefs((current) => [...current, id])}
        textChips={createSvgContext.textChips}
        onRemoveTextChip={(id) => setCreateSvgHiddenChips((current) => [...current, id])}
        model={createSvgModel}
        onModel={setCreateSvgModel}
        busy={createSvgBusy}
        status={createSvgStatus}
        configured={quiverConfigured}
        micOn={jev.voice.active}
        onMic={jev.toggleMic}
        hearing={jev.voice.state === 'hearing'}
        onSaveKey={(key) => {
          void window.vanta.quiverSetKey(key).then((status) => setQuiverConfigured(status.configured))
        }}
        onMenuAction={(action: CreateSvgMenuAction) => {
          if (action === 'vectorize') {
            if (!createSvgContext.references.length) return
            setCreateSvgStatus(null)
            void runVectorizeImages()
            return
          }
          if (action === 'extract-colors') {
            void runExtractMagicSwatches()
            return
          }
          if (action === 'remove-background') {
            if (!createSvgContext.references.length) {
              setCreateSvgStatus('Select an image to remove its background.')
              return
            }
            void runRemoveBackground()
          }
        }}
        onCreate={(input) => void runCreateSvg(input)}
        onAbort={() => window.vanta.quiverAbort()}
        onClose={() => exitCreateSvg()}
      />
    ) : null

  const runRemoveBackground = async () => {
    if (createSvgBusy) return
    const refs = createSvgContext.references
    if (!refs.length) {
      setCreateSvgStatus('Select an image to remove its background.')
      return
    }
    if (typeof window.vanta.removeBackground !== 'function') {
      window.alert('Restart Scobe to enable Remove background (preload needs a reload).')
      return
    }

    const nodeIds = [
      ...new Set(refs.map((ref) => ref.id.split(':')[0]).filter(Boolean))
    ]
    setCreateSvgBusy(true)
    createSvgBusyRef.current = true
    setBuildingIds((current) => [...new Set([...current, ...nodeIds])])
    setCreateSvgStatus('Removing background…')

    const stopProgress = window.vanta.onRemoveBackgroundProgress?.((message) => {
      if (message?.trim()) setCreateSvgStatus(message)
    })

    try {
      void window.vanta.warmRemoveBackground?.()

      let next = designRef.current
      let done = 0
      for (const ref of refs) {
        const nodeId = ref.id.split(':')[0]
        const paintOnly = ref.id.includes(':paint')
        const source = next.find((node) => node.id === nodeId)
        setCreateSvgStatus(
          refs.length > 1
            ? `Removing background… ${done + 1}/${refs.length}`
            : 'Removing background…'
        )
        // Cutout model needs a raster PNG — SVG data URLs fail.
        const world = source ? resolveWorldRect(source, next) : null
        const raster = await rasterizeToPngDataUrl(ref.dataUrl, {
          maxEdge: 2048,
          width: world ? Math.round(world.width) : undefined,
          height: world ? Math.round(world.height) : undefined
        })
        const forModel =
          raster.length > 1_200_000
            ? await rasterizeToPngDataUrl(raster, { maxEdge: 1600 })
            : raster
        // Transparent pixels decode as black to the model and get kept as "subject";
        // show it the color the user actually sees behind the image.
        const parent = source?.parentId ? next.find((node) => node.id === source.parentId) : null
        const isSolid = (color?: string) =>
          Boolean(color && color !== 'transparent' && !/^rgba?\([^)]*,\s*0\s*\)$/i.test(color))
        const backdrop = isSolid(source?.fill)
          ? source!.fill!
          : isSolid(parent?.fill)
            ? parent!.fill!
            : '#FFFFFF'
        const modelInput = await rasterizeToPngDataUrl(forModel, { background: backdrop })
        const result = await window.vanta.removeBackground(modelInput)
        if (!result.ok) {
          setCreateSvgStatus(result.error || 'Couldn’t remove background.')
          return
        }
        // Expand the mask so edges aren’t over-trimmed (imgly tends to chew subjects).
        let cutout = result.dataUrl
        try {
          cutout = await expandCutoutAlpha(forModel, result.dataUrl, 5)
        } catch {
          cutout = result.dataUrl
        }
        const parentId = source?.parentId || null

        next = next.map((node) => {
          // Paper: drop the solid plate behind a cut-out subject.
          if (parentId && node.id === parentId && node.type === 'frame') {
            return {
              ...node,
              svgMarkup: undefined,
              fill: 'transparent',
              fills: [{ type: 'solid' as const, color: '#FFFFFF', opacity: 0 }]
            }
          }
          if (node.id !== nodeId) return node

          if (paintOnly && node.fills?.length) {
            let matched = false
            const fills = node.fills.map((paint) => {
              if (matched || paint.type !== 'image' || paint.visible === false) return paint
              if (paint.imageDataUrl === ref.dataUrl) {
                matched = true
                return { ...paint, imageDataUrl: cutout }
              }
              return paint
            })
            if (!matched) {
              const idx = fills.findIndex((paint) => paint.type === 'image' && paint.visible !== false)
              if (idx >= 0) {
                const paint = fills[idx]
                if (paint.type === 'image') {
                  fills[idx] = { ...paint, imageDataUrl: cutout }
                  matched = true
                }
              }
            }
            return {
              ...node,
              fills,
              ...(node.type === 'image' || node.type === 'frame'
                ? { imageDataUrl: cutout, svgMarkup: undefined, fill: 'transparent' }
                : {})
            }
          }

          return {
            ...node,
            imageDataUrl: cutout,
            svgMarkup: undefined,
            fill: 'transparent',
            fills: [
              {
                type: 'image' as const,
                imageDataUrl: cutout,
                scaleMode: 'fill' as const,
                opacity: 1,
                visible: true
              }
            ]
          }
        })
        persistDesign(next)
        done += 1
      }

      setDesignSelectedIds(nodeIds)
      setSelectedId(null)
      setRevealIds((current) => [...new Set([...current, ...nodeIds])])
      window.setTimeout(() => {
        setRevealIds((current) => current.filter((id) => !nodeIds.includes(id)))
      }, 900)
      setCreateSvgStatus(null)
    } catch (error) {
      setCreateSvgStatus(error instanceof Error ? error.message : String(error))
    } finally {
      stopProgress?.()
      setBuildingIds((current) => current.filter((id) => !nodeIds.includes(id)))
      setCreateSvgBusy(false)
      createSvgBusyRef.current = false
    }
  }

  const runCreateSvg = async (input: QuiverGenerateInput) => {
    if (createSvgBusy) return
    const usedPrompt = input.prompt.trim()
    if (usedPrompt) {
      // Paper: keep the used prompt in the header with Copy / Start over icons.
      setCreateSvgLastPrompt(usedPrompt)
      setCreateSvgPrompt('')
    }
    const sourceIds = [
      ...new Set(
        createSvgContext.references
          .map((ref) => ref.id.split(':')[0])
          .filter((id) => designRef.current.some((node) => node.id === id))
      )
    ]
    // Freeze composer thumbs on the original reference(s) for the whole build.
    const pinnedRefs = createSvgContext.references.map((ref) => ({ ...ref }))
    setCreateSvgPinnedRefs(pinnedRefs.length ? pinnedRefs : null)
    const source =
      selectedImageRef?.node ||
      (sourceIds[0] ? designRef.current.find((node) => node.id === sourceIds[0]) : null) ||
      null
    const pageId = activePageRef.current
    const nodes = designRef.current
    const sourceWorld = (() => {
      if (source) return resolveWorldRect(source, nodes)
      // Multiple refs: place to the right of the selection bounds.
      const boxes = sourceIds
        .map((id) => nodes.find((node) => node.id === id))
        .filter((node): node is DesignNode => Boolean(node))
        .map((node) => resolveWorldRect(node, nodes))
      if (!boxes.length) return null
      const minX = Math.min(...boxes.map((box) => box.x))
      const minY = Math.min(...boxes.map((box) => box.y))
      const maxX = Math.max(...boxes.map((box) => box.x + box.width))
      const maxY = Math.max(...boxes.map((box) => box.y + box.height))
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    })()
    const width = Math.max(120, Math.round(sourceWorld?.width || source?.width || 512))
    const height = Math.max(120, Math.round(sourceWorld?.height || source?.height || 512))
    const gap = 48
    const count = Math.max(1, Math.min(4, input.n ?? 1))
    const canvas = canvasRef.current
    const cam = cameraRef.current
    const viewCenter = canvas
      ? screenToWorld(cam, canvas.clientWidth / 2, canvas.clientHeight / 2)
      : { x: 120, y: 120 }
    const totalW = count * width + (count - 1) * gap
    // Spawn to the right of the selected element (Paper). Fall back to viewport center.
    const originX = sourceWorld
      ? Math.round(sourceWorld.x + sourceWorld.width + gap)
      : Math.round(viewCenter.x - totalW / 2)
    const originY = sourceWorld
      ? Math.round(sourceWorld.y)
      : Math.round(viewCenter.y - height / 2)
    const slots: Array<{ frameId: string; imageId: string }> = []
    const added: DesignNode[] = []
    for (let i = 0; i < count; i++) {
      const imageId = crypto.randomUUID()
      // Bare SVG node — no parent frame (avoids pulling the SVG out of a box).
      slots.push({ frameId: imageId, imageId })
      added.push({
        id: imageId,
        type: 'image',
        name: count > 1 ? `SVG ${i + 1}` : 'SVG',
        x: originX + i * (width + gap),
        y: originY,
        width,
        height,
        pageId,
        svgMarkup: '',
        imageDataUrl: '',
        generationPrompt: usedPrompt || undefined,
        generationSourceIds: sourceIds.length ? sourceIds : undefined,
        fills: [{ type: 'image', imageDataUrl: '', scaleMode: 'fill', opacity: 1, visible: true }],
        fill: '#F4F5F7'
      })
    }
    createSvgSlots.current = slots
    createSvgFrameId.current = slots[0].frameId
    createSvgImageId.current = slots[0].imageId
    createSvgPending.current.clear()
    if (createSvgApplyRaf.current != null) {
      window.cancelAnimationFrame(createSvgApplyRaf.current)
      createSvgApplyRaf.current = null
    }

    persistDesign([...designRef.current, ...added])
    // Keep the original reference selected so the composer thumb stays stable.
    if (sourceIds.length) setDesignSelectedIds(sourceIds)
    setSelectedId(null)
    setBuildingIds((current) => [...new Set([...current, ...slots.map((slot) => slot.imageId)])])
    setCreateSvgBusy(true)
    createSvgBusyRef.current = true
    setCreateSvgStatus('Starting QuiverAI…')

    if (canvas) {
      const midX = originX + totalW / 2
      const midY = originY + height / 2
      const screen = worldToScreen(cam, midX, midY)
      applyCamera({
        ...cam,
        x: cam.x + (canvas.clientWidth / 2 - screen.x),
        y: cam.y + (canvas.clientHeight / 2 - screen.y) - 36
      })
    }

    const flushPending = (final = false) => {
      if (!createSvgPending.current.size) return
      const batch = new Map(createSvgPending.current)
      createSvgPending.current.clear()
      persistDesign(
        designRef.current.map((node) => {
          const svg = batch.get(node.id)
          if (!svg) return node
          const fitted = final
            ? fitSvgMarkup(svg, width, height, { crop: true })
            : { markup: normalizeSvgMarkup(svg, width, height), background: null as string | null }
          if (!fitted.markup) return node
          const dataUrl = final ? svgToDataUrl(fitted.markup) : node.imageDataUrl || ''
          return {
            ...node,
            svgMarkup: fitted.markup,
            imageDataUrl: final ? dataUrl : node.imageDataUrl || '',
            fill: fitted.background || 'transparent',
            fills: [
              {
                type: 'image',
                imageDataUrl: final ? dataUrl : node.imageDataUrl || '',
                scaleMode: 'fill',
                opacity: 1,
                visible: true
              }
            ]
          }
        }),
        { skipReflow: true }
      )
      if (final) {
        sendDesignToMain(designRef.current)
        scheduleThumbnailCapture()
      }
    }

    const pushSvg = (svg: string, index = 0) => {
      if (!svg?.trim()) return
      const slot = createSvgSlots.current[index] || createSvgSlots.current[0]
      if (!slot) return
      createSvgPending.current.set(slot.imageId, svg)
      if (createSvgApplyRaf.current != null) return
      createSvgApplyRaf.current = window.requestAnimationFrame(() => {
        createSvgApplyRaf.current = null
        flushPending(false)
      })
    }

    const stopListen = window.vanta.onQuiver((event) => {
      if (event.type === 'status') {
        if (!isQuiverCancelMessage(event.message)) setCreateSvgStatus(event.message)
      }
      if (event.type === 'reasoning') setCreateSvgStatus(event.text.slice(0, 100) || 'Reasoning…')
      if (event.type === 'draft' || event.type === 'content') {
        setCreateSvgStatus(null)
        pushSvg(event.svg, event.index ?? 0)
      }
      if (event.type === 'done') {
        setCreateSvgStatus(null)
        pushSvg(event.svg, 0)
      }
      if (event.type === 'error') {
        // Never surface cancel/terminate in the composer.
        if (!isQuiverCancelMessage(event.message)) setCreateSvgStatus(event.message)
      }
    })

    try {
      const referenceList = (
        input.references?.length
          ? input.references
          : [selectedImageRef?.dataUrl || input.referenceBase64 || null]
      ).filter((item): item is string => Boolean(item?.trim()))
      const shrunk: string[] = []
      for (const item of referenceList) {
        shrunk.push(item.length > 400_000 ? await shrinkImageDataUrl(item, 1024) : item)
      }
      const result = await window.vanta.quiverGenerateSvg({
        ...input,
        n: count,
        referenceBase64: shrunk[0] || null,
        references: shrunk,
        viewBox: { width, height }
      })
      if (createSvgApplyRaf.current != null) {
        window.cancelAnimationFrame(createSvgApplyRaf.current)
        createSvgApplyRaf.current = null
      }
      if (result.ok) {
        const slot = createSvgSlots.current[0]
        if (slot && result.svg) {
          createSvgPending.current.set(slot.imageId, result.svg)
        }
        flushPending(true)
        const frameIds = createSvgSlots.current.map((slot) => slot.frameId)
        setRevealIds((current) => [...new Set([...current, ...frameIds])])
        window.setTimeout(() => {
          setRevealIds((current) => current.filter((id) => !frameIds.includes(id)))
        }, 1100)
        // Done — swap composer to the finished SVG.
        setCreateSvgPinnedRefs(null)
        setDesignSelectedIds(frameIds)
        setCreateSvgStatus(null)
      } else if (isQuiverCancelMessage(result.error)) {
        // Stop button: keep whatever draft is on the canvas, no red status.
        flushPending(true)
        const frameIds = createSvgSlots.current.map((slot) => slot.frameId)
        setCreateSvgPinnedRefs(null)
        if (frameIds.length) setDesignSelectedIds(frameIds)
        setCreateSvgStatus(null)
      } else {
        // Drop empty placeholder SVGs so a failed run doesn't leave a blank box.
        const drop = new Set(createSvgSlots.current.map((slot) => slot.imageId))
        const hadPaint = designRef.current.some(
          (node) => drop.has(node.id) && Boolean(node.svgMarkup?.trim())
        )
        if (hadPaint) {
          flushPending(true)
          setCreateSvgPinnedRefs(null)
          setDesignSelectedIds(createSvgSlots.current.map((slot) => slot.frameId))
          setCreateSvgStatus(result.error)
        } else {
          persistDesign(designRef.current.filter((node) => !drop.has(node.id)))
          setCreateSvgPinnedRefs(null)
          if (sourceIds.length) setDesignSelectedIds(sourceIds)
          else setDesignSelectedIds([])
          setCreateSvgStatus(result.error)
        }
      }
    } finally {
      stopListen()
      const frameIds = createSvgSlots.current.map((slot) => slot.frameId)
      setBuildingIds((current) => current.filter((id) => !frameIds.includes(id)))
      setCreateSvgBusy(false)
      createSvgBusyRef.current = false
      // Safety: never leave pinned thumbs after the run ends.
      setCreateSvgPinnedRefs(null)
      createSvgFrameId.current = null
      createSvgImageId.current = null
      createSvgSlots.current = []
      createSvgPending.current.clear()
    }
  }

  const runVectorizeImages = async () => {
    if (createSvgBusy) return
    const refs = createSvgContext.references
    if (!refs.length) return
    if (typeof window.vanta.quiverVectorizeSvg !== 'function') {
      window.alert('Restart Scobe to enable Vectorize (preload needs a reload).')
      return
    }

    const pageId = activePageRef.current
    const nodes = designRef.current
    const gap = 48
    const slots: Array<{
      frameId: string
      x: number
      y: number
      width: number
      height: number
      dataUrl: string
      name: string
    }> = []
    const added: DesignNode[] = []
    for (const ref of refs) {
      const nodeId = ref.id.split(':')[0]
      const node = nodes.find((item) => item.id === nodeId)
      const world = node
        ? resolveWorldRect(node, nodes)
        : { x: 120, y: 120, width: 512, height: 512 }
      const width = Math.max(120, Math.round(world.width || 512))
      const height = Math.max(120, Math.round(world.height || 512))
      const frameId = crypto.randomUUID()
      const x = Math.round(world.x + world.width + gap)
      const y = Math.round(world.y)
      const name = refs.length > 1 ? `Vectorized ${slots.length + 1}` : 'Vectorized'
      slots.push({ frameId, x, y, width, height, dataUrl: ref.dataUrl, name })
      added.push({
        id: frameId,
        type: 'frame',
        name,
        x,
        y,
        width,
        height,
        pageId,
        fills: [{ type: 'solid', color: '#F0F0F0', opacity: 1 }],
        fill: '#F0F0F0',
        clipsContent: false
      })
    }

    createSvgSlots.current = slots.map(({ frameId }) => ({ frameId, imageId: frameId }))
    createSvgFrameId.current = slots[0].frameId
    createSvgImageId.current = slots[0].frameId
    createSvgPending.current.clear()
    if (createSvgApplyRaf.current != null) {
      window.cancelAnimationFrame(createSvgApplyRaf.current)
      createSvgApplyRaf.current = null
    }

    persistDesign([...designRef.current, ...added])
    setDesignSelectedIds(slots.map((slot) => slot.frameId))
    setSelectedId(null)
    setBuildingIds((current) => [...new Set([...current, ...slots.map((slot) => slot.frameId)])])
    setCreateSvgBusy(true)
    createSvgBusyRef.current = true
    setCreateSvgStatus(null)

    const first = slots[0]
    nudgeIntoView(first.x, first.y, first.width, first.height)

    const dropSlot = (slot: (typeof slots)[number]) => {
      persistDesign(designRef.current.filter((node) => node.id !== slot.frameId && node.parentId !== slot.frameId))
    }

    // Paper vectorize: wait for the finished SVG, then explode into pull-apart
    // shapes. Painting incomplete drafts made it look stuck (strip at top / black).
    const commitResult = (slotIndex: number, svg: string) => {
      const slot = slots[slotIndex]
      if (!slot || !svg?.trim()) return false

      const exploded = explodeSvgToNodes(svg, {
        frameId: slot.frameId,
        pageId,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        name: slot.name
      })
      if (!exploded.length) return false

      persistDesign([
        ...designRef.current.filter((node) => node.id !== slot.frameId && node.parentId !== slot.frameId),
        ...exploded
      ])
      return true
    }

    let lastError: string | null = null
    const keptIds: string[] = []
    try {
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]
        createSvgFrameId.current = slot.frameId
        createSvgImageId.current = slot.frameId
        // Ignore draft/content stream — only commit the final SVG (fast pop + explode).
        const stopListen = window.vanta.onQuiver(() => {})
        try {
          let image = slot.dataUrl
          // Keep more pixels so Quiver can resolve soft gradients / grain.
          if (image.length > 900_000) image = await shrinkImageDataUrl(image, 1600)
          const targetSize = Math.max(
            512,
            Math.min(2048, Math.round(Math.max(slot.width, slot.height) * 2))
          )
          // Faithful trace: higher effort + Telos when the panel is on Arrow 2
          // (Telos is Quiver’s detailed SVG model). Pull-apart still happens locally.
          const vectorModel: QuiverModelId =
            createSvgModel === 'arrow-2' ? 'arrow-2-telos' : createSvgModel
          let result = await window.vanta.quiverVectorizeSvg({
            model: vectorModel,
            imageBase64: image,
            autoCrop: true,
            targetSize,
            temperature: 0.05,
            reasoningEffort: 'high'
          })
          // Fall back if Telos isn't on this key — still keep high-effort Arrow 2.
          if (
            !result.ok &&
            vectorModel === 'arrow-2-telos' &&
            /model|telos|not.?found|unauthorized|forbidden/i.test(result.error || '')
          ) {
            result = await window.vanta.quiverVectorizeSvg({
              model: 'arrow-2',
              imageBase64: image,
              autoCrop: true,
              targetSize,
              temperature: 0.05,
              reasoningEffort: 'high'
            })
          }
          if (result.ok && result.svg?.trim() && commitResult(i, result.svg)) {
            keptIds.push(slot.frameId)
          } else if (!result.ok && isQuiverCancelMessage(result.error)) {
            dropSlot(slot)
          } else {
            dropSlot(slot)
            lastError = result.ok ? 'Vectorize returned an empty SVG.' : result.error
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          dropSlot(slot)
          if (!isQuiverCancelMessage(message)) lastError = message
        } finally {
          stopListen()
        }
      }
      if (keptIds.length) {
        setRevealIds((current) => [...new Set([...current, ...keptIds])])
        window.setTimeout(() => {
          setRevealIds((current) => current.filter((id) => !keptIds.includes(id)))
        }, 1100)
        // Select the frame so the user can immediately drill into pull-apart shapes.
        setDesignSelectedIds(keptIds)
        setCreateSvgStatus(null)
        sendDesignToMain(designRef.current)
        scheduleThumbnailCapture()
      } else if (lastError && !isQuiverCancelMessage(lastError)) {
        setCreateSvgStatus(lastError)
      } else {
        setCreateSvgStatus(null)
      }
    } finally {
      const frameIds = slots.map((slot) => slot.frameId)
      setBuildingIds((current) => current.filter((id) => !frameIds.includes(id)))
      setCreateSvgBusy(false)
      createSvgBusyRef.current = false
      createSvgFrameId.current = null
      createSvgImageId.current = null
      createSvgSlots.current = []
      createSvgPending.current.clear()
    }
  }

  useEffect(() => {
    if (createSvgOpen) {
      jev.bindVoiceHandlers({
        onPartial: (text) => setCreateSvgPrompt(text),
        onFinal: (text) => {
          const next = text.trim()
          if (!next || createSvgBusy) return
          setCreateSvgPrompt(next)
          void runCreateSvg({
            model: createSvgModel,
            prompt: next,
            n: 1,
            temperature: 0.4,
            reasoningEffort: 'medium',
            instructions:
              'Clean vector illustration, flat shapes, no raster effects. Fill the entire viewBox edge-to-edge — no white margins or padding around the artwork.',
            referenceBase64: selectedImageRef?.dataUrl || null
          })
        }
      })
      return
    }
    jev.bindDraft(setChatInput)
  }, [createSvgOpen, createSvgBusy, createSvgModel, jev.bindDraft, jev.bindVoiceHandlers])

  useEffect(() => {
    jev.syncSelection(designSelectedIds)
  }, [designSelectedIds, jev.syncSelection])

  const rememberActiveDesign = () => {
    const fileId = activeFileIdRef.current
    if (!fileId) return
    designsByFileRef.current[fileId] = designRef.current
  }

  const applyFileDesign = (fileId: string, nodes?: DesignNode[]) => {
    const next = nodes ?? designsByFileRef.current[fileId] ?? []
    designsByFileRef.current[fileId] = next
    designRef.current = next
    setDesign(next)
    setDesignSelectedIds([])
    setDraft(null)
    clearDesignHistory()
    resetCanvasHistory(next)
    sendDesignToMain(next)
  }

  const restoreCanvasVersion = (id: string) => {
    const entries = canvasHistoryRef.current
    const entry = entries.find((item) => item.id === id)
    if (!entry || entry === entries[0]) return
    const time = new Date(entry.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const snapshot = structuredClone(entry.snapshot)
    persistDesign(snapshot, { historyLabel: `Restored the version from ${time}` })
    setDesignSelectedIds((ids) => ids.filter((nodeId) => snapshot.some((node) => node.id === nodeId)))
  }

  const flashAlignGuides = (guides: AlignGuide[], hold = 0) => {
    if (alignGuideTimer.current) {
      window.clearTimeout(alignGuideTimer.current)
      alignGuideTimer.current = null
    }
    setAlignGuides(guides)
    if (hold > 0) {
      alignGuideTimer.current = window.setTimeout(() => setAlignGuides([]), hold)
    }
  }

  const alignSelection = (action: AlignAction) => {
    const ids = designSelectedRef.current
    const result = alignNodes(designRef.current, ids, action)
    if (!result) return
    persistDesign(result.nodes)
    flashAlignGuides(result.guides, 800)
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

  const moveSelectionZ = (edge: 'front' | 'back') => {
    const selected = new Set(designSelectedRef.current)
    if (!selected.size) return
    const next = [...designRef.current]
    const parents = new Set(
      next.filter((node) => selected.has(node.id)).map((node) => node.parentId || null)
    )
    for (const parentId of parents) {
      const indices: number[] = []
      const ids: string[] = []
      next.forEach((node, index) => {
        if ((node.parentId || null) === parentId) {
          indices.push(index)
          ids.push(node.id)
        }
      })
      const picked = ids.filter((id) => selected.has(id))
      const rest = ids.filter((id) => !selected.has(id))
      const order = edge === 'front' ? [...rest, ...picked] : [...picked, ...rest]
      const byId = new Map(next.map((node) => [node.id, node]))
      order.forEach((id, i) => {
        next[indices[i]] = byId.get(id)!
      })
    }
    persistDesign(next)
  }

  const ungroupSelected = () => {
    const ids = designSelectedRef.current
    if (ids.length !== 1) return
    const frame = designRef.current.find((node) => node.id === ids[0])
    if (!frame || (frame.type !== 'frame' && frame.type !== 'section')) return
    const kids = designRef.current.filter((node) => node.parentId === frame.id)
    if (!kids.length) return
    const next = designRef.current
      .filter((node) => node.id !== frame.id)
      .map((node) =>
        node.parentId === frame.id
          ? {
              ...node,
              parentId: frame.parentId || undefined,
              x: (node.x || 0) + (frame.x || 0),
              y: (node.y || 0) + (frame.y || 0),
              pageId: frame.pageId || node.pageId
            }
          : node
      )
    persistDesign(next)
    setDesignSelectedIds(kids.map((kid) => kid.id))
  }

  const toggleSelectionVisible = () => {
    const ids = new Set(designSelectedRef.current)
    if (!ids.size) return
    const primary = designRef.current.find((node) => ids.has(node.id))
    const hide = primary?.visible !== false
    persistDesign(
      designRef.current.map((node) => (ids.has(node.id) ? { ...node, visible: !hide } : node))
    )
  }

  const toggleSelectionLock = () => {
    const ids = new Set(designSelectedRef.current)
    if (!ids.size) return
    const primary = designRef.current.find((node) => ids.has(node.id))
    const lock = !primary?.locked
    persistDesign(
      designRef.current.map((node) => (ids.has(node.id) ? { ...node, locked: lock } : node))
    )
  }

  const toggleLayerVisible = (id: string) => {
    const node = designRef.current.find((item) => item.id === id)
    if (!node) return
    const hide = node.visible !== false
    persistDesign(designRef.current.map((item) => (item.id === id ? { ...item, visible: !hide } : item)))
  }

  const toggleLayerLock = (id: string) => {
    const node = designRef.current.find((item) => item.id === id)
    if (!node) return
    const lock = !node.locked
    persistDesign(designRef.current.map((item) => (item.id === id ? { ...item, locked: lock } : item)))
  }

  const pasteClipboard = (mode: 'default' | 'on-top' | 'replace' = 'default') => {
    const clip = designClipboard.current
    if (!clip?.length) return
    const doc = designRef.current
    const byId = new Map(doc.map((node) => [node.id, node]))
    const clipIds = new Set(clip.map((node) => node.id))
    const idMap = new Map<string, string>()
    for (const node of clip) idMap.set(node.id, crypto.randomUUID())
    const selected = designSelectedRef.current
    const target = selected.length === 1 ? byId.get(selected[0]) || null : null
    const offset = mode === 'on-top' || mode === 'replace' ? 0 : 24
    const roots = clip.filter((node) => !node.parentId || !clipIds.has(node.parentId))

    // Figma paste target: selected frame → inside it; selected child → its parent (after it);
    // nothing selected → back into the original frame when it's on this page.
    let parentId: string | undefined
    let afterId: string | undefined
    if (mode === 'on-top' && target) {
      parentId = target.id
    } else if (mode === 'replace' && target) {
      parentId = target.parentId && byId.has(target.parentId) ? target.parentId : undefined
      afterId = target.id
    } else if (target && (target.type === 'frame' || target.type === 'section') && !clipIds.has(target.id)) {
      parentId = target.id
    } else if (target?.parentId && byId.has(target.parentId)) {
      parentId = target.parentId
      afterId = target.id
    } else if (!target && roots.length && roots.every((node) => node.parentId === roots[0].parentId)) {
      const original = roots[0].parentId ? byId.get(roots[0].parentId) : undefined
      if (original && (original.pageId || DEFAULT_PAGE.id) === activePageRef.current) parentId = original.id
    }
    const parent = parentId ? byId.get(parentId) : undefined
    const parentWorld = parent ? resolveWorldRect(parent, doc) : null
    const parentAuto = Boolean(parent && isAutoLayout(parent))

    const worldOf = (node: DesignNode) =>
      node.parentId && byId.has(node.parentId) ? resolveWorldRect(node, doc) : { x: node.x, y: node.y, width: node.width || 0, height: node.height || 0 }

    const clones = clip.map((node) => {
      const parentInClip = Boolean(node.parentId && clipIds.has(node.parentId))
      const clone: DesignNode = {
        ...structuredClone(node),
        id: idMap.get(node.id)!,
        pageId: activePageRef.current
      }
      if (parentInClip) {
        clone.parentId = idMap.get(node.parentId!)
        return clone
      }
      clone.parentId = parentId
      if (mode === 'on-top' && parent) {
        clone.x = 16
        clone.y = 16
      } else if (parentAuto) {
        clone.layoutAbsolute = false
      } else if (parent && parentWorld) {
        if (node.parentId === parent.id) {
          clone.x = node.x + offset
          clone.y = node.y + offset
        } else {
          const world = worldOf(node)
          let x = world.x - parentWorld.x
          let y = world.y - parentWorld.y
          const w = node.width || 0
          const h = node.height || 0
          if (x < 0 || y < 0 || x + w > parentWorld.width || y + h > parentWorld.height) {
            x = (parentWorld.width - w) / 2
            y = (parentWorld.height - h) / 2
          }
          clone.x = x
          clone.y = y
        }
      } else {
        const world = worldOf(node)
        clone.x = world.x + offset
        clone.y = world.y + offset
      }
      const dx = clone.x - node.x
      const dy = clone.y - node.y
      if (node.points && (dx || dy) && !clone.parentId) {
        clone.points = node.points.map((point) => ({
          ...point,
          x: point.x + dx,
          y: point.y + dy,
          inX: point.inX != null ? point.inX + dx : undefined,
          inY: point.inY != null ? point.inY + dy : undefined,
          outX: point.outX != null ? point.outX + dx : undefined,
          outY: point.outY != null ? point.outY + dy : undefined
        }))
      }
      return clone
    })

    let next = [...doc]
    if (mode === 'replace' && selected.length) {
      const remove = expandWithDescendants(next, new Set(selected))
      const anchorIndex = afterId ? next.findIndex((node) => node.id === afterId) : -1
      next = next.filter((node) => !remove.has(node.id))
      if (anchorIndex >= 0) {
        next.splice(Math.min(anchorIndex, next.length), 0, ...clones)
        clones.length = 0
      }
    }
    if (clones.length) {
      let insertAt = next.length
      if (afterId) {
        const subtree = expandWithDescendants(next, new Set([afterId]))
        const last = next.reduce((index, node, i) => (subtree.has(node.id) ? i : index), -1)
        if (last >= 0) insertAt = last + 1
      }
      next.splice(insertAt, 0, ...clones)
    }
    const newRoots = roots.map((node) => idMap.get(node.id)!).filter(Boolean)
    persistDesign(next)
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
      cornerRadii: node.cornerRadii,
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
    const browserIds = selectedBrowserRef.current
    if (browserIds.length) {
      for (const id of browserIds) {
        holes.current.delete(id)
        if (dockedTabRef.current?.windowId === id) undockBrowserTab()
        void window.vanta.closeBrowser(id)
      }
      const next = browsersRef.current.filter((item) => !browserIds.includes(item.id))
      setBrowsers(next)
      browsersRef.current = next
      setInspectOn(false)
      selectBrowsers([])
      setBrowserMeasureId(null)
      setSnapshotBrowserId(null)
      openFileSidebarIfNoTabs(next)
    }
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

  const flashCopyToast = (text: string) => {
    if (copyToastTimerRef.current) window.clearTimeout(copyToastTimerRef.current)
    setCopyToast(text)
    copyToastTimerRef.current = window.setTimeout(() => setCopyToast(null), 1800)
  }

  /** Selected layers minus any whose ancestor is also selected (the ancestor already includes them). */
  const selectedCopyRoots = () => {
    const all = designRef.current
    const ids = new Set(designSelectedRef.current)
    const byId = new Map(all.map((node) => [node.id, node]))
    return designSelectedRef.current
      .map((id) => byId.get(id))
      .filter((node): node is DesignNode => Boolean(node))
      .filter((node) => {
        let parentId = node.parentId
        const seen = new Set<string>()
        while (parentId && !seen.has(parentId)) {
          if (ids.has(parentId)) return false
          seen.add(parentId)
          parentId = byId.get(parentId)?.parentId
        }
        return true
      })
  }

  const copySelectionAsCode = (tailwind: boolean) => {
    const roots = selectedCopyRoots()
    if (!roots.length) return
    const text = nodesToReact(roots, designRef.current, { tailwind })
    if (!text) return
    void navigator.clipboard.writeText(text).then(
      () => flashCopyToast(tailwind ? 'Copied as React with Tailwind' : 'Copied as React'),
      () => flashCopyToast('Couldn’t copy to clipboard')
    )
  }

  const copySelectionAsPng = () => {
    const node = selectedCopyRoots().at(-1)
    if (!node) return
    void copyNodeAsPng(node, designRef.current).then(
      () => flashCopyToast('Copied as PNG'),
      () => flashCopyToast('Couldn’t copy PNG')
    )
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
      window.alert('Convert to design needs a restart. Quit and reopen Scobe, then try again.')
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
        clipsContent: true
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

  const nudgeIntoView = (x: number, y: number, width: number, height: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
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

  useEffect(() => {
    let inspect = false
    let xray = false
    const handle = (event: Event) => {
      const { action, active } = (event as CustomEvent<{ action: string; active: boolean }>).detail
      const tabId = dockedTab?.tabId || (codingActive ? SIDEBAR_BROWSER_ID : null)
      if (!tabId) return
      if (action === 'snapshot') {
        void window.vanta.setMesurer(null, null)
        void window.vanta.setSnapshot(active ? tabId : null)
        if (active) void window.vanta.focus(tabId)
      } else {
        void window.vanta.setSnapshot(null)
        if (action === 'inspect') inspect = active
        if (action === 'xray') xray = active
        void window.vanta.setMesurer(inspect || xray ? tabId : null, inspect || xray ? { inspect, xray } : null)
      }
    }
    window.addEventListener('scobe:docked-browser-tool', handle)
    return () => { window.removeEventListener('scobe:docked-browser-tool', handle); void window.vanta.setSnapshot(null); void window.vanta.setMesurer(null, null) }
  }, [dockedTab, codingActive])

  const pasteSnapshot = (tabId: string, tree: SnapshotNode) => {
    const frame = browsersRef.current.find(
      (item) => item.id === tabId || item.activeTabId === tabId || item.tabs.some((tab) => tab.id === tabId)
    )
    const x = frame ? frame.x + frame.width + 48 : 80
    const y = frame ? frame.y : 80
    const imported = importSnapshot(tree, { x, y, pageId: activePageRef.current }, () => crypto.randomUUID())
    if (!imported.nodes.length) {
      window.alert('That element had nothing to paste.')
      return
    }
    persistDesign([...designRef.current, ...imported.nodes])
    setSelectedId(null)
    setDesignSelectedIds([imported.rootId])
    setSnapshotRevealId(imported.rootId)
    window.setTimeout(() => setSnapshotRevealId((current) => (current === imported.rootId ? null : current)), 700)
    const root = imported.nodes.find((node) => node.id === imported.rootId)
    nudgeIntoView(x, y, root?.width || tree.width, root?.height || tree.height)
  }
  pasteSnapshotRef.current = pasteSnapshot

  const worldFromEvent = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return screenToWorld(cameraRef.current, event.clientX - rect.left, event.clientY - rect.top)
  }

  /**
   * Marquee selection (Paper/Figma):
   * - Default: top-level only; L→R intersects, R→L requires full containment.
   * - Ctrl/Cmd deep: also hits nested nodes. Frames/sections are only selected when
   *   fully enclosed — partial overlap picks children inside, not the parent.
   */
  const marqueeHits = (
    screenBox: { left: number; top: number; width: number; height: number },
    dragLeft: boolean,
    deep: boolean
  ) => {
    const cam = cameraRef.current
    const world = {
      ...screenToWorld(cam, screenBox.left, screenBox.top),
      width: screenBox.width / cam.zoom,
      height: screenBox.height / cam.zoom
    }
    const nodes = designRef.current.filter(
      (node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current
    )
    const nodeIds = marqueeSelectIds(nodes, world, { dragLeft, deep })
    const browserIds = browsersRef.current
      .filter((frame) => {
        const bounds = {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height + FRAME_CHROME_HEIGHT
        }
        return dragLeft ? rectContains(world, bounds) : rectsOverlap(world, bounds)
      })
      .map((frame) => frame.id)
    return { nodeIds, browserIds }
  }

  const syncLayout = useCallback(() => {
    if (layoutQueued.current) return
    layoutQueued.current = true
    queueMicrotask(() => {
      layoutQueued.current = false
      const canvas = canvasRef.current?.getBoundingClientRect()
      const canvasClip = canvas
        ? { x: canvas.left, y: canvas.top, width: canvas.width, height: canvas.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      // Keep the selected frame/browser — and the toolbar sitting above it — clear of other BrowserViews.
      let protect: ScreenRect | null = null
      if (onCanvasRef.current) {
        const browserId = selectedRef.current
        const browserBox = browserId ? holes.current.get(browserId)?.parentElement?.getBoundingClientRect() : null
        if (browserBox && browserBox.width > 2) {
          protect = {
            x: browserBox.left,
            y: browserBox.top - 60,
            width: browserBox.width,
            height: browserBox.height + 60
          }
        } else if (designSelectedRef.current.length === 1) {
          const id = designSelectedRef.current[0]
          const node = designRef.current.find((item) => item.id === id)
          const el =
            node?.type === 'frame' ? worldRef.current?.querySelector(`[data-node-id="${CSS.escape(id)}"]`) : null
          const box = el?.getBoundingClientRect()
          if (box && box.width > 2) {
            protect = { x: box.left, y: box.top - 60, width: box.width, height: box.height + 60 }
          }
        }
      }
      // Sidebars, toolbars, and popups must stay above native BrowserViews (z-index can't help).
      const chromeObstacles = onCanvasRef.current
        ? [...readShellChromeObstacles(), ...readChromeObstacles()]
        : []
      const omniboxEl = document.querySelector('.url-omnibox-menu')
      const omniboxBox = omniboxEl?.getBoundingClientRect()
      const omniboxRect =
        omniboxBox && omniboxBox.width > 2 && omniboxBox.height > 2
          ? padRect(omniboxBox, 4)
          : null
      const rectsOverlap = (a: ScreenRect, b: ScreenRect) =>
        a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
      const docked = dockedTabRef.current
      const dockedId = dockedVisibleRef.current && docked ? docked.tabId : null
      const items = browsersRef.current.flatMap((frame, index) => {
        const hole = holes.current.get(frame.id)
        const box = hole?.getBoundingClientRect()
        const holeRect = box
          ? { x: box.left, y: box.top, width: box.width, height: box.height }
          : { x: 0, y: 0, width: 0, height: 0 }
        let clip = onCanvasRef.current ? intersectRects(holeRect, canvasClip) : null
        if (clip && protect && frame.id !== selectedRef.current) {
          clip = largestRectOutside(clip, protect)
        }
        if (clip && chromeObstacles.length) {
          clip = clipAgainstObstacles(clip, chromeObstacles)
        }
        // Omnibox sits over the page; largest-rect clipping often still leaves the view
        // covering the menu. Hide the native view while the menu is open over this hole.
        const omniboxBlocks = Boolean(omniboxRect && holeRect.width > 2 && rectsOverlap(holeRect, omniboxRect))
        if (omniboxBlocks) {
          clip = { x: 0, y: 0, width: 0, height: 0 }
        }
        const visibleHole = Boolean(clip && clip.width > 2 && clip.height > 2)
        const z = frame.id === selectedRef.current ? 10_000 + index : index
        return frame.tabs.map((tab) => {
          const active = tab.id === frame.activeTabId
          // Docked tabs paint in the left panel hole — hide their canvas placement.
          if (dockedId && tab.id === dockedId) {
            return {
              id: tab.id,
              hole: { x: 0, y: 0, width: 0, height: 0 },
              clip: { x: 0, y: 0, width: 0, height: 0 },
              viewport: { width: frame.width, height: frame.height },
              visible: false,
              z
            }
          }
          return {
            id: tab.id,
            hole: holeRect,
            clip: active && clip ? clip : { x: 0, y: 0, width: 0, height: 0 },
            viewport: { width: frame.width, height: frame.height },
            visible: active && visibleHole && !omniboxBlocks,
            z
          }
        })
      })
      const agentBox = agentHole.current?.getBoundingClientRect()
      const agentRect = agentBox
        ? { x: agentBox.left, y: agentBox.top, width: agentBox.width, height: agentBox.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      const agentOn = agentVisibleRef.current && agentRect.width > 2 && agentRect.height > 2
      const dockedOn = Boolean(dockedId) && agentRect.width > 2 && agentRect.height > 2
      let agentClip = agentRect
      if (agentOn || dockedOn) {
        // Sidebar BrowserViews paint above HTML — only carve out the floating toolbar
        // (and similar overlays). Do not clip against the right sidebar / agent rail or
        // the view shrinks into a small inset inside the pane.
        const agentObstacles = readSidebarBrowserObstacles()
        if (agentObstacles.length) agentClip = clipAgainstObstacles(agentRect, agentObstacles)
      }
      const agentClipOn = agentOn && agentClip.width > 2 && agentClip.height > 2
      const dockedClipOn = dockedOn && agentClip.width > 2 && agentClip.height > 2
      const agentOmniboxBlocks = Boolean(omniboxRect && agentRect.width > 2 && rectsOverlap(agentRect, omniboxRect))
      items.push({
        id: SIDEBAR_BROWSER_ID,
        hole: agentRect,
        clip: agentClipOn && !agentOmniboxBlocks ? agentClip : { x: 0, y: 0, width: 0, height: 0 },
        viewport: {
          width: Math.max(1, Math.round(agentRect.width)),
          height: Math.max(1, Math.round(agentRect.height))
        },
        visible: agentClipOn && !agentOmniboxBlocks,
        z: 50_000
      })
      if (dockedId) {
        const dockIdx = items.findIndex((item) => item.id === dockedId)
        const dockFrame = browserPaneFrame(agentRect)
        const dockClip = dockedClipOn
          ? intersectRects(agentClip, dockFrame.hole) || { x: 0, y: 0, width: 0, height: 0 }
          : { x: 0, y: 0, width: 0, height: 0 }
        const dockClipOn = dockClip.width > 2 && dockClip.height > 2 && !agentOmniboxBlocks
        const dockLayout = {
          id: dockedId,
          hole: dockFrame.hole,
          clip: dockClipOn ? dockClip : { x: 0, y: 0, width: 0, height: 0 },
          viewport: dockFrame.viewport,
          visible: dockClipOn,
          z: 50_000
        }
        if (dockIdx >= 0) items[dockIdx] = dockLayout
        else items.push(dockLayout)
      }
      const sideObstacles = agentSideVisibleRef.current ? readSidebarBrowserObstacles() : []
      for (const [index, slot] of sideBrowsersRef.current.entries()) {
        const sideEl = agentSideHoles.current.get(slot.id)
        const sideBox = sideEl?.getBoundingClientRect()
        const sideRect = sideBox
          ? { x: sideBox.left, y: sideBox.top, width: sideBox.width, height: sideBox.height }
          : { x: 0, y: 0, width: 0, height: 0 }
        const sideOn = agentSideVisibleRef.current && sideRect.width > 2 && sideRect.height > 2
        let sideClip = sideRect
        if (sideOn && sideObstacles.length) sideClip = clipAgainstObstacles(sideRect, sideObstacles)
        const sideOmniboxBlocks = Boolean(omniboxRect && sideRect.width > 2 && rectsOverlap(sideRect, omniboxRect))
        const sideClipOn = sideOn && sideClip.width > 2 && sideClip.height > 2 && !sideOmniboxBlocks
        const sideFrame = browserPaneFrame(sideRect)
        const sidePaint = sideClipOn
          ? intersectRects(sideClip, sideFrame.hole) || { x: 0, y: 0, width: 0, height: 0 }
          : { x: 0, y: 0, width: 0, height: 0 }
        const sidePaintOn = sidePaint.width > 2 && sidePaint.height > 2
        items.push({
          id: slot.id,
          hole: sideFrame.hole,
          clip: sidePaintOn ? sidePaint : { x: 0, y: 0, width: 0, height: 0 },
          viewport: sideFrame.viewport,
          visible: sidePaintOn,
          z: 50_050 + index
        })
      }
      const chatBox = chatHole.current?.getBoundingClientRect()
      const chatRect = chatBox
        ? { x: chatBox.left, y: chatBox.top, width: chatBox.width, height: chatBox.height }
        : { x: 0, y: 0, width: 0, height: 0 }
      const chatOn = chatBrowserVisibleRef.current && chatRect.width > 2 && chatRect.height > 2
      let chatClip = chatRect
      if (chatOn) {
        const chatObstacles = readChromeObstacles('.rightbar')
        if (chatObstacles.length) chatClip = clipAgainstObstacles(chatRect, chatObstacles)
      }
      const chatClipOn = chatOn && chatClip.width > 2 && chatClip.height > 2
      items.push({
        id: CHAT_BROWSER_ID,
        hole: chatRect,
        clip: chatClipOn ? chatClip : { x: 0, y: 0, width: 0, height: 0 },
        viewport: {
          width: Math.max(1, Math.round(chatRect.width)),
          height: Math.max(1, Math.round(chatRect.height))
        },
        visible: chatClipOn,
        z: 50_100
      })
      void window.vanta.syncLayout(items)
    })
  }, [])

  const measureActionAnchor = useCallback(() => {
    const publish = (box: DOMRect | null) => {
      const prev = actionAnchorRef.current
      if (!box || box.width < 2 || box.height < 2) {
        if (prev) {
          actionAnchorRef.current = null
          setActionAnchor(null)
        }
        return
      }
      if (
        prev &&
        Math.abs(prev.x - box.x) < 0.5 &&
        Math.abs(prev.y - box.y) < 0.5 &&
        Math.abs(prev.width - box.width) < 0.5 &&
        Math.abs(prev.height - box.height) < 0.5
      ) {
        return
      }
      const next = new DOMRect(box.x, box.y, box.width, box.height)
      actionAnchorRef.current = next
      setActionAnchor(next)
    }

    if (!onCanvasRef.current) {
      publish(null)
      return
    }
    const browserId = selectedRef.current
    if (browserId) {
      publish(holes.current.get(browserId)?.parentElement?.getBoundingClientRect() ?? null)
      return
    }
    publish(null)
  }, [])

  const applyCamera = useCallback(
    (next: Camera) => {
      const zoomChanged = cameraRef.current.zoom !== next.zoom
      cameraRef.current = next
      if (pixelGridRef.current) paintPixelGrid(pixelGridRef.current, next)
      const world = worldRef.current
      if (world) {
        // Imperative transform only — React style must not overwrite this on unrelated re-renders.
        world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`
        world.style.setProperty('--zoom', String(next.zoom))
        world.setAttribute('data-zoom', String(next.zoom))
        if (zoomChanged) {
          // will-change layers keep their old raster scale; briefly dropping it once
          // zooming settles re-rasterizes crisply at the new zoom (matters up to 25600%).
          if (zoomSettleTimer.current != null) window.clearTimeout(zoomSettleTimer.current)
          zoomSettleTimer.current = window.setTimeout(() => {
            zoomSettleTimer.current = null
            world.style.willChange = 'auto'
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                world.style.willChange = ''
              })
            })
          }, 160)
        }
      }
      syncLayout()
      measureActionAnchor()
      if (cameraRaf.current != null) window.cancelAnimationFrame(cameraRaf.current)
      cameraRaf.current = window.requestAnimationFrame(() => {
        cameraRaf.current = null
        setCamera({ ...cameraRef.current })
      })
    },
    [syncLayout, measureActionAnchor]
  )

  useEffect(() => {
    void window.vanta.getStatus().then(setStatus)
    const offBrowsers = window.vanta.onBrowsers((next) => {
      for (const frame of next) {
        for (const tab of frame.tabs) {
          if (tab.url && tab.url !== 'about:blank') {
            recordVisit({ url: tab.url, title: tab.title, favicon: tab.favicon })
          }
        }
      }
      setBrowsers((current) => {
        const merged = next.map((frame) => {
          const local = current.find((item) => item.id === frame.id)
          return local
            ? { ...frame, x: local.x, y: local.y, width: local.width, height: local.height }
            : frame
        })
        browsersRef.current = merged
        return merged
      })
    })
    void window.vanta.getBrowsers().then(setBrowsers)
    void window.vanta.getWorkspace().then((workspace) => {
      const nextDesign = workspace.design || []
      setCamera(workspace.camera)
      designRef.current = nextDesign
      setDesign(nextDesign)
      designsByFileRef.current[activeFileIdRef.current] = nextDesign
      resetCanvasHistoryRef.current(nextDesign)
      if (workspace.pages?.length) {
        pagesRef.current = workspace.pages
        setPages(workspace.pages)
        const pageId = workspace.activePageId || workspace.pages[0].id
        setActivePageId(pageId)
        activePageRef.current = pageId
      }
      void captureActiveFileThumbnail(activeFileIdRef.current)
    })
    const offStatus = window.vanta.onStatus(setStatus)
    const offLayout = window.vanta.onNeedLayout(() => {
      requestAnimationFrame(() => void syncLayout())
    })
    const offWorkspace = window.vanta.onWorkspace((workspace) => {
      setCamera(workspace.camera)
      const nextDesign = workspace.design || []
      designRef.current = nextDesign
      setDesign(nextDesign)
      designsByFileRef.current[activeFileIdRef.current] = nextDesign
      resetCanvasHistoryRef.current(nextDesign)
      if (workspace.pages?.length) {
        setPages(workspace.pages)
        setActivePageId(workspace.activePageId || workspace.pages[0].id)
      }
    })
    const offInspect = window.vanta.onInspect(setInspect)
    const offSnapshot = window.vanta.onSnapshot((event) => {
      if ('tree' in event) { pasteSnapshotRef.current(event.tabId, event.tree); void window.vanta.setSnapshot(null) }
      else if ('error' in event) window.alert(event.error)
      setSnapshotBrowserId(null)
    })
    const offDesign = window.vanta.onDesign((incoming) => {
      if (designSavesInFlight > 0) return
      const nodes = reuseUnchangedNodes(designRef.current, incoming)
      if (nodes === designRef.current) return
      pushDesignHistory(designRef.current)
      designRef.current = nodes
      setDesign(nodes)
      const fileId = activeFileIdRef.current
      if (fileId) designsByFileRef.current[fileId] = nodes
      noteDesignChangeRef.current(nodes, 'agent')
    })
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
          const projectName = event.projectName || 'Scobe'
          const stored = rememberCodingAgent(recents, { agentId, projectName })
          setCodingActive(stored.active)
          return stored.recents
        })
        setCodingPopup(false)
        setTabsPopup(false)
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
      const targetChatId = agentChatRef.current
      if (event.type === 'text') {
        agentTextRef.current += event.text
        setChats((current) =>
          current.map((chat) => {
            if (chat.id !== targetChatId) return chat
            const last = chat.messages[chat.messages.length - 1]
            if (last?.role === 'assistant' && !last.jevId) {
              return {
                ...chat,
                messages: [...chat.messages.slice(0, -1), { ...last, text: last.text + event.text }]
              }
            }
            return { ...chat, messages: [...chat.messages, { role: 'assistant', text: event.text, startedAt: Date.now() }] }
          })
        )
      }
      if (event.type === 'tool') {
        setChats((current) =>
          current.map((chat) =>
            chat.id === targetChatId
              ? { ...chat, messages: [...chat.messages, { role: 'system', text: `${event.name}: ${event.summary}` }] }
              : chat
          )
        )
      }
      if (event.type === 'error') {
        const finishedAt = Date.now()
        setChats(current => current.map(chat => chat.id !== targetChatId ? chat : { ...chat, messages: chat.messages.map(message => message.startedAt && !message.finishedAt ? { ...message, finishedAt } : message) }))

        setChats((current) =>
          current.map((chat) =>
            chat.id === targetChatId
              ? { ...chat, messages: [...chat.messages, { role: 'system', text: event.message }] }
              : chat
          )
        )
        agentChatRef.current = null
        setAgentBusy(false)
      }
      if (event.type === 'done') {
        const finishedAt = Date.now()
        setChats(current => current.map(chat => chat.id !== targetChatId ? chat : { ...chat, messages: chat.messages.map(message => message.role === 'assistant' && message.startedAt && !message.finishedAt ? { ...message, finishedAt, createdAt: finishedAt } : message) }))
        const chatId = agentChatRef.current
        if (chatId && agentTextRef.current) {
          const next = [...(chatHistories.current.get(chatId) || []), { role: 'assistant' as const, text: agentTextRef.current }]
          chatHistories.current.set(chatId, next)
          if (activeChatIdRef.current === chatId) historyRef.current = next
        }
        agentChatRef.current = null
        agentTextRef.current = ''
        setAgentBusy(false)
      }
    })
    void window.vanta.getMcpStatus?.().then(setMcpStatus).catch(() => undefined)
    return () => {
      offBrowsers()
      offStatus()
      offLayout()
      offWorkspace()
      offInspect()
      offSnapshot()
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

  useLayoutEffect(() => {
    syncLayout()
    measureActionAnchor()
    // Intentionally omit `design` — svgMarkup / content edits were re-clipping every
    // BrowserView on each Quiver draft and freezing the UI. Geometry changes still
    // sync via camera, selection, browser, and chrome deps below.
  }, [camera, browsers, designSelectedIds, selectedId, activePageId, view, rail, leftOpen, rightOpen, leftWidth, rightWidth, codingActive, codingPopup, tabsPopup, codingFullscreen, sideBrowsers, dockedTab, syncLayout, measureActionAnchor])

  useEffect(() => {
    void window.vanta.closeBrowser(CHAT_BROWSER_ID).catch(() => undefined)
  }, [rail])

  useEffect(() => {
    void window.vanta.setInspect(inspectOn && !browserMeasureId && !snapshotBrowserId ? activeTabId : null)
  }, [inspectOn, activeTabId, browserMeasureId, snapshotBrowserId])

  const snapshotTabId = snapshotBrowserId
    ? browsers.find((item) => item.id === snapshotBrowserId)?.activeTabId || null
    : null

  useEffect(() => {
    if (snapshotBrowserId && selectedId !== snapshotBrowserId) setSnapshotBrowserId(null)
  }, [selectedId, snapshotBrowserId])

  useEffect(() => {
    if (typeof window.vanta.setSnapshot !== 'function') return
    void window.vanta.setSnapshot(snapshotTabId)
    if (snapshotTabId) void window.vanta.focus(snapshotTabId)
  }, [snapshotTabId])

  useEffect(() => {
    if (!browserMeasureId || snapshotBrowserId) {
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
  }, [browserMeasureId, browserMeasureInspect, browserMeasureXray, browsers, selectedId, snapshotBrowserId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const applyWheel = (event: {
      preventDefault?: () => void
      clientX: number
      clientY: number
      deltaX: number
      deltaY: number
      deltaMode: number
      ctrlKey: boolean
      metaKey: boolean
      shiftKey: boolean
    }) => {
      event.preventDefault?.()
      const rect = canvas.getBoundingClientRect()
      const current = cameraRef.current
      const sx = event.clientX - rect.left
      const sy = event.clientY - rect.top
      // Ctrl/Cmd+scroll or trackpad pinch (Chromium reports pinch as ctrl+wheel)
      if (event.ctrlKey || event.metaKey) {
        applyCamera(zoomAt(current, sx, sy, current.zoom * wheelZoomFactor(event.deltaY)))
        return
      }
      // Shift+scroll pans horizontally (map vertical wheel to X)
      if (event.shiftKey) {
        const delta = wheelPan(event.deltaY || event.deltaX, 0, event.deltaMode)
        applyCamera({ ...current, x: current.x + delta.x, y: current.y + delta.y })
        return
      }
      const delta = wheelPan(event.deltaX, event.deltaY, event.deltaMode)
      applyCamera({ ...current, x: current.x + delta.x, y: current.y + delta.y })
    }
    const onWheel = (event: WheelEvent) => applyWheel(event)
    canvas.addEventListener('wheel', onWheel, { passive: false, capture: true })
    const offBrowserWheel = window.vanta.onCanvasWheel?.(applyWheel)
    const offZoomKey = window.vanta.onCanvasZoomKey?.((event) => {
      const el = canvasRef.current
      if (!el) return
      const current = cameraRef.current
      const cx = el.clientWidth / 2
      const cy = el.clientHeight / 2
      if (event.key === '0') applyCamera(zoomAt(current, cx, cy, 1))
      else if (event.key === '-' || event.key === '_') applyCamera(zoomAt(current, cx, cy, current.zoom / 1.12))
      else applyCamera(zoomAt(current, cx, cy, current.zoom * 1.12))
    })
    const observer = new ResizeObserver(() => syncLayout())
    observer.observe(canvas)
    // Seed transform in case React unmounted/remounted the world node
    applyCamera(cameraRef.current)
    return () => {
      canvas.removeEventListener('wheel', onWheel, true)
      offBrowserWheel?.()
      offZoomKey?.()
      observer.disconnect()
    }
  }, [applyCamera, syncLayout, view])

  // Re-clip BrowserViews when persistent chrome boxes resize (menus call syncLayout via onChromeChange).
  useEffect(() => {
    if (view !== 'canvas') return
    const ro = new ResizeObserver(() => syncLayout())
    const els = [
      document.querySelector('.leftbar'),
      document.querySelector('.leftbar-panel'),
      document.querySelector('.rightbar'),
      document.querySelector('.canvas-toolbar-shell'),
      document.querySelector('.frame-action-wrap'),
      document.querySelector('.file-tabs')
    ].filter((el): el is Element => Boolean(el))
    for (const el of els) ro.observe(el)

    let moTimer: number | null = null
    const schedule = () => {
      if (moTimer != null) return
      moTimer = window.setTimeout(() => {
        moTimer = null
        syncLayout()
      }, 16)
    }
    const overlaySelector = `[data-chrome-overlay], .ca-popup-backdrop, .ca-popup, .ca-agent-picker, .ca-agent-rail, .ca-fs-popup, .shape-menu, .frame-action-menu, .ctx-menu, .layer-menu, .brush-picker, ${INSPECTOR_POPUP_SELECTOR}`
    const isOverlay = (node: Node) => {
      if (!(node instanceof Element)) return false
      return Boolean(node.matches?.(overlaySelector) || node.querySelector?.(overlaySelector))
    }
    const observeOverlays = (node: Element) => {
      if (node.matches(INSPECTOR_POPUP_SELECTOR)) ro.observe(node)
      node.querySelectorAll(INSPECTOR_POPUP_SELECTOR).forEach((el) => ro.observe(el))
    }
    document.querySelectorAll(INSPECTOR_POPUP_SELECTOR).forEach((el) => ro.observe(el))
    const mo = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== 'childList') continue
        for (const node of record.addedNodes) {
          if (isOverlay(node)) {
            if (node instanceof Element) observeOverlays(node)
            schedule()
            return
          }
        }
        for (const node of record.removedNodes) {
          if (isOverlay(node)) {
            schedule()
            return
          }
        }
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })

    const onOmniboxLayout = () => {
      // Hide overlapping BrowserViews immediately so suggestion clicks hit HTML.
      syncLayout()
    }
    window.addEventListener('vanta:chrome-layout', onOmniboxLayout)

    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('vanta:chrome-layout', onOmniboxLayout)
      if (moTimer != null) window.clearTimeout(moTimer)
    }
  }, [syncLayout, view, leftOpen, rightOpen, selectedId, designSelectedIds, actionAnchor, codingPopup, tabsPopup, codingFullscreen])

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

  const pendingAgentOpenUrl = useRef<string | null>(null)

  const openCodingAgent = useCallback(
    (agentId: CodingAgentId, projectName?: string, id?: string, openUrl?: string) => {
      const fileName = files.find((file) => file.id === activeFileId)?.name || 'Untitled'
      const stored = rememberCodingAgent(codingRecents, {
        agentId,
        projectName: projectName || fileName,
        id
      })
      if (sideBrowsersRef.current.length) closeAllSideBrowsers()
      dockedTabRef.current = null
      setDockedTab(null)
      pendingAgentOpenUrl.current = openUrl?.trim() || null
      setCodingActive(stored.active)
      setCodingRecents(stored.recents)
      setCodingPopup(false)
      setTabsPopup(false)
      setRail('coding-agents')
      setLeftOpen(true)
      setView('canvas')
      // Paper-style: agent browser fills the left sidebar after MCP setup.
      requestAnimationFrame(() => enterCodingFullscreen())
    },
    [activeFileId, codingRecents, files]
  )

  useEffect(() => {
    if (!codingActive) return
    const meta = getCodingAgentMeta(codingActive.agentId)
    let cancelled = false
    void (async () => {
      // Prefer the install / tunnel URL from Connect → Done so Cursor registers Vanta MCP.
      let startUrl = pendingAgentOpenUrl.current || meta.webAppUrl
      pendingAgentOpenUrl.current = null
      if (!startUrl || startUrl === meta.webAppUrl) {
        try {
          const link = await window.vanta.getAgentMcpLink(codingActive.agentId)
          if (cancelled) return
          if (link.openUrl) startUrl = link.openUrl
          else if (link.installUrl && codingActive.agentId === 'cursor') startUrl = link.installUrl
        } catch {
          /* keep default */
        }
      }
      if (cancelled) return
      setCodingAgentUrl(startUrl)
      await window.vanta.openSidebarBrowser(SIDEBAR_BROWSER_ID, startUrl)
      if (!cancelled) syncLayout()
    })()
    return () => {
      cancelled = true
    }
  }, [codingActive, syncLayout])

  useEffect(() => {
    const openIds = new Set(sideBrowsers.map((item) => item.id))
    for (const id of AGENT_SIDE_BROWSER_IDS) {
      if (!openIds.has(id) || (!codingActive && !dockedTab)) {
        void window.vanta.closeBrowser(id).catch(() => undefined)
      }
    }
    if ((!codingActive && !dockedTab) || sideBrowsers.length === 0) return
    let cancelled = false
    for (const slot of sideBrowsers) {
      void window.vanta.openSidebarBrowser(slot.id, slot.url).then(() => {
        if (cancelled) return
        syncLayout()
        requestAnimationFrame(() => {
          syncLayout()
          requestAnimationFrame(() => syncLayout())
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [sideBrowsers, codingActive, dockedTab, syncLayout])

  useEffect(() => {
    if (!dockedTab) return
    const frame = browsers.find((item) => item.id === dockedTab.windowId)
    if (!frame?.tabs.some((tab) => tab.id === dockedTab.tabId)) {
      dockedTabRef.current = null
      setDockedTab(null)
    }
  }, [browsers, dockedTab])

  useEffect(() => {
    if (codingActive || dockedTab) return
    if (sideBrowsersRef.current.length || codingFullscreenRef.current) {
      collapseAgentWorkspace()
    } else {
      clearAgentFsToolbarTimer()
      setToolbarHiddenForAgentFs(false)
    }
  }, [codingActive, dockedTab])

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
      if (event.key === 'Control' || event.key === 'Meta') {
        deepSelectHeldRef.current = true
        setDeepSelectHeld(true)
      }
      const meta = event.ctrlKey || event.metaKey
      // Canvas undo/redo — always, except while typing in fields or during SVG/vectorize generation.
      if (meta && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault()
        if (isDesignGenerationBusy()) return
        if (event.shiftKey) redoDesign()
        else undoDesign()
        return
      }
      if (typing) return
      if (cropSessionRef.current) {
        // While cropping: Enter applies, Esc cancels; don't let other shortcuts touch the layer.
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault()
          finishImageCropRef.current(event.key === 'Enter')
          return
        }
        if (event.key === 'Delete' || event.key === 'Backspace' || event.key.startsWith('Arrow') || event.key === 'Tab') {
          event.preventDefault()
          return
        }
      }
      if (designRef.current.some((node) => node.editing)) {
        // While editing text, only allow Escape to finish — never tool/layer shortcuts.
        if (event.key === 'Escape') {
          const active = document.activeElement
          if (active instanceof HTMLElement) active.blur()
        }
        return
      }
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
          const next = browsersRef.current.filter((item) => item.id !== frame.id)
          setBrowsers(next)
          browsersRef.current = next
          setSelectedId(null)
          void window.vanta.closeBrowser(frame.id)
          openFileSidebarIfNoTabs(next)
        } else {
          closeBrowserTab(frame.id, frame.activeTabId)
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
        if (jev.picking) {
          jev.setPicking(false)
          designSelectedRef.current = []
          setDesignSelectedIds([])
          return
        }
        if (jev.on && jev.locked) {
          jev.clearTarget()
          return
        }
        if (contextMenuRef.current) {
          setContextMenu(null)
          contextMenuRef.current = null
          return
        }
        if (codingFullscreenRef.current) {
          exitCodingFullscreen()
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
        // Enter on a lone image layer opens Crop (Figma); otherwise it selects children.
        const only = designSelectedRef.current.length === 1 ? designRef.current.find((node) => node.id === designSelectedRef.current[0]) : null
        const isImage =
          only &&
          !designRef.current.some((node) => node.parentId === only.id) &&
          getNodePaints(only).some((paint) => paint.type === 'image' && (paint.imageDataUrl || only.imageDataUrl))
        if (only && isImage) {
          startImageCropRef.current(only.id)
          return
        }
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
      } else if ((meta || event.ctrlKey) && event.shiftKey && (event.code === 'Backslash' || event.key === '\\')) {
        event.preventDefault()
        setLeftOpen((value) => !value)
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
      } else if (meta && event.shiftKey && !event.altKey && event.code === 'KeyC') {
        event.preventDefault()
        copySelectionAsPng()
      } else if (!meta && event.altKey && !event.shiftKey && (event.code === 'KeyT' || event.code === 'KeyR')) {
        event.preventDefault()
        copySelectionAsCode(event.code === 'KeyT')
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
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        (designSelectedRef.current.length || selectedBrowserRef.current.length)
      ) {
        event.preventDefault()
        const browserIds = [...selectedBrowserRef.current]
        if (browserIds.length) {
          if (dockedTabRef.current && browserIds.includes(dockedTabRef.current.windowId)) {
            dockedTabRef.current = null
            setDockedTab(null)
            dockedVisibleRef.current = false
            agentSideVisibleRef.current = false
            collapseAgentWorkspace()
          }
          for (const id of browserIds) {
            holes.current.delete(id)
            void window.vanta.closeBrowser(id)
          }
          const next = browsersRef.current.filter((item) => !browserIds.includes(item.id))
          setBrowsers(next)
          browsersRef.current = next
          setInspectOn(false)
          selectBrowsers([])
          setBrowserMeasureId(null)
          setSnapshotBrowserId(null)
          openFileSidebarIfNoTabs(next)
        }
        if (designSelectedRef.current.length) {
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
      } else if (!meta && event.key === 'Tab' && designSelectedRef.current.length) {
        // Tab / Shift+Tab: select the next / previous sibling (layer order = flex order).
        event.preventDefault()
        const nodes = designRef.current
        const current = nodes.find((node) => node.id === designSelectedRef.current[designSelectedRef.current.length - 1])
        if (!current) return
        const siblings = nodes.filter(
          (node) =>
            node.parentId === current.parentId &&
            node.type !== 'comment' &&
            node.visible !== false &&
            (current.parentId || (node.pageId || DEFAULT_PAGE.id) === activePageRef.current)
        )
        const index = siblings.findIndex((node) => node.id === current.id)
        if (siblings.length < 2 || index < 0) return
        const next = siblings[(index + (event.shiftKey ? -1 : 1) + siblings.length) % siblings.length]
        designSelectedRef.current = [next.id]
        setDesignSelectedIds([next.id])
      } else if (
        !meta &&
        (event.key === 'ArrowLeft' ||
          event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown') &&
        designSelectedRef.current.length
      ) {
        event.preventDefault()
        const ids = designSelectedRef.current
        const step = event.shiftKey ? 10 : 1
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
        const nodes = designRef.current
        const selected = new Set(ids)
        const roots = ids
          .map((id) => nodes.find((node) => node.id === id))
          .filter((node): node is DesignNode => Boolean(node))
          .filter((node) => !node.parentId || !selected.has(node.parentId))
        const parentId = roots[0]?.parentId
        const parent = parentId ? nodes.find((node) => node.id === parentId) : null
        const flexParent = parent && isAutoLayout(parent) ? parent : null
        const inFlow =
          Boolean(flexParent) && roots.every((node) => node.parentId === parentId && !node.layoutAbsolute)
        if (flexParent && inFlow) {
          // Flex children reorder instead of nudging (Paper/Figma):
          // main-axis arrows move one slot, grid/wrap cross-axis arrows move a whole row,
          // Shift jumps to the start or end.
          const layout = flexParent.layout!
          const vertical = layout.mode === 'vertical'
          const horizontalKey = dx !== 0
          const sign = (horizontalKey ? dx : dy) > 0 ? 1 : -1
          const onMain = horizontalKey !== vertical
          let delta = 0
          if (layout.grid) {
            const columns = Math.max(1, Math.round(layout.grid.columns || 1))
            delta = horizontalKey ? sign : sign * columns
          } else if (onMain) {
            delta = sign
          } else if (layout.wrap) {
            delta = sign * flexLineLength(nodes, flexParent)
          }
          if (delta && event.shiftKey) delta = sign * Number.MAX_SAFE_INTEGER
          if (delta) {
            const reordered = reorderFlexByDelta(nodes, ids, delta)
            if (reordered) persistDesign(reordered)
          }
          return
        }
        const selectedRoots = new Set(roots.map((node) => node.id))
        persistDesign(
          nodes.map((node) => {
            if (!selectedRoots.has(node.id)) return node
            return { ...node, x: node.x + dx, y: node.y + dy }
          })
        )
      }
    }
    const up = async (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltHeld(false)
      if (event.key === 'Control' || event.key === 'Meta') {
        deepSelectHeldRef.current = false
        setDeepSelectHeld(false)
        deepHoverIdRef.current = null
        setDeepHoverId(null)
      }
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
    const center = canvas
      ? screenToWorld(current, canvas.clientWidth / 2, canvas.clientHeight / 2)
      : { x: 80, y: 80 }
    const cascade = input?.x == null ? browsersRef.current.length * 40 : 0
    const x = Math.round(input?.x ?? center.x - width / 2 + cascade)
    const y = Math.round(input?.y ?? center.y - height / 2 + cascade)
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
    browsersRef.current = [
      ...browsersRef.current.filter((item) => item.id !== created.id),
      { ...created, x, y, width, height }
    ]
    setSelectedId(created.id)
    setSelectedBrowserIds([created.id])
    selectedBrowserRef.current = [created.id]
    setDesignSelectedIds([])
    openTabsSidebar()
    await window.vanta.updateFrame({ id: created.id, x, y, width, height })
    return created
  }

  const openTabInCanvas = async () => {
    setTabsPopup(false)
    setCodingPopup(false)
    await addBrowser()
  }

  const openTabToLeft = async () => {
    setTabsPopup(false)
    setCodingPopup(false)
    const created = await addBrowser()
    const tabId = created.activeTabId || created.tabs[0]?.id
    if (tabId) dockBrowserTab(created.id, tabId)
  }

  const patchFrame = (id: string, patch: Partial<Frame>) => {
    setBrowsers((current) => current.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)))
    void window.vanta.updateFrame({ id, ...patch })
  }

  const exitCreateSvg = () => {
    if (!createSvgOpen) return
    // Dismissing the panel must NOT abort Quiver — the canvas build keeps
    // running and finishes on its own. Only the Stop button cancels.
    setCreateSvgOpen(false)
    if (!createSvgBusy) setCreateSvgStatus(null)
  }

  const chooseTool = (next: DesignTool) => {
    if (next === 'pen' || next === 'pencil' || next === 'brush') setStrokeColor(instrumentColors[next])
    exitCreateSvg()
    if (toolRef.current === 'pen' && next !== 'pen') finishPen()
    setTool(next)
    setHandMode(false)
    setPenHover(null)
    setPathHoverId(null)
    setDrawCursor(null)
    if (next !== 'measure') {
      setMeasureHoverId(null)
      setMeasureOffsets({})
      setMeasurePins([])
      setMeasureEdgeHover(null)
      setMeasureActiveLineId(null)
      setMeasureDraft(null)
      measureSlide.current = null
      measureCreate.current = null
    }
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
      clipsContent: true
    }
    persistDesign([...designRef.current, node])
    setDesignSelectedIds([id])
    setSelectedId(null)
    setTool('pointer')
    setDrawCursor(null)
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
    setTool('pointer')
    setDrawCursor(null)
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
    exitCreateSvg()
    setSwitchMode(next)
    setInspectOn(false)
    if (next === 'chat') {
      // Hide native BrowserViews before React swaps the page — they paint above HTML
      // and otherwise sit over chat until the next layout pass.
      onCanvasRef.current = false
      syncLayout()
      clearAgentFsToolbarTimer()
      agentFsPending.current = null
      setToolbarHiddenForAgentFs(false)
      setChatPoppedOut(false)
      setTool('pointer')
      setHandMode(false)
      setView('canvas')
      setRail('chat')
      setLeftOpen(true)
      return
    }
    if (rail === 'chat') {
      setRail('file')
      setChatPoppedOut(false)
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

  const popOutAgentsPanel = () => {
    setChatPoppedOut(true)
    setSwitchMode('design')
    setInspectOn(false)
    setHandMode(false)
    setView('canvas')
    setRail('file')
    setLeftOpen(true)
    if (
      toolRef.current === 'pen' ||
      toolRef.current === 'pencil' ||
      toolRef.current === 'brush' ||
      (toolRef.current !== 'pointer' && toolRef.current !== 'hand' && toolRef.current !== 'scale')
    ) {
      setTool('pointer')
    }
  }

  /** Drawing-bar edits also restyle the strokes that are currently selected. */
  const patchSelectedInk = (patch: Partial<DesignNode>) => {
    const ids = new Set(designSelectedRef.current)
    if (!ids.size) return
    let changed = false
    const next = designRef.current.map((node) => {
      if (!ids.has(node.id) || !hasWorldPoints(node)) return node
      if (patch.brushStyle && node.pathTool === 'pen') return node
      changed = true
      return { ...node, ...patch }
    })
    if (changed) persistDesign(next, { skipReflow: true })
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
      setTool('pointer')
      toolRef.current = 'pointer'
      return
    }
    if (gesture.kind === 'browser') {
      const width = Math.max(MIN_VIEWPORT.width, Math.round(current.width || 0))
      const height = Math.max(MIN_VIEWPORT.height, Math.round(current.height || 0))
      if (Math.min(current.width || 0, current.height || 0) < 8) return
      void addBrowser({
        x: Math.round(current.x),
        y: Math.round(current.y),
        width,
        height
      })
      setTool('pointer')
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
      const placed = hasWorldPoints(current) ? current : attachToParent(current, next)
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
      const id = crypto.randomUUID()
      drawRef.current = { id, kind: 'browser', type: 'frame', startX: point.x, startY: point.y }
      setDraft({
        id,
        type: 'frame',
        x: point.x,
        y: point.y,
        width: 1,
        height: 1,
        name: 'Browser',
        pageId: activePageRef.current,
        fill: '#FFFFFF',
        fillOpacity: 1,
        opacity: 1,
        clipsContent: true
      })
      setDesignSelectedIds([])
      setSelectedId(null)
      event.currentTarget.setPointerCapture(event.pointerId)
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
      type === 'frame' ? 'Frame' : type === 'section' ? `Section ${count}` : `${type[0].toUpperCase()}${type.slice(1)} ${count}`
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
      fill: type === 'line' || type === 'arrow' ? undefined : type === 'section' || type === 'frame' ? '#FFFFFF' : type === 'rect' ? '#DDDDDD' : '#D9D9D9',
      fillOpacity: 1,
      opacity: 1,
      radius: type === 'section' ? 2 : 0,
      stroke: type === 'section' || type === 'line' || type === 'arrow' ? '#000000' : undefined,
      strokeWidth: type === 'section' || type === 'line' || type === 'arrow' ? 1 : undefined,
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
    const weight = pathTool === 'brush' ? stroke.brushWeight : pathTool === 'pencil' ? stroke.pencilWeight : stroke.penWeight
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
      strokePaint: stroke.paint,
      stroke: stroke.color,
      strokeWidth: weight
    })
    setDesignSelectedIds([id])
    if (pathTool === 'pen') {
      penDrag.current = { x: event.clientX, y: event.clientY, worldX: point.x, worldY: point.y }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const canvasChatContext = () => {
    const selected = designSelectedRef.current
      .map(id => designRef.current.find(node => node.id === id))
      .filter((node): node is DesignNode => Boolean(node))
    if (!selected.length) return '\n\n[Canvas context] Nothing is selected.'
    const items = selected.slice(0, 40).map(node => `${node.id} (${node.type}${node.name ? ` “${node.name.slice(0, 100)}”` : ''}, ${Math.round(node.width || 0)}×${Math.round(node.height || 0)})`)
    return `\n\n[Canvas context] Selected layers: ${items.join('; ')}.${selected.length > 40 ? ` ${selected.length - 40} more layers selected; inspect their frame if needed.` : ''}`
  }

  const sendChat = async (submitted?: string, editIndex?: number) => {
    const text = (submitted ?? chatInput).trim()
    if (!text || agentBusy || agentChatRef.current || !activeChat) return
    if (rail !== 'chat' && !chatPoppedOut) {
      onCanvasRef.current = false
      syncLayout()
      setSwitchMode('chat')
      setRail('chat')
      setLeftOpen(true)
    }
    setChatInput('')
    const chatId = activeChat.id
    const baseMessages = editIndex == null ? activeChat.messages : activeChat.messages.slice(0, editIndex)
    const startedAt = Date.now()
    const titled = activeChat.title === 'New chat' ? text.slice(0, 42) : activeChat.title
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? { ...chat, title: titled, messages: [...baseMessages, { role: 'user', text, createdAt: startedAt }, { role: 'assistant', text: '', startedAt }] }
          : chat
      )
    )
    const previous = baseMessages.filter(message => (message.role === 'user' || message.role === 'assistant') && message.text.trim()).map(message => ({ role: message.role as 'user' | 'assistant', text: message.text }))
    const nextHistory = [...previous, { role: 'user' as const, text: text + canvasChatContext() }]
    agentChatRef.current = chatId
    agentTextRef.current = ''
    sendDesignToMain(designRef.current)
    chatHistories.current.set(chatId, nextHistory)
    historyRef.current = nextHistory
    setAgentBusy(true)
    try {
      await window.vanta.runAgent(nextHistory, resolveChatModel(activeChat?.model), chatId)
    } catch (error) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [...chat.messages.map(message => message.startedAt && !message.finishedAt ? { ...message, finishedAt: Date.now() } : message), { role: 'system', text: error instanceof Error ? error.message : String(error) }]
              }
            : chat
        )
      )
      agentChatRef.current = null
      setAgentBusy(false)
    }
  }

  /** Structure / app actions requested from chat. Values come from the user's words. */
  const runJevCommand = (id: CommandId, request: string): CommandResult | Promise<CommandResult> => {
    const selectedNodes = designSelectedRef.current
      .map((nodeId) => designRef.current.find((node) => node.id === nodeId))
      .filter((node): node is DesignNode => Boolean(node))
    const command = commandById(id)
    const blocked = command ? commandRunnable(command, selectedNodes) : 'Unknown action.'
    if (blocked) return { error: blocked }
    const count = selectedNodes.length
    const layers = `${count} layer${count === 1 ? '' : 's'}`
    const quotedOr = (pattern: RegExp) => {
      const quoted = request.match(/["“]([^"”]+)["”]/)?.[1]
      return (quoted || request.match(pattern)?.[1] || '').trim().replace(/[.!?]+$/, '')
    }
    const align = (action: AlignAction, what: string) => {
      alignSelection(action)
      return { summary: `Aligned ${what} of ${layers}` }
    }

    if (id.startsWith('create_')) {
      const canvas = canvasRef.current
      const center = canvas
        ? screenToWorld(cameraRef.current, canvas.clientWidth / 2, canvas.clientHeight / 2)
        : { x: 120, y: 120 }
      const host = selectedNodes.length === 1 && (selectedNodes[0].type === 'frame' || selectedNodes[0].type === 'section') ? selectedNodes[0] : null
      const dims = extractDimensions(request)
      const color = extractColor(request)
      const defaults: Record<string, { w: number; h: number }> = {
        create_rect: { w: 120, h: 120 },
        create_ellipse: { w: 120, h: 120 },
        create_frame: { w: 400, h: 300 },
        create_star: { w: 120, h: 120 },
        create_polygon: { w: 120, h: 120 },
        create_text: { w: 80, h: 20 }
      }
      const size = defaults[id] || { w: 120, h: 120 }
      const square = /\b(square|circle)\b/i.test(request)
      const width = dims?.width ?? (square && dims?.height ? dims.height : size.w)
      const height = dims?.height ?? (square ? width : size.h)
      const at = host ? { x: 24, y: 24 } : { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) }
      const base: DesignNode = {
        id: crypto.randomUUID(),
        type: 'rect',
        x: at.x,
        y: at.y,
        width,
        height,
        pageId: activePageRef.current,
        parentId: host?.id || null
      }
      let node: DesignNode
      if (id === 'create_text') {
        const words = quotedOr(/\b(?:saying|says|that says|reading|with the words|with)\s+(.+)$/i) || 'Text'
        const fontSize = Number(request.match(/\b(?:size|font)\s*(\d+)/i)?.[1]) || 16
        node = remeasureText({ ...base, type: 'text', text: words, name: words, fontSize, fontFamily: 'Inter', fontWeight: 400, fill: color || '#000000', textResize: 'auto-width' })
      } else if (id === 'create_frame') {
        node = { ...base, type: 'frame', name: 'Frame', fill: color || '#FFFFFF' }
      } else if (id === 'create_ellipse') {
        node = { ...base, type: 'ellipse', name: 'Ellipse', fill: color || '#D9D9D9' }
      } else if (id === 'create_star') {
        node = { ...base, type: 'star', name: 'Star', starCount: 5, starRatio: 0.382, fill: color || '#D9D9D9' }
      } else if (id === 'create_polygon') {
        const sides = /\bhexagon\b/i.test(request) ? 6 : /\bpentagon\b/i.test(request) ? 5 : /\boctagon\b/i.test(request) ? 8 : 3
        node = { ...base, type: 'polygon', name: sides === 3 ? 'Triangle' : 'Polygon', polygonCount: sides, fill: color || '#D9D9D9' }
      } else {
        node = { ...base, type: 'rect', name: 'Rectangle', fill: color || '#D9D9D9' }
      }
      persistDesign([...designRef.current, node])
      setDesignSelectedIds([node.id])
      setSelectedId(null)
      return { summary: `Added ${node.name}${host ? ` inside ${host.name || 'the frame'}` : ''}` }
    }

    switch (id) {
      case 'duplicate':
        duplicateSelected()
        return { summary: `Duplicated ${layers}` }
      case 'group':
        frameSelected()
        return { summary: `Grouped ${layers} in a frame` }
      case 'wrap_flex':
        wrapFlexSelected()
        return { summary: `Wrapped ${layers} in auto layout` }
      case 'ungroup':
        ungroupSelected()
        return { summary: `Ungrouped ${layers}` }
      case 'bring_front':
        moveSelectionZ('front')
        return { summary: `Brought ${layers} to the front` }
      case 'send_back':
        moveSelectionZ('back')
        return { summary: `Sent ${layers} to the back` }
      case 'align_left':
        return align('left', 'left edges')
      case 'align_hcenter':
        return align('hcenter', 'horizontal centers')
      case 'align_right':
        return align('right', 'right edges')
      case 'align_top':
        return align('top', 'top edges')
      case 'align_vcenter':
        return align('vcenter', 'vertical centers')
      case 'align_bottom':
        return align('bottom', 'bottom edges')
      case 'undo':
        undoDesign()
        return { summary: 'Undid the last change' }
      case 'redo':
        redoDesign()
        return { summary: 'Redid the change' }
      case 'add_page': {
        const name = quotedOr(/\b(?:called|named|titled)\s+(.+)$/i) || `Page ${pages.length + 1}`
        const page = { id: crypto.randomUUID(), name, fill: '#EEEEEE', fillDark: '#2C2C2C' }
        persistPages([...pages, page], page.id)
        return { summary: `Added page “${name}”` }
      }
      case 'go_to_page': {
        const lower = request.toLowerCase()
        const byName = [...pages].sort((a, b) => b.name.length - a.name.length).find((page) => lower.includes(page.name.toLowerCase()))
        const index = Number(lower.match(/\bpage\s+(\d+)\b/)?.[1])
        const at = pages.findIndex((page) => page.id === activePageRef.current)
        const page =
          byName ||
          (Number.isFinite(index) && index > 0 ? pages[index - 1] : undefined) ||
          (/\bnext\b/.test(lower) ? pages[at + 1] : /\b(previous|prev|last)\b/.test(lower) ? pages[at - 1] : undefined)
        if (!page) return { error: `I couldn’t find that page. Pages: ${pages.map((item) => item.name).join(', ')}.` }
        persistPages(pages, page.id)
        return { summary: `Switched to “${page.name}”` }
      }
      case 'rename_page': {
        const name = quotedOr(/\b(?:to|as|called)\s+(.+)$/i)
        if (!name) return { error: 'What should the page be called? Try “rename page to Home”.' }
        persistPages(pages.map((page) => (page.id === activePageRef.current ? { ...page, name } : page)))
        return { summary: `Renamed the page to “${name}”` }
      }
      case 'create_svg': {
        if (!quiverConfigured) return { error: 'Create SVG needs a QuiverAI key. Open Create SVG and paste one first.' }
        const prompt =
          quotedOr(/\b(?:of|for|showing|that shows|with)\s+(.+)$/i) ||
          request.replace(/^.*?\b(svg|vector|icon|illustration|logo)\b\s*/i, '').trim() ||
          request
        pendingCreateSvgJob.current = { kind: 'create', prompt }
        setCreateSvgOpen(true)
        return { summary: `Creating an SVG: ${prompt}` }
      }
      case 'remove_background':
        pendingCreateSvgJob.current = { kind: 'remove-bg' }
        setCreateSvgOpen(true)
        return { summary: 'Removing the background…' }
      case 'vectorize':
        pendingCreateSvgJob.current = { kind: 'vectorize' }
        setCreateSvgOpen(true)
        return { summary: 'Vectorizing the image…' }
      case 'export': {
        const lower = request.toLowerCase()
        const format: ExportFormat = /\bsvg\b/.test(lower) ? 'SVG' : /\bjpe?g\b/.test(lower) ? 'JPG' : /\bpdf\b/.test(lower) ? 'PDF' : 'PNG'
        const scale = Number(lower.match(/@?(\d(?:\.\d+)?)\s*x\b/)?.[1]) || 1
        const ids = new Set(selectedNodes.map((node) => node.id))
        const roots = selectedNodes.filter((node) => !node.parentId || !ids.has(node.parentId))
        return Promise.all(roots.map((node) => exportNodeSetting(node, { id: 'chat-export', format, scale }, designRef.current))).then(
          () => ({ summary: `Exported ${roots.length} layer${roots.length === 1 ? '' : 's'} as ${format}${scale !== 1 ? ` @${scale}x` : ''}` })
        )
      }
      case 'open_browser': {
        const raw = request.match(/\b((?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)/i)?.[1]
        if (!raw) return { error: 'Which website? Try “open stripe.com”.' }
        const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        return addBrowser({ url }).then(() => ({ summary: `Opened ${url}` }))
      }
      default:
        return { error: 'That action isn’t wired up yet.' }
    }
  }

  /** Multi-step requests go to Claude with the current selection as context. */
  const delegateToClaude = (request: string): CommandResult => {
    if (!agentConfiguredRef.current) {
      return { error: 'Claude needs an API key. Add ANTHROPIC_API_KEY to the project .env (get one at console.anthropic.com/settings/keys) and restart Scobe.' }
    }
    if (agentBusy) return { error: 'Claude is still working on the last request.' }
    const context = canvasChatContext()
    const chatId = activeChatIdRef.current || resolvedChatId
    const nextHistory = [...(chatHistories.current.get(chatId) || historyRef.current), { role: 'user' as const, text: request + context }]
    chatHistories.current.set(chatId, nextHistory)
    historyRef.current = nextHistory
    sendDesignToMain(designRef.current)
    agentChatRef.current = chatId
    agentTextRef.current = ''
    setAgentBusy(true)
    void window.vanta.runAgent(nextHistory, resolveChatModel(chats.find(chat => chat.id === chatId)?.model), chatId).catch((error) => {
      setChats((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? { ...chat, messages: [...chat.messages, { role: 'system', text: error instanceof Error ? error.message : String(error) }] }
            : chat
        )
      )
      agentChatRef.current = null
      setAgentBusy(false)
    })
    return { summary: 'Claude is building this. Its steps show below.' }
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
    if (id !== activeFileIdRef.current) {
      void captureActiveFileThumbnail(activeFileIdRef.current)
      rememberActiveDesign()
      setActiveFileId(id)
      applyFileDesign(id)
    } else {
      setActiveFileId(id)
    }
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, editedAt: Date.now() } : file)))
    setView('canvas')
  }

  const addFile = (name?: string) => {
    rememberActiveDesign()
    const id = crypto.randomUUID()
    const nextName = name?.trim() || `File ${files.length + 1}`
    designsByFileRef.current[id] = []
    setFiles((current) => [...current, { id, name: nextName.slice(0, 48), editedAt: Date.now() }])
    setActiveFileId(id)
    applyFileDesign(id, [])
    setView('canvas')
  }

  const closeFile = (id: string) => {
    rememberActiveDesign()
    setFiles((current) => {
      const filtered = current.filter((file) => file.id !== id)
      const remaining = filtered.length
        ? filtered
        : [{ id: crypto.randomUUID(), name: 'Untitled', editedAt: Date.now() }]
      delete designsByFileRef.current[id]
      if (!filtered.length) {
        designsByFileRef.current[remaining[0]!.id] = []
      }
      const closingActive = id === activeFileIdRef.current
      const fallback =
        remaining.find((file) => file.id === activeFileIdRef.current) || remaining[0]!
      if (closingActive) {
        setActiveFileId(fallback.id)
        queueMicrotask(() => applyFileDesign(fallback.id))
      }
      setView('canvas')
      return remaining
    })
  }

  const selectedNode = pageNodes.find((node) => node.id === designSelectedId) || null
  const selectedInk =
    designSelectedIds.length === 1 && selectedNode && hasWorldPoints(selectedNode) && selectedNode.pathTool !== 'pen' && !draft
      ? selectedNode
      : null
  const measurePrimary =
    (tool === 'measure' || altHeld) && designSelectedId
      ? pageNodes.find((node) => node.id === designSelectedId) || null
      : null
  const measureTarget =
    measurePrimary && measureHoverId && measureHoverId !== measurePrimary.id
      ? pageNodes.find((node) => node.id === measureHoverId) || null
      : null
  const measureOffsetKey = `${measurePrimary?.id || ''}|${measureTarget?.id || '_'}`
  const autoMeasureLines = measurePrimary
    ? measureTarget
      ? distanceMeasurements(resolveWorldRect(measurePrimary, pageNodes), resolveWorldRect(measureTarget, pageNodes))
      : tool === 'measure'
        ? sizeMeasurements(resolveWorldRect(measurePrimary, pageNodes))
        : []
    : []
  const pinnedMeasureLines: MeasureLine[] = measurePins.map((pin) =>
    offsetMeasureLine(pin.base, pin.offset)
  )
  const measureLines = [
    ...autoMeasureLines.map((line) => {
      const key = `${measureOffsetKey}|${line.id}`
      const offset = measureOffsets[key]
      return offset == null ? line : offsetMeasureLine(line, offset)
    }),
    ...pinnedMeasureLines,
    ...(measureDraft ? [measureDraft] : [])
  ]
  measureLinesRef.current = measureLines
  const measureSelectedRect = measurePrimary ? resolveWorldRect(measurePrimary, pageNodes) : null
  const measureHoverRect = measureTarget ? resolveWorldRect(measureTarget, pageNodes) : null
  const measureEdgeHighlight = measureEdgeHover
    ? (() => {
        const node = pageNodes.find((item) => item.id === measureEdgeHover.nodeId)
        if (!node) return null
        const box = resolveWorldRect(node, pageNodes)
        if (measureEdgeHover.edge === 'n') return { x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y }
        if (measureEdgeHover.edge === 's')
          return { x1: box.x, y1: box.y + box.height, x2: box.x + box.width, y2: box.y + box.height }
        if (measureEdgeHover.edge === 'w') return { x1: box.x, y1: box.y, x2: box.x, y2: box.y + box.height }
        return { x1: box.x + box.width, y1: box.y, x2: box.x + box.width, y2: box.y + box.height }
      })()
    : null
  const measureTitles: MeasureTitle[] = (() => {
    if (!(tool === 'measure' || altHeld)) return []
    const titles: MeasureTitle[] = []
    const seen = new Set<string>()
    const push = (node: DesignNode | null) => {
      if (!node || seen.has(node.id) || node.type === 'comment') return
      // Top-level frames/sections already show their canvas name label.
      const parent = node.parentId ? pageNodes.find((item) => item.id === node.parentId) : null
      const isArtboard =
        (node.type === 'frame' || node.type === 'section') &&
        (!node.parentId || parent?.type === 'section')
      if (isArtboard) return
      seen.add(node.id)
      const box = resolveWorldRect(node, pageNodes)
      titles.push({
        id: node.id,
        name:
          node.name ||
          node.text ||
          (node.type === 'frame'
            ? 'Frame'
            : node.type === 'rect'
              ? 'Rectangle'
              : `${node.type[0].toUpperCase()}${node.type.slice(1)}`),
        kind: node.type,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      })
    }
    push(measurePrimary)
    return titles
  })()
  const activePage = pages.find((page) => page.id === activePageId) || pages[0] || DEFAULT_PAGE
  const canvasFill = resolvePageFill(activePage, theme)
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
          patchFrame(selected.id, { width: size.width, height: size.height }),
        measure: {
          active: browserMeasureId === selected.id,
          inspect: browserMeasureInspect,
          xray: browserMeasureXray,
          onToggle: () => {
            selectBrowsers([selected.id])
            setDesignSelectedIds([])
            setInspectOn(false)
            setBrowserMeasureId((current) => (current === selected.id ? null : selected.id))
            setBrowserMeasureInspect(true)
            setBrowserMeasureXray(false)
          },
          onInspect: () => setBrowserMeasureInspect((value) => !value),
          onXray: () => setBrowserMeasureXray((value) => !value)
        },
        snapshot: {
          active: snapshotBrowserId === selected.id,
          onToggle: () => {
            if (typeof window.vanta.setSnapshot !== 'function') {
              window.alert('Snapshot needs a restart. Quit and reopen Scobe, then try again.')
              return
            }
            selectBrowsers([selected.id])
            setDesignSelectedIds([])
            setInspectOn(false)
            setBrowserMeasureId(null)
            setSnapshotBrowserId((current) => (current === selected.id ? null : selected.id))
          },
          onCapturePage: () => {
            const tabId = selected.activeTabId || selected.tabs[0]?.id
            if (!tabId) return
            if (typeof window.vanta.snapshotPage !== 'function') {
              window.alert('Capture page needs a restart. Quit and reopen Scobe, then try again.')
              return
            }
            selectBrowsers([selected.id])
            setDesignSelectedIds([])
            setInspectOn(false)
            setBrowserMeasureId(null)
            setSnapshotBrowserId(selected.id)
            void window.vanta.snapshotPage(tabId).catch(() => setSnapshotBrowserId(null))
          }
        },
        dock: selectedTab
          ? {
              active: dockedTab?.tabId === selectedTab.id,
              onToggle: () => dockBrowserTab(selected.id, selectedTab.id)
            }
          : undefined
      }
    : null

  return (
    <div className="app" data-theme={theme}>
      <FileTabs
        files={files}
        activeId={view === 'home' || view === 'new-tab' ? '' : activeFileId}
        newTabActive={view === 'new-tab'}
        onHome={() => {
          exitCodingFullscreen()
          void captureActiveFileThumbnail()
          setView('home')
        }}
        onSelect={openFile}
        onClose={closeFile}
        onNew={() => {
          exitCodingFullscreen()
          void captureActiveFileThumbnail()
          setView('new-tab')
        }}
        onCloseNewTab={() => {
          setView(activeFileId ? 'canvas' : 'home')
        }}
        onRename={(id, name) => setFiles((current) => current.map((file) => (file.id === id ? { ...file, name } : file)))}
      />
      <div className={`workspace${codingFullscreen ? ' is-agent-full' : ''}`}>
        {view === 'canvas' && (
        <LeftSidebar
          tab={rail}
          onTab={(next) => {
            setRail(next)
            setLayerMenu(null)
            setContextMenu(null)
            setView('canvas')
            if (next === 'coding-agents') {
              if (dockedTabRef.current) undockBrowserTab()
              setLeftOpen(true)
              // Re-open fullscreen agent browser if a session is already unlocked.
              if (codingActive && !codingFullscreenRef.current) {
                requestAnimationFrame(() => enterCodingFullscreen())
              }
            } else if (!(next === 'tabs' && dockedTabRef.current)) {
              // Leaving the docked browser surface — drop side panes / FS so they
              // can't linger as ghost layout after Escape or a rail switch.
              if (sideBrowsersRef.current.length || codingFullscreenRef.current) {
                collapseAgentWorkspace()
              }
            }
            if (next === 'chat') {
              onCanvasRef.current = false
              syncLayout()
              clearAgentFsToolbarTimer()
              agentFsPending.current = null
              setToolbarHiddenForAgentFs(false)
              setSwitchMode('chat')
              setLeftOpen(true)
            } else if (rail === 'chat') {
              setSwitchMode((current) => (current === 'chat' ? 'design' : current))
              setChatPoppedOut(false)
            }
          }}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          fileName={activeFile?.name || 'Untitled'}
          onRenameFile={(name) => {
            if (!activeFileId) return
            setFiles((current) => current.map((file) => (file.id === activeFileId ? { ...file, name } : file)))
          }}
          browsers={browsers}
          dockedTab={dockedTab}
          onDockTab={dockBrowserTab}
          onUndockTab={undockBrowserTab}
          onDockedTabNavigate={(url) => {
            const docked = dockedTabRef.current
            if (!docked) return
            setBrowsers((current) =>
              current.map((item) =>
                item.id === docked.windowId
                  ? {
                      ...item,
                      tabs: item.tabs.map((tab) => (tab.id === docked.tabId ? { ...tab, url } : tab))
                    }
                  : item
              )
            )
            void window.vanta.navigate(docked.tabId, url)
          }}
          onDockedTabBack={() => {
            const docked = dockedTabRef.current
            if (docked) void window.vanta.back(docked.tabId)
          }}
          onDockedTabForward={() => {
            const docked = dockedTabRef.current
            if (docked) void window.vanta.forward(docked.tabId)
          }}
          onDockedTabReload={() => {
            const docked = dockedTabRef.current
            if (docked) void window.vanta.reload(docked.tabId)
          }}
          onFocusWindow={(id) => {
            selectBrowsers([id])
            const frame = browsers.find((item) => item.id === id)
            if (frame) void window.vanta.focus(frame.activeTabId)
          }}
          onActivateTab={(windowId, tabId) => {
            switchOmniboxTab(windowId, tabId)
          }}
          onCloseTab={(windowId, tabId) => {
            closeBrowserTab(windowId, tabId)
          }}
          chats={chats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            prompt: chat.messages.find((message) => message.role === 'user')?.text || ''
          }))}
          activeChatId={resolvedChatId}
          onSelectChat={selectChat}
          onNewChat={newChat}
          canvasHistory={canvasHistory}
          onRestoreHistory={restoreCanvasVersion}
          pages={pages}
          activePageId={activePageId}
          pageQuery={pageQuery}
          onPageQuery={setPageQuery}
          onSelectPage={(id) => persistPages(pages, id)}
          onAddPage={() => {
            const page = { id: crypto.randomUUID(), name: `Page ${pages.length + 1}`, fill: '#EEEEEE', fillDark: '#2C2C2C' }
            persistPages([...pages, page], page.id)
          }}
          onRenamePage={(id, name) => persistPages(pages.map((page) => (page.id === id ? { ...page, name } : page)))}
          layers={layers}
          onSelectLayer={(id, kind) => {
            if (kind === 'browser') {
              setDesignSelectedIds([])
              selectBrowsers([id])
              const frame = browsers.find((item) => item.id === id)
              if (frame) void window.vanta.focus(frame.activeTabId)
              return
            }
            if (kind === 'comment') {
              openCommentThread(id)
              return
            }
            setActiveCommentId(null)
            clearBrowserSelection()
            setDesignSelectedIds([id])
          }}
          onRenameLayer={(id, name) => {
            persistDesign(designRef.current.map((node) => (node.id === id ? { ...node, name } : node)))
          }}
          onOpenLayerMenu={(id, kind, rect) => {
            if (kind === 'browser' || kind === 'comment') return
            setLayerMenu({
              layerId: id,
              x: Math.round(rect.right + 6),
              y: Math.round(rect.top)
            })
          }}
          onToggleLayerVisible={toggleLayerVisible}
          onToggleLayerLock={toggleLayerLock}
          onMoveLayers={moveLayersInPanel}
          onCollapseLayersToken={collapseLayersToken}
          panelOpen={leftOpen}
          panelWidth={leftWidth}
          onTogglePanel={() => setLeftOpen((value) => !value)}
          onResizePanel={setLeftWidth}
          rightOpen={rightOpen}
          rightWidth={rightWidth}
          codingActive={codingActive}
          codingAgentUrl={codingAgentUrl}
          codingRecents={codingRecents}
          codingPopup={codingPopup}
          codingFullscreen={codingFullscreen}
          sideBrowsers={sideBrowsers}
          hideFullscreenControl={sideBrowsers.length > 0}
          tabsPopup={tabsPopup}
          onTabsPopup={(open) => {
            setTabsPopup(open)
            if (open) {
              // Leave any existing coding-agent popup underneath so Open tab overlays it.
              exitCodingFullscreen()
            }
          }}
          onOpenTabInCanvas={() => {
            void openTabInCanvas()
          }}
          onOpenTabToLeft={() => {
            void openTabToLeft()
          }}
          onCodingPopup={(open) => {
            setCodingPopup(open)
            if (open) {
              setTabsPopup(false)
              exitCodingFullscreen()
            }
          }}
          onCodingChoose={(agentId, openUrl) => openCodingAgent(agentId, undefined, undefined, openUrl)}
          onCodingResume={(id) => {
            // Resume only after MCP gate — same unlock path as Connect → Done.
            const found = codingRecents.find((item) => item.id === id)
            if (found) {
              setCodingPopup(true)
            }
          }}
          onCodingFullscreen={() => {
            if (codingFullscreen) exitCodingFullscreen()
            else enterCodingFullscreen()
          }}
          onCodingAgentNavigate={(url) => {
            setCodingAgentUrl(url)
            void window.vanta.navigate(SIDEBAR_BROWSER_ID, url)
          }}
          onCodingAgentBack={() => void window.vanta.back(SIDEBAR_BROWSER_ID)}
          onCodingAgentForward={() => void window.vanta.forward(SIDEBAR_BROWSER_ID)}
          onCodingAgentReload={() => void window.vanta.reload(SIDEBAR_BROWSER_ID)}
          onAddAgentSideBrowser={openAgentSideBrowser}
          onCloseSideBrowser={closeSideBrowser}
          onCloseCodingAgent={closeCodingAgent}
          onChromeLayout={syncLayout}
          onSideBrowserUrl={(id, url) => {
            setSideBrowsers((current) => current.map((item) => (item.id === id ? { ...item, url } : item)))
          }}
          onSideBrowserNavigate={(id, url) => {
            setSideBrowsers((current) => current.map((item) => (item.id === id ? { ...item, url } : item)))
            void window.vanta.navigate(id, url)
          }}
          onSideBrowserBack={(id) => void window.vanta.back(id)}
          onSideBrowserForward={(id) => void window.vanta.forward(id)}
          onSideBrowserReload={(id) => void window.vanta.reload(id)}
          onAgentHole={(el) => {
            agentHole.current = el
            syncLayout()
          }}
          onSideBrowserHole={(id, el) => {
            if (el) agentSideHoles.current.set(id, el)
            else agentSideHoles.current.delete(id)
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
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          />
        ) : view === 'new-tab' ? (
          <NewTabScreen
            files={files}
            theme={theme}
            onNewFile={() => addFile()}
            onBrowse={() => setView('home')}
            onOpen={openFile}
          />
        ) : (
          <>
            {/* Keep canvas mounted while in chat — remounting DesignLayer freezes the switch. */}
            <div
              className="workspace-page"
              hidden={rail === 'chat'}
              aria-hidden={rail === 'chat'}
              style={rail === 'chat' ? { display: 'none' } : undefined}
            >
          <div
            ref={canvasRef}
            className={`canvas${panning ? ' is-panning' : ''}${tool === 'hand' || handMode || spaceHeld ? ' is-hand' : ''}${deepSelectHeld ? ' is-deep-select' : ''}${['frame', 'section', 'browser', 'shape', 'pen', 'pencil', 'brush', 'text', 'text-on-path', 'comment', 'widget'].includes(tool) ? ' is-design' : ''}${pathHoverId && (tool === 'text' || tool === 'text-on-path') ? ' is-text-path' : ''}${jev.picking ? ' is-jev-point' : ''}`}
            data-tool={tool}
            style={activePage.fillHidden ? {
              backgroundColor: theme === 'dark' ? '#252525' : '#ffffff',
              backgroundImage: theme === 'dark' ? 'repeating-conic-gradient(#303030 0% 25%, transparent 0% 50%)' : 'repeating-conic-gradient(#ededed 0% 25%, transparent 0% 50%)',
              backgroundSize: '12px 12px'
            } : { background: canvasFill }}
            onContextMenu={(event) => {
              if (view !== 'canvas') return
              const target = event.target as HTMLElement
              if (target.closest('.canvas-toolbar-stack, .canvas-toolbar, .draw-stroke-bar, .ctx-menu')) return
              openContextMenu(event, worldFromEvent(event))
            }}
            onPointerDownCapture={(event) => {
              // Clicking the canvas takes focus out of the composer / inspector fields so
              // arrow keys, Tab, Enter and Delete act on the selection (Paper).
              const active = document.activeElement
              const pressed = event.target as HTMLElement
              if (
                active instanceof HTMLElement &&
                active !== document.body &&
                !active.contains(pressed) &&
                !pressed.closest('.canvas-toolbar-stack, input, textarea, select, [contenteditable="true"]') &&
                (active instanceof HTMLInputElement ||
                  active instanceof HTMLTextAreaElement ||
                  active instanceof HTMLSelectElement ||
                  active.isContentEditable) &&
                !active.closest('.design-text-editor, .text-on-path-input')
              ) {
                active.blur()
              }
              if (toolRef.current !== 'measure' || event.button !== 0) return
              const target = event.target as HTMLElement
              if (target.closest('.canvas-toolbar-stack, .canvas-toolbar, .draw-stroke-bar')) return
              const point = worldFromEvent(event)
              const threshold = 10 / Math.max(0.0001, cameraRef.current.zoom)
              const hitLine = hitTestMeasureLine(measureLinesRef.current, point, threshold)
              if (hitLine) {
                event.stopPropagation()
                event.preventDefault()
                const pinned = measurePins.some((pin) => pin.id === hitLine.id)
                const current =
                  hitLine.axis === 'h' ? hitLine.y1 : hitLine.x1
                measureSlide.current = {
                  lineId: hitLine.id,
                  axis: hitLine.axis,
                  startOffset: current,
                  startPointer: hitLine.axis === 'h' ? point.y : point.x,
                  slideMin: hitLine.slideMin,
                  slideMax: hitLine.slideMax,
                  pinned,
                  offsetKey: `${designSelectedRef.current[designSelectedRef.current.length - 1] || ''}|${measureHoverId || '_'}`
                }
                setMeasureActiveLineId(hitLine.id)
                event.currentTarget.setPointerCapture(event.pointerId)
                return
              }
              const page = designRef.current.filter(
                (node) =>
                  (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                  node.type !== 'comment'
              )
              const anchor = findMeasureAnchorAt(point, page, threshold)
              if (anchor) {
                event.stopPropagation()
                event.preventDefault()
                measureCreate.current = { start: anchor, current: point, target: null }
                setMeasureEdgeHover(anchor)
                setDesignSelectedIds([anchor.nodeId])
                designSelectedRef.current = [anchor.nodeId]
                setSelectedId(null)
                event.currentTarget.setPointerCapture(event.pointerId)
              }
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
              if (target.closest('.frame, .design-frame, .design-shape, .design-text, .design-comment, .design-widget, .text-on-path, .draw-path, .draw-pen-stroke, .draw-brush-fill')) {
                const creating =
                  toolRef.current === 'shape' ||
                  toolRef.current === 'frame' ||
                  toolRef.current === 'section' ||
                  toolRef.current === 'pen' ||
                  toolRef.current === 'pencil' ||
                  toolRef.current === 'brush' ||
                  toolRef.current === 'widget'
                if (creating) {
                  setSelectedId(null)
                  startDesign(event)
                  return
                }
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
              if (pointerEndedTextEdit(event.nativeEvent)) return
              if (!event.shiftKey) {
                setDesignSelectedIds([])
                selectBrowsers([])
              }
              if (switchMode !== 'chat') setInspectOn(false)
              const canvas = canvasRef.current
              if (!canvas) return
              const rect = canvas.getBoundingClientRect()
              // Figma-style nested marquee: always deep — frames only when fully enclosed,
              // otherwise the elements inside the drag. Ctrl/Cmd also lets the gesture start
              // on top of a frame (DesignLayer won't steal it).
              const deep = true
              marquee.current = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                shift: event.shiftKey,
                deep,
                pick: event.ctrlKey || event.metaKey || deepSelectHeldRef.current,
                baseIds: event.shiftKey ? [...designSelectedRef.current] : [],
                baseBrowserIds: event.shiftKey ? [...selectedBrowserRef.current] : []
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const canvas = canvasRef.current
              if (measureSlide.current) {
                const slide = measureSlide.current
                const point = worldFromEvent(event)
                const pointer = slide.axis === 'h' ? point.y : point.x
                const next = Math.min(
                  slide.slideMax,
                  Math.max(slide.slideMin, slide.startOffset + (pointer - slide.startPointer))
                )
                if (slide.pinned) {
                  setMeasurePins((current) =>
                    current.map((pin) => (pin.id === slide.lineId ? { ...pin, offset: next } : pin))
                  )
                } else {
                  const key = `${slide.offsetKey}|${slide.lineId}`
                  setMeasureOffsets((current) => ({ ...current, [key]: next }))
                }
                return
              }
              if (measureCreate.current) {
                const point = worldFromEvent(event)
                const page = designRef.current.filter(
                  (node) =>
                    (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                    node.type !== 'comment'
                )
                const threshold = 10 / Math.max(0.0001, cameraRef.current.zoom)
                let target = findMeasureAnchorAt(point, page, threshold)
                if (target && target.nodeId === measureCreate.current.start.nodeId && target.edge === measureCreate.current.start.edge) {
                  target = null
                }
                const end = target || freeMeasureAnchor(measureCreate.current.start, point)
                measureCreate.current = { ...measureCreate.current, current: point, target }
                setMeasureEdgeHover(target || measureCreate.current.start)
                const preview = measurementBetweenAnchors('draft', measureCreate.current.start, end)
                setMeasureDraft(preview)
                return
              }
              if (canvas && !pan.current) {
                const rect = canvas.getBoundingClientRect()
                const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top }
                if (toolRef.current === 'comment') setCommentCursor(screen)
                if (toolRef.current === 'pencil' || toolRef.current === 'brush') setDrawCursor(screen)
                else setDrawCursor(null)
                if (toolRef.current === 'measure' || altHeld) {
                  const point = worldFromEvent(event)
                  const candidates = designRef.current.filter(
                    (node) =>
                      (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                      (node.type !== 'comment' || !node.resolved)
                  )
                  const threshold = 10 / Math.max(0.0001, cameraRef.current.zoom)
                  if (toolRef.current === 'measure') {
                    const lineHit = hitTestMeasureLine(measureLinesRef.current, point, threshold)
                    if (lineHit) {
                      setMeasureActiveLineId(lineHit.id)
                      setMeasureEdgeHover(null)
                    } else {
                      setMeasureActiveLineId(null)
                      const anchor = findMeasureAnchorAt(point, candidates, threshold)
                      setMeasureEdgeHover(anchor)
                    }
                  }
                  const hit = pickDeepAtPoint(point, candidates)
                  setMeasureHoverId(hit?.id || null)
                } else if (measureHoverId) {
                  setMeasureHoverId(null)
                  setMeasureEdgeHover(null)
                  setMeasureActiveLineId(null)
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
                // Latch deep for the gesture once Ctrl/Cmd is seen (event.ctrlKey can drop on Windows).
                const deep =
                  start.deep ||
                  deepSelectHeldRef.current ||
                  event.ctrlKey ||
                  event.metaKey
                start.deep = deep
                const rect = canvasRef.current.getBoundingClientRect()
                const x = event.clientX - rect.left
                const y = event.clientY - rect.top
                const left = Math.min(start.x, x)
                const top = Math.min(start.y, y)
                const width = Math.abs(x - start.x)
                const height = Math.abs(y - start.y)
                setMarqueeBox({ left, top, width, height })
                if (width > 2 || height > 2) {
                  const hits = marqueeHits({ left, top, width, height }, x < start.x, deep)
                  const next = start.shift ? [...new Set([...start.baseIds, ...hits.nodeIds])] : hits.nodeIds
                  const nextBrowsers = start.shift
                    ? [...new Set([...start.baseBrowserIds, ...hits.browserIds])]
                    : hits.browserIds
                  designSelectedRef.current = next
                  setDesignSelectedIds(next)
                  selectBrowsers(nextBrowsers)
                } else if (!start.shift) {
                  designSelectedRef.current = []
                  setDesignSelectedIds([])
                  selectBrowsers([])
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
              if (
                toolRef.current === 'pointer' &&
                !marquee.current &&
                !pan.current
              ) {
                const pageNodes = designRef.current.filter(
                  (node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current
                )
                const deep = pickDeepAtPoint(point, pageNodes)
                if (jev.picking) jev.notePointer(deep?.id || null)
                const deepMode = deepSelectHeldRef.current || event.ctrlKey || event.metaKey
                let hoverId: string | null = null
                if (deep) {
                  hoverId = deepMode
                    ? deep.id
                    : resolveClickTarget(deep, pageNodes, designSelectedRef.current)
                }
                if (hoverId && designSelectedRef.current.includes(hoverId)) hoverId = null
                if (hoverId !== deepHoverIdRef.current) {
                  deepHoverIdRef.current = hoverId
                  setDeepHoverId(hoverId)
                }
              } else if (deepHoverIdRef.current) {
                deepHoverIdRef.current = null
                setDeepHoverId(null)
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
              if (deepHoverIdRef.current) {
                deepHoverIdRef.current = null
                setDeepHoverId(null)
              }
            }}
            onPointerUp={async (event) => {
              if (measureSlide.current) {
                measureSlide.current = null
                setMeasureActiveLineId(null)
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                return
              }
              if (measureCreate.current) {
                const draft = measureCreate.current
                const point = worldFromEvent(event)
                const page = designRef.current.filter(
                  (node) =>
                    (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                    node.type !== 'comment'
                )
                const threshold = 10 / Math.max(0.0001, cameraRef.current.zoom)
                let target = findMeasureAnchorAt(point, page, threshold)
                if (
                  target &&
                  target.nodeId === draft.start.nodeId &&
                  target.edge === draft.start.edge
                ) {
                  target = null
                }
                const end = target || freeMeasureAnchor(draft.start, point)
                const moved =
                  Math.hypot(point.x - draft.start.x, point.y - draft.start.y) > 4 / cameraRef.current.zoom
                if (moved) {
                  const line = measurementBetweenAnchors(`pin-${crypto.randomUUID()}`, draft.start, end)
                  if (line) {
                    setMeasurePins((current) => [
                      ...current,
                      { id: line.id, base: line, offset: line.axis === 'h' ? line.y1 : line.x1 }
                    ])
                  }
                }
                measureCreate.current = null
                setMeasureDraft(null)
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
                return
              }
              if (marquee.current && canvasRef.current) {
                const start = marquee.current
                marquee.current = null
                const deep =
                  start.deep || deepSelectHeldRef.current || event.ctrlKey || event.metaKey
                const rect = canvasRef.current.getBoundingClientRect()
                const x = event.clientX - rect.left
                const y = event.clientY - rect.top
                const left = Math.min(start.x, x)
                const top = Math.min(start.y, y)
                const width = Math.abs(x - start.x)
                const height = Math.abs(y - start.y)
                setMarqueeBox(null)
                if (width > 4 || height > 4) {
                  const hits = marqueeHits({ left, top, width, height }, x < start.x, deep)
                  const next = start.shift ? [...new Set([...start.baseIds, ...hits.nodeIds])] : hits.nodeIds
                  const nextBrowsers = start.shift
                    ? [...new Set([...start.baseBrowserIds, ...hits.browserIds])]
                    : hits.browserIds
                  designSelectedRef.current = next
                  setDesignSelectedIds(next)
                  selectBrowsers(nextBrowsers)
                } else if (jev.picking && jev.pointerId) {
                  // Click selects the pointed component for Jev (Shift adds / toggles).
                  if (!jev.locked) jev.toggleLock()
                  const id = jev.pointerId
                  const next = start.shift
                    ? designSelectedRef.current.includes(id)
                      ? designSelectedRef.current.filter((item) => item !== id)
                      : [...designSelectedRef.current, id]
                    : [id]
                  designSelectedRef.current = next
                  setDesignSelectedIds(next)
                  selectBrowsers([])
                } else if (start.pick || event.ctrlKey || event.metaKey) {
                  // Ctrl/Cmd click (no drag): deep-select the topmost node under the cursor.
                  const point = screenToWorld(cameraRef.current, x, y)
                  const pageNodes = designRef.current.filter(
                    (node) => (node.pageId || DEFAULT_PAGE.id) === activePageRef.current
                  )
                  const hit = pickDeepAtPoint(point, pageNodes)
                  const next = hit
                    ? start.shift
                      ? [...new Set([...start.baseIds, hit.id])]
                      : [hit.id]
                    : start.shift
                      ? start.baseIds
                      : []
                  designSelectedRef.current = next
                  setDesignSelectedIds(next)
                  if (!start.shift) selectBrowsers([])
                } else if (!start.shift) {
                  designSelectedRef.current = []
                  setDesignSelectedIds([])
                  selectBrowsers([])
                }
              }
              penDrag.current = null
              if (drawRef.current && drawRef.current.kind !== 'pen') commitDraw()
              pan.current = null
              setPanning(false)
              if (!space.current) await window.vanta.setClickThrough(false)
            }}
          >
            {status.state === 'error' && <div className="empty error">{status.message}</div>}
            {jev.picking ? (
              <div className="jev-point-hud" data-chrome-overlay="">
                Point to an element · Click to select · Esc to exit
              </div>
            ) : null}
            <div
              ref={(node) => {
                pixelGridRef.current = node
                if (node) paintPixelGrid(node, cameraRef.current)
              }}
              className="pixel-grid"
              aria-hidden
            />
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
                peerSelectedCount={selectedBrowserIds.length}
                tool={tool}
                draft={draft && (draft.pageId || DEFAULT_PAGE.id) === activePageId ? draft : null}
                hoverPoint={tool === 'pen' ? penHover : null}
                pathHoverId={pathHoverId}
                revealId={snapshotRevealId}
                revealIds={revealIds}
                buildingIds={buildingIds}
                onSelect={(id, additive, opts) => {
                  const hit = designRef.current.find((node) => node.id === id)
                  if (hit?.type === 'comment') {
                    openCommentThread(id)
                    return
                  }
                  setActiveCommentId(null)
                  if (!additive) clearBrowserSelection()
                  let targetId = id
                  // Shift multi-select and Ctrl deep-select both pick the element under the
                  // cursor (incl. flex children) — skip drill-to-parent so nested nodes can
                  // be added without selecting the frame first.
                  if (opts?.exact && hit) {
                    targetId = hit.id
                  } else if (opts?.deep || additive) {
                    const world =
                      opts?.clientX != null && opts?.clientY != null
                        ? worldFromEvent({ clientX: opts.clientX, clientY: opts.clientY })
                        : null
                    const deep = world ? pickDeepAtPoint(world, designRef.current) : hit
                    if (deep) targetId = deep.id
                  } else if (opts?.drill && hit) {
                    const next = resolveDrillIn(hit, designRef.current, designSelectedRef.current)
                    if (!next) {
                      // Already at deepest — text edits / frame rename handled by DesignLayer.
                      return
                    }
                    targetId = next
                  } else if (hit && !opts?.exact) {
                    targetId = resolveClickTarget(hit, designRef.current, designSelectedRef.current)
                    // Pressing inside an already-selected frame keeps it selected so a drag
                    // moves the frame (Figma); a plain click drills in on release.
                    const current = designSelectedRef.current
                    if (!current.includes(targetId) && current.length) {
                      const byId = nodeIndexOf(designRef.current)
                      let parentId = hit.parentId
                      let insideSelection = false
                      for (let guard = 0; parentId && guard < 200; guard++) {
                        if (current.includes(parentId)) {
                          insideSelection = true
                          break
                        }
                        parentId = byId.get(parentId)?.parentId
                      }
                      if (insideSelection) {
                        pendingClickSelectRef.current = targetId
                        return
                      }
                    }
                  }
                  pendingClickSelectRef.current = null
                  if (toolRef.current === 'measure') {
                    const world =
                      opts?.clientX != null && opts?.clientY != null
                        ? worldFromEvent({ clientX: opts.clientX, clientY: opts.clientY })
                        : null
                    const deep = world ? pickDeepAtPoint(world, designRef.current) : hit
                    const nextId = deep?.id || targetId
                    designSelectedRef.current = [nextId]
                    setDesignSelectedIds([nextId])
                    return
                  }
                  const nextIds = (() => {
                    const current = designSelectedRef.current
                    if (additive) {
                      return current.includes(targetId)
                        ? current.filter((item) => item !== targetId)
                        : [...current, targetId]
                    }
                    if (current.includes(targetId) && current.length > 1) return current
                    return [targetId]
                  })()
                  // Sync ref immediately so pointer-down → move-start uses the parent, not the child.
                  designSelectedRef.current = nextIds
                  setDesignSelectedIds(nextIds)
                }}
                deepHoverId={jev.picking && jev.pointerId ? jev.pointerId : deepHoverId}
                deepSelect={deepSelectHeld}
                onClickRelease={() => {
                  ghostDragRef.current = null
                  const pending = pendingClickSelectRef.current
                  pendingClickSelectRef.current = null
                  if (!pending || !designRef.current.some((node) => node.id === pending)) return
                  designSelectedRef.current = [pending]
                  setDesignSelectedIds([pending])
                }}
                onMoveStart={(id) => {
                  const hit = designRef.current.find((item) => item.id === id)
                  if (hit?.locked) return
                  const selected = designSelectedRef.current
                  const seed = new Set(selected.length ? selected : [id])
                  const roots = [...seed].filter((nodeId) => {
                    const node = designRef.current.find((item) => item.id === nodeId)
                    return Boolean(node && !node.locked && (!node.parentId || !seed.has(node.parentId)))
                  })
                  if (!roots.length) return
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
                  // Flex children (same auto-layout parent, in flow) reorder with a ghost instead of lifting out.
                  const byId = nodeIndexOf(designRef.current)
                  const first = byId.get(roots[0])
                  const flexParent = first?.parentId ? byId.get(first.parentId) : undefined
                  const ghostable =
                    Boolean(flexParent && isAutoLayout(flexParent)) &&
                    roots.every((nodeId) => {
                      const node = byId.get(nodeId)
                      return Boolean(node && node.parentId === first?.parentId && !node.layoutAbsolute)
                    })
                  ghostDragRef.current = ghostable && flexParent ? { ids: roots, parentId: flexParent.id, dx: 0, dy: 0 } : null
                  pendingLiftRef.current = ghostable ? null : roots
                  flexDropRef.current = null
                  setFlexDrop(null)
                  dropParentIdRef.current = null
                  setDropParentId(null)
                  return roots[0] || id
                }}
                onMove={(id, x, y, snap = true) => {
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
                  const ghostDrag = ghostDragRef.current
                  if (ghostDrag) {
                    const dx = x - start.worldX
                    const dy = y - start.worldY
                    ghostDrag.dx = dx
                    ghostDrag.dy = dy
                    const nodes = designRef.current
                    let minX = Infinity
                    let minY = Infinity
                    let maxX = -Infinity
                    let maxY = -Infinity
                    for (const nodeId of ghostDrag.ids) {
                      const origin = moveStart.current.get(nodeId)
                      const node = nodes.find((item) => item.id === nodeId)
                      if (!origin || !node) continue
                      const size = resolveWorldRect(node, nodes)
                      minX = Math.min(minX, origin.worldX + dx)
                      minY = Math.min(minY, origin.worldY + dy)
                      maxX = Math.max(maxX, origin.worldX + dx + size.width)
                      maxY = Math.max(maxY, origin.worldY + dy + size.height)
                    }
                    if (!Number.isFinite(minX)) return
                    const ghost = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
                    const center = { x: ghost.x + ghost.width / 2, y: ghost.y + ghost.height / 2 }
                    const size = { width: ghost.width, height: ghost.height }
                    const home = nodes.find((item) => item.id === ghostDrag.parentId)
                    const homeBox = home ? resolveWorldRect(home, nodes) : null
                    const overHome = Boolean(
                      homeBox &&
                        center.x >= homeBox.x &&
                        center.x <= homeBox.x + homeBox.width &&
                        center.y >= homeBox.y &&
                        center.y <= homeBox.y + homeBox.height
                    )
                    // Paper: pulling a flex child out of its parent detaches it for real — it follows
                    // the pointer and the siblings close the gap.
                    if (!ghostDrag.detached && !overHome) {
                      ghostDrag.detached = true
                      let next = nodes
                      for (const nodeId of ghostDrag.ids) {
                        const origin = moveStart.current.get(nodeId)
                        if (!origin) continue
                        next = next.map((item) =>
                          item.id === nodeId
                            ? { ...item, parentId: undefined, layoutAbsolute: false, x: origin.worldX + dx, y: origin.worldY + dy }
                            : item
                        )
                      }
                      moveStart.current = new Map(
                        [...moveStart.current].map(([nodeId, origin]) => [
                          nodeId,
                          { ...origin, localX: origin.worldX, localY: origin.worldY }
                        ])
                      )
                      setDragGhost(null)
                      setDragGhostIds([])
                      persistDesign(next)
                    }
                    if (ghostDrag.detached) {
                      persistDesign(
                        designRef.current.map((item) => {
                          const origin = moveStart.current.get(item.id)
                          return origin ? { ...item, x: origin.worldX + dx, y: origin.worldY + dy } : item
                        }),
                        { skipReflow: true }
                      )
                    } else {
                      setDragGhost(ghost)
                      setDragGhostIds((current) => (current.length ? current : ghostDrag.ids))
                    }
                    const live = designRef.current
                    const exclude = expandWithDescendants(live, new Set(ghostDrag.ids))
                    // Over the original row/column (or one of its children), insert there.
                    let host: DesignNode | null = overHome ? home! : findContainingParent(center, live, exclude)
                    if (host && !overHome) {
                      const byId = nodeIndexOf(live)
                      for (let cur: DesignNode | undefined = host, guard = 0; cur && guard < 200; guard++) {
                        if (cur.id === ghostDrag.parentId) {
                          host = cur
                          break
                        }
                        cur = cur.parentId ? byId.get(cur.parentId) : undefined
                      }
                    }
                    const hostId = host?.id || null
                    if (hostId !== dropParentIdRef.current) {
                      dropParentIdRef.current = hostId
                      setDropParentId(hostId)
                    }
                    const guide =
                      host && isAutoLayout(host) ? measureFlexDrop(live, host.id, ghostDrag.ids, center, size) : null
                    flexDropRef.current = guide
                    setFlexDrop(guide)
                    return
                  }
                  liftPendingFlexChildren()
                  const rawDx = x - start.worldX
                  const rawDy = y - start.worldY
                  const movingIds = [...moveStart.current.keys()]
                  const snapped =
                    snap === false
                      ? null
                      : snapMove({
                          dx: rawDx,
                          dy: rawDy,
                          origins: movingIds.flatMap((nodeId) => {
                            const origin = moveStart.current.get(nodeId)
                            const node = designRef.current.find((item) => item.id === nodeId)
                            if (!origin || !node) return []
                            const size = resolveWorldRect(node, designRef.current)
                            return [{ worldX: origin.worldX, worldY: origin.worldY, width: size.width, height: size.height }]
                          }),
                          targets: snapTargets(designRef.current, movingIds, activePageRef.current),
                          zoom: cameraRef.current.zoom
                        })
                  const dx = snapped?.dx ?? rawDx
                  const dy = snapped?.dy ?? rawDy
                  flashAlignGuides(snapped?.guides || [])
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
                  const primary = designRef.current.find((node) => node.id === id)
                  const parent = primary?.parentId
                    ? designRef.current.find((node) => node.id === primary.parentId)
                    : null
                  // Blue outline on the frame/section that would become the drop parent (Paper).
                  const moving = new Set(movingIds)
                  const exclude = expandWithDescendants(designRef.current, moving)
                  let dropId: string | null = null
                  let dropCenter: { x: number; y: number } | null = null
                  let dropSize: { width: number; height: number } | null = null
                  for (const nodeId of movingIds) {
                    const origin = moveStart.current.get(nodeId)
                    const node = designRef.current.find((item) => item.id === nodeId)
                    if (!origin || !node || hasWorldPoints(node)) continue
                    const size = resolveWorldRect(node, designRef.current)
                    const center = {
                      x: origin.worldX + dx + size.width / 2,
                      y: origin.worldY + dy + size.height / 2
                    }
                    const host = findContainingParent(center, designRef.current, exclude)
                    if (host) {
                      dropId = host.id
                      dropCenter = center
                      dropSize = { width: size.width, height: size.height }
                      break
                    }
                  }
                  if (dropId !== dropParentIdRef.current) {
                    dropParentIdRef.current = dropId
                    setDropParentId(dropId)
                  }
                  // Flex insert guide: reordering within a flex parent, or dropping into one.
                  const flexHostId =
                    primary?.parentId && parent && isAutoLayout(parent) && primary.layoutAbsolute
                      ? primary.parentId
                      : dropId &&
                          (() => {
                            const host = designRef.current.find((item) => item.id === dropId)
                            return host && isAutoLayout(host) ? host.id : null
                          })()
                  if (flexHostId && dropCenter && dropSize) {
                    const guide = measureFlexDrop(
                      designRef.current,
                      flexHostId,
                      movingIds,
                      dropCenter,
                      dropSize
                    )
                    flexDropRef.current = guide
                    setFlexDrop(guide)
                  } else if (flexDropRef.current) {
                    flexDropRef.current = null
                    setFlexDrop(null)
                  }
                }}
                onMoveEnd={(id) => {
                  pendingLiftRef.current = null
                  pendingClickSelectRef.current = null
                  const ghostDrag = ghostDragRef.current
                  if (ghostDrag) {
                    ghostDragRef.current = null
                    setDragGhost(null)
                    setDragGhostIds([])
                    const drop = flexDropRef.current
                    let next = designRef.current
                    if (drop) {
                      const current = next.find((item) => item.id === ghostDrag.ids[0])
                      if (current?.parentId !== drop.parentId) {
                        next = next.map((item) =>
                          ghostDrag.ids.includes(item.id) ? { ...item, parentId: drop.parentId, layoutAbsolute: false } : item
                        )
                      }
                      next = placeFlexChildren(next, drop.parentId, ghostDrag.ids, drop.index)
                    } else if (ghostDrag.detached) {
                      // Already a free layer at the pointer: drop into whatever frame is under it.
                      for (const nodeId of ghostDrag.ids) {
                        const node = next.find((item) => item.id === nodeId)
                        if (!node) continue
                        const placed = reparentMovedNode(node, next, expandWithDescendants(next, new Set([nodeId])))
                        next = next.map((item) => (item.id === nodeId ? placed : item))
                      }
                    } else {
                      // Dropped outside any flex frame: place it where the ghost landed.
                      for (const nodeId of ghostDrag.ids) {
                        const origin = moveStart.current.get(nodeId)
                        const node = next.find((item) => item.id === nodeId)
                        if (!origin || !node) continue
                        const free: DesignNode = {
                          ...node,
                          parentId: undefined,
                          layoutAbsolute: false,
                          x: origin.worldX + ghostDrag.dx,
                          y: origin.worldY + ghostDrag.dy
                        }
                        next = next.map((item) => (item.id === nodeId ? free : item))
                        const placed = reparentMovedNode(free, next, expandWithDescendants(next, new Set([nodeId])))
                        next = next.map((item) => (item.id === nodeId ? placed : item))
                      }
                    }
                    persistDesign(next)
                    moveStart.current = new Map()
                    flexDropRef.current = null
                    setFlexDrop(null)
                    dropParentIdRef.current = null
                    setDropParentId(null)
                    flashAlignGuides([])
                    return
                  }
                  const seed = new Set(designSelectedRef.current.includes(id) ? designSelectedRef.current : [id])
                  const roots = [...seed].filter((nodeId) => {
                    const node = designRef.current.find((item) => item.id === nodeId)
                    return Boolean(node && (!node.parentId || !seed.has(node.parentId)))
                  })
                  let next = [...designRef.current]
                  const drop = flexDropRef.current
                  for (const rootId of roots) {
                    const exclude = expandWithDescendants(next, new Set([rootId]))
                    const node = next.find((item) => item.id === rootId)
                    if (!node) continue
                    const patched = reparentMovedNode(node, next, exclude)
                    next = next.map((item) => (item.id === rootId ? patched : item))
                    if (patched.parentId) {
                      const parentNode = next.find((item) => item.id === patched.parentId)
                      if (parentNode && isAutoLayout(parentNode)) {
                        if (drop && drop.parentId === patched.parentId) {
                          next = placeFlexChildren(next, patched.parentId, roots, drop.index)
                        } else {
                          next = next.map((item) =>
                            roots.includes(item.id) ? { ...item, layoutAbsolute: false } : item
                          )
                          next = reorderAutoLayoutChildren(next, patched.parentId)
                        }
                      }
                    } else if (node.layoutAbsolute) {
                      next = next.map((item) => (item.id === rootId ? { ...item, layoutAbsolute: false } : item))
                    }
                  }
                  persistDesign(next)
                  moveStart.current = new Map()
                  flexDropRef.current = null
                  setFlexDrop(null)
                  dropParentIdRef.current = null
                  setDropParentId(null)
                  flashAlignGuides([])
                }}
                dropParentId={dropParentId}
                onResize={(id, next) => {
                  if (designRef.current.find((item) => item.id === id)?.locked) return
                  const { world, ...rect } = next
                  const before = designRef.current.find((node) => node.id === id)
                  if (before && hasWorldPoints(before)) {
                    const from = resolveWorldRect(before, designRef.current)
                    persistDesign(
                      designRef.current.map((node) => (node.id === id ? scalePathPoints(node, from, rect) : node)),
                      { skipReflow: true }
                    )
                    return
                  }
                  let nodes = designRef.current.map((node) => {
                      if (node.id !== id) return node
                      let patched = node
                      if (!world || !node.parentId) patched = { ...node, ...rect }
                      else {
                        const parent = designRef.current.find((item) => item.id === node.parentId)
                        if (!parent) patched = { ...node, ...rect }
                        else {
                          const parentWorld = resolveWorldRect(parent, designRef.current)
                          const rel = toRelative({ x: rect.x, y: rect.y }, parentWorld)
                          patched = { ...node, x: rel.x, y: rel.y, width: rect.width, height: rect.height }
                        }
                      }
                      // A manual text-box resize must stop Fit sizing from replacing the dragged bounds.
                      if (patched.type === 'text') {
                        const horizontalOnly = Math.abs((rect.height || 0)-(node.height || 0)) < .5 && Math.abs((rect.width || 0)-(node.width || 0)) > .01
                        patched = remeasureText({ ...patched, textResize: next.textResize || (horizontalOnly ? 'auto-height' : 'fixed'), layoutSizingH: 'fixed', layoutSizingV: 'fixed' })
                      }
                      if (patched.layout && patched.layout.mode !== 'none') {
                        const sizingH =
                          Math.abs((patched.width || 0) - (node.width || 0)) > 0.4 || Math.abs(patched.x - node.x) > 0.4
                            ? 'fixed'
                            : patched.layout.sizingH
                        const sizingV =
                          Math.abs((patched.height || 0) - (node.height || 0)) > 0.4 || Math.abs(patched.y - node.y) > 0.4
                            ? 'fixed'
                            : patched.layout.sizingV
                        patched = { ...patched, layout: { ...patched.layout, sizingH, sizingV } }
                      }
                      // Manual resize on a flex child locks that axis to Fixed.
                      if (node.parentId) {
                        const parent = designRef.current.find((item) => item.id === node.parentId)
                        if (parent && isAutoLayout(parent) && !patched.layoutAbsolute) {
                          const nextSizingH =
                            Math.abs((patched.width || 0) - (node.width || 0)) > 0.4 ? 'fixed' : patched.layoutSizingH
                          const nextSizingV =
                            Math.abs((patched.height || 0) - (node.height || 0)) > 0.4 ? 'fixed' : patched.layoutSizingV
                          patched = { ...patched, layoutSizingH: nextSizingH, layoutSizingV: nextSizingV }
                        }
                      }
                      return patched
                    })
                  if (
                    before &&
                    (before.type === 'frame' || before.type === 'section') &&
                    (Math.abs((before.width || 0) - (rect.width || 0)) > 0.01 ||
                      Math.abs((before.height || 0) - (rect.height || 0)) > 0.01)
                  ) {
                    nodes = applyConstraintsOnParentResize(
                      nodes,
                      id,
                      { width: before.width || 0, height: before.height || 0 },
                      { width: rect.width || 0, height: rect.height || 0 }
                    )
                  }
                  persistDesign(nodes)
                }}
                onScaleStart={() => {
                  const ids = new Set(designSelectedRef.current)
                  scaleStart.current = designRef.current.filter((node) => ids.has(node.id) && !node.locked)
                }}
                onScale={(origin, factor) => {
                  const starts = scaleStart.current
                  if (!starts.length) return
                  persistDesign(
                    designRef.current.map((node) => {
                      const start = starts.find((item) => item.id === node.id)
                      return start ? scaleNodeAround(start, origin.x, origin.y, factor) : node
                    })
                  )
                }}
                onEdit={(id, patch) => {
                  if (designRef.current.find((item) => item.id === id)?.locked) return
                  persistDesign(designRef.current.map((node) => (node.id === id ? { ...node, ...patch } : node)))
                }}
                onRemove={(id) => {
                  persistDesign(designRef.current.filter((node) => node.id !== id))
                  setDesignSelectedIds((current) => current.filter((item) => item !== id))
                }}
                onSpace={(axis, gap) => {
                  const result = applySelectionGap(designRef.current, designSelectedRef.current, axis, gap)
                  persistDesign(result.nodes, result.reflow ? undefined : { skipReflow: true })
                }}
                onSpaceEnd={() => persistDesign(designRef.current)}
                onPad={(side, value) => {
                  const id = designSelectedRef.current[0]
                  if (!designRef.current.some((node) => node.id === id)) return
                  persistDesign(reflowAutoLayout(applyFramePadding(designRef.current, id, side, value)), { skipReflow: true })
                }}
                onPadEnd={() => persistDesign(designRef.current)}
                onSelectIds={(ids) => {
                  clearBrowserSelection()
                  designSelectedRef.current = ids
                  setDesignSelectedIds(ids)
                  setSelectedId(null)
                }}
                onReorderChildren={reorderDesignChildren}
                onLayoutAlign={(justify, align) => {
                  const id = designSelectedRef.current[0]
                  if (!id) return
                  persistDesign(applyLayoutAlignment(designRef.current, id, justify, align))
                }}
                flexDrop={flexDrop}
                dragGhost={dragGhost}
                dragGhostIds={dragGhostIds}
                crop={
                  cropSession
                    ? (() => {
                        const node = design.find((item) => item.id === cropSession.nodeId)
                        const paint = node ? getNodePaints(node)[cropSession.paintIndex] : undefined
                        return {
                          nodeId: cropSession.nodeId,
                          frame: cropSession.frame,
                          image: cropSession.image,
                          src: cropSession.src,
                          adjust: paint?.type === 'image' ? paint : null,
                          ratio: aspectRatioOf(cropSession.aspect, cropSession.natural)
                        }
                      })()
                    : null
                }
                onCropChange={(next) => {
                  const session = cropSessionRef.current
                  if (session) applyCropRects(session, next.frame, next.image)
                }}
              />
              {alignGuides.length > 0 && <AlignGuidesOverlay guides={alignGuides} zoom={camera.zoom} />}
              {(tool === 'measure' || altHeld) &&
                (measureLines.length > 0 || measureTitles.length > 0 || measureEdgeHighlight) && (
                <MeasureOverlay
                  lines={measureLines}
                  zoom={camera.zoom}
                  selectedRect={measureSelectedRect}
                  hoverRect={measureHoverRect}
                  titles={measureTitles}
                  edgeHighlight={measureEdgeHighlight}
                  activeLineId={measureActiveLineId}
                />
              )}
              {browsers.map((frame) => (
                <BrowserFrame
                  key={frame.id}
                  frame={frame}
                  selected={selectedBrowserIds.includes(frame.id)}
                  onSelect={(additive) => {
                    if (additive) {
                      const current = selectedBrowserRef.current
                      selectBrowsers(
                        current.includes(frame.id)
                          ? current.filter((id) => id !== frame.id)
                          : [...current, frame.id]
                      )
                      return
                    }
                    selectBrowsers([frame.id])
                    setDesignSelectedIds([])
                  }}
                  onChange={(patch) => patchFrame(frame.id, patch)}
                  onNavigate={(tabId, url) => {
                    recordVisit({ url, title: '' })
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
                    closeBrowserWindow(frame.id)
                  }}
                  onNewTab={() => {
                    void window.vanta.createTab(frame.id).then((next) => {
                      setBrowsers((current) =>
                        current.map((item) =>
                          item.id === next.id ? { ...next, x: item.x, y: item.y, width: item.width, height: item.height } : item
                        )
                      )
                      selectBrowsers([frame.id])
                    })
                  }}
                  onActivateTab={(tabId) => {
                    patchFrame(frame.id, { activeTabId: tabId })
                    void window.vanta.activateTab(frame.id, tabId)
                  }}
                  onCloseTab={(tabId) => {
                    closeBrowserTab(frame.id, tabId)
                  }}
                  allTabs={[
                    ...browsers.flatMap((item) =>
                      item.tabs.map((tab) => ({
                        id: tab.id,
                        windowId: item.id,
                        title: tab.title,
                        url: tab.url,
                        favicon: tab.favicon
                      }))
                    ),
                    ...(codingActive
                      ? [
                          {
                            id: SIDEBAR_BROWSER_ID,
                            windowId: SIDEBAR_BROWSER_ID,
                            title: getCodingAgentMeta(codingActive.agentId).name,
                            url: codingAgentUrl,
                            favicon: getCodingAgentMeta(codingActive.agentId).favicon
                          }
                        ]
                      : []),
                    ...sideBrowsers.map((slot) => {
                      let title = slot.url
                      try {
                        title = new URL(slot.url).hostname.replace(/^www\./, '') || slot.url
                      } catch {
                        /* keep url */
                      }
                      return {
                        id: slot.id,
                        windowId: slot.id,
                        title,
                        url: slot.url,
                        favicon: ''
                      }
                    })
                  ]}
                  onSwitchTab={(windowId, tabId) => {
                    switchOmniboxTab(windowId, tabId)
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
            </div>
            {rail === 'chat' && (
              <div className="workspace-page">
                <ChatWorkspace
                  messages={chatLog}
                  busy={agentBusy}
                  poppedOut={chatPoppedOut}
                  onPopOut={popOutAgentsPanel}
                  jev={jevThread}
                />
              </div>
            )}
          </>
        )}
        {view === 'canvas' && rail !== 'chat' && (
        <RightSidebar
          zoom={Math.round(clampZoom(camera.zoom) * 100)}
          inspect={inspect}
          inspectOn={inspectOn}
          page={activePage}
          node={selected ? null : selectedNode}
          nodes={design}
          selectedIds={designSelectedIds}
          onAlign={alignSelection}
          onSpace={(axis, gap) => {
            const result = applySelectionGap(designRef.current, designSelectedRef.current, axis, gap)
            persistDesign(result.nodes)
          }}
          browser={selected}
          tool={tool}
          theme={theme}
          hideExpandChip={codingFullscreen}
          onPatchPage={(patch) => persistPages(pages.map((page) => (page.id === activePage.id ? { ...page, ...patch } : page)))}
          onPatchNode={(id, patch) => {
            const before = designRef.current.find((item) => item.id === id)
            if (
              before &&
              hasWorldPoints(before) &&
              (patch.x != null || patch.y != null || patch.width != null || patch.height != null)
            ) {
              const { x, y, width, height, ...rest } = patch
              const from = resolveWorldRect(before, designRef.current)
              const to = {
                x: x ?? from.x,
                y: y ?? from.y,
                width: Math.max(0.01, width ?? from.width),
                height: Math.max(0.01, height ?? from.height)
              }
              persistDesign(
                designRef.current.map((item) => (item.id === id ? scalePathPoints({ ...item, ...rest }, from, to) : item))
              )
              return
            }
            let next = designRef.current.map((item) =>
              item.id === id ? (item.type === 'text' ? remeasureText({ ...item, ...patch }) : { ...item, ...patch }) : item
            )
            if (
              before &&
              (before.type === 'frame' || before.type === 'section') &&
              (patch.width != null || patch.height != null)
            ) {
              const after = next.find((item) => item.id === id)
              if (after) {
                next = applyConstraintsOnParentResize(
                  next,
                  id,
                  { width: before.width || 0, height: before.height || 0 },
                  { width: after.width || 0, height: after.height || 0 }
                )
              }
            }
            persistDesign(next)
          }}
          onPatchMany={(patches) => {
            if (!patches.length) return
            const map = new Map(patches.map((entry) => [entry.id, entry.patch]))
            persistDesign(
              designRef.current.map((item) => {
                const patch = map.get(item.id)
                if (!patch) return item
                return item.type === 'text' ? remeasureText({ ...item, ...patch }) : { ...item, ...patch }
              })
            )
          }}
          onEnableAutoLayout={(id, opts) => {
            persistDesign(enableAutoLayoutOnFrame(designRef.current, id, opts))
          }}
          onReorderChildren={reorderDesignChildren}
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
          onResize={(width) => setRightWidth(Math.min(480, Math.max(200, width)))}
          commentsMode={tool === 'comment'}
          browserPanel={null}
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
      {view === 'canvas' && rail !== 'chat' && !codingFullscreen && !toolbarHiddenForAgentFs && actionBar && (
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
          snapshot={actionBar.snapshot}
          measure={actionBar.measure}
          dock={actionBar.dock}
          onChromeChange={syncLayout}
        />
      )}
      <AnimatePresence
        onExitComplete={() => {
          if (agentFsPending.current === 'enter') {
            agentFsPending.current = null
            setCodingFullscreen(true)
          } else if (agentFsPending.current === 'side-enter') {
            agentFsPending.current = null
            appendSideBrowser()
          }
          syncLayout()
        }}
      >
        {view === 'canvas' && !toolbarHiddenForAgentFs && (
          <motion.div
            key="canvas-toolbar"
            className={`canvas-toolbar-stack${createSvgOpen ? ' is-create-svg' : ''}`}
            initial={false}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.08 } }
                : {
                    y: 220,
                    opacity: 0,
                    transition: {
                      y: TOOLBAR_FS_EXIT,
                      opacity: { duration: 0.1, ease: [0.4, 0, 1, 1] }
                    }
                  }
            }
            transition={{ duration: 0 }}
            onUpdate={() => {
              if (agentFsPending.current || toolbarHiddenForAgentFs) syncLayout()
            }}
            onAnimationComplete={() => syncLayout()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {cropSession && (
              <CropBar
                zoom={scaleToZoom(
                  cropSession.image.width / Math.max(1, coverRect(cropSession.frame, cropSession.natural).width)
                )}
                aspect={cropSession.aspect}
                onZoom={(value) => {
                  const session = cropSessionRef.current
                  if (!session) return
                  const { frame, image } = session
                  const cover = coverRect(frame, session.natural)
                  const scale = zoomToScale(value)
                  const width = cover.width * scale
                  const height = cover.height * scale
                  // Zoom around the crop window's center.
                  const cx = frame.x + frame.width / 2
                  const cy = frame.y + frame.height / 2
                  const relX = (cx - image.x) / Math.max(1, image.width)
                  const relY = (cy - image.y) / Math.max(1, image.height)
                  applyCropRects(session, frame, { x: cx - relX * width, y: cy - relY * height, width, height })
                }}
                onAspect={(aspect) => {
                  const session = cropSessionRef.current
                  if (!session) return
                  const ratio = aspectRatioOf(aspect, session.natural)
                  const next = { ...session, aspect }
                  setCropSession(next)
                  if (!ratio) return
                  const { frame } = session
                  const height = frame.width / ratio
                  applyCropRects(next, { ...frame, y: frame.y + (frame.height - height) / 2, height }, session.image)
                }}
                onResizeToFit={() => {
                  const session = cropSessionRef.current
                  if (session) applyCropRects(session, { ...session.image }, session.image)
                }}
                onCancel={() => finishImageCrop(false)}
                onApply={() => finishImageCrop(true)}
              />
            )}
            <CanvasToolbar
              onUndo={undoDesign} onRedo={redoDesign}
              canUndo={designUndoPastRef.current.length > 0 && !isDesignGenerationBusy()}
              canRedo={designUndoFutureRef.current.length > 0 && !isDesignGenerationBusy()}
              tool={tool}
              shape={shapeKind}
              mode={switchMode}
              strokeColor={tool === 'pen' || tool === 'pencil' || tool === 'brush' ? instrumentColors[tool] : selectedInk?.stroke || strokeColor}
              strokeWeight={selectedInk?.strokeWidth || (tool === 'brush' ? brushWeight : tool === 'pen' ? penWeight : pencilWeight)}
              brushStyle={selectedInk?.brushStyle || (tool === 'brush' ? brushStyle : pencilStyle)}
              composerValue={chatInput}
              composerBusy={agentBusy}
              onChromeChange={syncLayout}
              onTool={chooseTool}
              onShape={(next) => {
                setShapeKind(next)
                chooseTool('shape')
              }}
              onMode={chooseMode}
              drawingPaint={tool === 'pen' || tool === 'pencil' || tool === 'brush' ? instrumentPaints[tool] : undefined}
              onDrawingPaint={(paint) => {
                const active = toolRef.current
                if (active !== 'pen' && active !== 'pencil' && active !== 'brush') return
                setInstrumentPaints(previous => ({ ...previous, [active]: paint }))
                const color = paint.type === 'solid' ? paint.color : paint.type === 'gradient' ? paint.stops[0]?.color : undefined
                if (color) { setStrokeColor(color); setInstrumentColors(previous => ({ ...previous, [active]: color })) }
                patchSelectedInk({ strokePaint: paint, ...(color ? { stroke: color } : {}) })
              }}
              instrumentColors={instrumentColors}
              onStrokeColor={(color) => {
                const active = toolRef.current
                if (active === 'pen' || active === 'pencil' || active === 'brush') setInstrumentColors(previous => ({ ...previous, [active]: color }))
                setStrokeColor(color)
                patchSelectedInk({ stroke: color })
              }}
              onStrokeWeight={(weight) => {
                if (tool === 'brush') setBrushWeight(weight)
                else if (tool === 'pen') setPenWeight(weight)
                else setPencilWeight(weight)
                patchSelectedInk({ strokeWidth: weight })
              }}
              onBrushStyle={(style) => {
                if (tool === 'brush') setBrushStyle(style)
                else setPencilStyle(style)
                patchSelectedInk({ brushStyle: style })
              }}
              onComposerChange={setChatInput}
              onComposerSend={() => void sendChat()}
              onSuggestion={(text) => setChatInput(text)}
              showComposer={!chatPoppedOut || createSvgOpen}
              jevComposer={jevComposer}
              composerExtra={createSvgPanel}
              createSvgActive={createSvgOpen}
              onCreateSvg={() => {
                if (createSvgOpen) {
                  exitCreateSvg()
                  return
                }
                setCreateSvgOpen(true)
                // Paper-style: leave the field empty — ghost suggestions animate in the panel.
                if (!createSvgBusy) setCreateSvgPrompt('')
                setChatPoppedOut(false)
              }}
              inFileShaders={[
                ...new Set(
                  design.flatMap((node) =>
                    getNodePaints(node)
                      .filter((paint): paint is Extract<typeof paint, { type: 'shader' }> => paint.type === 'shader')
                      .map((paint) => paint.shader)
                  )
                )
              ]}
              onSelectShader={(kind: ShaderKind) => {
                exitCreateSvg()
                const paint = defaultShader(kind)
                const legacy = legacyFromPaints([paint])
                const label = SHADER_OPTIONS.find((opt) => opt.id === kind)?.label || 'Shader'
                const canvas = canvasRef.current
                const cam = cameraRef.current
                const center = canvas
                  ? screenToWorld(cam, canvas.clientWidth / 2, canvas.clientHeight / 2)
                  : { x: 120, y: 120 }
                const width = 800
                const height = 600
                const id = crypto.randomUUID()
                const sameName = designRef.current.filter(
                  (node) =>
                    (node.pageId || DEFAULT_PAGE.id) === activePageRef.current &&
                    (node.name === label || node.name?.startsWith(`${label} -`))
                ).length
                const node: DesignNode = {
                  id,
                  type: 'rect',
                  x: Math.round(center.x - width / 2),
                  y: Math.round(center.y - height / 2),
                  width,
                  height,
                  name: `${label} - ${sameName + 1}`,
                  pageId: activePageRef.current,
                  fills: [paint],
                  fill: legacy.fill,
                  fillOpacity: legacy.fillOpacity,
                  radius: 16
                }
                persistDesign([...designRef.current, node])
                setDesignSelectedIds([id])
                setSelectedId(null)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
      <ChatAgentsPopout
        open={chatPoppedOut}
        title={activeChat?.title || 'Agents'}
        messages={chatLog}
        busy={agentBusy}
        input={chatInput}
        onInput={setChatInput}
        onSend={() => void sendChat()}
        onClose={() => setChatPoppedOut(false)}
        jev={jevThread}
        jevComposer={jevComposer}
        composerExtra={createSvgPanel}
      />
      {layerMenu && view === 'canvas' && (
        <LayerSidebarMenu
          menu={layerMenu}
          selectedIds={designSelectedIds}
          selectedNodes={designSelectedIds
            .map((id) => design.find((node) => node.id === id))
            .filter((node): node is DesignNode => Boolean(node))}
          canPaste={Boolean(designClipboard.current?.length)}
          canPasteStyles={Boolean(styleClipboard.current)}
          onClose={() => setLayerMenu(null)}
          onCopy={copySelection}
          onCopyLink={() => {
            const id = designSelectedIds[designSelectedIds.length - 1]
            void navigator.clipboard
              .writeText(id ? `vanta://node/${id}` : `vanta://file/${activeFileId}`)
              .catch(() => undefined)
          }}
          onCopyAsPng={copySelectionAsPng}
          onCopyAsTailwind={() => copySelectionAsCode(true)}
          onCopyAsReact={() => copySelectionAsCode(false)}
          onPaste={() => pasteClipboard('default')}
          onPasteOnTop={() => pasteClipboard('on-top')}
          onPasteReplace={() => pasteClipboard('replace')}
          onDuplicate={duplicateSelected}
          onCopyStyles={copyStylesFromSelection}
          onPasteStyles={pasteStylesToSelection}
          onFrameSelection={frameSelected}
          onWrapFlex={wrapFlexSelected}
          onRemoveFlex={removeFlexSelected}
          onUngroup={ungroupSelected}
          onBringToFront={() => moveSelectionZ('front')}
          onSendToBack={() => moveSelectionZ('back')}
          onToggleVisible={toggleSelectionVisible}
          onToggleLock={toggleSelectionLock}
          onCollapseAll={() => setCollapseLayersToken((value) => value + 1)}
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
          onCopyAsPng={copySelectionAsPng}
          onCopyAsTailwind={() => copySelectionAsCode(true)}
          onCopyAsReact={() => copySelectionAsCode(false)}
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
      {copyToast && (
        <div className="export-toast is-copy" role="status">
          {copyToast}
        </div>
      )}
    </div>
  )
}
