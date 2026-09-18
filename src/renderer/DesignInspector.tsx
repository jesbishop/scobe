import type { CSSProperties } from 'react'
import type { AutoLayout, AutoLayoutAlign, AutoLayoutJustify, BrowserFrame, DesignNode, DesignPage, DesignTool } from '../shared/types'
import { BROWSER_SIZE_PRESETS, FRAME_PRESET_CATEGORIES, type FramePreset } from '../shared/framePresets'
import { defaultFrameLayout } from '../shared/layoutEngine'
import { nodeBounds } from './canvasMath'
import type { InspectInfo } from '../shared/types'
import { FramePresetsPanel } from './FramePresetsPanel'
import { isTextOnPath } from './textPath'

const FONTS = ['Inter', 'DM Sans', 'Google Sans', 'Arial', 'Georgia', 'Times New Roman']
const WEIGHTS = ['Regular', 'Medium', 'Semibold', 'Bold']
const BLENDS = ['Normal', 'Multiply', 'Screen', 'Overlay']

function weightValue(label: string): number {
  if (label === 'Medium') return 500
  if (label === 'Semibold') return 600
  if (label === 'Bold') return 700
  return 400
}

function weightLabel(value: number | string | undefined): string {
  const n = Number(value) || 400
  if (n >= 700) return 'Bold'
  if (n >= 600) return 'Semibold'
  if (n >= 500) return 'Medium'
  return 'Regular'
}

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
    return (
      <>
        {(isText || isSection || node.type === 'frame') && (
          <div className="prop-node-title">
            {isSection ? 'Section' : isText ? (onPath ? 'Text on path' : 'Text') : 'Frame'}
          </div>
        )}
        <LayoutBlock
          x={box.x}
          y={box.y}
          width={box.width}
          height={isText ? box.height || node.fontSize || 12 : box.height}
          rotation={node.rotation || 0}
          radius={isBox ? node.radius ?? (isSection ? 2 : 0) : undefined}
          onChange={(patch) => onPatchNode(node.id, patch)}
        />
        {node.type === 'frame' && (
          <FlexBlock
            layout={node.layout}
            onChange={(layout) => onPatchNode(node.id, { layout, clipsContent: true })}
          />
        )}
        <BlendBlock
          opacity={(node.opacity ?? 1) * 100}
          blend={node.blendMode || 'Normal'}
          onOpacity={(opacity) => onPatchNode(node.id, { opacity: opacity / 100 })}
          onBlend={(blendMode) => onPatchNode(node.id, { blendMode })}
        />
        <FillBlock
          hex={fill}
          opacity={Math.round((node.fillOpacity ?? 1) * 100)}
          onHex={(next) => onPatchNode(node.id, { fill: next })}
          onOpacity={(fillOpacity) => onPatchNode(node.id, { fillOpacity: fillOpacity / 100 })}
        />
        {isText && (
          <TextBlock
            node={node}
            onPath={onPath}
            onPatch={(patch) => onPatchNode(node.id, patch)}
          />
        )}
        <StrokeBlock
          enabled={Boolean(node.strokeWidth) || isSection}
          hex={stroke}
          width={node.strokeWidth || 1}
          opacity={Math.round((node.strokeOpacity ?? (isSection ? 0.1 : 1)) * 100)}
          onToggle={() =>
            onPatchNode(
              node.id,
              node.strokeWidth
                ? { strokeWidth: 0 }
                : { stroke: isSection ? '#000000' : '#1A1A1A', strokeWidth: 1, strokeOpacity: isSection ? 0.1 : 1 }
            )
          }
          onHex={(next) => onPatchNode(node.id, { stroke: next, strokeWidth: node.strokeWidth || 1 })}
          onWidth={(strokeWidth) => onPatchNode(node.id, { strokeWidth })}
          onOpacity={(strokeOpacity) => onPatchNode(node.id, { strokeOpacity: strokeOpacity / 100 })}
        />
        <ShadowBlock
          enabled={Boolean(node.shadow)}
          x={node.shadowX || 0}
          y={node.shadowY || 8}
          blur={node.shadowBlur || 16}
          hex={toHex(node.shadowColor, '#000000')}
          onToggle={() =>
            onPatchNode(
              node.id,
              node.shadow
                ? { shadow: false }
                : { shadow: true, shadowX: 0, shadowY: 8, shadowBlur: 16, shadowColor: '#000000' }
            )
          }
          onChange={(patch) => onPatchNode(node.id, { shadow: true, ...patch })}
        />
      </>
    )
  }

  if (browser) {
    return (
      <LayoutBlock
        x={browser.x}
        y={browser.y}
        width={browser.width}
        height={browser.height}
        rotation={0}
        hideRotation
        onChange={(patch) => onPatchBrowser(browser.id, patch)}
      />
    )
  }

  return (
    <>
      <section className="prop-section prop-section-page">
        <div className="prop-section-head">Page</div>
        <FillRow
          hex={toHex(page.fill, '#EEEEEE')}
          opacity={100}
          onHex={(fill) => onPatchPage({ fill })}
        />
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

function LayoutBlock({
  x,
  y,
  width,
  height,
  rotation,
  radius,
  hideRotation,
  onChange
}: {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  radius?: number
  hideRotation?: boolean
  onChange: (patch: {
    x?: number
    y?: number
    width?: number
    height?: number
    rotation?: number
    radius?: number
  }) => void
}) {
  return (
    <section className="prop-section">
      <div className="prop-section-head">Layout</div>
      <div className="prop-flex-layout">
        <div className="prop-grid">
          <NumField prefix="X" value={x} onChange={(next) => onChange({ x: next })} />
          <NumField prefix="Y" value={y} onChange={(next) => onChange({ y: next })} />
        </div>
        <div className="prop-grid">
          <NumField prefix="W" value={width} onChange={(next) => onChange({ width: Math.max(1, next) })} />
          <NumField prefix="H" value={height} onChange={(next) => onChange({ height: Math.max(1, next) })} />
        </div>
        <div className="prop-grid">
          {!hideRotation && (
            <NumField prefix="Angle" suffix="°" value={rotation} onChange={(next) => onChange({ rotation: next })} />
          )}
          {radius != null && (
            <NumField prefix="Radius" suffix="px" value={radius} onChange={(next) => onChange({ radius: Math.max(0, next) })} />
          )}
        </div>
      </div>
    </section>
  )
}

function FlexBlock({
  layout,
  onChange
}: {
  layout?: AutoLayout
  onChange: (layout: AutoLayout) => void
}) {
  const active = layout && layout.mode !== 'none'
  const mode = layout?.mode === 'vertical' ? 'vertical' : 'horizontal'
  const gap = layout?.gap ?? 8
  const align = layout?.alignItems || 'start'
  const justify = layout?.justifyContent || 'start'
  const wrap = Boolean(layout?.wrap)

  const patch = (partial: Partial<AutoLayout>) => {
    const base = active ? { ...defaultFrameLayout(), ...layout } : defaultFrameLayout()
    onChange({ ...base, ...partial, mode: partial.mode || base.mode || 'horizontal' })
  }

  const enable = (partial: Partial<AutoLayout> = {}) => {
    if (active) patch(partial)
    else onChange({ ...defaultFrameLayout(), ...partial })
  }

  return (
    <section className="prop-section">
      <div className="prop-section-head">Flex</div>
      <div className="prop-flex-panel">
        <label className="prop-flex-field">
          <span>Direction</span>
          <select
            value={active ? mode : 'horizontal'}
            onChange={(event) =>
              enable({ mode: event.target.value === 'vertical' ? 'vertical' : 'horizontal' })
            }
          >
            <option value="horizontal">Row</option>
            <option value="vertical">Column</option>
          </select>
        </label>
        <label className="prop-flex-field">
          <span>Justify</span>
          <select
            value={justify}
            onChange={(event) => enable({ justifyContent: event.target.value as AutoLayoutJustify })}
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="space-between">Space between</option>
          </select>
        </label>
        <label className="prop-flex-field">
          <span>Align</span>
          <select
            value={align}
            onChange={(event) => enable({ alignItems: event.target.value as AutoLayoutAlign })}
          >
            <option value="start">Start</option>
            <option value="center">Center</option>
            <option value="end">End</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>
        <div className="prop-flex-gap">
          <NumField prefix="Gap" value={gap} onChange={(next) => enable({ gap: Math.max(0, next) })} />
        </div>
        <label className="prop-flex-field">
          <span>Wrap</span>
          <select
            value={wrap ? 'wrap' : 'nowrap'}
            onChange={(event) => enable({ wrap: event.target.value === 'wrap' })}
          >
            <option value="nowrap">No Wrap</option>
            <option value="wrap">Wrap</option>
          </select>
        </label>
      </div>
    </section>
  )
}

function BlendBlock({
  opacity,
  blend,
  onOpacity,
  onBlend
}: {
  opacity: number
  blend: string
  onOpacity: (value: number) => void
  onBlend: (value: string) => void
}) {
  return (
    <section className="prop-section">
      <div className="prop-section-head">Blending</div>
      <div className="prop-blend">
        <NumField value={opacity} suffix="%" onChange={onOpacity} />
        <select value={blend} onChange={(event) => onBlend(event.target.value)}>
          {BLENDS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
    </section>
  )
}

function FillBlock({
  hex,
  opacity,
  onHex,
  onOpacity
}: {
  hex: string
  opacity: number
  onHex: (value: string) => void
  onOpacity: (value: number) => void
}) {
  return (
    <section className="prop-section">
      <div className="prop-section-head">Fill</div>
      <FillRow hex={hex} opacity={opacity} onHex={onHex} onOpacity={onOpacity} />
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
  onToggle,
  onHex,
  onWidth,
  onOpacity
}: {
  enabled: boolean
  hex: string
  width: number
  opacity?: number
  onToggle: () => void
  onHex: (value: string) => void
  onWidth: (value: number) => void
  onOpacity?: (value: number) => void
}) {
  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Border</span>
        <button type="button" onClick={onToggle}>
          {enabled ? '–' : '+'}
        </button>
      </div>
      {enabled && (
        <div className="prop-stroke">
          <FillRow hex={hex} opacity={opacity} onHex={onHex} onOpacity={onOpacity} />
          <NumField prefix="W" value={width} onChange={onWidth} />
        </div>
      )}
    </section>
  )
}

function ShadowBlock({
  enabled,
  x,
  y,
  blur,
  hex,
  onToggle,
  onChange
}: {
  enabled: boolean
  x: number
  y: number
  blur: number
  hex: string
  onToggle: () => void
  onChange: (patch: Partial<DesignNode>) => void
}) {
  return (
    <section className="prop-section">
      <div className="prop-section-head prop-add-head">
        <span>Shadow</span>
        <button type="button" onClick={onToggle}>
          {enabled ? '–' : '+'}
        </button>
      </div>
      {enabled && (
        <div className="prop-grid">
          <FillRow hex={hex} opacity={100} onHex={(shadowColor) => onChange({ shadowColor })} />
          <NumField prefix="X" value={x} onChange={(shadowX) => onChange({ shadowX })} />
          <NumField prefix="Y" value={y} onChange={(shadowY) => onChange({ shadowY })} />
          <NumField prefix="B" value={blur} onChange={(shadowBlur) => onChange({ shadowBlur })} />
        </div>
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
  const family = node.fontFamily || 'Inter'
  const size = node.fontSize || 12
  return (
    <section className="prop-section">
      <div className="prop-section-head">Typography</div>
      <div className="prop-text-fields">
        <select value={family} onChange={(event) => onPatch({ fontFamily: event.target.value })}>
          {FONTS.map((font) => (
            <option key={font}>{font}</option>
          ))}
        </select>
        <select value={weightLabel(node.fontWeight)} onChange={(event) => onPatch({ fontWeight: weightValue(event.target.value) })}>
          {WEIGHTS.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <div className="prop-grid">
          <NumField prefix="A" value={size} onChange={(fontSize) => onPatch({ fontSize })} />
          <NumField prefix="↕" value={node.lineHeight || Math.round(size * 1.2)} onChange={(lineHeight) => onPatch({ lineHeight })} />
          <NumField prefix="VA" value={node.letterSpacing || 0} onChange={(letterSpacing) => onPatch({ letterSpacing })} />
        </div>
        <div className="prop-align">
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              className={(node.textAlign || 'left') === align ? 'is-on' : ''}
              onClick={() => onPatch({ textAlign: align })}
            >
              {align[0].toUpperCase()}
            </button>
          ))}
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

function NumField({
  prefix,
  suffix,
  value,
  onChange
}: {
  prefix?: string
  suffix?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="prop-num">
      {prefix && <span>{prefix}</span>}
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
