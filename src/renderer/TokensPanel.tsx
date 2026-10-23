import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AddIcon, KeyboardArrowDownIcon, SearchIcon } from './lucideIcons'
import { ColorTokenPopup, type ColorToken } from './ColorTokenPopup'
import { parseHex } from './colorMath'

type TokenKind =
  | 'color'
  | 'opacity'
  | 'radius'
  | 'spacing'
  | 'container'
  | 'breakpoint'
  | 'font-family'
  | 'font-weight'
  | 'font-size'
  | 'line-height'
  | 'letter-spacing'

type TokenItem = {
  id: string
  name: string
  kind: TokenKind
  value?: string
  hex?: string
  opacity?: number
  aliasId?: string | null
}

type TokenGroup = {
  id: string
  label: string
  kind: TokenKind
  tokens: TokenItem[]
}

const INITIAL_GROUPS: TokenGroup[] = [
  {
    id: 'spacing',
    label: 'Spacing',
    kind: 'spacing',
    tokens: [
      { id: 'layout-sidebar', name: 'layout-sidebar', kind: 'spacing', value: '248' },
      { id: 'layout-margin', name: 'layout-margin', kind: 'spacing', value: '40' },
      { id: 'layout-margin-top', name: 'layout-margin-top', kind: 'spacing', value: '28' },
      { id: 'layout-margin-bottom', name: 'layout-margin-bottom', kind: 'spacing', value: '40' },
      { id: 'layout-gutter', name: 'layout-gutter', kind: 'spacing', value: '24' },
      { id: 'layout-column-min', name: 'layout-column-min', kind: 'spacing', value: '260' },
      { id: 'layout-content-left', name: 'layout-content-left', kind: 'spacing', value: '288' }
    ]
  },
  {
    id: 'container',
    label: 'Container',
    kind: 'container',
    tokens: [
      { id: 'layout-artboard', name: 'layout-artboard', kind: 'container', value: '1440' },
      { id: 'layout-content', name: 'layout-content', kind: 'container', value: '1112' }
    ]
  }
]

const ADD_SECTIONS: Array<{ items: Array<{ id: TokenKind; label: string }> }> = [
  {
    items: [
      { id: 'color', label: 'Color' },
      { id: 'opacity', label: 'Opacity' },
      { id: 'radius', label: 'Radius' }
    ]
  },
  {
    items: [
      { id: 'spacing', label: 'Spacing' },
      { id: 'container', label: 'Container' },
      { id: 'breakpoint', label: 'Breakpoint' }
    ]
  },
  {
    items: [
      { id: 'font-family', label: 'Font family' },
      { id: 'font-weight', label: 'Font weight' },
      { id: 'font-size', label: 'Font size' },
      { id: 'line-height', label: 'Line height' },
      { id: 'letter-spacing', label: 'Letter spacing' }
    ]
  }
]

const GROUP_LABEL: Record<TokenKind, string> = {
  color: 'Color',
  opacity: 'Opacity',
  radius: 'Radius',
  spacing: 'Spacing',
  container: 'Container',
  breakpoint: 'Breakpoint',
  'font-family': 'Font family',
  'font-weight': 'Font weight',
  'font-size': 'Font size',
  'line-height': 'Line height',
  'letter-spacing': 'Letter spacing'
}

