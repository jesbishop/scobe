import { CloudAccount } from './CloudAccount'
import { MessageActions, WorkingBanner } from './ChatMessageTools'
import { createPortal } from 'react-dom'
import { CHAT_MODELS, resolveChatModel, type ChatModelId } from '../shared/chatModels'
import { useEffect, useLayoutEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react'
import { ArrowUpwardIcon, CloseRoundedIcon, KeyboardOutlinedIcon, MicNoneOutlinedIcon, NearMeIcon, OpenInNewIcon, TagOutlinedIcon } from './lucideIcons'
import { normalizeUrl } from '../shared/url'
import type { TranscriberStatus } from '../shared/jev'
import { IconClose } from './icons'
import { JevDecisionCard } from './JevViews'
import type { JevDecision } from './jevEngine'
import type { VoiceState } from './useVoiceCapture'

export type ChatMessage = {
  createdAt?: number
  startedAt?: number
  finishedAt?: number
  role: 'user' | 'assistant' | 'system'
  text: string
  jev?: JevDecision
  /** Canvas change made from chat; the live decision is looked up by this id. */
  jevId?: string
}

export type JevThreadHandlers = {
  onEdit?: (index: number, text: string) => void
  onUndo: (decisionId: string) => void
}

export type JevComposerProps = {
  chatModel?: ChatModelId
  onChatModel?: (model: ChatModelId) => void
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
  /** Changes when the draft should be emptied (e.g. the user edited the canvas by hand). */
  clearTick?: number
}

export type ChatSession = {
  model?: ChatModelId
  id: string
  title: string
  messages: ChatMessage[]
}

export function createChatSession(title = 'New chat'): ChatSession {
  return { id: crypto.randomUUID(), title, messages: [] }
}

/** Reveal only fresh answers; existing conversation history stays immediately readable. */
function AnswerText({ text, animate = false }: { text: string; animate?: boolean }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(animate && !reduced ? 0 : text.length)
  const previous = useRef(text)
  const revealed = useRef(shown)
  useEffect(() => {
    const old = previous.current
    previous.current = text
    if (!animate || reduced) {
      revealed.current = text.length
      setShown(text.length)
      return
    }
    if (!text.startsWith(old)) revealed.current = 0
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last >= 28) {
        const rest = text.slice(revealed.current)
        const next = rest.match(/^\s*\S+\s*/)?.[0].length || rest.length
        revealed.current = Math.min(text.length, revealed.current + next)
        setShown(revealed.current)
        last = now
      }
      if (revealed.current < text.length) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, animate, reduced])
  return <span className="chat-answer" aria-label={text}>
    <span aria-hidden="true">{text.slice(0, shown).match(/\S+\s*|\s+/g)?.map((word, index) =>
      <span className={animate && !reduced ? 'chat-answer-word' : undefined} key={index}>{word}</span>
    )}</span>
  </span>
}

