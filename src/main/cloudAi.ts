import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import publicConfig from '../shared/cloudConfig.json'
type Session = { access_token: string; refresh_token: string; expires_at: number; email: string }
let refreshing: Promise<Session> | null = null
let authGeneration = 0
type PublicConfig = { supabaseUrl: string; supabaseAnonKey: string }
let cachedConfig: { base: string; value: PublicConfig; expires: number } | null = null
let loadingConfig: { base: string; promise: Promise<PublicConfig> } | null = null
function sessionFile() { return join(app.getPath('userData'), 'scobe-cloud-session') }
export function gatewayUrl(): string {
  const value = (process.env.SCOBE_AI_GATEWAY_URL || publicConfig.gatewayUrl).trim().replace(/\/$/, '')
  if (!value) return ''
  const url = new URL(value)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname) && !app.isPackaged)) throw new Error('Scobe AI service must use HTTPS.')
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid Scobe AI service address.')
  return value
}
function readSession(): Session | null {
  try { return JSON.parse(safeStorage.decryptString(readFileSync(sessionFile()))) as Session } catch { return null }
}
function saveSession(data: { access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } }, email = ''): Session {
  if (!data.access_token || !data.refresh_token) throw new Error('Scobe sign-in did not return a session.')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure sign-in storage is unavailable on this device.')
  const session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, email: data.user?.email || email }
  writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(session)))
  return session
}
export function cloudStatus() {
  const session = readSession()
  return { enabled: Boolean(gatewayUrl()), signedIn: Boolean(session), email: session?.email || '' }
}
async function cloudConfig(): Promise<PublicConfig> {
  const base = gatewayUrl()
  if (!base) throw new Error('Scobe hosted AI has not been connected yet.')
  if (cachedConfig?.base === base && cachedConfig.expires > Date.now()) return cachedConfig.value
  if (loadingConfig?.base === base) return loadingConfig.promise
  // The free hosted instance can take more than 50 seconds to wake up. Only this
  // read-only discovery request is retried; refresh tokens and AI work are not replayed.
  const promise = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response
      try {
        response = await fetch(base + '/config', { signal: AbortSignal.timeout(90000), redirect: 'error' })
      } catch (error) {
        const transient = ['TimeoutError', 'TypeError'].includes((error as { name?: string })?.name || '')
        if (!attempt && transient) continue
        throw new Error('Scobe could not connect to its AI service. It may still be waking up. Please try again shortly.')
      }
      if (!response.ok) {
        if (!attempt && [502, 503, 504].includes(response.status)) continue
        throw new Error('Scobe sign-in is temporarily unavailable. Please try again shortly.')
      }
      const config = await response.json() as PublicConfig
      if (!config.supabaseUrl?.startsWith('https://') || !config.supabaseAnonKey) throw new Error('Invalid Scobe sign-in configuration.')
      cachedConfig = { base, value: config, expires: Date.now() + 5 * 60 * 1000 }
      return config
    }
    throw new Error('Scobe sign-in is temporarily unavailable.')
  })()
  loadingConfig = { base, promise }
  try { return await promise } finally { if (loadingConfig?.promise === promise) loadingConfig = null }
}
async function authRequest(path: string, body: unknown) {
  const config = await cloudConfig()
  const response = await fetch(config.supabaseUrl.replace(/\/$/, '') + '/auth/v1/' + path, { method: 'POST', headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' })
  if (!response.ok) throw new Error(response.status === 429 ? 'Too many sign-in attempts. Please wait and try again.' : 'Could not sign in. Check your email code or request a new one.')
  return response.json()
}
export async function sendSignInCode(email: string) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.')
  await authRequest('otp', { email: email.trim(), create_user: true })
}
export async function verifySignInCode(email: string, token: string) {
  if (!email || !/^\d{6,10}$/.test(token)) throw new Error('Enter the code from your email.')
  const data = await authRequest('verify', { email: email.trim(), token, type: 'email' })
  saveSession(data, email.trim())
  return cloudStatus()
}
export function signOutCloud() { authGeneration++; if (existsSync(sessionFile())) unlinkSync(sessionFile()); return cloudStatus() }
export async function cloudToken(): Promise<string> {
  const session = readSession()
  if (!session) throw new Error('Sign in to Scobe to use AI chat and read aloud.')
  if (session.expires_at > Date.now() + 60000) return session.access_token
  if (!refreshing) {
    const generation = authGeneration
    refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }).then(data => {
      if (generation !== authGeneration) throw new Error('Sign in to Scobe to use AI.')
      return saveSession(data, session.email)
    }).finally(() => { refreshing = null })
  }
  return (await refreshing).access_token
}
export async function cloudFetch(path: string, body?: unknown): Promise<Response> {
  const token = await cloudToken()
  const response = await fetch(gatewayUrl() + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000), redirect: 'error' })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your Scobe session expired. Please sign in again.')
    if (response.status === 429) throw new Error('Your Scobe AI usage limit has been reached. Please try again later.')
    throw new Error('Scobe AI is temporarily unavailable. Please try again later.')
  }
  return response
}