function TokenIcon({ kind }: { kind: TokenKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none' as const,
    'aria-hidden': true as const
  }
  switch (kind) {
    case 'color':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      )
    case 'opacity':
      return (
        <svg {...common}>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.25" />
          <path d="M2.5 8h11M8 2.5v11" stroke="currentColor" strokeWidth="1.1" opacity="0.35" />
          <path d="M2.5 5.5h11M2.5 10.5h11M5.5 2.5v11M10.5 2.5v11" stroke="currentColor" strokeWidth="0.9" opacity="0.22" />
        </svg>
      )
    case 'radius':
      return (
        <svg {...common}>
          <path d="M4.5 2.5H3.5A1 1 0 0 0 2.5 3.5V4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <path d="M11.5 2.5h1A1 1 0 0 1 13.5 3.5V4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <path d="M4.5 13.5H3.5A1 1 0 0 1 2.5 12.5V11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <path d="M11.5 13.5h1a1 1 0 0 0 1-1V11.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    case 'spacing':
      return (
        <svg {...common}>
          <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M5.5 10.5 10.5 5.5M10.5 5.5H7.25M10.5 5.5V8.75"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'container':
      return (
        <svg {...common}>
          <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 5.5v5M10 5.5v5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    case 'breakpoint':
      return (
        <svg {...common}>
          <rect x="1.75" y="3" width="12.5" height="8.5" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="M6 13.5h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    case 'font-family':
      return (
        <svg {...common}>
          <path d="M5.2 12.5 8 3.5l2.8 9M6.1 9.6h3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'font-weight':
      return (
        <svg {...common}>
          <path d="M6.2 12.5 8 4.5l1.8 8M6.7 9.4h2.6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2.5 8H4.2M11.8 8h1.7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          <path d="M3.4 6.6 2.2 8l1.2 1.4M12.6 6.6 13.8 8l-1.2 1.4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'font-size':
      return (
        <svg {...common}>
          <path d="M5.8 12.5 8 4.5l2.2 8M6.4 9.5h3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 2.4v1.6M8 12v1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6.7 3.2 8 2.2l1.3 1M6.7 12.8 8 13.8l1.3-1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'line-height':
      return (
        <svg {...common}>
          <path d="M5.8 11.2 8 5.2l2.2 6M6.4 9h3.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.5 3.2h9M3.5 12.8h9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    case 'letter-spacing':
      return (
        <svg {...common}>
          <path d="M6 12.2 8 4.8l2 7.4M6.55 9.5h2.9" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.2 3.8v8.4M12.8 3.8v8.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
      )
    default:
      return null
  }
}

function slugFor(kind: TokenKind, index: number) {
  if (kind === 'color') return index <= 1 ? 'Untitled' : `Untitled ${index}`
  return `${kind}-${String(index).padStart(2, '0')}`
}

function defaultValue(kind: TokenKind): string | undefined {
  switch (kind) {
    case 'opacity':
      return '100%'
    case 'radius':
      return '8'
    case 'spacing':
      return '16'
    case 'container':
      return '1280'
    case 'breakpoint':
      return '768'
    case 'font-family':
      return 'Inter'
    case 'font-weight':
      return '500'
    case 'font-size':
      return '16'
    case 'line-height':
      return '1.4'
    case 'letter-spacing':
      return '0'
    default:
      return undefined
  }
}

function asColorToken(token: TokenItem): ColorToken {
  return {
    id: token.id,
    name: token.name,
    hex: parseHex(token.hex || '#DDDDDD'),
    opacity: token.opacity ?? 100,
    aliasId: token.aliasId ?? null
  }
}

function resolveColorHex(token: TokenItem, colors: TokenItem[]): string {
  if (token.aliasId) {
    const alias = colors.find((item) => item.id === token.aliasId)
    if (alias?.hex) return parseHex(alias.hex)
  }
  return parseHex(token.hex || '#DDDDDD')
}

type AddMenuState = { x: number; y: number }
type ColorEditorState = { tokenId: string; x: number; y: number; focusName?: boolean }

function TokenAddMenu({
  menu,
  onClose,
  onPick
}: {
  menu: AddMenuState | null
  onClose: () => void
  onPick: (kind: TokenKind) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
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
  }, [menu, onClose])

  useEffect(() => {
    const el = root.current
    if (!el || !menu) return
    const pad = 8
    const rect = el.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad)
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [menu])

  const transition = reduceMotion
    ? { duration: 0.08 }
    : { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <AnimatePresence>
      {menu ? (
        <motion.div
          key={`${menu.x}-${menu.y}`}
          ref={root}
          className="layer-menu token-add-menu"
          data-chrome-overlay=""
          role="menu"
          aria-label="Add token"
          style={{ left: menu.x, top: menu.y }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.99 }}
          transition={transition}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {ADD_SECTIONS.map((section, index) => (
            <div key={index} className="layer-menu-section">
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="layer-menu-item token-add-item"
                  role="menuitem"
                  onClick={() => {
                    onPick(item.id)
                    onClose()
                  }}
                >
                  <span className="token-add-item-lead">
                    <TokenIcon kind={item.id} />
                    <span>{item.label}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function TokensPanel() {
  const [groups, setGroups] = useState(INITIAL_GROUPS)
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INITIAL_GROUPS.map((group) => [group.id, true]))
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null)
  const [colorEditor, setColorEditor] = useState<ColorEditorState | null>(null)
  const addBtnRef = useRef<HTMLButtonElement>(null)

  const tokenCount = groups.reduce((sum, group) => sum + group.tokens.length, 0)
  const colorTokens = groups.find((group) => group.kind === 'color')?.tokens || []
  const editingToken = colorEditor
    ? colorTokens.find((token) => token.id === colorEditor.tokenId) || null
    : null

  const updateToken = (id: string, patch: Partial<TokenItem>) => {
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        tokens: group.tokens.map((token) => (token.id === id ? { ...token, ...patch } : token))
      }))
    )
  }

  const openColorEditor = (token: TokenItem, anchor: DOMRect, focusName = false) => {
    setSelectedId(token.id)
    setColorEditor({
      tokenId: token.id,
      x: Math.min(window.innerWidth - 320, Math.max(12, anchor.right + 14)),
      y: Math.min(window.innerHeight - 360, Math.max(12, anchor.top - 8)),
      focusName
    })
  }

  const addToken = (kind: TokenKind) => {
    const id = `${kind}-${Date.now()}`
    setGroups((current) => {
      const existing = current.find((group) => group.kind === kind)
      const nextIndex = (existing?.tokens.length || 0) + 1
      const token: TokenItem =
        kind === 'color'
          ? {
              id,
              name: slugFor('color', nextIndex),
              kind: 'color',
              hex: '#DDDDDD',
              opacity: 100
            }
          : {
              id,
              name: slugFor(kind, nextIndex),
              kind,
              value: defaultValue(kind)
            }
      if (existing) {
        return current.map((group) =>
          group.id === existing.id ? { ...group, tokens: [...group.tokens, token] } : group
        )
      }
      const nextGroup: TokenGroup = {
        id: kind,
        label: GROUP_LABEL[kind],
        kind,
        tokens: [token]
      }
      if (kind === 'color') return [nextGroup, ...current]
      return [...current, nextGroup]
    })
    setOpen((current) => ({ ...current, [kind]: true }))
    setSelectedId(id)
    if (kind === 'color') {
      requestAnimationFrame(() => {
        setColorEditor({
          tokenId: id,
          x: Math.min(window.innerWidth - 320, 360),
          y: 120,
          focusName: true
        })
      })
    }
  }

  const duplicateColor = (token: TokenItem) => {
    const id = `color-${Date.now()}`
    const copy: TokenItem = {
      ...token,
      id,
      name: `${token.name} copy`,
      aliasId: null
    }
    setGroups((current) =>
      current.map((group) =>
        group.kind === 'color' ? { ...group, tokens: [...group.tokens, copy] } : group
      )
    )
    setSelectedId(id)
    setColorEditor((current) => (current ? { ...current, tokenId: id, focusName: true } : current))
  }

  const deleteColor = (id: string) => {
    setGroups((current) =>
      current
        .map((group) =>
          group.kind === 'color'
            ? {
                ...group,
                tokens: group.tokens
                  .filter((token) => token.id !== id)
                  .map((token) => (token.aliasId === id ? { ...token, aliasId: null } : token))
              }
            : group
        )
        .filter((group) => group.kind !== 'color' || group.tokens.length > 0)
    )
    setColorEditor(null)
    setSelectedId((current) => (current === id ? null : current))
  }

  return (
    <div className="tokens-panel">
      <div className="tree-head">
        <span>{tokenCount} tokens</span>
        <span className="tree-head-actions">
          <button type="button" className="tree-search-icon" title="Search" aria-label="Search" disabled>
            <SearchIcon sx={{ fontSize: 16 }} />
          </button>
          <button
            ref={addBtnRef}
            type="button"
            title="New token"
            aria-label="New token"
            aria-expanded={Boolean(addMenu)}
            aria-haspopup="menu"
            onClick={(event) => {
              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setAddMenu({ x: rect.right - 188, y: rect.bottom + 6 })
            }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </button>
        </span>
      </div>

      <div className="tree-list tokens-tree">
        {groups.map((group) => {
          const expanded = open[group.id] !== false
          return (
            <div key={group.id} className="token-group">
              <button
                type="button"
                className={`token-group-head${expanded ? ' is-open' : ''}`}
                onClick={() => setOpen((current) => ({ ...current, [group.id]: !expanded }))}
              >
                <KeyboardArrowDownIcon className="token-group-caret" sx={{ fontSize: 16 }} />
                <span className="token-group-label">{group.label}</span>
              </button>
              {expanded
                ? group.tokens.map((token) => {
                    const alias =
                      token.kind === 'color' && token.aliasId
                        ? colorTokens.find((item) => item.id === token.aliasId)
                        : null
                    return (
                      <button
                        key={token.id}
                        type="button"
                        className={`token-row${token.kind === 'color' ? ' is-color' : ''}${
                          selectedId === token.id ? ' is-active' : ''
                        }`}
                        onClick={(event) => {
                          setSelectedId(token.id)
                          if (token.kind === 'color') {
                            openColorEditor(token, event.currentTarget.getBoundingClientRect())
                          } else {
                            setColorEditor(null)
                          }
                        }}
                      >
                        {token.kind === 'color' ? (
                          <span
                            className="token-row-swatch"
                            style={{ background: resolveColorHex(token, colorTokens) }}
                          />
                        ) : (
                          <span className="token-row-icon">
                            <TokenIcon kind={token.kind} />
                          </span>
                        )}
                        <span className="token-row-name">{token.name}</span>
                        {alias ? (
                          <span className="token-row-alias">{alias.name}</span>
                        ) : token.value ? (
                          <span className="token-row-value">{token.value}</span>
                        ) : null}
                      </button>
                    )
                  })
                : null}
            </div>
          )
        })}
      </div>

      <TokenAddMenu menu={addMenu} onClose={() => setAddMenu(null)} onPick={addToken} />

      <AnimatePresence>
        {colorEditor && editingToken ? (
          <ColorTokenPopup
            key={editingToken.id}
            token={asColorToken(editingToken)}
            colors={colorTokens.map(asColorToken)}
            x={colorEditor.x}
            y={colorEditor.y}
            autoFocusName={Boolean(colorEditor.focusName)}
            onClose={() => setColorEditor(null)}
            onChange={(next) =>
              updateToken(next.id, {
                name: next.name,
                hex: next.hex,
                opacity: next.opacity,
                aliasId: next.aliasId ?? null
              })
            }
            onDuplicate={() => duplicateColor(editingToken)}
            onDelete={() => deleteColor(editingToken.id)}
            onCreateColor={() => addToken('color')}
          />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

export type { TokenKind }
