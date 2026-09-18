import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import AddIcon from '@mui/icons-material/Add'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import MicNoneOutlinedIcon from '@mui/icons-material/MicNoneOutlined'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined'
import { normalizeUrl } from '../shared/url'
import type { SwitchMode } from '../shared/types'
import { ModeSwitch } from './ModeSwitch'
import { IconClose } from './icons'

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; text: string }

export type ChatSession = {
  id: string
  title: string
  messages: ChatMessage[]
}

export function createChatSession(title = 'New chat'): ChatSession {
  return { id: crypto.randomUUID(), title, messages: [] }
}

export function ChatWorkspace({
  messages,
  input,
  onInput,
  onSend,
  busy,
  mode,
  onMode
}: {
  messages: ChatMessage[]
  input: string
  onInput: (value: string) => void
  onSend: () => void
  busy: boolean
  mode?: SwitchMode
  onMode?: (mode: SwitchMode) => void
}) {
  const empty = messages.length === 0
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, busy])

  return (
    <div className={`chat-workspace${empty ? ' is-empty' : ''}`}>
      {empty ? (
        <div className="chat-empty">
          <h1>What do you want to design?</h1>
          <p>Ask Vanta to match an open window, generate a screen, or drive the browser beside you.</p>
        </div>
      ) : (
        <div className="chat-thread" ref={logRef}>
          <div className="chat-thread-inner">
            {messages.map((item, index) => (
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
            ))}
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
      )}
      <div className="chat-composer-dock">
        {mode && onMode ? (
          <div className="chat-mode-switch-wrap">
            <ModeSwitch mode={mode} onMode={onMode} />
          </div>
        ) : null}
        <ChatComposer value={input} onChange={onInput} onSend={onSend} busy={busy} />
      </div>
    </div>
  )
}

const AGENT_MODES = ['Agent', 'Ask', 'Manual'] as const

export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  compact = false,
  placeholder,
  autoFocus = false
}: {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  busy: boolean
  compact?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const [agentMode, setAgentMode] = useState<(typeof AGENT_MODES)[number]>('Agent')
  const [modeOpen, setModeOpen] = useState(false)
  const canSend = value.trim().length > 0 && !busy
  const hint = placeholder || 'Plan, search, build anything'

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(compact ? 120 : 200, Math.max(compact ? 20 : 24, el.scrollHeight))}px`
  }, [value, compact])

  useEffect(() => {
    if (!autoFocus) return
    areaRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!modeOpen) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setModeOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [modeOpen])

  const submit = () => {
    if (!canSend) return
    onSend()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form
      ref={rootRef}
      className={`cursor-composer${compact ? ' is-compact' : ''}${busy ? ' is-busy' : ''}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        ref={areaRef}
        className="cursor-composer-input"
        value={value}
        placeholder={hint}
        rows={1}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="cursor-composer-bar">
        <div className="cursor-composer-left">
          <div className="cursor-mode-wrap">
            <button
              type="button"
              className="cursor-mode-pill"
              title="Mode"
              onClick={() => setModeOpen((open) => !open)}
            >
              <AutoAwesomeOutlinedIcon sx={{ fontSize: 15 }} />
              <span>{agentMode}</span>
              <KeyboardArrowDownIcon sx={{ fontSize: 15 }} />
            </button>
            {modeOpen && (
              <div className="cursor-mode-menu">
                {AGENT_MODES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={agentMode === item ? 'is-on' : ''}
                    onClick={() => {
                      setAgentMode(item)
                      setModeOpen(false)
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="cursor-composer-icon" title="Add context" disabled>
            <AddIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" className="cursor-model-pill" title="Model">
            <span>Composer</span>
            <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
          </button>
        </div>
        <div className="cursor-composer-right">
          <button type="button" className="cursor-composer-icon" title="Image" disabled>
            <ImageOutlinedIcon sx={{ fontSize: 18 }} />
          </button>
          <button type="button" className="cursor-composer-icon" title="Voice" disabled>
            <MicNoneOutlinedIcon sx={{ fontSize: 18 }} />
          </button>
          <button
            type="submit"
            className={`cursor-send${canSend || busy ? ' is-ready' : ''}${busy ? ' is-stop' : ''}`}
            disabled={!canSend && !busy}
            title={busy ? 'Stop' : 'Send'}
          >
            {busy ? <StopRoundedIcon sx={{ fontSize: 16 }} /> : <ArrowUpwardIcon sx={{ fontSize: 16 }} />}
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
