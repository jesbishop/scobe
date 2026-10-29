import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Pencil, Volume2, Square, Share2, Settings2, Check, X } from 'lucide-react'
import type { ChatMessage } from './ChatView'

export function WorkingBanner({ startedAt, finishedAt, busy }: { startedAt: number; finishedAt?: number; busy: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!busy) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [busy])
  const seconds = Math.max(0, Math.floor(((finishedAt || now) - startedAt) / 1000))
  const duration = seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's'
  return <div className="chat-working-banner"><span className={busy ? 'chat-thinking-shimmer' : ''}>{busy ? 'Working for ' : 'Worked for '}{duration}</span></div>
}

let playing: HTMLAudioElement | null = null
let playbackVersion = 0
export function MessageActions({ message, onEdit, busy, settingsOnly = false }: { message: ChatMessage; onEdit?: () => void; busy: boolean; settingsOnly?: boolean }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(false)
  const [key, setKey] = useState('')
  const [managed, setManaged] = useState(false)
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([])
  const [voice, setVoice] = useState(() => localStorage.getItem('scobe:read-voice') || '')
  const [model, setModel] = useState(() => localStorage.getItem('scobe:read-model') || 'eleven_v3')
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; const stop = () => setAudioState('idle'); window.addEventListener('scobe:stop-read-aloud', stop); return () => { mounted.current = false; window.removeEventListener('scobe:stop-read-aloud', stop) } }, [])
  useEffect(() => { if (!settings) return; const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettings(false) }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape) }, [settings])
  const loadVoices = async () => {
    try { const list = await window.vanta.speechVoices(); setVoices(list); if (!list.some(item => item.id === voice)) setVoice(list[0]?.id || '') } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const configure = async () => { setSettings(true); setError(''); const status = await window.vanta.speechStatus(); setManaged(status.managed); if (status.configured) await loadVoices() }
  const read = async () => {
    if (audioState !== 'idle') { playbackVersion++; playing?.pause(); playing = null; window.dispatchEvent(new Event('scobe:stop-read-aloud')); return }
    try {
      setError('')
      if (!(await window.vanta.speechStatus()).configured || !voice) { await configure(); return }
      playing?.pause(); window.dispatchEvent(new Event('scobe:stop-read-aloud'))
      const version = ++playbackVersion
      setAudioState('loading')
      const plain = message.text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#`]/g, '')
      const url = await window.vanta.speechCreate(plain, voice, model)
      if (version !== playbackVersion || !mounted.current) return
      const audio = new Audio(url); playing = audio
      audio.onended = () => { if (mounted.current) setAudioState('idle'); playing = null }
      audio.onerror = () => { if (mounted.current) { setAudioState('idle'); setError('Audio playback failed.') } }
      await audio.play(); if (mounted.current) setAudioState('playing')
    } catch (err) { if (mounted.current) { setAudioState('idle'); setError(err instanceof Error ? err.message : String(err)) } }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(message.text); setCopied(true); window.setTimeout(() => { if (mounted.current) setCopied(false) }, 1800) } catch { setError('Could not copy. Please select and copy the text.') } }
  const share = async () => {
    const file = new File([message.text], 'Scobe response.txt', { type: 'text/plain' })
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Scobe response', files: [file] })
      else { const url = URL.createObjectURL(file); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
    } catch (err) { if (!(err instanceof DOMException && err.name === 'AbortError')) setError('Could not share this response.') }
  }
  const timestamp = message.createdAt || message.finishedAt
  return <>
    {settingsOnly ? <button type="button" className="composer-voice-settings" title="Voice settings" aria-label="Voice settings" onClick={() => void configure()}><Settings2 size={14} /></button> : <div className={'chat-message-actions ' + message.role}>
      {message.role === 'user' && timestamp ? <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()}>{new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time> : null}
      <button type="button" title={copied ? 'Copied' : message.role === 'user' ? 'Copy message' : 'Copy response'} aria-label={message.role === 'user' ? 'Copy message' : 'Copy response'} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      {message.role === 'user' && onEdit ? <button type="button" title="Edit message" aria-label="Edit message" disabled={busy} onClick={onEdit}><Pencil size={14} /></button> : null}
      {message.role === 'assistant' ? <>
        <button type="button" title={audioState === 'idle' ? 'Read aloud' : audioState === 'loading' ? 'Cancel read aloud' : 'Stop reading'} aria-label={audioState === 'idle' ? 'Read aloud' : 'Stop read aloud'} onClick={() => void read()} disabled={busy}>{audioState === 'idle' ? <Volume2 size={15} /> : <Square size={13} />}</button>
        <button type="button" title="Share response" aria-label="Share response" onClick={() => void share()}><Share2 size={14} /></button>
        <button type="button" title="Voice settings" aria-label="Voice settings" onClick={() => void configure()}><Settings2 size={14} /></button>
        {timestamp ? <time dateTime={new Date(timestamp).toISOString()} title={new Date(timestamp).toLocaleString()}>{new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time> : null}
        {audioState === 'loading' ? <span>Preparing audio…</span> : null}
      </> : null}
    </div>}
    {error && !settings && !settingsOnly ? <div className="chat-action-error" role="alert">{error}</div> : null}
    {settings ? createPortal(<div className="chat-voice-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setSettings(false) }}><section className="chat-voice-settings" role="dialog" aria-modal="true" aria-label="Read aloud settings">
      <header><strong>Read aloud · ElevenLabs</strong><button type="button" title="Close" aria-label="Close voice settings" onClick={() => setSettings(false)}><X size={16} /></button></header>
      <p>{managed ? 'Choose a voice for AI-generated speech. Read aloud uses your Scobe allowance.' : 'Choose a voice for AI-generated speech. Read aloud uses your ElevenLabs credits.'}</p>
      {!managed ? <><label>API key<input autoFocus type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Enter or replace ElevenLabs key" /></label>
      <button type="button" disabled={!key.trim()} onClick={async () => { try { await window.vanta.speechKey(key); setKey(''); setError(''); await loadVoices() } catch (err) { setError(err instanceof Error ? err.message : String(err)) } }}>Save key and load voices</button></> : null}
      <label>Voice<select value={voice} onChange={event => setVoice(event.target.value)}><option value="">Choose a voice</option>{voices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Voice model<select value={model} onChange={event => setModel(event.target.value)}><option value="eleven_v3">Eleven v3</option><option value="eleven_multilingual_v2">Multilingual v2</option></select></label>
      {error ? <p role="alert" className="chat-action-error">{error}</p> : null}
      <button type="button" disabled={!voice} onClick={() => { localStorage.setItem('scobe:read-voice', voice); localStorage.setItem('scobe:read-model', model); setSettings(false) }}>Done</button>
    </section></div>, document.body) : null}
  </>
}
