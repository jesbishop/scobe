import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriberStatus } from '../shared/jev'

export type VoiceState = 'off' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'error'

const SAMPLE_RATE = 16000
const FRAME = 4096
/** Silence after speech that ends an utterance ("pause to apply"). */
const END_SILENCE_MS = 900
const MIN_SPEECH_MS = 240
const MAX_UTTERANCE_MS = 20000
const PRE_ROLL_FRAMES = 3
/** How often to refresh the composer while Whisper is the only listener. */
const PARTIAL_EVERY_MS = 450
const MIN_PARTIAL_MS = 280
/** Windows sometimes never finalizes a phrase; a pause this long commits what was heard. */
const DICTATION_PAUSE_MS = 1200

type SpeechRec = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecEvent = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function speechCtor(): (new () => SpeechRec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

function micError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Microphone is blocked. In Windows Settings, allow desktop apps to use the microphone, then try again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone found.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is in use by another app.'
  return err instanceof Error ? err.message : 'Microphone unavailable'
}

/** Whisper expects 16 kHz. The audio device usually runs at 44.1 or 48 kHz. */
function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const t = x - i0
    out[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return out
}

function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Mic → live interim text (Chrome SpeechRecognition when available) + local Whisper on pause.
 * onPartial updates the draft / Decisions as you speak; onText fires once per utterance to apply.
 */
