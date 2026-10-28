import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import type { AutoLayout, AutoLayoutAlign, AutoLayoutJustify, BrowserFrame, ConstraintH, ConstraintV, DesignNode, DesignPage, DesignTool, ExportFormat, ExportSetting, GridLayout, LayoutSizing, StrokeProfile, BrushStyleId } from '../shared/types'
import { brushById, brushPreviewD, isPlainStroke, profileOutline, STRETCH_BRUSHES, STROKE_PROFILES } from './drawBrushes'
import { BROWSER_SIZE_PRESETS, FRAME_PRESET_CATEGORIES, type FramePreset } from '../shared/framePresets'
import {
  defaultShader,
  defaultSolid,
  getNodePaints,
  legacyFromPaints,
  paintLabel,
  paintPreviewCss,
  type Paint
} from '../shared/paint'
import {
  defaultFrameLayout,
  inferAutoLayoutForFrame,
  inferGridColumns,
  childrenOf,
  localBounds,
  type EnableAutoLayoutOpts
} from '../shared/layoutEngine'
import { setGridPanel } from './gridTracks'
import {
  CONSTRAINT_H_OPTIONS,
  CONSTRAINT_V_OPTIONS,
  resolveConstraintH,
  resolveConstraintV,
  showsConstraints
} from '../shared/constraints'
import { deriveDarkCanvasFill, resolvePageFill } from './colorMath'
import { BLEND_MODE_GROUPS, normalizeBlendMode } from '../shared/blendModes'
import {
  defaultEffect,
  effectLabel,
  effectSummary,
  EFFECT_TYPE_OPTIONS,
  getNodeEffects,
  progressiveLine,
  syncLegacyEffectFields,
  type DesignEffect,
  type EffectBlurMode,
  type EffectType,
  type NoiseType
} from '../shared/effects'
import { setBlurEdit } from './blurEdit'
import {
  defaultLayoutGrid,
  LAYOUT_GRID_COUNT_OPTIONS,
  layoutGridAlignmentLabel,
  layoutGridLabel,
  layoutGridSummary,
  stretchSectionSize,
  type LayoutGrid,
  type LayoutGridAlignment,
  type LayoutGridPattern
} from '../shared/layoutGrids'
import {
  cornersAreIndependent,
  resolveCornerRadii,
  uniformRadii,
  type CornerRadii
} from '../shared/corners'
import { canAlignNodes, type AlignAction } from './alignGuides'
import { measureSelectionGaps } from './selectionSpace'
import { setSpacingHint, spacingHintProps } from './spacingHint'
import type { InspectInfo } from '../shared/types'
import { nodeBounds } from './canvasMath'
import { FillPicker, type ColorSet } from './FillPicker'
import { FillRow, SliderField, StrokeWeightIcon } from './InspectorFields'
import { FrameDevicePicker } from './FrameDevicePicker'
import { FramePresetsPanel } from './FramePresetsPanel'
import { ShaderEditor } from './ShaderEditor'
import { isTextOnPath } from './textPath'
import { measureTextLines } from './textLayout'
import { TextAlignIcon, TextVAlignIcon, TypeSettingsIcon, TypeSettingsPopup } from './TypeSettings'
import { createPortal } from 'react-dom'
import {
  DEFAULT_EXPORT_SETTING,
  EXPORT_FIXED_SIZES,
  EXPORT_FORMATS,
  EXPORT_SCALES,
  exportFormatLabel,
  exportNodeAsPngBlob,
  exportNodeSetting,
  exportSizeLabel,
  parseExportSize
} from './exportNode'

import {
  allGoogleFonts,
  cssFontFamily,
  ensureGoogleFontLoaded,
  familyHasVariableAxes,
  FONT_STYLE_OPTIONS,
  fontStyleId,
  nearestFontStyle,
  searchGoogleFonts,
  stylesForFamily,
  SYSTEM_FONTS,
  type FontStyleOption
} from './googleFonts'

export function toHex(color: string | undefined, fallback = '#EEEEEE'): string {
  if (!color) return fallback
  const value = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase()
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase()
  }
  return fallback
}

