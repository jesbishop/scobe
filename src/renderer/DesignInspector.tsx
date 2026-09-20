import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { AutoLayout, AutoLayoutAlign, AutoLayoutJustify, BrowserFrame, DesignNode, DesignPage, DesignTool, ExportFormat, ExportSetting, LayoutSizing } from '../shared/types'
import { BROWSER_SIZE_PRESETS, FRAME_PRESET_CATEGORIES, type FramePreset } from '../shared/framePresets'
import {
  defaultSolid,
  getNodePaints,
  legacyFromPaints,
  paintLabel,
  paintPreviewCss,
  type Paint
} from '../shared/paint'
import { defaultFrameLayout } from '../shared/layoutEngine'
import { BLEND_MODE_GROUPS, normalizeBlendMode } from '../shared/blendModes'
import {
  defaultEffect,
  effectLabel,
  EFFECT_TYPE_OPTIONS,
  getNodeEffects,
  syncLegacyEffectFields,
  type DesignEffect,
  type EffectBlurMode,
  type EffectType,
  type NoiseType
} from '../shared/effects'
import {
  cornersAreIndependent,
  resolveCornerRadii,
  uniformRadii,
  type CornerRadii
} from '../shared/corners'
import { canAlignNodes, type AlignAction } from './alignGuides'
import { measureSelectionGaps } from './selectionSpace'
import type { InspectInfo } from '../shared/types'
import { nodeBounds } from './canvasMath'
import { FillPicker } from './FillPicker'
import { FramePresetsPanel } from './FramePresetsPanel'
import { isTextOnPath } from './textPath'
import {
  DEFAULT_EXPORT_SETTING,
  EXPORT_FORMATS,
  EXPORT_SCALES,
  exportNodeSetting
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
  onPatchPage,
  onPatchNode,
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
  onPatchPage: (patch: Partial<DesignPage>) => void
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
  onPatchBrowser: (id: string, patch: { x?: number; y?: number; width?: number; height?: number }) => void
  onSpawnFrame?: (preset: FramePreset) => void
  onSpawnBrowser?: (preset: FramePreset) => void
}) {
  if (tool === 'frame' && onSpawnFrame) {
    return (
      <FramePresetsPanel
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
    const typeLabel = isSection
      ? 'Section'
      : isText
        ? onPath
          ? 'Text on path'
          : 'Text'
        : node.type === 'frame'
          ? 'Frame'
          : node.type === 'ellipse'
            ? 'Ellipse'
            : node.type === 'rect'
              ? 'Rectangle'
              : node.type === 'path'
                ? 'Vector'
                : node.type[0].toUpperCase() + node.type.slice(1)
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : null
    const inAutoLayout =
      Boolean(parent && parent.type === 'frame' && parent.layout && parent.layout.mode !== 'none')
    const frameAuto = node.type === 'frame' && node.layout && node.layout.mode !== 'none'
    // Fill/Relative only apply while flowing in a parent flex (not absolute).
    const allowFill = inAutoLayout && !node.layoutAbsolute
    const showDims = !frameAuto
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

    return (
      <>
        <div className="prop-node-head">
          <div className="prop-node-title">
            {alignIds.length > 1 ? `${alignIds.length} selected` : node.name || node.text || typeLabel}
          </div>
          <div className="prop-node-actions">
            <button type="button" className="prop-head-ico" title="Create component" disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M7 1.5 12.5 7 7 12.5 1.5 7 7 1.5Z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button type="button" className="prop-head-ico" title="Apply style" disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
                <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
                <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </button>
            <button type="button" className="prop-head-ico prop-head-ico-caret" title="More" disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M5 7h4M7 5v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M9.768 6.768a.5.5 0 0 1 .707.707l-2.12 2.121a.5.5 0 0 1-.708 0L5.525 7.475a.5.5 0 0 1 .708-.707l1.768 1.767z" fill="currentColor" />
              </svg>
            </button>
            <button type="button" className="prop-head-ico" title="Focus" disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
                <path d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <PositionBlock
          x={box.x}
          y={box.y}
          rotation={node.rotation || 0}
          flipX={Boolean(node.flipX)}
          flipY={Boolean(node.flipY)}
          canAlign={alignOn}
          onAlign={onAlign}
          onChange={(patch) => onPatchNode(node.id, patch)}
        />
        {(showDims || inAutoLayout || frameAuto || isText || hasSpacing) && (
          <LayoutDimsBlock
            width={box.width}
            height={isText ? box.height || node.fontSize || 12 : box.height}
            aspectLocked={Boolean(node.aspectLocked)}
            showDimensions={showDims || inAutoLayout || frameAuto}
            showResizing={inAutoLayout || isText || Boolean(frameAuto)}
            sizingH={
              isText
                ? textResize === 'auto-width'
                  ? 'hug'
                  : sizingH === 'fill'
                    ? 'fill'
                    : 'fixed'
                : frameAuto
                  ? sizingH === 'fill' || sizingH === 'relative'
                    ? sizingH
                    : node.layout?.sizingH === 'hug'
                      ? 'hug'
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
                : frameAuto
                  ? sizingV === 'fill' || sizingV === 'relative'
                    ? sizingV
                    : node.layout?.sizingV === 'hug'
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
            flexFrame={frameAuto ? node.layout : undefined}
            allowFill={allowFill}
            showAbsolute={inAutoLayout}
            absolute={Boolean(node.layoutAbsolute)}
            onChange={(patch) => onPatchNode(node.id, patch)}
            spacing={
              hasSpacing && spacing && onSpace
                ? { hGap: spacing.hGap, vGap: spacing.vGap, onChange: onSpace }
                : null
            }
          />
        )}
        {node.type === 'frame' && (
          <AutoLayoutBlock
            layout={node.layout}
            clipsContent={node.clipsContent !== false}
            onChange={(layout) => onPatchNode(node.id, { layout })}
            onClips={(clipsContent) => onPatchNode(node.id, { clipsContent })}
          />
        )}
        <AppearanceBlock
          nodeId={node.id}
          opacity={(node.opacity ?? 1) * 100}
          blend={normalizeBlendMode(node.blendMode)}
          radii={
            isBox || isText
              ? resolveCornerRadii(node, isSection ? 2 : 0)
              : undefined
          }
          onOpacity={(opacity) => onPatchNode(node.id, { opacity: opacity / 100 })}
          onBlend={(blendMode) => onPatchNode(node.id, { blendMode })}
          onRadii={
            isBox || isText
              ? (next, mode) => {
                  onPatchNode(node.id, {
                    radius: next.tl,
                    cornerRadii: mode === 'independent' ? next : undefined
                  })
                }
              : undefined
          }
        />
        {isText && (
          <TextBlock
            node={node}
            onPath={onPath}
            onPatch={(patch) => onPatchNode(node.id, patch)}
          />
        )}
        <FillBlock
          paints={getNodePaints(node)}
          fallbackHex={fill}
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
        />
        <StrokeBlock
          enabled={Boolean(node.strokeWidth) || isSection}
          hex={stroke}
          width={node.strokeWidth || 1}
          opacity={Math.round((node.strokeOpacity ?? (isSection ? 0.1 : 1)) * 100)}
          align={strokeAlign}
          showAlign={node.type !== 'line' && node.type !== 'arrow'}
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
        />
        <EffectsBlock
          node={node}
          onPatch={(patch) => onPatchNode(node.id, patch)}
        />
        <SelectionColorsBlock node={node} nodes={nodes} onPatchNode={onPatchNode} />
        <ExportBlock
          settings={node.exportSettings || []}
          onChange={(exportSettings) => onPatchNode(node.id, { exportSettings })}
          onExport={async (setting) => {
            try {
              await exportNodeSetting(node, setting, nodes)
            } catch {
              /* ignore */
            }
          }}
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
      <section className="prop-section prop-section-page">
        <div className="prop-section-head">Background</div>
        <FillRow
          hex={toHex(page.fill, '#EEEEEE')}
          opacity={100}
          onHex={(fill) => onPatchPage({ fill })}
        />
      </section>
      <section className="prop-section">
        <div className="prop-section-head prop-add-head">
          <span>Variables</span>
          <button type="button" title="Add variable" disabled>
            +
          </button>
        </div>
      </section>
      <section className="prop-section">
        <div className="prop-section-head prop-add-head">
          <span>Styles</span>
          <button type="button" title="Add style" disabled>
            +
          </button>
        </div>
      </section>
      <section className="prop-section">
        <div className="prop-section-head prop-add-head">
          <span>Export</span>
          <button type="button" title="Add export" disabled>
            +
          </button>
        </div>
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
  onChange: (patch: {
    x?: number
    y?: number
    rotation?: number
    flipX?: boolean
    flipY?: boolean
  }) => void
}) {
  return (
    <section className="prop-section prop-section-position">
      <div className="prop-section-head">Position</div>
      <div className="prop-field-row prop-align-labeled">
        <span className="prop-field-label" />
        <div className="prop-align-row" aria-label="Align">
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
              className="prop-align-ico"
              title={canAlign ? title : 'Select two objects, or one object inside a frame'}
              disabled={!canAlign || !onAlign}
              onClick={() => onAlign?.(id)}
            >
              <AlignIcon kind={id} />
            </button>
          ))}
        </div>
        <div className="prop-align-row" aria-label="Align vertical">
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
              className="prop-align-ico"
              title={canAlign ? title : 'Select two objects, or one object inside a frame'}
              disabled={!canAlign || !onAlign}
              onClick={() => onAlign?.(id)}
            >
              <AlignIcon kind={id} />
            </button>
          ))}
        </div>
      </div>
      <div className="prop-field-row">
        <span className="prop-field-label">Position</span>
        <NumField prefix="X" value={x} onChange={(next) => onChange({ x: next })} />
        <NumField prefix="Y" value={y} onChange={(next) => onChange({ y: next })} />
      </div>
      {!hideRotation && (
        <div className="prop-field-row">
          <span className="prop-field-label">Rotation</span>
          <NumField prefix="°" value={rotation} onChange={(next) => onChange({ rotation: next })} />
          <div className="prop-flip-btns">
            <button
              type="button"
              className={flipX ? 'is-on' : undefined}
              title="Flip horizontal"
              aria-pressed={Boolean(flipX)}
              onClick={() => onChange({ flipX: !flipX })}
            >
              <FlipIcon axis="x" />
            </button>
            <button
              type="button"
              className={flipY ? 'is-on' : undefined}
              title="Flip vertical"
              aria-pressed={Boolean(flipY)}
              onClick={() => onChange({ flipY: !flipY })}
            >
              <FlipIcon axis="y" />
            </button>
            <button type="button" title="Rotate 90°" disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M3 7a4 4 0 1 1 4 4"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <path d="M3 7V4.5M3 7H5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </section>
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
  onChange
}: {
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
        <div className="prop-field-row prop-field-row-size-modes">
          <SizeModeField
            axis="W"
            mode={modeH}
            value={modeH === 'relative' ? percentH : width}
            modes={modes}
            onMode={setSizingH}
            onValue={setWidth}
          />
          <div className="prop-dim-trail">
            <SizeModeField
              axis="H"
              mode={modeV}
              value={modeV === 'relative' ? percentV : height}
              modes={modes}
              onMode={setSizingV}
              onValue={setHeight}
            />
            <button
              type="button"
              className={`prop-aspect-lock${aspectLocked ? ' is-on' : ''}`}
              title={aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
              aria-pressed={Boolean(aspectLocked)}
              onClick={() => onChange({ aspectLocked: !aspectLocked })}
            >
              {aspectLocked ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M4 5V3.8A1.8 1.8 0 0 1 5.8 2h.4A1.8 1.8 0 0 1 8 3.8V5M3.5 5h5c.55 0 1 .45 1 1v3.5c0 .55-.45 1-1 1h-5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path
                    d="M4 5V3.8A1.8 1.8 0 0 1 5.8 2h.4A1.8 1.8 0 0 1 8 3.8M3.5 5h5c.55 0 1 .45 1 1v3.5c0 .55-.45 1-1 1h-5c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
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
  if (kind === 'left') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 2v10M5 4.5h7M5 9.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'hcenter') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M7 2v10M3.5 4.5h7M4.5 9.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'right') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M12 2v10M2 4.5h7M4 9.5h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'top') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 2h10M4.5 5v7M9.5 5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'vcenter') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 7h10M4.5 3.5v7M9.5 4.5v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 12h10M4.5 2v7M9.5 4v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function FlipIcon({ axis }: { axis: 'x' | 'y' }) {
  if (axis === 'x') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M7 2v10M3.5 4.5 1.5 7l2 2.5M10.5 4.5 12.5 7l-2 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 7h10M4.5 3.5 7 1.5l2.5 2M4.5 10.5 7 12.5l2.5-2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AutoLayoutBlock({
  layout,
  clipsContent,
  onChange,
  onClips
}: {
  layout?: AutoLayout
  clipsContent: boolean
  onChange: (layout: AutoLayout) => void
  onClips: (clips: boolean) => void
}) {
  const [padIndependent, setPadIndependent] = useState(false)
  const active = layout && layout.mode !== 'none'
  const mode = layout?.mode === 'vertical' ? 'vertical' : 'horizontal'
  const wrap = Boolean(layout?.wrap)
  const gapAuto = layout?.gap === 'auto' || layout?.justifyContent === 'space-between'
  const gap = typeof layout?.gap === 'number' ? layout.gap : 0
  const align = layout?.alignItems || 'start'
  const justify = gapAuto ? 'space-between' : layout?.justifyContent || 'start'
  const pad = typeof layout?.padding === 'number'
    ? { t: layout.padding, r: layout.padding, b: layout.padding, l: layout.padding }
    : layout?.padding || { t: 0, r: 0, b: 0, l: 0 }
  const padX = Math.round(((pad.l ?? 0) + (pad.r ?? 0)) / 2)
  const padY = Math.round(((pad.t ?? 0) + (pad.b ?? 0)) / 2)
  const showIndependent =
    padIndependent || pad.t !== pad.b || pad.l !== pad.r || pad.t !== pad.l

  const enable = (partial: Partial<AutoLayout> = {}) => {
    const base = active ? { ...defaultFrameLayout(), ...layout } : defaultFrameLayout()
    const next = { ...base, ...partial, mode: partial.mode || base.mode || 'horizontal' }
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

  const setAlign = (nextJustify: AutoLayoutJustify, nextAlign: AutoLayoutAlign) => {
    enable({ justifyContent: nextJustify, alignItems: nextAlign })
  }

  const alignmentCell = (j: AutoLayoutJustify, a: AutoLayoutAlign) => {
    const on = justify === j && align === a
    return (
      <button
        key={`${j}-${a}`}
        type="button"
        className={on ? 'is-on' : undefined}
        title={`${j} / ${a}`}
        onClick={() => setAlign(j, a)}
      />
    )
  }

  if (!active) {
    return (
      <section className="prop-section">
        <div className="prop-section-head prop-add-head">
          <span>Flex</span>
          <button type="button" onClick={() => onChange(defaultFrameLayout())}>
            +
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="prop-section al-section">
      <div className="prop-section-head prop-add-head">
        <span>Flex</span>
        <button type="button" title="Remove flex" onClick={() => onChange({ mode: 'none' })}>
          –
        </button>
      </div>

      <div className="al-row">
        <span className="al-label">Flow</span>
        <div className="al-flow">
          <button
            type="button"
            className={mode === 'vertical' && !wrap ? 'is-on' : undefined}
            title="Vertical"
            onClick={() => enable({ mode: 'vertical', wrap: false })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 2v10M7 12l-3-3M7 12l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={mode === 'horizontal' && !wrap ? 'is-on' : undefined}
            title="Horizontal"
            onClick={() => enable({ mode: 'horizontal', wrap: false })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M12 7l-3-3M12 7l-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className={wrap ? 'is-on' : undefined}
            title="Wrap"
            onClick={() => enable({ mode: mode === 'vertical' ? 'vertical' : 'horizontal', wrap: true })}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
              <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
              <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="al-row al-align-row">
        <span className="al-label">Alignment</span>
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
          <label className="al-gap-field" title="Gap between items">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
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
        </div>
      </div>

      <div className="al-row">
        <span className="al-label">Padding</span>
        <div className="al-padding-wrap">
          {showIndependent ? (
            <div className="al-padding al-padding-4">
              <NumField prefix="T" value={pad.t} onChange={(t) => enable({ padding: { ...pad, t } })} />
              <NumField prefix="R" value={pad.r} onChange={(r) => enable({ padding: { ...pad, r } })} />
              <NumField prefix="B" value={pad.b} onChange={(b) => enable({ padding: { ...pad, b } })} />
              <NumField prefix="L" value={pad.l} onChange={(l) => enable({ padding: { ...pad, l } })} />
            </div>
          ) : (
            <div className="al-padding">
              <label className="al-pad-field" title="Horizontal padding">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
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
              <label className="al-pad-field" title="Vertical padding">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
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
            className={`al-pad-toggle${showIndependent ? ' is-on' : ''}`}
            title="Independent padding"
            onClick={() => setPadIndependent((value) => !value)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            </svg>
          </button>
        </div>
      </div>

      <label className="al-clip">
        <input type="checkbox" checked={clipsContent} onChange={(event) => onClips(event.target.checked)} />
        Clip content
      </label>
    </section>
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
  onOpacity,
  onBlend,
  onRadii
}: {
  nodeId?: string
  opacity: number
  blend: string
  radii?: CornerRadii
  onOpacity: (value: number) => void
  onBlend: (value: string) => void
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
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Appearance</span>
        <div className="prop-section-actions" ref={root}>
          <button type="button" className="prop-head-ico" title="Visibility" disabled>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M1.5 7s2.2-3.5 5.5-3.5S12.5 7 12.5 7s-2.2 3.5-5.5 3.5S1.5 7 1.5 7Z"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <circle cx="7" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className={`prop-head-ico${open ? ' is-on' : ''}`}
            onClick={() => setOpen((value) => !value)}
            title={`Blend mode: ${current}`}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <circle cx="5.5" cy="5.5" r="3.25" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8.5" cy="5.5" r="3.25" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="7" cy="8.5" r="3.25" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          {open && (
            <div className="prop-blend-menu prop-blend-menu-head" role="listbox" aria-label="Blend mode">
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
      <div
        className={`prop-appearance${onRadii != null ? '' : ' is-opacity-only'}${
          showIndependent ? ' is-corners-independent' : ''
        }`}
      >
        <span className="prop-field-label prop-appear-label-op">Opacity</span>
        <div className="prop-appear-field-op">
          <NumField
            prefix={
              <span className="prop-opacity-ico" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.1" />
                  <path d="M1.5 7.5h9M4.5 1.5v9" stroke="currentColor" strokeWidth="1.1" opacity="0.45" />
                </svg>
              </span>
            }
            suffix="%"
            value={Math.round(opacity)}
            onChange={onOpacity}
          />
        </div>
        {onRadii != null && radii && (
          <>
            <span className="prop-field-label prop-appear-label-rad">Corner radius</span>
            <div className="prop-appear-field-rad prop-radius-pair">
              {showIndependent ? (
                <div className="prop-radius-grid">
                  <NumField prefix={<CornerIcon corner="tl" />} value={radii.tl} onChange={(v) => setCorner('tl', v)} />
                  <NumField prefix={<CornerIcon corner="tr" />} value={radii.tr} onChange={(v) => setCorner('tr', v)} />
                  <NumField prefix={<CornerIcon corner="bl" />} value={radii.bl} onChange={(v) => setCorner('bl', v)} />
                  <NumField prefix={<CornerIcon corner="br" />} value={radii.br} onChange={(v) => setCorner('br', v)} />
                </div>
              ) : (
                <NumField
                  prefix={<CornerIcon corner="tl" />}
                  value={radii.tl}
                  onChange={setUniform}
                />
              )}
              <button
                type="button"
                className={`prop-head-ico${showIndependent ? ' is-on' : ''}`}
                title="Independent corners"
                onClick={toggleIndependent}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M3 5.5V4a1 1 0 0 1 1-1h1.5M9.5 3H11a1 1 0 0 1 1 1v1.5M12 9.5V11a1 1 0 0 1-1 1H9.5M5.5 12H4a1 1 0 0 1-1-1V9.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function FillBlock({
  paints,
  fallbackHex,
  onChange
}: {
  paints: Paint[]
  fallbackHex: string
  onChange: (paints: Paint[]) => void
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const list = paints

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
    onChange([...list, defaultSolid(fallbackHex || '#D9D9D9')])
  }

  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Fill</span>
        <div className="prop-section-actions">
          <button type="button" className="prop-head-ico" title="Fill styles" disabled>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
              <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
              <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
              <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
              <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button type="button" onClick={addFill} title="Add fill">
            +
          </button>
        </div>
      </div>
      {list.length > 0 && (
      <div className="prop-fill-stack">
        {list.map((paint, index) => {
          const visible = paint.visible !== false
          return (
            <div
              key={index}
              className="prop-fill-card prop-fill-card-rich"
              ref={(el) => {
                rowRefs.current[index] = el
              }}
            >
              <button
                type="button"
                className="prop-fill-swatch-btn"
                style={{ background: paintPreviewCss(paint) }}
                title="Edit fill"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              />
              <button
                type="button"
                className="prop-fill-label-btn"
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
              >
                {paintLabel(paint)}
              </button>
              <NumField
                value={Math.round(paint.opacity * 100)}
                suffix="%"
                onChange={(opacity) => patchAt(index, { ...paint, opacity: Math.max(0, Math.min(1, opacity / 100)) })}
              />
              <button
                type="button"
                className="prop-fill-eye"
                title={visible ? 'Hide' : 'Show'}
                onClick={() => patchAt(index, { ...paint, visible: !visible })}
              >
                {visible ? '◉' : '〇'}
              </button>
              <button type="button" className="prop-fill-remove" title="Remove" onClick={() => removeAt(index)}>
                –
              </button>
              {openIndex === index && (
                <FillPicker
                  paint={paint}
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

function FillRow({
  hex,
  opacity,
  onHex,
  onOpacity
}: {
  hex: string
  opacity: number
  onHex: (value: string) => void
  onOpacity?: (value: number) => void
}) {
  return (
    <div className="prop-fill-card">
      <label className="prop-swatch-wrap" style={{ '--swatch': hex } as CSSProperties}>
        <input
          type="color"
          value={hex}
          onChange={(event) => onHex(event.target.value.toUpperCase())}
        />
      </label>
      <input
        className="prop-hex-input"
        value={hex.replace('#', '')}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
          if (next.length === 6) onHex(`#${next.toUpperCase()}`)
        }}
      />
      {onOpacity && <NumField value={opacity} suffix="%" onChange={onOpacity} />}
    </div>
  )
}

function StrokeBlock({
  enabled,
  hex,
  width,
  opacity = 100,
  align = 'inside',
  showAlign = true,
  onToggle,
  onHex,
  onWidth,
  onOpacity,
  onAlign
}: {
  enabled: boolean
  hex: string
  width: number
  opacity?: number
  align?: 'center' | 'inside' | 'outside'
  showAlign?: boolean
  onToggle: () => void
  onHex: (value: string) => void
  onWidth: (value: number) => void
  onOpacity?: (value: number) => void
  onAlign: (value: 'center' | 'inside' | 'outside') => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const alignLabel = align === 'inside' ? 'Inside' : align === 'outside' ? 'Outside' : 'Center'

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Stroke</span>
        <button type="button" onClick={onToggle} aria-label={enabled ? 'Remove stroke' : 'Add stroke'}>
          {enabled ? '–' : '+'}
        </button>
      </div>
      {enabled && (
        <div className="prop-stroke-stack">
          <FillRow hex={hex} opacity={opacity} onHex={onHex} onOpacity={onOpacity} />
          <div className="prop-stroke">
            {showAlign && (
              <div className="prop-stroke-pos" ref={menuRef}>
                <button
                  type="button"
                  className={`prop-stroke-pos-trigger${menuOpen ? ' is-open' : ''}`}
                  title="Stroke position"
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  <StrokeAlignIcon align={align} />
                  <span>{alignLabel}</span>
                  <em>▾</em>
                </button>
                {menuOpen && (
                  <div className="prop-stroke-pos-menu" role="listbox" aria-label="Stroke position">
                    {(
                      [
                        ['inside', 'Inside'],
                        ['center', 'Center'],
                        ['outside', 'Outside']
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="option"
                        aria-selected={align === value}
                        className={align === value ? 'is-on' : undefined}
                        onClick={() => {
                          onAlign(value)
                          setMenuOpen(false)
                        }}
                      >
                        <span className="prop-blend-check" aria-hidden>
                          {align === value ? '✓' : ''}
                        </span>
                        <StrokeAlignIcon align={value} />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <NumField prefix="W" value={width} onChange={onWidth} />
          </div>
        </div>
      )}
    </section>
  )
}

function StrokeAlignIcon({ align }: { align: 'inside' | 'center' | 'outside' }) {
  if (align === 'inside') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="4" y="4" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.35" />
      </svg>
    )
  }
  if (align === 'outside') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" fill="currentColor" opacity="0.35" />
        <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" opacity="0.25" />
      <rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
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
  const [typeMenuId, setTypeMenuId] = useState<string | null>(null)
  const openEffect = effects.find((fx) => fx.id === openId) || null

  const commit = (next: DesignEffect[]) => {
    onPatch(syncLegacyEffectFields(next) as Partial<DesignNode>)
  }

  const addEffect = () => {
    const next = [...effects, defaultEffect('DROP_SHADOW')]
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
    const fresh = defaultEffect(type)
    commit(
      effects.map((fx) =>
        fx.id === id
          ? {
              ...fresh,
              id,
              visible: prev?.visible ?? true
            }
          : fx
      )
    )
    setTypeMenuId(null)
  }

  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Effects</span>
        <button type="button" onClick={addEffect} aria-label="Add effect">
          +
        </button>
      </div>
      {effects.length > 0 && (
        <div className="prop-effects">
          {effects.map((fx) => {
            const visible = fx.visible !== false
            return (
              <div key={fx.id} className={`prop-effect-row${openId === fx.id ? ' is-on' : ''}${visible ? '' : ' is-hidden'}`}>
                <button type="button" className="prop-effect-ico" title={effectLabel(fx.type)} onClick={() => setOpenId(openId === fx.id ? null : fx.id)}>
                  <EffectTypeIcon type={fx.type} />
                </button>
                <button type="button" className="prop-effect-name" onClick={() => setOpenId(openId === fx.id ? null : fx.id)}>
                  {effectLabel(fx.type)}
                </button>
                <button
                  type="button"
                  className="prop-effect-eye"
                  title={visible ? 'Hide' : 'Show'}
                  onClick={() => patchEffect(fx.id, { visible: !visible })}
                >
                  {visible ? '◉' : '〇'}
                </button>
                <button type="button" className="prop-effect-remove" title="Remove" onClick={() => removeEffect(fx.id)}>
                  –
                </button>
              </div>
            )
          })}
        </div>
      )}
      {openEffect && (
        <EffectPopover
          effect={openEffect}
          typeMenuOpen={typeMenuId === openEffect.id}
          onToggleTypeMenu={() => setTypeMenuId(typeMenuId === openEffect.id ? null : openEffect.id)}
          onClose={() => {
            setOpenId(null)
            setTypeMenuId(null)
          }}
          onChangeType={(type) => changeType(openEffect.id, type)}
          onChange={(patch) => patchEffect(openEffect.id, patch)}
        />
      )}
    </section>
  )
}

function EffectPopover({
  effect,
  typeMenuOpen,
  onToggleTypeMenu,
  onClose,
  onChangeType,
  onChange
}: {
  effect: DesignEffect
  typeMenuOpen: boolean
  onToggleTypeMenu: () => void
  onClose: () => void
  onChangeType: (type: EffectType) => void
  onChange: (patch: Partial<DesignEffect>) => void
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
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

  const isShadow = effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW'
  const isBlur = effect.type === 'LAYER_BLUR' || effect.type === 'BACKGROUND_BLUR'
  const blurMode: EffectBlurMode = effect.blurMode || 'UNIFORM'

  return (
    <div className="prop-effect-popover" ref={root}>
      <div className="prop-effect-popover-head">
        <div className="prop-effect-type-wrap">
          <button type="button" className="prop-effect-type-btn" onClick={onToggleTypeMenu}>
            <EffectTypeIcon type={effect.type} />
            <span>{effectLabel(effect.type)}</span>
            <em>▾</em>
          </button>
          {typeMenuOpen && (
            <div className="prop-effect-type-menu" role="listbox">
              {EFFECT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  type="button"
                  role="option"
                  aria-selected={effect.type === option.type}
                  className={effect.type === option.type ? 'is-on' : undefined}
                  onClick={() => onChangeType(option.type)}
                >
                  <EffectTypeIcon type={option.type} />
                  <span>{option.label}</span>
                  {effect.type === option.type && <span className="prop-blend-check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="prop-effect-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {isShadow && (
        <>
          <div className="prop-grid">
            <NumField prefix="X" value={effect.offsetX ?? 0} onChange={(offsetX) => onChange({ offsetX })} />
            <NumField prefix="Y" value={effect.offsetY ?? 4} onChange={(offsetY) => onChange({ offsetY })} />
            <NumField prefix="Blur" value={effect.radius ?? 4} onChange={(radius) => onChange({ radius: Math.max(0, radius) })} />
            <NumField prefix="Spread" value={effect.spread ?? 0} onChange={(spread) => onChange({ spread })} />
          </div>
          <FillRow
            hex={toHex(effect.color, '#000000')}
            opacity={Math.round((effect.opacity ?? 0.25) * 100)}
            onHex={(color) => onChange({ color })}
            onOpacity={(opacity) => onChange({ opacity: opacity / 100 })}
          />
        </>
      )}

      {isBlur && (
        <>
          <div className="prop-effect-tabs">
            <button
              type="button"
              className={blurMode === 'UNIFORM' ? 'is-on' : undefined}
              onClick={() => onChange({ blurMode: 'UNIFORM' })}
            >
              Uniform
            </button>
            <button
              type="button"
              className={blurMode === 'PROGRESSIVE' ? 'is-on' : undefined}
              onClick={() => onChange({ blurMode: 'PROGRESSIVE', startRadius: effect.startRadius ?? 0 })}
            >
              Progressive
            </button>
          </div>
          {blurMode === 'UNIFORM' ? (
            <NumField prefix="Blur" value={effect.radius ?? 0} onChange={(radius) => onChange({ radius: Math.max(0, radius) })} />
          ) : (
            <div className="prop-grid">
              <NumField
                prefix="Start"
                value={effect.startRadius ?? 0}
                onChange={(startRadius) => onChange({ startRadius: Math.max(0, startRadius) })}
              />
              <NumField prefix="End" value={effect.radius ?? 0} onChange={(radius) => onChange({ radius: Math.max(0, radius) })} />
            </div>
          )}
        </>
      )}

      {effect.type === 'NOISE' && (
        <>
          <div className="prop-effect-tabs">
            {(['MONOTONE', 'DUOTONE', 'MULTITONE'] as NoiseType[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className={(effect.noiseType || 'MONOTONE') === kind ? 'is-on' : undefined}
                onClick={() => onChange({ noiseType: kind })}
              >
                {kind === 'MONOTONE' ? 'Mono' : kind === 'DUOTONE' ? 'Duo' : 'Multi'}
              </button>
            ))}
          </div>
          <div className="prop-grid">
            <NumField
              prefix="X"
              value={effect.noiseSizeX ?? 0.5}
              onChange={(noiseSizeX) => onChange({ noiseSizeX: Math.max(0.01, noiseSizeX) })}
            />
            <NumField
              prefix="Y"
              value={effect.noiseSizeY ?? effect.noiseSizeX ?? 0.5}
              onChange={(noiseSizeY) => onChange({ noiseSizeY: Math.max(0.01, noiseSizeY) })}
            />
          </div>
          <NumField
            prefix="Density"
            suffix="%"
            value={Math.round((effect.density ?? 1) * 100)}
            onChange={(density) => onChange({ density: Math.max(0, Math.min(100, density)) / 100 })}
          />
          <FillRow
            hex={toHex(effect.color, '#000000')}
            opacity={Math.round((effect.opacity ?? 0.25) * 100)}
            onHex={(color) => onChange({ color })}
            onOpacity={(opacity) => onChange({ opacity: opacity / 100 })}
          />
          {(effect.noiseType || 'MONOTONE') === 'DUOTONE' && (
            <FillRow
              hex={toHex(effect.secondaryColor, '#FFFFFF')}
              opacity={Math.round((effect.secondaryOpacity ?? 0.25) * 100)}
              onHex={(secondaryColor) => onChange({ secondaryColor })}
              onOpacity={(opacity) => onChange({ secondaryOpacity: opacity / 100 })}
            />
          )}
        </>
      )}

      {effect.type === 'TEXTURE' && (
        <>
          <div className="prop-grid">
            <NumField
              prefix="Size"
              value={effect.noiseSizeX ?? 0.5}
              onChange={(noiseSizeX) => onChange({ noiseSizeX: Math.max(0.01, noiseSizeX), noiseSizeY: Math.max(0.01, noiseSizeX) })}
            />
            <NumField prefix="Radius" value={effect.radius ?? 0} onChange={(radius) => onChange({ radius: Math.max(0, radius) })} />
          </div>
          <label className="al-clip">
            <input
              type="checkbox"
              checked={effect.clipToShape !== false}
              onChange={(event) => onChange({ clipToShape: event.target.checked })}
            />
            Clip to shape
          </label>
        </>
      )}

      {effect.type === 'GLASS' && (
        <div className="prop-grid">
          <NumField
            prefix="Light"
            suffix="%"
            value={Math.round((effect.lightIntensity ?? 0.5) * 100)}
            onChange={(value) => onChange({ lightIntensity: Math.max(0, Math.min(100, value)) / 100 })}
          />
          <NumField prefix="Angle" suffix="°" value={effect.lightAngle ?? -45} onChange={(lightAngle) => onChange({ lightAngle })} />
          <NumField
            prefix="Refract"
            suffix="%"
            value={Math.round((effect.refraction ?? 0.5) * 100)}
            onChange={(value) => onChange({ refraction: Math.max(0, Math.min(100, value)) / 100 })}
          />
          <NumField prefix="Depth" value={effect.depth ?? 20} onChange={(depth) => onChange({ depth: Math.max(1, depth) })} />
          <NumField
            prefix="Disp."
            suffix="%"
            value={Math.round((effect.dispersion ?? 0.1) * 100)}
            onChange={(value) => onChange({ dispersion: Math.max(0, Math.min(100, value)) / 100 })}
          />
          <NumField prefix="Frost" value={effect.radius ?? 8} onChange={(radius) => onChange({ radius: Math.max(0, radius) })} />
        </div>
      )}
    </div>
  )
}

function EffectTypeIcon({ type }: { type: EffectType }) {
  if (type === 'DROP_SHADOW') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 11.5h5.5A1 1 0 0 0 11.5 10.5V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      </svg>
    )
  }
  if (type === 'INNER_SHADOW') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M3.5 4.5h5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.45" />
      </svg>
    )
  }
  if (type === 'LAYER_BLUR' || type === 'BACKGROUND_BLUR') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M7 2v1.2M7 10.8V12M2 7h1.2M10.8 7H12M3.4 3.4l.85.85M9.75 9.75l.85.85M3.4 10.6l.85-.85M9.75 4.25l.85-.85" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    )
  }
  if (type === 'NOISE') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <circle cx="3.5" cy="4" r="0.9" fill="currentColor" />
        <circle cx="7" cy="3.2" r="0.7" fill="currentColor" opacity="0.7" />
        <circle cx="10.5" cy="4.5" r="0.9" fill="currentColor" />
        <circle cx="5" cy="7" r="0.8" fill="currentColor" opacity="0.55" />
        <circle cx="9" cy="7.5" r="0.7" fill="currentColor" />
        <circle cx="3.8" cy="10.2" r="0.8" fill="currentColor" />
        <circle cx="7.5" cy="10.5" r="0.7" fill="currentColor" opacity="0.75" />
        <circle cx="10.8" cy="9.8" r="0.8" fill="currentColor" />
      </svg>
    )
  }
  if (type === 'TEXTURE') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="9" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2.5 6.5h9M2.5 9.5h9M5.5 2.5v9M8.5 2.5v9" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="9" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 8.5c1.2-2 3.8-2 5 0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
    </svg>
  )
}

function ExportBlock({
  settings,
  onChange,
  onExport
}: {
  settings: ExportSetting[]
  onChange: (next: ExportSetting[]) => void
  onExport: (setting: ExportSetting) => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const rows = settings.length ? settings : []

  const add = () => onChange([...rows, DEFAULT_EXPORT_SETTING()])
  const remove = (id: string) => onChange(rows.filter((row) => row.id !== id))
  const patch = (id: string, next: Partial<ExportSetting>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...next } : row)))

  const exportAll = async () => {
    const list = rows.length ? rows : [DEFAULT_EXPORT_SETTING()]
    if (!rows.length) onChange(list)
    setBusy(true)
    try {
      for (const setting of list) await onExport(setting)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Export</span>
        <button type="button" onClick={add} aria-label="Add export">
          +
        </button>
      </div>
      {rows.length > 0 && (
        <div className="prop-export-list">
          {rows.map((row) => (
            <div key={row.id} className="prop-export-row">
              <select
                value={row.scale}
                onChange={(event) => patch(row.id, { scale: Number(event.target.value) })}
                title="Scale"
              >
                {EXPORT_SCALES.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale === 0.5 ? '0.5x' : `${scale}x`}
                  </option>
                ))}
              </select>
              <select
                value={row.format}
                onChange={(event) => patch(row.id, { format: event.target.value as ExportFormat })}
                title="Format"
              >
                {EXPORT_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
              <button type="button" className="prop-export-remove" onClick={() => remove(row.id)} aria-label="Remove export">
                –
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="prop-export-btn" disabled={busy} onClick={() => void exportAll()}>
        {busy ? 'Exporting…' : rows.length > 1 ? `Export ${rows.length} formats` : 'Export'}
      </button>
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
  const [sizeOpen, setSizeOpen] = useState(false)
  const typeRoot = useRef<HTMLDivElement>(null)
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
  const resize = node.textResize || 'auto-width'

  useEffect(() => {
    ensureGoogleFontLoaded(family, node.fontWeight || 400, italic)
  }, [family, node.fontWeight, italic])

  useEffect(() => {
    if (!typeOpen && !sizeOpen) return
    const onDown = (event: MouseEvent) => {
      if (typeOpen && !typeRoot.current?.contains(event.target as Node)) setTypeOpen(false)
      if (sizeOpen && !sizeRoot.current?.contains(event.target as Node)) setSizeOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTypeOpen(false)
        setSizeOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [typeOpen, sizeOpen])

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
      <div className="prop-text-fields">
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
        <FontStylePicker
          family={family}
          value={styleId}
          onChange={(option) => {
            onPatch({ fontWeight: option.weight, fontStyle: option.italic ? 'italic' : 'normal' })
            void ensureGoogleFontLoaded(family, option.weight, option.italic)
          }}
        />
        <div className="prop-type-metrics-3" ref={sizeRoot}>
          <label className="prop-type-metric" title="Font size">
            <span className="prop-type-metric-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 9.5 5 2.5h2L9.5 9.5M3.5 7h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              value={size}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) onPatch({ fontSize: Math.max(1, next) })
              }}
              onClick={() => setSizeOpen(true)}
            />
          </label>
          <label className="prop-type-metric" title="Line height">
            <span className="prop-type-metric-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2.5h8M2 9.5h8M6 4v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M4.5 5.5 6 4l1.5 1.5M4.5 6.5 6 8l1.5-1.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              value={lineAuto ? 'Auto' : String(node.lineHeight)}
              onFocus={(event) => event.currentTarget.select()}
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
          <label className="prop-type-metric" title="Letter spacing">
            <span className="prop-type-metric-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M4 9V3l-1.5 6M8 9V3l1.5 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 6h8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity="0.45" />
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
          {sizeOpen && (
            <div className="prop-type-size-menu prop-type-size-menu-metrics" role="listbox" aria-label="Font size">
              {FONT_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="option"
                  aria-selected={size === preset}
                  className={size === preset ? 'is-on' : undefined}
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
        <div className="prop-type-row">
          <label className="prop-type-metric" title="Paragraph spacing">
            <span className="prop-type-metric-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2.5h8M2 5h6M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M9.5 5.5v3M8.2 7.2 9.5 8.5 10.8 7.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              value={node.paragraphSpacing || 0}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) onPatch({ paragraphSpacing: Math.max(0, next) })
              }}
            />
          </label>
          <label className="prop-type-metric" title="Paragraph indent">
            <span className="prop-type-metric-ico" aria-hidden>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M5 2.5h5M5 6h5M2 9.5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M2 3v5M2 3l1.6 1.6M2 3 3.6 1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <input
              value={node.paragraphIndent || 0}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (Number.isFinite(next)) onPatch({ paragraphIndent: Math.max(0, next) })
              }}
            />
          </label>
        </div>
        <div className="prop-type-align-row">
          <div className="prop-type-align-group" role="group" aria-label="Horizontal alignment">
            {(
              [
                ['left', 'Align left'],
                ['center', 'Align center'],
                ['right', 'Align right'],
                ['justify', 'Align justified']
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
          <div className="prop-type-align-group" role="group" aria-label="Vertical alignment">
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
                onClick={() => onPatch({ textAlignVertical: align, textResize: 'fixed' })}
              >
                <TextVAlignIcon kind={align} />
              </button>
            ))}
          </div>
          <div className="prop-type-resize-group" role="group" aria-label="Text resizing">
            {(
              [
                ['auto-width', 'Auto width'],
                ['auto-height', 'Auto height'],
                ['fixed', 'Fixed size']
              ] as const
            ).map(([mode, title]) => (
              <button
                key={mode}
                type="button"
                className={resize === mode ? 'is-on' : undefined}
                title={title}
                onClick={() => onPatch({ textResize: mode })}
              >
                <TextResizeIcon kind={mode} />
              </button>
            ))}
          </div>
        </div>
        <div className="prop-type-align-row">
          <div className="prop-type-align-group" role="group" aria-label="Decoration">
            {(
              [
                ['none', 'None'],
                ['underline', 'Underline'],
                ['line-through', 'Strikethrough']
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                type="button"
                className={(node.textDecoration || 'none') === value ? 'is-on' : undefined}
                title={title}
                onClick={() => onPatch({ textDecoration: value })}
              >
                {value === 'none' ? '—' : value === 'underline' ? 'U' : 'S'}
              </button>
            ))}
          </div>
          <div className="prop-type-case" role="group" aria-label="Letter case">
            {(
              [
                ['none', 'As typed'],
                ['upper', 'Uppercase'],
                ['lower', 'Lowercase'],
                ['title', 'Capitalize'],
                ['small-caps', 'Small caps']
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                type="button"
                className={(node.textCase || 'none') === value ? 'is-on' : undefined}
                title={title}
                onClick={() => onPatch({ textCase: value })}
              >
                {value === 'none' ? 'Aa' : value === 'upper' ? 'AA' : value === 'lower' ? 'aa' : value === 'title' ? 'Tt' : 'SC'}
              </button>
            ))}
          </div>
          <div className="prop-type-align-group" role="group" aria-label="List">
            {(
              [
                ['none', 'None'],
                ['unordered', 'Bulleted list'],
                ['ordered', 'Numbered list']
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                type="button"
                className={(node.listStyle || 'none') === value ? 'is-on' : undefined}
                title={title}
                onClick={() => onPatch({ listStyle: value })}
              >
                {value === 'none' ? '—' : value === 'unordered' ? '•' : '1.'}
              </button>
            ))}
          </div>
          <div className="prop-type-settings-wrap" ref={typeRoot}>
            <button
              type="button"
              className={'prop-type-settings-btn' + (typeOpen ? ' is-on' : '')}
              title="More type settings"
              onClick={() => setTypeOpen((value) => !value)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M2 3.5h10M2 7h7M2 10.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <circle cx="11" cy="7" r="1.2" fill="currentColor" />
                <circle cx="12" cy="10.5" r="1.2" fill="currentColor" />
              </svg>
            </button>
            {typeOpen && (
              <div className="prop-type-settings">
                <label className="al-clip">
                  <input
                    type="checkbox"
                    checked={Boolean(node.textTruncation)}
                    onChange={(event) =>
                      onPatch({
                        textTruncation: event.target.checked,
                        maxLines: event.target.checked ? node.maxLines || 1 : undefined,
                        textResize: event.target.checked ? 'fixed' : node.textResize
                      })
                    }
                  />
                  Truncate text
                </label>
                {node.textTruncation && (
                  <label className="prop-type-settings-field">
                    <span>Max lines</span>
                    <input
                      value={node.maxLines || 1}
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (Number.isFinite(next)) onPatch({ maxLines: Math.max(1, Math.round(next)) })
                      }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
        {onPath && (
          <button
            type="button"
            className={node.textPathFlip ? 'prop-flip-path is-on' : 'prop-flip-path'}
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

function TextResizeIcon({ kind }: { kind: 'auto-width' | 'auto-height' | 'fixed' }) {
  if (kind === 'auto-width') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M3 4.5h8M3 9.5h8M2 7h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M4.2 5.8 2.8 7l1.4 1.2M9.8 5.8 11.2 7l-1.4 1.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (kind === 'auto-height') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M4.5 3v8M9.5 3v8M7 2v10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <path d="M5.8 4.2 7 2.8l1.2 1.4M5.8 9.8 7 11.2l1.2-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="9" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function TextAlignIcon({ kind }: { kind: 'left' | 'center' | 'right' | 'justify' }) {
  if (kind === 'left') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 3.5h10M2 7h7M2 10.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'center') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 3.5h10M3.5 7h7M2.5 10.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'right') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 3.5h10M5 7h7M3 10.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function TextVAlignIcon({ kind }: { kind: 'top' | 'middle' | 'bottom' }) {
  if (kind === 'top') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M2 2.5h10M4 5.5h6M5 8.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'middle') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d="M4 3.5h6M2 7h10M4 10.5h6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M5 5.5h4M4 8.5h6M2 11.5h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

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
        <em>▾</em>
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
        <em>▾</em>
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
  onPatchNode
}: {
  node: DesignNode
  nodes: DesignNode[]
  onPatchNode: (id: string, patch: Partial<DesignNode>) => void
}) {
  const colors: Array<{ hex: string; opacity: number; nodeId: string }> = []
  const seen = new Set<string>()
  const collect = (item: DesignNode) => {
    for (const paint of getNodePaints(item)) {
      if (paint.visible === false || paint.type !== 'solid') continue
      const hex = toHex(paint.color, '#000000')
      const key = `${hex}:${Math.round(paint.opacity * 100)}`
      if (seen.has(key)) continue
      seen.add(key)
      colors.push({ hex, opacity: Math.round(paint.opacity * 100), nodeId: item.id })
    }
  }
  collect(node)
  for (const child of nodes) {
    if (child.parentId === node.id) collect(child)
  }
  if (!colors.length) return null
  return (
    <section className="prop-section">
      <div className="prop-section-head">Selection colors</div>
      <div className="prop-selection-colors">
        {colors.map((color) => (
          <div key={`${color.nodeId}-${color.hex}-${color.opacity}`} className="prop-fill-card">
            <span className="prop-fill-swatch" style={{ background: color.hex }} />
            <span className="prop-hex">{color.hex.replace('#', '')}</span>
            <span className="prop-opacity">{color.opacity}%</span>
          </div>
        ))}
      </div>
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
