import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import { ArrowUpwardIcon, CloseRoundedIcon, KeyboardOutlinedIcon, MicNoneOutlinedIcon, NearMeIcon, OpenInNewIcon, TagOutlinedIcon } from './lucideIcons'
import { normalizeUrl } from '../shared/url'
import type { TranscriberStatus } from '../shared/jev'
import { IconClose } from './icons'
import { JevDecisionCard } from './JevViews'
import type { JevDecision } from './jevEngine'
import type { VoiceState } from './useVoiceCapture'

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; text: string; jev?: JevDecision }

export type JevThreadHandlers = {
  onUndo: (decisionId: string) => void
}

export type JevComposerProps = {
  on: boolean
  onToggle: (on: boolean) => void
  micOn: boolean
  onMic: () => void
  /** Debounced Jev preview — does not need to update App state every keystroke. */
  onDraft?: (text: string) => void
  /** Apply current draft (Enter / Apply). */
  onApplyDraft?: (text: string) => void
  /** Pointer-pick mode — click the chip icon to enable canvas pointing. */
  picking?: boolean
  onTogglePick?: () => void
  /** Live hover / selection count for the composer chip. */
  selectionCount?: number
  pointerLabel?: string | null
  locked?: boolean
  voiceState?: VoiceState
  level?: number
  voiceError?: string | null
  model?: TranscriberStatus | null
  configured?: boolean
  onToggleLock?: () => void
  onClearTarget?: () => void
  onSaveKey?: (key: string) => void
}

export type ChatSession = {
  id: string
  title: string
  messages: ChatMessage[]
}

export function createChatSession(title = 'New chat'): ChatSession {
  return { id: crypto.randomUUID(), title, messages: [] }
}

