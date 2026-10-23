import { useState, type CSSProperties, type ReactNode } from 'react'
import { withAlpha } from './colorMath'

/** Value box + slider in one pill (opacity, corner radius). */
export function SliderField({
  icon,
  value,
  unit = '',
  min = 0,
  max,
  step = 1,
  onChange
}: {
  icon?: ReactNode
  value: number
  unit?: string
  min?: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0'
  const clamped = Math.max(min, Math.min(max, Number.isFinite(value) ? value : 0))
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0
  return (
    <div className="prop-slider-field">
      <label className="prop-slider-value">
        {icon && <span className="prop-slider-ico">{icon}</span>}
        <input
          value={draft ?? `${shown}${unit}`}
          onFocus={(event) => {
            setDraft(shown)
            const input = event.currentTarget
            window.requestAnimationFrame(() => input.select())
          }}
          onBlur={() => setDraft(null)}
          onChange={(event) => {
            setDraft(event.target.value)
            const text = unit ? event.target.value.replace(unit, '') : event.target.value
            const next = Number(text.trim())
            if (text.trim() && Number.isFinite(next)) onChange(next)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </label>
      <div className="prop-slider-track">
        <input
          type="range"
          className="prop-slider"
          min={min}
          max={max}
          step={step}
          value={clamped}
          style={{ ['--pct' as string]: `${pct}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
    </div>
  )
}

export function StrokeWeightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 2.5h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <rect x="1.5" y="5" width="11" height="2.5" rx="0.75" stroke="currentColor" strokeWidth="1" />
      <rect x="1.5" y="9.5" width="11" height="3" rx="0.75" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

/** Swatch + hex (+ opacity) pill, as used by fills and selection colors. */
export function FillRow({
  hex,
  opacity,
  rowRef,
  onSwatch,
  onHex,
  onOpacity
}: {
  hex: string
  opacity: number
  rowRef?: (el: HTMLDivElement | null) => void
  onSwatch: () => void
  onHex: (value: string) => void
  onOpacity?: (value: number) => void
}) {
  return (
    <div className="prop-fill-card prop-fill-card-rich is-color-row" ref={rowRef}>
      <div className="prop-fill-pill">
        <button
          type="button"
          className="prop-fill-swatch-btn"
          title="Edit color"
          style={{ background: withAlpha(hex, opacity / 100) }}
          onClick={onSwatch}
        />
        <input
          className="prop-fill-label-btn prop-fill-hex-input"
          value={hex.replace('#', '')}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
            if (next.length === 6) onHex(`#${next.toUpperCase()}`)
          }}
        />
        {onOpacity && (
          <>
            <span className="prop-fill-sep" aria-hidden />
            <label className="prop-fill-opacity">
              <input
                value={String(Math.round(opacity))}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isFinite(next)) onOpacity(next)
                }}
              />
              <em>%</em>
            </label>
          </>
        )}
      </div>
    </div>
  )
}
