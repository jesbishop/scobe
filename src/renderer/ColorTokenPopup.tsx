import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AddIcon, CloseIcon, ContentCopyIcon, DeleteOutlinedIcon, FilterNoneIcon, KeyboardArrowDownIcon, MoreHorizIcon, SearchIcon } from './lucideIcons'
import {
  checkerboardCss,
  hexToHsb,
  hexToRgb,
  hsbToHex,
  hslToRgb,
  lchToRgb,
  parseHex,
  rgbToHex,
  rgbToHsl,
  rgbToLch,
  type HSB
} from './colorMath'
import { stepNumberInput } from './numberArrowKeys'

export type ColorToken = {
  id: string
  name: string
  hex: string
  opacity: number
  aliasId?: string | null
}

type Props = {
  token: ColorToken
  colors: ColorToken[]
  x: number
  y: number
  autoFocusName?: boolean
  onClose: () => void
  onChange: (next: ColorToken) => void
  onDuplicate: () => void
  onDelete: () => void
  onCreateColor?: () => void
}

function stripHash(hex: string) {
  return parseHex(hex).replace('#', '')
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect x="2" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="2" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="2" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
      <rect x="8" y="8" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M5.5 8.5 8.5 5.5M6.2 4.2l.9-.9a2.2 2.2 0 0 1 3.1 3.1l-.9.9M7.8 9.8l-.9.9a2.2 2.2 0 0 1-3.1-3.1l.9-.9"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EyedropperIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M9.2 2.4 11.6 4.8M8.1 3.5 3.2 8.4c-.4.4-.4 1 0 1.4l1 1c.4.4 1 .4 1.4 0l4.9-4.9M4.1 10.7 2.6 12.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ColorSvPlane({ hsb, onChange }: { hsb: HSB; onChange: (next: HSB) => void }) {
  const root = useRef<HTMLDivElement>(null)
  const drag = (clientX: number, clientY: number) => {
    const el = root.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
    const b = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100))
    onChange({ ...hsb, s, b })
  }
  return (
    <div
      ref={root}
      className="color-token-sv"
      style={{ background: `hsl(${hsb.h} 100% 50%)` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag(event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        drag(event.clientX, event.clientY)
      }}
    >
      <div className="color-token-sv-white" />
      <div className="color-token-sv-black" />
      <span
        className="color-token-sv-knob"
        style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%`, background: hsbToHex(hsb) }}
      />
    </div>
  )
}

function VerticalSlider({
  className,
  value,
  onChange,
  style
}: {
  className: string
  value: number
  onChange: (next: number) => void
  style?: CSSProperties
}) {
  const root = useRef<HTMLDivElement>(null)
  const drag = (clientY: number) => {
    const el = root.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onChange(Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100)))
  }
  return (
    <div
      ref={root}
      className={className}
      style={style}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag(event.clientY)
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        drag(event.clientY)
      }}
    >
      <span className="color-token-slider-knob" style={{ top: `${100 - value}%` }} />
    </div>
  )
}

function ChannelRow({
  values,
  labels,
  onChange,
  onCopy
}: {
  values: string[]
  labels: string[]
  onChange: (index: number, raw: string) => void
  onCopy: () => void
}) {
  return (
    <div className="color-token-channels">
      <div className="color-token-channel-values">
        {values.map((value, index) => (
          <input
            key={labels[index]}
            value={value}
            spellCheck={false}
            onChange={(event) => onChange(index, event.target.value)}
          />
        ))}
        <button type="button" title="Copy" aria-label="Copy" onClick={onCopy}>
          <ContentCopyIcon sx={{ fontSize: 13 }} />
        </button>
      </div>
      <div className="color-token-channel-labels">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
        <span />
      </div>
    </div>
  )
}

export function ColorTokenPopup({
  token,
  colors,
  x,
  y,
  autoFocusName = false,
  onClose,
  onChange,
  onDuplicate,
  onDelete,
  onCreateColor
}: Props) {
  const root = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [space, setSpace] = useState<'srgb' | 'p3'>('srgb')
  const [previousHex] = useState(token.hex)
  const [hexDraft, setHexDraft] = useState(stripHash(token.hex))

  const alias = token.aliasId ? colors.find((item) => item.id === token.aliasId) : null
  const resolvedHex = alias ? alias.hex : token.hex
  const hsb = hexToHsb(resolvedHex)
  const rgb = hexToRgb(resolvedHex)
  const hsl = rgbToHsl(rgb)
  const lch = rgbToLch(rgb)
  const libraryColors = colors
    .filter((item) => item.id !== token.id)
    .filter((item) => {
      const q = libraryQuery.trim().toLowerCase()
      if (!q) return true
      return item.name.toLowerCase().includes(q) || stripHash(item.hex).toLowerCase().includes(q)
    })

  useEffect(() => {
    setHexDraft(stripHash(alias ? alias.hex : token.hex))
  }, [token.hex, token.aliasId, alias?.hex])

  useEffect(() => {
    if (autoFocusName) {
      requestAnimationFrame(() => {
        nameRef.current?.focus()
        nameRef.current?.select()
      })
    }
  }, [autoFocusName, token.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (libraryOpen) setLibraryOpen(false)
        else if (pickerOpen) setPickerOpen(false)
        else onClose()
      }
    }
    const onDown = (event: MouseEvent) => {
      if (root.current?.contains(event.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose, libraryOpen, pickerOpen])

  useEffect(() => {
    const el = root.current
    if (!el) return
    const pad = 10
    const rect = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad)
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [x, y, pickerOpen, libraryOpen, token.id])

  const patch = (partial: Partial<ColorToken>) => onChange({ ...token, ...partial })
  const setHex = (hex: string, clearAlias = true) => {
    const next = parseHex(hex, resolvedHex)
    setHexDraft(stripHash(next))
    patch({
      hex: next,
      ...(clearAlias ? { aliasId: null } : {})
    })
  }
  const setHsb = (next: HSB) => setHex(hsbToHex(next))
  const openPicker = () => {
    setLibraryOpen(false)
    setPickerOpen(true)
  }

  const transition = reduceMotion
    ? { duration: 0.08 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text).catch(() => undefined)
  }

  const parseChannel = (raw: string) => {
    const n = Number.parseFloat(raw.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : null
  }

  return (
    <motion.div
      ref={root}
      className={`color-token-popup${pickerOpen ? ' has-picker' : ''}`}
      data-chrome-overlay=""
      style={{ left: x, top: y }}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
      transition={transition}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={stepNumberInput}
    >
      <div className="color-token-card">
        <div className="color-token-card-head">
          <strong>Color</strong>
          <span className="color-token-card-actions">
            <button type="button" title="Duplicate" aria-label="Duplicate" onClick={onDuplicate}>
              <FilterNoneIcon sx={{ fontSize: 16 }} />
            </button>
            <button type="button" title="Delete" aria-label="Delete" onClick={onDelete}>
              <DeleteOutlinedIcon sx={{ fontSize: 17 }} />
            </button>
            <button type="button" title="Close" aria-label="Close" onClick={onClose}>
              <CloseIcon sx={{ fontSize: 17 }} />
            </button>
          </span>
        </div>

        <button
          type="button"
          className="color-token-preview"
          style={{ backgroundImage: checkerboardCss(8) }}
          title="Edit color"
          aria-label="Edit color"
          onClick={() => {
            setLibraryOpen(false)
            setPickerOpen((open) => !open)
          }}
        >
          <span
            className="color-token-preview-fill"
            style={{ background: resolvedHex, opacity: token.opacity / 100 }}
          />
        </button>

        <label className="color-token-field">
          <span>Name</span>
          <input
            ref={nameRef}
            value={token.name}
            onChange={(event) => patch({ name: event.target.value })}
            spellCheck={false}
            data-arrow-step="off"
          />
        </label>

        <div className="color-token-field color-token-value-field">
          <span>Value</span>
          <div className={`color-token-value${alias ? ' is-aliased' : ''}`}>
            <button
              type="button"
              className="color-token-value-swatch"
              title="Edit color"
              style={{ background: resolvedHex }}
              onClick={() => {
                setLibraryOpen(false)
                setPickerOpen((open) => !open)
              }}
            />
            {alias ? (
              <button
                type="button"
                className="color-token-alias-pill"
                title={alias.name}
                onClick={() => {
                  setPickerOpen(false)
                  setLibraryOpen(true)
                }}
              >
                <span className="color-token-alias-swatch" style={{ background: alias.hex }} />
                <span>{alias.name}</span>
              </button>
            ) : (
              <input
                className="color-token-hex"
                value={hexDraft}
                spellCheck={false}
                onChange={(event) => {
                  const raw = event.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                  setHexDraft(raw)
                  if (raw.length === 3 || raw.length === 6) setHex(`#${raw}`)
                }}
                onBlur={() => setHex(`#${hexDraft}`)}
                onFocus={() => setLibraryOpen(false)}
              />
            )}
            <input
              className="color-token-opacity"
              value={`${Math.round(token.opacity)}%`}
              onChange={(event) => {
                const n = Number.parseInt(event.target.value.replace(/[^\d]/g, ''), 10)
                if (Number.isFinite(n)) patch({ opacity: Math.max(0, Math.min(100, n)) })
              }}
            />
            <button
              type="button"
              className={`color-token-value-more${libraryOpen ? ' is-on' : ''}`}
              title={alias ? 'Unlink' : 'Styles'}
              aria-label={alias ? 'Unlink' : 'Styles'}
              onClick={() => {
                if (alias) {
                  patch({ aliasId: null, hex: alias.hex })
                  setLibraryOpen(false)
                  return
                }
                setPickerOpen(false)
                setLibraryOpen((open) => !open)
              }}
            >
              {alias ? <LinkIcon /> : <GridIcon />}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {libraryOpen ? (
            <motion.div
              key="library"
              className="color-token-library"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
              transition={transition}
            >
              <div className="color-token-library-head">
                <label className="color-token-library-search">
                  <SearchIcon sx={{ fontSize: 14 }} />
                  <input
                    value={libraryQuery}
                    placeholder="Search"
                    spellCheck={false}
                    onChange={(event) => setLibraryQuery(event.target.value)}
                  />
                </label>
                <span className="color-token-library-tools">
                  <button type="button" className="is-on" title="Styles" aria-label="Styles">
                    <GridIcon />
                  </button>
                  <button
                    type="button"
                    title="New color"
                    aria-label="New color"
                    onClick={() => onCreateColor?.()}
                  >
                    <AddIcon sx={{ fontSize: 16 }} />
                  </button>
                </span>
              </div>
              <div className="color-token-library-list">
                {libraryColors.length === 0 ? (
                  <p className="color-token-library-empty">
                    {libraryQuery.trim() ? 'No matches' : 'No other colors yet'}
                  </p>
                ) : (
                  libraryColors.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`color-token-library-item${token.aliasId === item.id ? ' is-on' : ''}`}
                      onClick={() => {
                        patch({ aliasId: item.id, hex: item.hex })
                        setLibraryOpen(false)
                        setLibraryQuery('')
                      }}
                    >
                      <span className="token-row-swatch" style={{ background: item.hex }} />
                      <span>{item.name}</span>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {pickerOpen ? (
          <motion.div
            key="picker"
            className="color-token-picker"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -8, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -6, scale: 0.99 }}
            transition={transition}
          >
            <div className="color-token-picker-head">
              <div className="color-token-picker-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={space === 'srgb' ? 'is-on' : ''}
                  aria-selected={space === 'srgb'}
                  onClick={() => setSpace('srgb')}
                >
                  sRGB
                </button>
                <button
                  type="button"
                  role="tab"
                  className={space === 'p3' ? 'is-on' : ''}
                  aria-selected={space === 'p3'}
                  onClick={() => setSpace('p3')}
                >
                  Display P3
                </button>
              </div>
              <span className="color-token-picker-actions">
                <button type="button" title="Eyedropper" aria-label="Eyedropper" onClick={openPicker}>
                  <EyedropperIcon />
                </button>
                <button type="button" title="More" aria-label="More">
                  <MoreHorizIcon sx={{ fontSize: 16 }} />
                </button>
                <button type="button" title="Close picker" aria-label="Close picker" onClick={() => setPickerOpen(false)}>
                  <CloseIcon sx={{ fontSize: 16 }} />
                </button>
              </span>
            </div>

            <div className="color-token-picker-body">
              <div className="color-token-picker-main">
                <ColorSvPlane hsb={hsb} onChange={setHsb} />
                <VerticalSlider
                  className="color-token-alpha"
                  value={token.opacity}
                  onChange={(v) => patch({ opacity: v })}
                  style={{
                    backgroundImage: `${checkerboardCss(6)}, linear-gradient(to top, transparent, ${resolvedHex})`
                  }}
                />
                <VerticalSlider
                  className="color-token-hue"
                  value={(hsb.h / 360) * 100}
                  onChange={(v) => setHsb({ ...hsb, h: (v / 100) * 360 })}
                  style={{
                    background:
                      'linear-gradient(to top, #ff0000, #ff00ff, #0000ff, #00ffff, #00ff00, #ffff00, #ff0000)'
                  }}
                />
              </div>

              <div className="color-token-picker-side">
                <div className="color-token-compare">
                  <span style={{ background: previousHex }} title="Previous" />
                  <span style={{ background: resolvedHex }} title="New" />
                </div>
                <div className="color-token-compare-labels">
                  <em>Previous</em>
                  <em>New</em>
                </div>

                <ChannelRow
                  values={[lch.l.toFixed(1), (lch.c / 150).toFixed(3), lch.h.toFixed(1)]}
                  labels={['L', 'C', 'H']}
                  onChange={(index, raw) => {
                    const n = parseChannel(raw)
                    if (n == null) return
                    const next = { ...lch }
                    if (index === 0) next.l = Math.max(0, Math.min(100, n))
                    if (index === 1) next.c = Math.max(0, n * 150)
                    if (index === 2) next.h = ((n % 360) + 360) % 360
                    setHex(rgbToHex(lchToRgb(next)))
                  }}
                  onCopy={() => copyText(`${lch.l.toFixed(1)} ${lch.c.toFixed(1)} ${lch.h.toFixed(1)}`)}
                />
                <ChannelRow
                  values={[hsl.h.toFixed(1), hsl.s.toFixed(1), hsl.l.toFixed(1)]}
                  labels={['H', 'S', 'L']}
                  onChange={(index, raw) => {
                    const n = parseChannel(raw)
                    if (n == null) return
                    const next = { ...hsl }
                    if (index === 0) next.h = ((n % 360) + 360) % 360
                    if (index === 1) next.s = Math.max(0, Math.min(100, n))
                    if (index === 2) next.l = Math.max(0, Math.min(100, n))
                    setHex(rgbToHex(hslToRgb(next)))
                  }}
                  onCopy={() => copyText(`${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`)}
                />
                <ChannelRow
                  values={[String(rgb.r), String(rgb.g), String(rgb.b)]}
                  labels={['R', 'G', 'B']}
                  onChange={(index, raw) => {
                    const n = parseChannel(raw)
                    if (n == null) return
                    const next = { ...rgb }
                    const v = Math.max(0, Math.min(255, Math.round(n)))
                    if (index === 0) next.r = v
                    if (index === 1) next.g = v
                    if (index === 2) next.b = v
                    setHex(rgbToHex(next))
                  }}
                  onCopy={() => copyText(`${rgb.r}, ${rgb.g}, ${rgb.b}`)}
                />

                <div className="color-token-picker-hexrow">
                  <input
                    value={`${stripHash(resolvedHex)} / ${Math.round(token.opacity)}%`}
                    spellCheck={false}
                    onChange={(event) => {
                      const [hexPart, opacityPart] = event.target.value.split('/')
                      if (hexPart) setHex(`#${hexPart.trim()}`)
                      if (opacityPart) {
                        const n = Number.parseInt(opacityPart.replace(/[^\d]/g, ''), 10)
                        if (Number.isFinite(n)) patch({ opacity: Math.max(0, Math.min(100, n)) })
                      }
                    }}
                  />
                  <button type="button" title="Format" aria-label="Format">
                    <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}