function ChatThread({
  messages,
  busy,
  className,
  jev
}: {
  messages: ChatMessage[]
  busy: boolean
  className?: string
  jev?: JevThreadHandlers
}) {
  let jevCount = 0
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, busy])

  if (messages.length === 0) {
    return (
      <div className={`chat-empty${className ? ` ${className}` : ''}`}>
        <h1>What do you want to design?</h1>
        <p>Point at an element and describe the change, or type a prompt below.</p>
      </div>
    )
  }

  return (
    <div className={`chat-thread${className ? ` ${className}` : ''}`} ref={logRef}>
      <div className="chat-thread-inner">
        {messages.map((item, index) => {
          if (item.jev) {
            const decision = item.jev
            jevCount += 1
            return (
              <JevDecisionCard
                key={decision.id || `jev-${index}`}
                decision={decision}
                index={jevCount}
                onUndo={jev ? () => jev.onUndo(decision.id) : undefined}
              />
            )
          }
          return (
            <div key={index} className={`chat-bubble-row ${item.role}`}>
              {item.role === 'user' ? (
                <div className="chat-bubble user">{item.text}</div>
              ) : (
                <div className={`chat-bubble ${item.role}`}>
                  {item.role === 'assistant' && <div className="chat-bubble-label">Vanta</div>}
                  <div className="chat-bubble-text">{item.text}</div>
                </div>
              )}
            </div>
          )
        })}
        {busy && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="chat-bubble-row assistant">
            <div className="chat-bubble assistant">
              <div className="chat-bubble-label">Vanta</div>
              <div className="chat-bubble-text muted">Working…</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function ChatWorkspace({
  messages,
  busy,
  poppedOut = false,
  onPopOut,
  emptyHint,
  jev
}: {
  messages: ChatMessage[]
  busy: boolean
  poppedOut?: boolean
  onPopOut?: () => void
  emptyHint?: string
  jev?: JevThreadHandlers
}) {
  const empty = messages.length === 0

  return (
    <div
      className={`chat-workspace${empty ? ' is-empty' : ''}${poppedOut ? '' : ' has-fixed-composer'}${poppedOut ? ' is-popped-out' : ''}`}
    >
      {onPopOut && !poppedOut ? (
        <div className="chat-workspace-actions" data-chrome-overlay="">
          <button
            type="button"
            className="chat-popout-btn"
            title="Pop out Agents panel"
            aria-label="Pop out Agents panel"
            onClick={onPopOut}
          >
            <OpenInNewIcon sx={{ fontSize: 18 }} />
            <span className="chat-popout-tip" role="tooltip">
              Pop out Agents panel
            </span>
          </button>
        </div>
      ) : null}
      {empty ? (
        <div className="chat-empty">
          <h1>What do you want to design?</h1>
          <p>
            {emptyHint ||
              (poppedOut
                ? 'Chat is open in the Agents panel.'
                : 'Point at an element and describe the change, or type a prompt below.')}
          </p>
        </div>
      ) : (
        <ChatThread messages={messages} busy={busy} jev={jev} />
      )}
    </div>
  )
}

export function ChatAgentsPopout({
  open,
  title,
  messages,
  busy,
  input,
  onInput,
  onSend,
  onClose,
  jev,
  jevComposer,
  composerExtra
}: {
  open: boolean
  title?: string
  messages: ChatMessage[]
  busy: boolean
  input: string
  onInput: (value: string) => void
  onSend: () => void
  onClose: () => void
  jev?: JevThreadHandlers
  jevComposer?: JevComposerProps
  composerExtra?: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  const dragControls = useDragControls()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, input, textarea, a')) return
    dragControls.start(event)
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="chat-agents-popout"
          className="chat-agents-popout"
          data-chrome-overlay=""
          role="dialog"
          aria-modal="false"
          aria-label="Agents panel"
          drag
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragElastic={0.08}
          initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={
            reduceMotion
              ? { opacity: 0, transition: { duration: 0.08 } }
              : { opacity: 0, scale: 0.97 }
          }
          transition={reduceMotion ? { duration: 0.01 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.75 }}
        >
          <div className="chat-agents-popout-head" onPointerDown={startDrag}>
            <div className="chat-agents-popout-title">
              <strong>{title || 'Agents'}</strong>
              <span>Chat</span>
            </div>
            <button
              type="button"
              className="chat-popout-btn is-on"
              title="Dock Agents panel"
              aria-label="Dock Agents panel"
              onClick={onClose}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <OpenInNewIcon sx={{ fontSize: 18 }} />
            </button>
          </div>
          <ChatThread messages={messages} busy={busy} className="chat-agents-popout-thread" jev={jev} />
          <div className="chat-agents-popout-composer">
            {composerExtra || (
              <ChatComposer
                value={input}
                onChange={onInput}
                onSend={onSend}
                busy={busy}
                compact
                autoFocus
                jev={jevComposer}
              />
            )}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  compact = false,
  placeholder,
  autoFocus = false,
  jev
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  compact?: boolean
  placeholder?: string
  autoFocus?: boolean
  jev?: JevComposerProps
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const reduceMotion = useReducedMotion()
  const [draft, setDraft] = useState(value)
  const text = draft
  const hasText = text.trim().length > 0
  const canSend = hasText

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (!jev) return
    if (!jev.on) jev.onToggle(true)
  }, [jev])

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(compact ? 140 : 200, Math.max(compact ? 40 : 48, el.scrollHeight))}px`
  }, [text, compact])

  const setText = (next: string) => {
    setDraft(next)
    jev?.onDraft?.(next)
    if (!jev) onChange(next)
  }

  useEffect(() => {
    if (!autoFocus) return
    areaRef.current?.focus()
  }, [autoFocus])

  const submit = () => {
    if (!canSend) return
    const next = draft.trim()
    setDraft('')
    if (jev?.onApplyDraft) jev.onApplyDraft(next)
    else {
      onChange(next)
      onSend()
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const [keyDraft, setKeyDraft] = useState('')
  const voiceState = jev?.voiceState || 'off'
  const micOn = Boolean(jev?.micOn)
  const hearing = voiceState === 'hearing'
  const hint =
    placeholder ||
    (micOn ? 'Speak a change. Pause to apply…' : 'Send follow-up')

  if (jev && jev.configured === false) {
    return (
      <form
        className={`cursor-composer is-jev${compact ? ' is-compact' : ''}`}
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (keyDraft.trim()) jev.onSaveKey?.(keyDraft.trim())
        }}
      >
        <div className="jev-composer-key">
          <span>Jev needs an API key</span>
          <input
            type="password"
            placeholder="jv_live_… or TypeSafe key"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
          />
          <button type="submit" disabled={!keyDraft.trim()}>
            Save
          </button>
        </div>
      </form>
    )
  }

  return (
    <form
      className={`cursor-composer is-jev${compact ? ' is-compact' : ''}${busy ? ' is-busy' : ''}${jev?.picking ? ' is-picking' : ''}${hasText ? ' has-text' : ''}${micOn ? ' is-mic-on' : ''}${hearing ? ' is-hearing' : ''}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        submit()
      }}
    >
      {hearing && !reduceMotion ? (
        <span className="cursor-composer-mic-ring" aria-hidden>
          <span className="cursor-composer-mic-ring-glow" />
          <span className="cursor-composer-mic-ring-stroke" />
        </span>
      ) : hearing ? (
        <span className="cursor-composer-mic-ring is-static" aria-hidden>
          <span className="cursor-composer-mic-ring-stroke" />
        </span>
      ) : null}
      {jev && (jev.selectionCount ?? 0) > 0 ? (
        <div className="jev-selection-chip-row">
          <div className="jev-selection-chip" title={jev.pointerLabel || undefined}>
            <TagOutlinedIcon sx={{ fontSize: 15 }} />
            <span>{jev.selectionCount} selected</span>
            <button
              type="button"
              className="jev-selection-chip-x"
              title="Clear selection"
              aria-label="Clear selection"
              onClick={() => jev.onClearTarget?.()}
            >
              <CloseRoundedIcon sx={{ fontSize: 14 }} />
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        ref={areaRef}
        className="cursor-composer-input"
        value={text}
        placeholder={hint}
        rows={2}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="cursor-composer-row">
        <div className="cursor-composer-left">
          <button
            type="button"
            className={`composer-point-btn${jev?.picking ? ' is-on' : ''}`}
            title="Point at layers"
            aria-label="Point at layers"
            aria-pressed={Boolean(jev?.picking)}
            disabled={!jev?.onTogglePick}
            onClick={() => jev?.onTogglePick?.()}
          >
            <NearMeIcon sx={{ fontSize: 17 }} />
          </button>
          {jev ? (
            <div className="cursor-composer-mode" role="group" aria-label="Input mode">
              <button
                type="button"
                className={!micOn ? 'is-on' : ''}
                title="Typing"
                aria-pressed={!micOn}
                onClick={() => {
                  if (micOn) jev.onMic()
                }}
              >
                <KeyboardOutlinedIcon sx={{ fontSize: 15 }} />
                <span>Typing</span>
              </button>
              <button
                type="button"
                className={micOn ? 'is-on' : ''}
                title="Microphone"
                aria-pressed={micOn}
                onClick={() => {
                  if (!micOn) jev.onMic()
                }}
              >
                <MicNoneOutlinedIcon sx={{ fontSize: 15 }} />
                <span>Microphone</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="cursor-composer-right">
          <button type="submit" className={`cursor-send${canSend ? ' is-ready' : ''}`} title="Send" disabled={!canSend}>
            <ArrowUpwardIcon sx={{ fontSize: 18 }} />
          </button>
        </div>
      </div>
    </form>
  )
}

export function ChatBrowserPanel({
  url,
  onUrlChange,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onHole
}: {
  url: string
  onUrlChange: (value: string) => void
  onNavigate: (url: string) => void
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onHole: (el: HTMLDivElement | null) => void
}) {
  const [draft, setDraft] = useState(url)

  useEffect(() => {
    setDraft(url)
  }, [url])

  const go = () => {
    const next = normalizeUrl(draft)
    setDraft(next)
    onUrlChange(next)
    onNavigate(next)
  }

  let host = 'New tab'
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || host
  } catch {
    /* ignore */
  }

  return (
    <aside className="chat-browser">
      <div className="chat-browser-tabs">
        <div className="chat-browser-tab is-active" title={url}>
          <span className="chat-browser-favicon" />
          <span className="chat-browser-tab-label">{host}</span>
          <span className="chat-browser-tab-close" aria-hidden>
            <IconClose size={12} />
          </span>
        </div>
      </div>
      <div className="chat-browser-toolbar">
        <button type="button" onClick={onBack} title="Back">
          ‹
        </button>
        <button type="button" onClick={onForward} title="Forward">
          ›
        </button>
        <button type="button" onClick={onReload} title="Reload">
          ↻
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') go()
          }}
        />
        <button type="button" onClick={go} title="Go">
          →
        </button>
      </div>
      <div className="chat-browser-hole" ref={onHole} />
    </aside>
  )
}
