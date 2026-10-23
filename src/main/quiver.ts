import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type QuiverModelId = 'arrow-2' | 'arrow-2-telos'

export type QuiverStatus = {
  configured: boolean
}

export type QuiverGenerateInput = {
  model: QuiverModelId
  prompt: string
  instructions?: string
  /** Raw base64 (no data: prefix) or full data URL — stripped in main. */
  referenceBase64?: string | null
  references?: string[] | null
  n?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  viewBox?: { width: number; height: number }
}

export type QuiverVectorizeInput = {
  model: QuiverModelId
  imageBase64: string
  autoCrop?: boolean
  targetSize?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  viewBox?: { width: number; height: number }
}

export type QuiverStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'reasoning'; text: string; index?: number; id?: string }
  | { type: 'draft'; svg: string; index?: number; id?: string }
  | { type: 'content'; svg: string; index?: number; id?: string }
  | { type: 'done'; svg: string; id?: string }
  | { type: 'error'; message: string }

const QUIVER_URL = 'https://api.quiver.ai/v1/svgs/generations'
const QUIVER_VECTORIZE_URL = 'https://api.quiver.ai/v1/svgs/vectorizations'

function keyFile(): string {
  return join(app.getPath('userData'), 'quiver.json')
}

function storedKey(): string | null {
  try {
    if (!existsSync(keyFile())) return null
    const data = JSON.parse(readFileSync(keyFile(), 'utf8')) as { key?: string }
    return data.key?.trim() || null
  } catch {
    return null
  }
}

function resolveKey(): string | null {
  return process.env.QUIVERAI_API_KEY?.trim() || process.env.QUIVER_API_KEY?.trim() || storedKey()
}

export function quiverStatus(): QuiverStatus {
  return { configured: Boolean(resolveKey()) }
}

export function setQuiverKey(key: string): QuiverStatus {
  writeFileSync(keyFile(), JSON.stringify({ key: key.trim() }), 'utf8')
  return quiverStatus()
}

function stripDataUrl(value: string): string {
  const match = value.match(/^data:([^;]+);base64,(.+)$/i)
  if (match) return match[2]
  return value.replace(/^base64,/i, '')
}

function buildBody(input: QuiverGenerateInput, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    stream,
    n: Math.max(1, Math.min(16, input.n ?? 1)),
    temperature: input.temperature ?? 0.4
  }
  if (input.instructions?.trim()) body.instructions = input.instructions.trim()
  if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort
  if (input.viewBox) {
    body.attributes = {
      viewBox: {
        minX: 0,
        minY: 0,
        width: input.viewBox.width,
        height: input.viewBox.height
      }
    }
  }
  if (input.referenceBase64?.trim() || (input.references && input.references.length)) {
    const refs = [
      ...(input.references || []),
      ...(input.referenceBase64?.trim() ? [input.referenceBase64.trim()] : [])
    ]
    const seen = new Set<string>()
    const unique: Array<{ base64: string }> = []
    for (const ref of refs) {
      const base64 = stripDataUrl(ref.trim())
      if (!base64 || seen.has(base64)) continue
      seen.add(base64)
      unique.push({ base64 })
      if (unique.length >= 14) break
    }
    if (unique.length) body.references = unique
  }
  return body
}

function buildVectorizeBody(input: QuiverVectorizeInput, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream,
    auto_crop: input.autoCrop !== false,
    image: { base64: stripDataUrl(input.imageBase64.trim()) },
    temperature: input.temperature ?? 0.2
  }
  if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort
  if (input.targetSize) body.target_size = input.targetSize
  if (input.viewBox) {
    body.attributes = {
      viewBox: {
        minX: 0,
        minY: 0,
        width: input.viewBox.width,
        height: input.viewBox.height
      }
    }
  }
  return body
}

function friendlyError(code: string | undefined, message: string | undefined, status?: number): string {
  const msg = (message || '').trim()
  const c = (code || '').toLowerCase()
  if (c === 'insufficient_credits' || status === 402) {
    return 'QuiverAI is out of credits — add credits at quiver.ai, then try again.'
  }
  if (c === 'invalid_api_key' || c === 'unauthorized' || status === 401) {
    return 'QuiverAI API key is invalid. Paste a new key in Create SVG.'
  }
  if (c === 'rate_limit_exceeded' || status === 429) {
    return 'QuiverAI rate limit hit — wait a moment and retry.'
  }
  if (msg) return msg
  if (code) return `QuiverAI error: ${code}`
  if (status) return `QuiverAI request failed (${status})`
  return 'QuiverAI request failed'
}

