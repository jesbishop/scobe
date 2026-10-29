import { gatewayUrl, cloudFetch } from './cloudAi'
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
function key(): string {
  if (process.env.ELEVENLABS_API_KEY?.trim()) return process.env.ELEVENLABS_API_KEY.trim()
  try { return safeStorage.decryptString(readFileSync(join(app.getPath('userData'), 'elevenlabs.key'))) } catch { return '' }
}
export function speechStatus() { return { configured: Boolean(gatewayUrl() || key()), managed: Boolean(gatewayUrl()) } }
export function saveSpeechKey(value: string) {
  if (!value?.trim()) throw new Error('Enter an ElevenLabs API key.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure key storage is unavailable on this device.')
  writeFileSync(join(app.getPath('userData'), 'elevenlabs.key'), safeStorage.encryptString(value.trim()))
  return speechStatus()
}
async function request(path: string, options?: RequestInit) {
  const token = key()
  if (!token) throw new Error('Connect your ElevenLabs API key to use read aloud.')
  const response = await fetch('https://api.elevenlabs.io' + path, { ...options, headers: { 'xi-api-key': token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(120000) })
  if (!response.ok) {
    let code = ''
    try { const data = await response.json() as { detail?: { status?: string } }; code = data.detail?.status || '' } catch { /* Non-JSON error response. */ }
    if (code === 'invalid_api_key') throw new Error('ElevenLabs rejected this API key. Copy the complete key and save it again.')
    if (code === 'missing_permissions') throw new Error('This ElevenLabs key is missing permissions. Enable Voices read and Text to Speech access for this key.')
    if (code === 'quota_exceeded') throw new Error('Your ElevenLabs account has no remaining credits.')
    throw new Error('ElevenLabs request failed (' + response.status + (code ? ', ' + code.replace(/[^a-z_]/gi, '').slice(0, 60) : '') + '). Check the full API key and its Voices read and Text to Speech permissions.')
  }
  return response
}
export async function speechVoices(): Promise<Array<{ id: string; name: string }>> {
  if (gatewayUrl()) return (await cloudFetch('/speech/voices')).json()
  const data = await (await request('/v2/voices?page_size=100')).json() as { voices: Array<{ voice_id: string; name: string }> }
  return data.voices.map(voice => ({ id: voice.voice_id, name: voice.name }))
}
export async function createSpeech(text: string, voice: string, model: string): Promise<string> {
  if (!text?.trim() || text.length > 30000) throw new Error('Choose a response under 30,000 characters.')
  if (!voice || !['eleven_v3', 'eleven_multilingual_v2'].includes(model)) throw new Error('Choose a voice and speech model.')
  const chunks = text.match(/[\s\S]{1,2000}(?:\s|$)|[\s\S]{1,2000}/g) || [text]
  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    const response = gatewayUrl() ? await cloudFetch('/speech/create', { text: chunk, voice, model }) : await request('/v1/text-to-speech/' + encodeURIComponent(voice) + '?output_format=mp3_44100_128', { method: 'POST', body: JSON.stringify({ text: chunk, model_id: model }) })
    buffers.push(Buffer.from(await response.arrayBuffer()))
  }
  return 'data:audio/mpeg;base64,' + Buffer.concat(buffers).toString('base64')
}
