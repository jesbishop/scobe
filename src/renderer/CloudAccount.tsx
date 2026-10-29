import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogIn, UserRound, X } from 'lucide-react'
type Status = { enabled: boolean; signedIn: boolean; email: string }
export function CloudAccount() {
  const [status, setStatus] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => { void window.vanta.cloudStatus().then(setStatus).catch(() => undefined) }, [])
  useEffect(() => {
    if (!open) return
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') || [])
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, sent])
  if (!status?.enabled) return null
  const submit = async () => {
    setBusy(true); setError('')
    try {
      if (!sent) { await window.vanta.cloudSendCode(email.trim()); setSent(true) }
      else { const next = await window.vanta.cloudVerifyCode(email.trim(), code.trim()); setStatus(next); setOpen(false); setCode(''); setSent(false); window.dispatchEvent(new Event('scobe:cloud-auth-changed')) }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }
  return <>
    <button ref={trigger} type="button" className="cloud-account-button" title={status.signedIn ? status.email : 'Sign in to Scobe'} onClick={() => { setError(''); setOpen(true) }}>{status.signedIn ? <UserRound size={14} /> : <><LogIn size={14} /><span>Sign in</span></>}</button>
    {open ? createPortal(<div className="chat-voice-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setOpen(false) }}><section ref={dialog} className="chat-voice-settings" role="dialog" aria-modal="true" aria-label="Scobe account">
      <header><strong>{status.signedIn ? 'Your Scobe account' : 'Sign in to Scobe'}</strong><button type="button" aria-label="Close account" onClick={() => setOpen(false)}><X size={16} /></button></header>
      {status.signedIn ? <><p>{status.email}</p><p>Chat and read aloud are included within your Scobe usage allowance.</p><button type="button" onClick={async () => { setStatus(await window.vanta.cloudSignOut()); setOpen(false); window.dispatchEvent(new Event('scobe:cloud-auth-changed')) }}>Sign out</button></> : <form className="cloud-signin-form" onSubmit={event => { event.preventDefault(); void submit() }}>
        <p>Use your email to access AI chat and read aloud. No provider API keys needed.</p>
        <label>Email<input type="email" autoComplete="email" required disabled={sent || busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
        {sent ? <><p>Enter the sign-in code sent to your email.</p><label>Email code<input inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6,10}" value={code} onChange={event => setCode(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => { setSent(false); setCode('') }}>Use another email or resend</button></> : null}
        {error ? <p className="chat-action-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : sent ? 'Sign in' : 'Send sign-in code'}</button>
      </form>}
    </section></div>, document.body) : null}
  </>
}
