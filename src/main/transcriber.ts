import { join } from 'node:path'
import { app } from 'electron'
import type { TranscriberStatus } from '../shared/jev'

const MODEL = 'Xenova/whisper-base.en'

type Recognizer = (audio: Float32Array, opts?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>

let recognizer: Promise<Recognizer> | null = null
let status: TranscriberStatus = { state: 'idle', model: MODEL }
const listeners = new Set<(status: TranscriberStatus) => void>()

function setStatus(next: TranscriberStatus): void {
  status = next
  for (const fn of listeners) fn(status)
}

export function transcriberStatus(): TranscriberStatus {
  return status
}

export function onTranscriberStatus(fn: (status: TranscriberStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Loads Whisper once; weights download to userData on first use, then run fully offline. */
export function warmTranscriber(): Promise<Recognizer> {
  if (recognizer) return recognizer
  setStatus({ state: 'loading', model: MODEL })
  recognizer = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(app.getPath('userData'), 'models')
    const asr = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' })
    setStatus({ state: 'ready', model: MODEL })
    return asr as unknown as Recognizer
  })()
  recognizer.catch((error: unknown) => {
    recognizer = null
    setStatus({ state: 'error', model: MODEL, error: error instanceof Error ? error.message : String(error) })
  })
  return recognizer
}

/** IPC may deliver the samples as a Float32Array or as a Buffer of little-endian floats. */
function asPcm(audio: unknown): Float32Array {
  if (audio instanceof Float32Array) return audio
  if (Buffer.isBuffer(audio)) {
    const length = Math.floor(audio.byteLength / 4)
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) out[i] = audio.readFloatLE(i * 4)
    return out
  }
  if (audio instanceof ArrayBuffer) return new Float32Array(audio)
  if (ArrayBuffer.isView(audio)) {
    const view = audio as ArrayBufferView
    return new Float32Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
  }
  throw new Error('Could not read microphone audio.')
}

/** `audio` is mono 16 kHz PCM. */
export async function transcribe(audio: unknown): Promise<string> {
  const pcm = asPcm(audio)
  if (pcm.length < 1600) return ''
  const asr = await warmTranscriber()
  const out = await asr(pcm)
  const text = Array.isArray(out) ? out.map((item) => item.text).join(' ') : out.text
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
