import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { JevAnswers, JevQuestions, JevResponse, JevStatus } from '../shared/jev'

const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_AGENT_URL = 'https://jev-agent.com/api/v1/systemone'
const MODEL = 'jev-latest'

function keyFile(): string {
  return join(app.getPath('userData'), 'jev.json')
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
  return (
    process.env.JEV_API_KEY?.trim() ||
    process.env.TYPESAFE_API_KEY?.trim() ||
    process.env.JEV_AGENT_KEY?.trim() ||
    storedKey()
  )
}

/** `jv_live_` keys come from jev-agent.com; anything else is a TypeSafe key. */
function endpointFor(key: string): { url: string; host: JevStatus['host'] } {
  return key.startsWith('jv_') ? { url: JEV_AGENT_URL, host: 'jev-agent' } : { url: TYPESAFE_URL, host: 'typesafe' }
}

export function jevStatus(): JevStatus {
  const key = resolveKey()
  return { configured: Boolean(key), host: key ? endpointFor(key).host : null }
}

export function setJevKey(key: string): JevStatus {
  writeFileSync(keyFile(), JSON.stringify({ key: key.trim() }), 'utf8')
  return jevStatus()
}

export async function askJev(state: string, questions: JevQuestions): Promise<JevResponse> {
  const key = resolveKey()
  if (!key) throw new Error('Jev API key missing. Add JEV_API_KEY to .env or paste a key in the Jev panel.')
  const { url } = endpointFor(key)
  const started = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions })
  })
  const body = (await res.json().catch(() => null)) as
    | { model?: string; answers?: JevAnswers; error?: string | { message?: string }; message?: string }
    | null
  if (!res.ok || !body?.answers) {
    const detail =
      (typeof body?.error === 'string' ? body.error : body?.error?.message) || body?.message || res.statusText
    throw new Error(`Jev ${res.status}: ${detail || 'request failed'}`)
  }
  return { model: body.model || MODEL, answers: body.answers, latencyMs: Date.now() - started }
}
