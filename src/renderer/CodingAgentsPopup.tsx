import { useEffect, useMemo, useState } from 'react'
import { CODING_AGENTS, getCodingAgentMeta, type CodingAgentBinding, type CodingAgentId } from '../shared/codingAgents'

function AgentFavicon({
  src,
  fallback,
  title,
  size = 28
}: {
  src: string
  fallback: string
  title: string
  size?: number
}) {
  return (
    <img
      className="ca-favicon"
      src={src}
      alt=""
      title={title}
      width={size}
      height={size}
      onError={(event) => {
        event.currentTarget.src = fallback
      }}
    />
  )
}

export function CodingAgentsPopup({
  open,
  recents,
  activeId,
  busy,
  onClose,
  onResume,
  onChoose
}: {
  open: boolean
  recents: CodingAgentBinding[]
  activeId: string | null
  busy?: boolean
  onClose: () => void
  onResume: (id: string) => void
  onChoose: (agentId: CodingAgentId) => void
}) {
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const orderedRecents = useMemo(
    () => [...recents].sort((a, b) => b.lastUsed - a.lastUsed),
    [recents]
  )

  useEffect(() => {
    if (open) setAgentPickerOpen(false)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (agentPickerOpen) setAgentPickerOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, agentPickerOpen, onClose])

  if (!open) return null

  return (
    <div
      className="ca-popup-backdrop"
      data-chrome-overlay=""
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="ca-popup-stage" data-chrome-overlay="">
        <div className="ca-popup" role="dialog" aria-modal="true" aria-labelledby="ca-popup-title" data-chrome-overlay="">
          <div className="ca-popup-title-row">
            <h2 id="ca-popup-title">Recents</h2>
            <button type="button" className="ca-popup-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>

          <div className="ca-recent-list" aria-label="Recent coding projects">
            {orderedRecents.length > 0 ? (
              orderedRecents.map((item) => {
                const meta = getCodingAgentMeta(item.agentId)
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`ca-menu-item ca-recent-item${activeId === item.id ? ' active' : ''}`}
                    onClick={() => onResume(item.id)}
                    disabled={busy}
                  >
                    <AgentFavicon src={meta.favicon} fallback={meta.faviconFallback} title={meta.name} size={26} />
                    <span className="ca-recent-label">
                      <strong>{item.projectName}</strong>
                      <span>, {meta.name}</span>
                    </span>
                    <span className="ca-menu-arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                )
              })
            ) : (
              <p className="ca-empty-recents">Your recently opened coding agents will appear here.</p>
            )}
          </div>

          <div className="ca-menu-divider" />

          <button
            type="button"
            className={`ca-menu-item ca-new-project${agentPickerOpen ? ' active' : ''}`}
            onClick={() => setAgentPickerOpen((value) => !value)}
            aria-expanded={agentPickerOpen}
            aria-controls="ca-agent-picker"
          >
            <span className="ca-favicon-stack" aria-hidden="true">
              {CODING_AGENTS.map((agent) => (
                <AgentFavicon
                  key={agent.id}
                  src={agent.favicon}
                  fallback={agent.faviconFallback}
                  title=""
                  size={25}
                />
              ))}
            </span>
            <span>New project</span>
            <span className="ca-menu-arrow" aria-hidden="true">
              ›
            </span>
          </button>
        </div>

        {agentPickerOpen ? (
          <div
            id="ca-agent-picker"
            className="ca-agent-picker"
            role="menu"
            aria-label="Choose a coding agent"
            data-chrome-overlay=""
          >
            <div className="ca-agent-picker-title">Coding agent</div>
            {CODING_AGENTS.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="menuitem"
                className="ca-agent-choice"
                onClick={() => onChoose(agent.id)}
                disabled={busy}
              >
                <AgentFavicon src={agent.favicon} fallback={agent.faviconFallback} title={agent.name} size={28} />
                <span>{agent.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