function extractError(payload: unknown, status?: number): string {
  if (!payload || typeof payload !== 'object') return friendlyError(undefined, undefined, status)
  const p = payload as Record<string, unknown>
  const err = p.error && typeof p.error === 'object' ? (p.error as Record<string, unknown>) : null
  const code = String(p.code || err?.code || '')
  const message = String(p.message || err?.message || '')
  return friendlyError(code, message, status)
}

/** Quiver streams SVG as flat `{ svg }` on draft/content, or `data: [{ svg }]` on non-stream JSON. */
function extractSvg(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    if (typeof payload === 'string' && payload.includes('<svg')) return payload
    return ''
  }
  const p = payload as Record<string, unknown>
  if (typeof p.svg === 'string' && p.svg.trim()) return p.svg
  if (typeof p.content === 'string' && p.content.includes('<svg')) return p.content
  if (Array.isArray(p.data)) {
    for (const item of p.data) {
      if (!item || typeof item !== 'object') continue
      const doc = item as Record<string, unknown>
      if (typeof doc.svg === 'string' && doc.svg.trim()) return doc.svg
      if (typeof doc.content === 'string' && doc.content.includes('<svg')) return doc.content
    }
  } else if (p.data && typeof p.data === 'object') {
    const doc = p.data as Record<string, unknown>
    if (typeof doc.svg === 'string' && doc.svg.trim()) return doc.svg
  }
  return ''
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return typeof payload === 'string' ? payload : ''
  const p = payload as Record<string, unknown>
  if (typeof p.text === 'string') return p.text
  if (typeof p.delta === 'string') return p.delta
  if (typeof p.message === 'string') return p.message
  if (typeof p.reasoning === 'string') return p.reasoning
  return ''
}

function parseSseChunk(chunk: string, onEvent: (event: string, data: unknown) => void): void {
  const blocks = chunk.split(/\n\n/)
  for (const block of blocks) {
    const lines = block.split(/\n/).map((line) => line.trimEnd())
    if (!lines.length) continue
    let event = 'message'
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    const raw = dataLines.join('\n')
    if (!raw) continue
    if (raw === '[DONE]') {
      onEvent('done', null)
      continue
    }
    try {
      onEvent(event, JSON.parse(raw))
    } catch {
      onEvent(event, raw)
    }
  }
}

async function generateSvgOnce(input: QuiverGenerateInput, key: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(QUIVER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(buildBody(input, false)),
    signal
  })
  const json = (await res.json().catch(() => null)) as unknown
  if (!res.ok) throw new Error(extractError(json, res.status))
  const svg = extractSvg(json)
  if (!svg.trim()) throw new Error('QuiverAI returned no SVG')
  return svg
}

async function vectorizeSvgOnce(input: QuiverVectorizeInput, key: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(QUIVER_VECTORIZE_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(buildVectorizeBody(input, false)),
    signal
  })
  const json = (await res.json().catch(() => null)) as unknown
  if (!res.ok) throw new Error(extractError(json, res.status))
  const svg = extractSvg(json)
  if (!svg.trim()) throw new Error('QuiverAI returned no SVG')
  return svg
}

