import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { CODING_AGENTS, VANTA_BUILD_PROMPT, type AgentMcpLinkStatus, type CodingAgentId, type McpAgentId } from '../shared/codingAgents'

const EXTRA_AGENTS = [
 {id:'opencode',name:'OpenCode',domain:'opencode.ai'},
 {id:'copilot',name:'GitHub Copilot',domain:'github.com'}, {id:'vscode',name:'VS Code',domain:'code.visualstudio.com'},
 {id:'other',name:'Other Agents',domain:''}
] as const
/** Desktop agents Scobe configures directly (no sidebar web app). */
const DESKTOP_AGENTS = [
  {
    id: 'antigravity' as const,
    name: 'Antigravity',
    favicon: 'https://www.google.com/s2/favicons?domain=antigravity.google&sz=64',
    faviconFallback: 'https://www.google.com/s2/favicons?domain=google.com&sz=64'
  }
]
const PICKER_AGENTS = [...CODING_AGENTS.filter(a => a.id !== 'v0'), ...DESKTOP_AGENTS, ...EXTRA_AGENTS.map(a => ({...a, favicon:a.domain ? 'https://www.google.com/s2/favicons?domain='+a.domain+'&sz=32' : '',faviconFallback:''}))]
type PickerAgentId = McpAgentId | typeof EXTRA_AGENTS[number]['id']
/** Agents Scobe connects on this machine: config written locally, no tunnel. */
const LOCAL_AGENTS: McpAgentId[] = ['codex', 'antigravity']
const EXAMPLE_PROMPTS = [
  'Create a basic Hello World frame in Scobe',
  'Build a simple landing page hero on the Scobe design canvas',
  'Create a mobile app settings screen with auto-layout in Scobe'
] as const

function AgentFavicon({
  src,
  fallback,
  size = 16
}: {
  src: string
  fallback: string
  size?: number
}) {
  return (
    <img
      className="ca-connect-favicon"
      src={src}
      alt=""
      width={size}
      height={size}
      onError={(event) => {
        event.currentTarget.src = fallback
      }}
    />
  )
}

