import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ColorizeOutlinedIcon, DeleteOutlineIcon } from './lucideIcons'
import {
  defaultShader,
  defaultSolid,
  newStopId,
  SHADER_OPTIONS,
  type GradientPaint,
  type Paint,
  type ShaderKind,
  type ShaderPaint
} from '../shared/paint'
import {
  ANIMATED_SHADERS,
  maxShaderColors,
  SHADER_CONTROLS,
  shaderAcceptsImage,
  shaderOption,
  type ShaderControl
} from '../shared/shaderControls'
import { parseHex } from './colorMath'
import { FillPicker } from './FillPicker'
import { ShaderFillsPopup } from './ShaderFillsPopup'
import {
  cancelShapeCapture,
  loadShapeFile,
  startShapeCapture,
  useShapeCaptureActive,
  type ShaderShapeImage
} from './shapeCapture'

type SliderControl = Extract<ShaderControl, { kind: 'slider' }>
type SelectControl = Extract<ShaderControl, { kind: 'select' }>
type ColorTarget = 'back' | 'colors'

const SIZING_KEYS = new Set(['scale', 'rotation', 'offsetX', 'offsetY'])

/** The popover the editor lives in, so nested popups can open beside it. */
function hostRect(el: HTMLElement | null): DOMRect | null {
  for (let node = el; node; node = node.parentElement) {
    if (getComputedStyle(node).position === 'fixed') return node.getBoundingClientRect()
  }
  return el?.getBoundingClientRect() || null
}

function gradientFromColors(colors: string[]): GradientPaint {
  const list = colors.length ? colors : ['#FFFFFF']
  return {
    type: 'gradient',
    gradientKind: 'linear',
    angle: 90,
    opacity: 1,
    visible: true,
    stops: list.map((color, index) => ({
      id: newStopId(),
      position: list.length === 1 ? 0 : index / (list.length - 1),
      color,
      opacity: 1
    }))
  }
}

function Chevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function useOutsideClose(open: boolean, root: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open, root, close])
}

