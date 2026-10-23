import { useCallback, useEffect, useRef, useState } from 'react'
import type { DesignNode } from '../shared/types'
import type { JevAnswers } from '../shared/jev'
import {
  ACTION_LABELS,
  applyPlan,
  buildContext,
  buildQuestions,
  componentOf,
  describeNode,
  fastPlanFromRequest,
  isNoise,
  planFromAnswers,
  splitRequests,
  targetStep,
  type JevCanvas,
  type JevContext,
  type JevDecision,
  type JevPlan,
  type JevStep
} from './jevEngine'
import { useVoiceCapture } from './useVoiceCapture'

const STORAGE_KEY = 'vanta.jev.on'
/** Only used when the transcript isn’t an obvious local edit — keep tiny. */
const JEV_DEBOUNCE_MS = 70

type Meta = NonNullable<JevDecision['meta']>
type Ready = { request: string; ctx: JevContext; answers: JevAnswers; meta: Meta }

function cloneNodes(nodes: DesignNode[]): DesignNode[] {
  return structuredClone(nodes)
}

function decidingSteps(ctx: JevContext): JevStep[] {
  return [
    { key: 'read', label: 'Read request', tag: 'Your words', title: 'Request received', state: 'done' },
    {
      key: 'context',
      label: 'Canvas context',
      tag: 'Canvas',
      title: ctx.contextTitle,
      detail: ctx.contextDetail,
      state: 'done'
    },
    {
      key: 'decide',
      label: 'Choose action and target',
      tag: 'Jev',
      title: 'Evaluating this request…',
      detail: 'The action, target, and changes are resolved together in one evaluation.',
      state: 'active'
    },
    { key: 'apply', label: 'Live preview', tag: '', title: 'Updating the canvas…', state: 'pending' }
  ]
}

function plannedSteps(
  plan: ReturnType<typeof planFromAnswers>,
  ctx: JevContext,
  nodes: DesignNode[],
  mode: 'preview' | 'apply'
): JevStep[] {
  const read: JevStep = {
    key: 'read',
    label: 'Read request',
    tag: 'Mode',
    title: plan.action === 'none' ? 'Not a design instruction' : 'Design instruction',
    state: 'done'
  }
  const context: JevStep = {
    key: 'context',
    label: 'Canvas context',
    tag: 'Canvas',
    title: ctx.contextTitle,
    detail: ctx.contextDetail,
    state: 'done'
  }
  const decide: JevStep = {
    key: 'decide',
    label: 'Choose action and target',
    tag: 'Jev',
    title: ACTION_LABELS[plan.action],
    detail: 'Keep the current design and apply this request to it.',
    state: 'done'
  }
  if (plan.action === 'none') return [read, context, decide]
  const target = targetStep(plan, ctx, nodes)
  return [
    read,
    context,
    decide,
    target,
    {
      key: 'apply',
      label: mode === 'preview' ? 'Live preview' : 'Verify & commit',
      tag: mode === 'preview' ? 'Live' : 'Send',
      title:
        mode === 'preview'
          ? 'On canvas now — keep typing or send to verify'
          : 'Re-checking this decision…',
      state: mode === 'preview' ? 'done' : 'active'
    }
  ]
}

/**
 * Point + type: live canvas apply from a frozen baseline.
 * Send: restore baseline, re-ask Jev, commit if still correct.
 */
