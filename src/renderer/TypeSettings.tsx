import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import type { DesignNode } from '../shared/types'
import { defaultSolid, getNodePaints } from '../shared/paint'
import { FillPicker } from './FillPicker'
import { findGoogleFont } from './googleFonts'
import {
  decorationColor,
  listIndentEm,
  paragraphStyle,
  textBlockStyle,
  textParagraphs,
  textTypographyStyle,
  usesParagraphBlocks,
  type TextParagraph
} from './textLayout'

type Patch = Partial<DesignNode>

type PreviewSpec = {
  text: string
  patch?: Patch
  /** Show the text bounds (trim / truncation / spacing previews). */
  outline?: boolean
  /** First line stays unmarked, like a list introduced by a heading. */
  listIntro?: boolean
  /** Render the text once per patch side by side (e.g. "Ag Ag Ag" thickness samples). */
  variants?: Patch[]
}

const SAMPLE = 'The quick brown fox jumps over 17 lazy dogs.'
const WRAP_SAMPLE = 'The quick brown fox jumped over a lazy dog.'
const PREVIEW_SIZE = 20

export function TextAlignIcon({ kind }: { kind: 'left' | 'center' | 'right' | 'justify' }) {
  const d =
    kind === 'left'
      ? 'M2 3.5h10M2 7h7M2 10.5h9'
      : kind === 'center'
        ? 'M2 3.5h10M3.5 7h7M2.5 10.5h9'
        : kind === 'right'
          ? 'M2 3.5h10M5 7h7M3 10.5h9'
          : 'M2 3.5h10M2 7h10M2 10.5h10'
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function TextVAlignIcon({ kind }: { kind: 'top' | 'middle' | 'bottom' }) {
  const arrow =
    kind === 'top'
      ? 'M7 12V5.5M4.8 7.7 7 5.5l2.2 2.2'
      : kind === 'bottom'
        ? 'M7 2v6.5M4.8 6.3 7 8.5l2.2-2.2'
        : 'M7 1.5v3M5.2 3 7 4.8 8.8 3M7 12.5v-3M5.2 11 7 9.2 8.8 11'
  const bar = kind === 'top' ? 'M2.5 2.5h9' : kind === 'bottom' ? 'M2.5 11.5h9' : 'M2.5 7h9'
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d={bar} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d={arrow} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function TypeSettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M4.5 2v2.2M4.5 7.8V12M9.5 2v4.2M9.5 9.8V12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="4.5" cy="6" r="1.7" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="9.5" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function Chevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
      <path d="M1.5 3 4 5.5 6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NONE = <span className="ts-dash" aria-hidden />

function DecoStyleIcon({ kind }: { kind: 'solid' | 'dotted' | 'wavy' }) {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden>
      {kind === 'solid' && <path d="M2 7h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
      {kind === 'dotted' && (
        <path d="M2 7h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.1 2.9" />
      )}
      {kind === 'wavy' && (
        <path
          d="M2 7.8c1-1.6 2-1.6 3 0s2 1.6 3 0 2-1.6 3 0 2 1.6 3 0"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9.5 4 5.5 8l4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ListIcon({ kind }: { kind: 'unordered' | 'ordered' }) {
  return kind === 'unordered' ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="2.8" cy="3.5" r="0.9" fill="currentColor" />
      <circle cx="2.8" cy="7" r="0.9" fill="currentColor" />
      <circle cx="2.8" cy="10.5" r="0.9" fill="currentColor" />
      <path d="M5.5 3.5H12M5.5 7H12M5.5 10.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.2 2.6 3 2.2v3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.1 8.4c.2-.5.6-.7 1-.7.5 0 .8.3.8.7 0 .6-.9 1-1.8 1.9H4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 3.5H12M5.5 7H12M5.5 10.5H12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

type SegOption<T extends string> = { value: T; title: string; icon: ReactNode; preview?: PreviewSpec }

function Seg<T extends string>({
  value,
  options,
  onChange,
  onPreview
}: {
  value: T
  options: SegOption<T>[]
  onChange: (value: T) => void
  onPreview: (spec: PreviewSpec | null) => void
}) {
  return (
    <div className="ts-seg" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          className={value === option.value ? 'is-on' : undefined}
          onPointerEnter={() => onPreview(option.preview || null)}
          onPointerLeave={() => onPreview(null)}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
        </button>
      ))}
    </div>
  )
}

function NumField({
  value,
  placeholder,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  suffix = '',
  className,
  onCommit,
  onPreview
}: {
  value: number | undefined
  placeholder?: string
  min?: number
  max?: number
  suffix?: string
  className?: string
  onCommit: (value: number | undefined) => void
  onPreview?: (value: number | undefined) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value == null ? '' : `${value}${suffix}`)
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * 100) / 100))
  const commit = (raw: string) => {
    setDraft(null)
    const trimmed = raw.replace('%', '').trim()
    if (!trimmed || trimmed.toLowerCase() === 'auto') {
      if (placeholder) onCommit(undefined)
      return
    }
    const next = Number(trimmed)
    if (Number.isFinite(next)) onCommit(clamp(next))
  }
  return (
    <input
      className={className ? `ts-num ${className}` : 'ts-num'}
      value={shown}
      placeholder={placeholder}
      onPointerEnter={() => onPreview?.(value)}
      onPointerLeave={() => onPreview?.(undefined)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          commit(event.currentTarget.value)
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
          const base = Number.parseFloat(shown)
          setDraft(null)
          onCommit(clamp((Number.isFinite(base) ? base : (value ?? 0)) + step))
        }
      }}
    />
  )
}

