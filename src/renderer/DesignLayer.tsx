import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { AutoLayoutAlign, AutoLayoutJustify, DesignNode, DesignTool, PathPoint } from '../shared/types'
import { getCommentPerson } from '../shared/comments'
import { cssBlendMode, cssIsolation } from '../shared/blendModes'
import { blurRadius, getNodeEffects } from '../shared/effects'
import {
  backdropFilterCss,
  BehindShadows,
  BlurHandles,
  EffectDefs,
  EffectOverlayLayers,
  isOutlineShape,
  layerFilterParts,
  OutlineBackdrop,
  ShapeShadowFilter
} from './effectRender'
import { useBlurEdit } from './blurEdit'
import { childIndexOf, isGridLayout, layersAtPoint, nodeIndexOf, resolveWorldRect } from '../shared/layoutEngine'
import { GridLayoutOverlay, gridOverlayTarget } from './GridLayoutOverlay'
import { GradientHandles } from './GradientHandles'
import { useGradientEdit } from './gradientEdit'
import { layoutGridBands } from '../shared/layoutGrids'
import { getNodePaints, gradientCss } from '../shared/paint'
import {
  borderRadiusCss,
  clampCornerRadii,
  resolveCornerRadii
} from '../shared/corners'
import { BuildRevealShell, BuildDrawingAnim } from './BuildWorkingDots'
import { handleOrigin, nodeBounds, scaleFactorFromDrag } from './canvasMath'
import { toHex, withAlpha } from './DesignInspector'
import { brushFills, isPlainStroke, pathDFromPoints, profileOutline } from './drawBrushes'
import { ShaderFill } from './ShaderFill'
import { AdjustedImage, type ImageFit } from './AdjustedImage'
import { CropOverlay, type CropRect } from './ImageCrop'
import type { ImageAdjust } from '../shared/imageAdjust'
import {
  alignmentForOffset,
  measureAlignTarget,
  measurePaddingBands,
  measureSelectionGaps,
  type AlignTarget,
  type GapBand,
  type PadBand,
  type PadSide
} from './selectionSpace'
import { ensureGoogleFontLoaded, cssFontFamily } from './googleFonts'
import { useSpacingHint } from './spacingHint'
import {
  formatTextCase,
  listIndentEm,
  measureTextLines,
  measureTextNode,
  paragraphStyle,
  textBlockStyle,
  textParagraphs,
  textTypographyStyle,
  usesParagraphBlocks,
  type TextLine
} from './textLayout'
import {
  isTextOnPath,
  offsetAlongPath,
  pointAtPathOffset,
  textPathD
} from './textPath'

type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const RESIZE_HANDLES: Handle[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']
const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se']

function canDragNode(tool: DesignTool) {
  return tool === 'pointer' || tool === 'frame' || tool === 'section' || tool === 'browser'
}

function nodeBorderRadiusCss(node: DesignNode, width: number, height: number, fallback = 0): string {
  return borderRadiusCss(clampCornerRadii(resolveCornerRadii(node, fallback), width, height))
}

function imageFit(mode?: string): ImageFit {
  if (mode === 'fit') return 'contain'
  if (mode === 'tile') return 'tile'
  if (mode === 'crop') return 'cover'
  return 'cover'
}

function LiveSvg({
  markup,
  className,
  style
}: {
  markup: string
  className?: string
  style?: CSSProperties
}) {
  const host = useRef<HTMLDivElement>(null)
  const svg = markup.trim()
  useEffect(() => {
    const el = host.current
    if (!el || !svg) return
    if (el.dataset.svgLen === String(svg.length) && el.dataset.svgHead === svg.slice(0, 64)) return
    el.dataset.svgLen = String(svg.length)
    el.dataset.svgHead = svg.slice(0, 64)
    el.innerHTML = svg
  }, [svg])
  if (!svg) return null
  return <div ref={host} className={className} style={style} />
}

function NodeImage({ node, fit, className }: { node: DesignNode; fit: ImageFit; className: string }) {
  const paint = getNodePaints(node).find((item) => item.type === 'image' && item.visible !== false)
  const src = paint?.type === 'image' ? paint.imageDataUrl || node.imageDataUrl : node.imageDataUrl
  const svg = node.svgMarkup?.trim() || ''
  if (svg) {
    return (
      <LiveSvg
        markup={svg}
        className={`${className} design-svg-live`}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      />
    )
  }
  if (!src) return null
  return (
    <AdjustedImage
      src={src}
      adjust={paint?.type === 'image' ? paint : undefined}
      fit={
        paint?.type === 'image' && paint.scaleMode && paint.scaleMode !== 'fill' ? imageFit(paint.scaleMode) : fit
      }
      opacity={paint?.type === 'image' ? paint.opacity : 1}
      className={className}
      box={paint?.type === 'image' && paint.scaleMode === 'crop' ? paint.imageBox : undefined}
    />
  )
}

type SelectHandler = (
  id: string,
  additive: boolean,
  opts?: { deep?: boolean; drill?: boolean; exact?: boolean; clientX?: number; clientY?: number }
) => void

function selectFromPointer(
  onSelect: SelectHandler,
  id: string,
  event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; clientX: number; clientY: number }
) {
  onSelect(id, event.shiftKey, {
    deep: event.metaKey || event.ctrlKey,
    clientX: event.clientX,
    clientY: event.clientY
  })
}

/** Select exactly this layer, then ask the app to open the image crop editor for it. */
function openImageCrop(onSelect: SelectHandler, id: string) {
  onSelect(id, false, { exact: true })
  window.dispatchEvent(new CustomEvent('vanta:image-crop', { detail: { id } }))
}

function drillFromPointer(
  onSelect: SelectHandler,
  id: string,
  event: { clientX: number; clientY: number }
) {
  onSelect(id, false, {
    drill: true,
    clientX: event.clientX,
    clientY: event.clientY
  })
}

/** Overlay above every layer where selection outlines/handles render, so children never cover them. */
const ChromeHostContext = createContext<HTMLElement | null>(null)

function SelectionChrome({
  node,
  allNodes,
  box,
  outline = true,
  thin = false,
  children
}: {
  node: DesignNode
  allNodes: DesignNode[]
  box: { x: number; y: number; width: number; height: number }
  outline?: boolean
  /** Typing outline (Figma): 1px, no handles. */
  thin?: boolean
  children?: ReactNode
}) {
  const host = useContext(ChromeHostContext)
  if (!host) return null
  const radius =
    node.type === 'frame' ||
    node.type === 'rect' ||
    node.type === 'image' ||
    node.type === 'widget' ||
    node.type === 'section'
      ? nodeBorderRadiusCss(node, box.width, box.height, node.type === 'section' ? 2 : 0)
      : undefined
  return createPortal(
    <div
      className={`design-chrome${outline ? ' has-outline' : ''}${thin ? ' is-thin' : ''}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        borderRadius: radius,
        transform: nodeTransformCss(node, allNodes, box),
        transformOrigin: 'center center'
      }}
    >
      {children}
    </div>,
    host
  )
}

function stackingZIndex(
  node: DesignNode,
  selectedIds: Set<string>,
  byId: Map<string, DesignNode>
): number | undefined {
  if (selectedIds.has(node.id)) return 40
  let depth = 0
  let parentId = node.parentId
  const seen = new Set<string>()
  while (parentId) {
    if (seen.has(parentId)) break
    seen.add(parentId)
    depth += 1
    // Keep children above a selected ancestor frame so they don't disappear under it.
    if (selectedIds.has(parentId)) return 40 + depth
    parentId = byId.get(parentId)?.parentId
  }
  return undefined
}

function isShownInTree(node: DesignNode, byId: Map<string, DesignNode>): boolean {
  let current: DesignNode | undefined = node
  const seen = new Set<string>()
  while (current) {
    if (current.visible === false) return false
    if (!current.parentId || seen.has(current.parentId)) return true
    seen.add(current.parentId)
    current = byId.get(current.parentId)
  }
  return true
}

/** Layout guides paint above the frame and every descendant, whichever stacking layer they were lifted to. */
function layoutGridZIndex(
  frame: DesignNode,
  nodes: DesignNode[],
  selectedIds: Set<string>,
  byId: Map<string, DesignNode>
): number {
  let z = stackingZIndex(frame, selectedIds, byId) ?? 1
  for (const node of nodes) {
    if (node.id === frame.id) continue
    let parentId = node.parentId
    let inside = false
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      if (parentId === frame.id) {
        inside = true
        break
      }
      seen.add(parentId)
      parentId = byId.get(parentId)?.parentId
    }
    if (inside) z = Math.max(z, stackingZIndex(node, selectedIds, byId) ?? 1)
  }
  return z
}

/** Inside/center strokes on boxes paint as their own layer so fills, media, and children never cover them. */
function hasLiftedStroke(node: DesignNode): boolean {
  if (node.type !== 'frame' && node.type !== 'rect' && node.type !== 'image') return false
  if (!node.strokeWidth || node.strokeWidth <= 0) return false
  return (node.strokeAlign || 'inside') !== 'outside'
}

/**
 * Groups lifted strokes by the render index they follow: the last of their node and its descendants,
 * at the highest z any of them was lifted to — above the subtree, still below later layers.
 */
function liftedStrokeSlots(
  list: DesignNode[],
  selectedIds: Set<string>,
  byId: Map<string, DesignNode>
): Map<number, Array<{ node: DesignNode; zIndex: number }>> {
  const owners = new Map<string, { node: DesignNode; last: number; zIndex: number }>()
  const touch = (owner: DesignNode, index: number, z: number) => {
    const entry = owners.get(owner.id)
    if (entry) {
      entry.last = Math.max(entry.last, index)
      entry.zIndex = Math.max(entry.zIndex, z)
    } else {
      owners.set(owner.id, { node: owner, last: index, zIndex: z })
    }
  }
  list.forEach((node, index) => {
    const z = stackingZIndex(node, selectedIds, byId) ?? 1
    if (hasLiftedStroke(node) && node.visible !== false) touch(node, index, z)
    let parentId = node.parentId
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = byId.get(parentId)
      if (!parent) break
      if (hasLiftedStroke(parent) && parent.visible !== false) touch(parent, index, z)
      parentId = parent.parentId
    }
  })
  const slots = new Map<number, Array<{ node: DesignNode; zIndex: number }>>()
  for (const { node, last, zIndex } of owners.values()) {
    const bucket = slots.get(last)
    if (bucket) bucket.push({ node, zIndex })
    else slots.set(last, [{ node, zIndex }])
  }
  return slots
}

function StrokeOverlay({
  node,
  allNodes,
  zIndex,
  selected
}: {
  node: DesignNode
  allNodes: DesignNode[]
  zIndex: number
  selected: boolean
}) {
  const world = resolveWorldRect(node, allNodes)
  const width = Math.max(1, world.width)
  const height = Math.max(1, node.type === 'image' ? world.height : Math.max(8, world.height))
  const strokeWidth = node.strokeWidth || 0
  const color = withAlpha(toHex(node.stroke, '#1A1A1A'), node.strokeOpacity ?? 1)
  // Center strokes grow the box outward by half so the whole stroke is one inset band (maskable).
  const outset = node.strokeAlign === 'center' ? strokeWidth / 2 : 0
  const radii = clampCornerRadii(resolveCornerRadii(node, 0), width, height)
  const grow = (r: number) => (r > 0 ? r + outset : 0)
  const transform = nodeTransformCss(node, allNodes, { x: world.x, y: world.y, width, height })
  // Keep the selected node's corner handles (8 screen px, centered on the corners) uncovered.
  const corner = `calc(${outset}px + 4px / var(--zoom, 1))`
  return (
    <div
      className="design-stroke-overlay"
      aria-hidden
      style={{
        left: world.x - outset,
        top: world.y - outset,
        width: width + outset * 2,
        height: height + outset * 2,
        zIndex,
        borderRadius: borderRadiusCss({ tl: grow(radii.tl), tr: grow(radii.tr), br: grow(radii.br), bl: grow(radii.bl) }),
        boxShadow: `inset 0 0 0 ${strokeWidth}px ${color}`,
        opacity: node.opacity ?? 1,
        transform: transform || undefined,
        ...(selected
          ? {
              maskImage: 'linear-gradient(#000, #000), linear-gradient(#000, #000)',
              maskSize: `100% calc(100% - 2 * ${corner}), calc(100% - 2 * ${corner}) 100%`,
              maskPosition: 'center, center',
              maskRepeat: 'no-repeat'
            }
          : {})
      }}
    />
  )
}

function LayoutGridOverlay({
  node,
  allNodes,
  box,
  zIndex
}: {
  node: DesignNode
  allNodes: DesignNode[]
  box: { x: number; y: number; width: number; height: number }
  zIndex: number
}) {
  const grids = (node.layoutGrids || []).filter((grid) => grid.visible !== false)
  const transform = nodeTransformCss(node, allNodes, box)
  return (
    <div
      className="design-layout-grid"
      aria-hidden
      style={{
        left: box.x,
        top: box.y,
        width: box.width,
        height: Math.max(1, box.height),
        zIndex,
        transform: transform || undefined
      }}
    >
      {grids.map((grid) => {
        const color = withAlpha(toHex(grid.color, '#FF0000'), Math.max(0, Math.min(1, grid.opacity ?? 0.1)))
        if (grid.pattern === 'GRID') {
          const size = Math.max(1, grid.size ?? 10)
          const line = 'calc(1px / var(--zoom, 1))'
          return (
            <div
              key={grid.id}
              className="design-layout-grid-lines"
              style={{
                backgroundImage: `linear-gradient(to right, ${color} ${line}, transparent ${line}), linear-gradient(to bottom, ${color} ${line}, transparent ${line})`,
                backgroundSize: `${size}px ${size}px`
              }}
            />
          )
        }
        const columns = grid.pattern === 'COLUMNS'
        return layoutGridBands(grid, columns ? box.width : box.height).map(([start, size], index) => (
          <div
            key={`${grid.id}-${index}`}
            className="design-layout-grid-band"
            style={
              columns
                ? { left: start, top: 0, width: size, height: '100%', background: color }
                : { top: start, left: 0, height: size, width: '100%', background: color }
            }
          />
        ))
      })}
    </div>
  )
}

function rotateCursor(angle: number): string {
  const a = Math.round(((angle % 360) + 360) % 360)
  const arc = 'M6.5 8.5 Q15.5 8.5 15.5 17.5'
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${a} 12 12)'>` +
    `<path d='${arc}' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/>` +
    `<path d='${arc}' fill='none' stroke='black' stroke-width='1.5'/>` +
    `<path d='M3 8.5 L7.5 4.5 L7.5 12.5 Z M15.5 21 L11.5 16.5 L19.5 16.5 Z' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round'/>` +
    `</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, grab`
}

const HANDLE_VEC: Record<Handle, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1]
}

