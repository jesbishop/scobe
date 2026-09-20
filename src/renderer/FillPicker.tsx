import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import ColorizeIcon from '@mui/icons-material/Colorize'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import {
  defaultShader,
  fillTypeOf,
  newStopId,
  paintForFillType,
  paintPreviewCss,
  SHADER_OPTIONS,
  type ColorFormat,
  type FillTypeId,
  type GradientStop,
  type Paint,
  type ShaderKind
} from '../shared/paint'
import { AdjustedImage } from './AdjustedImage'
import {
  checkerboardCss,
  clamp,
  hexToHsb,
  hexToRgb,
  hsbToHex,
  hslToRgb,
  parseHex,
  rgbToHex,
  rgbToHsl,
  withAlpha
} from './colorMath'

const FILL_TYPES: Array<{ id: FillTypeId; title: string }> = [
  { id: 'solid', title: 'Solid' },
  { id: 'linear', title: 'Linear' },
  { id: 'radial', title: 'Radial' },
  { id: 'angular', title: 'Angular' },
  { id: 'diamond', title: 'Diamond' },
  { id: 'image', title: 'Image' },
  { id: 'video', title: 'Video' },
  { id: 'shader', title: 'Shader Beta' }
]

type Props = {
  paint: Paint
  pageColors?: string[]
  onChange: (paint: Paint) => void
  onClose: () => void
  anchor?: DOMRect | null
}