function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  onPreview
}: {
  value: T
  options: { value: T; label: string; preview?: PreviewSpec }[]
  onChange: (value: T) => void
  onPreview: (spec: PreviewSpec | null) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open])
  const current = options.find((option) => option.value === value) || options[0]
  return (
    <div className="ts-select" ref={root}>
      <button type="button" className={open ? 'is-open' : undefined} onClick={() => setOpen((next) => !next)}>
        <span>{current.label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="prop-blend-menu ts-select-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onPointerEnter={() => onPreview(option.preview || null)}
              onPointerLeave={() => onPreview(null)}
              onClick={() => {
                onChange(option.value)
                onPreview(null)
                setOpen(false)
              }}
            >
              <span className="prop-blend-check">{option.value === value ? '✓' : ''}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, children, onPreview }: { label: string; children: ReactNode; onPreview?: () => void }) {
  return (
    <div className="ts-row" onPointerEnter={onPreview}>
      <span className="ts-label">{label}</span>
      <div className="ts-control">{children}</div>
    </div>
  )
}

function PreviewText({ node, spec }: { node: DesignNode; spec: PreviewSpec }) {
  const preview: DesignNode = {
    ...node,
    fontSize: PREVIEW_SIZE,
    lineHeight: 0,
    textResize: 'auto-height',
    ...spec.patch
  }
  const blocks = usesParagraphBlocks(preview)
  let paragraphs: TextParagraph[] | null = blocks ? textParagraphs(preview, spec.text) : null
  if (paragraphs && spec.listIntro) {
    let n = 0
    paragraphs = paragraphs.map((para, index) => {
      if (index === 0) return { text: para.text }
      n += 1
      return { text: para.text, marker: preview.listStyle === 'ordered' ? `${n}.` : preview.listStyle === 'unordered' ? '•' : undefined }
    })
  }
  const indent = paragraphs ? listIndentEm(preview, paragraphs) : 0
  const style: CSSProperties = {
    ...textTypographyStyle(preview),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }
  if (spec.variants) {
    return (
      <div className="ts-preview-text ts-preview-variants" style={style}>
        {spec.variants.map((variant, index) => (
          <span key={index} style={textTypographyStyle({ ...preview, ...variant })}>
            {spec.text}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className="ts-preview-text" style={style}>
      <span
        className={`ts-preview-block${spec.outline ? ' is-outlined' : ''}`}
        style={{ ...textBlockStyle(preview), ...(preview.textTruncation ? {} : { display: 'block' }) }}
      >
        {paragraphs
          ? paragraphs.map((para, index) => (
              <span
                key={index}
                className={para.marker ? 'design-text-para has-marker' : 'design-text-para'}
                data-marker={para.marker}
                style={{
                  ...paragraphStyle(preview, index, paragraphs!.length, para.marker ? indent : 0)
                }}
              >
                {para.text || '\u200b'}
              </span>
            ))
          : spec.text}
      </span>
    </div>
  )
}

export function TypeSettingsPopup({
  node,
  anchor,
  ignoreRef,
  onPatch,
  onClose
}: {
  node: DesignNode
  anchor: { top: number; left: number; right: number } | null
  ignoreRef?: RefObject<HTMLElement | null>
  onPatch: (patch: Patch) => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'basics' | 'details' | 'variable' | 'decoration'>('basics')
  const [preview, setPreview] = useState<PreviewSpec | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null)
  const colorOpenRef = useRef(false)
  colorOpenRef.current = Boolean(colorAnchor)

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element
      if (root.current?.contains(target) || ignoreRef?.current?.contains(target)) return
      if (target.closest?.('.ts-color-host')) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !colorOpenRef.current) onClose()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, ignoreRef])

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    const panel = el.parentElement?.closest('.rightbar') as HTMLElement | null
    const panelLeft = panel ? panel.getBoundingClientRect().left : (anchor?.left ?? 400) - 16
    let left = panelLeft - width - 8
    if (left < 8) left = Math.min(window.innerWidth - width - 8, (anchor?.right ?? 0) + 8)
    const top = Math.max(8, Math.min(window.innerHeight - height - 8, (anchor?.top ?? 120) - 180))
    setPos({ top, left })
  }, [anchor?.top, anchor?.left, anchor?.right, tab, Boolean(node.textTruncation), node.textDecoration])

  const decoration = node.textDecoration || 'none'
  const decorated = decoration !== 'none'
  const withDecoration = (patch: Patch): Patch => (decorated ? patch : { textDecoration: 'underline', ...patch })
  const family = node.fontFamily || 'Inter'
  const font = findGoogleFont(family)
  const weights = (font?.variants || [])
    .map((variant) => Number.parseInt(variant, 10))
    .filter((weight) => Number.isFinite(weight))
  const weightMin = weights.length ? Math.min(...weights) : 100
  const weightMax = weights.length ? Math.max(...weights) : 900
  const variableWeight = Boolean(font?.axes.includes('wght'))
  const weight = Math.round(Number(node.fontWeight) || 400)

  const sample = (patch: Patch, text = SAMPLE, extra?: Partial<PreviewSpec>): PreviewSpec => ({ text, patch, ...extra })

  const basics = (
    <>
      <div className="ts-group">
        <Row label="Alignment">
          <Seg
            value={node.textAlign || 'left'}
            onChange={(textAlign) => onPatch({ textAlign })}
            onPreview={setPreview}
            options={(['left', 'center', 'right', 'justify'] as const).map((value) => ({
              value,
              title: value === 'justify' ? 'Justified' : `Align ${value}`,
              icon: <TextAlignIcon kind={value} />,
              preview: sample({ textAlign: value })
            }))}
          />
        </Row>
        <Row label="Decoration">
          <Seg
            value={decoration}
            onChange={(textDecoration) => onPatch({ textDecoration })}
            onPreview={setPreview}
            options={[
              { value: 'none', title: 'None', icon: NONE, preview: sample({ textDecoration: 'none' }) },
              {
                value: 'underline',
                title: 'Underline',
                icon: <span className="ts-glyph is-underline">U</span>,
                preview: sample({ textDecoration: 'underline' })
              },
              {
                value: 'line-through',
                title: 'Strikethrough',
                icon: <span className="ts-glyph is-strike">S</span>,
                preview: sample({ textDecoration: 'line-through' })
              }
            ]}
          />
          <button type="button" className="ts-more" title="Decoration settings" onClick={() => setTab('decoration')}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden>
              <path d="M3 1.5 5.5 4 3 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </Row>
        <Row label="Case">
          <Seg
            value={node.textCase || 'none'}
            onChange={(textCase) => onPatch({ textCase })}
            onPreview={setPreview}
            options={[
              { value: 'none', title: 'As typed', icon: NONE, preview: sample({ textCase: 'none' }) },
              { value: 'upper', title: 'Uppercase', icon: <span className="ts-glyph">AG</span>, preview: sample({ textCase: 'upper' }) },
              { value: 'lower', title: 'Lowercase', icon: <span className="ts-glyph">ag</span>, preview: sample({ textCase: 'lower' }) },
              { value: 'title', title: 'Title case', icon: <span className="ts-glyph">Ag</span>, preview: sample({ textCase: 'title' }) },
              {
                value: 'small-caps',
                title: 'Small caps',
                icon: <span className="ts-glyph is-small-caps">Ag</span>,
                preview: sample({ textCase: 'small-caps' })
              }
            ]}
          />
        </Row>
      </div>
      <div className="ts-group">
        <Row label="Vertical trim">
          <Seg
            value={node.leadingTrim || 'none'}
            onChange={(leadingTrim) => onPatch({ leadingTrim })}
            onPreview={setPreview}
            options={[
              {
                value: 'none',
                title: 'Standard',
                icon: <span className="ts-trim-ico">Ag</span>,
                preview: sample({ leadingTrim: 'none' }, 'Pack my text box with five dozen leading trims', { outline: true })
              },
              {
                value: 'cap',
                title: 'Cap height to baseline',
                icon: <span className="ts-trim-ico is-cap">Ag</span>,
                preview: sample({ leadingTrim: 'cap' }, 'Pack my text box with five dozen leading trims', { outline: true })
              }
            ]}
          />
        </Row>
        <Row label="List style">
          <Seg
            value={node.listStyle || 'none'}
            onChange={(listStyle) => onPatch({ listStyle })}
            onPreview={setPreview}
            options={[
              { value: 'none', title: 'None', icon: NONE, preview: sample({ listStyle: 'none' }, 'The quick list:\nBrown fox\nLazy dog') },
              {
                value: 'unordered',
                title: 'Bulleted list',
                icon: <ListIcon kind="unordered" />,
                preview: sample({ listStyle: 'unordered' }, 'The quick list:\nBrown fox\nLazy dog', { listIntro: true })
              },
              {
                value: 'ordered',
                title: 'Numbered list',
                icon: <ListIcon kind="ordered" />,
                preview: sample({ listStyle: 'ordered' }, 'The quick list:\nBrown fox\nLazy dog', { listIntro: true })
              }
            ]}
          />
        </Row>
        <Row label="Paragraph spacing">
          <NumField
            value={node.paragraphSpacing || 0}
            onCommit={(value) => onPatch({ paragraphSpacing: value ?? 0 })}
            onPreview={(value) =>
              setPreview(
                value == null
                  ? null
                  : sample({ paragraphSpacing: Math.min(24, value) }, 'The lazy dog does not jump.\nThe quick fox does.', {
                      outline: true
                    })
              )
            }
          />
        </Row>
        <Row label="Truncate text">
          <Seg
            value={node.textTruncation ? 'on' : 'off'}
            onChange={(value) =>
              onPatch({ textTruncation: value === 'on', maxLines: value === 'on' ? node.maxLines || 1 : undefined })
            }
            onPreview={setPreview}
            options={[
              { value: 'off', title: 'Off', icon: NONE, preview: sample({ textTruncation: false }, 'The lazy dog does not jump.', { outline: true }) },
              {
                value: 'on',
                title: 'Truncate with ellipsis',
                icon: <span className="ts-glyph">A…</span>,
                preview: sample({ textTruncation: true, maxLines: 1 }, 'The lazy dog does not jump.', { outline: true })
              }
            ]}
          />
        </Row>
        {node.textTruncation && (
          <Row label="Max lines">
            <NumField
              value={node.maxLines || 1}
              min={1}
              onCommit={(value) => onPatch({ maxLines: Math.max(1, Math.round(value ?? 1)) })}
              onPreview={(value) =>
                setPreview(
                  value == null ? null : sample({ textTruncation: true, maxLines: value }, WRAP_SAMPLE, { outline: true })
                )
              }
            />
          </Row>
        )}
        <Row label="Wrap style">
          <MiniSelect
            value={node.textWrapStyle || 'auto'}
            onChange={(textWrapStyle) => onPatch({ textWrapStyle })}
            onPreview={setPreview}
            options={[
              { value: 'auto', label: 'Auto', preview: sample({ textWrapStyle: 'auto' }, WRAP_SAMPLE) },
              { value: 'pretty', label: 'Pretty', preview: sample({ textWrapStyle: 'pretty' }, WRAP_SAMPLE) },
              { value: 'balance', label: 'Balance', preview: sample({ textWrapStyle: 'balance' }, WRAP_SAMPLE) }
            ]}
          />
        </Row>
      </div>
    </>
  )

  const decoKind = decorated ? decoration : 'underline'
  const decoSample = (patch: Patch) => sample({ textDecoration: decoKind, ...patch }, 'Quickly jumping foxes.')
  const decoVariants = (key: 'textDecorationThickness' | 'textUnderlineOffset', values: number[]): PreviewSpec => ({
    text: 'Ag',
    variants: values.map((value) => ({ textDecoration: decoKind, [key]: value }))
  })
  const autoColor = (() => {
    const paint = getNodePaints(node).find((item) => item.visible !== false)
    return paint?.type === 'solid' ? paint.color : node.fill || '#000000'
  })()
  const decoColor = node.textDecorationColor
  const decoOpacity = Math.round((node.textDecorationOpacity ?? 1) * 100)
  const openColor = (event: ReactMouseEvent<HTMLElement>) => {
    if (colorAnchor) {
      setColorAnchor(null)
      return
    }
    const popup = root.current?.getBoundingClientRect()
    const row = event.currentTarget.getBoundingClientRect()
    if (!popup) return
    setColorAnchor(new DOMRect(popup.left, Math.max(8, row.top - 160), popup.width, 0))
  }

  const decorationPage = (
    <div className="ts-group">
      <Row label="Decoration">
        <Seg
          value={decoration}
          onChange={(textDecoration) => onPatch({ textDecoration })}
          onPreview={setPreview}
          options={[
            { value: 'none', title: 'None', icon: NONE, preview: sample({ textDecoration: 'none' }, 'Quickly jumping foxes.') },
            {
              value: 'underline',
              title: 'Underline',
              icon: <span className="ts-glyph is-underline">U</span>,
              preview: sample({ textDecoration: 'underline' }, 'Quickly jumping foxes.')
            },
            {
              value: 'line-through',
              title: 'Strikethrough',
              icon: <span className="ts-glyph is-strike">S</span>,
              preview: sample({ textDecoration: 'line-through' }, 'Quickly jumping foxes.')
            }
          ]}
        />
      </Row>
      <Row label="Style">
        <Seg
          value={node.textDecorationStyle === 'dotted' || node.textDecorationStyle === 'wavy' ? node.textDecorationStyle : 'solid'}
          onChange={(value) => onPatch(withDecoration({ textDecorationStyle: value === 'solid' ? undefined : value }))}
          onPreview={setPreview}
          options={(['solid', 'dotted', 'wavy'] as const).map((value) => ({
            value,
            title: value[0].toUpperCase() + value.slice(1),
            icon: <DecoStyleIcon kind={value} />,
            preview: decoSample({ textDecorationStyle: value })
          }))}
        />
      </Row>
      <Row label="Thickness" onPreview={() => setPreview(decoVariants('textDecorationThickness', [4, 9, 16]))}>
        <NumField
          className="is-pct"
          value={node.textDecorationThickness}
          placeholder="Auto"
          suffix="%"
          min={1}
          max={100}
          onCommit={(value) => onPatch(withDecoration({ textDecorationThickness: value }))}
        />
        <input
          type="range"
          className="ts-range"
          min={1}
          max={30}
          step={0.5}
          value={node.textDecorationThickness ?? 7}
          onChange={(event) => onPatch(withDecoration({ textDecorationThickness: Number(event.target.value) }))}
        />
      </Row>
      {decoration !== 'line-through' && (
        <>
          <Row label="Offset" onPreview={() => setPreview(decoVariants('textUnderlineOffset', [0, 12, 26]))}>
            <NumField
              className="is-pct"
              value={node.textUnderlineOffset}
              placeholder="Auto"
              suffix="%"
              min={-100}
              max={100}
              onCommit={(value) => onPatch(withDecoration({ textUnderlineOffset: value }))}
            />
            <input
              type="range"
              className="ts-range"
              min={-30}
              max={60}
              step={0.5}
              value={node.textUnderlineOffset ?? 10}
              onChange={(event) => onPatch(withDecoration({ textUnderlineOffset: Number(event.target.value) }))}
            />
          </Row>
          <Row label="Skip ink">
            <Seg
              value={node.textDecorationSkipInk === false ? 'off' : 'on'}
              onChange={(value) => onPatch(withDecoration({ textDecorationSkipInk: value === 'on' ? undefined : false }))}
              onPreview={setPreview}
              options={[
                {
                  value: 'on',
                  title: 'Skip ink',
                  icon: <span className="ts-glyph is-underline">Ag</span>,
                  preview: decoSample({ textDecorationSkipInk: true })
                },
                {
                  value: 'off',
                  title: "Don't skip ink",
                  icon: (
                    <span className="ts-glyph is-underline" style={{ textDecorationSkipInk: 'none' }}>
                      Ag
                    </span>
                  ),
                  preview: decoSample({ textDecorationSkipInk: false })
                }
              ]}
            />
          </Row>
        </>
      )}
      <Row label="Color">
        <div className={`ts-color${colorAnchor ? ' is-open' : ''}`}>
          <button
            type="button"
            className="ts-color-main"
            title="Decoration color"
            onMouseDown={(event) => {
              if (colorAnchor) event.nativeEvent.stopPropagation()
            }}
            onClick={openColor}
          >
            <span
              className="ts-color-swatch"
              style={{ background: decoColor ? decorationColor(node) : autoColor }}
            />
            <span className={decoColor ? 'ts-color-hex' : 'ts-color-auto'}>
              {decoColor ? decoColor.replace('#', '').toUpperCase() : 'Auto'}
            </span>
          </button>
          {decoColor && (
            <NumField
              className="ts-color-opacity"
              value={decoOpacity}
              suffix=" %"
              min={0}
              max={100}
              onCommit={(value) => onPatch({ textDecorationOpacity: value == null ? undefined : value / 100 })}
            />
          )}
        </div>
        {decoColor && (
          <button
            type="button"
            className="ts-more"
            title="Reset to auto"
            onClick={() => {
              setColorAnchor(null)
              onPatch({ textDecorationColor: undefined, textDecorationOpacity: undefined })
            }}
          >
            <span className="ts-dash" aria-hidden />
          </button>
        )}
      </Row>
    </div>
  )

  const details = (
    <>
      <div className="ts-group">
        <Row label="Paragraph indent">
          <NumField
            value={node.paragraphIndent || 0}
            onCommit={(value) => onPatch({ paragraphIndent: value ?? 0 })}
            onPreview={(value) =>
              setPreview(
                value == null ? null : sample({ paragraphIndent: Math.min(40, value) }, 'The quick brown fox jumped over a lazy dog.')
              )
            }
          />
        </Row>
      </div>
      <div className="ts-group">
        <div className="ts-group-title">Numbers</div>
        <Row label="Style">
          <MiniSelect
            value={node.numberStyle || 'default'}
            onChange={(numberStyle) => onPatch({ numberStyle })}
            onPreview={setPreview}
            options={[
              { value: 'default', label: 'Default', preview: sample({ numberStyle: 'default' }, '0123456789') },
              { value: 'lining', label: 'Lining', preview: sample({ numberStyle: 'lining' }, '0123456789') },
              { value: 'oldstyle', label: 'Old style', preview: sample({ numberStyle: 'oldstyle' }, '0123456789') }
            ]}
          />
        </Row>
        <Row label="Spacing">
          <MiniSelect
            value={node.numberSpacing || 'default'}
            onChange={(numberSpacing) => onPatch({ numberSpacing })}
            onPreview={setPreview}
            options={[
              { value: 'default', label: 'Default', preview: sample({ numberSpacing: 'default' }, '111.11\n888.88') },
              { value: 'proportional', label: 'Proportional', preview: sample({ numberSpacing: 'proportional' }, '111.11\n888.88') },
              { value: 'tabular', label: 'Tabular', preview: sample({ numberSpacing: 'tabular' }, '111.11\n888.88') }
            ]}
          />
        </Row>
        <Row label="Fractions">
          <Seg
            value={node.fractions ? 'on' : 'off'}
            onChange={(value) => onPatch({ fractions: value === 'on' || undefined })}
            onPreview={setPreview}
            options={[
              { value: 'off', title: 'Off', icon: NONE, preview: sample({ fractions: false }, '1/2 3/4 5/8') },
              { value: 'on', title: 'Diagonal fractions', icon: <span className="ts-glyph">½</span>, preview: sample({ fractions: true }, '1/2 3/4 5/8') }
            ]}
          />
        </Row>
        <Row label="Slashed zero">
          <Seg
            value={node.slashedZero ? 'on' : 'off'}
            onChange={(value) => onPatch({ slashedZero: value === 'on' || undefined })}
            onPreview={setPreview}
            options={[
              { value: 'off', title: 'Off', icon: NONE, preview: sample({ slashedZero: false }, '0 100 2000') },
              {
                value: 'on',
                title: 'Slashed zero',
                icon: <span className="ts-glyph is-slashed-zero">0</span>,
                preview: sample({ slashedZero: true }, '0 100 2000')
              }
            ]}
          />
        </Row>
      </div>
      <div className="ts-group">
        <Row label="Ligatures">
          <Seg
            value={node.ligatures === false ? 'off' : 'on'}
            onChange={(value) => onPatch({ ligatures: value === 'on' ? undefined : false })}
            onPreview={setPreview}
            options={[
              { value: 'off', title: 'Off', icon: NONE, preview: sample({ ligatures: false }, 'The office affords fine flights.') },
              { value: 'on', title: 'Common ligatures', icon: <span className="ts-glyph">fi</span>, preview: sample({ ligatures: true }, 'The office affords fine flights.') }
            ]}
          />
        </Row>
      </div>
    </>
  )

  const variable = (
    <div className="ts-group">
      {variableWeight ? (
        <Row label="Weight" onPreview={() => setPreview(sample({}, SAMPLE))}>
          <input
            type="range"
            className="ts-range"
            min={weightMin}
            max={weightMax}
            step={1}
            value={Math.min(weightMax, Math.max(weightMin, weight))}
            onChange={(event) => onPatch({ fontWeight: Number(event.target.value) })}
          />
          <NumField
            value={weight}
            min={weightMin}
            onCommit={(value) => onPatch({ fontWeight: Math.min(weightMax, Math.max(weightMin, Math.round(value ?? 400))) })}
          />
        </Row>
      ) : (
        <div className="ts-empty">{family} doesn&apos;t have variable axes.</div>
      )}
    </div>
  )

  return (
    <div
      ref={root}
      className="fill-picker type-settings"
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerLeave={() => setPreview(null)}
    >
      <div className="fill-picker-head">
        {tab === 'decoration' ? (
          <div className="ts-crumbs">
            <button type="button" className="fill-picker-icon-btn" title="Back" onClick={() => setTab('basics')}>
              <BackIcon />
            </button>
            <button type="button" className="ts-crumb" onClick={() => setTab('basics')}>
              Basics
            </button>
            <span className="ts-crumb-sep">/</span>
            <span className="ts-crumb-current">{decoration === 'line-through' ? 'Strikethrough' : 'Underline'}</span>
          </div>
        ) : (
          <div className="fill-picker-tabs">
            <button type="button" className={tab === 'basics' ? 'is-on' : ''} onClick={() => setTab('basics')}>
              Basics
            </button>
            <button type="button" className={tab === 'details' ? 'is-on' : ''} onClick={() => setTab('details')}>
              Details
            </button>
            <button type="button" className={tab === 'variable' ? 'is-on' : ''} onClick={() => setTab('variable')}>
              Variable
            </button>
          </div>
        )}
        <button type="button" className="fill-picker-icon-btn" title="Close" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="ts-preview">
        {preview ? (
          <PreviewText node={node} spec={preview} />
        ) : tab === 'decoration' ? (
          <PreviewText node={node} spec={decoSample({})} />
        ) : (
          <span className="ts-preview-empty">Preview</span>
        )}
      </div>
      {tab === 'basics' ? basics : tab === 'details' ? details : tab === 'decoration' ? decorationPage : variable}
      {colorAnchor &&
        createPortal(
          <div className="ts-color-host">
            <FillPicker
              paint={defaultSolid(decoColor || autoColor, decoColor ? (node.textDecorationOpacity ?? 1) : 1)}
              solidOnly
              beside
              anchor={colorAnchor}
              onChange={(next) => {
                if (next.type !== 'solid') return
                onPatch(
                  withDecoration({
                    textDecorationColor: next.color.startsWith('#') ? next.color.toUpperCase() : `#${next.color.toUpperCase()}`,
                    textDecorationOpacity: next.opacity >= 1 ? undefined : next.opacity
                  })
                )
              }}
              onClose={() => setColorAnchor(null)}
            />
          </div>,
          document.body
        )}
    </div>
  )
}