/** Screen-space direction (degrees, y down) a handle points after the node's flips/rotation. */
function handleScreenAngle(handle: Handle, matrix: Mat2): number {
  const [hx, hy] = HANDLE_VEC[handle]
  const v = applyMat(matrix, hx, hy)
  return (Math.atan2(v.y, v.x) * 180) / Math.PI
}

function resizeCursor(handle: Handle, matrix: Mat2): string | undefined {
  if (isIdentity(matrix)) return undefined
  const a = ((handleScreenAngle(handle, matrix) % 180) + 180) % 180
  const names = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
  return names[Math.round(a / 45) % 4]
}

function cornerRotateCursor(handle: Handle, matrix: Mat2): string {
  return rotateCursor(handleScreenAngle(handle, matrix) + 45)
}

function ResizeHandles({
  onStart,
  onRotateStart,
  matrix = IDENTITY,
  cornersOnly = true
}: {
  onStart: (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => void
  onRotateStart?: (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => void
  matrix?: Mat2
  cornersOnly?: boolean
}) {
  // Figma: visible squares only at corners. Invisible edge strips still allow side resize.
  const visible = cornersOnly ? CORNER_HANDLES : RESIZE_HANDLES
  const edgeHits = cornersOnly ? (['n', 's', 'e', 'w'] as Handle[]) : []
  return (
    <>
      {onRotateStart &&
        CORNER_HANDLES.map((handle) => (
          <span
            key={`rotate-${handle}`}
            className={`design-rotate ${handle}`}
            style={{ cursor: cornerRotateCursor(handle, matrix) }}
            onPointerDown={onRotateStart(handle)}
          />
        ))}
      {visible.map((handle) => (
        <span
          key={handle}
          className={`design-handle ${handle}`}
          style={{ cursor: resizeCursor(handle, matrix) }}
          onPointerDown={onStart(handle)}
        />
      ))}
      {edgeHits.map((handle) => (
        <span
          key={`edge-${handle}`}
          className={`design-handle design-handle-edge ${handle}`}
          style={{ cursor: resizeCursor(handle, matrix) }}
          onPointerDown={onStart(handle)}
        />
      ))}
    </>
  )
}

export function DesignLayer({
  nodes,
  selectedIds,
  peerSelectedCount = 0,
  tool,
  draft,
  hoverPoint,
  pathHoverId,
  revealId = null,
  revealIds = [],
  buildingIds = [],
  deepHoverId = null,
  deepSelect = false,
  dropParentId = null,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
  onClickRelease,
  onResize,
  onScaleStart,
  onScale,
  onEdit,
  onRemove,
  onSpace,
  onSpaceEnd,
  onPad,
  onPadEnd,
  onLayoutAlign,
  onReorderChildren,
  onSelectIds,
  flexDrop = null,
  dragGhost = null,
  dragGhostIds = [],
  crop = null,
  onCropChange
}: {
  /** Active image crop session (world rects). */
  crop?: {
    nodeId: string
    frame: CropRect
    image: CropRect
    src: string
    adjust?: ImageAdjust | null
    ratio: number | null
  } | null
  onCropChange?: (next: { frame: CropRect; image: CropRect }) => void
  onReorderChildren?: (parentId: string, orderedChildIds: string[], parentPatch?: Partial<DesignNode>) => void
  onSelectIds?: (ids: string[]) => void
  /** Floating square that follows the pointer while reordering flex children (Paper). */
  dragGhost?: { x: number; y: number; width: number; height: number } | null
  /** Layers being reordered — they stay in their slot, dimmed, until drop. */
  dragGhostIds?: string[]
  nodes: DesignNode[]
  selectedIds: string[]
  peerSelectedCount?: number
  tool: DesignTool
  draft: DesignNode | null
  hoverPoint?: PathPoint | null
  pathHoverId?: string | null
  revealId?: string | null
  revealIds?: string[]
  buildingIds?: string[]
  deepHoverId?: string | null
  deepSelect?: boolean
  dropParentId?: string | null
  onSelect: (
    id: string,
    additive: boolean,
    opts?: { deep?: boolean; drill?: boolean; exact?: boolean; clientX?: number; clientY?: number }
  ) => void
  onMoveStart: (id: string) => string | void
  onMove: (id: string, worldX: number, worldY: number, snap?: boolean) => void
  onMoveEnd?: (id: string) => void
  onClickRelease?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
  onSpace?: (axis: 'x' | 'y', gap: number) => void
  onSpaceEnd?: () => void
  onPad?: (side: PadSide, value: number) => void
  onPadEnd?: () => void
  onLayoutAlign?: (justify: AutoLayoutJustify, align: AutoLayoutAlign) => void
  flexDrop?: {
    axis: 'x' | 'y'
    line: { x: number; y: number; width: number; height: number }
    slot: { x: number; y: number; width: number; height: number }
  } | null
}) {
  // The layer being cropped shows the crop editor instead of its selection chrome.
  const selected = new Set(crop ? selectedIds.filter((id) => id !== crop.nodeId) : selectedIds)
  const multiChrome = selectedIds.length + peerSelectedCount > 1
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const revealing = new Set([...(revealIds || []), ...(revealId ? [revealId] : [])])
  const building = new Set(buildingIds || [])
  const renderList = [...nodes, draft].filter((node): node is DesignNode => Boolean(node))
  const strokeSlots = liftedStrokeSlots(renderList, selected, byId)
  const group = selectedIds.length > 1 ? unionWorldBounds(nodes.filter((node) => selected.has(node.id)), nodes) : null
  const spacing = tool === 'pointer' && selectedIds.length >= 1 ? measureSelectionGaps(nodes, selectedIds) : null
  // Grid padding and gaps are edited from the sidebar only, so grids get no on-canvas spacing handles.
  const spacingOnGrid = isGridLayout(spacing?.autoLayoutId ? byId.get(spacing.autoLayoutId) : undefined)
  const gaps = spacingOnGrid ? [] : spacing?.bands || []
  const padFrame = selectedIds.length === 1 ? byId.get(selectedIds[0]) : undefined
  const pads = tool === 'pointer' && onPad && !isGridLayout(padFrame) ? measurePaddingBands(nodes, selectedIds) : []
  const spacingHint = useSpacingHint()
  const gradientEdit = useGradientEdit()
  const blurEdit = useBlurEdit()
  const [chromeHost, setChromeHost] = useState<HTMLDivElement | null>(null)
  const alignTarget = tool === 'pointer' && onLayoutAlign ? measureAlignTarget(nodes, selectedIds) : null
  const deepHover =
    deepHoverId && !selected.has(deepHoverId)
      ? nodes.find((node) => node.id === deepHoverId)
      : deepHoverId
        ? nodes.find((node) => node.id === deepHoverId)
        : null
  const deepHoverBox = deepHover ? resolveWorldRect(deepHover, nodes) : null
  const dropParent = dropParentId ? nodes.find((node) => node.id === dropParentId) : null
  const dropParentBox = dropParent ? resolveWorldRect(dropParent, nodes) : null
  const deepHoverDeep = Boolean(deepSelect)

  return (
    <ChromeHostContext.Provider value={chromeHost}>
    <div className="design-layer">
      {dropParentBox && (
        <div
          className="design-drop-target"
          style={{
            left: dropParentBox.x,
            top: dropParentBox.y,
            width: dropParentBox.width,
            height: dropParentBox.height
          }}
        />
      )}
      <svg className="design-svg" width="1" height="1">
        {[...nodes, draft].map((node) => {
          if (!node || !isTextOnPath(node)) return null
          if (node.visible === false) return null
          return (
            <TextOnPathItem
              key={`path-text-${node.id}`}
              node={node}
              selected={selected.has(node.id)}
              hideSoloChrome={multiChrome && selected.has(node.id)}
              tool={tool}
              onSelect={onSelect}
              onMoveStart={onMoveStart}
              onMove={onMove}
              onEdit={onEdit}
              onRemove={onRemove}
            />
          )
        })}
      </svg>
      {renderList.map((node, index) => {
        const strokes = strokeSlots.get(index)
        const hidden = node.type === 'path' || isTextOnPath(node) || node.visible === false
        const stackZ = stackingZIndex(node, selected, byId)
        return (
          <Fragment key={node.id}>
            {node.type === 'path' && node.visible !== false && (
              <svg className="design-svg" width="1" height="1" style={stackZ != null ? { zIndex: stackZ } : undefined}>
                <DrawnPath
                  node={node}
                  allNodes={nodes}
                  selected={selected.has(node.id)}
                  pathHover={pathHoverId === node.id}
                  hoverPoint={draft?.id === node.id ? hoverPoint : null}
                  tool={tool}
                  onSelect={onSelect}
                  onMoveStart={onMoveStart}
                  onMove={onMove}
                  onMoveEnd={onMoveEnd}
                  showBox={selected.has(node.id) && !multiChrome && draft?.id !== node.id && (node.points?.length || 0) > 1}
                  onResize={onResize}
                />
              </svg>
            )}
            {!hidden && (
              <DesignItem
                node={node}
                allNodes={nodes}
                selected={selected.has(node.id)}
                stackZ={stackZ}
                hideSoloChrome={multiChrome && selected.has(node.id)}
                pathHover={pathHoverId === node.id}
                tool={tool}
                drafting={draft?.id === node.id}
                reveal={revealing.has(node.id)}
                building={building.has(node.id)}
                deepSelect={deepSelect}
                onSelect={onSelect}
                onMoveStart={onMoveStart}
                onMove={onMove}
                onMoveEnd={onMoveEnd}
                onClickRelease={onClickRelease}
                onResize={onResize}
                onScaleStart={onScaleStart}
                onScale={onScale}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            )}
            {strokes?.map((slot) => (
              <StrokeOverlay
                key={`stroke-${slot.node.id}`}
                node={slot.node}
                allNodes={nodes}
                zIndex={slot.zIndex}
                selected={selected.has(slot.node.id)}
              />
            ))}
          </Fragment>
        )
      })}
      {nodes.map((node) => {
        if (node.type !== 'frame' || !node.layoutGrids?.some((grid) => grid.visible !== false)) return null
        if (!isShownInTree(node, byId)) return null
        return (
          <LayoutGridOverlay
            key={`layout-grid-${node.id}`}
            node={node}
            allNodes={nodes}
            box={resolveWorldRect(node, nodes)}
            zIndex={layoutGridZIndex(node, nodes, selected, byId)}
          />
        )
      })}
      {tool === 'pointer' &&
        (() => {
          const target = gridOverlayTarget(nodes, selectedIds)
          if (!target || target.frame.visible === false) return null
          return (
            <GridLayoutOverlay
              frame={target.frame}
              nodes={nodes}
              selectedIds={selectedIds}
              childMode={target.childMode}
              onSelectIds={(ids) => onSelectIds?.(ids)}
              onEdit={onEdit}
              onReorder={onReorderChildren}
            />
          )
        })()}
      {gradientEdit &&
        (() => {
          const node = nodes.find((item) => item.id === selectedIds[0])
          if (!node) return null
          const box = resolveWorldRect(node, nodes)
          return <GradientHandles box={box} transform={nodeTransformCss(node, nodes, box)} edit={gradientEdit} />
        })()}
      {blurEdit &&
        !gradientEdit &&
        selectedIds.length === 1 &&
        (() => {
          const node = nodes.find((item) => item.id === selectedIds[0])
          if (!node) return null
          const box = resolveWorldRect(node, nodes)
          return <BlurHandles box={box} transform={nodeTransformCss(node, nodes, box)} edit={blurEdit} />
        })()}
      {deepHover && deepHoverBox && (
        <div
          className={deepHoverDeep ? 'design-deep-hover' : 'design-hover'}
          style={{
            left: deepHoverBox.x,
            top: deepHoverBox.y,
            width: deepHoverBox.width,
            height: deepHoverBox.height,
            transform: nodeTransformCss(deepHover, nodes, deepHoverBox),
            transformOrigin: 'center center'
          }}
        />
      )}
      <div className="design-chrome-layer" ref={setChromeHost} />
      {group && (
        <div
          className={`design-group${tool === 'scale' ? ' is-scale' : ''}`}
          style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
        >
          {tool === 'scale' &&
            CORNER_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`design-handle ${handle}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  const origin = handleOrigin(group, handle, event.altKey)
                  const startCorner = {
                    x: handle.includes('e')
                      ? group.x + group.width
                      : handle.includes('w')
                        ? group.x
                        : group.x + group.width / 2,
                    y: handle.includes('s')
                      ? group.y + group.height
                      : handle.includes('n')
                        ? group.y
                        : group.y + group.height / 2
                  }
                  const drag = {
                    x: event.clientX,
                    y: event.clientY,
                    origin,
                    startCorner
                  }
                  const target = event.currentTarget
                  const move = (next: PointerEvent) => {
                    const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
                    onScale(
                      drag.origin,
                      scaleFactorFromDrag(
                        drag.origin,
                        drag.startCorner,
                        (next.clientX - drag.x) / scale,
                        (next.clientY - drag.y) / scale
                      )
                    )
                  }
                  const up = () => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  onScaleStart()
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }}
              />
            ))}
          <div className="design-size">
            {Math.round(group.width)} × {Math.round(group.height)}
          </div>
        </div>
      )}
      {onSpace &&
        gaps.map((band, index) => (
          <SpacingHandle
            key={`${band.axis}-${index}`}
            band={band}
            hinted={spacingHint?.kind === 'gap'}
            onSpace={onSpace}
            onSpaceEnd={onSpaceEnd}
          />
        ))}
      {pads.map((band) => (
        <PaddingHandle
          key={`pad-${band.side}`}
          band={band}
          hinted={spacingHint?.kind === 'pad' && spacingHint.sides.includes(band.side)}
          onPad={onPad!}
          onPadEnd={onPadEnd}
        />
      ))}
      {alignTarget && onLayoutAlign && (
        <AlignHandle target={alignTarget} nodes={nodes} onAlign={onLayoutAlign} onSelect={onSelect} />
      )}
      {dragGhostIds.length > 0 && (
        <style>
          {(() => {
            const kids = childIndexOf(nodes)
            const ids = new Set<string>()
            const stack = [...dragGhostIds]
            while (stack.length) {
              const id = stack.pop()!
              if (ids.has(id)) continue
              ids.add(id)
              for (const kid of kids.get(id) || []) stack.push(kid.id)
            }
            return `${[...ids].map((id) => `[data-node-id="${CSS.escape(id)}"]`).join(',')}{opacity:0.35 !important;}`
          })()}
        </style>
      )}
      {flexDrop && (
        <div
          className={`flex-drop-line is-${flexDrop.axis}`}
          style={
            flexDrop.axis === 'x'
              ? { left: flexDrop.line.x, top: flexDrop.line.y, height: flexDrop.line.height }
              : { left: flexDrop.line.x, top: flexDrop.line.y, width: flexDrop.line.width }
          }
        />
      )}
      {dragGhost && (
        <div
          className="flex-drag-ghost"
          style={{ left: dragGhost.x, top: dragGhost.y, width: dragGhost.width, height: dragGhost.height }}
        />
      )}
      {crop && onCropChange && (
        <CropOverlay
          frame={crop.frame}
          image={crop.image}
          src={crop.src}
          adjust={crop.adjust}
          ratio={crop.ratio}
          onChange={onCropChange}
        />
      )}
    </div>
    </ChromeHostContext.Provider>
  )
}

/**
 * Figma spacing drag: a drag scrubs the value; a click without moving opens an inline input.
 * `apply` receives the live value, `end` commits history.
 */
function startSpacingDrag(
  event: ReactPointerEvent<HTMLElement>,
  opts: {
    axis: 'x' | 'y'
    start: number
    sign: 1 | -1
    apply: (value: number) => void
    end?: () => void
    onActive: (active: boolean) => void
    onClick: () => void
    onPointer?: (clientX: number, clientY: number, value: number) => void
    cursor?: (value: number) => string
  }
) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const origin = opts.axis === 'x' ? event.clientX : event.clientY
  const originOther = opts.axis === 'x' ? event.clientY : event.clientX
  const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
  const prevCursor = document.body.style.cursor
  let moved = false
  const move = (next: PointerEvent) => {
    const along = (opts.axis === 'x' ? next.clientX : next.clientY) - origin
    const other = (opts.axis === 'x' ? next.clientY : next.clientX) - originOther
    if (!moved) {
      if (Math.hypot(along, other) < 3) return
      moved = true
      opts.onActive(true)
      document.body.classList.add('is-spacing-drag')
    }
    const value = Math.max(0, Math.round(opts.start + (opts.sign * along) / zoom))
    if (opts.cursor) document.body.style.cursor = opts.cursor(value)
    opts.onPointer?.(next.clientX, next.clientY, value)
    opts.apply(value)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('is-spacing-drag')
    document.body.style.cursor = prevCursor
    if (!moved) {
      opts.onClick()
      return
    }
    opts.onActive(false)
    opts.end?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function GapIcon({ axis }: { axis: 'x' | 'y' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d={axis === 'x' ? 'M2 3h8M2 9h8M4 3v6M8 3v6' : 'M3 2v8M9 2v8M3 4h6M3 8h6'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PadIcon({ side }: { side: PadSide }) {
  const edge = { t: 'M3 3.5h6', b: 'M3 8.5h6', l: 'M3.5 3v6', r: 'M8.5 3v6' }[side]
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
      <path d={edge} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** Dark inline number input opened by clicking a spacing/padding handle (Figma). */
function SpacingValueInput({
  value,
  icon,
  onApply,
  onEnd,
  onClose
}: {
  value: number
  icon: ReactNode
  onApply: (value: number) => void
  onEnd?: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(String(Math.round(value)))
  const inputRef = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  const original = useRef(value)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(id)
  }, [])
  const finish = (next: number | null) => {
    if (closed.current) return
    closed.current = true
    if (next !== null) onApply(next)
    onEnd?.()
    onClose()
  }
  const parsed = () => {
    const next = Number(draft)
    return Number.isFinite(next) ? Math.max(0, next) : null
  }
  return (
    <div className="space-input" onPointerDown={(event) => event.stopPropagation()}>
      {icon}
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') finish(parsed())
          else if (event.key === 'Escape') finish(original.current)
          else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
            const next = Math.max(0, (parsed() ?? 0) + step)
            setDraft(String(next))
            onApply(next)
          }
        }}
        onBlur={() => finish(parsed())}
      />
    </div>
  )
}

function SpacingHandle({
  band,
  hinted = false,
  onSpace,
  onSpaceEnd
}: {
  band: GapBand
  hinted?: boolean
  onSpace: (axis: 'x' | 'y', gap: number) => void
  onSpaceEnd?: () => void
}) {
  const [active, setActive] = useState(false)
  const [editing, setEditing] = useState(false)
  return (
    <div
      className={`space-gap is-${band.axis}${active ? ' is-active' : ''}${hinted ? ' is-hinted' : ''}${editing ? ' is-editing' : ''}`}
      style={{ left: band.x, top: band.y, width: Math.max(band.width, 1), height: Math.max(band.height, 1) }}
      onPointerDown={(event) =>
        startSpacingDrag(event, {
          axis: band.axis,
          start: band.gap,
          sign: 1,
          apply: (value) => onSpace(band.axis, value),
          end: onSpaceEnd,
          onActive: setActive,
          onClick: () => setEditing(true)
        })
      }
    >
      <span className="space-tick" />
      {active && (
        <span className="space-anchor is-center">
          <span className="space-pill is-gap">{Math.round(band.gap)}</span>
        </span>
      )}
      {editing && (
        <span className="space-anchor is-below">
          <SpacingValueInput
            value={band.gap}
            icon={<GapIcon axis={band.axis} />}
            onApply={(value) => onSpace(band.axis, value)}
            onEnd={onSpaceEnd}
            onClose={() => setEditing(false)}
          />
        </span>
      )}
    </div>
  )
}

const PAD_CURSOR_ROTATION: Record<PadSide, number> = { l: 0, t: 90, r: 180, b: 270 }

/** Figma padding cursor: a bar with arrows both ways, or only the growing direction when the padding is 0. */
function padCursor(side: PadSide, value: number, grows = false): string {
  const empty = value < 0.5
  const shape = empty
    ? 'M7 6.5v11M7 12h11M15 9l3 3-3 3'
    : 'M12 6.5v11M4.5 12h15M7.5 9l-3 3 3 3M16.5 9l3 3-3 3'
  const facing: PadSide = grows && side === 'r' ? 'l' : grows && side === 'b' ? 't' : side
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><g transform='rotate(${PAD_CURSOR_ROTATION[facing]} 12 12)' fill='none' stroke-linecap='round' stroke-linejoin='round'>` +
    `<path d='${shape}' stroke='white' stroke-width='3.5'/>` +
    `<path d='${shape}' stroke='black' stroke-width='1.4'/>` +
    `</g></svg>`
  const fallback = side === 'l' || side === 'r' ? 'ew-resize' : 'ns-resize'
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`
}

function PaddingHandle({
  band,
  hinted = false,
  onPad,
  onPadEnd
}: {
  band: PadBand
  hinted?: boolean
  onPad: (side: PadSide, value: number) => void
  onPadEnd?: () => void
}) {
  const [active, setActive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pointer, setPointer] = useState<{ x: number; y: number; value: number } | null>(null)
  const empty = band.value < 0.5
  const across = band.side === 'l' || band.side === 'r'
  const lineStyle: CSSProperties = across
    ? { top: -band.lead, bottom: -band.trail }
    : { left: -band.lead, right: -band.trail }
  return (
    <div
      className={`pad-gap is-${band.side}${empty ? ' is-empty' : ''}${active ? ' is-active' : ''}${hinted ? ' is-hinted' : ''}${editing ? ' is-editing' : ''}`}
      style={{
        left: band.x,
        top: band.y,
        width: Math.max(band.width, 1),
        height: Math.max(band.height, 1)
      }}
    >
      <div
        className="pad-hit"
        style={{ cursor: padCursor(band.side, band.value, band.grows) }}
        onPointerDown={(event) =>
          startSpacingDrag(event, {
            axis: across ? 'x' : 'y',
            start: band.value,
            sign: (band.side === 'r' || band.side === 'b') && !band.grows ? -1 : 1,
            apply: (value) => onPad(band.side, value),
            end: onPadEnd,
            onActive: (next) => {
              setActive(next)
              if (!next) setPointer(null)
            },
            onClick: () => setEditing(true),
            onPointer: (x, y, value) => setPointer({ x, y, value }),
            cursor: (value) => padCursor(band.side, value, band.grows)
          })
        }
      />
      {active && <span className="pad-line" style={lineStyle} />}
      {active &&
        pointer &&
        createPortal(
          <span className="pad-pill" style={{ left: pointer.x + 10, top: pointer.y - 30 }}>
            {pointer.value}
          </span>,
          document.body
        )}
      {editing && (
        <span className="space-anchor is-outer">
          <SpacingValueInput
            value={band.value}
            icon={<PadIcon side={band.side} />}
            onApply={(value) => onPad(band.side, value)}
            onEnd={onPadEnd}
            onClose={() => setEditing(false)}
          />
        </span>
      )}
    </div>
  )
}

function AlignHandle({
  target,
  nodes,
  onAlign,
  onSelect
}: {
  target: AlignTarget
  nodes: DesignNode[]
  onAlign: (justify: AutoLayoutJustify, align: AutoLayoutAlign) => void
  onSelect: SelectHandler
}) {
  return (
    <div
      className="align-drag"
      style={{ left: target.x, top: target.y, width: target.width, height: target.height }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        const zoom = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
        const localX = target.x + (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
        const localY = target.y + (event.clientY - event.currentTarget.getBoundingClientRect().top) / zoom
        const hit = [...layersAtPoint({ x: localX, y: localY }, nodes)]
          .reverse()
          .find((node) => node.id !== target.frameId && node.parentId === target.frameId)
        // Let flex children receive the drag so they can be reordered.
        if (hit) return
        event.preventDefault()
        event.stopPropagation()
        const originX = event.clientX
        const originY = event.clientY
        const frame = nodes.find((node) => node.id === target.frameId)
        const current = {
          justify: frame?.layout?.justifyContent || 'start',
          align: frame?.layout?.alignItems || 'start'
        }
        let moved = false
        const move = (next: PointerEvent) => {
          const dx = (next.clientX - originX) / zoom
          const dy = (next.clientY - originY) / zoom
          if (!moved && Math.hypot(dx, dy) < 3) return
          moved = true
          const nextAlign = alignmentForOffset(target, target.offsetX + dx, target.offsetY + dy, current)
          onAlign(nextAlign.justifyContent, nextAlign.alignItems)
        }
        const up = (next: PointerEvent) => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (moved) return
          const emptyHit = [...layersAtPoint({ x: localX, y: localY }, nodes)]
            .reverse()
            .find((node) => node.id !== target.frameId)
          if (emptyHit) selectFromPointer(onSelect, emptyHit.id, next)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}

/** CSS filter for drawn strokes: drop shadows follow the ink outline; layer blur softens it. */
function inkFilterCss(node: DesignNode): string | undefined {
  const parts: string[] = []
  for (const fx of getNodeEffects(node)) {
    if (fx.visible === false) continue
    if (fx.type === 'DROP_SHADOW') {
      const color = withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25)
      parts.push(`drop-shadow(${fx.offsetX ?? 0}px ${fx.offsetY ?? 4}px ${fx.radius ?? 4}px ${color})`)
    } else if (fx.type === 'LAYER_BLUR') {
      const radius = blurRadius(fx)
      if (radius > 0) parts.push(`blur(${radius / 2}px)`)
    }
  }
  return parts.length ? parts.join(' ') : undefined
}

function DrawnPath({
  node,
  selected,
  pathHover,
  hoverPoint,
  tool,
  allNodes,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
  showBox,
  onResize
}: {
  node: DesignNode
  allNodes: DesignNode[]
  selected: boolean
  /** Frame-style selection box: outline, corner handles and size label. */
  showBox: boolean
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  pathHover?: boolean
  hoverPoint?: PathPoint | null
  tool: DesignTool
  onSelect: SelectHandler
  onMoveStart: (id: string) => string | void
  onMove: (id: string, worldX: number, worldY: number, snap?: boolean) => void
  onMoveEnd?: (id: string) => void
}) {
  const points = node.points || []
  // Older drawings kept their ink color in `fill`; only treat `fill` as a fill once a stroke color exists.
  const color = toHex(node.stroke || node.fill, '#1A1A1A')
  const fillPaints = node.stroke
    ? getNodePaints(node).flatMap((paint) => {
        if (paint.visible === false) return []
        if (paint.type === 'solid') return [withAlpha(paint.color, paint.opacity)]
        if (paint.type === 'gradient' && paint.stops[0]) return [withAlpha(paint.stops[0].color, paint.opacity)]
        return []
      })
    : []
  const effectFilter = inkFilterCss(node)
  const weight = Math.max(0.1, node.strokeWidth || (node.pathTool === 'brush' ? 64 : node.pathTool === 'pencil' ? 6 : 2))
  const style = node.brushStyle || (node.pathTool === 'brush' ? 'heist' : 'basic')
  const useStroke = isPlainStroke(node)
  const showInk = node.strokeWidth !== 0
  const closed = Boolean(node.closed)
  const align = closed ? node.strokeAlign || 'center' : 'center'
  const bodyWeight = align === 'center' ? weight : weight * 2
  const cap = closed ? 'none' : node.strokeCap || 'round'
  const profile = node.strokeProfile || 'uniform'
  const flip = Boolean(node.strokeProfileFlip)
  const fills = useMemo(
    () => (useStroke ? [] : brushFills(points, style, bodyWeight, node.id, closed, { profile, flip, cap })),
    [useStroke, points, style, bodyWeight, node.id, closed, profile, flip, cap]
  )
  const profileD = useMemo(
    () => (!useStroke || profile === 'uniform' ? '' : profileOutline(points, closed, bodyWeight, profile, flip, cap)),
    [useStroke, profile, points, closed, bodyWeight, flip, cap]
  )
  const dash = useStroke && profile === 'uniform' && node.strokeDash ? node.strokeDash : 0
  const line = pathDFromPoints(points, node.closed)
  const last = points[points.length - 1]
  const clipId = `draw-clip-${node.id}`
  const bounds = nodeBounds(node)
  const box = align === 'outside' ? bounds : null
  const ownTransform =
    [node.flipX ? 'scaleX(-1)' : '', node.flipY ? 'scaleY(-1)' : '', node.rotation ? `rotate(${node.rotation}deg)` : '']
      .filter(Boolean)
      .join(' ') || undefined

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (tool !== 'pointer' || node.locked) return
    event.preventDefault()
    event.stopPropagation()
    const start = { x: event.clientX, y: event.clientY, rect: bounds }
    const scale = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
    const move = (next: PointerEvent) => {
      const dx = (next.clientX - start.x) / scale
      const dy = (next.clientY - start.y) / scale
      const own = nodeLinear(node)
      const rect = resizeTransformedRect(start.rect, handle, dx, dy, own, own, {
        lockAspect: Boolean(node.aspectLocked) || next.shiftKey,
        ratio: start.rect.width / Math.max(1, start.rect.height)
      })
      onResize(node.id, { ...rect, world: true })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <g
      className={selected || pathHover ? 'draw-path is-selected' : 'draw-path'}
      opacity={node.opacity ?? 1}
      style={{
        mixBlendMode: cssBlendMode(node.blendMode),
        isolation: cssIsolation(node.blendMode),
        filter: effectFilter,
        transform: ownTransform,
        transformOrigin: ownTransform ? `${bounds.x + bounds.width / 2}px ${bounds.y + bounds.height / 2}px` : undefined
      }}
      onPointerDown={(event) => {
        if (tool !== 'pointer' || event.button !== 0) return
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) return
        event.stopPropagation()
        selectFromPointer(onSelect, node.id, event)
        if (node.locked || !points.length) return
        const moveId = onMoveStart(node.id) || node.id
        const scale = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
        const startX = event.clientX
        const startY = event.clientY
        const moveNode = allNodes.find((item) => item.id === moveId) || node
        const origin = resolveWorldRect(moveNode, allNodes)
        let moved = false
        const move = (next: PointerEvent) => {
          if (!moved) {
            if (Math.hypot(next.clientX - startX, next.clientY - startY) < 4) return
            moved = true
          }
          onMove(
            moveId,
            origin.x + (next.clientX - startX) / scale,
            origin.y + (next.clientY - startY) / scale,
            !next.altKey && !next.ctrlKey && !next.metaKey
          )
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (moved) onMoveEnd?.(moveId)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    >
      {showBox && (
        <rect
          className="draw-hit-box"
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill="transparent"
          pointerEvents="all"
        />
      )}
      {line && (
        <path
          className="draw-hit"
          d={line}
          fill="none"
          stroke="transparent"
          style={{ strokeWidth: `max(${weight}px, calc(12px / var(--zoom, 1)))` }}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="stroke"
        />
      )}
      {line &&
        fillPaints.map((paint, index) => (
          <path key={`fill-${index}`} className="draw-fill" d={closed ? line : `${line} Z`} fill={paint} stroke="none" pointerEvents="fill" />
        ))}
      {showInk && align !== 'center' && line && (
        <defs>
          {align === 'inside' ? (
            <clipPath id={clipId}>
              <path d={line} />
            </clipPath>
          ) : (
            box && (
              <mask
                id={clipId}
                maskUnits="userSpaceOnUse"
                x={box.x - bodyWeight}
                y={box.y - bodyWeight}
                width={box.width + bodyWeight * 2}
                height={box.height + bodyWeight * 2}
              >
                <rect
                  x={box.x - bodyWeight}
                  y={box.y - bodyWeight}
                  width={box.width + bodyWeight * 2}
                  height={box.height + bodyWeight * 2}
                  fill="#fff"
                />
                <path d={line} fill="#000" />
              </mask>
            )
          )}
        </defs>
      )}
      {showInk && (
        <g
          opacity={node.strokeOpacity ?? 1}
          clipPath={align === 'inside' ? `url(#${clipId})` : undefined}
          mask={align === 'outside' ? `url(#${clipId})` : undefined}
        >
          {fills.map((d, index) => (
            <path key={index} className="draw-brush-fill" d={d} fill={color} />
          ))}
          {profileD ? (
            <path className="draw-brush-fill" d={profileD} fill={color} />
          ) : (
            (useStroke || !fills.length) && (
              <path
                className="draw-pen-stroke"
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={bodyWeight}
                strokeLinecap={cap === 'none' ? 'butt' : cap}
                strokeLinejoin={node.strokeJoin || 'round'}
                strokeDasharray={dash ? `${dash} ${node.strokeGap ?? dash}` : undefined}
              />
            )
          )}
        </g>
      )}
      {(selected || pathHover) && line && (
        <path
          className="draw-select-stroke"
          d={line}
          fill="none"
          stroke="#0D99FF"
          strokeWidth={pathHover && !selected ? 1.5 : 1}
          strokeDasharray={pathHover && !selected ? '4 3' : undefined}
        />
      )}
      {node.pathTool === 'pen' &&
        points.map((point, index) => (
          <g key={`${node.id}-${index}`}>
            {point.outX != null && point.outY != null && (
              <>
                <line className="draw-handle-line" x1={point.x} y1={point.y} x2={point.outX} y2={point.outY} />
                <circle className="draw-handle-dot" cx={point.outX} cy={point.outY} r={3.5} />
              </>
            )}
            {point.inX != null && point.inY != null && (
              <>
                <line className="draw-handle-line" x1={point.x} y1={point.y} x2={point.inX} y2={point.inY} />
                <circle className="draw-handle-dot" cx={point.inX} cy={point.inY} r={3.5} />
              </>
            )}
            <rect className="draw-anchor" x={point.x - 3.5} y={point.y - 3.5} width={7} height={7} />
          </g>
        ))}
      {hoverPoint && last && (
        <line className="draw-rubber" x1={last.x} y1={last.y} x2={hoverPoint.x} y2={hoverPoint.y} />
      )}
      {showBox && (
        <SelectionChrome node={node} allNodes={allNodes} box={bounds}>
          <div className="design-upright" style={{ width: bounds.width, height: bounds.height, transform: 'translate(-50%, -50%)' }}>
            <div className="design-size">{formatSizeLabel(node, bounds.width, bounds.height)}</div>
          </div>
          {tool === 'pointer' && !node.locked && <ResizeHandles onStart={startHandle} />}
        </SelectionChrome>
      )}
    </g>
  )
}

function TextOnPathItem({
  node,
  selected,
  hideSoloChrome,
  tool,
  onSelect,
  onMoveStart,
  onMove,
  onEdit,
  onRemove
}: {
  node: DesignNode
  selected: boolean
  hideSoloChrome: boolean
  tool: DesignTool
  onSelect: SelectHandler
  onMoveStart: (id: string) => void
  onMove: (id: string, x: number, y: number, snap?: boolean) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const points = node.points || []
  const closed = Boolean(node.closed)
  const flip = Boolean(node.textPathFlip)
  const d = textPathD(points, closed, flip)
  const pathId = `text-path-${node.id}`
  const box = nodeBounds(node)
  const offset = node.textPathOffset ?? 0
  const start = pointAtPathOffset(points, closed, offset, flip)
  const fontSize = node.fontSize || 12
  const color = withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1)
  ensureGoogleFontLoaded(node.fontFamily || 'Inter', node.fontWeight || 400, node.fontStyle === 'italic')
  const showChrome = (selected || node.editing) && !hideSoloChrome
  const inputRef = useRef<HTMLInputElement>(null)
  const drag = useRef({ x: 0, y: 0, nodeX: node.x, nodeY: node.y })
  const familyCss = cssFontFamily(node.fontFamily || 'Inter')

  useEffect(() => {
    if (!node.editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [node.editing, node.id])

  const finishEdit = (value: string) => {
    const text = value.replace(/\n/g, '')
    if (!text.trim()) {
      onRemove?.(node.id)
      return
    }
    onEdit(node.id, { editing: false, text, name: text })
  }

  return (
    <g
      className={selected || node.editing ? 'text-on-path is-selected' : 'text-on-path'}
      opacity={node.opacity ?? 1}
      style={{ mixBlendMode: cssBlendMode(node.blendMode), isolation: cssIsolation(node.blendMode) }}
      onPointerDown={(event) => {
        if (tool === 'hand') return
        // Ctrl/Cmd+drag → deep marquee on the canvas, not a move.
        if (tool === 'pointer' && (event.ctrlKey || event.metaKey) && !event.shiftKey) return
        event.stopPropagation()
        selectFromPointer(onSelect, node.id, event)
        if (tool !== 'pointer' || node.editing) return
        onMoveStart(node.id)
        drag.current = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y }
        const target = event.currentTarget
        const move = (next: PointerEvent) => {
          const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
          onMove(
            node.id,
            drag.current.nodeX + (next.clientX - drag.current.x) / scale,
            drag.current.nodeY + (next.clientY - drag.current.y) / scale,
            !next.altKey && !next.ctrlKey && !next.metaKey
          )
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (selected) {
          onEdit(node.id, { editing: true })
          return
        }
        drillFromPointer(onSelect, node.id, event)
      }}
    >
      <defs>
        <path id={pathId} d={d} />
      </defs>
      <path
        className="text-on-path-guide"
        d={d}
        fill="none"
        stroke={showChrome ? '#0D99FF' : 'transparent'}
        strokeWidth={showChrome ? 1.25 : 8}
        strokeDasharray={showChrome ? '5 4' : undefined}
        pointerEvents="stroke"
      />
      <text
        className="text-on-path-label"
        fill={color}
        fontFamily={familyCss}
        fontSize={fontSize}
        fontWeight={node.fontWeight || 400}
        fontStyle={node.fontStyle || 'normal'}
        letterSpacing={node.letterSpacing || 0}
        style={{ pointerEvents: 'none' }}
      >
        <textPath href={`#${pathId}`} startOffset={`${offset}%`}>
          {node.text || (node.editing ? '' : 'Type')}
        </textPath>
      </text>
      {node.editing && start && (
        <foreignObject x={start.x - 4} y={start.y - fontSize - 6} width={Math.max(120, box.width)} height={fontSize + 12} style={{ overflow: 'visible' }}>
          <input
            ref={inputRef}
            className="text-on-path-input"
            value={node.text || ''}
            placeholder=""
            style={{
              fontFamily: familyCss,
              fontSize,
              fontWeight: node.fontWeight || 400,
              fontStyle: node.fontStyle || 'normal',
              color,
              letterSpacing: node.letterSpacing || 0
            }}
            onChange={(event) => onEdit(node.id, { text: event.target.value, name: event.target.value || 'Text' })}
            onBlur={(event) => finishEdit(event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape' || event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        </foreignObject>
      )}
      {showChrome && start && (
        <circle
          className="text-path-start"
          cx={start.x}
          cy={start.y}
          r={5}
          onPointerDown={(event) => {
            event.stopPropagation()
            const world = event.currentTarget.closest('.world')
            if (!world) return
            const move = (next: PointerEvent) => {
              const scale = Number(world.getAttribute('data-zoom') || '1')
              const parent = world.parentElement
              if (!parent) return
              const rect = parent.getBoundingClientRect()
              const matrix = new DOMMatrixReadOnly(getComputedStyle(world).transform)
              const localX = (next.clientX - rect.left - matrix.e) / scale
              const localY = (next.clientY - rect.top - matrix.f) / scale
              const nextOffset = offsetAlongPath({ x: localX, y: localY }, points, closed)
              onEdit(node.id, { textPathOffset: flip ? ((100 - nextOffset + 100) % 100) : nextOffset })
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
      )}
      {showChrome && (
        <foreignObject
          x={box.x + box.width / 2 - 36}
          y={box.y + box.height + 10}
          width={72}
          height={22}
          style={{ overflow: 'visible' }}
        >
          <div className="design-size text-path-size">
            {Math.round(box.width)} × {Math.round(box.height)}
          </div>
        </foreignObject>
      )}
    </g>
  )
}

function DesignItem({
  node,
  allNodes,
  selected,
  stackZ,
  hideSoloChrome,
  pathHover,
  tool,
  drafting,
  reveal,
  building,
  deepSelect = false,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
  onClickRelease,
  onResize,
  onScaleStart,
  onScale,
  onEdit,
  onRemove
}: {
  node: DesignNode
  allNodes: DesignNode[]
  selected: boolean
  stackZ?: number
  hideSoloChrome: boolean
  pathHover?: boolean
  tool: DesignTool
  drafting: boolean
  reveal?: boolean
  building?: boolean
  deepSelect?: boolean
  onSelect: SelectHandler
  onMoveStart: (id: string) => string | void
  onMove: (id: string, worldX: number, worldY: number, snap?: boolean) => void
  onMoveEnd?: (id: string) => void
  /** Pointer released without dragging (click). */
  onClickRelease?: (id: string) => void
  onResize: (id: string, next: { x: number; y: number; width: number; height: number; world?: boolean }) => void
  onScaleStart: () => void
  onScale: (origin: { x: number; y: number }, factor: number) => void
  onEdit: (id: string, patch: Partial<DesignNode>) => void
  onRemove?: (id: string) => void
}) {
  const drag = useRef({
    x: 0,
    y: 0,
    nodeX: 0,
    nodeY: 0,
    width: 0,
    height: 0,
    handle: null as Handle | null,
    moveId: '' as string,
    moved: false
  })
  const editRef = useRef<HTMLDivElement>(null)
  const finishEditRef = useRef<(() => void) | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const skipNameBlurCommit = useRef(false)
  const [fontTick, setFontTick] = useState(0)
  const [nameHover, setNameHover] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const showChrome = (selected || drafting || node.editing) && !hideSoloChrome && tool !== 'measure'
  const world = resolveWorldRect(node, allNodes)
  const box = world
  const inheritedRotation = node.parentId ? ancestorRotation(node, allNodes) : 0
  const visualRotation = (node.rotation || 0) + inheritedRotation
  const inGridCell = Boolean(
    node.parentId && !node.layoutAbsolute && isGridLayout(nodeIndexOf(allNodes).get(node.parentId))
  )
  const parentMatrix = node.parentId ? ancestorLinear(node, allNodes) : IDENTITY
  const ownMatrix = nodeLinear(node)
  const screenMatrix = mulMat(parentMatrix, ownMatrix)

  useEffect(() => {
    if (node.type !== 'text') return
    let cancelled = false
    void ensureGoogleFontLoaded(node.fontFamily || 'Inter', node.fontWeight || 400, node.fontStyle === 'italic').then(
      () => {
        if (!cancelled) setFontTick((value) => value + 1)
      }
    )
    return () => {
      cancelled = true
    }
  }, [node.type, node.fontFamily, node.fontWeight, node.fontStyle])

  useEffect(() => {
    if (!renaming) return
    const focusId = window.requestAnimationFrame(() => {
      const el = nameInputRef.current
      if (!el) return
      el.focus()
      el.select()
    })
    return () => window.cancelAnimationFrame(focusId)
  }, [renaming])

  useEffect(() => {
    if (!selected && renaming) setRenaming(false)
  }, [selected, renaming])

  useEffect(() => {
    if (!node.editing || node.type !== 'text' || !editRef.current) return
    const el = editRef.current
    if (el.innerText !== (node.text || '')) el.innerText = node.text || ''
    // Defer focus so the creating click doesn't immediately blur an empty field.
    const focusId = window.requestAnimationFrame(() => {
      el.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    return () => window.cancelAnimationFrame(focusId)
  }, [node.editing, node.id, node.type])

  // Canvas pointerdowns preventDefault, so the editor never blurs on its own.
  useEffect(() => {
    if (!node.editing || node.type !== 'text') return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      const el = editRef.current
      if (!target || !el || el.contains(target)) return
      if (target.closest('.rightbar, .fill-picker, .prop-blend-menu')) return
      if (document.activeElement === el) el.blur()
      else finishEditRef.current?.()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [node.editing, node.type])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'hand') return
    const creating =
      tool === 'shape' ||
      tool === 'frame' ||
      tool === 'section' ||
      tool === 'pen' ||
      tool === 'pencil' ||
      tool === 'brush' ||
      tool === 'widget' ||
      tool === 'text' ||
      tool === 'text-on-path'
    if (creating) {
      if ((tool === 'text' || tool === 'text-on-path') && node.type === 'text' && !isTextOnPath(node)) {
        event.stopPropagation()
        onSelect(node.id, false)
        onEdit(node.id, { editing: true })
      }
      return
    }
    // Ctrl/Cmd held, or any marquee-style nested select: don't steal the gesture —
    // let the canvas start a deep marquee (Figma) instead of selecting the parent frame.
    if (tool === 'pointer' && (deepSelect || event.ctrlKey || event.metaKey) && !event.shiftKey) {
      return
    }
    event.stopPropagation()
    selectFromPointer(onSelect, node.id, event)
    if (tool === 'scale') return
    if (!canDragNode(tool) || node.editing) return
    const moveId = onMoveStart(node.id) || node.id
    const moveNode = allNodes.find((item) => item.id === moveId) || node
    const moveWorld = resolveWorldRect(moveNode, allNodes)
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      nodeX: moveWorld.x,
      nodeY: moveWorld.y,
      width: moveWorld.width,
      height: moveWorld.height,
      handle: null,
      moveId,
      moved: false
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    if (!canDragNode(tool) && tool !== 'scale') return
    const scale = Number(event.currentTarget.closest('.world')?.getAttribute('data-zoom') || '1')
    const start = drag.current
    const dx = (event.clientX - start.x) / scale
    const dy = (event.clientY - start.y) / scale
    if (start.handle) {
      if (tool === 'scale') {
        const scaleBox = { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height }
        const origin = handleOrigin(scaleBox, start.handle, event.altKey)
        const startCorner = {
          x: start.handle.includes('e')
            ? scaleBox.x + scaleBox.width
            : start.handle.includes('w')
              ? scaleBox.x
              : scaleBox.x + scaleBox.width / 2,
          y: start.handle.includes('s')
            ? scaleBox.y + scaleBox.height
            : start.handle.includes('n')
              ? scaleBox.y
              : scaleBox.y + scaleBox.height / 2
        }
        onScale(origin, scaleFactorFromDrag(origin, startCorner, dx, dy))
        return
      }
      onResize(start.moveId || node.id, {
        ...resizeTransformedRect(
          { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height },
          start.handle,
          dx,
          dy,
          ownMatrix,
          screenMatrix,
          {
            lockAspect: Boolean(node.aspectLocked) || event.shiftKey,
            ratio: start.width / Math.max(1, start.height)
          }
        ),
        world: true
      })
      return
    }
    // Figma-like click slop — don't start moving until the pointer actually drags.
    if (!start.moved) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return
      start.moved = true
    }
    const moveNode = start.moveId && start.moveId !== node.id ? allNodes.find((item) => item.id === start.moveId) : node
    const delta = moveNode?.parentId ? applyInverse(ancestorLinear(moveNode, allNodes), dx, dy) : { x: dx, y: dy }
    onMove(
      start.moveId || node.id,
      start.nodeX + delta.x,
      start.nodeY + delta.y,
      !event.altKey && !event.ctrlKey && !event.metaKey
    )
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.current.handle) return
    if (drag.current.moved) onMoveEnd?.(drag.current.moveId || node.id)
    else onClickRelease?.(node.id)
  }

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (drafting || (!canDragNode(tool) && tool !== 'scale')) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(node.id, false)
    if (tool === 'scale') onScaleStart()
    const start = {
      x: event.clientX,
      y: event.clientY,
      nodeX: world.x,
      nodeY: world.y,
      width: world.width,
      height: world.height,
      handle,
      moveId: node.id,
      moved: true
    }
    drag.current = start
    const target = event.currentTarget
    const move = (next: PointerEvent) => {
      const scale = Number(target.closest('.world')?.getAttribute('data-zoom') || '1')
      const dx = (next.clientX - start.x) / scale
      const dy = (next.clientY - start.y) / scale
      if (tool === 'scale') {
        const scaleBox = { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height }
        const origin = handleOrigin(scaleBox, start.handle, next.altKey)
        const startCorner = {
          x: start.handle.includes('e')
            ? scaleBox.x + scaleBox.width
            : start.handle.includes('w')
              ? scaleBox.x
              : scaleBox.x + scaleBox.width / 2,
          y: start.handle.includes('s')
            ? scaleBox.y + scaleBox.height
            : start.handle.includes('n')
              ? scaleBox.y
              : scaleBox.y + scaleBox.height / 2
        }
        onScale(origin, scaleFactorFromDrag(origin, startCorner, dx, dy))
        return
      }
      onResize(node.id, {
        ...resizeTransformedRect(
          { x: start.nodeX, y: start.nodeY, width: start.width, height: start.height },
          start.handle,
          dx,
          dy,
          ownMatrix,
          screenMatrix,
          {
            lockAspect: Boolean(node.aspectLocked) || next.shiftKey,
            ratio: start.width / Math.max(1, start.height)
          }
        ),
        world: true
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      drag.current = { ...drag.current, handle: null }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Figma: drag just outside a corner to spin around the centre; Shift snaps to 15°.
  const startRotate = (handle: Handle) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (drafting || !canDragNode(tool)) return
    event.preventDefault()
    event.stopPropagation()
    onSelect(node.id, false)
    const host = event.currentTarget.closest<HTMLElement>('.design-chrome, [data-node-id], .design-text')
    const rect = host?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const startAngle = Math.atan2(event.clientY - cy, event.clientX - cx)
    const startRotation = node.rotation || 0
    // A mirrored node visually spins the opposite way to its rotation value.
    const spinSign = isMirrored(screenMatrix) ? -1 : 1
    const previousCursor = document.body.style.cursor
    document.body.classList.add('is-rotating-node')
    const move = (next: PointerEvent) => {
      const delta = ((Math.atan2(next.clientY - cy, next.clientX - cx) - startAngle) * 180) / Math.PI
      let angle = startRotation + spinSign * delta
      if (next.shiftKey) angle = Math.round(angle / 15) * 15
      angle = Math.round((((((angle + 180) % 360) + 360) % 360) - 180) * 100) / 100
      if (angle === -180) angle = 180
      document.body.style.cursor = cornerRotateCursor(handle, mulMat(parentMatrix, nodeLinear({ ...node, rotation: angle })))
      onEdit(node.id, { rotation: angle })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('is-rotating-node')
      document.body.style.cursor = previousCursor
    }
    document.body.style.cursor = cornerRotateCursor(handle, screenMatrix)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const editText = () => {
    if (node.type === 'comment') {
      const next = window.prompt('Comment', node.text || '')
      if (next !== null) onEdit(node.id, { text: next })
      return
    }
    onEdit(node.id, { editing: true })
  }

  if (node.type === 'comment') {
    const first = node.messages?.[0]
    const author = first ? getCommentPerson(first.authorId) : null
    const showAvatar = Boolean(author && !node.drafting)
    return (
      <div
        className={`design-comment${selected ? ' is-selected' : ''}${node.resolved ? ' is-resolved' : ''}${node.drafting ? ' is-drafting' : ''}`}
        style={{ left: box.x, top: box.y, opacity: node.opacity ?? 1 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title={first?.text || 'Comment'}
      >
        {showAvatar && author ? (
          <span className="comment-pin-avatar" style={{ background: author.color }}>
            {author.initial}
          </span>
        ) : (
          <span className="comment-pin-bubble">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path
                d="M4 6.5C4 4.567 5.567 3 7.5 3h13C22.433 3 24 4.567 24 6.5v9c0 1.933-1.567 3.5-3.5 3.5H12.2L7.1 24.2a.8.8 0 0 1-1.35-.58V19H7.5C5.567 19 4 17.433 4 15.5v-9Z"
                fill="#0D99FF"
                stroke="#0B6FBF"
                strokeWidth="1.2"
              />
            </svg>
          </span>
        )}
      </div>
    )
  }

  if (node.type === 'text') {
    const fontSize = node.fontSize || 12
    const fontWeight = node.fontWeight || 400
    const fontStyle = node.fontStyle || 'normal'
    ensureGoogleFontLoaded(node.fontFamily || 'Inter', fontWeight, fontStyle === 'italic')
    const textResize = node.textResize || 'auto-width'
    const empty = Boolean(node.editing && !node.text)
    const isDraft = Boolean(drafting)
    const metrics = measureTextNode(node, node.editing || isDraft ? node.text || '' : node.text || 'Text', {
      editing: node.editing || isDraft
    })
    const width = isDraft
      ? Math.max(1, node.width || 1)
      : textResize === 'auto-width'
        ? Math.max(node.editing ? 2 : 8, metrics.width)
        : Math.max(8, node.width || metrics.width)
    const height = isDraft
      ? Math.max(1, node.height || 1)
      : textResize === 'fixed'
        ? Math.max(fontSize, node.height || metrics.height)
        : metrics.height
    const draftDragged = isDraft && (width > metrics.width + 12 || height > metrics.height + 8)
    const textPaint = getNodePaints(node).find((paint) => paint.visible !== false)
    const textColor =
      textPaint?.type === 'solid'
        ? withAlpha(textPaint.color, textPaint.opacity)
        : withAlpha(toHex(node.fill, '#000000'), node.fillOpacity ?? 1)
    const paragraphs = usesParagraphBlocks(node) ? textParagraphs(node, node.text || 'Text') : null
    const listIndent = paragraphs ? listIndentEm(node, paragraphs) : 0
    const readEditor = () => (editRef.current?.innerText || '').replace(/\u00a0/g, ' ').replace(/\n$/, '')
    const finishEdit = () => {
      const text = readEditor()
      if (!text.trim()) {
        onRemove?.(node.id)
        return
      }
      const size = measureTextNode({ ...node, editing: false }, text)
      onEdit(node.id, {
        editing: false,
        text,
        name: text,
        width: textResize === 'auto-width' ? Math.max(8, size.width) : node.width || size.width,
        height: textResize === 'fixed' ? node.height || size.height : size.height,
        textResize
      })
    }
    finishEditRef.current = finishEdit
    const wraps = textResize !== 'auto-width' || node.textAlign === 'justify'
    let hiddenLines: TextLine[] = []
    if (showChrome && !node.editing && !isDraft && (node.textTruncation || textResize === 'fixed')) {
      const lines = measureTextLines(node, node.text || 'Text')
      const contentHeight = lines.length ? Math.max(...lines.map((line) => line.top + line.height)) : 0
      const shift =
        node.textTruncation || node.textAlignVertical === 'top' || !node.textAlignVertical
          ? 0
          : node.textAlignVertical === 'middle'
            ? (height - contentHeight) / 2
            : height - contentHeight
      hiddenLines = node.textTruncation
        ? lines.slice(Math.max(1, node.maxLines || 1))
        : lines.filter((line) => line.top + shift + line.height > height + 1)
      hiddenLines = hiddenLines.slice(0, 60)
    }
    return (
      <BuildRevealShell
        active={Boolean(reveal)}
        className={`design-text${selected && !node.editing ? ' is-selected' : ''}${node.editing ? ' is-editing' : ''}${empty ? ' is-empty' : ''}${reveal ? ' is-reveal' : ''}`}
        data-node-id={node.id}
        data-font-tick={fontTick}
        style={{
          ...styleFromNode(node, { ...box, width, height }, allNodes),
          left: box.x,
          top: box.y,
          width,
          height,
          ...(stackZ != null ? { zIndex: stackZ } : {}),
          ...textTypographyStyle(node),
          display: 'flex',
          flexDirection: 'column',
          justifyContent:
            node.textAlignVertical === 'middle'
              ? 'center'
              : node.textAlignVertical === 'bottom'
                ? 'flex-end'
                : 'flex-start',
          overflow: node.textTruncation || textResize === 'fixed' ? 'hidden' : undefined,
          color: textColor,
          background: 'transparent',
          whiteSpace: wraps ? 'pre-wrap' : 'pre',
          wordBreak: wraps ? 'break-word' : undefined
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.stopPropagation()
          if (selected) {
            editText()
            return
          }
          drillFromPointer(onSelect, node.id, event)
        }}
      >
        <EffectOverlays node={node} radius={0} width={width} height={height} />
        {node.editing ? (
          <div
            ref={editRef}
            className="design-text-editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            style={{ whiteSpace: wraps ? 'pre-wrap' : 'pre' }}
            onInput={() => {
              const text = readEditor()
              const size = measureTextNode(node, text, { editing: true })
              onEdit(node.id, {
                text,
                name: text || 'Text',
                width: textResize === 'auto-width' ? size.width : Math.max(node.width || size.width, size.width),
                height: textResize === 'fixed' ? Math.max(node.height || size.height, size.height) : size.height
              })
            }}
            onBlur={() => {
              window.requestAnimationFrame(() => {
                if (document.activeElement === editRef.current) return
                finishEdit()
              })
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
                event.preventDefault()
                document.execCommand('insertLineBreak')
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : isDraft ? null : (
          <span
            className={`design-text-label${node.textTruncation ? ' is-truncate' : ''}`}
            style={{ whiteSpace: wraps ? 'pre-wrap' : 'pre', ...textBlockStyle(node) }}
          >
            {paragraphs
              ? paragraphs.map((para, index) => (
                  <span
                    key={index}
                    className={para.marker ? 'design-text-para has-marker' : 'design-text-para'}
                    data-marker={para.marker}
                    style={paragraphStyle(node, index, paragraphs.length, listIndent)}
                  >
                    {para.text || '\u200b'}
                  </span>
                ))
              : formatTextCase(node.text || 'Text', node.textCase)}
          </span>
        )}
        {showChrome && !node.editing && !isDraft && (
          <SelectionChrome node={node} allNodes={allNodes} box={{ x: box.x, y: box.y, width, height }}>
            {hiddenLines.length > 0 && (
              <div className="design-text-overflow">
                {hiddenLines.map((line, index) => (
                  <span
                    key={index}
                    style={{
                      left: line.left,
                      top: height + (line.top - hiddenLines[0].top) + line.height * 0.55,
                      width: Math.max(2, line.width)
                    }}
                  />
                ))}
              </div>
            )}
            {!inGridCell && <ResizeHandles onStart={startHandle} onRotateStart={startRotate} matrix={screenMatrix} />}
            <div
              className="design-size"
              style={
                hiddenLines.length
                  ? {
                      bottom: -(
                        hiddenLines[hiddenLines.length - 1].top -
                        hiddenLines[0].top +
                        hiddenLines[hiddenLines.length - 1].height
                      )
                    }
                  : undefined
              }
            >
              {Math.round(width)} × {Math.round(height)}
            </div>
          </SelectionChrome>
        )}
        {((node.editing && !empty) || draftDragged) && !hideSoloChrome && (
          <SelectionChrome node={node} allNodes={allNodes} box={{ x: box.x, y: box.y, width, height }} thin />
        )}
      </BuildRevealShell>
    )
  }

  if (node.type === 'widget') {
    return (
      <div
        className={selected ? 'design-widget is-selected' : 'design-widget'}
        style={{
          ...styleFromNode(node, box, allNodes),
          left: box.x,
          top: box.y,
          width: Math.max(48, node.width || 200),
          height: Math.max(32, node.height || 120),
          ...(stackZ != null ? { zIndex: stackZ } : {})
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span>{node.name || 'Widget'}</span>
      </div>
    )
  }

  if (node.type === 'image') {
    const hasSvgPaint = Boolean(
      node.svgMarkup?.trim() && !/^<svg[^>]*>\s*<\/svg>\s*$/i.test(node.svgMarkup.trim())
    )
    const showDraw = Boolean(building && !node.parentId && !hasSvgPaint)
    return (
      <BuildRevealShell
        active={Boolean(reveal)}
        data-node-id={node.id}
        className={`design-shape design-image${selected ? ' is-selected' : ''}${reveal ? ' is-reveal' : ''}${showDraw ? ' is-build-host' : ''}`}
        style={{
          ...styleFromNode(node, box, allNodes),
          left: box.x,
          top: box.y,
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
          ...(stackZ != null ? { zIndex: stackZ } : {}),
          ...(showDraw
            ? {
                background: node.fill || '#F4F5F7',
                overflow: 'visible' as const
              }
            : {})
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.stopPropagation()
          if (hasSvgPaint || node.locked) {
            drillFromPointer(onSelect, node.id, event)
            return
          }
          openImageCrop(onSelect, node.id)
        }}
      >
        <EffectOverlays
          node={node}
          radius={nodeBorderRadiusCss(node, box.width, box.height)}
          width={Math.max(1, box.width)}
          height={Math.max(1, box.height)}
        />
        {showDraw ? (
          <div className="build-drawing-host" aria-hidden>
            <BuildDrawingAnim active />
          </div>
        ) : (
          <div
            className="design-paint-layers"
            style={{ borderRadius: nodeBorderRadiusCss(node, box.width, box.height) }}
          >
            <NodeImage node={node} fit="stretch" className="design-image-media" />
          </div>
        )}
        {showChrome && (
          <SelectionChrome
            node={node}
            allNodes={allNodes}
            box={{ x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) }}
          >
            {!inGridCell && <ResizeHandles onStart={startHandle} onRotateStart={startRotate} matrix={screenMatrix} />}
            <div className="design-size">
              {Math.round(box.width)} × {Math.round(box.height)}
            </div>
          </SelectionChrome>
        )}
      </BuildRevealShell>
    )
  }

  const width = Math.max(1, box.width)
  const height = Math.max(1, node.type === 'line' || node.type === 'arrow' ? box.height : Math.max(8, box.height))
  const isFrame = node.type === 'frame'
  const isSection = node.type === 'section'
  const directKids = childIndexOf(allNodes).get(node.id) || []
  const hasKids = directKids.length > 0
  const hasBuildContent = Boolean(
    (node.svgMarkup?.trim() && !/^<svg[^>]*>\s*<\/svg>\s*$/i.test(node.svgMarkup.trim())) ||
      directKids.some((item) =>
        Boolean(
          (item.svgMarkup?.trim() && !/^<svg[^>]*>\s*<\/svg>\s*$/i.test(item.svgMarkup.trim())) ||
            (item.imageDataUrl && item.imageDataUrl.length > 32)
        )
      )
  )
  const name = node.name || (isSection ? 'Section' : isFrame ? 'New frame name' : node.type)
  const labelColor = isSection ? toHex(node.stroke, '#000000') : undefined
  const showWorkingChrome = Boolean(
    building && (isFrame || isSection) && !node.parentId && !hasBuildContent
  )
  const showFrameName =
    isFrame &&
    !drafting &&
    (!node.parentId || nodeIndexOf(allNodes).get(node.parentId)?.type === 'section')
  // Name + size badge ride the rotated edges (Figma), snapping to whichever edge is visually on top.
  const uprightStyle = (() => {
    const quarter = Math.round((Boolean(node.flipX) !== Boolean(node.flipY) ? visualRotation : -visualRotation) / 90)
    const odd = Math.abs(quarter) % 2 === 1
    const h = Math.max(1, height)
    const steps: string[] = []
    if (node.flipY) steps.push('scaleY(-1)')
    if (node.flipX) steps.push('scaleX(-1)')
    if (quarter) steps.push(`rotate(${quarter * 90}deg)`)
    steps.push('translate(-50%, -50%)')
    return {
      width: odd ? h : width,
      height: odd ? width : h,
      transform: steps.join(' ')
    }
  })()

  const beginRename = () => {
    skipNameBlurCommit.current = false
    setNameDraft(node.name || 'New frame name')
    setRenaming(true)
  }

  const commitRename = () => {
    if (!renaming) return
    const next = nameDraft.trim() || 'New frame name'
    setRenaming(false)
    if (next !== (node.name || '')) onEdit(node.id, { name: next })
  }

  const cancelRename = () => {
    skipNameBlurCommit.current = true
    setRenaming(false)
    setNameDraft(node.name || 'New frame name')
  }

  return (
    <BuildRevealShell
      active={Boolean(reveal)}
      data-node-id={node.id}
      className={`design-shape design-${node.type}${showChrome || selected ? ' is-selected' : ''}${pathHover ? ' is-path-hover' : ''}${reveal ? ' is-reveal' : ''}${showWorkingChrome ? ' is-build-host' : ''}${nameHover && !selected ? ' is-name-hover' : ''}`}
      style={{
        ...styleFromNode(node, { ...box, width, height }, allNodes),
        left: box.x,
        top: box.y,
        width,
        height: Math.max(1, height),
        ...(stackZ != null ? { zIndex: stackZ } : {}),
        ...((showWorkingChrome || showChrome || showFrameName) ? { overflow: 'visible' as const } : {})
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={(event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation()
        if (selected && node.type === 'text') {
          editText()
          return
        }
        // A leaf shape/frame with an image fill opens Crop, like an image layer.
        const imageFill = getNodePaints(node).some((paint) => paint.type === 'image' && paint.imageDataUrl)
        if (imageFill && !hasKids && !node.svgMarkup?.trim() && !node.locked) {
          openImageCrop(onSelect, node.id)
          return
        }
        drillFromPointer(onSelect, node.id, event)
      }}
    >
      {showWorkingChrome ? (
        <div className="build-drawing-host" aria-hidden>
          <BuildDrawingAnim active />
        </div>
      ) : null}
      <PaintLayers
        node={node}
        radius={nodeBorderRadiusCss(node, width, Math.max(1, height), isSection ? 2 : 0)}
      />
      <EffectOverlays
        node={node}
        radius={nodeBorderRadiusCss(node, width, Math.max(1, height), isSection ? 2 : 0)}
        width={width}
        height={Math.max(1, height)}
      />
      {isFrame && node.svgMarkup?.trim() && !hasKids ? (
        <LiveSvg
          markup={node.svgMarkup}
          className={`design-svg-live${building ? ' is-building' : ''}`}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            pointerEvents: 'none',
            background: 'transparent'
          }}
        />
      ) : null}
      <ShapeGraphic node={node} origin={box} width={width} height={Math.max(1, height)} />
      {isSection && (
        <div
          className="design-section-label"
          style={{
            background: withAlpha(labelColor || '#000000', 0.08),
            color: withAlpha(labelColor || '#000000', 0.75)
          }}
        >
          {name}
        </div>
      )}
      {showFrameName ? (
        <div className="design-upright" style={uprightStyle}>
          {showFrameName ? (
            renaming ? (
              <input
                ref={nameInputRef}
                className="design-name is-editing"
                value={nameDraft}
                spellCheck={false}
                onChange={(event) => setNameDraft(event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onBlur={() => {
                  if (skipNameBlurCommit.current) {
                    skipNameBlurCommit.current = false
                    return
                  }
                  commitRename()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    skipNameBlurCommit.current = true
                    commitRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelRename()
                  }
                }}
                style={{ width: `${Math.max(4, nameDraft.length + 1)}ch` }}
              />
            ) : (
              <div
                className={`design-name${selected ? ' is-selected' : ''}`}
                onPointerEnter={() => setNameHover(true)}
                onPointerLeave={() => setNameHover(false)}
                // Dragging the name label moves the frame (Figma).
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  if (!selected) selectFromPointer(onSelect, node.id, event)
                  beginRename()
                }}
              >
                {name}
              </div>
            )
          ) : null}
        </div>
      ) : null}
      {showChrome && (
        <SelectionChrome
          node={node}
          allNodes={allNodes}
          box={{ x: box.x, y: box.y, width, height: Math.max(1, height) }}
          outline={node.type !== 'line' && node.type !== 'arrow'}
        >
          <div className="design-upright" style={uprightStyle}>
            <div className="design-size">{formatSizeLabel(node, width, Math.max(1, height))}</div>
          </div>
          {!inGridCell && node.type !== 'line' && node.type !== 'arrow' && (
            <ResizeHandles onStart={startHandle} onRotateStart={startRotate} matrix={screenMatrix} />
          )}
        </SelectionChrome>
      )}
    </BuildRevealShell>
  )
}

function ShapeGraphic({
  node,
  origin,
  width,
  height
}: {
  node: DesignNode
  origin: { x: number; y: number }
  width: number
  height: number
}) {
  if (node.type === 'frame' || node.type === 'rect' || node.type === 'section') return null
  const fill = withAlpha(toHex(node.fill, '#D9D9D9'), node.fillOpacity ?? 1)
  const strokeWidth = node.strokeWidth || 0
  const stroke = strokeWidth ? withAlpha(toHex(node.stroke, '#1A1A1A'), node.strokeOpacity ?? 1) : 'none'
  const align =
    node.strokeAlign ||
    (node.type === 'line' || node.type === 'arrow' || node.type === 'path' ? 'center' : 'inside')
  // Approximate inside/outside: SVG strokes are centered; 2× + clip for inside.
  const renderedStroke = strokeWidth && align !== 'center' ? strokeWidth * 2 : strokeWidth
  const clipId = `clip-${node.id}`
  const needsClip = Boolean(strokeWidth && align === 'inside')

  const common = {
    fill,
    stroke,
    strokeWidth: renderedStroke
  }

  let shape: ReactNode = null
  if (node.type === 'ellipse') {
    shape = <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />
  } else if (node.type === 'polygon') {
    shape = <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} {...common} />
  } else if (node.type === 'star') {
    shape = <polygon points={starPoints(width, height)} {...common} />
  } else if (node.type === 'line' || node.type === 'arrow') {
    const points = node.points || [
      { x: origin.x, y: origin.y },
      { x: origin.x + width, y: origin.y + height }
    ]
    const x1 = points[0].x - origin.x
    const y1 = points[0].y - origin.y
    const x2 = points[1].x - origin.x
    const y2 = points[1].y - origin.y
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const head = 12
    return (
      <svg className="design-shape-svg" width={width} height={Math.max(1, height)}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={toHex(node.stroke || node.fill, '#1A1A1A')} strokeWidth={node.strokeWidth || 2} />
        {node.type === 'arrow' && (
          <polygon
            className="is-filled"
            fill={toHex(node.fill || node.stroke, '#1A1A1A')}
            points={`${x2},${y2} ${x2 - head * Math.cos(angle - 0.4)},${y2 - head * Math.sin(angle - 0.4)} ${x2 - head * Math.cos(angle + 0.4)},${y2 - head * Math.sin(angle + 0.4)}`}
          />
        )}
      </svg>
    )
  }
  if (!shape) return null
  const shadowId = `shape-shadow-${node.id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const hasShadow = getNodeEffects(node).some(
    (fx) => fx.visible !== false && (fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW')
  )
  return (
    <svg className="design-shape-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        {needsClip && (
          <clipPath id={clipId}>
            {node.type === 'ellipse' ? (
              <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} />
            ) : node.type === 'polygon' ? (
              <polygon points={`${width / 2},0 ${width},${height} 0,${height}`} />
            ) : (
              <polygon points={starPoints(width, height)} />
            )}
          </clipPath>
        )}
        {hasShadow && <ShapeShadowFilter id={shadowId} node={node} width={width} height={height} />}
      </defs>
      <g filter={hasShadow ? `url(#${shadowId})` : undefined}>
        <g clipPath={needsClip ? `url(#${clipId})` : undefined}>{shape}</g>
      </g>
    </svg>
  )
}

function starPoints(width: number, height: number, spikes = 5): string {
  const cx = width / 2
  const cy = height / 2
  const outer = Math.min(width, height) / 2
  const inner = outer * 0.4
  const points: string[] = []
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / spikes
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`)
  }
  return points.join(' ')
}

function formatSizeValue(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')
}

/** Paper-style badge: "Fill 214.59 × Fit 342.03" for flex children / hug frames / auto-sized text. */
function formatSizeLabel(node: DesignNode, width: number, height: number): string {
  const layout = node.layout && node.layout.mode !== 'none' ? node.layout : undefined
  const textHugH = node.type === 'text' && node.textResize === 'auto-width'
  const textHugV = node.type === 'text' && (node.textResize === 'auto-width' || node.textResize === 'auto-height')
  const axisLabel = (
    layoutSizing: string | undefined,
    frameSizing: string | undefined,
    value: number,
    percent?: number
  ) => {
    if (layoutSizing === 'fill') return `Fill ${formatSizeValue(value)}`
    if (layoutSizing === 'relative') return `${Math.round(percent ?? 100)}%`
    if (layoutSizing === 'hug' || frameSizing === 'hug') return `Fit ${formatSizeValue(value)}`
    if (frameSizing === 'fill') return `Fill ${formatSizeValue(value)}`
    return formatSizeValue(value)
  }
  const h = axisLabel(node.layoutSizingH, layout?.sizingH ?? (textHugH ? 'hug' : undefined), width, node.layoutPercentH)
  const v = axisLabel(node.layoutSizingV, layout?.sizingV ?? (textHugV ? 'hug' : undefined), height, node.layoutPercentV)
  return `${h} × ${v}`
}

function styleFromNode(
  node: DesignNode,
  box: { x?: number; y?: number; width: number; height: number },
  allNodes?: DesignNode[]
): CSSProperties {
  const isSection = node.type === 'section'
  const isFrame = node.type === 'frame'
  const boxed = isFrame || node.type === 'rect' || node.type === 'widget' || isSection || node.type === 'image'
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const topPaint = paints[0]
  const hasExplicitFill = Boolean(topPaint) || node.fill != null || node.fillOpacity != null
  const fill = toHex(
    node.fill,
    isSection
      ? '#FFFFFF'
      : node.type === 'text'
        ? '#000000'
        : node.type === 'image'
          ? '#FFFFFF'
          : boxed
            ? '#D9D9D9'
            : '#D9D9D9'
  )
  const radii = boxed
    ? clampCornerRadii(resolveCornerRadii(node, isSection ? 2 : 0), box.width, box.height)
    : { tl: 0, tr: 0, br: 0, bl: 0 }
  const radiusCss = borderRadiusCss(radii)
  const stroke = toHex(node.stroke, isSection ? '#000000' : '#1A1A1A')
  const strokeAlpha = node.strokeOpacity ?? (isSection ? 0.1 : 1)
  const strokeWidth = node.strokeWidth || 0
  const strokeAlign =
    node.strokeAlign ||
    (node.type === 'line' || node.type === 'arrow' || node.type === 'path' || isSection ? 'center' : 'inside')
  const strokeColor = withAlpha(stroke, strokeAlpha)
  const liftedStroke = hasLiftedStroke(node)
  const shadowParts: string[] = []
  if (boxed && strokeWidth > 0 && !isSection && !liftedStroke) {
    if (strokeAlign === 'inside') shadowParts.push(`inset 0 0 0 ${strokeWidth}px ${strokeColor}`)
    else if (strokeAlign === 'outside') shadowParts.push(`0 0 0 ${strokeWidth}px ${strokeColor}`)
    else if (node.type !== 'text' && node.type !== 'image') {
      // Straddle the edge: half inside, half outside.
      const half = strokeWidth / 2
      shadowParts.push(`inset 0 0 0 ${half}px ${strokeColor}`, `0 0 0 ${half}px ${strokeColor}`)
    }
  }

  const effects = getNodeEffects(node).filter((fx) => fx.visible !== false)
  for (const fx of effects) {
    if (fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW') {
      const sx = fx.offsetX ?? 0
      const sy = fx.offsetY ?? 4
      const sb = fx.radius ?? 4
      const spread = fx.spread ?? 0
      const sc = withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25)
      if (fx.type === 'INNER_SHADOW') shadowParts.push(`inset ${sx}px ${sy}px ${sb}px ${spread}px ${sc}`)
      else if (boxed && !fx.showShadowBehindNode) shadowParts.push(`${sx}px ${sy}px ${sb}px ${spread}px ${sc}`)
    }
  }
  const shadow = shadowParts.length ? shadowParts.join(', ') : undefined

  const useBorderStroke = isSection

  let background: string | undefined = 'transparent'
  // Text uses fill as glyph color, never as a CSS background (that paints a solid bar).
  if (node.type === 'text') {
    background = 'transparent'
  } else if (boxed && node.type === 'image') {
    background = 'transparent'
  } else if (topPaint && boxed) {
    if (topPaint.type === 'solid') background = withAlpha(topPaint.color, topPaint.opacity)
    else if (topPaint.type === 'gradient') background = gradientCss(topPaint, { width: node.width || 0, height: node.height || 0 })
    else if (topPaint.type === 'shader' || topPaint.type === 'video' || topPaint.type === 'image') {
      background =
        topPaint.type === 'image' && !topPaint.imageDataUrl
          ? 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 12px 12px'
          : 'transparent'
    }
  } else if (hasExplicitFill && boxed && node.type !== 'image') {
    background = withAlpha(fill, node.fillOpacity ?? 1)
  } else if (boxed && !isFrame && !isSection && node.type !== 'image') {
    // Shapes without an explicit fill still need a visible default
    background = withAlpha(fill, node.fillOpacity ?? 1)
  } else if (isSection) {
    background = withAlpha('#FFFFFF', node.fillOpacity ?? 1)
  } else if (isFrame) {
    // Keep a fully transparent fill so empty / no-fill frames still receive clicks
    background = 'rgba(0,0,0,0)'
  } else if (topPaint && !boxed) {
    // Non-boxed vectors (ellipse etc.) still paint via SVG; keep CSS bg clear
    background = 'transparent'
  }

  const filters: string[] = []
  // Ellipse / polygon / star shadows are drawn by the SVG outline filter (with spread + inner shadow).
  if (!boxed && !isOutlineShape(node)) {
    for (const fx of effects) {
      if (fx.type !== 'DROP_SHADOW') continue
      const drop = `${fx.offsetX ?? 0}px ${fx.offsetY ?? 4}px ${fx.radius ?? 4}px ${withAlpha(toHex(fx.color, '#000000'), fx.opacity ?? 0.25)}`
      filters.push(`drop-shadow(${drop})`)
    }
  }
  filters.push(...layerFilterParts(node))
  const backdrop = isOutlineShape(node) ? undefined : backdropFilterCss(node)

  return {
    background,
    border: isSection
      ? `${strokeWidth || 1}px solid ${strokeColor}`
      : node.type === 'text' || node.type === 'image' || !boxed
        ? 'none'
        : useBorderStroke
          ? `${strokeWidth}px solid ${strokeColor}`
          : 'none',
    borderRadius: radiusCss,
    opacity: node.opacity ?? 1,
    boxShadow: boxed ? shadow : undefined,
    filter: filters.length ? filters.join(' ') : undefined,
    backdropFilter: backdrop,
    WebkitBackdropFilter: backdrop,
    transform: nodeTransformCss(node, allNodes, { x: box.x ?? 0, y: box.y ?? 0, width: box.width, height: box.height }),
    transformOrigin: 'center center',
    mixBlendMode: cssBlendMode(node.blendMode),
    isolation: cssIsolation(node.blendMode),
    zIndex: isSection ? 0 : 1,
    // Frames keep overflow visible so the name label (above the box) stays
    // hittable — same as auto-layout wraps (`clipsContent: false`). Child
    // nodes are siblings in world space, so CSS overflow never clipped them.
    overflow: isFrame || isSection ? 'visible' : undefined
  }
}

function EffectOverlays({
  node,
  radius,
  width,
  height
}: {
  node: DesignNode
  radius: string | number
  width: number
  height: number
}) {
  if (!getNodeEffects(node).some((fx) => fx.visible !== false)) return null
  return (
    <>
      <EffectDefs node={node} width={width} height={height} />
      <BehindShadows node={node} radius={radius} />
      <OutlineBackdrop node={node} width={width} height={height} />
      <EffectOverlayLayers
        node={node}
        width={width}
        height={height}
        radius={radius}
        renderShader={(fx) => (fx.shader ? <ShaderFill paint={fx.shader} /> : null)}
      />
    </>
  )
}

function PaintLayers({ node, radius }: { node: DesignNode; radius: string }) {
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  const top = paints[0]
  const media = paints.filter((paint) => paint.type === 'shader' || (paint.type === 'video' && paint.videoDataUrl))
  const image = top?.type === 'image' && top.imageDataUrl ? top : null
  if (!media.length && !image) return null
  // Frames keep overflow:visible for name labels; clip media here so corner radius still applies.
  return (
    <div className="design-paint-layers" style={{ borderRadius: radius }}>
      {image ? (
        <AdjustedImage
          src={image.imageDataUrl}
          adjust={image}
          fit={imageFit(image.scaleMode)}
          opacity={image.opacity}
          className="design-paint-media"
          box={image.scaleMode === 'crop' ? image.imageBox : undefined}
        />
      ) : null}
      {media.map((paint, index) => {
        if (paint.type === 'shader') {
          return <ShaderFill key={`shader-${index}`} paint={paint} />
        }
        if (paint.type === 'video' && paint.videoDataUrl) {
          return (
            <video
              key={`video-${index}`}
              className="design-paint-media"
              src={paint.videoDataUrl}
              muted
              loop
              autoPlay
              playsInline
              style={{ opacity: paint.opacity }}
            />
          )
        }
        return null
      })}
    </div>
  )
}

function unionWorldBounds(
  nodes: DesignNode[],
  all: DesignNode[]
): { x: number; y: number; width: number; height: number } | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const box = resolveWorldRect(node, all)
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.width)
    maxY = Math.max(maxY, box.y + box.height)
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}

function resizeRect(
  x: number,
  y: number,
  width: number,
  height: number,
  handle: Handle,
  dx: number,
  dy: number,
  options?: { lockAspect?: boolean; ratio?: number }
): { x: number; y: number; width: number; height: number } {
  let nextX = x
  let nextY = y
  let nextW = width
  let nextH = height
  if (handle.includes('w')) {
    nextX = x + dx
    nextW = width - dx
  }
  if (handle.includes('e')) nextW = width + dx
  if (handle.includes('n')) {
    nextY = y + dy
    nextH = height - dy
  }
  if (handle.includes('s')) nextH = height + dy
  if (nextW < 0) {
    nextX += nextW
    nextW = Math.abs(nextW)
  }
  if (nextH < 0) {
    nextY += nextH
    nextH = Math.abs(nextH)
  }
  nextW = Math.max(8, nextW)
  nextH = Math.max(8, nextH)

  if (options?.lockAspect && options.ratio && options.ratio > 0) {
    const ratio = options.ratio
    const fromWidth = handle === 'e' || handle === 'w' || Math.abs(dx) >= Math.abs(dy)
    if (fromWidth || handle.length === 1) {
      const lockedH = Math.max(8, nextW / ratio)
      if (handle.includes('n')) nextY = y + height - lockedH
      nextH = lockedH
      if (handle === 'n' || handle === 's') {
        // side handles already set width; keep
      }
    } else {
      const lockedW = Math.max(8, nextH * ratio)
      if (handle.includes('w')) nextX = x + width - lockedW
      nextW = lockedW
    }
    // Corner handles: prefer the axis with larger delta
    if (handle.length === 2) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        nextH = Math.max(8, nextW / ratio)
        if (handle.includes('n')) nextY = y + height - nextH
      } else {
        nextW = Math.max(8, nextH * ratio)
        if (handle.includes('w')) nextX = x + width - nextW
      }
    }
  }

  return { x: nextX, y: nextY, width: nextW, height: nextH }
}

function rotateVec(x: number, y: number, deg: number): { x: number; y: number } {
  if (!deg) return { x, y }
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

function ancestorRotation(node: DesignNode, allNodes: DesignNode[]): number {
  let total = 0
  let parentId = node.parentId
  const seen = new Set<string>()
  const byId = nodeIndexOf(allNodes)
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    total += parent.rotation || 0
    parentId = parent.parentId
  }
  return total
}

/** 2×2 linear map `[a, b, c, d]`: x' = a·x + c·y, y' = b·x + d·y. */
type Mat2 = [number, number, number, number]

const IDENTITY: Mat2 = [1, 0, 0, 1]

/** A node's own flip + rotation, matching the CSS `scaleX() scaleY() rotate()` order. */
function nodeLinear(node: Pick<DesignNode, 'rotation' | 'flipX' | 'flipY'>): Mat2 {
  const rad = ((node.rotation || 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const sx = node.flipX ? -1 : 1
  const sy = node.flipY ? -1 : 1
  return [sx * cos, sy * sin, -sx * sin, sy * cos]
}

function mulMat(m: Mat2, n: Mat2): Mat2 {
  return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3]]
}

function applyMat(m: Mat2, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y }
}

function applyInverse(m: Mat2, x: number, y: number): { x: number; y: number } {
  const det = m[0] * m[3] - m[1] * m[2] || 1
  return { x: (m[3] * x - m[2] * y) / det, y: (-m[1] * x + m[0] * y) / det }
}

function isMirrored(m: Mat2): boolean {
  return m[0] * m[3] - m[1] * m[2] < 0
}

function isIdentity(m: Mat2): boolean {
  return Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9
}

/** Combined flip + rotation of every ancestor (outermost applied last). */
function ancestorLinear(node: DesignNode, allNodes: DesignNode[]): Mat2 {
  let m = IDENTITY
  let parentId = node.parentId
  const seen = new Set<string>()
  const byId = nodeIndexOf(allNodes)
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    m = mulMat(nodeLinear(parent), m)
    parentId = parent.parentId
  }
  return m
}

/** CSS transform steps that flip/spin a world-space child around each transformed ancestor's centre (outermost first). */
function ancestorTransform(
  node: DesignNode,
  allNodes: DesignNode[],
  box: { x: number; y: number; width: number; height: number }
): string {
  const parts: string[] = []
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  let parentId = node.parentId
  const seen = new Set<string>()
  const byId = nodeIndexOf(allNodes)
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    if (parent.rotation || parent.flipX || parent.flipY) {
      const rect = resolveWorldRect(parent, allNodes)
      const dx = rect.x + rect.width / 2 - cx
      const dy = rect.y + rect.height / 2 - cy
      const steps = [
        parent.flipX ? 'scaleX(-1)' : '',
        parent.flipY ? 'scaleY(-1)' : '',
        parent.rotation ? `rotate(${parent.rotation}deg)` : ''
      ]
        .filter(Boolean)
        .join(' ')
      parts.unshift(`translate(${dx}px, ${dy}px) ${steps} translate(${-dx}px, ${-dy}px)`)
    }
    parentId = parent.parentId
  }
  return parts.join(' ')
}

/** Full CSS transform for a node's box: inherited ancestor flips/rotation, then its own. */
function nodeTransformCss(
  node: DesignNode,
  allNodes: DesignNode[] | undefined,
  box: { x: number; y: number; width: number; height: number }
): string | undefined {
  const parts: string[] = []
  if (allNodes && node.parentId) {
    const inherited = ancestorTransform(node, allNodes, box)
    if (inherited) parts.push(inherited)
  }
  if (node.flipX) parts.push('scaleX(-1)')
  if (node.flipY) parts.push('scaleY(-1)')
  if (node.rotation) parts.push(`rotate(${node.rotation}deg)`)
  return parts.length ? parts.join(' ') : undefined
}

/**
 * Resize in the node's own flipped/rotated frame, keeping the opposite edge pinned on screen.
 * `ownMatrix` is the node's flip+rotation; `screenMatrix` also includes every ancestor's.
 */
function resizeTransformedRect(
  start: { x: number; y: number; width: number; height: number },
  handle: Handle,
  screenDx: number,
  screenDy: number,
  ownMatrix: Mat2,
  screenMatrix: Mat2,
  options?: { lockAspect?: boolean; ratio?: number }
): { x: number; y: number; width: number; height: number } {
  if (isIdentity(screenMatrix)) return resizeRect(start.x, start.y, start.width, start.height, handle, screenDx, screenDy, options)
  const local = applyInverse(screenMatrix, screenDx, screenDy)
  const next = resizeRect(start.x, start.y, start.width, start.height, handle, local.x, local.y, options)
  if (isIdentity(ownMatrix)) return next
  const shift = applyMat(
    ownMatrix,
    next.x + next.width / 2 - (start.x + start.width / 2),
    next.y + next.height / 2 - (start.y + start.height / 2)
  )
  return {
    x: start.x + start.width / 2 + shift.x - next.width / 2,
    y: start.y + start.height / 2 + shift.y - next.height / 2,
    width: next.width,
    height: next.height
  }
}