export function ShaderEditor({
  paint,
  onChange
}: {
  paint: ShaderPaint
  onChange: (paint: ShaderPaint) => void
  /** @deprecated Pickers always open beside the host popover now. */
  pickerBeside?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const [libraryAnchor, setLibraryAnchor] = useState<DOMRect | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [editing, setEditing] = useState<{ target: ColorTarget; anchor: DOMRect | null; paint: Paint } | null>(null)
  const closeMore = useRef(() => setMoreOpen(false)).current
  useOutsideClose(moreOpen, moreRef, closeMore)

  const controls = SHADER_CONTROLS[paint.shader] || []
  const maxColors = maxShaderColors(paint.shader)
  const acceptsImage = shaderAcceptsImage(paint.shader)
  const selects = controls.filter((control): control is SelectControl => control.kind === 'select')
  const sliders = controls.filter((control): control is SliderControl => control.kind === 'slider')
  const mainSliders = sliders.filter((control) => !SIZING_KEYS.has(control.key))
  const sizing = new Map(sliders.filter((control) => SIZING_KEYS.has(control.key)).map((control) => [control.key, control]))
  const shapeControl = selects.find((control) => control.key === 'shape')
  const otherSelects = selects.filter((control) => control !== shapeControl)
  const label = SHADER_OPTIONS.find((option) => option.id === paint.shader)?.label || 'Shader'
  const back = paint.colorBack || '#000000'
  const capturing = useShapeCaptureActive()
  const fileRef = useRef<HTMLInputElement>(null)
  const latest = useRef({ paint, onChange })
  latest.current = { paint, onChange }

  const applyShape = (shape: ShaderShapeImage | null) => {
    const { paint: current, onChange: commit } = latest.current
    commit({
      ...current,
      image: shape?.image,
      imageName: shape?.name,
      imageWidth: shape?.width,
      imageHeight: shape?.height
    })
  }

  const selectShader = (kind: ShaderKind) => {
    const next = defaultShader(kind)
    const keepImage = paint.image && shaderAcceptsImage(next.shader)
    setEditing(null)
    onChange(
      keepImage
        ? { ...next, image: paint.image, imageName: paint.imageName, imageWidth: paint.imageWidth, imageHeight: paint.imageHeight }
        : next
    )
  }

  const setParam = (key: string, value: number) => onChange({ ...paint, params: { ...paint.params, [key]: value } })
  const setOption = (key: string, value: string) => onChange({ ...paint, options: { ...paint.options, [key]: value } })

  const besideAnchor = (row: HTMLElement, lift = 40) => {
    const host = hostRect(root.current)
    const top = row.getBoundingClientRect().top - lift
    return host ? new DOMRect(host.left, top, host.width, 0) : row.getBoundingClientRect()
  }

  const openColor = (target: ColorTarget, row: HTMLElement) => {
    if (editing?.target === target) {
      setEditing(null)
      return
    }
    setLibraryAnchor(null)
    setEditing({
      target,
      anchor: besideAnchor(row),
      paint:
        target === 'back'
          ? defaultSolid(back, 1)
          : maxColors > 1
            ? gradientFromColors(paint.colors)
            : defaultSolid(paint.colors[0] || '#FFFFFF', 1)
    })
  }

  const applyPickerPaint = (next: Paint) => {
    if (!editing) return
    if (editing.target === 'back') {
      if (next.type === 'solid') onChange({ ...paint, colorBack: parseHex(next.color, back).toUpperCase() })
    } else if (next.type === 'solid') {
      onChange({ ...paint, colors: [parseHex(next.color, paint.colors[0] || '#FFFFFF').toUpperCase()] })
    } else if (next.type === 'gradient') {
      const colors = [...next.stops]
        .sort((a, b) => a.position - b.position)
        .map((stop) => parseHex(stop.color, '#FFFFFF').toUpperCase())
        .slice(0, maxColors)
      if (colors.length) onChange({ ...paint, colors })
    }
    setEditing({ ...editing, paint: next })
  }

  const unitFactor = (control: SliderControl) => (control.unit === '%' ? 100 : 1)
  const sliderRow = (control: SliderControl) => {
    const factor = unitFactor(control)
    const step = control.step ?? (control.scale === 'unit' ? 0.01 : 1)
    const value = paint.params[control.key] ?? control.min
    return (
      <Row key={control.key} label={control.label}>
        <SliderBar
          value={value}
          min={control.min}
          max={control.max}
          step={step}
          onChange={(next) => setParam(control.key, next)}
        />
        <NumBox
          value={Math.round(value * factor * 100) / 100}
          decimals={step * factor < 1 ? 2 : 0}
          min={control.min * factor}
          max={control.max * factor}
          step={step * factor}
          onCommit={(next) => setParam(control.key, next / factor)}
        />
      </Row>
    )
  }

  const sizingField = (key: string, prefix: string) => {
    const control = sizing.get(key)
    if (!control) return null
    const factor = unitFactor(control)
    const step = (control.step ?? 0.01) * factor
    const value = paint.params[key] ?? (key === 'scale' ? 1 : 0)
    return (
      <PrefixField
        prefix={prefix}
        title={control.label}
        value={Math.round(value * factor * 100) / 100}
        suffix={control.unit || ''}
        min={control.min * factor}
        max={control.max * factor}
        step={step < 1 ? 1 : step}
        onCommit={(next) => setParam(key, next / factor)}
      />
    )
  }

  const shapeSelect = shapeControl && (
    <Row label={shapeControl.label}>
      <ShaderSelect
        value={shaderOption(paint, 'shape', shapeControl.options[0]?.id || '')}
        options={shapeControl.options}
        onChange={(value) => setOption('shape', value)}
      />
    </Row>
  )

  return (
    <div className="sh-editor" ref={root}>
      <div className="sh-top">
        <button
          ref={chipRef}
          type="button"
          className={`sh-chip${libraryAnchor ? ' is-open' : ''}`}
          title="Browse shaders"
          onClick={() => {
            if (libraryAnchor) {
              setLibraryAnchor(null)
              return
            }
            setEditing(null)
            const host = hostRect(root.current)
            if (host) setLibraryAnchor(new DOMRect(host.left, host.top, host.width, host.height))
          }}
        >
          <span>{label}</span>
          <Chevron />
        </button>
        <div className="sh-more" ref={moreRef}>
          <button type="button" className="sh-more-btn" title="More options" onClick={() => setMoreOpen((open) => !open)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <circle cx="3.5" cy="8" r="1.2" />
              <circle cx="8" cy="8" r="1.2" />
              <circle cx="12.5" cy="8" r="1.2" />
            </svg>
          </button>
          {moreOpen && (
            <div className="prop-blend-menu sh-more-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  selectShader(paint.shader)
                }}
              >
                <span className="prop-blend-check" />
                <span>Reset to default</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false)
                  setLibraryAnchor(null)
                  setEditing(null)
                  onChange({ ...paint, colors: [...paint.colors].reverse() })
                }}
              >
                <span className="prop-blend-check" />
                <span>Reverse colors</span>
              </button>
              {paint.image && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false)
                    applyShape(null)
                  }}
                >
                  <span className="prop-blend-check" />
                  <span>Remove image</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="sh-rows">
        {acceptsImage && (
          <Row label="Image">
            {paint.image ? (
              <div className="sh-image">
                <button type="button" className="sh-image-thumb" title="Replace image" onClick={() => fileRef.current?.click()}>
                  <img src={paint.image} alt="" />
                </button>
                <span className="sh-image-name">{paint.imageName || 'Image'}</span>
                <button type="button" className="sh-icon-btn" title="Remove image" onClick={() => applyShape(null)}>
                  <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                </button>
              </div>
            ) : (
              <button type="button" className="sh-field-btn" onClick={() => fileRef.current?.click()}>
                Choose file
              </button>
            )}
            <button
              type="button"
              className={`sh-icon-btn${capturing ? ' is-on' : ''}`}
              title="Capture image from another element"
              onClick={() => (capturing ? cancelShapeCapture() : startShapeCapture(applyShape))}
            >
              <ColorizeOutlinedIcon sx={{ fontSize: 14 }} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                loadShapeFile(file)
                  .then(applyShape)
                  .catch((error) => console.error('Could not load shape image', error))
              }}
            />
          </Row>
        )}
        {(!acceptsImage || !paint.image) && shapeSelect}
        {otherSelects.map((control) => (
          <Row key={control.key} label={control.label}>
            <ShaderSelect
              value={shaderOption(paint, control.key, control.options[0]?.id || '')}
              options={control.options}
              onChange={(value) => setOption(control.key, value)}
            />
          </Row>
        ))}

        <Row label="Background">
          <ColorField
            hex={back}
            open={editing?.target === 'back'}
            onOpen={(row) => openColor('back', row)}
            onHex={(hex) => onChange({ ...paint, colorBack: hex })}
          />
        </Row>
        {maxColors > 1 ? (
          <Row label="Colors">
            <button
              type="button"
              className={`sh-gradient${editing?.target === 'colors' ? ' is-open' : ''}`}
              title={`${paint.colors.length} color${paint.colors.length === 1 ? '' : 's'}`}
              onClick={(event) => openColor('colors', event.currentTarget)}
            >
              <span
                style={{
                  background:
                    paint.colors.length > 1 ? `linear-gradient(90deg, ${paint.colors.join(', ')})` : paint.colors[0] || '#FFFFFF'
                }}
              />
            </button>
          </Row>
        ) : (
          <Row label="Color">
            <ColorField
              hex={paint.colors[0] || '#FFFFFF'}
              open={editing?.target === 'colors'}
              onOpen={(row) => openColor('colors', row)}
              onHex={(hex) => onChange({ ...paint, colors: [hex] })}
            />
          </Row>
        )}

        {ANIMATED_SHADERS.has(paint.shader) && (
          <Row label="Speed">
            <SliderBar value={paint.speed ?? 0} min={0} max={2} step={0.01} onChange={(speed) => onChange({ ...paint, speed })} />
            <NumBox
              value={Math.round((paint.speed ?? 0) * 100)}
              min={0}
              max={200}
              step={1}
              onCommit={(value) => onChange({ ...paint, speed: Math.max(0, value) / 100 })}
            />
          </Row>
        )}
        {mainSliders.map(sliderRow)}

        {sizing.size > 0 && (
          <>
            <Row label="Transform">
              {sizingField('offsetX', 'X')}
              {sizingField('offsetY', 'Y')}
            </Row>
            <Row label="">
              {sizingField('scale', 'S')}
              {sizingField('rotation', 'R')}
            </Row>
          </>
        )}
      </div>

      <ShaderFillsPopup
        open={Boolean(libraryAnchor)}
        placement="beside"
        anchor={libraryAnchor}
        ignoreRef={chipRef}
        selectedKind={paint.shader}
        onClose={() => setLibraryAnchor(null)}
        onSelect={(kind) => {
          selectShader(kind)
          setLibraryAnchor(null)
        }}
      />

      {editing && (
        <FillPicker
          paint={editing.paint}
          opaque
          kinds={editing.target === 'colors' && maxColors > 1 ? ['solid', 'gradient'] : ['solid']}
          canvasHandles={false}
          beside
          pageColors={[back, ...paint.colors].map((color) => ({ color, opacity: 1 }))}
          anchor={editing.anchor}
          onChange={applyPickerPaint}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sh-row">
      <span className="sh-label" title={label}>
        {label}
      </span>
      <div className="sh-control">{children}</div>
    </div>
  )
}