export function withAlpha(hex: string, alpha = 1): string {
  const value = toHex(hex, '#000000')
  const r = Number.parseInt(value.slice(1, 3), 16)
  const g = Number.parseInt(value.slice(3, 5), 16)
  const b = Number.parseInt(value.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

export function DesignInspector({
  page,
  node,
  nodes = [],
  selectedIds = [],
  onAlign,
  onSpace,
  browser,
  inspect,
  inspectOn,
  tool,
  theme = 'light',
  onCopyLink,
  onPatchPage,
  onPatchNode,
  onPatchMany,
  onEnableAutoLayout,
  onPatchBrowser,
  onSpawnFrame,
  onSpawnBrowser
}: {
  page: DesignPage
  node: DesignNode | null
  nodes?: DesignNode[]
  selectedIds?: string[]
  onAlign?: (action: AlignAction) => void
  onSpace?: (axis: 'x' | 'y', gap: number) => void
  browser: BrowserFrame | null
  inspect: InspectInfo | null
  inspectOn: boolean
  tool?: DesignTool
  theme?: 'light' | 'dark'
  onCopyLink?: () => void
  onPatchPage: (patch: Partial<DesignPage>) => void
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
  onPatchMany?: (patches: Array<{ id: string; patch: Partial<DesignNode> }>) => void
  onEnableAutoLayout?: (id: string, opts?: EnableAutoLayoutOpts) => void
  onPatchBrowser: (id: string, patch: { x?: number; y?: number; width?: number; height?: number }) => void
  onSpawnFrame?: (preset: FramePreset) => void
  onSpawnBrowser?: (preset: FramePreset) => void
}) {
  if (tool === 'frame' && onSpawnFrame) {
    return (
      <FramePresetsPanel
        key="frame-presets"
        title="Frame"
        categories={FRAME_PRESET_CATEGORIES}
        defaultOpenId="phone"
        onSelect={onSpawnFrame}
      />
    )
  }

  if (tool === 'browser' && onSpawnBrowser) {
    return (
      <FramePresetsPanel
        key="browser-presets"
        title="Browser"
        categories={BROWSER_SIZE_PRESETS}
        defaultOpenId="phone"
        onSelect={onSpawnBrowser}
      />
    )
  }

  if (node) {
    const box = nodeBounds(node)
    const fill = toHex(
      node.fill,
      node.type === 'text' ? '#000000' : node.type === 'frame' || node.type === 'section' ? '#FFFFFF' : '#DDDDDD'
    )
    const stroke = toHex(node.stroke, node.type === 'section' ? '#000000' : '#1A1A1A')
    const isText = node.type === 'text'
    const onPath = isTextOnPath(node)
    const isSection = node.type === 'section'
    const isBox = node.type === 'frame' || node.type === 'rect' || node.type === 'widget' || isSection
    const defaultStrokeAlign: 'center' | 'inside' | 'outside' =
      node.type === 'line' || node.type === 'arrow' || node.type === 'path' ? 'center' : 'inside'
    const strokeAlign = node.strokeAlign || defaultStrokeAlign
    const plainPath = node.type === 'path' && isPlainStroke(node)
    const inkPath = node.type === 'path' && Boolean(node.pathTool)
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : null
    const inAutoLayout =
      Boolean(parent && parent.type === 'frame' && parent.layout && parent.layout.mode !== 'none')
    const frameAuto = node.type === 'frame' && node.layout && node.layout.mode !== 'none'
    // Fill/Relative only apply while flowing in a parent flex (not absolute).
    const allowFill = inAutoLayout && !node.layoutAbsolute
    // Frame dimensions live in AutoLayoutBlock (Figma Layout panel).
    const showDims = node.type !== 'frame'
    const sizingH = node.layoutSizingH || 'fixed'
    const sizingV = node.layoutSizingV || 'fixed'
    const textResize = node.textResize || 'auto-width'
    const parentPad =
      parent?.layout && parent.layout.mode !== 'none'
        ? typeof parent.layout.padding === 'number'
          ? { t: parent.layout.padding, r: parent.layout.padding, b: parent.layout.padding, l: parent.layout.padding }
          : parent.layout.padding || { t: 0, r: 0, b: 0, l: 0 }
        : { t: 0, r: 0, b: 0, l: 0 }
    const parentInnerW = Math.max(1, (parent?.width || 0) - (parentPad.l || 0) - (parentPad.r || 0))
    const parentInnerH = Math.max(1, (parent?.height || 0) - (parentPad.t || 0) - (parentPad.b || 0))
    const percentH =
      node.layoutPercentH ??
      Math.min(100, Math.max(0, Math.round(((box.width || 0) / parentInnerW) * 100)))
    const percentV =
      node.layoutPercentV ??
      Math.min(100, Math.max(0, Math.round(((box.height || 0) / parentInnerH) * 100)))
    const alignIds = selectedIds.length ? selectedIds : [node.id]
    const alignOn = canAlignNodes(nodes, alignIds)
    const spacing =
      onSpace && (alignIds.length > 1 || (alignIds.length === 1 && nodes.some((item) => item.id === alignIds[0])))
        ? measureSelectionGaps(nodes, alignIds)
        : null
    const hasSpacing = Boolean(
      spacing &&
        (spacing.hGap != null || spacing.vGap != null) &&
        !(frameAuto && spacing.autoLayoutId === node.id)
    )

    const isArtboard =
      node.type === 'frame' && alignIds.length === 1 && (!node.parentId || parent?.type === 'section')

    return (
      <>
        {isArtboard && (
          <FrameDevicePicker
            width={box.width}
            height={box.height}
            onSelect={(preset) => {
              const baseName = preset.name
              const siblings = nodes.filter(
                (item) =>
                  item.id !== node.id &&
                  item.type === 'frame' &&
                  item.pageId === node.pageId &&
                  (item.name === baseName || item.name?.startsWith(`${baseName} -`))
              ).length
              onPatchNode(node.id, {
                width: preset.width,
                height: preset.height,
                name: `${baseName} - ${siblings + 1}`
              })
            }}
          />
        )}
        <PositionBlock
          x={box.x}
          y={box.y}
          rotation={node.rotation || 0}
          flipX={Boolean(node.flipX)}
          flipY={Boolean(node.flipY)}
          canAlign={alignOn}
          onAlign={onAlign}
          constraints={
            showsConstraints(node, nodes)
              ? {
                  horizontal: resolveConstraintH(node),
                  vertical: resolveConstraintV(node),
                  onChange: (patch) => onPatchNode(node.id, patch)
                }
              : null
          }
          onChange={(patch) => onPatchNode(node.id, patch)}
        />
        {node.type === 'frame' && (
          <AutoLayoutBlock
            layout={node.layout}
            clipsContent={node.clipsContent !== false}
            width={box.width}
            height={box.height}
            sizingH={
              sizingH === 'fill' || sizingH === 'relative'
                ? sizingH
                : node.layout?.sizingH === 'hug'
                  ? 'hug'
                  : 'fixed'
            }
            sizingV={
              sizingV === 'fill' || sizingV === 'relative'
                ? sizingV
                : node.layout?.sizingV === 'hug'
                  ? 'hug'
                  : 'fixed'
            }
            gridColumnsGuess={inferGridColumns(childrenOf(nodes, node.id))}
            onChange={(layout) => onPatchNode(node.id, { layout })}
            onEnable={(opts) => {
              if (onEnableAutoLayout) {
                onEnableAutoLayout(node.id, opts)
                return
              }
              const kids = childrenOf(nodes, node.id)
              const inferred = inferAutoLayoutForFrame(node, kids, opts)
              onPatchNode(node.id, { layout: inferred, clipsContent: node.clipsContent !== false })
            }}
            onDims={(patch) => onPatchNode(node.id, patch)}
            onClips={(clipsContent) => onPatchNode(node.id, { clipsContent })}
            aspectLocked={Boolean(node.aspectLocked)}
            onAspectLock={(aspectLocked) => onPatchNode(node.id, { aspectLocked })}
            onOpenGridSettings={() => setGridPanel({ frameId: node.id, axis: null, index: null })}
            onFit={
              frameAuto && node.layout
                ? () => onPatchNode(node.id, { layout: { ...node.layout!, sizingH: 'hug', sizingV: 'hug' } })
                : childrenOf(nodes, node.id).some((kid) => kid.visible !== false)
                ? () => {
                    const kids = childrenOf(nodes, node.id).filter((kid) => kid.visible !== false)
                    let minX = Infinity
                    let minY = Infinity
                    let maxX = -Infinity
                    let maxY = -Infinity
                    for (const kid of kids) {
                      const rect = localBounds(kid)
                      minX = Math.min(minX, rect.x)
                      minY = Math.min(minY, rect.y)
                      maxX = Math.max(maxX, rect.x + rect.width)
                      maxY = Math.max(maxY, rect.y + rect.height)
                    }
                    const patches: Array<{ id: string; patch: Partial<DesignNode> }> = [
                      {
                        id: node.id,
                        patch: {
                          x: node.x + minX,
                          y: node.y + minY,
                          width: Math.max(1, maxX - minX),
                          height: Math.max(1, maxY - minY)
                        }
                      },
                      ...childrenOf(nodes, node.id).map((kid) => ({
                        id: kid.id,
                        patch: { x: kid.x - minX, y: kid.y - minY }
                      }))
                    ]
                    if (onPatchMany) onPatchMany(patches)
                    else for (const entry of patches) onPatchNode(entry.id, entry.patch)
                  }
                : undefined
            }
          />
        )}
        {!frameAuto && (showDims || inAutoLayout || isText || hasSpacing) && (
          <LayoutDimsBlock
            width={box.width}
            height={isText ? box.height || node.fontSize || 12 : box.height}
            aspectLocked={Boolean(node.aspectLocked)}
            showDimensions={showDims || (inAutoLayout && node.type !== 'frame') || isText}
            showResizing={(inAutoLayout && node.type !== 'frame') || isText}
            sizingH={
              isText
                ? textResize === 'auto-width'
                  ? 'hug'
                  : sizingH === 'fill'
                    ? 'fill'
                    : 'fixed'
                : sizingH
            }
            sizingV={
              isText
                ? textResize === 'auto-height'
                  ? 'hug'
                  : sizingV === 'fill'
                    ? 'fill'
                    : textResize === 'auto-width'
                      ? 'hug'
                      : 'fixed'
                : sizingV
            }
            percentH={percentH}
            percentV={percentV}
            parentInnerW={parentInnerW}
            parentInnerH={parentInnerH}
            textMode={isText}
            textResize={textResize}
            flexFrame={undefined}
            allowFill={allowFill}
            showAbsolute={inAutoLayout}
            absolute={Boolean(node.layoutAbsolute)}
            gridSpan={
              parent?.layout?.grid && inAutoLayout
                ? { columns: node.gridColumnSpan || 1, rows: node.gridRowSpan || 1 }
                : null
            }
            onChange={(patch) => onPatchNode(node.id, patch)}
            spacing={
              hasSpacing && spacing && onSpace
                ? { hGap: spacing.hGap, vGap: spacing.vGap, onChange: onSpace }
                : null
            }
          />
        )}
        {frameAuto && hasSpacing && spacing && onSpace && (
          <LayoutDimsBlock
            width={box.width}
            height={box.height}
            showDimensions={false}
            showResizing={false}
            onChange={(patch) => onPatchNode(node.id, patch)}
            spacing={{ hGap: spacing.hGap, vGap: spacing.vGap, onChange: onSpace }}
          />
        )}
        <AppearanceBlock
          nodeId={node.id}
          opacity={(node.opacity ?? 1) * 100}
          blend={normalizeBlendMode(node.blendMode)}
          radii={
            isBox || isText || node.type === 'polygon' || node.type === 'star'
              ? resolveCornerRadii(node, isSection ? 2 : 0)
              : undefined
          }
          radiusMax={Math.round(Math.min(box.width, box.height) / 2)}
          visible={node.visible !== false}
          onVisible={(visible) => onPatchNode(node.id, { visible })}
          onOpacity={(opacity) => onPatchNode(node.id, { opacity: opacity / 100 })}
          onBlend={(blendMode) => onPatchNode(node.id, { blendMode })}
          onRadii={
            isBox || isText || node.type === 'polygon' || node.type === 'star'
              ? (next, mode) => {
                  onPatchNode(node.id, {
                    radius: next.tl,
                    cornerRadii: mode === 'independent' ? next : undefined
                  })
                }
              : undefined
          }
        />
        {(node.type === 'polygon' || node.type === 'star') && <section className="prop-section">
          <div className="prop-arc-fields" style={{gridTemplateColumns:node.type === 'star' ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)'}}>
            <div><div className="prop-pos-label">Count</div><NumField prefix="⌗" value={node.type === 'star' ? node.starCount ?? 5 : node.polygonCount ?? 3} onChange={value => onPatchNode(node.id,node.type === 'star' ? { starCount:Math.max(3,Math.min(60,Math.round(value))) } : { polygonCount:Math.max(3,Math.min(60,Math.round(value))) })} /></div>
            {node.type === 'star' && <div><div className="prop-pos-label">Ratio</div><NumField suffix="%" value={(node.starRatio ?? .382)*100} onChange={value => onPatchNode(node.id,{starRatio:Math.max(.01,Math.min(.99,value/100))})} /></div>}
          </div>
        </section>}
        {node.type === 'ellipse' && <section className="prop-section prop-arc-section">
          <div className="prop-section-head">Arc</div>
          <div className="prop-arc-fields">
            <div title="Start angle"><NumField suffix="°" value={node.arcStart || 0} onChange={value => onPatchNode(node.id, { arcStart: ((value % 360) + 360) % 360 })} /><span>Start</span></div>
            <div title="Sweep"><NumField suffix="%" value={(node.arcSweep ?? 360)/3.6} onChange={value => onPatchNode(node.id, { arcSweep: Math.max(.1, Math.min(360,value*3.6)) })} /><span>Sweep</span></div>
            <div title="Inner radius"><NumField suffix="%" value={(node.arcInnerRadius || 0)*100} onChange={value => onPatchNode(node.id, { arcInnerRadius: Math.max(0, Math.min(.99,value/100)) })} /><span>Ratio</span></div>
          </div>
        </section>}
        {isText && (
          <TextBlock
            node={node}
            onPath={onPath}
            onPatch={(patch) => onPatchNode(node.id, patch)}
          />
        )}
        {node.type !== 'line' && node.type !== 'arrow' && <FillBlock
          paints={getNodePaints(node)}
          fallbackHex={fill}
          colorSource={nodes.filter((item) => item.pageId === node.pageId)}
          onChange={(paints) => {
            const legacy = legacyFromPaints(paints)
            const image = paints.find((paint) => paint.type === 'image' && paint.visible !== false)
            onPatchNode(node.id, {
              fills: paints,
              fill: legacy.fill,
              fillOpacity: legacy.fillOpacity,
              ...(node.type === 'image' && image?.type === 'image' ? { imageDataUrl: image.imageDataUrl } : {})
            })
          }}
        />}
        <StrokeBlock
          enabled={Boolean(node.strokeWidth) || isSection}
          hex={stroke}
          width={node.strokeWidth || 1}
          maxWidth={inkPath ? 200 : 20}
          opacity={Math.round((node.strokeOpacity ?? (isSection ? 0.1 : 1)) * 100)}
          align={node.type === 'path' && !node.closed ? 'center' : strokeAlign}
          showAlign={node.type === 'path' ? Boolean(node.closed) : node.type !== 'line' && node.type !== 'arrow'}
          brush={
            inkPath && node.pathTool !== 'pen'
              ? {
                  value: node.brushStyle || (node.pathTool === 'brush' ? 'heist' : 'basic'),
                  onChange: (brushStyle) => onPatchNode(node.id, { brushStyle })
                }
              : undefined
          }
          onToggle={() =>
            onPatchNode(
              node.id,
              node.strokeWidth
                ? { strokeWidth: 0 }
                : {
                    stroke: isSection ? '#000000' : '#1A1A1A',
                    strokeWidth: 1,
                    strokeOpacity: isSection ? 0.1 : 1,
                    strokeAlign: defaultStrokeAlign
                  }
            )
          }
          onHex={(next) => onPatchNode(node.id, { stroke: next, strokeWidth: node.strokeWidth || 1 })}
          onWidth={(strokeWidth) => onPatchNode(node.id, { strokeWidth })}
          onOpacity={(strokeOpacity) => onPatchNode(node.id, { strokeOpacity: strokeOpacity / 100 })}
          onAlign={(next) => onPatchNode(node.id, { strokeAlign: next, strokeWidth: node.strokeWidth || 1 })}
          join={node.type === 'path' ? node.strokeJoin || 'round' : 'miter'}
          cap={node.type === 'path' ? node.strokeCap || 'round' : node.strokeCap || 'none'}
          onJoin={plainPath ? (strokeJoin) => onPatchNode(node.id, { strokeJoin }) : undefined}
          onCap={['path','line','arrow'].includes(node.type) && !node.closed ? (strokeCap) => onPatchNode(node.id, { strokeCap }) : undefined}
          profile={['path','line','arrow'].includes(node.type) ? node.strokeProfile || 'uniform' : 'uniform'}
          profileFlip={Boolean(node.strokeProfileFlip)}
          onProfile={
            ['path','line','arrow'].includes(node.type)
              ? (strokeProfile) =>
                  onPatchNode(node.id, strokeProfile === 'uniform' ? { strokeProfile: undefined } : { strokeProfile, strokeDash: undefined })
              : undefined
          }
          onProfileFlip={['path','line','arrow'].includes(node.type) ? () => onPatchNode(node.id, { strokeProfileFlip: !node.strokeProfileFlip }) : undefined}
          dash={plainPath ? node.strokeDash || 0 : 0}
          gap={node.strokeGap}
          onDash={
            plainPath
              ? ({ dash, gap }) =>
                  onPatchNode(node.id, dash > 0 ? { strokeDash: dash, strokeGap: gap } : { strokeDash: undefined, strokeGap: undefined })
              : undefined
          }
        />
        <EffectsBlock
          node={node}
          onPatch={(patch) => onPatchNode(node.id, patch)}
        />
        {node.type === 'frame' && (
          <LayoutGuideBlock
            node={node}
            onChange={(layoutGrids) => onPatchNode(node.id, { layoutGrids })}
          />
        )}
        <SelectionColorsBlock node={node} nodes={nodes} onPatchNode={onPatchNode} onPatchMany={onPatchMany} />
        <ExportBlock
          key={node.id}
          name={node.name || (node.type === 'frame' ? 'Frame' : node.type)}
          settings={node.exportSettings || []}
          onChange={(exportSettings) => onPatchNode(node.id, { exportSettings })}
          onExport={async (setting) => {
            try {
              await exportNodeSetting(node, setting, nodes)
            } catch {
              /* ignore */
            }
          }}
          renderPreview={() => exportNodeAsPngBlob(node, nodes, 1)}
        />
      </>
    )
  }

  if (browser) {
    return (
      <>
        <div className="prop-node-head">
          <div className="prop-node-title">Browser</div>
        </div>
        <PositionBlock
          x={browser.x}
          y={browser.y}
          rotation={0}
          hideRotation
          onChange={(patch) => onPatchBrowser(browser.id, { x: patch.x, y: patch.y })}
        />
        <LayoutDimsBlock
          width={browser.width}
          height={browser.height}
          onChange={(patch) => onPatchBrowser(browser.id, patch)}
        />
      </>
    )
  }

  return (
    <>
      {onCopyLink && (
        <div className="prop-copy-link-wrap">
          <button type="button" className="prop-copy-link" onClick={onCopyLink}>
            <span>Copy link</span>
            <em>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ L' : 'Ctrl + L'}</em>
          </button>
        </div>
      )}
      <section className="prop-section prop-section-page">
        <div className="prop-section-head">Page</div>
        <PageFillRow
          hex={resolvePageFill({ ...page, fillHidden: false }, theme)}
          hidden={Boolean(page.fillHidden)}
          onHex={(hex) => {
            if (theme === 'dark') onPatchPage({ fillDark: hex, fillHidden: false })
            else onPatchPage({ fill: hex, fillDark: deriveDarkCanvasFill(hex), fillHidden: false })
          }}
          onToggleHidden={() => onPatchPage({ fillHidden: !page.fillHidden })}
        />
      </section>
      <section className="prop-section prop-section-mcp">
        <div className="prop-section-head">MCP</div>
        <button type="button" className="prop-copy-link" onClick={() => window.dispatchEvent(new Event('scobe:open-mcp'))}>Connect your agent</button>
      </section>
      {inspectOn && inspect && (
        <section className="prop-section">
          <div className="prop-section-head">Inspect</div>
          <div className="inspect-card">
            <strong>
              {inspect.tag}
              {inspect.id ? `#${inspect.id}` : ''}
            </strong>
            <span>
              {Math.round(inspect.rect.width)}×{Math.round(inspect.rect.height)}
            </span>
            <span>{inspect.styles.fontSize}</span>
            <span>{inspect.styles.color}</span>
          </div>
        </section>
      )}
    </>
  )
}

function GapInput({
  axis,
  value,
  onChange
}: {
  axis: 'x' | 'y'
  value: number | 'mixed'
  onChange: (gap: number) => void
}) {
  const shown = value === 'mixed' ? 'Mixed' : String(Math.round(value))
  return (
    <label className="prop-num" title={axis === 'x' ? 'Horizontal spacing' : 'Vertical spacing'}>
      <span>
        {axis === 'x' ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 1.6v8.8M6 1.6v8.8M10 1.6v8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M2.6 6h6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M1.6 2h8.8M1.6 6h8.8M1.6 10h8.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M6 2.6v6.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <input
        value={shown}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(Math.max(0, next))
        }}
      />
    </label>
  )
}

function PositionBlock({
  x,
  y,
  rotation,
  flipX,
  flipY,
  hideRotation,
  canAlign = false,
  onAlign,
  constraints = null,
  onChange
}: {
  x: number
  y: number
  rotation: number
  flipX?: boolean
  flipY?: boolean
  hideRotation?: boolean
  canAlign?: boolean
  onAlign?: (action: AlignAction) => void
  constraints?: {
    horizontal: ConstraintH
    vertical: ConstraintV
    onChange: (patch: { constraintH?: ConstraintH; constraintV?: ConstraintV }) => void
  } | null
  onChange: (patch: {
    x?: number
    y?: number
    rotation?: number
    flipX?: boolean
    flipY?: boolean
  }) => void
}) {
  const alignTitle = (title: string) => (canAlign ? title : 'Select two objects, or one object inside a frame')
  const [showConstraints, setShowConstraints] = useState(() => localStorage.getItem('vanta-show-constraints') !== 'false')
  const toggleConstraints = () => {
    localStorage.setItem('vanta-show-constraints', String(!showConstraints))
    setShowConstraints(!showConstraints)
  }
  const rotateBy90 = () => {
    // A single flip mirrors the spin direction; keep the button turning clockwise on screen.
    let next = (rotation || 0) + (Boolean(flipX) !== Boolean(flipY) ? -90 : 90)
    while (next > 180) next -= 360
    while (next <= -180) next += 360
    onChange({ rotation: next })
  }
  return (
    <section className="prop-section prop-section-position">
      <div className="prop-pos-label">Alignment</div>
      <div className="prop-pos-row">
        <div className="prop-seg" aria-label="Align horizontal">
          {(
            [
              ['left', 'Align left'],
              ['hcenter', 'Align horizontal centers'],
              ['right', 'Align right']
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              type="button"
              title={alignTitle(title)}
              disabled={!canAlign || !onAlign}
              onClick={() => onAlign?.(id)}
            >
              <AlignIcon kind={id} />
            </button>
          ))}
        </div>
        <div className="prop-seg" aria-label="Align vertical">
          {(
            [
              ['top', 'Align top'],
              ['vcenter', 'Align vertical centers'],
              ['bottom', 'Align bottom']
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              type="button"
              title={alignTitle(title)}
              disabled={!canAlign || !onAlign}
              onClick={() => onAlign?.(id)}
            >
              <AlignIcon kind={id} />
            </button>
          ))}
        </div>
      </div>
      <div className="prop-pos-label">Position</div>
      <div className="prop-pos-row">
        <NumField prefix="X" value={x} onChange={(next) => onChange({ x: next })} />
        <NumField prefix="Y" value={y} onChange={(next) => onChange({ y: next })} />
        {constraints && (
          <button
            type="button"
            className={`prop-constraints-toggle${showConstraints ? ' is-on' : ''}`}
            title={showConstraints ? 'Hide constraints' : 'Show constraints'}
            aria-pressed={showConstraints}
            onClick={toggleConstraints}
          >
            <ConstraintsToggleIcon />
          </button>
        )}
      </div>
      {constraints && showConstraints && (
        <>
          <div className="prop-pos-label">Constraints</div>
          <ConstraintsBlock
            horizontal={constraints.horizontal}
            vertical={constraints.vertical}
            onChange={constraints.onChange}
          />
        </>
      )}
      {!hideRotation && (
        <>
          <div className="prop-pos-label">Rotation</div>
          <div className="prop-pos-row">
            <RotationField value={rotation} onChange={(next) => onChange({ rotation: next })} />
            <div className="prop-seg">
              <button type="button" title="Rotate 90° right" onClick={rotateBy90}>
                <RotateIcon />
              </button>
              <button
                type="button"
                title="Flip horizontal"
                aria-pressed={Boolean(flipX)}
                onClick={() => onChange({ flipX: !flipX })}
              >
                <FlipIcon axis="x" />
              </button>
              <button
                type="button"
                title="Flip vertical"
                aria-pressed={Boolean(flipY)}
                onClick={() => onChange({ flipY: !flipY })}
              >
                <FlipIcon axis="y" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function ConstraintsToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.5 1.75h5M1.75 6.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="4.5" y="4.5" width="10" height="8" rx="1.5" stroke="currentColor" strokeOpacity="0.45" />
      <path d="M9.5 6.5v4M7.5 8.5h4" stroke="currentColor" strokeOpacity="0.45" strokeLinecap="round" />
      <path d="M6.5 14.75h5" stroke="currentColor" strokeOpacity="0.45" strokeLinecap="round" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

function RotationField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
  return (
    <label className="prop-num prop-num-rotation">
      <span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M2.5 1.5v8h8" stroke="currentColor" strokeWidth="1" strokeLinecap="square" />
          <path d="M2.5 5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      </span>
      <input
        value={draft ?? `${shown}°`}
        onFocus={(event) => {
          setDraft(shown)
          const input = event.currentTarget
          window.requestAnimationFrame(() => input.select())
        }}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          setDraft(event.target.value)
          const next = Number(event.target.value.replace('°', '').trim())
          if (event.target.value.trim() && Number.isFinite(next)) onChange(next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </label>
  )
}

function RotateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 6.2 12.3 10.5 8 14.8 3.7 10.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M3.6 4.6C4.6 2 10.3 1.4 12.3 4.3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M12.6 1.9 12.4 4.4 9.9 4.1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ConstraintsBlock({
  horizontal,
  vertical,
  onChange
}: {
  horizontal: ConstraintH
  vertical: ConstraintV
  onChange: (patch: { constraintH?: ConstraintH; constraintV?: ConstraintV }) => void
}) {
  return (
    <div className="prop-constraints">
      <div className="prop-constraints-fields">
        <ConstraintSelect
          axis="h"
          value={horizontal}
          options={CONSTRAINT_H_OPTIONS}
          onChange={(constraintH) => onChange({ constraintH })}
        />
        <ConstraintSelect
          axis="v"
          value={vertical}
          options={CONSTRAINT_V_OPTIONS}
          onChange={(constraintV) => onChange({ constraintV })}
        />
      </div>
      <ConstraintsWidget horizontal={horizontal} vertical={vertical} onChange={onChange} />
    </div>
  )
}

function ConstraintSelect<T extends string>({
  axis,
  value,
  options,
  onChange
}: {
  axis: 'h' | 'v'
  value: T
  options: { id: T; label: string }[]
  onChange: (next: T) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = options.find((item) => item.id === value) || options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`prop-constraint-select${open ? ' is-open' : ''}`} ref={root}>
      <button
        type="button"
        className="prop-constraint-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={axis === 'h' ? 'Horizontal constraints' : 'Vertical constraints'}
        onClick={() => setOpen((v) => !v)}
      >
        <ConstraintAxisIcon axis={axis} />
        <span>{current.label}</span>
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="prop-constraint-menu" role="listbox" aria-label={axis === 'h' ? 'Horizontal' : 'Vertical'}>
          {options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === value}
              className={item.id === value ? 'is-on' : undefined}
              onClick={() => {
                onChange(item.id)
                setOpen(false)
              }}
            >
              <span>{item.label}</span>
              {item.id === value && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConstraintAxisIcon({ axis }: { axis: 'h' | 'v' }) {
  if (axis === 'h') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M1.5 4.5v5M12.5 4.5v5M1.5 7h11" stroke="currentColor" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M4.5 1.5h5M4.5 12.5h5M7 1.5v11" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}

function ConstraintsWidget({
  horizontal,
  vertical,
  onChange
}: {
  horizontal: ConstraintH
  vertical: ConstraintV
  onChange: (patch: { constraintH?: ConstraintH; constraintV?: ConstraintV }) => void
}) {
  const leftOn = horizontal === 'left' || horizontal === 'left-right'
  const rightOn = horizontal === 'right' || horizontal === 'left-right'
  const topOn = vertical === 'top' || vertical === 'top-bottom'
  const bottomOn = vertical === 'bottom' || vertical === 'top-bottom'
  const hCenter = horizontal === 'center'
  const vCenter = vertical === 'center'
  const hScale = horizontal === 'scale'
  const vScale = vertical === 'scale'

  const toggleH = (side: 'left' | 'right') => {
    if (horizontal === 'scale' || horizontal === 'center') {
      onChange({ constraintH: side === 'left' ? 'left' : 'right' })
      return
    }
    const nextLeft = side === 'left' ? !leftOn : leftOn
    const nextRight = side === 'right' ? !rightOn : rightOn
    if (nextLeft && nextRight) onChange({ constraintH: 'left-right' })
    else if (nextLeft) onChange({ constraintH: 'left' })
    else if (nextRight) onChange({ constraintH: 'right' })
    else onChange({ constraintH: 'left' })
  }

  const toggleV = (side: 'top' | 'bottom') => {
    if (vertical === 'scale' || vertical === 'center') {
      onChange({ constraintV: side === 'top' ? 'top' : 'bottom' })
      return
    }
    const nextTop = side === 'top' ? !topOn : topOn
    const nextBottom = side === 'bottom' ? !bottomOn : bottomOn
    if (nextTop && nextBottom) onChange({ constraintV: 'top-bottom' })
    else if (nextTop) onChange({ constraintV: 'top' })
    else if (nextBottom) onChange({ constraintV: 'bottom' })
    else onChange({ constraintV: 'top' })
  }

  return (
    <div className="prop-constraints-widget" aria-hidden={false} title="Constraints">
      <button
        type="button"
        className={`prop-constraint-pin is-top${topOn ? ' is-on' : ''}${vScale ? ' is-scale' : ''}`}
        title="Top"
        onClick={() => toggleV('top')}
      />
      <button
        type="button"
        className={`prop-constraint-pin is-bottom${bottomOn ? ' is-on' : ''}${vScale ? ' is-scale' : ''}`}
        title="Bottom"
        onClick={() => toggleV('bottom')}
      />
      <button
        type="button"
        className={`prop-constraint-pin is-left${leftOn ? ' is-on' : ''}${hScale ? ' is-scale' : ''}`}
        title="Left"
        onClick={() => toggleH('left')}
      />
      <button
        type="button"
        className={`prop-constraint-pin is-right${rightOn ? ' is-on' : ''}${hScale ? ' is-scale' : ''}`}
        title="Right"
        onClick={() => toggleH('right')}
      />
      <button
        type="button"
        className={`prop-constraint-center${hCenter || vCenter ? ' is-on' : ''}`}
        title="Center"
        onClick={() =>
          onChange({
            constraintH: hCenter ? 'left' : 'center',
            constraintV: vCenter ? 'top' : 'center'
          })
        }
      >
        <span className={`prop-constraint-cross-h${hCenter || hScale ? ' is-on' : ''}`} />
        <span className={`prop-constraint-cross-v${vCenter || vScale ? ' is-on' : ''}`} />
      </button>
    </div>
  )
}

function sizingLabel(mode: LayoutSizing): string {
  if (mode === 'hug') return 'Fit'
  if (mode === 'fill') return 'Fill'
  if (mode === 'relative') return 'Relative'
  return 'Fixed'
}

function SizeModeField({
  axis,
  mode,
  value,
  modes,
  onMode,
  onValue
}: {
  axis: 'W' | 'H'
  mode: LayoutSizing
  value: number
  modes: LayoutSizing[]
  onMode: (mode: LayoutSizing) => void
  onValue: (value: number) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const showNumber = mode === 'fixed' || mode === 'relative'

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`prop-size-mode${open ? ' is-open' : ''}`} ref={rootRef}>
      {showNumber ? (
        <label className="prop-num prop-size-mode-num">
          <button type="button" className="prop-size-mode-axis" onClick={() => setOpen((v) => !v)}>
            {axis}
          </button>
          <input
            value={Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onValue(next)
            }}
          />
          {mode === 'relative' && <em>%</em>}
          <button
            type="button"
            className="prop-size-mode-caret"
            aria-label={`${axis} sizing`}
            onClick={() => setOpen((v) => !v)}
          >
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </label>
      ) : (
        <button type="button" className="prop-size-mode-trigger" onClick={() => setOpen((v) => !v)}>
          <span>{axis}</span>
          <em>{sizingLabel(mode)}</em>
          <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {open && (
        <div className="prop-size-mode-menu" role="listbox" aria-label={`${axis} sizing`}>
          {modes.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={mode === item}
              className={mode === item ? 'is-on' : undefined}
              onClick={() => {
                onMode(item)
                setOpen(false)
              }}
            >
              <span>{sizingLabel(item)}</span>
              {mode === item && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M2.5 6.2 4.8 8.5 9.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LayoutDimsBlock({
  width,
  height,
  aspectLocked,
  showDimensions = true,
  showResizing = false,
  sizingH = 'fixed',
  sizingV = 'fixed',
  percentH = 100,
  percentV = 100,
  parentInnerW = 1,
  parentInnerH = 1,
  absolute = false,
  textMode = false,
  textResize = 'auto-width',
  flexFrame,
  allowFill = false,
  showAbsolute = false,
  spacing = null,
  gridSpan = null,
  onChange
}: {
  gridSpan?: { columns: number; rows: number } | null
  width: number
  height: number
  aspectLocked?: boolean
  showDimensions?: boolean
  showResizing?: boolean
  sizingH?: LayoutSizing
  sizingV?: LayoutSizing
  percentH?: number
  percentV?: number
  parentInnerW?: number
  parentInnerH?: number
  absolute?: boolean
  textMode?: boolean
  textResize?: 'auto-width' | 'auto-height' | 'fixed'
  flexFrame?: AutoLayout
  allowFill?: boolean
  showAbsolute?: boolean
  spacing?: {
    hGap: number | 'mixed' | null
    vGap: number | 'mixed' | null
    onChange: (axis: 'x' | 'y', gap: number) => void
  } | null
  onChange: (patch: {
    width?: number
    height?: number
    aspectLocked?: boolean
    layout?: AutoLayout
    layoutSizingH?: LayoutSizing
    layoutSizingV?: LayoutSizing
    layoutPercentH?: number
    layoutPercentV?: number
    layoutAbsolute?: boolean
    textResize?: 'auto-width' | 'auto-height' | 'fixed'
    gridColumnSpan?: number
    gridRowSpan?: number
  }) => void
}) {
  const ratio = width / Math.max(1, height)
  const modes: LayoutSizing[] = (() => {
    if (!showResizing) return ['fixed']
    if (textMode) return allowFill ? ['fixed', 'hug', 'fill'] : ['fixed', 'hug']
    if (flexFrame) {
      return allowFill || sizingH === 'fill' || sizingV === 'fill' || sizingH === 'relative' || sizingV === 'relative'
        ? ['fixed', 'hug', 'fill', 'relative']
        : ['fixed', 'hug']
    }
    return allowFill ? ['fixed', 'hug', 'fill', 'relative'] : ['fixed']
  })()

  const applyFrameSizing = (axis: 'h' | 'v', mode: LayoutSizing) => {
    const base = { ...defaultFrameLayout(), ...flexFrame! }
    if (mode === 'relative') {
      if (axis === 'h') {
        const pct = Math.min(100, Math.max(0, Math.round((width / Math.max(1, parentInnerW)) * 100)))
        onChange({
          layout: { ...base, sizingH: 'fixed' },
          layoutSizingH: 'relative',
          layoutPercentH: pct,
          width: Math.max(1, (parentInnerW * pct) / 100)
        })
        return
      }
      const pct = Math.min(100, Math.max(0, Math.round((height / Math.max(1, parentInnerH)) * 100)))
      onChange({
        layout: { ...base, sizingV: 'fixed' },
        layoutSizingV: 'relative',
        layoutPercentV: pct,
        height: Math.max(1, (parentInnerH * pct) / 100)
      })
      return
    }
    if (mode === 'fill') {
      if (axis === 'h') {
        onChange({ layout: { ...base, sizingH: 'fixed' }, layoutSizingH: 'fill' })
        return
      }
      onChange({ layout: { ...base, sizingV: 'fixed' }, layoutSizingV: 'fill' })
      return
    }
    if (mode === 'hug') {
      if (axis === 'h') {
        onChange({
          layout: { ...base, sizingH: 'hug' },
          layoutSizingH: 'fixed'
        })
        return
      }
      onChange({
        layout: { ...base, sizingV: 'hug' },
        layoutSizingV: 'fixed'
      })
      return
    }
    if (axis === 'h') {
      onChange({
        layout: { ...base, sizingH: 'fixed' },
        layoutSizingH: 'fixed',
        width
      })
      return
    }
    onChange({
      layout: { ...base, sizingV: 'fixed' },
      layoutSizingV: 'fixed',
      height
    })
  }

  const setSizingH = (mode: LayoutSizing) => {
    if (textMode) {
      if (mode === 'hug') onChange({ textResize: 'auto-width', layoutSizingH: 'fixed' })
      else if (mode === 'fill') onChange({ textResize: 'fixed', layoutSizingH: 'fill' })
      else onChange({ textResize: 'fixed', layoutSizingH: 'fixed' })
      return
    }
    if (flexFrame) {
      applyFrameSizing('h', mode)
      return
    }
    if (mode === 'relative') {
      const pct = Math.min(100, Math.max(0, Math.round((width / Math.max(1, parentInnerW)) * 100)))
      onChange({
        layoutSizingH: 'relative',
        layoutPercentH: pct,
        width: Math.max(1, (parentInnerW * pct) / 100)
      })
      return
    }
    if (mode === 'hug') {
      onChange({ layoutSizingH: 'hug' })
      return
    }
    onChange({ layoutSizingH: mode })
  }
  const setSizingV = (mode: LayoutSizing) => {
    if (textMode) {
      if (mode === 'hug') onChange({ textResize: 'auto-height', layoutSizingV: 'fixed' })
      else if (mode === 'fill') onChange({ textResize: 'fixed', layoutSizingV: 'fill' })
      else onChange({ textResize: 'fixed', layoutSizingV: 'fixed' })
      return
    }
    if (flexFrame) {
      applyFrameSizing('v', mode)
      return
    }
    if (mode === 'relative') {
      const pct = Math.min(100, Math.max(0, Math.round((height / Math.max(1, parentInnerH)) * 100)))
      onChange({
        layoutSizingV: 'relative',
        layoutPercentV: pct,
        height: Math.max(1, (parentInnerH * pct) / 100)
      })
      return
    }
    if (mode === 'hug') {
      onChange({ layoutSizingV: 'hug' })
      return
    }
    onChange({ layoutSizingV: mode })
  }

  const setWidth = (next: number) => {
    if (sizingH === 'relative') {
      const pct = Math.min(100, Math.max(0, next))
      onChange({
        layoutSizingH: 'relative',
        layoutPercentH: pct,
        width: Math.max(1, (parentInnerW * pct) / 100),
        ...(flexFrame ? { layout: { ...defaultFrameLayout(), ...flexFrame, sizingH: 'fixed' } } : {})
      })
      return
    }
    const w = Math.max(1, next)
    if (flexFrame) {
      const base = { ...defaultFrameLayout(), ...flexFrame, sizingH: 'fixed' as const }
      if (aspectLocked) {
        onChange({
          width: w,
          height: Math.max(1, w / ratio),
          layout: { ...base, sizingV: 'fixed' },
          layoutSizingH: 'fixed',
          layoutSizingV: 'fixed'
        })
      } else {
        onChange({ width: w, layout: base, layoutSizingH: 'fixed' })
      }
      return
    }
    if (aspectLocked) onChange({ width: w, height: Math.max(1, w / ratio), layoutSizingH: 'fixed' })
    else onChange({ width: w, layoutSizingH: 'fixed' })
  }
  const setHeight = (next: number) => {
    if (sizingV === 'relative') {
      const pct = Math.min(100, Math.max(0, next))
      onChange({
        layoutSizingV: 'relative',
        layoutPercentV: pct,
        height: Math.max(1, (parentInnerH * pct) / 100),
        ...(flexFrame ? { layout: { ...defaultFrameLayout(), ...flexFrame, sizingV: 'fixed' } } : {})
      })
      return
    }
    const h = Math.max(1, next)
    if (flexFrame) {
      const base = { ...defaultFrameLayout(), ...flexFrame, sizingV: 'fixed' as const }
      if (aspectLocked) {
        onChange({
          height: h,
          width: Math.max(1, h * ratio),
          layout: { ...base, sizingH: 'fixed' },
          layoutSizingH: 'fixed',
          layoutSizingV: 'fixed'
        })
      } else {
        onChange({ height: h, layout: base, layoutSizingV: 'fixed' })
      }
      return
    }
    if (aspectLocked) onChange({ height: h, width: Math.max(1, h * ratio), layoutSizingV: 'fixed' })
    else onChange({ height: h, layoutSizingV: 'fixed' })
  }

  const modeH: LayoutSizing = textMode
    ? textResize === 'auto-width'
      ? 'hug'
      : sizingH === 'fill'
        ? 'fill'
        : 'fixed'
    : sizingH
  const modeV: LayoutSizing = textMode
    ? textResize === 'auto-height'
      ? 'hug'
      : textResize === 'auto-width'
        ? 'hug'
        : sizingV === 'fill'
          ? 'fill'
          : 'fixed'
    : sizingV

  return (
    <section className="prop-section prop-section-layout">
      <div className="prop-section-head">Layout</div>
      {textMode && <><div className="prop-pos-label">Resizing</div><div className="text-sizing-options" role="group" aria-label="Text resizing">
        {(['auto-width','auto-height','fixed'] as const).map((value,index) => <button key={value} type="button" title={['Auto width','Auto height','Fixed size'][index]} aria-label={['Auto width','Auto height','Fixed size'][index]} aria-pressed={textResize === value} onClick={() => onChange({textResize:value})}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden><path d={index === 0 ? 'M3.5 4.5v7M12.5 4.5v7M4 8h8M5.5 6.5 4 8l1.5 1.5M10.5 6.5 12 8l-1.5 1.5' : index === 1 ? 'M4.5 3.5h7M4.5 12.5h7M8 4v8M6.5 5.5 8 4l1.5 1.5M6.5 10.5 8 12l1.5-1.5' : 'M3.5 3.5h9v9h-9zM5.5 6h5M5.5 8h5M5.5 10h3'} stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" /></svg>
        </button>)}
      </div></>}

      {showAbsolute && !textMode && (
        <label className="al-clip prop-layout-absolute">
          <input
            type="checkbox"
            checked={absolute}
            onChange={(event) => onChange({ layoutAbsolute: event.target.checked })}
          />
          Absolute position
        </label>
      )}
      {showDimensions && !absolute && (
        <>
          <div className="prop-pos-label">Dimensions</div>
          <div className="prop-slider-row prop-dims-row">
            <LinkedDims linked={Boolean(aspectLocked)}>
              <SizeModeField
                axis="W"
                mode={modeH}
                value={modeH === 'relative' ? percentH : width}
                modes={modes}
                onMode={setSizingH}
                onValue={setWidth}
              />
              <SizeModeField
                axis="H"
                mode={modeV}
                value={modeV === 'relative' ? percentV : height}
                modes={modes}
                onMode={setSizingV}
                onValue={setHeight}
              />
            </LinkedDims>
            <button
              type="button"
              className={`prop-trail-ico prop-link-btn${aspectLocked ? ' is-on' : ''}`}
              title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              aria-pressed={Boolean(aspectLocked)}
              onClick={() => onChange({ aspectLocked: !aspectLocked })}
            >
              <AspectLockIcon linked={Boolean(aspectLocked)} />
            </button>
          </div>
        </>
      )}
      {gridSpan && !absolute && (
        <>
          <div className="prop-pos-label al-grid-labels">
            <span>Column span</span>
            <span>Row span</span>
          </div>
          <div className="prop-slider-row prop-dims-row">
            <div className="al-dims grid-span-fields">
              <label className="al-size-field" title="Column span">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="1.5" y="2.5" width="9" height="7" rx="1" stroke="currentColor" />
                  <path d="M6 2.5v7M3.5 6h5" stroke="currentColor" strokeLinecap="round" />
                </svg>
                <input
                  value={gridSpan.columns}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value))
                    if (Number.isFinite(next) && next >= 1) onChange({ gridColumnSpan: next })
                  }}
                />
              </label>
              <label className="al-size-field" title="Row span">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="2.5" y="1.5" width="7" height="9" rx="1" stroke="currentColor" />
                  <path d="M2.5 6h7M6 3.5v5" stroke="currentColor" strokeLinecap="round" />
                </svg>
                <input
                  value={gridSpan.rows}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value))
                    if (Number.isFinite(next) && next >= 1) onChange({ gridRowSpan: next })
                  }}
                />
              </label>
            </div>
          </div>
        </>
      )}
      {spacing && (spacing.hGap != null || spacing.vGap != null) && (
        <div className="prop-field-row">
          <span className="prop-field-label">Spacing</span>
          {spacing.hGap != null && (
            <GapInput axis="x" value={spacing.hGap} onChange={(gap) => spacing.onChange('x', gap)} />
          )}
          {spacing.vGap != null && (
            <GapInput axis="y" value={spacing.vGap} onChange={(gap) => spacing.onChange('y', gap)} />
          )}
        </div>
      )}
    </section>
  )
}

function AlignIcon({ kind }: { kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' }) {
  // [guide line rect, long bar rect, short bar rect] as x, y, w, h in a 14px box.
  const shapes: Record<typeof kind, [number, number, number, number][]> = {
    left: [
      [0.5, 1, 1, 12],
      [3.5, 3.5, 10, 2],
      [3.5, 8.5, 6, 2]
    ],
    hcenter: [
      [6.5, 1, 1, 12],
      [1.5, 3.5, 11, 2],
      [3.5, 8.5, 7, 2]
    ],
    right: [
      [12.5, 1, 1, 12],
      [0.5, 3.5, 10, 2],
      [4.5, 8.5, 6, 2]
    ],
    top: [
      [1, 0.5, 12, 1],
      [3.5, 3.5, 2, 10],
      [8.5, 3.5, 2, 6]
    ],
    vcenter: [
      [1, 6.5, 12, 1],
      [3.5, 1.5, 2, 11],
      [8.5, 3.5, 2, 7]
    ],
    bottom: [
      [1, 12.5, 12, 1],
      [3.5, 0.5, 2, 10],
      [8.5, 4.5, 2, 6]
    ]
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden>
      {shapes[kind].map(([x, y, width, height], index) => (
        <rect key={index} x={x} y={y} width={width} height={height} rx={Math.min(width, height) / 2} />
      ))}
    </svg>
  )
}

function FlipIcon({ axis }: { axis: 'x' | 'y' }) {
  if (axis === 'x') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2.3v11.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path
          d="M3.6 5.3 6.2 8l-2.6 2.7ZM12.4 5.3 9.8 8l2.6 2.7Z"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.3 8h11.4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path
        d="M5.3 3.6 8 6.2l2.7-2.6ZM5.3 12.4 8 9.8l2.7 2.6Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AlignGlyph({
  justify,
  align,
  vertical
}: {
  justify: AutoLayoutJustify
  align: AutoLayoutAlign
  vertical: boolean
}) {
  const cross = align === 'end' ? 'end' : align === 'center' ? 'center' : 'start'
  const main = justify === 'end' ? 'end' : justify === 'center' || justify === 'space-between' ? 'center' : 'start'
  if (vertical) {
    const lengths = cross === 'start' ? [11, 7, 9] : cross === 'end' ? [7, 11, 9] : [8, 11, 8]
    const xOf = (len: number) => (cross === 'start' ? 1.5 : cross === 'end' ? 14 - 1.5 - len : (14 - len) / 2)
    const y0 = main === 'start' ? 1.5 : main === 'end' ? 5.5 : 3.5
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
        {lengths.map((len, i) => (
          <rect key={i} x={xOf(len)} y={y0 + i * 3.2} width={len} height="1.6" rx="0.8" fill="currentColor" />
        ))}
      </svg>
    )
  }
  const lengths = cross === 'start' ? [11, 7, 9] : cross === 'end' ? [7, 11, 9] : [8, 11, 8]
  const yOf = (len: number) => (cross === 'start' ? 1.5 : cross === 'end' ? 14 - 1.5 - len : (14 - len) / 2)
  const x0 = main === 'start' ? 1.5 : main === 'end' ? 5.5 : 3.5
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      {lengths.map((len, i) => (
        <rect key={i} x={x0 + i * 3.2} y={yOf(len)} width="1.6" height={len} rx="0.8" fill="currentColor" />
      ))}
    </svg>
  )
}

const GRID_PICK_COLS = 12
const GRID_PICK_ROWS = 8

/** Figma grid picker: "C × R" box → popover with count fields, a hover cell matrix, and a link to grid settings. */
function GridPickerBox({
  grid,
  onChange,
  onOpenSettings
}: {
  grid: GridLayout
  onChange: (grid: GridLayout) => void
  onOpenSettings?: () => void
}) {
  const boxRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<{ c: number; r: number } | null>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [colsDraft, setColsDraft] = useState(String(grid.columns))
  const rowsLabel = grid.rows === 'auto' ? 'Auto' : String(grid.rows)

  useEffect(() => setColsDraft(String(grid.columns)), [grid.columns])

  useLayoutEffect(() => {
    if (!open || !boxRef.current) return
    const rect = boxRef.current.getBoundingClientRect()
    const width = 164
    setPos({
      left: Math.max(8, Math.min(rect.left - 6, window.innerWidth - width - 8)),
      top: Math.max(8, rect.top - 44)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (popRef.current?.contains(target) || boxRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const litCols = hover ? hover.c : grid.columns
  const litRows = hover ? hover.r : grid.rows === 'auto' ? 0 : grid.rows
  const previewCols = Math.min(12, Math.max(1, grid.columns))
  const previewRows = Math.min(8, grid.rows === 'auto' ? 2 : Math.max(1, grid.rows))
  return (
    <>
      <button
        ref={boxRef}
        type="button"
        className={`al-grid-box${open ? ' is-open' : ''}`}
        title="Grid"
        onClick={() => {
          setOpen((value) => !value)
        }}
        style={
          {
            '--grid-cols': previewCols,
            '--grid-rows': previewRows
          } as CSSProperties
        }
      >
        <span className="al-grid-box-lines" aria-hidden />
        <span className="al-grid-box-label">
          {grid.columns} × {rowsLabel}
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="prop-blend-menu grid-picker-pop"
            style={{ left: pos.left, top: pos.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="grid-picker-head">
              <label className="grid-picker-field" title="Columns">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="1.5" y="2" width="3.5" height="8" rx="0.8" stroke="currentColor" />
                  <rect x="7" y="2" width="3.5" height="8" rx="0.8" stroke="currentColor" />
                </svg>
                <input
                  value={colsDraft}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => {
                    setColsDraft(event.target.value)
                    const next = Math.round(Number(event.target.value))
                    if (Number.isFinite(next) && next >= 1) onChange({ ...grid, columns: Math.min(50, next) })
                  }}
                />
              </label>
              <span className="grid-picker-times">×</span>
              <label className="grid-picker-field is-select" title="Rows">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="2" y="1.5" width="8" height="3.5" rx="0.8" stroke="currentColor" />
                  <rect x="2" y="7" width="8" height="3.5" rx="0.8" stroke="currentColor" />
                </svg>
                <select
                  value={grid.rows === 'auto' ? 'auto' : String(grid.rows)}
                  onChange={(event) => {
                    const value = event.target.value
                    onChange({ ...grid, rows: value === 'auto' ? 'auto' : Number(value) })
                  }}
                >
                  <option value="auto">Auto</option>
                  {Array.from({ length: 24 }, (_, i) => i + 1).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid-picker-matrix" onPointerLeave={() => setHover(null)}>
                {Array.from({ length: GRID_PICK_ROWS }, (_, r) =>
                  Array.from({ length: GRID_PICK_COLS }, (_, c) => {
                    const lit = c < litCols && r < litRows
                    const isTip = hover && hover.c === c + 1 && hover.r === r + 1
                    return (
                      <button
                        key={`${r}-${c}`}
                        type="button"
                        className={`grid-picker-cell${lit ? ' is-lit' : ''}${lit && !hover ? ' is-current' : ''}`}
                        onPointerEnter={() => setHover({ c: c + 1, r: r + 1 })}
                        onClick={() => {
                          onChange({ ...grid, columns: c + 1, rows: r + 1 })
                          setOpen(false)
                        }}
                      >
                        {isTip && (
                          <span className="grid-picker-tip">
                            {c + 1} × {r + 1}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
            </div>
            <button
              type="button"
              className="grid-picker-settings-btn"
              onClick={() => {
                setOpen(false)
                onOpenSettings?.()
              }}
            >
              Open grid settings
            </button>
          </div>,
          document.body
        )}
    </>
  )
}

function AutoLayoutBlock({
  layout,
  clipsContent,
  width,
  height,
  sizingH = 'fixed',
  sizingV = 'fixed',
  aspectLocked = false,
  gridColumnsGuess = 2,
  onChange,
  onEnable,
  onDims,
  onClips,
  onFit,
  onAspectLock,
  onOpenGridSettings
}: {
  onOpenGridSettings?: () => void
  layout?: AutoLayout
  gridColumnsGuess?: number
  clipsContent: boolean
  width: number
  height: number
  sizingH?: LayoutSizing
  sizingV?: LayoutSizing
  aspectLocked?: boolean
  onChange: (layout: AutoLayout) => void
  onEnable: (opts?: EnableAutoLayoutOpts) => void
  onDims: (patch: { width?: number; height?: number; layout?: AutoLayout }) => void
  onClips: (clips: boolean) => void
  onFit?: () => void
  onAspectLock?: (locked: boolean) => void
}) {
  const [padIndependent, setPadIndependent] = useState(false)
  useEffect(() => () => setSpacingHint(null), [])
  const active = Boolean(layout && layout.mode !== 'none')
  const mode = layout?.mode === 'vertical' ? 'vertical' : 'horizontal'
  const wrap = Boolean(layout?.wrap)
  const gapAuto = layout?.gap === 'auto' || layout?.justifyContent === 'space-between'
  const gap = typeof layout?.gap === 'number' ? layout.gap : 0
  const counterGap = typeof layout?.counterGap === 'number' ? layout.counterGap : gap
  const align = layout?.alignItems || 'start'
  const justify = gapAuto ? 'space-between' : layout?.justifyContent || 'start'
  const pad = typeof layout?.padding === 'number'
    ? { t: layout.padding, r: layout.padding, b: layout.padding, l: layout.padding }
    : layout?.padding || { t: 0, r: 0, b: 0, l: 0 }
  const padX = Math.round(((pad.l ?? 0) + (pad.r ?? 0)) / 2)
  const padY = Math.round(((pad.t ?? 0) + (pad.b ?? 0)) / 2)
  const showIndependent =
    padIndependent || pad.t !== pad.b || pad.l !== pad.r || pad.t !== pad.l
  const grid = active ? layout?.grid : undefined
  const flowKind: 'none' | 'horizontal' | 'vertical' | 'wrap' | 'grid' = !active
    ? 'none'
    : grid
      ? 'grid'
      : wrap
        ? 'wrap'
        : mode

  const enable = (partial: Partial<AutoLayout> = {}) => {
    const base = active ? { ...defaultFrameLayout(), ...layout } : defaultFrameLayout()
    const next = {
      ...base,
      ...partial,
      mode: (partial.mode || base.mode || 'horizontal') as AutoLayout['mode']
    }
    if (next.mode === 'none') {
      onChange({ mode: 'none' })
      return
    }
    if (partial.gap === 'auto') {
      next.gap = 'auto'
      next.justifyContent = 'space-between'
    } else if (typeof partial.gap === 'number') {
      next.gap = partial.gap
      if (next.justifyContent === 'space-between') next.justifyContent = 'start'
    }
    if (partial.justifyContent && partial.justifyContent !== 'space-between' && next.gap === 'auto') {
      next.gap = 0
    }
    if (partial.justifyContent === 'space-between') {
      next.gap = 'auto'
    }
    onChange(next)
  }

  const setFlow = (kind: 'none' | 'horizontal' | 'vertical' | 'wrap' | 'grid') => {
    if (kind === 'none') {
      onChange({ mode: 'none' })
      return
    }
    if (!active) {
      if (kind === 'horizontal') onEnable({ mode: 'horizontal', wrap: false })
      else if (kind === 'vertical') onEnable({ mode: 'vertical', wrap: false })
      else if (kind === 'wrap') onEnable({ mode: 'horizontal', wrap: true })
      else onEnable({ mode: 'horizontal', wrap: false, grid: true })
      return
    }
    if (kind === 'horizontal') enable({ mode: 'horizontal', wrap: false, grid: undefined })
    else if (kind === 'vertical') enable({ mode: 'vertical', wrap: false, grid: undefined })
    else if (kind === 'wrap') enable({ mode: 'horizontal', wrap: true, grid: undefined })
    else if (!grid) {
      enable({
        mode: 'horizontal',
        wrap: false,
        gap: gapAuto ? 0 : gap,
        justifyContent: 'start',
        counterGap: gapAuto ? 0 : gap,
        grid: { columns: mode === 'vertical' ? 1 : Math.max(1, gridColumnsGuess), rows: 'auto' }
      })
    }
  }

  const setAlign = (nextJustify: AutoLayoutJustify, nextAlign: AutoLayoutAlign) => {
    enable({ justifyContent: nextJustify, alignItems: nextAlign })
  }

  const setFrameSizing = (axis: 'h' | 'v', next: LayoutSizing) => {
    const base = active ? { ...defaultFrameLayout(), ...layout } : defaultFrameLayout()
    if (axis === 'h') onDims({ layout: { ...base, sizingH: next === 'relative' ? 'fixed' : next } })
    else onDims({ layout: { ...base, sizingV: next === 'relative' ? 'fixed' : next } })
  }

  const alignmentCell = (j: AutoLayoutJustify, a: AutoLayoutAlign) => {
    const on = justify === j && align === a
    const vertical = mode === 'vertical'
    return (
      <button
        key={`${j}-${a}`}
        type="button"
        className={on ? 'is-on' : undefined}
        title={`${j} / ${a}`}
        onClick={() => setAlign(j, a)}
      >
        {on ? <AlignGlyph justify={j} align={a} vertical={vertical} /> : <span className="al-align-dot" />}
      </button>
    )
  }

  const flowButtons = (
    <div className="al-flow" role="group" aria-label="Flow">
      <button
        type="button"
        className={flowKind === 'none' ? 'is-on' : undefined}
        title="Freeform"
        aria-pressed={flowKind === 'none'}
        onClick={() => setFlow('none')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="9.5" y="4.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="4.5" y="9.5" width="4" height="4" rx="1" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={flowKind === 'vertical' ? 'is-on' : undefined}
        title="Vertical"
        aria-pressed={flowKind === 'vertical'}
        onClick={() => setFlow('vertical')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="2.5" y="9.5" width="4" height="4" rx="1" stroke="currentColor" />
          <path d="M11 2.5v11M8.75 11.25 11 13.5l2.25-2.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className={flowKind === 'horizontal' ? 'is-on' : undefined}
        title="Horizontal"
        aria-pressed={flowKind === 'horizontal'}
        onClick={() => setFlow('horizontal')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="9.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <path d="M2.5 11h11M11.25 8.75 13.5 11l-2.25 2.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className={flowKind === 'wrap' || flowKind === 'grid' ? 'is-on' : undefined}
        title="Grid"
        aria-pressed={flowKind === 'wrap' || flowKind === 'grid'}
        onClick={() => setFlow('grid')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="9.5" y="2.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="2.5" y="9.5" width="4" height="4" rx="1" stroke="currentColor" />
          <rect x="9.5" y="9.5" width="4" height="4" rx="1" stroke="currentColor" />
        </svg>
      </button>
    </div>
  )

  const ratio = width > 0 && height > 0 ? height / width : 1

  const head = (
    <div {...headToggle(active ? () => onChange({ mode: 'none' }) : () => onEnable())}>
      <span>{active ? 'Flex' : 'Layout'}</span>
      <div className="prop-section-actions">
        <button
          type="button"
          className="prop-head-ico is-strong"
          title="Resize to fit"
          disabled={!onFit}
          onClick={() => onFit?.()}
        >
          <FitContentIcon />
        </button>
        <button
          type="button"
          className="prop-head-ico is-strong"
          title={active ? 'Remove flex' : 'Add flex'}
          onClick={() => (active ? onChange({ mode: 'none' }) : onEnable())}
        >
          <AutoLayoutIcon remove={active} />
        </button>
      </div>
    </div>
  )

  const flowRow = (
    <>
      <div className="prop-pos-label">Flow</div>
      <div className="prop-slider-row">{flowButtons}</div>
    </>
  )

  const clipRow = (
    <label className="al-clip">
      <input type="checkbox" checked={clipsContent} onChange={(event) => onClips(event.target.checked)} />
      <span className="al-check" aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2 4.9 8.6 9.5 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Clip content
    </label>
  )

  const dimsRow = (
    <>
    <div className="prop-pos-label">Dimensions</div>
    <div className="prop-slider-row">
      <LinkedDims linked={aspectLocked} className="al-dims">
        <label className="al-size-field" title="Width">
          <span>W</span>
          <input
            value={Math.round(width)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) {
                onDims({
                  width: Math.max(1, next),
                  ...(aspectLocked ? { height: Math.max(1, Math.round(Math.max(1, next) * ratio)) } : {}),
                  ...(active
                    ? { layout: { ...defaultFrameLayout(), ...layout!, sizingH: 'fixed' } }
                    : {})
                })
              }
            }}
          />
          {active && (
            <select
              aria-label="Horizontal sizing"
              value={sizingH === 'hug' ? 'hug' : sizingH === 'fill' ? 'fill' : 'fixed'}
              onChange={(event) => setFrameSizing('h', event.target.value as LayoutSizing)}
            >
              <option value="fixed">Fixed</option>
              <option value="hug">Hug</option>
              <option value="fill">Fill</option>
            </select>
          )}
        </label>
        <label className="al-size-field" title="Height">
          <span>H</span>
          <input
            value={Math.round(height)}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) {
                onDims({
                  height: Math.max(1, next),
                  ...(aspectLocked ? { width: Math.max(1, Math.round(Math.max(1, next) / ratio)) } : {}),
                  ...(active
                    ? { layout: { ...defaultFrameLayout(), ...layout!, sizingV: 'fixed' } }
                    : {})
                })
              }
            }}
          />
          {active && (
            <select
              aria-label="Vertical sizing"
              value={sizingV === 'hug' ? 'hug' : sizingV === 'fill' ? 'fill' : 'fixed'}
              onChange={(event) => setFrameSizing('v', event.target.value as LayoutSizing)}
            >
              <option value="fixed">Fixed</option>
              <option value="hug">Hug</option>
              <option value="fill">Fill</option>
            </select>
          )}
        </label>
      </LinkedDims>
      <button
        type="button"
        className={`prop-trail-ico prop-link-btn${aspectLocked ? ' is-on' : ''}`}
        title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        aria-pressed={aspectLocked}
        disabled={!onAspectLock}
        onClick={() => onAspectLock?.(!aspectLocked)}
      >
        <AspectLockIcon linked={aspectLocked} />
      </button>
    </div>
    </>
  )

  if (!active) {
    return (
      <section className="prop-section al-section">
        {head}
        {flowRow}
        {dimsRow}
        {clipRow}
      </section>
    )
  }

  return (
    <section className="prop-section al-section">
      {head}
      {flowRow}
      {dimsRow}

      {grid ? (
        <>
          <div className="prop-pos-label al-grid-labels">
            <span>Grid</span>
            <span>Gap</span>
          </div>
          <div className="al-row al-align-row">
            <div className="al-align-gap is-grid">
              <GridPickerBox
                grid={grid}
                onChange={(nextGrid) => enable({ grid: nextGrid })}
                onOpenSettings={onOpenGridSettings}
              />
              <div className="al-gap-stack">
                <label className="al-gap-field" title="Column gap" {...spacingHintProps({ kind: 'gap' })}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 2v8M10 2v8M4.5 6h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <input
                    value={gap}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next)) enable({ gap: Math.max(0, next), justifyContent: 'start' })
                    }}
                  />
                </label>
                <label className="al-gap-field" title="Row gap" {...spacingHintProps({ kind: 'gap' })}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                    <path d="M2 2h8M2 10h8M6 4.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <input
                    value={counterGap}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      if (Number.isFinite(next)) enable({ counterGap: Math.max(0, next) })
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        </>
      ) : (
      <>
      <div className="prop-pos-label">Alignment</div>
      <div className="al-row al-align-row">
        <div className="al-align-gap">
          <div className="al-align-box" aria-label="Alignment">
            {alignmentCell('start', 'start')}
            {alignmentCell('center', 'start')}
            {alignmentCell('end', 'start')}
            {alignmentCell('start', 'center')}
            {alignmentCell('center', 'center')}
            {alignmentCell('end', 'center')}
            {alignmentCell('start', 'end')}
            {alignmentCell('center', 'end')}
            {alignmentCell('end', 'end')}
          </div>
          <div className="al-gap-stack">
            <label className="al-gap-field" title="Gap between items" {...spacingHintProps({ kind: 'gap' })}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M2 3h8M2 9h8M4 3v6M8 3v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <input
                value={gapAuto ? 'Auto' : gap}
                onFocus={(event) => {
                  if (gapAuto) event.currentTarget.select()
                }}
                onChange={(event) => {
                  const raw = event.target.value.trim().toLowerCase()
                  if (raw === 'auto' || raw === 'a') {
                    enable({ gap: 'auto', justifyContent: 'space-between' })
                    return
                  }
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) enable({ gap: Math.max(0, next), justifyContent: 'start' })
                }}
              />
            </label>
            {wrap && (
              <label className="al-gap-field" title="Counter-axis gap" {...spacingHintProps({ kind: 'gap' })}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M3 2v8M9 2v8M3 4h6M3 8h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input
                  value={counterGap}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    if (Number.isFinite(next)) enable({ counterGap: Math.max(0, next) })
                  }}
                />
              </label>
            )}
          </div>
        </div>
      </div>
      </>
      )}

      <div className="prop-pos-label">Padding</div>
      <div className="al-row">
        <div className="al-padding-wrap">
          {showIndependent ? (
            <div className="al-padding al-padding-4">
              <div className="al-pad-hint" {...spacingHintProps({ kind: 'pad', sides: ['t'] })}>
                <NumField prefix="T" value={pad.t} onChange={(t) => enable({ padding: { ...pad, t } })} />
              </div>
              <div className="al-pad-hint" {...spacingHintProps({ kind: 'pad', sides: ['r'] })}>
                <NumField prefix="R" value={pad.r} onChange={(r) => enable({ padding: { ...pad, r } })} />
              </div>
              <div className="al-pad-hint" {...spacingHintProps({ kind: 'pad', sides: ['b'] })}>
                <NumField prefix="B" value={pad.b} onChange={(b) => enable({ padding: { ...pad, b } })} />
              </div>
              <div className="al-pad-hint" {...spacingHintProps({ kind: 'pad', sides: ['l'] })}>
                <NumField prefix="L" value={pad.l} onChange={(l) => enable({ padding: { ...pad, l } })} />
              </div>
            </div>
          ) : (
            <div className="al-padding">
              <label className="al-pad-field" title="Horizontal padding" {...spacingHintProps({ kind: 'pad', sides: ['l', 'r'] })}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="1.5" y="3" width="9" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 3v6M8 3v6" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <input
                  value={padX}
                  onChange={(event) => {
                    const next = Math.max(0, Number(event.target.value) || 0)
                    enable({ padding: { t: pad.t, b: pad.b, l: next, r: next } })
                  }}
                />
              </label>
              <label className="al-pad-field" title="Vertical padding" {...spacingHintProps({ kind: 'pad', sides: ['t', 'b'] })}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <rect x="3" y="1.5" width="6" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M3 4h6M3 8h6" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                <input
                  value={padY}
                  onChange={(event) => {
                    const next = Math.max(0, Number(event.target.value) || 0)
                    enable({ padding: { l: pad.l, r: pad.r, t: next, b: next } })
                  }}
                />
              </label>
            </div>
          )}
          <button
            type="button"
            className={`prop-trail-ico${showIndependent ? ' is-on' : ''}`}
            title="Independent padding"
            onClick={() => setPadIndependent((value) => !value)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            </svg>
          </button>
        </div>
      </div>

      {clipRow}
    </section>
  )
}

function FitContentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 3l3.5 3.5M6.5 3.9v2.6H3.9M13 3 9.5 6.5M9.5 3.9v2.6h2.6M3 13l3.5-3.5M6.5 12.1V9.5H3.9M13 13 9.5 9.5M9.5 12.1V9.5h2.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function AutoLayoutIcon({ remove = false }: { remove?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2" width="4.5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.5" y="2" width="4" height="4" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d={remove ? 'M9.25 11h4.5' : 'M11.5 8.5v5M9 11h5'}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function AspectLockIcon({ linked = false }: { linked?: boolean }) {
  return (
    <svg className="aspect-lock-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 7.5v-2h2M10.5 8.5v2h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path
        className={`aspect-lock-link${linked ? ' is-on' : ''}`}
        d="M6.3 6.3l3.4 3.4"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeDasharray="0.1 1.6"
      />
    </svg>
  )
}

/** W/H pair whose backgrounds merge through a gooey bridge while the aspect ratio is locked. */
function LinkedDims({ linked, className = '', children }: { linked: boolean; className?: string; children: ReactNode }) {
  const filterId = `dims-goo-${useId().replace(/:/g, '')}`
  return (
    <div className={`dims-link${linked ? ' is-linked' : ''}${className ? ` ${className}` : ''}`}>
      <svg className="dims-link-defs" width="0" height="0" aria-hidden>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" />
        </filter>
      </svg>
      <div className="dims-link-goo" style={{ filter: `url(#${filterId})` }} aria-hidden>
        <span />
        <span className="dims-link-bridge" />
        <span />
      </div>
      {children}
    </div>
  )
}

function CornerIcon({ corner }: { corner: keyof CornerRadii }) {
  const paths: Record<keyof CornerRadii, string> = {
    tl: 'M3 9V5.5A2.5 2.5 0 0 1 5.5 3H9',
    tr: 'M3 3h3.5A2.5 2.5 0 0 1 9 5.5V9',
    br: 'M9 3v3.5A2.5 2.5 0 0 1 6.5 9H3',
    bl: 'M9 9H5.5A2.5 2.5 0 0 1 3 6.5V3'
  }
  return (
    <span className="prop-radius-ico" aria-hidden>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d={paths[corner]} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function AppearanceBlock({
  nodeId,
  opacity,
  blend,
  radii,
  radiusMax,
  visible = true,
  onOpacity,
  onBlend,
  onVisible,
  onRadii
}: {
  nodeId?: string
  opacity: number
  blend: string
  radii?: CornerRadii
  radiusMax?: number
  visible?: boolean
  onOpacity: (value: number) => void
  onBlend: (value: string) => void
  onVisible?: (visible: boolean) => void
  onRadii?: (value: CornerRadii, mode: 'uniform' | 'independent') => void
}) {
  const [open, setOpen] = useState(false)
  const [independent, setIndependent] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const current = normalizeBlendMode(blend)
  const showIndependent = Boolean(radii && (independent || cornersAreIndependent(radii)))

  useEffect(() => {
    setIndependent(Boolean(radii && cornersAreIndependent(radii)))
  }, [nodeId])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setUniform = (value: number) => {
    onRadii?.(uniformRadii(Math.max(0, value)), 'uniform')
  }

  const setCorner = (key: keyof CornerRadii, value: number) => {
    if (!radii) return
    onRadii?.({ ...radii, [key]: Math.max(0, value) }, 'independent')
  }

  const toggleIndependent = () => {
    if (!radii || !onRadii) return
    if (showIndependent) {
      setIndependent(false)
      onRadii(uniformRadii(radii.tl), 'uniform')
    } else {
      setIndependent(true)
      onRadii({ ...radii }, 'independent')
    }
  }

  return (
    <section className="prop-section prop-section-appearance">
      <div className="prop-section-head">Appearance</div>
      <div className="prop-pos-label">Opacity</div>
      <div className="prop-slider-row">
        <SliderField
          icon={<OpacityIcon />}
          value={Math.round(opacity)}
          unit="%"
          max={100}
          onChange={(next) => onOpacity(Math.max(0, Math.min(100, next)))}
        />
        <button
          type="button"
          className="prop-trail-ico"
          title={visible ? 'Hide' : 'Show'}
          aria-pressed={!visible}
          disabled={!onVisible}
          onClick={() => onVisible?.(!visible)}
        >
          <EyeIcon off={!visible} />
        </button>
      </div>
      {onRadii != null && radii && (
        <>
          <div className="prop-pos-label">Corner radius</div>
          <div className="prop-slider-row">
            {showIndependent ? (
              <div className="prop-radius-grid">
                <NumField prefix={<CornerIcon corner="tl" />} value={radii.tl} onChange={(v) => setCorner('tl', v)} />
                <NumField prefix={<CornerIcon corner="tr" />} value={radii.tr} onChange={(v) => setCorner('tr', v)} />
                <NumField prefix={<CornerIcon corner="bl" />} value={radii.bl} onChange={(v) => setCorner('bl', v)} />
                <NumField prefix={<CornerIcon corner="br" />} value={radii.br} onChange={(v) => setCorner('br', v)} />
              </div>
            ) : (
              <SliderField
                icon={<CornersIcon muted />}
                value={radii.tl}
                max={Math.max(1, radiusMax ?? 100)}
                onChange={setUniform}
              />
            )}
            <button
              type="button"
              className={`prop-trail-ico${showIndependent ? ' is-on' : ''}`}
              title="Independent corners"
              aria-pressed={showIndependent}
              onClick={toggleIndependent}
            >
              <CornersIcon />
            </button>
          </div>
        </>
      )}
      <div className="prop-pos-label">Blend mode</div>
      <div className="prop-slider-row">
        <div className="prop-blend-select" ref={root}>
          <button
            type="button"
            className="prop-blend-trigger"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 2.2C8 2.2 3.8 7 3.8 9.9a4.2 4.2 0 0 0 8.4 0C12.2 7 8 2.2 8 2.2Z"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinejoin="round"
              />
            </svg>
            <span>{current}</span>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M2 3.2 4 5.2 6 3.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open && (
            <div className="prop-blend-menu" role="listbox" aria-label="Blend mode">
              {BLEND_MODE_GROUPS.map((group, index) => (
                <div key={index} className="prop-blend-group">
                  {group.modes.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="option"
                      aria-selected={current === mode}
                      className={current === mode ? 'is-on' : undefined}
                      onClick={() => {
                        onBlend(mode)
                        setOpen(false)
                      }}
                    >
                      <span className="prop-blend-check" aria-hidden>
                        {current === mode ? '✓' : ''}
                      </span>
                      <span>{mode}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function OpacityIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="0.75" y="0.75" width="10.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <g fill="currentColor">
        <rect x="8" y="3" width="1" height="1" />
        <rect x="6" y="5" width="1" height="1" />
        <rect x="8" y="5" width="1" height="1" />
        <rect x="4" y="7" width="1" height="1" />
        <rect x="6" y="7" width="1" height="1" />
        <rect x="8" y="7" width="1" height="1" />
        <rect x="2.5" y="8.5" width="1" height="1" />
        <rect x="4" y="8.5" width="1" height="1" />
        <rect x="6" y="8.5" width="1" height="1" />
        <rect x="8" y="8.5" width="1" height="1" />
      </g>
    </svg>
  )
}

function CornersIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={muted ? 'is-muted' : undefined}
    >
      <path
        d="M1 3.5V2a1 1 0 0 1 1-1h1.5M8.5 1H10a1 1 0 0 1 1 1v1.5M11 8.5V10a1 1 0 0 1-1 1H8.5M3.5 11H2a1 1 0 0 1-1-1V8.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.1" />
      {off ? <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /> : null}
    </svg>
  )
}

/** Click anywhere on an add-section header (outside its own controls) to expand or collapse it. */
function headToggle(onToggle: () => void) {
  return {
    className: 'prop-section-head prop-add-head is-toggle',
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      if ((event.target as HTMLElement).closest('button, input, select, a')) return
      onToggle()
    }
  }
}

function FillBlock({
  paints,
  fallbackHex,
  colorSource = [],
  onChange
}: {
  paints: Paint[]
  fallbackHex: string
  colorSource?: DesignNode[]
  onChange: (paints: Paint[]) => void
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const list = paints

  // The swatches can show the whole page or any one top-level frame (Figma's "On this page" menu).
  const colorSets = useMemo<ColorSet[]>(() => {
    if (openIndex == null) return []
    const collect = (nodes: DesignNode[]) => {
      const out: ColorSet['colors'] = []
      const seen = new Set<string>()
      const push = (color: string, opacity: number) => {
        const hex = toHex(color, '')
        if (!hex) return
        const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100
        const key = `${hex}:${alpha}`
        if (seen.has(key)) return
        seen.add(key)
        out.push({ color: hex, opacity: alpha })
      }
      for (const item of nodes) {
        for (const paint of getNodePaints(item)) {
          if (paint.visible === false) continue
          if (paint.type === 'solid') push(paint.color, paint.opacity)
          else if (paint.type === 'gradient') for (const stop of paint.stops) push(stop.color, stop.opacity)
        }
        if (item.strokeWidth && item.stroke) push(item.stroke, item.strokeOpacity ?? 1)
        if (out.length >= 72) break
      }
      return out
    }
    const ids = new Set(colorSource.map((item) => item.id))
    const children = new Map<string, DesignNode[]>()
    for (const item of colorSource) {
      if (!item.parentId) continue
      const list = children.get(item.parentId)
      if (list) list.push(item)
      else children.set(item.parentId, [item])
    }
    const subtree = (root: DesignNode) => {
      const out: DesignNode[] = []
      const stack = [root]
      while (stack.length) {
        const node = stack.pop()!
        out.push(node)
        stack.push(...(children.get(node.id) || []))
      }
      return out
    }
    const frames = colorSource.filter(
      (item) => (item.type === 'frame' || item.type === 'section') && (!item.parentId || !ids.has(item.parentId))
    )
    return [
      { id: 'page', label: 'On this page', colors: collect(colorSource) },
      ...frames.map((frame) => ({
        id: frame.id,
        label: frame.name || (frame.type === 'section' ? 'Section' : 'Frame'),
        detail: `${Math.round(frame.width || 0)}×${Math.round(frame.height || 0)}`,
        colors: collect(subtree(frame))
      }))
    ]
  }, [openIndex, colorSource])

  const patchAt = (index: number, paint: Paint) => {
    const next = [...list]
    next[index] = paint
    onChange(next)
  }

  const removeAt = (index: number) => {
    onChange(list.filter((_, i) => i !== index))
    setOpenIndex(null)
  }

  const addFill = () => {
    setCollapsed(false)
    onChange([...list, defaultSolid(fallbackHex || '#D9D9D9')])
  }

  return (
    <section className="prop-section prop-section-fill">
      <div
        {...headToggle(() => {
          if (!list.length) return addFill()
          setCollapsed((value) => !value)
          setOpenIndex(null)
        })}
      >
        <span>Fill</span>
        <div className="prop-section-actions">
          <button type="button" className="prop-head-ico is-strong" title="Fill styles" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="4.75" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="4.75" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
          <button type="button" className="prop-head-ico is-strong" onClick={addFill} title="Add fill">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          {list.length > 0 && (
            <button
              type="button"
              className="prop-head-ico is-strong prop-head-caret"
              title={collapsed ? 'Show fills' : 'Hide fills'}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed((value) => !value)
                setOpenIndex(null)
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                <path
                  d={collapsed ? 'M3 1.5 5.5 4 3 6.5' : 'M1.5 3 4 5.5 6.5 3'}
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {list.length > 0 && !collapsed && (
        <div className="prop-fill-stack">
          {list.map((paint, index) => {
            const visible = paint.visible !== false
            const open = openIndex === index
            return (
              <div
                key={index}
                className={`prop-fill-item${visible ? '' : ' is-hidden'}`}
                ref={(el) => {
                  rowRefs.current[index] = el
                }}
              >
                <button
                  type="button"
                  className={`prop-fill-main${open ? ' is-open' : ''}`}
                  title="Edit fill"
                  onClick={() => setOpenIndex(open ? null : index)}
                >
                  <span className="prop-fill-chip">
                    <span style={{ background: paintPreviewCss(paint) }} />
                  </span>
                  <span className="prop-fill-text">
                    <span className="prop-fill-name">{paintLabel(paint)}</span>
                    <span className="prop-fill-meta">
                      {Math.round(paint.opacity * 100)}% · {paintKindLabel(paint)}
                    </span>
                  </span>
                </button>
                <button type="button" className="prop-trail-ico" title="Remove fill" onClick={() => removeAt(index)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
                {open && (
                  <FillPicker
                    paint={paint}
                    colorSets={colorSets}
                    anchor={rowRefs.current[index]?.getBoundingClientRect() || null}
                    onChange={(next) => patchAt(index, next)}
                    onClose={() => setOpenIndex(null)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function paintKindLabel(paint: Paint): string {
  if (paint.type === 'solid') return 'Solid'
  if (paint.type === 'gradient') return 'Gradient'
  if (paint.type === 'image') return 'Image'
  if (paint.type === 'video') return 'Video'
  return 'Shader'
}

function PageFillRow({
  hex,
  hidden,
  onHex,
  onToggleHidden
}: {
  hex: string
  hidden: boolean
  onHex: (value: string) => void
  onToggleHidden: () => void
}) {
  const [open, setOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  return (
    <div className="prop-fill-stack">
      <div className={`prop-fill-item${hidden ? ' is-hidden' : ''}`} ref={rowRef}>
        <button
          type="button"
          className={`prop-fill-main${open ? ' is-open' : ''}`}
          title="Edit page color"
          onClick={() => setOpen(!open)}
        >
          <span className="prop-fill-chip">
            <span style={{ background: hex }} />
          </span>
          <span className="prop-fill-text">
            <span className="prop-fill-name">{hex.replace('#', '').toUpperCase()}</span>
            <span className="prop-fill-meta">100% · Solid</span>
          </span>
        </button>
        <button
          type="button"
          className="prop-trail-ico"
          title={hidden ? 'Show page color' : 'Hide page color'}
          aria-label={hidden ? 'Show page color' : 'Hide page color'}
          aria-pressed={hidden}
          onClick={onToggleHidden}
        >
          <EyeIcon off={hidden} />
        </button>
        {open && (
          <FillPicker
            paint={defaultSolid(hex, 1)}
            solidOnly
            opaque
            anchor={rowRef.current?.getBoundingClientRect() || null}
            onChange={(next) => {
              if (next.type !== 'solid') return
              const nextHex = toHex(next.color, hex)
              if (nextHex !== hex) onHex(nextHex)
            }}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

type StrokeAlign = 'center' | 'inside' | 'outside'
type StrokeJoin = 'miter' | 'round' | 'bevel'
type StrokeCap = 'none' | 'square' | 'round'

function StrokeBlock({
  enabled,
  hex,
  width,
  opacity = 100,
  align = 'inside',
  showAlign = true,
  join = 'miter',
  cap = 'none',
  profile = 'uniform',
  profileFlip = false,
  dash = 0,
  gap,
  onToggle,
  onHex,
  onWidth,
  onOpacity,
  onAlign,
  onJoin,
  onCap,
  onProfile,
  onProfileFlip,
  onDash,
  brush,
  maxWidth = 20
}: {
  /** Brush style for pencil / brush drawings. */
  brush?: { value: BrushStyleId; onChange: (value: BrushStyleId) => void }
  enabled: boolean
  hex: string
  width: number
  /** Upper end of the weight slider; typed values can still exceed it. */
  maxWidth?: number
  opacity?: number
  align?: StrokeAlign
  showAlign?: boolean
  join?: StrokeJoin
  cap?: StrokeCap
  profile?: StrokeProfile
  profileFlip?: boolean
  dash?: number
  gap?: number
  onToggle: () => void
  onHex: (value: string) => void
  onWidth: (value: number) => void
  onOpacity?: (value: number) => void
  onAlign: (value: StrokeAlign) => void
  onJoin?: (value: StrokeJoin) => void
  onCap?: (value: StrokeCap) => void
  onProfile?: (value: StrokeProfile) => void
  onProfileFlip?: () => void
  onDash?: (next: { dash: number; gap?: number }) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [profileAnchor, setProfileAnchor] = useState<HTMLElement | null>(null)
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null)
  const [brushAnchor, setBrushAnchor] = useState<HTMLElement | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const expanded = enabled && !collapsed

  const add = () => {
    setCollapsed(false)
    onToggle()
  }

  return (
    <section className="prop-section prop-section-stroke">
      <div
        {...headToggle(() => {
          if (!enabled) return add()
          setCollapsed((value) => !value)
          setPickerOpen(false)
        })}
      >
        <span>Stroke</span>
        <div className="prop-section-actions">
          <button type="button" className="prop-head-ico is-strong" title="Stroke styles" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="4.75" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="4.75" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
          <button
            type="button"
            className="prop-head-ico is-strong"
            title={enabled ? 'Stroke added' : 'Add stroke'}
            disabled={enabled}
            onClick={add}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          {enabled && (
            <button
              type="button"
              className="prop-head-ico is-strong prop-head-caret"
              title={collapsed ? 'Show stroke' : 'Hide stroke'}
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed((value) => !value)
                setPickerOpen(false)
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                <path
                  d={collapsed ? 'M3 1.5 5.5 4 3 6.5' : 'M1.5 3 4 5.5 6.5 3'}
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <>
          <div className="prop-fill-stack">
            <div className="prop-fill-item" ref={rowRef}>
              <button
                type="button"
                className={`prop-fill-main${pickerOpen ? ' is-open' : ''}`}
                title="Edit stroke color"
                onClick={() => setPickerOpen((value) => !value)}
              >
                <span className="prop-fill-chip">
                  <span style={{ background: withAlpha(hex, opacity / 100) }} />
                </span>
                <span className="prop-fill-text">
                  <span className="prop-fill-name">{hex.replace('#', '').toUpperCase()}</span>
                  <span className="prop-fill-meta">{Math.round(opacity)}% · Solid</span>
                </span>
              </button>
              <button type="button" className="prop-trail-ico" title="Remove stroke" onClick={onToggle}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
              {pickerOpen && (
                <FillPicker
                  paint={defaultSolid(hex, opacity / 100)}
                  solidOnly
                  anchor={rowRef.current?.getBoundingClientRect() || null}
                  onChange={(next) => {
                    if (next.type !== 'solid') return
                    const nextHex = toHex(next.color, hex)
                    if (nextHex !== toHex(hex, nextHex)) onHex(nextHex)
                    const nextOpacity = Math.round(next.opacity * 100)
                    if (onOpacity && nextOpacity !== Math.round(opacity)) onOpacity(nextOpacity)
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
          </div>

          {brush && (
            <>
              <div className="prop-pos-label">Brush</div>
              <div className="prop-slider-row">
                <button
                  type="button"
                  className={`prop-stroke-brush${brushAnchor ? ' is-open' : ''}`}
                  aria-haspopup="listbox"
                  aria-expanded={Boolean(brushAnchor)}
                  onClick={(event) => {
                    const anchor = event.currentTarget
                    setBrushAnchor((current) => (current ? null : anchor))
                  }}
                >
                  <span className="prop-stroke-brush-name">{brushById(brush.value).name}</span>
                  <InspectorBrushPreview style={brush.value} />
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                    <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {brushAnchor && (
                <StrokeBrushMenu
                  anchor={brushAnchor}
                  value={brush.value}
                  onPick={brush.onChange}
                  onClose={() => setBrushAnchor(null)}
                />
              )}
            </>
          )}
          <div className="prop-pos-label">Weight</div>
          <div className="prop-slider-row">
            <SliderField
              icon={<StrokeWeightIcon />}
              value={width}
              max={Math.max(maxWidth, Math.ceil(width))}
              onChange={(next) => onWidth(Math.max(0.1, next))}
            />
            <button type="button" className="prop-trail-ico" title="Individual strokes (coming soon)" disabled>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
                <rect x="5" y="5" width="6" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          </div>

          <div className="prop-stroke-grid">
            <div className="prop-pos-label">Position</div>
            <div className="prop-pos-label">Join</div>
          </div>
          <div className="prop-stroke-grid">
            <div className="prop-toggle" role="group" aria-label="Stroke position">
              {(['center', 'inside', 'outside'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  title={value.charAt(0).toUpperCase() + value.slice(1)}
                  aria-pressed={align === value}
                  className={align === value ? 'is-on' : undefined}
                  disabled={!showAlign}
                  onClick={() => onAlign(value)}
                >
                  <StrokeAlignIcon align={value} />
                </button>
              ))}
            </div>
            <div className="prop-toggle" role="group" aria-label="Stroke join">
              {(['miter', 'round', 'bevel'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  title={onJoin ? value.charAt(0).toUpperCase() + value.slice(1) : 'Join applies to the Basic brush'}
                  aria-pressed={join === value}
                  className={join === value ? 'is-on' : undefined}
                  disabled={!onJoin}
                  onClick={() => onJoin?.(value)}
                >
                  <StrokeJoinIcon join={value} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`prop-trail-ico${settingsAnchor ? ' is-on' : ''}`}
              title="Advanced stroke settings"
              disabled={!onDash}
              aria-expanded={Boolean(settingsAnchor)}
              onClick={(event) => {
                const anchor = event.currentTarget
                setSettingsAnchor((current) => (current ? null : anchor))
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M5 2.5v11M11 2.5v11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                <circle cx="5" cy="10" r="1.75" fill="var(--sidebar)" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="11" cy="6" r="1.75" fill="var(--sidebar)" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          </div>

          <div className="prop-stroke-grid">
            <div className="prop-pos-label">End points</div>
            <div className="prop-pos-label">Width profile</div>
          </div>
          <div className="prop-stroke-grid">
            <div className="prop-toggle" role="group" aria-label="End points">
              {(['none', 'square', 'round'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  title={value === 'none' ? 'None' : value.charAt(0).toUpperCase() + value.slice(1)}
                  aria-pressed={cap === value}
                  className={cap === value ? 'is-on' : undefined}
                  disabled={!onCap}
                  onClick={() => onCap?.(value)}
                >
                  <StrokeCapIcon cap={value} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`prop-stroke-profile${profileAnchor ? ' is-open' : ''}`}
              title={`Width profile: ${STROKE_PROFILES.find((item) => item.id === profile)?.name || 'Uniform'}`}
              disabled={!onProfile}
              aria-haspopup="listbox"
              aria-expanded={Boolean(profileAnchor)}
              onClick={(event) => {
                const anchor = event.currentTarget
                setProfileAnchor((current) => (current ? null : anchor))
              }}
            >
              <ProfilePreview profile={profile} flip={profileFlip} />
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
                <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className={`prop-trail-ico${profileFlip && profile !== 'uniform' ? ' is-on' : ''}`}
              title="Flip width profile"
              disabled={!onProfileFlip || profile === 'uniform'}
              aria-pressed={profileFlip}
              onClick={onProfileFlip}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                <path d="M5.5 5v6L2.5 8l3-3ZM10.5 5v6l3-3-3-3Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {profileAnchor && onProfile && (
            <StrokeProfileMenu
              anchor={profileAnchor}
              value={profile}
              flip={profileFlip}
              onPick={onProfile}
              onClose={() => setProfileAnchor(null)}
            />
          )}
          {settingsAnchor && onDash && (
            <StrokeSettingsPopover
              anchor={settingsAnchor}
              dash={dash}
              gap={gap}
              dashable={profile === 'uniform'}
              join={join}
              onJoin={onJoin}
              onDash={onDash}
              onClose={() => setSettingsAnchor(null)}
            />
          )}
        </>
      )}
    </section>
  )
}

function ProfilePreview({ profile, flip }: { profile: StrokeProfile; flip: boolean }) {
  const d = profileOutline(
    [
      { x: 3, y: 5 },
      { x: 97, y: 5 }
    ],
    false,
    5,
    profile,
    flip,
    'round'
  )
  return (
    <svg className="prop-stroke-profile-shape" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden>
      {profile === 'uniform' ? (
        <path d="M3 5H97" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <path d={d} fill="currentColor" />
      )}
    </svg>
  )
}

function usePopoverDismiss(
  ref: RefObject<HTMLElement | null>,
  anchor: HTMLElement,
  onClose: () => void
) {
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [ref, anchor, onClose])
}

function usePopoverPosition(ref: RefObject<HTMLElement | null>, anchor: HTMLElement, align: 'left' | 'right') {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = anchor.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const below = box.bottom + 6
    const top = below + height > window.innerHeight - 8 ? Math.max(8, box.top - height - 6) : below
    const preferred = align === 'right' ? box.right - width : box.left
    setPos({ top, left: Math.max(8, Math.min(window.innerWidth - width - 8, preferred)) })
  }, [ref, anchor, align])
  return pos
}

function StrokeProfileMenu({
  anchor,
  value,
  flip,
  onPick,
  onClose
}: {
  anchor: HTMLElement
  value: StrokeProfile
  flip: boolean
  onPick: (value: StrokeProfile) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  usePopoverDismiss(ref, anchor, onClose)
  const pos = usePopoverPosition(ref, anchor, 'right')
  return createPortal(
    <div
      ref={ref}
      className="prop-blend-menu prop-stroke-profile-menu"
      role="listbox"
      aria-label="Width profile"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {STROKE_PROFILES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          title={item.name}
          aria-selected={item.id === value}
          className={item.id === value ? 'is-on' : undefined}
          onClick={() => {
            onPick(item.id)
            onClose()
          }}
        >
          <span className="prop-blend-check" aria-hidden>
            {item.id === value ? '✓' : ''}
          </span>
          <ProfilePreview profile={item.id} flip={flip} />
        </button>
      ))}
    </div>,
    document.body
  )
}

function InspectorBrushPreview({ style }: { style: BrushStyleId }) {
  const fills = brushPreviewD(style, style === 'basic' ? 5 : 9)
  return (
    <svg className="prop-stroke-brush-preview" viewBox="0 0 108 28" aria-hidden>
      {fills.map((d, index) => (
        <path key={index} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

function StrokeBrushMenu({
  anchor,
  value,
  onPick,
  onClose
}: {
  anchor: HTMLElement
  value: BrushStyleId
  onPick: (value: BrushStyleId) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  usePopoverDismiss(ref, anchor, onClose)
  const pos = usePopoverPosition(ref, anchor, 'right')
  const styles = [{ id: 'basic' as const, name: 'Basic' }, ...STRETCH_BRUSHES]
  return createPortal(
    <div
      ref={ref}
      className="prop-blend-menu prop-stroke-brush-menu"
      role="listbox"
      aria-label="Brush"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      {styles.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={item.id === value}
          className={item.id === value ? 'is-on' : undefined}
          onClick={() => {
            onPick(item.id)
            onClose()
          }}
        >
          <span className="prop-blend-check" aria-hidden>
            {item.id === value ? '✓' : ''}
          </span>
          <span className="prop-stroke-brush-name">{item.name}</span>
          <InspectorBrushPreview style={item.id} />
        </button>
      ))}
    </div>,
    document.body
  )
}

function StrokeSettingsPopover({
  anchor,
  dash,
  gap,
  dashable,
  join,
  onJoin,
  onDash,
  onClose
}: {
  anchor: HTMLElement
  dash: number
  gap?: number
  dashable: boolean
  join: StrokeJoin
  onJoin?: (value: StrokeJoin) => void
  onDash: (next: { dash: number; gap?: number }) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  usePopoverDismiss(ref, anchor, onClose)
  const pos = usePopoverPosition(ref, anchor, 'right')
  const dashed = dash > 0
  const numberInput = (value: number, onValue: (next: number) => void) => (
    <input
      className="prop-export-settings-input"
      value={value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = Number(event.target.value.trim())
        if (Number.isFinite(next)) onValue(Math.max(0, Math.min(999, next)))
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') onClose()
      }}
    />
  )
  return createPortal(
    <div
      ref={ref}
      className="prop-blend-menu prop-export-settings prop-stroke-settings"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <div className="prop-export-settings-title">Stroke settings</div>
      <div className="prop-export-settings-row">
        <span>Style</span>
        <div className="prop-toggle prop-stroke-style" role="group" aria-label="Stroke style">
          <button
            type="button"
            className={!dashed ? 'is-on' : undefined}
            aria-pressed={!dashed}
            onClick={() => onDash({ dash: 0 })}
          >
            Solid
          </button>
          <button
            type="button"
            className={dashed ? 'is-on' : undefined}
            aria-pressed={dashed}
            disabled={!dashable}
            title={dashable ? undefined : 'Dashes need a uniform width profile'}
            onClick={() => onDash({ dash: dash || 4, gap: gap ?? 4 })}
          >
            Dashed
          </button>
        </div>
      </div>
      {dashed && (
        <>
          <label className="prop-export-settings-row">
            <span>Dash</span>
            {numberInput(dash, (next) => onDash({ dash: Math.max(0.5, next), gap }))}
          </label>
          <label className="prop-export-settings-row">
            <span>Gap</span>
            {numberInput(gap ?? dash, (next) => onDash({ dash, gap: next }))}
          </label>
        </>
      )}
      {onJoin && (
        <div className="prop-export-settings-row">
          <span>Join</span>
          <div className="prop-toggle" role="group" aria-label="Stroke join">
            {(['miter', 'round', 'bevel'] as const).map((value) => (
              <button
                key={value}
                type="button"
                title={value.charAt(0).toUpperCase() + value.slice(1)}
                aria-pressed={join === value}
                className={join === value ? 'is-on' : undefined}
                onClick={() => onJoin(value)}
              >
                <StrokeJoinIcon join={value} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}

function StrokeAlignIcon({ align }: { align: StrokeAlign }) {
  const dashed = { stroke: 'currentColor', strokeWidth: 1, strokeDasharray: '1.5 1.5', strokeLinecap: 'round' as const }
  const solid = { stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' as const }
  if (align === 'inside') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 13.5V8a5 5 0 0 1 5-5h5.5" {...dashed} />
        <path d="M6.5 13.5V9.5a3 3 0 0 1 3-3h4" {...solid} />
      </svg>
    )
  }
  if (align === 'outside') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 13.5V8a5 5 0 0 1 5-5h5.5" {...solid} />
        <path d="M6.5 13.5V9.5a3 3 0 0 1 3-3h4" {...dashed} />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2.5 13.5V7.5a5 5 0 0 1 5-5h6" {...solid} />
      <path d="M5 13.5V9a4 4 0 0 1 4-4h4.5" {...dashed} />
      <path d="M7.5 13.5v-3a3 3 0 0 1 3-3h3" {...solid} />
    </svg>
  )
}

function StrokeJoinIcon({ join }: { join: StrokeJoin }) {
  const outer =
    join === 'miter'
      ? 'M3.5 13.5V3.5h10'
      : join === 'round'
        ? 'M3.5 13.5V8a4.5 4.5 0 0 1 4.5-4.5h5.5'
        : 'M3.5 13.5V7L7 3.5h6.5'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={outer} stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 13.5v-6h6" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" strokeLinecap="round" />
    </svg>
  )
}

function StrokeCapIcon({ cap }: { cap: StrokeCap }) {
  const outline =
    cap === 'round'
      ? 'M14 5H6.5a3 3 0 0 0 0 6H14'
      : cap === 'square'
        ? 'M14 5H3.5v6H14'
        : 'M14 5H6.5v6H14'
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={outline} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M6.5 8H14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

function EffectsBlock({
  node,
  onPatch
}: {
  node: DesignNode
  onPatch: (patch: Partial<DesignNode>) => void
}) {
  const effects = getNodeEffects(node)
  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [popHover, setPopHover] = useState(false)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const openEffect = collapsed ? null : effects.find((fx) => fx.id === openId) || null

  const commit = (next: DesignEffect[]) => {
    onPatch(syncLegacyEffectFields(next) as Partial<DesignNode>)
  }

  const addEffect = () => {
    const next = [...effects, defaultEffect('DROP_SHADOW')]
    setCollapsed(false)
    commit(next)
    setOpenId(next[next.length - 1].id)
  }

  const patchEffect = (id: string, patch: Partial<DesignEffect>) => {
    commit(effects.map((fx) => (fx.id === id ? { ...fx, ...patch } : fx)))
  }

  const removeEffect = (id: string) => {
    commit(effects.filter((fx) => fx.id !== id))
    if (openId === id) setOpenId(null)
  }

  const changeType = (id: string, type: EffectType) => {
    const prev = effects.find((fx) => fx.id === id)
    if (!prev || prev.type === type) return
    const isShadow = (t: EffectType) => t === 'DROP_SHADOW' || t === 'INNER_SHADOW'
    const isBlur = (t: EffectType) => t === 'LAYER_BLUR' || t === 'BACKGROUND_BLUR'
    const keep = (isShadow(prev.type) && isShadow(type)) || (isBlur(prev.type) && isBlur(type))
    const next: DesignEffect = keep ? { ...prev, type } : { ...defaultEffect(type), id, visible: prev.visible }
    commit(effects.map((fx) => (fx.id === id ? next : fx)))
  }

  const closePopover = () => {
    setOpenId(null)
    setPopHover(false)
  }

  return (
    <section className="prop-section prop-section-effects">
      <div
        {...headToggle(() => {
          if (!effects.length) return addEffect()
          setCollapsed((value) => !value)
          closePopover()
        })}
      >
        <span className={effects.length ? undefined : 'is-empty'}>Effects</span>
        <div className="prop-section-actions">
          {effects.length > 0 && (
            <button type="button" className="prop-head-ico is-strong" title="Effect styles" disabled>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                <circle cx="4.75" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="11.25" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="4.75" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
                <circle cx="11.25" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            </button>
          )}
          <button type="button" className="prop-head-ico is-strong" onClick={addEffect} title="Add effect">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="prop-head-ico is-strong prop-head-caret"
            title={collapsed || !effects.length ? 'Show effects' : 'Hide effects'}
            aria-expanded={effects.length > 0 && !collapsed}
            onClick={() => {
              if (!effects.length) return addEffect()
              setCollapsed((value) => !value)
              closePopover()
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path
                d={collapsed ? 'M3 1.5 5.5 4 3 6.5' : 'M1.5 3 4 5.5 6.5 3'}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {effects.length > 0 && !collapsed && (
        <div className="prop-effects">
          {effects.map((fx) => {
            const visible = fx.visible !== false
            const open = openId === fx.id
            return (
              <div
                key={fx.id}
                className={`prop-effect-item${open ? ' is-open' : ''}${open && popHover ? ' is-linked' : ''}${visible ? '' : ' is-hidden'}`}
                ref={(el) => {
                  rowRefs.current[fx.id] = el
                }}
              >
                <button
                  type="button"
                  className="prop-effect-main"
                  data-effect-row={fx.id}
                  title="Edit effect"
                  onClick={() => {
                    setPopHover(false)
                    setOpenId(open ? null : fx.id)
                  }}
                >
                  <span className="prop-effect-tile">
                    <EffectTypeIcon type={fx.type} />
                  </span>
                  <span className="prop-effect-text">
                    <span className="prop-effect-name">{effectLabel(fx.type)}</span>
                    <span className="prop-effect-meta">{effectSummary(fx)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="prop-trail-ico"
                  title={visible ? 'Hide effect' : 'Show effect'}
                  onClick={() => patchEffect(fx.id, { visible: !visible })}
                >
                  {visible ? <FxEyeIcon /> : <FxEyeOffIcon />}
                </button>
                <button type="button" className="prop-trail-ico" title="Remove effect" onClick={() => removeEffect(fx.id)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
      {openEffect && (
        <EffectPopover
          effect={openEffect}
          anchor={rowRefs.current[openEffect.id]?.getBoundingClientRect() || null}
          onHover={setPopHover}
          onClose={closePopover}
          onChangeType={(type) => changeType(openEffect.id, type)}
          onChange={(patch) => patchEffect(openEffect.id, patch)}
        />
      )}
    </section>
  )
}

const FX_BLEND_GROUPS = BLEND_MODE_GROUPS.map((group) => group.modes.filter((mode) => mode !== 'Pass through')).filter(
  (modes) => modes.length > 0
)

function EffectPopover({
  effect,
  anchor,
  onHover,
  onClose,
  onChangeType,
  onChange
}: {
  effect: DesignEffect
  anchor: DOMRect | null
  onHover: (hover: boolean) => void
  onClose: () => void
  onChangeType: (type: EffectType) => void
  onChange: (patch: Partial<DesignEffect>) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<'type' | 'blend' | null>(null)
  const [hoverItem, setHoverItem] = useState<string | null>(null)
  const [menuMax, setMenuMax] = useState(480)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const menuRef = useRef(menu)
  menuRef.current = menu

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (root.current?.contains(target)) return
      if (target.closest?.('[data-effect-row], .shape-capture-overlay, .shader-fills-popup.is-beside, .gradient-handles')) return
      closeRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuRef.current) setMenu(null)
      else closeRef.current()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const anchorTop = anchor?.top ?? null
  const anchorLeft = anchor?.left ?? null
  const anchorRight = anchor?.right ?? null

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    if (anchorTop == null || anchorLeft == null || anchorRight == null) {
      setPos({ top: 120, left: 80 })
      return
    }
    const panel = el.parentElement?.closest('.rightbar') as HTMLElement | null
    const panelLeft = panel ? panel.getBoundingClientRect().left : anchorLeft - 16
    let left = panelLeft - width - 8
    if (left < 8) left = Math.min(window.innerWidth - width - 8, anchorRight + 8)
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, anchorTop - 48))
    setPos({ top, left })
  }, [anchorTop, anchorLeft, anchorRight, effect.type, effect.blurMode, effect.noiseType, effect.shader?.shader])

  const isShadow = effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
  const isBlur = effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR'
  const hasBlend = isShadow || effect.type === 'NOISE' || effect.type === 'SHADER'
  const blurMode: EffectBlurMode = effect.blurMode || 'UNIFORM'
  const noiseType: NoiseType = effect.noiseType || 'MONOTONE'
  const blendMode = effect.blendMode || 'Normal'
  const shader = effect.shader || defaultShader('mesh-gradient')

  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const line = isBlur && blurMode === 'PROGRESSIVE' ? progressiveLine(effect) : null
  useEffect(() => {
    if (!line) {
      setBlurEdit(null)
      return
    }
    setBlurEdit({
      start: line.start,
      end: line.end,
      onChange: (start, end) => changeRef.current({ progressStart: start, progressEnd: end })
    })
  }, [line?.start.x, line?.start.y, line?.end.x, line?.end.y, Boolean(line)])
  useEffect(() => () => setBlurEdit(null), [])

  const openMenu = (next: 'type' | 'blend') => {
    const top = root.current?.getBoundingClientRect().top ?? 0
    setMenuMax(Math.max(160, window.innerHeight - top - 36 - 8))
    setMenu(menu === next ? null : next)
    setHoverItem(next === 'type' ? effect.type : blendMode)
  }

  return (
    <div
      ref={root}
      className="fx-pop"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="fx-pop-head">
        <button type="button" className={`fx-type-trigger${menu === 'type' ? ' is-on' : ''}`} onClick={() => openMenu('type')}>
          <EffectTypeIcon type={effect.type} />
          <span>{effectLabel(effect.type)}</span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
            <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="fx-pop-spacer" />
        {hasBlend && (
          <button
            type="button"
            className={`fill-picker-icon-btn${menu === 'blend' ? ' is-on' : ''}`}
            title={`Blend mode: ${blendMode}`}
            onClick={() => openMenu('blend')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 2.2c2.3 2.7 3.8 4.9 3.8 6.9a3.8 3.8 0 0 1-7.6 0c0-2 1.5-4.2 3.8-6.9Z"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button type="button" className="fill-picker-icon-btn" title="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>

        {menu === 'type' && (
          <div className="fx-menu fx-type-menu" role="listbox" onMouseLeave={() => setHoverItem(effect.type)}>
            {EFFECT_TYPE_OPTIONS.map((option) => (
              <div key={option.type} className="fx-menu-group">
                {option.separated && <div className="fx-menu-sep" />}
                <button
                  type="button"
                  role="option"
                  aria-selected={effect.type === option.type}
                  className={hoverItem === option.type ? 'is-hot' : undefined}
                  onMouseEnter={() => setHoverItem(option.type)}
                  onClick={() => {
                    onChangeType(option.type)
                    setMenu(null)
                  }}
                >
                  <EffectTypeIcon type={option.type} />
                  <span>{option.label}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {menu === 'blend' && (
          <div
            className="fx-menu fx-blend-menu"
            role="listbox"
            style={{ maxHeight: menuMax }}
            onMouseLeave={() => setHoverItem(blendMode)}
          >
            {FX_BLEND_GROUPS.map((modes, index) => (
              <div key={modes[0]} className="fx-menu-group">
                {index > 0 && <div className="fx-menu-sep" />}
                {modes.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="option"
                    aria-selected={blendMode === mode}
                    className={hoverItem === mode ? 'is-hot' : undefined}
                    onMouseEnter={() => setHoverItem(mode)}
                    onClick={() => {
                      onChange({ blendMode: mode })
                      setMenu(null)
                    }}
                  >
                    <span className="fx-menu-check">{blendMode === mode ? <FxCheckIcon /> : null}</span>
                    <span>{mode}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fx-pop-body">
        {isShadow && (
          <>
            <div className="fx-label">Position</div>
            <FxSlider prefix="X" value={effect.offsetX ?? 0} min={-100} max={100} centered onChange={(offsetX) => onChange({ offsetX })} />
            <FxSlider prefix="Y" value={effect.offsetY ?? 4} min={-100} max={100} centered onChange={(offsetY) => onChange({ offsetY })} />
            <div className="fx-label">Blur</div>
            <FxSlider
              prefix={<FxBlurIcon />}
              value={effect.radius ?? 4}
              min={0}
              max={100}
              limit={[0, 1000]}
              onChange={(radius) => onChange({ radius })}
            />
            <div className="fx-label">Spread</div>
            <FxSlider
              prefix={<FxSpreadIcon />}
              value={effect.spread ?? 0}
              min={-100}
              max={100}
              centered
              onChange={(spread) => onChange({ spread })}
            />
            <div className="fx-label">Color</div>
            <FxColorRow
              hex={toHex(effect.color, '#000000')}
              opacity={effect.opacity ?? 0.25}
              onHex={(color) => onChange({ color })}
              onOpacity={(opacity) => onChange({ opacity })}
            />
          </>
        )}

        {isBlur && (
          <>
            <FxSegmented
              options={[
                { id: 'UNIFORM', label: 'Uniform' },
                { id: 'PROGRESSIVE', label: 'Progressive' }
              ]}
              value={blurMode}
              onChange={(mode) => onChange({ blurMode: mode, startRadius: effect.startRadius ?? 0 })}
            />
            {blurMode === 'UNIFORM' ? (
              <>
                <div className="fx-label">Blur</div>
                <FxSlider
                  prefix={<FxBlurIcon />}
                  value={effect.radius ?? 4}
                  min={0}
                  max={100}
                  limit={[0, 1000]}
                  onChange={(radius) => onChange({ radius })}
                />
              </>
            ) : (
              <>
                <div className="fx-label">Start</div>
                <FxSlider
                  prefix={<FxBlurIcon />}
                  value={effect.startRadius ?? 0}
                  min={0}
                  max={100}
                  limit={[0, 1000]}
                  onChange={(startRadius) => onChange({ startRadius })}
                />
                <div className="fx-label">End</div>
                <FxSlider
                  prefix={<FxBlurIcon />}
                  value={effect.radius ?? 4}
                  min={0}
                  max={100}
                  limit={[0, 1000]}
                  onChange={(radius) => onChange({ radius })}
                />
              </>
            )}
          </>
        )}

        {effect.type === 'NOISE' && (
          <>
            <FxSegmented
              options={[
                { id: 'MONOTONE', label: 'Mono' },
                { id: 'DUOTONE', label: 'Duo' },
                { id: 'MULTITONE', label: 'Multi' }
              ]}
              value={noiseType}
              onChange={(kind) => onChange({ noiseType: kind })}
            />
            <div className="fx-label">Noise size</div>
            <FxSlider
              prefix="X"
              value={effect.noiseSizeX ?? 0.5}
              min={0}
              max={2}
              step={0.01}
              limit={[0.01, 100]}
              onChange={(noiseSizeX) => onChange({ noiseSizeX })}
            />
            <FxSlider
              spaced
              prefix="Y"
              value={effect.noiseSizeY ?? effect.noiseSizeX ?? 0.5}
              min={0}
              max={2}
              step={0.01}
              limit={[0.01, 100]}
              onChange={(noiseSizeY) => onChange({ noiseSizeY })}
            />
            <div className="fx-label">Density</div>
            <FxSlider
              prefix={<FxDensityIcon />}
              value={Math.round((effect.density ?? 1) * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={(density) => onChange({ density: density / 100 })}
            />
            {noiseType === 'MULTITONE' ? (
              <>
                <div className="fx-label">Opacity</div>
                <FxSlider
                  prefix={<FxOpacityIcon />}
                  value={Math.round((effect.opacity ?? 0.25) * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(opacity) => onChange({ opacity: opacity / 100 })}
                />
              </>
            ) : (
              <>
                <div className="fx-label">Color</div>
                <FxColorRow
                  hex={toHex(effect.color, '#000000')}
                  opacity={effect.opacity ?? 0.25}
                  onHex={(color) => onChange({ color })}
                  onOpacity={(opacity) => onChange({ opacity })}
                />
                {noiseType === 'DUOTONE' && (
                  <FxColorRow
                    hex={toHex(effect.secondaryColor, '#FFFFFF')}
                    opacity={effect.secondaryOpacity ?? 0}
                    onHex={(secondaryColor) => onChange({ secondaryColor })}
                    onOpacity={(secondaryOpacity) => onChange({ secondaryOpacity })}
                  />
                )}
              </>
            )}
          </>
        )}

        {effect.type === 'TEXTURE' && (
          <>
            <div className="fx-label">Size</div>
            <FxSlider
              prefix="X"
              value={effect.noiseSizeX ?? 0.5}
              min={0}
              max={2}
              step={0.01}
              limit={[0.01, 100]}
              onChange={(noiseSizeX) => onChange({ noiseSizeX })}
            />
            <FxSlider
              spaced
              prefix="Y"
              value={effect.noiseSizeY ?? effect.noiseSizeX ?? 0.5}
              min={0}
              max={2}
              step={0.01}
              limit={[0.01, 100]}
              onChange={(noiseSizeY) => onChange({ noiseSizeY })}
            />
            <div className="fx-label">Radius</div>
            <FxSlider
              prefix={<FxSpreadIcon />}
              value={effect.radius ?? 2}
              min={0}
              max={5}
              step={0.1}
              limit={[0, 100]}
              onChange={(radius) => onChange({ radius })}
            />
          </>
        )}

        {effect.type === 'GLASS' && (
          <>
            <div className="fx-glass-light">
              <span className="fx-glass-label">Light</span>
              <FxLightPad angle={effect.lightAngle ?? -45} onChange={(lightAngle) => onChange({ lightAngle })} />
              <div className="fx-glass-light-inputs">
                <FxNumBox
                  value={effect.lightAngle ?? -45}
                  suffix="°"
                  limit={[-180, 180]}
                  onChange={(lightAngle) => onChange({ lightAngle })}
                />
                <FxNumBox
                  value={Math.round((effect.lightIntensity ?? 0.8) * 100)}
                  suffix="%"
                  limit={[0, 100]}
                  onChange={(value) => onChange({ lightIntensity: value / 100 })}
                />
              </div>
            </div>
            <div className="fx-divider" />
            <FxSlider
              label="Refraction"
              value={Math.round((effect.refraction ?? 0.8) * 100)}
              min={0}
              max={100}
              onChange={(value) => onChange({ refraction: value / 100 })}
            />
            <FxSlider label="Depth" value={effect.depth ?? 20} min={1} max={100} limit={[1, 1000]} onChange={(depth) => onChange({ depth })} />
            <FxSlider
              label="Dispersion"
              value={Math.round((effect.dispersion ?? 0.5) * 100)}
              min={0}
              max={100}
              onChange={(value) => onChange({ dispersion: value / 100 })}
            />
            <FxSlider label="Frost" value={effect.radius ?? 2} min={0} max={50} limit={[0, 1000]} onChange={(radius) => onChange({ radius })} />
            <FxSlider label="Splay" value={effect.splay ?? 0} min={0} max={100} onChange={(splay) => onChange({ splay })} />
          </>
        )}

        {effect.type === 'SHADER' && (
          <>
            <div className="fx-label">Opacity</div>
            <FxSlider
              prefix={<FxOpacityIcon />}
              value={Math.round(shader.opacity * 100)}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => onChange({ shader: { ...shader, opacity: value / 100 } })}
            />
            <div className="fx-shader">
              <ShaderEditor paint={shader} pickerBeside onChange={(next) => onChange({ shader: next })} />
            </div>
          </>
        )}
      </div>

      {effect.type === 'DROP_SHADOW' && (
        <div className="fx-pop-foot">
          <FxCheck
            checked={Boolean(effect.showShadowBehindNode)}
            label="Show behind transparent areas"
            onChange={(showShadowBehindNode) => onChange({ showShadowBehindNode })}
          />
        </div>
      )}
      {effect.type === 'TEXTURE' && (
        <div className="fx-pop-foot">
          <FxCheck checked={Boolean(effect.clipToShape)} label="Clip to shape" onChange={(clipToShape) => onChange({ clipToShape })} />
        </div>
      )}
    </div>
  )
}

function fxRound(value: number, step: number): number {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)))
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function FxNumBox({
  value,
  suffix = '',
  step = 1,
  limit = [-100000, 100000],
  className = 'fx-numbox',
  onChange
}: {
  value: number
  suffix?: string
  step?: number
  limit?: [number, number]
  className?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = `${fxRound(value, step)}${suffix}`
  const commit = () => {
    if (draft == null) return
    const parsed = parseFloat(draft.replace(/[^0-9.+-]/g, ''))
    if (Number.isFinite(parsed)) onChange(fxRound(Math.min(limit[1], Math.max(limit[0], parsed)), step))
    setDraft(null)
  }
  return (
    <input
      className={className}
      value={draft ?? shown}
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.stopPropagation()
          setDraft(null)
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
          onChange(fxRound(Math.min(limit[1], Math.max(limit[0], value + delta)), step))
          setDraft(null)
        }
      }}
    />
  )
}

function FxSlider({
  prefix,
  label,
  value,
  min,
  max,
  step = 1,
  limit,
  suffix = '',
  centered = false,
  spaced = false,
  onChange
}: {
  prefix?: ReactNode
  label?: string
  value: number
  min: number
  max: number
  step?: number
  limit?: [number, number]
  suffix?: string
  centered?: boolean
  spaced?: boolean
  onChange: (value: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const range = limit || [min, max]
  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min || 1)))
  const clampTo = (next: number) => fxRound(Math.min(range[1], Math.max(range[0], next)), step)

  const setFromPointer = (clientX: number) => {
    const el = track.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const knob = 13
    const r = Math.min(1, Math.max(0, (clientX - rect.left - knob / 2) / Math.max(1, rect.width - knob)))
    const raw = min + r * (max - min)
    onChange(clampTo(Math.round(raw / step) * step))
  }

  const scrub = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const start = value
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const unit = step < 1 ? step : Math.max(step, (max - min) / 200)
    const onMove = (move: PointerEvent) => onChange(clampTo(start + Math.round((move.clientX - startX) / 2) * unit))
    const onUp = () => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const slider = (
    <div
      className="fx-field-slider"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) setFromPointer(event.clientX)
      }}
    >
      <div className="fx-track" ref={track}>
        {!centered && <div className="fx-track-fill" style={{ width: `calc(${ratio} * (100% - 13px) + 6.5px)` }} />}
        <div className="fx-knob" style={{ left: `calc(${ratio} * (100% - 13px))` }} />
      </div>
    </div>
  )

  if (label) {
    return (
      <div className="fx-row-labeled">
        <span className="fx-row-label" onPointerDown={scrub}>
          {label}
        </span>
        <div className="fx-field fx-field-rev">
          {slider}
          <FxNumBox value={value} suffix={suffix} step={step} limit={range} className="fx-field-input" onChange={onChange} />
        </div>
      </div>
    )
  }

  return (
    <div className={`fx-field${spaced ? ' fx-spaced' : ''}`}>
      <div className="fx-field-num">
        <span className="fx-field-prefix" onPointerDown={scrub}>
          {prefix}
        </span>
        <FxNumBox value={value} suffix={suffix} step={step} limit={range} className="fx-field-input" onChange={onChange} />
      </div>
      {slider}
    </div>
  )
}

function fxRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) || 0
  const g = parseInt(clean.slice(2, 4), 16) || 0
  const b = parseInt(clean.slice(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

function FxColorRow({
  hex,
  opacity,
  onHex,
  onOpacity
}: {
  hex: string
  opacity: number
  onHex: (hex: string) => void
  onOpacity: (opacity: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commitHex = () => {
    if (draft == null) return
    let next = draft.replace(/[^0-9a-fA-F]/g, '')
    if (next.length === 3) next = next.split('').map((ch) => ch + ch).join('')
    if (next.length === 6) onHex(`#${next.toUpperCase()}`)
    setDraft(null)
  }
  return (
    <div className="fx-field fx-color">
      <label
        className="fx-swatch"
        style={{
          background: `linear-gradient(90deg, ${hex} 0 50%, ${fxRgba(hex, opacity)} 50% 100%), repeating-conic-gradient(#d4d4d4 0% 25%, #fff 0% 50%) 50% / 6px 6px`
        }}
      >
        <input type="color" value={hex} onChange={(event) => onHex(event.target.value.toUpperCase())} />
      </label>
      <input
        className="fx-hex"
        value={draft ?? hex.replace('#', '').toUpperCase()}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitHex}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitHex()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
      <div className="fx-color-opacity">
        <FxNumBox
          value={Math.round(opacity * 100)}
          limit={[0, 100]}
          className="fx-field-input"
          onChange={(value) => onOpacity(value / 100)}
        />
        <span>%</span>
      </div>
    </div>
  )
}

function FxSegmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="fx-seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={value === option.id ? 'is-on' : undefined}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function FxCheck({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="fx-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="fx-check-box">
        <FxCheckIcon />
      </span>
      <span>{label}</span>
    </label>
  )
}

function FxLightPad({ angle, onChange }: { angle: number; onChange: (angle: number) => void }) {
  const rad = ((angle - 90) * Math.PI) / 180
  const lampX = 50 + Math.cos(rad) * 30
  const lampY = 50 + Math.sin(rad) * 30

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    if (Math.abs(dx) + Math.abs(dy) < 2) return
    let next = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90)
    if (next > 180) next -= 360
    onChange(next)
  }

  return (
    <div
      className="fx-light-pad"
      style={{
        background: `radial-gradient(circle at ${lampX}% ${lampY}%, #ffffff 0%, #f7f7f7 38%, #ececec 100%)`
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons & 1) setFromPointer(event)
      }}
    >
      <span className="fx-light-lamp" style={{ left: `${lampX}%`, top: `${lampY}%`, transform: `translate(-50%, -50%) rotate(${angle + 45}deg)` }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path d="M4.2 1.8 9.6 4.6 6.4 9.9 2.3 7.5Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
          <path d="M5 9.2 3.7 11.4M7.4 5.1l4.3 2.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="11.2" cy="10.6" r="1.2" stroke="currentColor" strokeWidth="1" />
        </svg>
      </span>
      <span className="fx-light-target" />
    </div>
  )
}

function FxCheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M2 5.2 4.1 7.2 8 2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FxEyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.8 8C3.2 5.3 5.4 3.9 8 3.9s4.8 1.4 6.2 4.1C12.8 10.7 10.6 12.1 8 12.1S3.2 10.7 1.8 8Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function FxEyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 7.2c1.5 2 3.6 3.1 6 3.1s4.5-1.1 6-3.1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M4.3 9.3 3.2 11M8 10.3v2M11.7 9.3l1.1 1.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

function FxBlurIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      {[4.5, 8, 11.5].flatMap((y) => [4.5, 8, 11.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" />))}
    </svg>
  )
}

function FxSpreadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.1" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return <circle key={i} cx={8 + Math.cos(a) * 5.4} cy={8 + Math.sin(a) * 5.4} r="0.85" fill="currentColor" />
      })}
    </svg>
  )
}

function FxDensityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      {[3.8, 8, 12.2].flatMap((y) =>
        [3.8, 8, 12.2].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.45" stroke="currentColor" strokeWidth="1" />)
      )}
    </svg>
  )
}

function FxOpacityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.5 12.5 12.5 3.5V11a1.5 1.5 0 0 1-1.5 1.5Z" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

function EffectTypeIcon({ type }: { type: EffectType }) {
  if (type === 'INNER_SHADOW') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.1" />
        <path d="M3 4.1c0-.6.5-1.1 1.1-1.1h7.8c.6 0 1.1.5 1.1 1.1V5.6H3Z" fill="currentColor" />
      </svg>
    )
  }
  if (type === 'DROP_SHADOW') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3.4 13.2h9.2c.5 0 .9.4.9.9v.1c0 .5-.4.9-.9.9H3.4c-.5 0-.9-.4-.9-.9v-.1c0-.5.4-.9.9-.9Z" fill="currentColor" opacity="0.35" />
        <rect x="2.5" y="1.8" width="11" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.1" fill="var(--fx-icon-bg, transparent)" />
      </svg>
    )
  }
  if (type === 'LAYER_BLUR') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        {[2.8, 5.4, 8, 10.6, 13.2].flatMap((y, row) =>
          [2.8, 5.4, 8, 10.6, 13.2].map((x, col) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={0.75} opacity={row % 2 === col % 2 ? 1 : 0.55} />
          ))
        )}
      </svg>
    )
  }
  if (type === 'BACKGROUND_BLUR') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="2.4" stroke="currentColor" strokeWidth="1.1" />
        {[5.4, 8, 10.6].flatMap((y) => [5.4, 8, 10.6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.8" fill="currentColor" />))}
      </svg>
    )
  }
  if (type === 'NOISE') {
    const specks: Array<[number, number, number]> = [
      [4.6, 4.8, 0.6], [6.8, 4.2, 0.45], [9.2, 5, 0.6], [11.3, 4.4, 0.45],
      [5.4, 6.9, 0.45], [7.9, 6.6, 0.6], [10.4, 7.1, 0.45], [4.3, 8.9, 0.6],
      [6.6, 8.7, 0.45], [9, 9.1, 0.6], [11.5, 9.2, 0.5], [5.2, 11.2, 0.5],
      [7.6, 11, 0.6], [10.1, 11.4, 0.45], [11.6, 11.3, 0.4], [8.2, 13, 0]
    ]
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="2" y="2" width="12" height="12" rx="2.4" stroke="currentColor" strokeWidth="1.1" />
        {specks.filter(([, , r]) => r > 0).map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="currentColor" />
        ))}
      </svg>
    )
  }
  if (type === 'TEXTURE') {
    const dots: Array<[number, number]> = [
      [3, 3], [8, 3], [13, 3], [5.5, 5.5], [10.5, 5.5], [3, 8], [8, 8], [13, 8],
      [5.5, 10.5], [10.5, 10.5], [3, 13], [8, 13], [13, 13]
    ]
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        {dots.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" />
        ))}
      </svg>
    )
  }
  if (type === 'SHADER') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        {[4.5, 8, 11.5].map((y) => (
          <path
            key={y}
            d={`M2 ${y}c1.5-1.6 3-1.6 4 0s2.5 1.6 4 0 2.5-1.6 4 0`}
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        ))}
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.3 6.9a3.9 3.9 0 0 0 4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function LayoutGuideBlock({ node, onChange }: { node: DesignNode; onChange: (grids: LayoutGrid[]) => void }) {
  const grids = node.layoutGrids || []
  const [openId, setOpenId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const openGrid = grids.find((grid) => grid.id === openId) || null

  const add = () => {
    setCollapsed(false)
    onChange([defaultLayoutGrid('GRID'), ...grids])
  }

  const patch = (id: string, next: Partial<LayoutGrid>) => {
    onChange(grids.map((grid) => (grid.id === id ? { ...grid, ...next } : grid)))
  }

  const remove = (id: string) => {
    onChange(grids.filter((grid) => grid.id !== id))
    if (openId === id) setOpenId(null)
  }

  const changePattern = (id: string, pattern: LayoutGridPattern) => {
    const prev = grids.find((grid) => grid.id === id)
    if (!prev || prev.pattern === pattern) return
    const fresh = defaultLayoutGrid(pattern)
    const keepBands = prev.pattern !== 'GRID' && pattern !== 'GRID'
    patch(id, {
      ...fresh,
      ...(keepBands
        ? {
            count: prev.count,
            alignment: prev.alignment,
            sectionSize: prev.sectionSize,
            offset: prev.offset,
            gutter: prev.gutter
          }
        : {}),
      id,
      visible: prev.visible,
      color: prev.color,
      opacity: prev.opacity
    })
  }

  const changeAlignment = (id: string, alignment: LayoutGridAlignment) => {
    const prev = grids.find((grid) => grid.id === id)
    if (!prev) return
    const next: Partial<LayoutGrid> = { alignment }
    if ((prev.alignment || 'STRETCH') === 'STRETCH' && alignment !== 'STRETCH') {
      next.sectionSize = stretchSectionSize(prev, (prev.pattern === 'ROWS' ? node.height : node.width) || 0)
    }
    if (alignment === 'STRETCH' && prev.count === 'auto') next.count = 5
    patch(id, next)
  }

  return (
    <section className="prop-section prop-section-layout-guide">
      <div
        {...headToggle(() => {
          if (!grids.length) return add()
          setCollapsed((value) => !value)
          setOpenId(null)
        })}
      >
        <span>Layout guide</span>
        <div className="prop-section-actions">
          <button type="button" className="prop-head-ico is-strong" title="Layout guide styles" disabled>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="4.75" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="4.75" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="4.75" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
              <circle cx="11.25" cy="11.25" r="2.25" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          </button>
          <button type="button" className="prop-head-ico is-strong" onClick={add} title="Add layout guide">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="prop-head-ico is-strong prop-head-caret"
            title={collapsed ? 'Show layout guides' : 'Hide layout guides'}
            aria-expanded={!collapsed}
            onClick={() => {
              if (!grids.length) return
              setCollapsed((value) => !value)
              setOpenId(null)
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path
                d={collapsed ? 'M3 1.5 5.5 4 3 6.5' : 'M1.5 3 4 5.5 6.5 3'}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {grids.length > 0 && !collapsed && (
        <div className="prop-lg-stack">
          {grids.map((grid) => {
            const visible = grid.visible !== false
            const open = openId === grid.id
            return (
              <div
                key={grid.id}
                data-lg-row
                className={`prop-lg-row${open ? ' is-open' : ''}${visible ? '' : ' is-hidden'}`}
                ref={(el) => {
                  if (el) rowRefs.current.set(grid.id, el)
                  else rowRefs.current.delete(grid.id)
                }}
              >
                <button type="button" className="prop-lg-main" onClick={() => setOpenId(open ? null : grid.id)}>
                  <span className="prop-lg-ico">
                    <LayoutGridIcon pattern={grid.pattern} />
                  </span>
                  <span className="prop-lg-text">
                    <span className="prop-lg-name">{layoutGridLabel(grid.pattern)}</span>
                    <span className="prop-lg-meta">{layoutGridSummary(grid)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="prop-trail-ico"
                  title={visible ? 'Hide layout guide' : 'Show layout guide'}
                  onClick={() => patch(grid.id, { visible: !visible })}
                >
                  <EyeIcon off={!visible} />
                </button>
                <button type="button" className="prop-trail-ico" title="Remove layout guide" onClick={() => remove(grid.id)}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
      {openGrid && !collapsed && (
        <LayoutGridPopover
          grid={openGrid}
          anchor={rowRefs.current.get(openGrid.id)?.getBoundingClientRect() || null}
          onClose={() => setOpenId(null)}
          onPattern={(pattern) => changePattern(openGrid.id, pattern)}
          onAlignment={(alignment) => changeAlignment(openGrid.id, alignment)}
          onChange={(next) => patch(openGrid.id, next)}
        />
      )}
    </section>
  )
}

function LayoutGridPopover({
  grid,
  anchor,
  onClose,
  onPattern,
  onAlignment,
  onChange
}: {
  grid: LayoutGrid
  anchor: DOMRect | null
  onClose: () => void
  onPattern: (pattern: LayoutGridPattern) => void
  onAlignment: (alignment: LayoutGridAlignment) => void
  onChange: (patch: Partial<LayoutGrid>) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [menu, setMenu] = useState<'pattern' | 'count' | 'align' | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const alignment = grid.alignment || 'STRETCH'
  const isRows = grid.pattern === 'ROWS'

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (root.current?.contains(target)) return
      if (target?.closest?.('[data-lg-row]')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const anchorTop = anchor?.top ?? null
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    const panel = el.parentElement?.closest('.rightbar') as HTMLElement | null
    const panelLeft = panel ? panel.getBoundingClientRect().left : window.innerWidth - 241
    const left = Math.max(8, panelLeft - width - 4)
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, (anchorTop ?? 120) - 48))
    setPos({ top, left })
  }, [anchorTop, grid.pattern])

  const patternOptions: Array<{ value: LayoutGridPattern; label: string }> = [
    { value: 'GRID', label: 'Grid' },
    { value: 'COLUMNS', label: 'Columns' },
    { value: 'ROWS', label: 'Rows' }
  ]
  const alignOptions: Array<{ value: LayoutGridAlignment; label: string }> = (
    ['MIN', 'MAX', 'CENTER', 'STRETCH'] as LayoutGridAlignment[]
  ).map((value) => ({ value, label: layoutGridAlignmentLabel(grid.pattern, value) }))
  const countOptions: Array<{ value: string; label: string }> = [
    ...(alignment === 'STRETCH' ? [] : [{ value: 'auto', label: 'Auto' }]),
    ...LAYOUT_GRID_COUNT_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))
  ]

  return (
    <div
      ref={root}
      className="lg-popover"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="lg-pop-head">
        <div className="lg-menu-wrap">
          <button
            type="button"
            className={`lg-type-btn${menu === 'pattern' ? ' is-on' : ''}`}
            onClick={() => setMenu(menu === 'pattern' ? null : 'pattern')}
          >
            <span>{layoutGridLabel(grid.pattern)}</span>
            <LgCaret />
          </button>
          {menu === 'pattern' && (
            <LgMenu
              options={patternOptions}
              value={grid.pattern}
              onPick={(pattern) => {
                setMenu(null)
                onPattern(pattern)
              }}
              onClose={() => setMenu(null)}
            />
          )}
        </div>
        <button type="button" className="lg-close" onClick={onClose} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="lg-pop-body">
        {grid.pattern === 'GRID' ? (
          <>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Size</span>
              <LgNumField value={grid.size ?? 10} min={1} onChange={(size) => onChange({ size })} />
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Color</span>
              <LgColorField grid={grid} pickerOpen={pickerOpen} onPicker={setPickerOpen} onChange={onChange} anchor={root} />
            </div>
          </>
        ) : (
          <>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Count</span>
              <div className="lg-menu-wrap">
                <LgNumField
                  value={grid.count === 'auto' ? 0 : grid.count ?? 5}
                  display={grid.count === 'auto' ? 'Auto' : undefined}
                  min={1}
                  onChange={(count) => onChange({ count: Math.round(count) })}
                  onCaret={() => setMenu(menu === 'count' ? null : 'count')}
                />
                {menu === 'count' && (
                  <LgMenu
                    options={countOptions}
                    value={grid.count === 'auto' ? 'auto' : String(grid.count ?? 5)}
                    onPick={(value) => {
                      setMenu(null)
                      onChange({ count: value === 'auto' ? 'auto' : Number(value) })
                    }}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Color</span>
              <LgColorField grid={grid} pickerOpen={pickerOpen} onPicker={setPickerOpen} onChange={onChange} anchor={root} />
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Type</span>
              <div className="lg-menu-wrap">
                <button
                  type="button"
                  className={`lg-field lg-select${menu === 'align' ? ' is-focus' : ''}`}
                  onClick={() => setMenu(menu === 'align' ? null : 'align')}
                >
                  <span>{layoutGridAlignmentLabel(grid.pattern, alignment)}</span>
                  <LgCaret />
                </button>
                {menu === 'align' && (
                  <LgMenu
                    options={alignOptions}
                    value={alignment}
                    onPick={(value) => {
                      setMenu(null)
                      onAlignment(value)
                    }}
                    onClose={() => setMenu(null)}
                  />
                )}
              </div>
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">{isRows ? 'Height' : 'Width'}</span>
              <LgNumField
                value={grid.sectionSize ?? 64}
                display={alignment === 'STRETCH' ? 'Auto' : undefined}
                disabled={alignment === 'STRETCH'}
                min={1}
                onChange={(sectionSize) => onChange({ sectionSize })}
              />
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">{alignment === 'STRETCH' ? 'Margin' : 'Offset'}</span>
              <LgNumField
                value={alignment === 'CENTER' ? 0 : grid.offset ?? 0}
                disabled={alignment === 'CENTER'}
                onChange={(offset) => onChange({ offset })}
              />
            </div>
            <div className="lg-pop-row">
              <span className="lg-pop-label">Gutter</span>
              <LgNumField value={grid.gutter ?? 20} onChange={(gutter) => onChange({ gutter })} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function LgCaret() {
  return (
    <svg className="lg-caret" width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LgVariableIcon() {
  return (
    <svg className="lg-var-ico" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6L6 1.2Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.4" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function LgMenu<T extends string>({
  options,
  value,
  onPick,
  onClose
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onPick: (value: T) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const baseTop = -(8 + index * 24)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const wrap = ref.current?.parentElement
      if (wrap && !wrap.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    if (rect.top < 8) setShift(8 - rect.top)
    else if (rect.bottom > window.innerHeight - 8) setShift(window.innerHeight - 8 - rect.bottom)
  }, [])

  return (
    <div ref={ref} className="lg-menu" role="listbox" style={{ top: baseTop + shift }}>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={on}
            className={on ? 'is-on' : undefined}
            onClick={() => onPick(option.value)}
          >
            <span className="lg-menu-check">
              {on && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                  <path d="M1.8 5.2 4 7.3 8.2 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function LgNumField({
  value,
  onChange,
  display,
  disabled = false,
  min = 0,
  onCaret
}: {
  value: number
  onChange: (value: number) => void
  display?: string
  disabled?: boolean
  min?: number
  onCaret?: () => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const plain = display ?? String(Math.round(value * 100) / 100)
  const shown = draft ?? plain

  const commit = (raw: string) => {
    const next = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(next)) return
    onChange(Math.max(min, next))
  }

  return (
    <label className={`lg-field lg-num${disabled ? ' is-disabled' : ''}${onCaret ? ' has-caret' : ''}`}>
      <input
        value={shown}
        disabled={disabled}
        spellCheck={false}
        onFocus={(event) => {
          setDraft(plain)
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          commit(event.target.value)
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
            return
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
          const base = Number(draft ?? plain)
          const next = Math.max(min, (Number.isFinite(base) ? base : value) + step)
          setDraft(String(next))
          onChange(next)
        }}
      />
      {onCaret ? (
        <button
          type="button"
          className="lg-field-caret"
          aria-label="Choose"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.preventDefault()
            onCaret()
          }}
        >
          <LgCaret />
        </button>
      ) : (
        !disabled && <LgVariableIcon />
      )}
    </label>
  )
}

function LgColorField({
  grid,
  pickerOpen,
  onPicker,
  onChange,
  anchor
}: {
  grid: LayoutGrid
  pickerOpen: boolean
  onPicker: (open: boolean) => void
  onChange: (patch: Partial<LayoutGrid>) => void
  anchor: { current: HTMLDivElement | null }
}) {
  const hex = toHex(grid.color, '#FF0000')
  const opacity = Math.round((grid.opacity ?? 0.1) * 100)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [opDraft, setOpDraft] = useState<string | null>(null)

  const commitHex = (raw: string) => {
    let clean = raw.replace(/[^0-9a-fA-F]/g, '')
    if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('')
    if (clean.length === 6) onChange({ color: `#${clean.toUpperCase()}` })
  }

  return (
    <div className={`lg-field lg-color${pickerOpen ? ' is-focus' : ''}`}>
      <button
        type="button"
        className="lg-swatch"
        title="Edit color"
        onMouseDown={(event) => event.nativeEvent.stopPropagation()}
        onClick={() => onPicker(!pickerOpen)}
      >
        <span style={{ background: hex }} />
        <span style={{ background: withAlpha(hex, opacity / 100) }} />
      </button>
      <input
        className="lg-hex"
        value={hexDraft ?? hex.replace('#', '').toUpperCase()}
        spellCheck={false}
        onFocus={(event) => {
          setHexDraft(hex.replace('#', '').toUpperCase())
          event.currentTarget.select()
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
          setHexDraft(next)
          if (next.length === 6) commitHex(next)
        }}
        onBlur={(event) => {
          commitHex(event.currentTarget.value)
          setHexDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="lg-sep" aria-hidden />
      <input
        className="lg-opacity"
        value={opDraft ?? String(opacity)}
        spellCheck={false}
        onFocus={(event) => {
          setOpDraft(String(opacity))
          event.currentTarget.select()
        }}
        onChange={(event) => {
          setOpDraft(event.target.value)
          const next = Number(event.target.value)
          if (event.target.value.trim() !== '' && Number.isFinite(next)) {
            onChange({ opacity: Math.max(0, Math.min(100, next)) / 100 })
          }
        }}
        onBlur={() => setOpDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <em>%</em>
      {pickerOpen && (
        <FillPicker
          paint={defaultSolid(hex, opacity / 100)}
          solidOnly
          beside
          anchor={anchor.current?.getBoundingClientRect() || null}
          onChange={(next) => {
            if (next.type !== 'solid') return
            onChange({ color: toHex(next.color, hex), opacity: Math.round(next.opacity * 100) / 100 })
          }}
          onClose={() => onPicker(false)}
        />
      )}
    </div>
  )
}

function LayoutGridIcon({ pattern }: { pattern: LayoutGridPattern }) {
  if (pattern === 'COLUMNS') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 2.5v11M6.33 2.5v11M9.67 2.5v11M13 2.5v11M3 2.5h10M3 13.5h10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    )
  }
  if (pattern === 'ROWS') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M2.5 3h11M2.5 6.33h11M2.5 9.67h11M2.5 13h11M2.5 3v10M13.5 3v10" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5.5 2v12M10.5 2v12M2 5.5h12M2 10.5h12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

type ExportMenuOption = { id: string; label: string }

/** Sidebar-grey dropdown that opens with the checked item over its trigger (Figma select). */
function ExportMenu({
  anchor,
  options,
  value,
  onPick,
  onClose
}: {
  anchor: HTMLElement
  options: ExportMenuOption[]
  value: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const box = anchor.getBoundingClientRect()
    const selected = menu.querySelector<HTMLElement>('[aria-selected="true"]')
    const height = menu.offsetHeight
    const width = Math.max(box.width, menu.offsetWidth)
    const aligned = selected ? box.top + box.height / 2 - (selected.offsetTop + selected.offsetHeight / 2) : box.bottom + 4
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, aligned))
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left))
    setPos({ top, left, minWidth: box.width })
  }, [anchor])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={menuRef}
      className="prop-blend-menu prop-export-menu"
      role="listbox"
      style={pos ? { top: pos.top, left: pos.left, minWidth: pos.minWidth } : { top: -9999, left: -9999 }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={option.id === value}
          className={option.id === value ? 'is-on' : undefined}
          onClick={() => {
            onPick(option.id)
            onClose()
          }}
        >
          <span className="prop-blend-check" aria-hidden>
            {option.id === value ? '✓' : ''}
          </span>
          <span>{option.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
}

function ExportSettingsPopover({
  anchor,
  setting,
  onPatch,
  onClose
}: {
  anchor: HTMLElement
  setting: ExportSetting
  onPatch: (next: Partial<ExportSetting>) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const box = anchor.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, box.bottom + 6))
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width))
    setPos({ top, left })
  }, [anchor, setting.format])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="prop-blend-menu prop-export-settings"
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <div className="prop-export-settings-title">Export settings</div>
      <label className="prop-export-settings-row">
        <span>Suffix</span>
        <input
          className="prop-export-settings-input"
          placeholder={exportSizeLabel(setting) === '1x' ? 'None' : `@${exportSizeLabel(setting)}`}
          value={setting.suffix ?? ''}
          onChange={(event) => onPatch({ suffix: event.target.value === '' ? undefined : event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') onClose()
          }}
        />
      </label>
      {setting.format === 'JPG' && (
        <label className="prop-export-settings-row">
          <span>Quality</span>
          <input
            className="prop-export-settings-input"
            value={`${setting.quality ?? 92}%`}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const next = Number(event.target.value.replace('%', '').trim())
              if (Number.isFinite(next)) onPatch({ quality: Math.max(1, Math.min(100, Math.round(next))) })
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') onClose()
            }}
          />
        </label>
      )}
    </div>,
    document.body
  )
}

function ExportRow({
  row,
  onPatch,
  onRemove
}: {
  row: ExportSetting
  onPatch: (next: Partial<ExportSetting>) => void
  onRemove: () => void
}) {
  const sizeRef = useRef<HTMLDivElement>(null)
  const formatRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState<'size' | 'format' | 'more' | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const label = exportSizeLabel(row)

  const sizeOptions: ExportMenuOption[] = [
    ...EXPORT_SCALES.map((scale) => ({ id: `${scale}x`, label: `${scale}x` })),
    ...EXPORT_FIXED_SIZES.map((size) => ({ id: size.id, label: size.id }))
  ]

  const commit = (text: string) => {
    const parsed = parseExportSize(text)
    if (parsed) onPatch(parsed)
    setDraft(null)
  }

  return (
    <div className="prop-export-row">
      <div ref={sizeRef} className={`prop-export-field${menu === 'size' ? ' is-open' : ''}`}>
        <input
          value={draft ?? label}
          aria-label="Export size"
          onFocus={(event) => {
            setDraft(label)
            const input = event.currentTarget
            window.requestAnimationFrame(() => input.select())
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(null)
              event.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          className="prop-export-caret"
          title="Preset sizes"
          aria-haspopup="listbox"
          aria-expanded={menu === 'size'}
          onClick={() => setMenu((value) => (value === 'size' ? null : 'size'))}
        >
          <ExportChevron />
        </button>
      </div>
      <button
        ref={formatRef}
        type="button"
        className={`prop-export-field prop-export-select${menu === 'format' ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={menu === 'format'}
        onClick={() => setMenu((value) => (value === 'format' ? null : 'format'))}
      >
        <span>{exportFormatLabel(row.format)}</span>
        <ExportChevron />
      </button>
      <button
        ref={moreRef}
        type="button"
        className={`prop-trail-ico${menu === 'more' ? ' is-on' : ''}`}
        title="Export settings"
        onClick={() => setMenu((value) => (value === 'more' ? null : 'more'))}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3.5" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="12.5" cy="8" r="1.25" />
        </svg>
      </button>
      <button type="button" className="prop-trail-ico" title="Remove export" onClick={onRemove}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 8h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      {menu === 'size' && sizeRef.current && (
        <ExportMenu
          anchor={sizeRef.current}
          options={sizeOptions}
          value={label}
          onPick={(id) => {
            const parsed = parseExportSize(id)
            if (parsed) onPatch(parsed)
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'format' && formatRef.current && (
        <ExportMenu
          anchor={formatRef.current}
          options={EXPORT_FORMATS.map((format) => ({ id: format, label: exportFormatLabel(format) }))}
          value={row.format}
          onPick={(id) => onPatch({ format: id as ExportFormat })}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'more' && moreRef.current && (
        <ExportSettingsPopover anchor={moreRef.current} setting={row} onPatch={onPatch} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

function ExportChevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path d="M2 3.2 4 5.2 6 3.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExportBlock({
  name,
  settings,
  onChange,
  onExport,
  renderPreview
}: {
  name: string
  settings: ExportSetting[]
  onChange: (next: ExportSetting[]) => void
  onExport: (setting: ExportSetting) => void | Promise<void>
  renderPreview?: () => Promise<Blob>
}) {
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const rows = settings

  const add = () => {
    setCollapsed(false)
    const last = rows[rows.length - 1]
    const next = DEFAULT_EXPORT_SETTING()
    if (last) {
      next.format = last.format
      next.scale = Math.min(4, (last.fixedWidth || last.fixedHeight ? 1 : last.scale) + 1)
    }
    onChange([...rows, next])
  }
  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id))
  const patch = (id: string, next: Partial<ExportSetting>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...next } : row)))

  useEffect(() => {
    if (!previewOpen || !renderPreview || collapsed || !rows.length) return
    let url: string | null = null
    let cancelled = false
    void renderPreview()
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreviewUrl(url)
      })
      .catch(() => setPreviewUrl(null))
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
    // Refresh the preview whenever it is reopened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, collapsed, rows.length])

  const exportAll = async () => {
    if (!rows.length) return
    setBusy(true)
    try {
      for (const setting of rows) await onExport(setting)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="prop-section prop-section-export">
      <div
        {...headToggle(() => {
          if (!rows.length) return add()
          setCollapsed((value) => !value)
        })}
      >
        <span>Export</span>
        <div className="prop-section-actions">
          <button type="button" className="prop-head-ico is-strong" onClick={add} title="Add export setting">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="prop-head-ico is-strong prop-head-caret"
            title={collapsed ? 'Show export settings' : 'Hide export settings'}
            aria-expanded={!collapsed}
            onClick={() => {
              if (!rows.length) return
              setCollapsed((value) => !value)
            }}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path
                d={collapsed || !rows.length ? 'M3 1.5 5.5 4 3 6.5' : 'M1.5 3 4 5.5 6.5 3'}
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      {rows.length > 0 && !collapsed && (
        <>
          <div className="prop-export-list">
            {rows.map((row) => (
              <ExportRow
                key={row.id}
                row={row}
                onPatch={(next) => patch(row.id, next)}
                onRemove={() => remove(row.id)}
              />
            ))}
          </div>
          <button type="button" className="prop-export-btn" disabled={busy} onClick={() => void exportAll()}>
            <span>Export {name}</span>
          </button>
          <button
            type="button"
            className={`prop-export-preview-toggle${previewOpen ? ' is-open' : ''}`}
            aria-expanded={previewOpen}
            onClick={() => setPreviewOpen((value) => !value)}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M3 1.5 5.5 4 3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Preview</span>
          </button>
          {previewOpen && (
            <div className="prop-export-preview">
              {previewUrl ? <img src={previewUrl} alt={`${name} preview`} draggable={false} /> : <span>Rendering…</span>}
            </div>
          )}
        </>
      )}
      {busy &&
        createPortal(
          <div className="export-toast" role="status">
            Exporting…
          </div>,
          document.body
        )}
    </section>
  )
}

function TextBlock({
  node,
  onPath,
  onPatch
}: {
  node: DesignNode
  onPath?: boolean
  onPatch: (patch: Partial<DesignNode>) => void
}) {
  const [typeOpen, setTypeOpen] = useState(false)
  const [typeAnchor, setTypeAnchor] = useState<{ top: number; left: number; right: number } | null>(null)
  const [sizeOpen, setSizeOpen] = useState(false)
  const typeBtn = useRef<HTMLButtonElement>(null)
  const sizeRoot = useRef<HTMLDivElement>(null)
  const family = node.fontFamily || 'Inter'
  const size = node.fontSize || 12
  const italic = node.fontStyle === 'italic'
  const styleId = fontStyleId(node.fontWeight, italic)
  const lineAuto = node.lineHeight == null || node.lineHeight <= 0
  const spacingUnit = node.letterSpacingUnit || (node.letterSpacing && node.letterSpacing > 3 ? 'px' : 'percent')
  const spacingDisplay =
    spacingUnit === 'px'
      ? node.letterSpacing || 0
      : node.letterSpacingUnit === 'percent' || !node.letterSpacing
        ? node.letterSpacing || 0
        : Math.round(((node.letterSpacing || 0) / size) * 1000) / 10
  const hAlign = node.textAlign || 'left'
  const vAlign = node.textAlignVertical || 'top'
  const closeTypeSettings = useCallback(() => setTypeOpen(false), [])

  useEffect(() => {
    ensureGoogleFontLoaded(family, node.fontWeight || 400, italic)
  }, [family, node.fontWeight, italic])

  useEffect(() => {
    if (!sizeOpen) return
    const onDown = (event: MouseEvent) => {
      if (!sizeRoot.current?.contains(event.target as Node)) setSizeOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSizeOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [sizeOpen])

  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Typography</span>
        <button type="button" className="prop-head-ico" title="Text styles" disabled>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
            <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
            <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
      <div className="prop-type-grid">
        <div className="prop-type-c12">
          <FontFamilyPicker
            value={family}
            onChange={(fontFamily) => {
              const next = nearestFontStyle(fontFamily, node.fontWeight, italic)
              onPatch({
                fontFamily,
                fontWeight: next.weight,
                fontStyle: next.italic ? 'italic' : 'normal'
              })
              void ensureGoogleFontLoaded(fontFamily, next.weight, next.italic)
            }}
          />
        </div>
        <div className="prop-type-c1">
          <FontStylePicker
            family={family}
            value={styleId}
            onChange={(option) => {
              onPatch({ fontWeight: option.weight, fontStyle: option.italic ? 'italic' : 'normal' })
              void ensureGoogleFontLoaded(family, option.weight, option.italic)
            }}
          />
        </div>
        <div className="prop-type-c2 prop-type-size-combo" ref={sizeRoot}>
          <input
            value={size}
            title="Font size"
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onPatch({ fontSize: Math.max(1, next) })
            }}
          />
          <button
            type="button"
            className={sizeOpen ? 'is-open' : undefined}
            title="Font size presets"
            onClick={() => setSizeOpen((value) => !value)}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {sizeOpen && (
            <div className="prop-blend-menu prop-type-size-list" role="listbox" aria-label="Font size">
              {FONT_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="option"
                  aria-selected={size === preset}
                  onClick={() => {
                    onPatch({ fontSize: preset })
                    setSizeOpen(false)
                  }}
                >
                  <span className="prop-blend-check">{size === preset ? '✓' : ''}</span>
                  <span>{preset}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="prop-pos-label prop-type-c1">Line height</div>
        <div className="prop-pos-label prop-type-c2">Letter spacing</div>
        <label className="prop-type-field prop-type-c1" title="Line height" onMouseEnter={() => window.dispatchEvent(new CustomEvent('scobe:line-height-hint',{detail:node.id}))} onMouseLeave={() => { if (!document.activeElement?.closest('[title="Line height"]')) window.dispatchEvent(new CustomEvent('scobe:line-height-hint',{detail:null})) }} onFocus={() => window.dispatchEvent(new CustomEvent('scobe:line-height-hint',{detail:node.id}))} onBlur={() => window.dispatchEvent(new CustomEvent('scobe:line-height-hint',{detail:null}))}>
          <span className="prop-type-metric-ico" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2.5 12h9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M4 10 7 2.5 10 10M5.2 7.2h3.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <input
              value={lineAuto ? 'Auto' : String(node.lineHeight)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                event.stopPropagation()
                // From Auto, start at the height the text is actually rendering with.
                const base = lineAuto
                  ? Math.round(measureTextLines(node, node.text || 'Text')[0]?.height || size * 1.2)
                  : node.lineHeight || 0
                const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
                onPatch({ lineHeight: Math.max(1, Math.round((base + step) * 100) / 100) })
                const input = event.currentTarget
                requestAnimationFrame(() => input.select())
              }}
              onChange={(event) => {
                const raw = event.target.value.trim().toLowerCase()
                if (raw === '' || raw === 'auto' || raw === 'a') {
                  onPatch({ lineHeight: 0 })
                  return
                }
                const next = Number(event.target.value)
                if (Number.isFinite(next)) onPatch({ lineHeight: Math.max(0, next) })
              }}
            />
          </label>
        <label className="prop-type-field prop-type-c2" title="Letter spacing">
          <span className="prop-type-metric-ico" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2.5v9M12 2.5v9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              <path d="M4.6 10 7 4l2.4 6M5.5 8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <input
            value={spacingUnit === 'percent' ? `${spacingDisplay}%` : spacingDisplay}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const raw = event.target.value.replace(/%/g, '').trim()
              const next = Number(raw)
              if (!Number.isFinite(next)) return
              onPatch({ letterSpacing: next, letterSpacingUnit: 'percent' })
            }}
          />
        </label>
        <div className="prop-pos-label prop-type-c12">Alignment</div>
        <div className="prop-type-seg prop-type-c1" role="group" aria-label="Horizontal alignment">
          {(
            [
              ['left', 'Align left'],
              ['center', 'Align center'],
              ['right', 'Align right']
            ] as const
          ).map(([align, title]) => (
            <button
              key={align}
              type="button"
              className={hAlign === align ? 'is-on' : undefined}
              title={title}
              onClick={() => onPatch({ textAlign: align })}
            >
              <TextAlignIcon kind={align} />
            </button>
          ))}
        </div>
        <div className="prop-type-seg prop-type-c2" role="group" aria-label="Vertical alignment">
          {(
            [
              ['top', 'Align top'],
              ['middle', 'Align middle'],
              ['bottom', 'Align bottom']
            ] as const
          ).map(([align, title]) => (
            <button
              key={align}
              type="button"
              className={vAlign === align ? 'is-on' : undefined}
              title={title}
              onClick={() => onPatch({ textAlignVertical: align })}
            >
              <TextVAlignIcon kind={align} />
            </button>
          ))}
        </div>
        <button
          ref={typeBtn}
          type="button"
          className={`prop-type-settings-btn prop-type-c3${typeOpen ? ' is-on' : ''}`}
          title="Type settings"
          onClick={() => {
            const rect = typeBtn.current?.getBoundingClientRect()
            setTypeAnchor(rect ? { top: rect.top, left: rect.left, right: rect.right } : null)
            setTypeOpen((value) => !value)
          }}
        >
          <TypeSettingsIcon />
        </button>
        {typeOpen && (
          <TypeSettingsPopup
            node={node}
            anchor={typeAnchor}
            ignoreRef={typeBtn}
            onPatch={onPatch}
            onClose={closeTypeSettings}
          />
        )}
        {onPath && (
          <button
            type="button"
            className={`prop-flip-path prop-type-c12${node.textPathFlip ? ' is-on' : ''}`}
            onClick={() => onPatch({ textPathFlip: !node.textPathFlip })}
          >
            Flip text orientation
          </button>
        )}
      </div>
    </section>
  )
}

const FONT_SIZE_PRESETS = [10, 11, 12, 13, 14, 15, 16, 20, 24, 32, 36, 40, 48, 64, 96, 128]

function FontFamilyPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => {
    const google = searchGoogleFonts(query, query.trim() ? 200 : allGoogleFonts().length)
    const system = SYSTEM_FONTS.filter((name) => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase()))
    return { google, system }
  }, [query])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
      // Warm the first page of previews so the list paints in each face.
      for (const font of searchGoogleFonts('', 40)) {
        void ensureGoogleFontLoaded(font.family, 400, false)
      }
    }
  }, [open])

  return (
    <div className="prop-font-picker" ref={root}>
      <button
        type="button"
        className={`prop-font-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ fontFamily: cssFontFamily(value) }}
      >
        <span>{value}</span>
        <em aria-hidden>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </em>
      </button>
      {open && (
        <div className="prop-font-menu" role="listbox" aria-label="Font family">
          <div className="prop-font-search">
            <input
              ref={inputRef}
              value={query}
              placeholder={`Search ${allGoogleFonts().length} Google fonts`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="prop-font-scroll">
            {results.system.length > 0 && (
              <div className="prop-font-group">
                <div className="prop-font-group-label">System</div>
                {results.system.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="option"
                    aria-selected={value === name}
                    className={value === name ? 'is-on' : undefined}
                    style={{ fontFamily: cssFontFamily(name) }}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                    }}
                  >
                    <span className="prop-blend-check">{value === name ? '✓' : ''}</span>
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="prop-font-group">
              <div className="prop-font-group-label">Google Fonts</div>
              {results.google.map((font) => (
                <button
                  key={font.family}
                  type="button"
                  role="option"
                  aria-selected={value === font.family}
                  className={value === font.family ? 'is-on' : undefined}
                  onMouseEnter={() => {
                    void ensureGoogleFontLoaded(font.family, 400, false)
                  }}
                  style={{ fontFamily: cssFontFamily(font.family) }}
                  onClick={() => {
                    void ensureGoogleFontLoaded(font.family, 400, false)
                    onChange(font.family)
                    setOpen(false)
                  }}
                >
                  <span className="prop-blend-check">{value === font.family ? '✓' : ''}</span>
                  <span>{font.family}</span>
                </button>
              ))}
              {results.google.length === 0 && <div className="prop-font-empty">No fonts match</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FontStylePicker({
  family,
  value,
  onChange
}: {
  family: string
  value: string
  onChange: (option: FontStyleOption) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const options = stylesForFamily(family)
  const current =
    options.find((item) => item.id === value) ||
    nearestFontStyle(family, Number.parseInt(value, 10) || 400, value.endsWith('i'))
  const upright = options.filter((item) => !item.italic)
  const italics = options.filter((item) => item.italic)
  const variable = familyHasVariableAxes(family)
  const limited = options.length <= 2

  useEffect(() => {
    void ensureGoogleFontLoaded(family, current.weight, current.italic)
  }, [family, current.weight, current.italic])

  useEffect(() => {
    if (!open) return
    for (const option of stylesForFamily(family).slice(0, 16)) {
      void ensureGoogleFontLoaded(family, option.weight, option.italic)
    }
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, family])

  return (
    <div className="prop-font-picker" ref={root}>
      <button
        type="button"
        className={`prop-font-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          fontFamily: cssFontFamily(family),
          fontWeight: current.weight,
          fontStyle: current.italic ? 'italic' : 'normal'
        }}
      >
        <span>{current.label}</span>
        <em aria-hidden>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </em>
      </button>
      {open && (
        <div className="prop-font-style-menu" role="listbox" aria-label="Font style">
          {limited && (
            <div className="prop-font-empty">
              This font only includes {options.map((option) => option.label).join(', ')}
            </div>
          )}
          <div className="prop-font-style-group">
            {upright.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={value === option.id}
                className={value === option.id ? 'is-on' : undefined}
                style={{ fontFamily: cssFontFamily(family), fontWeight: option.weight }}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
              >
                <span className="prop-blend-check">{value === option.id ? '✓' : ''}</span>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          {italics.length > 0 && (
            <div className="prop-font-style-group">
              {italics.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={value === option.id}
                  className={value === option.id ? 'is-on' : undefined}
                  style={{
                    fontFamily: cssFontFamily(family),
                    fontWeight: option.weight,
                    fontStyle: 'italic'
                  }}
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                >
                  <span className="prop-blend-check">{value === option.id ? '✓' : ''}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          )}
          {variable && (
            <div className="prop-font-style-group">
              <button type="button" className="prop-font-style-action" disabled title="Coming soon">
                Variable font axes...
              </button>
            </div>
          )}
          <div className="prop-font-style-group">
            <button type="button" className="prop-font-style-action" disabled title="Coming soon">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path
                  d="M6 1.2 10.2 3.6v4.8L6 10.8 1.8 8.4V3.6L6 1.2Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
                <circle cx="6" cy="6" r="1.2" fill="currentColor" />
              </svg>
              Apply variable...
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SelectionColorsBlock({
  node,
  nodes,
  onPatchNode,
  onPatchMany
}: {
  node: DesignNode
  nodes: DesignNode[]
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
  onPatchMany?: (patches: Array<{ id: string; patch: Partial<DesignNode> }>) => void
}) {
  type ColorHit = { hex: string; opacity: number }
  /** Everything that used the color when its picker opened, so switching to a gradient/image keeps editing the same slots. */
  type ColorTargets = {
    fills: Array<{ id: string; index: number }>
    stops: Array<{ id: string; index: number; stopId: string }>
    strokes: string[]
  }

  const [editing, setEditing] = useState<
    (ColorHit & { anchor: DOMRect | null; paint: Paint; targets: ColorTargets }) | null
  >(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => setEditing(null), [node.id])

  const subtree = useMemo(() => {
    const kids = (parentId: string): DesignNode[] => {
      const direct = nodes.filter((item) => item.parentId === parentId)
      return direct.flatMap((child) => [child, ...kids(child.id)])
    }
    return [node, ...kids(node.id)]
  }, [node, nodes])

  const colors = useMemo(() => {
    const list: ColorHit[] = []
    const seen = new Set<string>()
    const push = (hex: string, opacity01: number) => {
      const normalized = toHex(hex, '#000000')
      const opacity = Math.round(Math.max(0, Math.min(1, opacity01)) * 100)
      const key = `${normalized}:${opacity}`
      if (seen.has(key)) return
      seen.add(key)
      list.push({ hex: normalized, opacity })
    }
    for (const item of subtree) {
      for (const paint of getNodePaints(item)) {
        if (paint.visible === false) continue
        if (paint.type === 'solid') push(paint.color, paint.opacity)
        if (paint.type === 'gradient') {
          for (const stop of paint.stops) push(stop.color, stop.opacity * paint.opacity)
        }
      }
      if (item.strokeWidth && item.strokeWidth > 0 && item.stroke) {
        push(item.stroke, item.strokeOpacity ?? 1)
      }
    }
    return list
  }, [subtree])

  if (!colors.length) return null

  const matches = (hex: string, opacityPct: number, color: string, opacity01: number) =>
    toHex(color, '#000000') === hex && Math.round(Math.max(0, Math.min(1, opacity01)) * 100) === opacityPct

  const replaceColor = (from: ColorHit, nextHex: string, nextOpacityPct: number) => {
    const hex = toHex(nextHex, from.hex)
    const opacityPct = Math.max(0, Math.min(100, Math.round(nextOpacityPct)))
    const opacity01 = opacityPct / 100
    if (hex === from.hex && opacityPct === from.opacity) return

    const patches: Array<{ id: string; patch: Partial<DesignNode> }> = []
    for (const item of subtree) {
      const patch: Partial<DesignNode> = {}
      let changed = false

      const paints = getNodePaints(item)
      if (paints.length) {
        let paintChanged = false
        const nextPaints = paints.map((paint) => {
          if (paint.visible === false) return paint
          if (paint.type === 'solid' && matches(from.hex, from.opacity, paint.color, paint.opacity)) {
            paintChanged = true
            return { ...paint, color: hex, opacity: opacity01 }
          }
          if (paint.type === 'gradient') {
            let stopChanged = false
            const stops = paint.stops.map((stop) => {
              const stopOpacity = stop.opacity * paint.opacity
              if (!matches(from.hex, from.opacity, stop.color, stopOpacity)) return stop
              stopChanged = true
              const relative = paint.opacity > 0.001 ? Math.min(1, opacity01 / paint.opacity) : opacity01
              return { ...stop, color: hex, opacity: relative }
            })
            if (stopChanged) {
              paintChanged = true
              return { ...paint, stops }
            }
          }
          return paint
        })
        if (paintChanged) {
          const legacy = legacyFromPaints(nextPaints)
          patch.fills = nextPaints
          patch.fill = legacy.fill
          patch.fillOpacity = legacy.fillOpacity
          changed = true
        }
      }

      if (
        item.strokeWidth &&
        item.strokeWidth > 0 &&
        item.stroke &&
        matches(from.hex, from.opacity, item.stroke, item.strokeOpacity ?? 1)
      ) {
        patch.stroke = hex
        patch.strokeOpacity = opacity01
        changed = true
      }

      if (changed) patches.push({ id: item.id, patch })
    }

    if (!patches.length) return
    if (onPatchMany) {
      onPatchMany(patches)
      return
    }
    for (const entry of patches) onPatchNode(entry.id, entry.patch)
  }

  const collectTargets = (from: ColorHit): ColorTargets => {
    const targets: ColorTargets = { fills: [], stops: [], strokes: [] }
    for (const item of subtree) {
      (item.type === 'line' || item.type === 'arrow' ? [] : getNodePaints(item)).forEach((paint, index) => {
        if (paint.visible === false) return
        if (paint.type === 'solid' && matches(from.hex, from.opacity, paint.color, paint.opacity)) {
          targets.fills.push({ id: item.id, index })
        }
        if (paint.type === 'gradient') {
          for (const stop of paint.stops) {
            if (matches(from.hex, from.opacity, stop.color, stop.opacity * paint.opacity)) {
              targets.stops.push({ id: item.id, index, stopId: stop.id })
            }
          }
        }
      })
      if (item.strokeWidth && item.strokeWidth > 0 && item.stroke && matches(from.hex, from.opacity, item.stroke, item.strokeOpacity ?? 1)) {
        targets.strokes.push(item.id)
      }
    }
    return targets
  }

  /** Apply any paint from the full picker: fills take it as-is; gradient stops and strokes take its solid color. */
  const applyPaint = (targets: ColorTargets, paint: Paint) => {
    const solid = paint.type === 'solid' ? paint : null
    const byId = new Map(subtree.map((item) => [item.id, item]))
    const ids = new Set([...targets.fills.map((t) => t.id), ...targets.stops.map((t) => t.id), ...targets.strokes])
    const patches: Array<{ id: string; patch: Partial<DesignNode> }> = []
    for (const id of ids) {
      const item = byId.get(id)
      if (!item) continue
      const patch: Partial<DesignNode> = {}
      const fillSlots = targets.fills.filter((t) => t.id === id)
      const stopSlots = targets.stops.filter((t) => t.id === id)
      if (fillSlots.length || (solid && stopSlots.length)) {
        const nextPaints = getNodePaints(item).map((current, index) => {
          if (fillSlots.some((t) => t.index === index)) return { ...paint, visible: true } as Paint
          if (solid && current.type === 'gradient') {
            const hits = stopSlots.filter((t) => t.index === index)
            if (!hits.length) return current
            const relative = current.opacity > 0.001 ? Math.min(1, solid.opacity / current.opacity) : solid.opacity
            return {
              ...current,
              stops: current.stops.map((stop) =>
                hits.some((t) => t.stopId === stop.id) ? { ...stop, color: solid.color, opacity: relative } : stop
              )
            }
          }
          return current
        })
        const legacy = legacyFromPaints(nextPaints)
        patch.fills = nextPaints
        patch.fill = legacy.fill
        patch.fillOpacity = legacy.fillOpacity
      }
      if (solid && targets.strokes.includes(id)) {
        patch.stroke = toHex(solid.color, '#000000')
        patch.strokeOpacity = solid.opacity
      }
      if (Object.keys(patch).length) patches.push({ id, patch })
    }
    if (!patches.length) return
    if (onPatchMany) onPatchMany(patches)
    else for (const entry of patches) onPatchNode(entry.id, entry.patch)
  }

  return (
    <section className="prop-section">
      <div className="prop-section-head">Selection colors</div>
      <div className="prop-selection-colors">
        {colors.map((color) => {
          const key = `${color.hex}-${color.opacity}`
          const open = editing?.hex === color.hex && editing.opacity === color.opacity
          return (
            <FillRow
              key={key}
              hex={color.hex}
              opacity={color.opacity}
              rowRef={(el) => {
                if (el) rowRefs.current.set(key, el)
                else rowRefs.current.delete(key)
              }}
              onSwatch={() =>
                setEditing(
                  open
                    ? null
                    : {
                        ...color,
                        anchor: rowRefs.current.get(key)?.getBoundingClientRect() || null,
                        paint: defaultSolid(color.hex, color.opacity / 100),
                        targets: collectTargets(color)
                      }
                )
              }
              onHex={(next) => replaceColor(color, next, color.opacity)}
              onOpacity={(next) => replaceColor(color, color.hex, next)}
            />
          )
        })}
      </div>
      {editing && (
        <FillPicker
          paint={editing.paint}
          pageColors={colors.map((color) => ({ color: color.hex, opacity: color.opacity / 100 }))}
          anchor={editing.anchor}
          onChange={(next) => {
            applyPaint(editing.targets, next)
            if (next.type === 'solid') {
              const hex = toHex(next.color, editing.hex)
              const opacity = Math.max(0, Math.min(100, Math.round(next.opacity * 100)))
              setEditing({ ...editing, hex, opacity, paint: next })
            } else {
              setEditing({ ...editing, paint: next })
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function NumField({
  prefix,
  suffix,
  value,
  onChange
}: {
  prefix?: ReactNode
  suffix?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="prop-num">
      {prefix != null && prefix !== '' && <span>{prefix}</span>}
      <input
        value={Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}
