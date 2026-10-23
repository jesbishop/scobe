import { useCallback, useEffect, useRef, useState } from 'react'
import type { TranscriberStatus } from '../shared/jev'

export type VoiceState = 'off' | 'starting' | 'listening' | 'hearing' | 'transcribing' | 'error'

const SAMPLE_RATE = 16000
const FRAME = 1024
/** Silence after speech that ends an utterance ("pause to apply"). */
const END_SILENCE_MS = 1100
const MIN_SPEECH_MS = 280
const MAX_UTTERANCE_MS = 15000
const PRE_ROLL_FRAMES = 4

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

  useEffect(() => {
    void window.vanta.transcriberStatus().then(setModel)
    return window.vanta.onTranscriber(setModel)
  }, [])

  const stop = useCallback(() => {
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
    if (session.current) return
    setError(null)
    setState('starting')
    void window.vanta.warmTranscriber()
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone unavailable')
      setState('error')
      return
    }
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(FRAME, 1, 1)
    const frameMs = (FRAME / SAMPLE_RATE) * 1000
    let noise = 0.01
    let speaking = false
    let speechMs = 0
    let silenceMs = 0
    let chunks: Float32Array[] = []
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
      speech.onerror = () => {
        /* Whisper still handles finals */
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
      const audio = concat(chunks)
      chunks = []
      speaking = false
      if (speechMs < MIN_SPEECH_MS) return
      pending.current += 1
      setState('transcribing')
      const hinted = interim.current
      interim.current = ''
      queue.current = queue.current.then(async () => {
        try {
          const text = (await window.vanta.transcribe(audio)) || hinted
          if (text) onTextRef.current(text)
        } catch (err) {
          if (hinted) onTextRef.current(hinted)
          else setError(err instanceof Error ? err.message : String(err))
        } finally {
          pending.current -= 1
          if (!pending.current) setState(session.current ? 'listening' : 'off')
        }
      })
    }

    let lastLevelMs = 0
    proc.onaudioprocess = (event) => {
      const input = new Float32Array(event.inputBuffer.getChannelData(0))
      let sum = 0
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
      const rms = Math.sqrt(sum / input.length)
      const threshold = Math.max(0.015, noise * 3)
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
          setState('hearing')
        }
        return
      }
      chunks.push(input)
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
    proc.connect(ctx.destination)
    session.current = { stream, ctx, proc, speech }
    setState('listening')
  }, [])

  useEffect(() => stop, [stop])

  return { state, level, error, model, start, stop, active: state !== 'off' && state !== 'error' }
}