function SliderBar({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0
  const setFrom = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - 8) / Math.max(1, rect.width - 16)))
    const raw = min + ratio * (max - min)
    const snapped = Math.round(raw / step) * step
    const next = Math.max(min, Math.min(max, Number(snapped.toFixed(6))))
    if (next !== value) onChange(next)
  }
  return (
    <div
      ref={ref}
      className="sh-slider"
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setFrom(event.clientX)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFrom(event.clientX)
      }}
    >
      <span className="sh-slider-track">
        <span className="sh-slider-fill" style={{ width: `${t * 100}%` }} />
      </span>
      <span className="sh-slider-knob" style={{ left: `calc(8px + (100% - 16px) * ${t})` }} />
    </div>
  )
}

function useDraftNumber(value: number, decimals: number) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (decimals > 0 ? String(Number(value.toFixed(decimals))) : String(Math.round(value)))
  return { draft, setDraft, shown }
}

function NumBox({
  value,
  min,
  max,
  step,
  decimals = 0,
  onCommit
}: {
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onCommit: (value: number) => void
}) {
  const { setDraft, shown } = useDraftNumber(value, decimals)
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
  const commit = (raw: string) => {
    setDraft(null)
    const next = Number.parseFloat(raw)
    if (Number.isFinite(next)) onCommit(clamp(next))
  }
  return (
    <input
      className="sh-num"
      value={shown}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          setDraft(null)
          onCommit(clamp(value + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)))
        }
      }}
    />
  )
}

