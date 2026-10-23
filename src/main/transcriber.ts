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

/** `audio` is mono 16 kHz PCM. */
export async function transcribe(audio: Float32Array): Promise<string> {
  const asr = await warmTranscriber()
  const out = await asr(audio)
  const text = Array.isArray(out) ? out.map((item) => item.text).join(' ') : out.text
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