export function FillPicker({ paint, pageColors = [], onChange, onClose, anchor }: Props) {
  const [tab, setTab] = useState<'custom' | 'libraries'>('custom')
  const [format, setFormat] = useState<ColorFormat>('hex')
  const [formatOpen, setFormatOpen] = useState(false)
  const [activeStopId, setActiveStopId] = useState<string | null>(
    paint.type === 'gradient' ? paint.stops[0]?.id || null : null
  )
  const root = useRef<HTMLDivElement>(null)
  const type = fillTypeOf(paint)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
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
  }, [onClose])

  const activeColor =
    paint.type === 'solid'
      ? { color: paint.color, opacity: paint.opacity }
      : paint.type === 'gradient'
        ? (() => {
            const stop = paint.stops.find((item) => item.id === activeStopId) || paint.stops[0]
            return { color: stop?.color || '#D9D9D9', opacity: stop?.opacity ?? 1 }
          })()
        : paint.type === 'shader'
          ? { color: paint.colors[0] || '#5100ff', opacity: paint.opacity }
          : { color: '#D9D9D9', opacity: paint.opacity }

  const setActiveColor = (color: string, opacity: number) => {
    if (paint.type === 'solid') {
      onChange({ ...paint, color: parseHex(color), opacity })
      return
    }
    if (paint.type === 'gradient') {
      const id = activeStopId || paint.stops[0]?.id
      onChange({
        ...paint,
        stops: paint.stops.map((stop) =>
          stop.id === id ? { ...stop, color: parseHex(color), opacity } : stop
        )
      })
      return
    }
    if (paint.type === 'shader') {
      const colors = [...paint.colors]
      colors[0] = parseHex(color)
      onChange({ ...paint, colors, opacity })
    }
  }

  const top = anchor ? Math.min(window.innerHeight - 520, Math.max(48, anchor.bottom + 8)) : 120
  const left = anchor ? Math.min(window.innerWidth - 280, Math.max(16, anchor.left)) : 80

  return (
    <div ref={root} className="fill-picker" style={{ top, left }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="fill-picker-tabs">
        <button type="button" className={tab === 'custom' ? 'is-on' : ''} onClick={() => setTab('custom')}>
          Custom
        </button>
        <button type="button" className={tab === 'libraries' ? 'is-on' : ''} onClick={() => setTab('libraries')}>
          Libraries
        </button>
        <span className="fill-picker-tabs-spacer" />
        <button type="button" className="fill-picker-icon-btn" title="Close" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </button>
      </div>

      {tab === 'libraries' ? (
        <div className="fill-picker-empty">Document and team libraries coming soon.</div>
      ) : (
        <>
          <div className="fill-type-row">
            {FILL_TYPES.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.title}
                className={`fill-type-btn fill-type-${item.id}${type === item.id ? ' is-on' : ''}`}
                onClick={() => {
                  const next = paintForFillType(item.id, paint)
                  onChange(next)
                  if (next.type === 'gradient') setActiveStopId(next.stops[0]?.id || null)
                }}
              >
                <FillTypeIcon id={item.id} />
              </button>
            ))}
          </div>

          {(type === 'solid' ||
            type === 'linear' ||
            type === 'radial' ||
            type === 'angular' ||
            type === 'diamond') &&
            paint.type !== 'image' &&
            paint.type !== 'video' &&
            paint.type !== 'shader' && (
              <>
                {paint.type === 'gradient' && (
                  <GradientEditor
                    paint={paint}
                    activeStopId={activeStopId}
                    onActiveStop={setActiveStopId}
                    onChange={onChange}
                  />
                )}
                <ColorWheel
                  color={activeColor.color}
                  opacity={activeColor.opacity}
                  format={format}
                  formatOpen={formatOpen}
                  onFormatOpen={setFormatOpen}
                  onFormat={setFormat}
                  onChange={setActiveColor}
                />
              </>
            )}

          {paint.type === 'image' && <ImageFillEditor paint={paint} onChange={onChange} />}
          {paint.type === 'video' && <VideoFillEditor paint={paint} onChange={onChange} />}
          {paint.type === 'shader' && <ShaderFillEditor paint={paint} onChange={onChange} />}

          {pageColors.length > 0 && (
            <div className="fill-page-colors">
              <div className="fill-page-colors-head">On this page</div>
              <div className="fill-page-swatches">
                {pageColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="fill-page-swatch"
                    style={{ background: color }}
                    title={color}
                    onClick={() => setActiveColor(color, activeColor.opacity)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GradientEditor({
  paint,
  activeStopId,
  onActiveStop,
  onChange
}: {
  paint: Extract<Paint, { type: 'gradient' }>
  activeStopId: string | null
  onActiveStop: (id: string) => void
  onChange: (paint: Paint) => void
}) {
  const sorted = [...paint.stops].sort((a, b) => a.position - b.position)
  const barRef = useRef<HTMLDivElement>(null)

  const setStop = (id: string, patch: Partial<GradientStop>) => {
    onChange({
      ...paint,
      stops: paint.stops.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop))
    })
  }

  const addStop = () => {
    const mid = 0.5
    const stop: GradientStop = {
      id: newStopId(),
      position: mid,
      color: sorted[0]?.color || '#FFFFFF',
      opacity: 1
    }
    onChange({ ...paint, stops: [...paint.stops, stop] })
    onActiveStop(stop.id)
  }

  const removeStop = (id: string) => {
    if (paint.stops.length <= 2) return
    const next = paint.stops.filter((stop) => stop.id !== id)
    onChange({ ...paint, stops: next })
    if (activeStopId === id) onActiveStop(next[0]?.id || '')
  }

  const reverse = () => {
    onChange({
      ...paint,
      stops: paint.stops.map((stop) => ({ ...stop, position: 1 - stop.position }))
    })
  }

  const rotate = () => {
    onChange({ ...paint, angle: ((paint.angle || 0) + 90) % 360 })
  }

  return (
    <div className="fill-gradient">
      <div className="fill-gradient-toolbar">
        <select
          value={paint.gradientKind}
          onChange={(event) =>
            onChange({
              ...paint,
              gradientKind: event.target.value as typeof paint.gradientKind
            })
          }
        >
          <option value="linear">Linear</option>
          <option value="radial">Radial</option>
          <option value="angular">Angular</option>
          <option value="diamond">Diamond</option>
        </select>
        <button type="button" title="Reverse" onClick={reverse}>
          ⇄
        </button>
        <button type="button" title="Rotate" onClick={rotate}>
          ↻
        </button>
      </div>
      <div
        ref={barRef}
        className="fill-gradient-bar"
        style={{ background: paintPreviewCss(paint) }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).dataset.stop) return
          const rect = barRef.current?.getBoundingClientRect()
          if (!rect) return
          const position = clamp((event.clientX - rect.left) / rect.width)
          const stop: GradientStop = {
            id: newStopId(),
            position,
            color: sorted[0]?.color || '#FFFFFF',
            opacity: 1
          }
          onChange({ ...paint, stops: [...paint.stops, stop] })
          onActiveStop(stop.id)
        }}
      >
        {sorted.map((stop) => (
          <button
            key={stop.id}
            type="button"
            data-stop="1"
            className={`fill-gradient-stop${stop.id === activeStopId ? ' is-on' : ''}`}
            style={{ left: `${stop.position * 100}%`, background: withAlpha(stop.color, stop.opacity) }}
            onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
              event.stopPropagation()
              onActiveStop(stop.id)
              const rect = barRef.current?.getBoundingClientRect()
              if (!rect) return
              const move = (next: PointerEvent) => {
                const position = clamp((next.clientX - rect.left) / rect.width)
                setStop(stop.id, { position })
              }
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          />
        ))}
      </div>
      <div className="fill-stops-head">
        <span>Stops</span>
        <button type="button" onClick={addStop} title="Add stop">
          <AddIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      <div className="fill-stops-list">
        {sorted.map((stop) => (
          <div key={stop.id} className={`fill-stop-row${stop.id === activeStopId ? ' is-on' : ''}`}>
            <input
              className="fill-stop-pos"
              value={Math.round(stop.position * 100)}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                setStop(stop.id, { position: clamp(next / 100) })
              }}
            />
            <span className="fill-stop-pct">%</span>
            <button
              type="button"
              className="fill-stop-swatch"
              style={{ background: withAlpha(stop.color, stop.opacity) }}
              onClick={() => onActiveStop(stop.id)}
            />
            <input
              className="fill-stop-hex"
              value={stop.color.replace('#', '').toUpperCase()}
              spellCheck={false}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const raw = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                if (raw.length === 6) setStop(stop.id, { color: `#${raw.toUpperCase()}` })
              }}
            />
            <input
              className="fill-stop-opacity"
              value={Math.round(stop.opacity * 100)}
              onFocus={() => onActiveStop(stop.id)}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isFinite(next)) return
                setStop(stop.id, { opacity: clamp(next / 100) })
              }}
            />
            <span className="fill-stop-pct">%</span>
            <button type="button" className="fill-stop-remove" onClick={() => removeStop(stop.id)}>
              <RemoveIcon sx={{ fontSize: 14 }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ColorWheel({
  color,
  opacity,
  format,
  formatOpen,
  onFormatOpen,
  onFormat,
  onChange
}: {
  color: string
  opacity: number
  format: ColorFormat
  formatOpen: boolean
  onFormatOpen: (open: boolean) => void
  onFormat: (format: ColorFormat) => void
  onChange: (color: string, opacity: number) => void
}) {
  const hsb = hexToHsb(color)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const alphaRef = useRef<HTMLDivElement>(null)

  const setHsb = (next: { h?: number; s?: number; b?: number }, nextOpacity = opacity) => {
    onChange(hsbToHex({ h: next.h ?? hsb.h, s: next.s ?? hsb.s, b: next.b ?? hsb.b }), nextOpacity)
  }

  const pickSv = (event: ReactPointerEvent | PointerEvent, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect()
    const s = clamp((event.clientX - rect.left) / rect.width) * 100
    const b = (1 - clamp((event.clientY - rect.top) / rect.height)) * 100
    setHsb({ s, b })
  }

  const eyeDrop = async () => {
    const EyeDropperCtor = (window as Window & { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (!EyeDropperCtor) return
    try {
      const result = await new EyeDropperCtor().open()
      onChange(parseHex(result.sRGBHex), opacity)
    } catch {
      /* cancelled */
    }
  }

  const rgb = hexToRgb(color)
  const hsl = rgbToHsl(rgb)

  return (
    <div className="fill-color-wheel">
      <div
        ref={svRef}
        className="fill-sv"
        style={{ backgroundColor: hsbToHex({ h: hsb.h, s: 100, b: 100 }) }}
        onPointerDown={(event) => {
          const el = event.currentTarget
          pickSv(event, el)
          const move = (next: PointerEvent) => pickSv(next, el)
          const up = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      >
        <div className="fill-sv-white" />
        <div className="fill-sv-black" />
        <span
          className="fill-sv-thumb"
          style={{
            left: `${hsb.s}%`,
            top: `${100 - hsb.b}%`,
            background: color
          }}
        />
      </div>

      <div className="fill-sliders">
        <button type="button" className="fill-eyedropper" title="Eyedropper" onClick={() => void eyeDrop()}>
          <ColorizeIcon sx={{ fontSize: 18 }} />
        </button>
        <div className="fill-slider-stack">
          <div
            ref={hueRef}
            className="fill-hue"
            onPointerDown={(event) => {
              const el = event.currentTarget
              const apply = (clientX: number) => {
                const rect = el.getBoundingClientRect()
                setHsb({ h: clamp((clientX - rect.left) / rect.width) * 360 })
              }
              apply(event.clientX)
              const move = (next: PointerEvent) => apply(next.clientX)
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            <span className="fill-slider-thumb" style={{ left: `${(hsb.h / 360) * 100}%` }} />
          </div>
          <div
            ref={alphaRef}
            className="fill-alpha"
            style={{
              backgroundImage: `linear-gradient(to right, ${withAlpha(color, 0)}, ${withAlpha(color, 1)}), ${checkerboardCss(6)}`
            }}
            onPointerDown={(event) => {
              const el = event.currentTarget
              const apply = (clientX: number) => {
                const rect = el.getBoundingClientRect()
                onChange(color, clamp((clientX - rect.left) / rect.width))
              }
              apply(event.clientX)
              const move = (next: PointerEvent) => apply(next.clientX)
              const up = () => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
          >
            <span className="fill-slider-thumb" style={{ left: `${opacity * 100}%` }} />
          </div>
        </div>
      </div>

      <div className="fill-format-row">
        <div className="fill-format-select">
          <button type="button" onClick={() => onFormatOpen(!formatOpen)}>
            {format.toUpperCase()}
            <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
          </button>
          {formatOpen && (
            <div className="fill-format-menu">
              {(['hex', 'rgb', 'css', 'hsl', 'hsb'] as ColorFormat[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={format === item ? 'is-on' : ''}
                  onClick={() => {
                    onFormat(item)
                    onFormatOpen(false)
                  }}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {format === 'hex' && (
          <input
            className="fill-hex-input"
            value={color.replace('#', '').toUpperCase()}
            spellCheck={false}
            onChange={(event) => {
              const raw = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
              if (raw.length === 6) onChange(`#${raw.toUpperCase()}`, opacity)
            }}
          />
        )}
        {format === 'rgb' && (
          <>
            <Num value={rgb.r} onChange={(r) => onChange(rgbToHex({ ...rgb, r }), opacity)} />
            <Num value={rgb.g} onChange={(g) => onChange(rgbToHex({ ...rgb, g }), opacity)} />
            <Num value={rgb.b} onChange={(b) => onChange(rgbToHex({ ...rgb, b }), opacity)} />
          </>
        )}
        {format === 'css' && (
          <input
            className="fill-css-input"
            value={`rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.round(opacity * 100) / 100})`}
            spellCheck={false}
            onChange={(event) => {
              const match = event.target.value.match(
                /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i
              )
              if (!match) return
              onChange(
                rgbToHex({ r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) }),
                match[4] != null ? clamp(Number(match[4])) : opacity
              )
            }}
          />
        )}
        {format === 'hsl' && (
          <>
            <Num value={Math.round(hsl.h)} onChange={(h) => onChange(rgbToHex(hslToRgb({ ...hsl, h })), opacity)} />
            <Num value={Math.round(hsl.s)} onChange={(s) => onChange(rgbToHex(hslToRgb({ ...hsl, s })), opacity)} />
            <Num value={Math.round(hsl.l)} onChange={(l) => onChange(rgbToHex(hslToRgb({ ...hsl, l })), opacity)} />
          </>
        )}
        {format === 'hsb' && (
          <>
            <Num value={Math.round(hsb.h)} onChange={(h) => setHsb({ h })} />
            <Num value={Math.round(hsb.s)} onChange={(s) => setHsb({ s })} />
            <Num value={Math.round(hsb.b)} onChange={(b) => setHsb({ b })} />
          </>
        )}
        <Num value={Math.round(opacity * 100)} suffix="%" onChange={(v) => onChange(color, clamp(v / 100))} />
      </div>
    </div>
  )
}

function Num({
  value,
  suffix,
  onChange
}: {
  value: number
  suffix?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="fill-num">
      <input
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      {suffix ? <span>{suffix}</span> : null}
    </label>
  )
}

function ImageFillEditor({
  paint,
  onChange
}: {
  paint: Extract<Paint, { type: 'image' }>
  onChange: (paint: Paint) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const setAdj = (key: keyof typeof paint, value: number) => onChange({ ...paint, [key]: value })

  return (
    <div className="fill-media">
      <div className="fill-media-preview" style={{ background: paint.imageDataUrl ? undefined : checkerboardCss(10) }}>
        {paint.imageDataUrl ? (
          <AdjustedImage src={paint.imageDataUrl} adjust={paint} fit="cover" className="fill-media-preview-img" />
        ) : null}
        <button type="button" onClick={() => inputRef.current?.click()}>
          Upload from computer
        </button>
        <button type="button" disabled title="Coming soon">
          Make an image
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            onChange({ ...paint, imageDataUrl: String(reader.result || '') })
          }
          reader.readAsDataURL(file)
        }}
      />
      {(
        [
          ['exposure', 'Exposure'],
          ['contrast', 'Contrast'],
          ['saturation', 'Saturation'],
          ['temperature', 'Temperature'],
          ['tint', 'Tint'],
          ['highlights', 'Highlights'],
          ['shadows', 'Shadows']
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="fill-adj-row">
          <span>{label}</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(((paint[key] as number) || 0) * 100)}
            onChange={(event) => setAdj(key, Number(event.target.value) / 100)}
          />
          <em>{Math.round(((paint[key] as number) || 0) * 100)}</em>
        </label>
      ))}
    </div>
  )
}

function VideoFillEditor({
  paint,
  onChange
}: {
  paint: Extract<Paint, { type: 'video' }>
  onChange: (paint: Paint) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="fill-media">
      <div className="fill-media-preview" style={{ background: checkerboardCss(10) }}>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Upload video
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => onChange({ ...paint, videoDataUrl: String(reader.result || '') })
          reader.readAsDataURL(file)
        }}
      />
      {paint.videoDataUrl ? <video className="fill-video-preview" src={paint.videoDataUrl} muted loop autoPlay /> : null}
    </div>
  )
}

function ShaderFillEditor({
  paint,
  onChange
}: {
  paint: Extract<Paint, { type: 'shader' }>
  onChange: (paint: Paint) => void
}) {
  const params = Object.entries(paint.params || {})
  return (
    <div className="fill-shader">
      <label className="fill-shader-select">
        <span>Shader</span>
        <select
          value={paint.shader}
          onChange={(event) => onChange(defaultShader(event.target.value as ShaderKind))}
        >
          {SHADER_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="fill-shader-colors">
        {paint.colors.map((color, index) => (
          <label key={index} className="fill-shader-color">
            <span style={{ background: color }} />
            <input
              type="color"
              value={parseHex(color)}
              onChange={(event) => {
                const colors = [...paint.colors]
                colors[index] = event.target.value.toUpperCase()
                onChange({ ...paint, colors })
              }}
            />
          </label>
        ))}
        {paint.colors.length < 6 && (
          <button
            type="button"
            className="fill-shader-add-color"
            onClick={() => onChange({ ...paint, colors: [...paint.colors, '#FFFFFF'] })}
          >
            <AddIcon sx={{ fontSize: 14 }} />
          </button>
        )}
      </div>
      <label className="fill-adj-row">
        <span>Speed</span>
        <input
          type="range"
          min={0}
          max={200}
          value={Math.round((paint.speed ?? 0) * 100)}
          onChange={(event) => onChange({ ...paint, speed: Number(event.target.value) / 100 })}
        />
        <em>{Math.round((paint.speed ?? 0) * 100)}%</em>
      </label>
      {params.map(([key, value]) => (
        <label key={key} className="fill-adj-row">
          <span>{key}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(value * 100)}
            onChange={(event) =>
              onChange({
                ...paint,
                params: { ...paint.params, [key]: Number(event.target.value) / 100 }
              })
            }
          />
          <em>{Math.round(value * 100)}</em>
        </label>
      ))}
    </div>
  )
}

function FillTypeIcon({ id }: { id: FillTypeId }) {
  if (id === 'solid') return <span className="fti fti-solid" />
  if (id === 'linear') return <span className="fti fti-linear" />
  if (id === 'radial') return <span className="fti fti-radial" />
  if (id === 'angular') return <span className="fti fti-angular" />
  if (id === 'diamond') return <span className="fti fti-diamond" />
  if (id === 'image') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="2.5" width="11" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M1.5 9.5l3-3 2.5 2.5 2-2 3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="4.5" cy="5.2" r="1" fill="currentColor" />
      </svg>
    )
  }
  if (id === 'video') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1.5" y="3" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9.5 5.5l3-1.5v7l-3-1.5v-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1.5c2.2 2.4 3.8 4.2 3.8 6.1A3.8 3.8 0 0 1 7 11.4 3.8 3.8 0 0 1 3.2 7.6C3.2 5.7 4.8 3.9 7 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  )
}