export function ConnectAgentModal({
  open,
  initialAgentId = 'codex',
  onClose,
  onDone
}: {
  open: boolean
  initialAgentId?: CodingAgentId
  onClose: () => void
  /** Called when user finishes setup — unlocks the coding agent browser. */
  onDone: (agentId: CodingAgentId, openUrl?: string) => void
}) {
  const [agentId, setAgentId] = useState<PickerAgentId>(initialAgentId)
  const [busy, setBusy] = useState(false)
  const reduceMotion = useReducedMotion()
  const [added, setAdded] = useState(false)
  const [link, setLink] = useState<AgentMcpLinkStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)

  const manualAgent = EXTRA_AGENTS.some(a => a.id === agentId)
  const backendAgent = agentId as McpAgentId
  const meta = PICKER_AGENTS.find((item) => item.id === agentId) || CODING_AGENTS[0]
  const localCodex = agentId === 'codex'
  const antigravity = agentId === 'antigravity'
  const localAgent = LOCAL_AGENTS.includes(backendAgent)
  const ready = manualAgent ? true : localAgent ? link?.state === 'connected' : Boolean(link?.publicUrl && (link.tunnelOk !== false || added))

  useEffect(() => {
    if (!open) return
    setAgentId(initialAgentId)
    setAdded(false)
    setToast(null)
    setLink(null)
  }, [open, initialAgentId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.vanta.getAgentMcpLink?.(manualAgent ? 'codex' : backendAgent).then((status) => {
      if (!cancelled) setLink(status)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, agentId])


  const onAdd = async () => {
    if (busy || typeof window.vanta.connectAgentMcp !== 'function') return
    setBusy(true)
    setToast(null)
    try {
      const status = await window.vanta.connectAgentMcp(backendAgent)
      setLink(status)
      if (localCodex) { setAdded(status.state === 'connected'); setToast('Scobe configured. Restart Codex and start a local chat.'); return }
      if (antigravity) {
        setAdded(status.state === 'connected')
        setToast(status.state === 'connected' ? 'Scobe added to Antigravity' : 'Could not write the Antigravity config')
        return
      }
      const ok = Boolean(status.publicUrl && status.tunnelOk !== false)
      setAdded(ok || Boolean(status.publicUrl))
      if (status.publicUrl) {
        try {
          await navigator.clipboard.writeText(status.publicUrl)
        } catch {
          /* ignore */
        }
      }
      if (status.deeplinkUrl && typeof window.vanta.openExternal === 'function') {
        void window.vanta.openExternal(status.deeplinkUrl).catch(() => undefined)
      }
      setToast(
        ok
          ? `Scobe MCP live — ${meta.name}`
          : status.publicUrl
            ? 'Tunnel URL ready — verifying…'
            : 'Connect failed'
      )
    } catch {
      setToast('Connect failed — try again')
    } finally {
      setBusy(false)
    }
  }

  const copyPrompt = async (text: string) => {
    const instructions = localAgent ? 'Use Scobe MCP to build editable UI on the Scobe canvas. Start with get_basic_info and use auto-layout frames. If Scobe tools are unavailable, explain how to reconnect.' : VANTA_BUILD_PROMPT
    const full = `${instructions}\n\nTask: ${text}`
    try {
      await navigator.clipboard.writeText(full)
      setCopiedPrompt(text)
      window.setTimeout(() => setCopiedPrompt(null), 1400)
    } catch {
      /* ignore */
    }
  }

  const finish = async () => {
    if (!ready) return
    if (localAgent || manualAgent) { onClose(); return }
    if (typeof window.vanta.confirmCloudAgentMcp === 'function') {
      try {
        await window.vanta.confirmCloudAgentMcp(backendAgent)
      } catch {
        /* ignore */
      }
    }
    // Cursor: open install-mcp so Vanta is registered under Connectors / MCP.
    onDone(backendAgent as CodingAgentId, link?.openUrl || link?.installUrl || undefined)
  }

  const addLabel =
    agentId === 'claude-code'
      ? 'Add Scobe to Claude Code'
      : agentId === 'cursor'
        ? 'Add Scobe to Cursor'
        : agentId === 'codex'
          ? 'Add Scobe to Codex'
          : antigravity
            ? 'Add Scobe to Antigravity'
            : 'Add Scobe to v0'

  return createPortal(
    <AnimatePresence>
    {open && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="ca-connect-backdrop"
      data-chrome-overlay=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <motion.div initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.995 }}
        transition={{ duration: reduceMotion ? 0 : 0.18, ease: 'easeOut' }} className="ca-connect-modal" role="dialog" aria-modal="true" aria-labelledby="ca-connect-title">
        <div className="ca-connect-head">
          <h2 id="ca-connect-title">Connect your agent</h2>
          <button type="button" className="ca-connect-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ca-connect-body">
          <nav className="ca-connect-agents" aria-label="Coding agents">
            {PICKER_AGENTS.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`ca-connect-agent${agentId === agent.id ? ' is-active' : ''}`}
                onClick={() => {
                  setLink(null)
                  setAgentId(agent.id)
                  setAdded(false)
                  setToast(null)
                }}
              >
                {agent.favicon ? <AgentFavicon src={agent.favicon} fallback={agent.faviconFallback} /> : <span aria-hidden>⌘</span>}
                <span>{agent.name}</span>
              </button>
            ))}
          </nav>
          <div className="ca-connect-steps">
            <div className="ca-connect-step">
              <span className="ca-connect-check" aria-hidden>
                ✓
              </span>
              <div>
                <strong>Scobe is running</strong>
                <p>Desktop is open and the local MCP server is available.</p>
              </div>
            </div>

            <div className="ca-connect-step">
              <span className={`ca-connect-num${added ? ' is-done' : ''}`}>{added ? '✓' : '2'}</span>
              <div className="ca-connect-step-main">
                <strong>Connect to {meta.name}</strong>
                <div className="ca-connect-add-row" style={manualAgent ? { display: 'none' } : undefined}>
                  <span>
                    {agentId === 'cursor'
                      ? 'Starts a public tunnel and registers Scobe so it can show under Connectors / MCP.'
                      : localAgent ? 'Configure the bundled MCP server. No separate download needed.' : `Add Scobe MCP for ${meta.name}.`}
                  </span>
                  <button type="button" className="ca-connect-add-btn" disabled={busy} onClick={() => void onAdd()}>
                    {busy ? 'Connecting…' : (added || (localAgent && ready)) ? 'Configured' : addLabel}
                  </button>
                </div>
                {manualAgent && <div className="ca-connect-manual">
                  <p>Add Scobe in your agent’s MCP settings as a local Streamable HTTP server.</p>
                  <div className="ca-connect-command"><code>{link?.localUrl || 'Loading…'}</code><button type="button" disabled={!link?.localUrl} onClick={async () => {
                    try { await navigator.clipboard.writeText(link!.localUrl!); setToast('Server URL copied') }
                    catch { setToast('Could not copy URL') }
                  }}>Copy URL</button></div>
                  <p>Name the server Scobe and keep Scobe open. Follow your agent’s MCP configuration format. This does not configure it automatically.</p>
                </div>}
                {localCodex && <div className="ca-connect-manual">
                  <p>Or add manually with the Codex CLI:</p>
                  <div className="ca-connect-command"><code>{link?.setupSnippet || 'Loading…'}</code>
                    <button type="button" disabled={!link?.setupSnippet} onClick={async () => {
                      try { await navigator.clipboard.writeText(link!.setupSnippet!); setToast('Command copied') }
                      catch { setToast('Could not copy. Select the command and copy manually.') }
                    }}>Copy command</button></div>
                  <p>Keep Scobe open. Restart Codex after setup and use a local chat. Cloud tasks cannot use this local connection.</p>
                  <button type="button" onClick={async () => {
                    try { setLink(await window.vanta.getAgentMcpLink(backendAgent)) }
                    catch { setToast('Could not check configuration') }
                  }}>Check configuration</button>
                </div>}
                {antigravity && <div className="ca-connect-manual">
                  <p>
                    Writes Scobe into Antigravity’s MCP config
                    {link?.detail ? <> (<code>{link.detail.replace(/^.*[\\/]\.gemini[\\/]/, '~/.gemini/')}</code>)</> : null}.
                    Then in Antigravity open … → MCP Servers → Manage MCP Servers and press Refresh.
                  </p>
                  <p>Or paste this into View raw config yourself:</p>
                  <div className="ca-connect-command"><code>{link?.setupSnippet || 'Loading…'}</code>
                    <button type="button" disabled={!link?.setupSnippet} onClick={async () => {
                      try { await navigator.clipboard.writeText(link!.setupSnippet!); setToast('Config copied') }
                      catch { setToast('Could not copy. Select the config and copy manually.') }
                    }}>Copy config</button></div>
                  <p><strong>Stop the approval prompts.</strong> Antigravity asks before every MCP tool call unless a rule allows it. Scobe adds this rule for the Antigravity CLI. In the Antigravity app, add it once under Settings → General → Global Permissions → Allow:</p>
                  <div className="ca-connect-command"><code>{link?.allowRule || 'mcp(scobe/*)'}</code>
                    <button type="button" onClick={async () => {
                      try { await navigator.clipboard.writeText(link?.allowRule || 'mcp(scobe/*)'); setToast('Rule copied') }
                      catch { setToast('Could not copy the rule') }
                    }}>Copy rule</button></div>
                  <p>Keep Scobe open while Antigravity uses it.</p>
                  <button type="button" onClick={async () => {
                    try { setLink(await window.vanta.getAgentMcpLink(backendAgent)) }
                    catch { setToast('Could not check configuration') }
                  }}>Check configuration</button>
                </div>}
                {!manualAgent && link?.publicUrl && (
                  <p className="ca-connect-hint">
                    Live tunnel: <code>{link.publicUrl}</code>
                    {link.tunnelOk === false ? ' (waiting for tunnel…)' : ''}
                  </p>
                )}
                {!link?.publicUrl && added && (
                  <p className="ca-connect-hint">Tunnel failed — click Connect again.</p>
                )}
              </div>
            </div>

            <div className="ca-connect-step">
              <span className="ca-connect-num">3</span>
              <div className="ca-connect-step-main">
                <strong>Run your first prompt</strong>
                <p>
                  {agentId === 'cursor'
                    ? 'Enable Scobe in your agent, then paste a prompt:'
                    : `After enabling Scobe MCP, run one of these in ${meta.name}:`}
                </p>
                <div className="ca-connect-prompts">
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="ca-connect-prompt"
                      onClick={() => void copyPrompt(prompt)}
                    >
                      <span className="ca-connect-prompt-copy" aria-hidden>
                        {copiedPrompt === prompt ? '✓' : '⧉'}
                      </span>
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="ca-connect-foot">
          <span className="ca-connect-learn">
            {localAgent ? `Keep Scobe open while using ${meta.name}.` : 'Connect Scobe to your preferred agent.'}
          </span>
          <button
            type="button"
            className="ca-connect-done"
            disabled={!ready || busy}
            onClick={() => void finish()}
          >
            Done
          </button>
        </div>
      </motion.div>
      {toast && (
        <div className="ca-connect-toast" role="status">
          <strong>{toast}</strong>
          <span>
            {agentId === 'cursor'
              ? 'Next: Install page → then enable vanta under Connectors / MCP'
              : antigravity
                ? 'Next: Antigravity → MCP Servers → Refresh, then start a new chat'
                : 'Confirm in the agent, then continue'}
          </span>
        </div>
      )}
    </motion.div>}
    </AnimatePresence>, document.body
  )
}
