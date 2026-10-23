import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AddIcon, CloseIcon, SearchIcon } from './lucideIcons'
import { defaultShader, SHADER_OPTIONS, type ShaderKind, type ShaderPaint } from '../shared/paint'
import { besidePopoverMotion, popoverSpring } from './popoverMotion'
import { ShaderThumb } from './ShaderThumb'

type ShaderTile = {
  id: string
  kind: ShaderKind
  label: string
  paint: ShaderPaint
}

type Section = {
  id: string
  title: string
  items: ShaderTile[]
}

const CREATED_STORAGE_KEY = 'vanta-shader-created'
/** Width of the `beside` popup; keep in sync with `.shader-fills-popup.is-beside`. */
const POPUP_WIDTH = 240

let documentShaderKinds: ShaderKind[] = []

/** Shaders used in the open document, for popups opened outside the toolbar. */
export function setDocumentShaderKinds(kinds: ShaderKind[]) {
  documentShaderKinds = kinds
}

function loadCreated(): ShaderKind[] {
  try {
    const raw = localStorage.getItem(CREATED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is ShaderKind => SHADER_OPTIONS.some((opt) => opt.id === id))
  } catch {
    return []
  }
}

function rememberCreated(kind: ShaderKind) {
  const next = [kind, ...loadCreated().filter((id) => id !== kind)].slice(0, 8)
  try {
    localStorage.setItem(CREATED_STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return next
}

function tileFor(kind: ShaderKind, label?: string): ShaderTile {
  const meta = SHADER_OPTIONS.find((opt) => opt.id === kind)
  return {
    id: kind,
    kind,
    label: label || meta?.label || kind,
    paint: defaultShader(kind)
  }
}

export function ShaderFillsPopup({
  open,
  selectedKind,
  inFileKinds: inFileProp,
  placement = 'toolbar',
  anchor: anchorProp,
  ignoreRef,
  onClose,
  onSelect
}: {
  open: boolean
  selectedKind: ShaderKind | null
  inFileKinds?: ShaderKind[]
  /** `beside` portals the popup to the left of `anchor` instead of above the toolbar. */
  placement?: 'toolbar' | 'beside'
  anchor?: DOMRect | null
  ignoreRef?: RefObject<HTMLElement | null>
  onClose: () => void
  onSelect: (kind: ShaderKind) => void
}) {
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [created, setCreated] = useState<ShaderKind[]>(() => loadCreated())
  const popupRef = useRef<HTMLDivElement>(null)
  const lastAnchor = useRef<DOMRect | null>(null)
  if (anchorProp) lastAnchor.current = anchorProp
  const anchor = anchorProp ?? lastAnchor.current
  const [top, setTop] = useState<number | null>(null)
  const beside = placement === 'beside'
  const inFileKinds = inFileProp ?? documentShaderKinds

  useEffect(() => {
    if (!open || !beside) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popupRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, beside, ignoreRef, onClose])

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const height = popupRef.current?.offsetHeight || 460
    setTop(Math.max(8, Math.min(window.innerHeight - height - 8, anchor.top)))
  }, [open, anchor])

  const sections = useMemo((): Section[] => {
    const q = query.trim().toLowerCase()
    const match = (label: string) => !q || label.toLowerCase().includes(q)
    const createdItems = created.map((kind) => tileFor(kind)).filter((item) => match(item.label))
    const fileItems = inFileKinds.map((kind) => tileFor(kind)).filter((item) => match(item.label))
    const paperItems = SHADER_OPTIONS.map((opt) => tileFor(opt.id, opt.label)).filter((item) => match(item.label))
    return [
      { id: 'created', title: 'Created by you', items: createdItems },
      { id: 'file', title: 'In this file', items: fileItems },
      { id: 'paper', title: 'By Paper', items: paperItems }
    ].filter((section) => section.items.length > 0 || section.id === 'paper')
  }, [created, inFileKinds, query])

  const spring = popoverSpring(reduceMotion)

  const motionProps = beside
    ? {
        ...besidePopoverMotion(reduceMotion),
        style: {
          left: Math.max(8, (anchor?.left ?? 0) - POPUP_WIDTH - 8),
          top: top ?? anchor?.top ?? 8,
          transformOrigin: 'right top'
        }
      }
    : {
        initial: reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 16, scale: 0.94, x: '-50%' },
        animate: { opacity: 1, y: 0, scale: 1, x: '-50%' },
        exit: reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 10, scale: 0.96, x: '-50%' },
        style: { transformOrigin: 'bottom center' }
      }

  const popup = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={popupRef}
          className={beside ? 'shader-fills-popup is-beside' : 'shader-fills-popup'}
          data-chrome-overlay=""
          role="dialog"
          aria-label="Shader fills"
          {...motionProps}
          transition={spring}
          onPointerDown={beside ? (event) => event.stopPropagation() : undefined}
        >
          <header className="shader-fills-head">
            <div className="shader-fills-title">
              <strong>Shader fills</strong>
              <span className="shader-fills-beta">Beta</span>
            </div>
            <div className="shader-fills-actions">
              <button type="button" title="New shader" aria-label="New shader">
                <AddIcon sx={{ fontSize: 18 }} />
              </button>
              <button type="button" title="Close" aria-label="Close" onClick={onClose}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
          </header>

          <label className="shader-fills-search">
            <SearchIcon sx={{ fontSize: 16 }} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              autoFocus
            />
          </label>

          <div className="shader-fills-body">
            {sections.map((section) => (
              <section key={section.id} className="shader-fills-section">
                <h3>{section.title}</h3>
                {section.items.length === 0 ? (
                  <p className="shader-fills-empty">No shaders yet</p>
                ) : (
                  <div className="shader-fills-grid">
                    {section.items.map((item) => {
                      const active = selectedKind === item.kind
                      return (
                        <button
                          key={`${section.id}-${item.id}`}
                          type="button"
                          className={active ? 'shader-fills-tile is-on' : 'shader-fills-tile'}
                          onClick={() => {
                            setCreated(rememberCreated(item.kind))
                            onSelect(item.kind)
                          }}
                        >
                          <span className="shader-fills-thumb">
                            <ShaderThumb paint={item.paint} />
                          </span>
                          <span className="shader-fills-label">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
  return beside ? createPortal(popup, document.body) : popup
}