function PrefixField({
  prefix,
  title,
  value,
  suffix,
  min,
  max,
  step,
  onCommit
}: {
  prefix: string
  title: string
  value: number
  suffix: string
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const scrub = useRef<{ x: number; value: number } | null>(null)
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
  const commit = (raw: string) => {
    setDraft(null)
    const next = Number.parseFloat(raw)
    if (Number.isFinite(next)) onCommit(clamp(next))
  }
  return (
    <label className="sh-field" title={title}>
      <span
        className="sh-field-prefix"
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub.current = { x: event.clientX, value }
        }}
        onPointerMove={(event) => {
          if (!scrub.current) return
          const dx = event.clientX - scrub.current.x
          onCommit(clamp(Math.round(scrub.current.value + dx * step)))
        }}
        onPointerUp={() => {
          scrub.current = null
        }}
      >
        {prefix}
      </span>
      <input
        value={draft ?? `${Math.round(value * 10) / 10}${suffix}`}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setDraft(null)
            onCommit(clamp(value + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)))
          }
        }}
      />
    </label>
  )
}

function ColorField({
  hex,
  open,
  onOpen,
  onHex
}: {
  hex: string
  open: boolean
  onOpen: (row: HTMLElement) => void
  onHex: (hex: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (raw: string) => {
    setDraft(null)
    const value = raw.trim().replace(/^#/, '')
    if (/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(value)) onHex(parseHex(`#${value}`, hex).toUpperCase())
  }
  return (
    <div className={`sh-color${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="sh-color-swatch"
        title="Edit color"
        style={{ background: hex }}
        onClick={(event) => onOpen(event.currentTarget.parentElement || event.currentTarget)}
      />
      <input
        value={draft ?? hex.replace('#', '').toUpperCase()}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(null)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function ShaderSelect({
  value,
  options,
  onChange
}: {
  value: string
  options: Array<{ id: string; label: string }>
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const close = useRef(() => setOpen(false)).current
  useOutsideClose(open, root, close)
  const current = options.find((option) => option.id === value) || options[0]
  return (
    <div className="sh-select" ref={root}>
      <button type="button" className={open ? 'is-open' : undefined} onClick={() => setOpen((next) => !next)}>
        <span>{current?.label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="prop-blend-menu sh-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span className="prop-blend-check">{option.id === value ? '✓' : ''}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function isShaderPaint(paint: unknown): paint is ShaderPaint {
  return Boolean(paint && typeof paint === 'object' && (paint as { type?: string }).type === 'shader')
}