async function streamQuiverRequest(
  url: string,
  body: Record<string, unknown>,
  key: string,
  emit: (event: QuiverStreamEvent) => void,
  signal: AbortSignal | undefined,
  fallback: () => Promise<string>
): Promise<string> {
  emit({ type: 'status', message: 'Contacting QuiverAI…' })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'text/event-stream'
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('Cancelled')
    }
    emit({ type: 'status', message: 'Stream failed — retrying…' })
    const svg = await fallback()
    emit({ type: 'content', svg, index: 0 })
    emit({ type: 'done', svg })
    return svg
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    const message = extractError(errBody, res.status)
    emit({ type: 'error', message })
    throw new Error(message)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    emit({ type: 'status', message: 'Empty stream — retrying…' })
    const svg = await fallback()
    emit({ type: 'content', svg, index: 0 })
    emit({ type: 'done', svg })
    return svg
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const byIndex = new Map<number, string>()
  let latestSvg = ''
  let latestId: string | undefined
  let streamError: string | null = null

  const handle = (event: string, data: unknown) => {
    if (event === 'done' || data === null) return
    const payload = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
    const kind =
      event === 'message' && typeof payload.type === 'string' ? String(payload.type) : event
    const chunk = extractSvg(data)
    const text = extractText(data)
    const index = typeof payload.index === 'number' ? payload.index : 0
    const id = typeof payload.id === 'string' ? payload.id : undefined
    const updateType =
      payload.update_type === 'delta' || payload.updateType === 'delta' ? 'delta' : 'snapshot'

    if (kind === 'generating') {
      emit({ type: 'status', message: text || 'Generating…' })
      return
    }
    if (kind === 'reasoning') {
      emit({ type: 'reasoning', text: text || 'Reasoning…', index, id })
      return
    }
    if ((kind === 'draft' || kind === 'content') && chunk) {
      const prev = byIndex.get(index) || ''
      const next = kind === 'draft' && updateType === 'delta' ? `${prev}${chunk}` : chunk
      byIndex.set(index, next)
      latestSvg = next
      latestId = id || latestId
      emit({ type: kind === 'draft' ? 'draft' : 'content', svg: next, index, id })
      return
    }
    if (chunk) {
      byIndex.set(index, chunk)
      latestSvg = chunk
      latestId = id || latestId
      emit({ type: 'draft', svg: chunk, index, id })
      return
    }
    if (kind === 'error') {
      streamError = extractError(data)
      emit({ type: 'error', message: streamError })
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split(/\n\n/)
      buffer = parts.pop() || ''
      for (const part of parts) parseSseChunk(part, handle)
    }
    if (buffer.trim()) parseSseChunk(buffer, handle)
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('Cancelled')
    }
    throw error
  }

  if (streamError) throw new Error(streamError)

  if (!latestSvg.trim()) {
    emit({ type: 'status', message: 'No streamed SVG — retrying…' })
    const svg = await fallback()
    emit({ type: 'content', svg, index: 0 })
    emit({ type: 'done', svg })
    return svg
  }

  const primary = byIndex.get(0) || latestSvg
  emit({ type: 'done', svg: primary, id: latestId })
  return primary
}

/**
 * Stream an SVG generation from QuiverAI with raw SSE (reliable in Electron).
 * Drafts may be snapshots or deltas (`update_type`); deltas are accumulated per output index.
 */
export async function generateSvgStream(
  input: QuiverGenerateInput,
  emit: (event: QuiverStreamEvent) => void,
  signal?: AbortSignal
): Promise<string> {
  const key = resolveKey()
  if (!key) {
    throw new Error('QuiverAI API key missing. Add QUIVERAI_API_KEY to .env or paste a key in Create SVG.')
  }
  return streamQuiverRequest(
    QUIVER_URL,
    buildBody(input, true),
    key,
    emit,
    signal,
    () => generateSvgOnce(input, key, signal)
  )
}

/** Stream image→SVG vectorization via QuiverAI `/v1/svgs/vectorizations`. */
export async function vectorizeSvgStream(
  input: QuiverVectorizeInput,
  emit: (event: QuiverStreamEvent) => void,
  signal?: AbortSignal
): Promise<string> {
  const key = resolveKey()
  if (!key) {
    throw new Error('QuiverAI API key missing. Add QUIVERAI_API_KEY to .env or paste a key in Create SVG.')
  }
  if (!input.imageBase64?.trim()) {
    throw new Error('Select an image to vectorize.')
  }
  // Non-stream: Paper-like fast pop — one shot, then explode locally.
  emit({ type: 'status', message: 'Vectorizing…' })
  try {
    const svg = await vectorizeSvgOnce(input, key, signal)
    emit({ type: 'content', svg, index: 0 })
    emit({ type: 'done', svg })
    return svg
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new Error('Cancelled')
    }
    throw error
  }
}