export function useVoiceCapture(onText: (text: string) => void, onPartial?: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('off')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<TranscriberStatus | null>(null)
  const onTextRef = useRef(onText)
  const onPartialRef = useRef(onPartial)
  onTextRef.current = onText
  onPartialRef.current = onPartial
  const session = useRef<{
    stream: MediaStream
    ctx: AudioContext
    proc: ScriptProcessorNode
    speech: SpeechRec | null
  } | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const interim = useRef('')
  const runId = useRef(0)
  const dictationReady = useRef(false)
  const pauseTimer = useRef(0)
  /** A phrase has partial words that haven't been applied yet. */
  const phraseOpen = useRef(false)
  const committedByPause = useRef(false)

  useEffect(() => {
    void window.vanta.transcriberStatus().then(setModel)
    const offStatus = window.vanta.onTranscriber(setModel)
    const commit = (text: string) => {
      window.clearTimeout(pauseTimer.current)
      phraseOpen.current = false
      interim.current = ''
      const heard = text.trim()
      if (heard) onTextRef.current(heard)
      setState(dictationReady.current ? 'listening' : 'off')
    }
    const offDictation = window.vanta.onDictation((event) => {
      if (!dictationReady.current) return
      if (event.type === 'partial') {
        interim.current = event.text
        phraseOpen.current = true
        committedByPause.current = false
        setError(null)
        setState('hearing')
        onPartialRef.current?.(event.text)
        window.clearTimeout(pauseTimer.current)
        pauseTimer.current = window.setTimeout(() => {
          if (!phraseOpen.current) return
          committedByPause.current = true
          commit(interim.current)
        }, DICTATION_PAUSE_MS)
        return
      }
      if (event.type === 'final') {
        // The pause timer already applied this phrase; a late final would apply it twice.
        if (committedByPause.current) {
          committedByPause.current = false
          return
        }
        setError(null)
        commit(event.text || interim.current)
        return
      }
      window.clearTimeout(pauseTimer.current)
      phraseOpen.current = false
      dictationReady.current = false
      setError(event.text)
      setState('error')
    })
    return () => {
      window.clearTimeout(pauseTimer.current)
      offStatus()
      offDictation()
    }
  }, [])

  const stop = useCallback(() => {
    runId.current += 1
    dictationReady.current = false
    window.clearTimeout(pauseTimer.current)
    phraseOpen.current = false
    void window.vanta.dictationStop()
    const live = session.current
    session.current = null
    if (live) {
      try {
        live.speech?.abort()
      } catch {
        /* ignore */
      }
      live.proc.disconnect()
      live.stream.getTracks().forEach((track) => track.stop())
      void live.ctx.close()
    }
    interim.current = ''
    setLevel(0)
    setState(pending.current ? 'transcribing' : 'off')
  }, [])

  const start = useCallback(async () => {
    if (session.current || dictationReady.current) return
    const id = runId.current + 1
    runId.current = id
    setError(null)
    setState('starting')
    const live = await window.vanta.dictationStart()
    if (runId.current !== id) return
    if (live.ok) {
      dictationReady.current = true
      setState('listening')
      return
    }
    void window.vanta.warmTranscriber()
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone is unavailable in this window. Restart Scobe and try again.')
      setState('error')
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: { ideal: 1 }
        }
      })
    } catch (err) {
      setError(micError(err))
      setState('error')
      return
    }
    const ctx = new AudioContext()
    try {
      if (ctx.state === 'suspended') await ctx.resume()
    } catch {
      /* keep going; the processor may still start */
    }
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(FRAME, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    const frameMs = (FRAME / ctx.sampleRate) * 1000
    let noise = 0.01
    let speaking = false
    let speechMs = 0
    let silenceMs = 0
    let chunks: Float32Array[] = []
    let utterance = 0
    const preRoll: Float32Array[] = []

    const Ctor = speechCtor()
    let speech: SpeechRec | null = null
    if (Ctor) {
      speech = new Ctor()
      speech.continuous = true
      speech.interimResults = true
      speech.lang = 'en-US'
      speech.onresult = (event) => {
        let finalText = ''
        let live = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || ''
          if (event.results[i].isFinal) finalText += piece
          else live += piece
        }
        const draft = (finalText || live).trim()
        if (draft) {
          interim.current = draft
          setState('hearing')
          onPartialRef.current?.(draft)
        }
      }
      speech.onerror = (event) => {
        // Chrome's speech service is unavailable inside Electron. Local Whisper still transcribes.
        if (event.error === 'network' || event.error === 'service-not-allowed' || event.error === 'not-allowed' || event.error === 'audio-capture') {
          try {
            speech?.abort()
          } catch {
            /* ignore */
          }
          if (session.current?.speech === speech) session.current.speech = null
        }
      }
      speech.onend = () => {
        if (session.current?.speech === speech) {
          try {
            speech?.start()
          } catch {
            /* ignore */
          }
        }
      }
      try {
        speech.start()
      } catch {
        speech = null
      }
    }

    const flush = () => {
      const audio = downsample(concat(chunks), ctx.sampleRate, SAMPLE_RATE)
      chunks = []
      speaking = false
      utterance += 1
      if (speechMs < MIN_SPEECH_MS) return
      pending.current += 1
      setState('transcribing')
      const hinted = interim.current.trim()
      interim.current = ''
      queue.current = queue.current.then(async () => {
        try {
          const heard = ((await window.vanta.transcribe(audio)) || hinted).trim()
          if (heard) {
            setError(null)
            onTextRef.current(heard)
          } else {
            setError('Didn’t catch that. Try speaking a little louder.')
          }
        } catch (err) {
          if (hinted) onTextRef.current(hinted)
          else setError(err instanceof Error ? err.message : 'Could not transcribe that.')
        } finally {
          pending.current -= 1
          if (!pending.current) setState(session.current ? 'listening' : 'off')
        }
      })
    }

    let lastLevelMs = 0
    let lastPartialMs = 0
    const publishPartial = () => {
      if (speechMs < MIN_PARTIAL_MS) return
      const now = performance.now()
      if (now - lastPartialMs < PARTIAL_EVERY_MS) return
      lastPartialMs = now
      const audio = downsample(concat(chunks), ctx.sampleRate, SAMPLE_RATE)
      const heardUtterance = utterance
      queue.current = queue.current.then(async () => {
        if (heardUtterance !== utterance || !speaking) return
        try {
          const text = (await window.vanta.transcribe(audio)).trim()
          if (heardUtterance !== utterance || !speaking || !text) return
          interim.current = text
          setError(null)
          onPartialRef.current?.(text)
        } catch {
          /* The pause transcription reports a real failure. */
        }
      })
    }
    proc.onaudioprocess = (event) => {
      const input = new Float32Array(event.inputBuffer.getChannelData(0))
      let sum = 0
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
      const rms = Math.sqrt(sum / input.length)
      const threshold = Math.max(0.008, noise * 2.6)
      const loud = rms > threshold
      const now = performance.now()
      if (now - lastLevelMs > 80) {
        lastLevelMs = now
        setLevel(Math.min(1, rms / 0.12))
      }
      if (!speaking) {
        noise = noise * 0.95 + rms * 0.05
        preRoll.push(input)
        if (preRoll.length > PRE_ROLL_FRAMES) preRoll.shift()
        if (loud) {
          speaking = true
          speechMs = 0
          silenceMs = 0
          chunks = [...preRoll]
          preRoll.length = 0
          setError(null)
          setState('hearing')
        }
        return
      }
      chunks.push(input)
      publishPartial()
      if (loud) {
        speechMs += frameMs
        silenceMs = 0
      } else {
        silenceMs += frameMs
      }
      if (silenceMs >= END_SILENCE_MS || speechMs + silenceMs >= MAX_UTTERANCE_MS) {
        flush()
        if (!pending.current) setState('listening')
      }
    }
    source.connect(proc)
    proc.connect(mute)
    mute.connect(ctx.destination)
    session.current = { stream, ctx, proc, speech }
    setState('listening')
  }, [])

  useEffect(() => stop, [stop])

  return { state, level, error, model, start, stop, active: state !== 'off' && state !== 'error' }
}
