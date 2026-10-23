import { useState } from 'react'
import { CloseRoundedIcon, KeyboardOutlinedIcon, LockOpenOutlinedIcon, LockOutlinedIcon, MicNoneOutlinedIcon, NearMeOutlinedIcon, StopRoundedIcon, UndoRoundedIcon } from './lucideIcons'
import type { JevDecision } from './jevEngine'
import type { VoiceState } from './useVoiceCapture'
import type { TranscriberStatus } from '../shared/jev'

const STATUS_LABEL: Record<JevDecision['status'], string> = {
  deciding: 'Deciding',
  applied: 'Applied',
  'needs-choice': 'Deciding',
  noop: 'Skipped',
  error: 'Not applied',
  undone: 'Undone'
}

export function JevDecisionCard({
  decision,
  index,
  current = false,
  onUndo
}: {
  decision: JevDecision
  index?: number
  current?: boolean
  onUndo?: () => void
}) {
  return (
    <div className={`jev-card is-${decision.status}${current ? ' is-current' : ''}`}>
      <div className="jev-card-head">
        <span className="jev-card-kicker">
          {current || decision.status === 'deciding'
            ? 'Current request'
            : `Request${index != null ? ` #${index}` : ''}`}
        </span>
        <span className={`jev-status is-${decision.status === 'needs-choice' ? 'deciding' : decision.status}`}>
          {STATUS_LABEL[decision.status]}
        </span>
      </div>
      <div className="jev-card-request">{decision.request}</div>
      {decision.pointerLabel ? (
        <div className="jev-card-pointer">
          <span>Pointer target</span>
          {decision.pointerLabel}
        </div>
      ) : null}
      <ol className="jev-steps">
        {decision.steps.map((step, i) => (
          <li key={step.key} className={`jev-step is-${step.state}`}>
            <span className="jev-step-num">{String(i + 1).padStart(2, '0')}</span>
            <div className="jev-step-body">
              <div className="jev-step-top">
                <span>{step.label}</span>
                <span>{step.tag}</span>
              </div>
              <div className="jev-step-title">{step.title}</div>
              {step.detail ? <div className="jev-step-detail">{step.detail}</div> : null}
            </div>
          </li>
        ))}
      </ol>
      {decision.error ? <div className="jev-error">{decision.error}</div> : null}
      {decision.meta || (decision.status === 'applied' && onUndo) ? (
        <div className="jev-card-foot">
          {decision.meta ? (
            <span>
              {decision.meta.latencyMs} ms · {decision.meta.questions} questions · {decision.meta.model}
            </span>
          ) : (
            <span />
          )}
          {decision.status === 'applied' && onUndo ? (
            <button type="button" className="jev-undo" onClick={onUndo}>
              <UndoRoundedIcon sx={{ fontSize: 14 }} />
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Right-sidebar Decisions log — live while you type/speak, history after Apply. */
export function JevDecisionsPanel({
  decisions,
  currentId,
  onUndo
}: {
  decisions: JevDecision[]
  currentId: string | null
  onUndo: (id: string) => void
}) {
  const current = decisions.find((item) => item.id === currentId) || decisions.find((item) => item.status === 'deciding')
  const history = decisions.filter((item) => item.id !== current?.id && item.status !== 'deciding')
  let appliedIndex = history.filter((item) => item.status === 'applied').length

  return (
    <div className="jev-decisions">
      <div className="jev-decisions-head">
        <div>
          <strong>Decisions</strong>
          <span className="jev-live">
            <i /> Live
          </span>
        </div>
        <span className="jev-decisions-hint">Follow latest request</span>
      </div>
      <div className="jev-decisions-body">
        {current ? (
          <JevDecisionCard decision={current} current onUndo={() => onUndo(current.id)} />
        ) : (
          <div className="jev-decisions-empty">
            Point at an element and type. Changes appear live — send to verify.
          </div>
        )}
        {history.map((item) => {
          const index = item.status === 'applied' ? appliedIndex-- : undefined
          return <JevDecisionCard key={item.id} decision={item} index={index} onUndo={() => onUndo(item.id)} />
        })}
      </div>
    </div>
  )
}

const VOICE_LABEL: Record<VoiceState, string> = {
  off: 'Mic off',
  starting: 'Starting mic',
  listening: 'Listening',
  hearing: 'Hearing you',
  transcribing: 'Transcribing',
  error: 'Mic error'
}

export function JevVoiceStrip({
  pointerLabel,
  locked,
  voiceState,
  level,
  voiceError,
  model,
  configured,
  onToggleLock,
  onClearTarget,
  onMic,
  onSaveKey,
  onClose
}: {
  pointerLabel: string | null
  locked: boolean
  voiceState: VoiceState
  level: number
  voiceError: string | null
  model: TranscriberStatus | null
  configured: boolean
  onToggleLock: () => void
  onClearTarget: () => void
  onMic: () => void
  onSaveKey: (key: string) => void
  onClose: () => void
}) {
  const [key, setKey] = useState('')
  const micOn = voiceState !== 'off' && voiceState !== 'error'
  const status =
    voiceState === 'starting' || (micOn && model?.state === 'loading')
      ? 'Loading Whisper'
      : voiceError && voiceState === 'error'
        ? voiceError
        : VOICE_LABEL[voiceState]
  const bars = [0.35, 0.7, 1, 0.6, 0.85, 0.45, 0.75]

  if (!configured) {
    return (
      <div className="jev-strip" data-chrome-overlay="">
        <form
          className="jev-strip-key"
          onSubmit={(event) => {
            event.preventDefault()
            if (key.trim()) onSaveKey(key.trim())
          }}
        >
          <span>Jev needs an API key</span>
          <input
            type="password"
            placeholder="TypeSafe or jv_live_ key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <button type="submit" disabled={!key.trim()}>
            Save
          </button>
          <button type="button" className="jev-strip-x" title="Turn off Jev" onClick={onClose}>
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="jev-strip" data-chrome-overlay="">
      <div className={`jev-strip-target${pointerLabel ? ' has-target' : ''}`}>
        <NearMeOutlinedIcon sx={{ fontSize: 14 }} />
        <span className="jev-strip-target-label">{pointerLabel || 'Point to an element on the canvas'}</span>
        {pointerLabel ? (
          <>
            <button type="button" onClick={onToggleLock} title={locked ? 'Follow the pointer' : 'Keep this target'}>
              {locked ? <LockOutlinedIcon sx={{ fontSize: 13 }} /> : <LockOpenOutlinedIcon sx={{ fontSize: 13 }} />}
              {locked ? 'Locked' : 'Lock target'}
            </button>
            <button type="button" className="jev-strip-x" title="Clear target" onClick={onClearTarget}>
              <CloseRoundedIcon sx={{ fontSize: 14 }} />
            </button>
          </>
        ) : (
          <button type="button" className="jev-strip-x" title="Turn off Jev" onClick={onClose}>
            <CloseRoundedIcon sx={{ fontSize: 14 }} />
          </button>
        )}
      </div>
      <div className="jev-strip-voice">
        <div className="jev-seg">
          <button type="button" className={micOn ? '' : 'is-on'} onClick={micOn ? onMic : undefined}>
            <KeyboardOutlinedIcon sx={{ fontSize: 14 }} />
            Typing
          </button>
          <button type="button" className={micOn ? 'is-on' : ''} onClick={micOn ? undefined : onMic}>
            <MicNoneOutlinedIcon sx={{ fontSize: 14 }} />
            Microphone
          </button>
        </div>
        <div className={`jev-meter is-${voiceState}`} title={status}>
          <span className="jev-meter-bars" aria-hidden>
            {bars.map((h, i) => (
              <i
                key={i}
                style={{ transform: `scaleY(${micOn ? Math.max(0.15, Math.min(1, level * 2.2 * h)) : 0.15})` }}
              />
            ))}
          </span>
          <span className="jev-meter-label">{status}</span>
        </div>
        {micOn ? (
          <button type="button" className="jev-stop" onClick={onMic}>
            <StopRoundedIcon sx={{ fontSize: 14 }} />
            Stop mic
          </button>
        ) : null}
      </div>
    </div>
  )
}