function ChatChangeRow({
  decision,
  fallback,
  animate,
  onUndo
}: {
  decision?: JevDecision
  animate?: boolean
  fallback: string
  onUndo?: () => void
}) {
  const status = decision?.status || 'applied'
  const text =
    status === 'deciding' || status === 'needs-choice'
      ? 'Working…'
      : status === 'error'
        ? decision?.error || 'Couldn’t apply that.'
        : status === 'noop'
          ? 'Nothing to change.'
          : decision?.result || fallback || 'Done.'
  return (
    <div className="chat-bubble-row assistant">
      <div className={`chat-bubble assistant chat-change is-${status}`}>
        <div className="chat-bubble-label">
          {status === 'undone' ? <span className="chat-change-tag">Undone</span> : null}
          {status === 'error' ? <span className="chat-change-tag">Not applied</span> : null}
        </div>
        <div className={`chat-bubble-text${status === 'deciding' || status === 'needs-choice' ? ' muted' : ''}`}><AnswerText text={text} animate={animate && status !== 'deciding' && status !== 'needs-choice'} /></div>
        {status === 'applied' && onUndo ? (
          <button type="button" className="chat-change-undo" onClick={onUndo}>
            Undo
          </button>
        ) : null}
      </div>
    </div>
  )
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
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const initialCount = useRef(messages.length)
  let jevCount = 0
  const logRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const log = logRef.current
    if (!log || className?.includes('chat-agents-popout-thread')) return
    const inner = log.querySelector<HTMLElement>('.chat-thread-inner')
    if (!inner) return
    let composer: HTMLElement | null = null
    const align = () => {
      const next = document.querySelector<HTMLElement>('.canvas-toolbar-stack .cursor-composer') || document.querySelector<HTMLElement>('.canvas-toolbar-shell')
      if (!next) return
      if (next !== composer) { if (composer) observer.unobserve(composer); composer = next; observer.observe(next) }
      const bounds = next.getBoundingClientRect()
      const host = log.getBoundingClientRect()
      const inset = parseFloat(getComputedStyle(log).paddingLeft) || 0
      inner.style.width = bounds.width + 'px'
      inner.style.maxWidth = 'none'
      inner.style.marginLeft = (bounds.left - host.left - inset) + 'px'
      inner.style.marginRight = '0'
    }
    const observer = new ResizeObserver(align)
    observer.observe(log)
    const mutations = new MutationObserver(records => {
      if (records.some(record => Array.from(record.addedNodes).some(node => node instanceof HTMLElement && (node.matches('.canvas-toolbar-stack, .cursor-composer') || node.querySelector('.canvas-toolbar-stack, .cursor-composer'))))) align()
    })
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', align)
    align()
    return () => { observer.disconnect(); mutations.disconnect(); window.removeEventListener('resize', align) }
  }, [className, messages.length === 0])


  useEffect(() => {
    const el = logRef.current
    if (!el) return
    const follow = () => { if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight }
    el.scrollTop = el.scrollHeight
    const observer = new ResizeObserver(follow)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
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
          if (item.jevId) {
            return (
              <ChatChangeRow
                key={item.jevId}
                decision={item.jev}
                fallback={item.text}
                animate={index >= initialCount.current}
                onUndo={jev && item.jev ? () => jev.onUndo(item.jevId!) : undefined}
              />
            )
          }
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
          const running = Boolean(item.startedAt && !item.finishedAt && busy)
          return (
            <div key={index} className={`chat-bubble-row ${item.role}`}>
              <div className="chat-message-content">
                {item.role === 'assistant' && item.startedAt ? <WorkingBanner startedAt={item.startedAt} finishedAt={item.finishedAt} busy={running} /> : null}
                {editingIndex === index ? <form className="chat-edit-message" onSubmit={event => { event.preventDefault(); if (editText.trim()) { jev?.onEdit?.(index, editText.trim()); setEditingIndex(null) } }}>
                  <textarea autoFocus value={editText} onChange={event => setEditText(event.target.value)} />
                  <div><button type="button" onClick={() => setEditingIndex(null)}>Cancel</button><button type="submit" disabled={!editText.trim() || busy}>Save & send</button></div>
                </form> : <div className={`chat-bubble ${item.role}`}>
                  <div className="chat-bubble-text">{!item.text && running ? <span className="chat-thinking-shimmer">Thinking…</span> : <AnswerText text={item.text} animate={item.role === 'assistant' && index >= initialCount.current} />}</div>
                </div>}
                {item.text && item.role !== 'system' && editingIndex !== index ? <MessageActions message={item} busy={running || busy} onEdit={item.role === 'user' && jev?.onEdit ? () => { setEditingIndex(index); setEditText(item.text) } : undefined} /> : null}
              </div>
            </div>
          )
        })}
        {busy && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="chat-bubble-row assistant">
            <div className="chat-bubble assistant">
              <div className="chat-bubble-label">Scobe</div>
              <div className="chat-bubble-text muted chat-thinking-shimmer">Thinking…</div>
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

const MODE_SPRING = { type: 'spring', stiffness: 520, damping: 38, mass: 0.7 } as const

/** Typing / Microphone switch. The white pill slides between the two options. */
export function InputModeToggle({
  micOn,
  onMic,
  disabled = false
}: {
  micOn: boolean
  onMic?: () => void
  disabled?: boolean
}) {
  const reduceMotion = useReducedMotion()
  const pillId = useId()
  const transition = reduceMotion ? { duration: 0 } : MODE_SPRING
  const options = [
    { key: 'typing', label: 'Typing', on: !micOn, Icon: KeyboardOutlinedIcon },
    { key: 'mic', label: 'Microphone', on: micOn, Icon: MicNoneOutlinedIcon }
  ] as const

  return (
    <div className="cursor-composer-mode" role="group" aria-label="Input mode">
      {options.map(({ key, label, on, Icon }) => (
        <button
          key={key}
          type="button"
          className={on ? 'is-on' : ''}
          title={label}
          aria-pressed={on}
          disabled={disabled}
          onClick={() => {
            if (!on) onMic?.()
          }}
        >
          {on ? (
            <motion.span
              layoutId={`input-mode-pill-${pillId}`}
              className="cursor-composer-mode-pill"
              transition={transition}
              aria-hidden
            />
          ) : null}
          <motion.span
            className="cursor-composer-mode-icon"
            animate={on && !reduceMotion ? { scale: [1, 1.18, 1] } : { scale: 1 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
          >
            <Icon sx={{ fontSize: 15 }} />
          </motion.span>
          <span className="cursor-composer-mode-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

function ChatModelPicker({ value, onChange, disabled }: { value?: ChatModelId; onChange: (model: ChatModelId) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const menuId = useId()
  const selected = resolveChatModel(value)
  useEffect(() => {
    if (!open) return
    const place = () => {
      const button = trigger.current
      if (!button) return
      const rect = button.getBoundingClientRect()
      const toolbar = button.closest('.canvas-toolbar')?.getBoundingClientRect()
      const min = Math.max(8, toolbar?.left ?? 8)
      const max = Math.min(window.innerWidth - 8, toolbar?.right ?? window.innerWidth - 8)
      const width = Math.min(200, max - min)
      setPosition({ left: Math.max(min, Math.min(rect.right - width, max - width)), top: Math.max(8, rect.top - 8), width })
    }
    place()
    const frame = requestAnimationFrame(() => {
      const items = popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
      items?.[CHAT_MODELS.findIndex(model => model.id === selected)]?.focus()
    })
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, selected])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return <>
    <button ref={trigger} type="button" className="chat-model-picker" aria-label="Choose AI model" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={disabled} onClick={() => setOpen(value => !value)}>
      {CHAT_MODELS.find(model => model.id === selected)?.label}<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {createPortal(<AnimatePresence>{open && <div className="chat-model-menu-anchor" style={{ left: position.left, top: position.top, width: position.width }}>
      <motion.div ref={popup} id={menuId} role="menu" aria-label="AI model" className="chat-model-menu"
        initial={reduced ? false : { opacity: 0, y: 3, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 2, scale: .99 }} transition={{ duration: reduced ? 0 : .12 }}
        onKeyDown={event => {
          const items = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          let next = index
          if (event.key === 'ArrowDown') next = (index + 1) % items.length
          else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = items.length - 1
          else if (event.key === 'Tab') { setOpen(false); return }
          else return
          event.preventDefault(); items[next]?.focus()
        }}>
        {CHAT_MODELS.map(model => <button key={model.id} type="button" role="menuitemradio" aria-checked={model.id === selected} className="chat-model-option" onClick={() => { onChange(model.id); setOpen(false); trigger.current?.focus() }}>
          <span className="chat-model-check" aria-hidden="true">{model.id === selected ? '✓' : ''}</span><span>{model.label}</span>
        </button>)}
      </motion.div>
    </div>}</AnimatePresence>, document.body)}
  </>
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
  const canSend = hasText && !busy
  const micOn = Boolean(jev?.micOn)

  useEffect(() => {
    setDraft(value)
    if (!micOn) return
    const el = areaRef.current
    if (!el) return
    const end = value.length
    requestAnimationFrame(() => el.setSelectionRange(end, end))
  }, [value, micOn])

  useEffect(() => {
    if (!jev) return
    if (!jev.on) jev.onToggle(true)
  }, [jev])

  const clearTick = jev?.clearTick ?? 0
  useEffect(() => {
    if (clearTick) setDraft('')
  }, [clearTick])

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
  const hearing = voiceState === 'hearing'
  const voiceError = jev?.voiceError || (micOn && jev?.model?.state === 'error' ? jev.model.error || null : null)
  const hint = placeholder || (micOn ? 'Start talking…' : 'Message Scobe…')

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
      {voiceError ? (
        <div className="cursor-composer-voice is-error" role="alert">
          {voiceError}
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
          {jev ? <InputModeToggle micOn={micOn} onMic={jev.onMic} /> : null}
        </div>
        <div className="cursor-composer-right">
          <CloudAccount />
          <MessageActions message={{ role: 'assistant', text: '' }} busy={busy} settingsOnly />
          {jev?.onChatModel ? (
            <ChatModelPicker value={jev.chatModel} onChange={jev.onChatModel} disabled={busy} />
          ) : null}
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