export function useJev({
  getCanvas,
  persist,
  onOpenSidebar
}: {
  getCanvas: () => JevCanvas
  persist: (nodes: DesignNode[]) => void
  onOpenSidebar?: () => void
}) {
  const [on, setOnState] = useState(true)
  const [picking, setPickingState] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [pointerId, setPointerId] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [decisions, setDecisions] = useState<JevDecision[]>([])
  const [liveId, setLiveId] = useState<string | null>(null)
  const lastTargetId = useRef<string | null>(null)
  const pointerRef = useRef<string | null>(null)
  const lockedRef = useRef(false)
  const snapshots = useRef(new Map<string, DesignNode[]>())
  /** Canvas before the current live draft mutated it. */
  const baseline = useRef<DesignNode[] | null>(null)
  const ready = useRef<Ready | null>(null)
  const liveIdRef = useRef<string | null>(null)
  const liveRequestRef = useRef<string>('')
  const previewGen = useRef(0)
  const previewTimer = useRef(0)
  const applyQueue = useRef<Promise<void>>(Promise.resolve())
  const applying = useRef(false)
  const setDraftRef = useRef<(text: string) => void>(() => undefined)
  const deps = useRef({ getCanvas, persist, onOpenSidebar })
  deps.current = { getCanvas, persist, onOpenSidebar }

  useEffect(() => {
    void window.vanta.jevStatus().then((status) => setConfigured(status.configured))
  }, [])

  const setOn = useCallback((next: boolean) => {
    // Chat is always Jev — ignore attempts to turn it off.
    if (!next) return
    setOnState(true)
    localStorage.setItem(STORAGE_KEY, '1')
    deps.current.onOpenSidebar?.()
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, '1')
  }, [])

  const ensureBaseline = () => {
    if (!baseline.current) baseline.current = cloneNodes(deps.current.getCanvas().nodes)
  }

  const canvasFromBaseline = (): JevCanvas => {
    ensureBaseline()
    const snap = deps.current.getCanvas()
    return {
      ...snap,
      nodes: cloneNodes(baseline.current!),
      pointerId: pointerRef.current,
      lastTargetId: lastTargetId.current
    }
  }

  const upsert = useCallback((decision: JevDecision) => {
    setDecisions((current) => {
      const index = current.findIndex((item) => item.id === decision.id)
      if (index < 0) return [decision, ...current].slice(0, 40)
      const next = current.slice()
      next[index] = decision
      return next
    })
  }, [])

  const patch = useCallback((id: string, fn: (decision: JevDecision) => JevDecision) => {
    setDecisions((current) => current.map((item) => (item.id === id ? fn(item) : item)))
  }, [])

  const paintPlan = useCallback(
    (
      id: string,
      request: string,
      plan: JevPlan,
      mode: 'preview' | 'apply',
      meta?: Meta
    ): { ok: true; summary: string } | { ok: false; error?: string; noop?: boolean } => {
      const canvas = canvasFromBaseline()
      const liveCtx = buildContext(request, canvas)
      // Prefer live pointer as the plan target for edits.
      if ((plan.action === 'edit' || plan.action === 'remove') && liveCtx.pointer) {
        plan = { ...plan, target: liveCtx.pointer }
      }

      if (plan.action === 'none') {
        if (baseline.current) deps.current.persist(cloneNodes(baseline.current))
        patch(id, (d) => ({
          ...d,
          status: mode === 'apply' ? 'noop' : 'deciding',
          meta: meta || d.meta,
          pointerLabel: liveCtx.pointer?.label,
          steps: plannedSteps(plan, liveCtx, canvas.nodes, mode).map((step) =>
            step.key === 'apply' ? { ...step, title: 'Nothing to apply', state: 'done' } : step
          )
        }))
        return { ok: false, noop: true }
      }

      const result = applyPlan(plan, { ...liveCtx, request }, canvas)
      const steps = plannedSteps(plan, liveCtx, canvas.nodes, mode)
      if ('error' in result) {
        if (baseline.current) deps.current.persist(cloneNodes(baseline.current))
        patch(id, (d) => ({
          ...d,
          status: mode === 'apply' ? 'error' : 'deciding',
          meta: meta || d.meta,
          error: result.error,
          pointerLabel: liveCtx.pointer?.label,
          steps: steps.filter((step) => step.key !== 'apply')
        }))
        return { ok: false, error: result.error }
      }

      deps.current.persist(result.nodes)
      lastTargetId.current = result.touchedId

      if (mode === 'preview') {
        patch(id, (d) => ({
          ...d,
          status: 'deciding',
          meta: meta || d.meta,
          error: undefined,
          pointerLabel: liveCtx.pointer?.label,
          result: result.summary,
          steps: [
            ...steps.filter((step) => step.key !== 'apply'),
            {
              key: 'apply',
              label: 'Live preview',
              tag: 'Live',
              title: result.summary,
              detail: 'On canvas now — send to verify',
              state: 'done'
            }
          ]
        }))
        return { ok: true, summary: result.summary }
      }

      snapshots.current.set(id, cloneNodes(baseline.current || canvas.nodes))
      baseline.current = null
      ready.current = null
      patch(id, (d) => ({
        ...d,
        status: 'applied',
        meta: meta || d.meta,
        error: undefined,
        pointerLabel: liveCtx.pointer?.label,
        result: result.summary,
        steps: [
          ...steps.filter((step) => step.key !== 'apply'),
          {
            key: 'verify',
            label: 'Verified',
            tag: 'Send',
            title: result.summary,
            detail: 'Re-checked on send and committed.',
            state: 'done'
          }
        ]
      }))
      return { ok: true, summary: result.summary }
    },
    [patch]
  )

  const ensureLiveCard = (trimmed: string, ctx: JevContext) => {
    let id = liveIdRef.current
    if (!id) {
      id = crypto.randomUUID()
      liveIdRef.current = id
      setLiveId(id)
    }
    liveRequestRef.current = trimmed
    setDecisions((current) => {
      const prev = current.find((item) => item.id === id)
      if (prev && prev.status === 'deciding' && prev.request === trimmed) {
        if (prev.pointerLabel === ctx.pointer?.label) return current
        return current.map((item) => (item.id === id ? { ...item, pointerLabel: ctx.pointer?.label } : item))
      }
      const shell: JevDecision = prev
        ? { ...prev, request: trimmed, status: 'deciding', pointerLabel: ctx.pointer?.label, error: undefined }
        : {
            id: id!,
            request: trimmed,
            status: 'deciding',
            pointerLabel: ctx.pointer?.label,
            steps: decidingSteps(ctx)
          }
      if (!prev) return [shell, ...current].slice(0, 40)
      return current.map((item) => (item.id === id ? shell : item))
    })
    return id
  }

  /** Instant canvas paint — no network. */
  const paintFast = useCallback(
    (trimmed: string): boolean => {
      ensureBaseline()
      const canvas = canvasFromBaseline()
      const ctx = buildContext(trimmed, canvas)
      const plan = fastPlanFromRequest(trimmed, ctx)
      if (!plan) return false
      const id = ensureLiveCard(trimmed, ctx)
      paintPlan(id, trimmed, plan, 'preview')
      return true
    },
    [paintPlan]
  )

  const evaluate = useCallback(
    async (request: string, mode: 'preview' | 'apply') => {
      const trimmed = request.trim()
      if (!trimmed || isNoise(trimmed)) return
      const gen = ++previewGen.current

      ensureBaseline()
      const canvas = canvasFromBaseline()
      const ctx = buildContext(trimmed, canvas)
      const questions = buildQuestions(ctx)
      const decisionId =
        mode === 'apply'
          ? (() => {
              let id = liveIdRef.current
              if (!id) {
                id = crypto.randomUUID()
                liveIdRef.current = id
                setLiveId(id)
              }
              liveRequestRef.current = trimmed
              upsert({
                id,
                request: trimmed,
                status: 'deciding',
                pointerLabel: ctx.pointer?.label,
                steps: decidingSteps(ctx)
              })
              deps.current.onOpenSidebar?.()
              return id
            })()
          : ensureLiveCard(trimmed, ctx)

      try {
        // Send always re-asks. Preview only asks when local fast-path can't handle it
        // (or when refining after a short debounce).
        if (mode === 'preview') {
          const local = fastPlanFromRequest(trimmed, ctx)
          if (local) {
            paintPlan(decisionId, trimmed, local, 'preview')
            return
          }
        }

        const res = await window.vanta.jevAsk(ctx.state, questions)
        if (gen !== previewGen.current && mode === 'preview') return
        const readySource: Ready = {
          request: trimmed,
          ctx,
          answers: res.answers,
          meta: { latencyMs: res.latencyMs, questions: Object.keys(questions).length, model: res.model }
        }
        ready.current = readySource
        const plan = planFromAnswers(buildContext(trimmed, canvasFromBaseline()), readySource.answers)
        paintPlan(decisionId, trimmed, plan, mode, readySource.meta)
        if (mode === 'apply') {
          liveIdRef.current = null
          liveRequestRef.current = ''
          setLiveId(null)
        }
      } catch (error) {
        if (gen !== previewGen.current && mode === 'preview') return
        if (baseline.current) deps.current.persist(cloneNodes(baseline.current))
        const message =
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            : String(error)
        if (/key missing|401/i.test(message)) setConfigured(false)
        patch(decisionId, (d) => ({
          ...d,
          status: mode === 'apply' ? 'error' : 'deciding',
          error: message,
          steps: d.steps.map((step) =>
            step.state === 'active' ? { ...step, title: 'Jev request failed', state: 'done' } : step
          )
        }))
      }
    },
    [paintPlan, patch, upsert]
  )

  const clearLiveDraft = useCallback(() => {
    previewGen.current += 1
    ready.current = null
    liveRequestRef.current = ''
    if (baseline.current) {
      deps.current.persist(cloneNodes(baseline.current))
      baseline.current = null
    }
    if (liveIdRef.current) {
      const id = liveIdRef.current
      liveIdRef.current = null
      setLiveId(null)
      setDecisions((current) => current.filter((item) => item.id !== id || item.status === 'applied'))
    }
  }, [])

  const preview = useCallback(
    (text: string) => {
      if (!on || applying.current) return
      window.clearTimeout(previewTimer.current)
      const trimmed = text.trim()
      if (!trimmed) {
        clearLiveDraft()
        return
      }
      liveRequestRef.current = trimmed
      // Paint immediately when the edit is locally obvious (size/color/text/…).
      const painted = paintFast(trimmed)
      // Only hit Jev when we couldn't do it locally — tiny debounce.
      if (!painted) {
        previewTimer.current = window.setTimeout(() => {
          void evaluate(trimmed, 'preview')
        }, JEV_DEBOUNCE_MS)
      }
    },
    [clearLiveDraft, evaluate, on, paintFast]
  )

  /** Send: re-ask Jev from baseline and commit. */
  const apply = useCallback(
    (text: string) => {
      const parts = splitRequests(text)
      if (!parts.length) {
        clearLiveDraft()
        return
      }
      window.clearTimeout(previewTimer.current)
      applying.current = true
      previewGen.current += 1
      ready.current = null
      for (const part of parts) {
        applyQueue.current = applyQueue.current.then(() => evaluate(part, 'apply'))
      }
      applyQueue.current = applyQueue.current.finally(() => {
        applying.current = false
      })
    },
    [clearLiveDraft, evaluate]
  )

  const undo = useCallback(
    (id: string) => {
      const before = snapshots.current.get(id)
      if (!before) return
      snapshots.current.delete(id)
      deps.current.persist(before)
      patch(id, (d) => ({ ...d, status: 'undone' }))
    },
    [patch]
  )

  const notePointer = useCallback(
    (nodeId: string | null) => {
      if (!picking) return
      if (lockedRef.current) return
      let next = nodeId
      if (nodeId) {
        const nodes = deps.current.getCanvas().nodes
        const byId = new Map(nodes.map((node) => [node.id, node]))
        const node = byId.get(nodeId)
        next = node ? componentOf(node, byId).id : null
      }
      if (next === pointerRef.current) return
      pointerRef.current = next
      setPointerId(next)
      const draft = liveRequestRef.current.trim()
      if (on && draft && !applying.current) {
        ready.current = null
        window.clearTimeout(previewTimer.current)
        if (!paintFast(draft)) {
          previewTimer.current = window.setTimeout(() => {
            void evaluate(draft, 'preview')
          }, JEV_DEBOUNCE_MS)
        }
      }
    },
    [evaluate, on, paintFast, picking]
  )

  const toggleLock = useCallback(() => {
    lockedRef.current = !lockedRef.current
    setLocked(lockedRef.current)
  }, [])

  const clearTarget = useCallback(() => {
    lockedRef.current = false
    setLocked(false)
    pointerRef.current = null
    setPointerId(null)
    const draft = liveRequestRef.current.trim()
    if (on && draft && !applying.current) {
      ready.current = null
      window.clearTimeout(previewTimer.current)
      if (!paintFast(draft)) {
        previewTimer.current = window.setTimeout(() => {
          void evaluate(draft, 'preview')
        }, JEV_DEBOUNCE_MS)
      }
    }
  }, [evaluate, on, paintFast])

  const setPicking = useCallback((next: boolean) => {
    setPickingState(next)
    if (!next) {
      lockedRef.current = false
      setLocked(false)
      // Keep pointer if canvas selection still owns a target.
      const selected = deps.current.getCanvas().selectedIds
      if (selected.length) {
        const nodes = deps.current.getCanvas().nodes
        const byId = new Map(nodes.map((node) => [node.id, node]))
        const node = byId.get(selected[selected.length - 1])
        const nextId = node ? componentOf(node, byId).id : null
        pointerRef.current = nextId
        setPointerId(nextId)
      } else {
        pointerRef.current = null
        setPointerId(null)
      }
    } else {
      deps.current.onOpenSidebar?.()
    }
  }, [])

  const togglePicking = useCallback(() => {
    setPicking(!picking)
  }, [picking, setPicking])

  /** Keep Jev's target in sync with canvas selection (any select / multi-select / edit). */
  const syncSelection = useCallback((ids: string[]) => {
    if (picking && !lockedRef.current) {
      // While freely hovering in pick mode, don't override live hover.
      if (!ids.length) return
    }
    if (!ids.length) {
      if (!picking) {
        pointerRef.current = null
        setPointerId(null)
        lockedRef.current = false
        setLocked(false)
      }
      return
    }
    const nodes = deps.current.getCanvas().nodes
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const node = byId.get(ids[ids.length - 1])
    const next = node ? componentOf(node, byId).id : null
    if (next === pointerRef.current && lockedRef.current) return
    pointerRef.current = next
    setPointerId(next)
    lockedRef.current = true
    setLocked(true)
    const draft = liveRequestRef.current.trim()
    if (on && draft && !applying.current) {
      ready.current = null
      window.clearTimeout(previewTimer.current)
      if (!paintFast(draft)) {
        previewTimer.current = window.setTimeout(() => {
          void evaluate(draft, 'preview')
        }, JEV_DEBOUNCE_MS)
      }
    }
  }, [evaluate, on, paintFast, picking])

  const saveKey = useCallback(async (key: string) => {
    const status = await window.vanta.jevSetKey(key)
    setConfigured(status.configured)
  }, [])

  const onPartialRef = useRef<(text: string) => void>(() => undefined)
  const onFinalRef = useRef<(text: string) => void>(() => undefined)

  const voice = useVoiceCapture(
    (text) => onFinalRef.current(text),
    (partial) => onPartialRef.current(partial)
  )

  const bindDraft = useCallback(
    (setDraft: (text: string) => void) => {
      setDraftRef.current = setDraft
      onPartialRef.current = (partial) => {
        setDraft(partial)
        preview(partial)
      }
      onFinalRef.current = (text) => {
        setDraft(text)
        apply(text)
        setDraft('')
      }
    },
    [apply, preview]
  )

  const bindVoiceHandlers = useCallback(
    (handlers: { onPartial: (text: string) => void; onFinal: (text: string) => void }) => {
      onPartialRef.current = handlers.onPartial
      onFinalRef.current = handlers.onFinal
    },
    []
  )

  const toggleMic = useCallback(() => {
    if (!on) setOn(true)
    if (voice.active) voice.stop()
    else void voice.start()
  }, [on, setOn, voice])

  const { active: micActive, stop: stopMic } = voice
  useEffect(() => {
    if (!on && micActive) stopMic()
  }, [on, micActive, stopMic])

  useEffect(
    () => () => {
      window.clearTimeout(previewTimer.current)
    },
    []
  )

  const pointerLabel = (() => {
    if (!pointerId) return null
    const nodes = getCanvas().nodes
    const node = nodes.find((item) => item.id === pointerId)
    return node ? describeNode(node, nodes) : null
  })()

  const current = decisions.find((item) => item.id === liveId) || decisions.find((item) => item.status === 'deciding') || null

  return {
    on,
    setOn,
    configured,
    saveKey,
    preview,
    apply,
    undo,
    bindDraft,
    bindVoiceHandlers,
    notePointer,
    pointerId,
    pointerLabel,
    locked,
    picking,
    setPicking,
    togglePicking,
    syncSelection,
    toggleLock,
    clearTarget,
    decisions,
    current,
    voice,
    toggleMic
  }
}
