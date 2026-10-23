import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AddIcon, AutoFixHighOutlinedIcon, DriveFileRenameOutlineOutlinedIcon, ImageOutlinedIcon, LanguageIcon, SearchIcon } from './lucideIcons'

export type ChatSuggestionId = 'make-image' | 'rename-layers' | 'open-tab'

export type ChatSuggestion = {
  id: ChatSuggestionId
  label: string
  prompt: string
  kind: 'favicon' | 'icon'
  favicon?: string
  Icon?: ComponentType<{ sx?: { fontSize?: number } }>
}

export const CHAT_SUGGESTIONS: ChatSuggestion[] = [
  {
    id: 'make-image',
    label: 'Make an image',
    prompt: 'Make an image',
    kind: 'favicon',
    favicon: '🍌'
  },
  {
    id: 'rename-layers',
    label: 'Rename layers',
    prompt: 'Rename layers',
    kind: 'icon',
    Icon: DriveFileRenameOutlineOutlinedIcon
  },
  {
    id: 'open-tab',
    label: 'Open tab',
    prompt: 'Open a new browser tab',
    kind: 'icon',
    Icon: LanguageIcon
  }
]

type ActionItem = {
  id: string
  label: string
  prompt: string
  glyph: ReactNode
  ai?: boolean
}

function RenameLayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <rect x="5.5" y="6.5" width="9" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.3" fill="var(--panel, #fff)" />
      <path d="M12.2 3.2V14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10.6 3.2h3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function MakeImageIcon() {
  return (
    <span className="chat-action-glyph has-plus">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="2.75" y="3.75" width="12.5" height="10.5" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="6.6" cy="7.1" r="1.15" fill="currentColor" />
        <path
          d="M3.6 12.4l3.2-3.1 2.2 2.1 2.5-2.6 2.9 3.6"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="chat-action-plus" aria-hidden="true">
        <AddIcon sx={{ fontSize: 9 }} />
      </span>
    </span>
  )
}

function EditImageIcon() {
  return (
    <span className="chat-action-glyph">
      <AutoFixHighOutlinedIcon sx={{ fontSize: 18 }} />
    </span>
  )
}

const ACTION_ITEMS: ActionItem[] = [
  {
    id: 'rename-layers',
    label: 'Rename layers',
    prompt: 'Rename layers',
    glyph: (
      <span className="chat-action-glyph">
        <RenameLayersIcon />
      </span>
    ),
    ai: true
  },
  {
    id: 'make-image',
    label: 'Make an image',
    prompt: 'Make an image',
    glyph: <MakeImageIcon />
  },
  {
    id: 'edit-image',
    label: 'Edit image with prompt',
    prompt: 'Edit image with prompt',
    glyph: <EditImageIcon />
  }
]

function ActionGlyph({
  item
}: {
  item: Pick<ChatSuggestion, 'kind' | 'favicon' | 'Icon'>
}) {
  return (
    <span className="chat-action-glyph">
      {item.kind === 'favicon' ? (
        <span className="chat-action-favicon" aria-hidden="true">
          {item.favicon || '🍌'}
        </span>
      ) : item.Icon ? (
        <item.Icon sx={{ fontSize: 16 }} />
      ) : (
        <ImageOutlinedIcon sx={{ fontSize: 16 }} />
      )}
    </span>
  )
}

export function ChatSuggestionPopup({
  open,
  onClose,
  onSelect
}: {
  open: boolean
  onClose: () => void
  onSelect: (prompt: string) => void
}) {
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setQuery('')
  }, [open])

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ACTION_ITEMS.filter((item) => !q || item.label.toLowerCase().includes(q))
  }, [query])

  const spring = reduceMotion
    ? { duration: 0.12 }
    : { type: 'spring' as const, stiffness: 460, damping: 30, mass: 0.72 }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="chat-suggestion-popup"
          data-chrome-overlay=""
          role="dialog"
          aria-label="Suggestions"
          initial={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 16, scale: 0.94, x: '-50%' }}
          animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
          exit={reduceMotion ? { opacity: 0, x: '-50%' } : { opacity: 0, y: 10, scale: 0.96, x: '-50%' }}
          transition={spring}
          style={{ transformOrigin: 'bottom center' }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="chat-suggestion-popup-inner">
            <label className="chat-suggestion-search">
              <SearchIcon sx={{ fontSize: 18 }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                autoFocus
              />
              <span className="chat-suggestion-search-image" aria-hidden="true">
                <ImageOutlinedIcon sx={{ fontSize: 18 }} />
              </span>
            </label>

            <div className="chat-suggestion-list">
              {items.length === 0 ? (
                <p className="chat-suggestion-empty">No results</p>
              ) : (
                items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`chat-suggestion-row${index === 0 && !query ? ' is-on' : ''}`}
                    onClick={() => {
                      onSelect(item.prompt)
                      onClose()
                    }}
                  >
                    {item.glyph}
                    <span className="chat-suggestion-row-label">{item.label}</span>
                    {item.ai ? <span className="chat-suggestion-ai">AI</span> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ChatSuggestionGlyph({ item }: { item: ChatSuggestion }) {
  return <ActionGlyph item={item} />
}
