import { useEffect, useState } from 'react'
import { CODING_AGENTS, VANTA_BUILD_PROMPT, type AgentMcpLinkStatus, type CodingAgentId } from '../shared/codingAgents'

const EXAMPLE_PROMPTS = [
  'Create a basic Hello World frame in Vanta',
  'Build a simple landing page hero on the Vanta design canvas',
  'Create a mobile app settings screen with auto-layout in Vanta'
] as const

function AgentFavicon({
  src,
  fallback,
  size = 22
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
  initialAgentId = 'cursor',
  onClose,
  onDone
}: {
  open: boolean
  initialAgentId?: CodingAgentId
  onClose: () => void
  /** Called when user finishes setup — unlocks the coding agent browser. */
  onDone: (agentId: CodingAgentId, openUrl?: string) => void
}) {
  const [agentId, setAgentId] = useState<CodingAgentId>(initialAgentId)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [link, setLink] = useState<AgentMcpLinkStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null)

  const meta = CODING_AGENTS.find((item) => item.id === agentId) || CODING_AGENTS[0]
  const ready = Boolean(link?.publicUrl && (link.tunnelOk !== false || added))

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
    void window.vanta.getAgentMcpLink?.(agentId).then((status) => {
      if (!cancelled) setLink(status)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, agentId])

  if (!open) return null

  const onAdd = async () => {
    if (busy || typeof window.vanta.connectAgentMcp !== 'function') return
    setBusy(true)
    setToast(null)
    try {
      const status = await window.vanta.connectAgentMcp(agentId)
      setLink(status)
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
          ? `Vanta MCP live — ${meta.name}`
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
    const full = `${VANTA_BUILD_PROMPT}\n\nTask: ${text}`
    try {
      await navigator.clipboard.writeText(full)
      setCopiedPrompt(text)
      window.setTimeout(() => setCopiedPrompt(null), 1400)
    } catch {
      /* ignore */
    }
  }

  const finish = async () => {
    if (!ready && !link?.publicUrl) return
    if (typeof window.vanta.confirmCloudAgentMcp === 'function') {
      try {
        await window.vanta.confirmCloudAgentMcp(agentId)
      } catch {
        /* ignore */
      }
    }
    // Cursor: open install-mcp so Vanta is registered under Connectors / MCP.
    onDone(agentId, link?.openUrl || link?.installUrl || undefined)
  }

  const addLabel =
    agentId === 'claude-code'
      ? 'Add Vanta to Claude Code'
      : agentId === 'cursor'
        ? 'Add Vanta to Cursor'
        : agentId === 'codex'
          ? 'Add Vanta to Codex'
          : 'Add Vanta to v0'

  return (
    <div
      className="ca-connect-backdrop"
      data-chrome-overlay=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ca-connect-modal" role="dialog" aria-modal="true" aria-labelledby="ca-connect-title">
        <div className="ca-connect-head">
          <h2 id="ca-connect-title">Connect your agent</h2>
          <button type="button" className="ca-connect-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ca-connect-body">
          <nav className="ca-connect-agents" aria-label="Coding agents">
            {CODING_AGENTS.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`ca-connect-agent${agentId === agent.id ? ' is-active' : ''}`}
                onClick={() => {
                  setAgentId(agent.id)
                  setAdded(false)
                  setToast(null)
                }}
              >
                <AgentFavicon src={agent.favicon} fallback={agent.faviconFallback} />
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
                <strong>Vanta is running</strong>
                <p>Desktop is open and the local MCP server is available.</p>
              </div>
            </div>

            <div className="ca-connect-step">
              <span className={`ca-connect-num${added ? ' is-done' : ''}`}>{added ? '✓' : '2'}</span>
              <div className="ca-connect-step-main">
                <strong>Connect to {meta.name}</strong>
                <div className="ca-connect-add-row">
                  <span>
                    {agentId === 'cursor'
                      ? 'Starts a public tunnel and registers Vanta so it can show under Connectors / MCP.'
                      : `Add Vanta MCP for ${meta.name}.`}
                  </span>
                  <button type="button" className="ca-connect-add-btn" disabled={busy} onClick={() => void onAdd()}>
                    {busy ? 'Connecting…' : added ? 'Connected' : addLabel}
                  </button>
                </div>
                {link?.publicUrl && (
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
                    ? 'Done opens Cursor’s Install MCP page, then Agents. Enable vanta under Connectors / MCP and paste a prompt:'
                    : `After enabling Vanta MCP, run one of these in ${meta.name}:`}
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
            {agentId === 'cursor' ? 'Done → Install MCP → Open Agents (enable vanta)' : 'Set up MCP before using the agent sidebar'}
          </span>
          <button
            type="button"
            className="ca-connect-done"
            disabled={!link?.publicUrl || busy}
            onClick={() => void finish()}
          >
            Done
          </button>
        </div>
      </div>
      {toast && (
        <div className="ca-connect-toast" role="status">
          <strong>{toast}</strong>
          <span>
            {agentId === 'cursor'
              ? 'Next: Install page → then enable vanta under Connectors / MCP'
              : 'Confirm in the agent, then continue'}
          </span>
        </div>
      )}
    </div>
  )
}
