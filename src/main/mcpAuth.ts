import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

let cachedToken: string | null = null

function tokenPath(): string {
  return join(homedir(), '.vanta', 'mcp-token')
}

/** Per-install secret; required for any MCP request that did not come straight from this machine. */
export function getMcpToken(): string {
  if (cachedToken) return cachedToken
  const fromEnv = process.env.VANTA_MCP_TOKEN?.trim()
  if (fromEnv) {
    cachedToken = fromEnv
    return cachedToken
  }
  const path = tokenPath()
  if (existsSync(path)) {
    const saved = readFileSync(path, 'utf8').trim()
    if (saved.length >= 32) {
      cachedToken = saved
      return cachedToken
    }
  }
  cachedToken = randomBytes(32).toString('base64url')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${cachedToken}\n`, { encoding: 'utf8', mode: 0o600 })
  return cachedToken
}

/** Generates a new token; existing remote agent configs stop working until reconnected. */
export function rotateMcpToken(): string {
  cachedToken = randomBytes(32).toString('base64url')
  const path = tokenPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${cachedToken}\n`, { encoding: 'utf8', mode: 0o600 })
  return cachedToken
}

export function withMcpToken(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.set('token', getMcpToken())
  return parsed.toString()
}

function presentedToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers.authorization
  if (typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i)
    if (match?.[1]) return match[1].trim()
  }
  return url.searchParams.get('token')
}

function tokenMatches(candidate: string | null): boolean {
  if (!candidate) return false
  const expected = Buffer.from(getMcpToken())
  const given = Buffer.from(candidate)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

const FORWARD_HEADERS = ['cf-ray', 'cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host', 'forwarded']

function isDirectLocal(req: IncomingMessage, port: number): boolean {
  if (FORWARD_HEADERS.some((h) => req.headers[h] !== undefined)) return false
  // A browser page (any site) talking to localhost always sends Origin; never trust it without the token.
  if (req.headers.origin !== undefined) return false
  const host = (req.headers.host || '').toLowerCase()
  // Host check blocks DNS-rebinding: a hostile domain resolving to 127.0.0.1 still sends its own Host.
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

export function isMcpRequestAuthorized(req: IncomingMessage, url: URL, port: number): boolean {
  if (isDirectLocal(req, port)) return true
  return tokenMatches(presentedToken(req, url))
}
