import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AlternateEmailIcon, ArrowUpwardIcon, CheckIcon, CloseIcon, ImageOutlinedIcon, MoreHorizIcon, SearchIcon, SentimentSatisfiedAltIcon } from './lucideIcons'
import type { Camera, DesignNode } from '../shared/types'
import {
  COMMENT_PEOPLE,
  CURRENT_USER,
  formatCommentTime,
  getCommentPerson,
  mentionToken,
  renderCommentText,
  type CommentPerson
} from '../shared/comments'
import { worldToScreen } from './canvasMath'
import { EMOJI_CATEGORIES, searchEmojis } from './emojiData'

export function CommentCursor({ x, y, visible }: { x: number; y: number; visible: boolean }) {
  if (!visible) return null
  return (
    <div className="comment-cursor" style={{ left: x, top: y }} aria-hidden>
      <CommentBubbleMark ghost />
    </div>
  )
}

export function CommentBubbleMark({
  ghost,
  initial,
  color,
  resolved
}: {
  ghost?: boolean
  initial?: string
  color?: string
  resolved?: boolean
}) {
  if (initial) {
    return (
      <span className={`comment-pin-avatar${resolved ? ' is-resolved' : ''}`} style={{ background: color || '#5B5FC7' }}>
        {initial}
      </span>
    )
  }
  return (
    <span className={`comment-pin-bubble${ghost ? ' is-ghost' : ''}${resolved ? ' is-resolved' : ''}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <path
          d="M4 6.5C4 4.567 5.567 3 7.5 3h13C22.433 3 24 4.567 24 6.5v9c0 1.933-1.567 3.5-3.5 3.5H12.2L7.1 24.2a.8.8 0 0 1-1.35-.58V19H7.5C5.567 19 4 17.433 4 15.5v-9Z"
          fill={ghost ? 'rgba(255,255,255,0.92)' : '#0D99FF'}
          stroke={ghost ? 'rgba(13,153,255,0.55)' : '#0B6FBF'}
          strokeWidth="1.2"
        />
      </svg>
    </span>
  )
}

export function CommentRichText({ text }: { text: string }) {
  return (
    <span className="comment-rich-text">
      {renderCommentText(text).map((part, index) =>
        part.type === 'mention' ? (
          <span key={index} className="comment-mention">
            @{part.value}
          </span>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </span>
  )
}

function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(EMOJI_CATEGORIES[1].id)
  const searching = query.trim().length > 0
  const filtered = useMemo(() => {
    if (searching) {
      const emojis = searchEmojis(query)
      return [{ id: 'search', label: emojis.length ? 'Search results' : 'No results', icon: '🔎', emojis }]
    }
    return EMOJI_CATEGORIES.filter((item) => item.id === 'recent' || item.id === category)
  }, [query, category, searching])

  return (
    <div
      className="comment-emoji-picker"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="comment-emoji-cats">
        {EMOJI_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={category === item.id && !searching ? 'is-on' : ''}
            title={item.label}
            onClick={() => {
              setQuery('')
              setCategory(item.id === 'recent' ? EMOJI_CATEGORIES[1].id : item.id)
            }}
          >
            {item.icon}
          </button>
        ))}
      </div>
      <div className="comment-emoji-search">
        <SearchIcon sx={{ fontSize: 16 }} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Search"
          autoFocus
        />
      </div>
      <div className="comment-emoji-scroll">
        {filtered.map((group) => (
          <div key={group.id} className="comment-emoji-group">
            <div className="comment-emoji-group-label">{group.label}</div>
            {group.emojis.length === 0 ? (
              <p className="comment-emoji-empty">No emojis match “{query.trim()}”</p>
            ) : (
              <div className="comment-emoji-grid">
                {group.emojis.map((emoji) => (
                  <button key={emoji + group.id} type="button" onClick={() => onPick(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="comment-emoji-close" onClick={onClose}>
        Close
      </button>
    </div>
  )
}

function MentionMenu({
  query,
  onPick
}: {
  query: string
  onPick: (person: CommentPerson) => void
}) {
  const people = COMMENT_PEOPLE.filter((person) => {
    const q = query.toLowerCase()
    if (!q) return true
    return person.name.toLowerCase().includes(q) || person.email.toLowerCase().includes(q)
  })
  if (!people.length) return null
  return (
    <div className="comment-mention-menu" onPointerDown={(event) => event.stopPropagation()}>
      {people.map((person) => (
        <button key={person.id} type="button" onClick={() => onPick(person)}>
          {person.avatarUrl ? (
            <img src={person.avatarUrl} alt="" className="comment-person-avatar" />
          ) : (
            <span className="comment-person-avatar" style={{ background: person.color }}>
              {person.initial}
            </span>
          )}
          <span className="comment-person-meta">
            <strong>{person.name}</strong>
            <em>{person.email}</em>
          </span>
        </button>
      ))}
    </div>
  )
}

function CommentComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = 'New comment',
  autoFocus = true
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel?: () => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const canSend = value.trim().length > 0

  useEffect(() => {
    if (autoFocus) areaRef.current?.focus()
  }, [autoFocus])

  const insertAtCursor = (text: string) => {
    const el = areaRef.current
    if (!el) {
      onChange(value + text)
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = value.slice(0, start) + text + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + text.length
      el.setSelectionRange(caret, caret)
    })
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel?.()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (canSend) onSubmit()
    }
  }

  const onInput = (next: string) => {
    onChange(next)
    const el = areaRef.current
    const caret = el?.selectionStart ?? next.length
    const before = next.slice(0, caret)
    const match = before.match(/@([^\s@[\]]{0,32})$/)
    if (match) {
      setMentionOpen(true)
      setMentionQuery(match[1])
    } else {
      setMentionOpen(false)
      setMentionQuery('')
    }
  }

  const pickMention = (person: CommentPerson) => {
    const el = areaRef.current
    const caret = el?.selectionStart ?? value.length
    const before = value.slice(0, caret)
    const after = value.slice(caret)
    const replaced = before.replace(/@([^\s@[\]]{0,32})$/, mentionToken(person) + ' ')
    onChange(replaced + after)
    setMentionOpen(false)
    setMentionQuery('')
    requestAnimationFrame(() => areaRef.current?.focus())
  }

  return (
    <div className="comment-composer" onPointerDown={(event) => event.stopPropagation()}>
      <textarea
        ref={areaRef}
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={(event) => onInput(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="comment-composer-bar">
        <div className="comment-composer-tools">
          <button type="button" title="Emoji" onClick={() => setEmojiOpen((open) => !open)}>
            <SentimentSatisfiedAltIcon sx={{ fontSize: 18 }} />
          </button>
          <button
            type="button"
            title="Mention"
            onClick={() => {
              insertAtCursor('@')
              setMentionOpen(true)
              setMentionQuery('')
            }}
          >
            <AlternateEmailIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" title="Attach image" onClick={() => fileRef.current?.click()}>
            <ImageOutlinedIcon sx={{ fontSize: 18 }} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              insertAtCursor(` [${file.name}] `)
              event.target.value = ''
            }}
          />
        </div>
        <button type="button" className={`comment-send${canSend ? ' is-on' : ''}`} disabled={!canSend} onClick={onSubmit}>
          <ArrowUpwardIcon sx={{ fontSize: 16 }} />
        </button>
      </div>
      {emojiOpen && (
        <EmojiPicker
          onPick={(emoji) => {
            insertAtCursor(emoji)
            setEmojiOpen(false)
          }}
          onClose={() => setEmojiOpen(false)}
        />
      )}
      {mentionOpen && <MentionMenu query={mentionQuery} onPick={pickMention} />}
    </div>
  )
}

export function CommentThreadCard({
  node,
  camera,
  pageName,
  mode,
  draftText,
  onDraftText,
  onSubmitDraft,
  onCancelDraft,
  onReply,
  onResolve,
  onClose,
  onDelete,
  onMarkUnread,
  onCopyLink
}: {
  node: DesignNode
  camera: Camera
  pageName: string
  mode: 'compose' | 'thread'
  draftText: string
  onDraftText: (value: string) => void
  onSubmitDraft: () => void
  onCancelDraft: () => void
  onReply: (text: string) => void
  onResolve: () => void
  onClose: () => void
  onDelete: () => void
  onMarkUnread: () => void
  onCopyLink: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [reply, setReply] = useState('')
  const screen = worldToScreen(camera, node.x, node.y)
  const left = screen.x + 18
  const top = Math.max(8, screen.y - 8)

  return (
    <div className="comment-overlay-card" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
      {mode === 'compose' ? (
        <CommentComposer value={draftText} onChange={onDraftText} onSubmit={onSubmitDraft} onCancel={onCancelDraft} />
      ) : (
        <div className="comment-thread-card">
          <div className="comment-thread-head">
            <strong>Comment</strong>
            <div className="comment-thread-actions">
              <button type="button" title="More" onClick={() => setMenuOpen((open) => !open)}>
                <MoreHorizIcon sx={{ fontSize: 18 }} />
              </button>
              <button type="button" title="Resolve" onClick={onResolve}>
                <CheckIcon sx={{ fontSize: 18 }} />
              </button>
              <button type="button" title="Close" onClick={onClose}>
                <CloseIcon sx={{ fontSize: 18 }} />
              </button>
            </div>
            {menuOpen && (
              <div className="comment-thread-menu">
                <button
                  type="button"
                  onClick={() => {
                    onMarkUnread()
                    setMenuOpen(false)
                  }}
                >
                  Mark as unread
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onCopyLink()
                    setMenuOpen(false)
                  }}
                >
                  Copy link
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    onDelete()
                    setMenuOpen(false)
                  }}
                >
                  Delete thread…
                </button>
              </div>
            )}
          </div>
          <div className="comment-thread-body">
            {(node.messages || []).map((message) => {
              const author = getCommentPerson(message.authorId)
              return (
                <div key={message.id} className="comment-message">
                  <span className="comment-person-avatar" style={{ background: author.color }}>
                    {author.initial}
                  </span>
                  <div className="comment-message-main">
                    <div className="comment-message-meta">
                      <strong>{author.name}</strong>
                      <span>{formatCommentTime(message.createdAt)}</span>
                    </div>
                    <div className="comment-message-text">
                      <CommentRichText text={message.text} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="comment-thread-context">
              #{node.commentNumber || 1} · {pageName}
            </div>
          </div>
          <CommentComposer
            value={reply}
            onChange={setReply}
            placeholder="Reply"
            autoFocus={false}
            onSubmit={() => {
              if (!reply.trim()) return
              onReply(reply.trim())
              setReply('')
            }}
          />
        </div>
      )}
    </div>
  )
}

export function CommentResolveToast({
  open,
  onUndo,
  onClose
}: {
  open: boolean
  onUndo: () => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(onClose, 5000)
    return () => window.clearTimeout(timer)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="comment-toast">
      <span>Comment resolved</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="comment-toast-x" onClick={onClose} title="Dismiss">
        <CloseIcon sx={{ fontSize: 16 }} />
      </button>
    </div>
  )
}

export { CURRENT_USER }
