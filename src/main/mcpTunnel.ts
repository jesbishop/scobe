import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { withMcpToken } from './mcpAuth'
import { VANTA_MCP_PORT, VANTA_MCP_URL } from './mcpServer'

type TunnelProc = ChildProcessByStdio<null, Readable, Readable>

let tunnelProc: TunnelProc | null = null
let publicBaseUrl: string | null = null
let starting: Promise<string | null> | null = null
let lastError: string | null = null

const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const NAMED_READY_RE = /Registered tunnel connection|Connection [a-f0-9-]+ registered/i

type NamedTunnel = { token: string; publicUrl: string }

/** Stable hostname: create a tunnel in Cloudflare Zero Trust that routes to http://127.0.0.1:29980. */
function namedTunnelConfig(): NamedTunnel | null {
  const token = process.env.VANTA_TUNNEL_TOKEN?.trim()
  const publicUrl = process.env.VANTA_PUBLIC_URL?.trim()
  if (!token || !publicUrl) return null
  return { token, publicUrl }
}

export function hasNamedTunnel(): boolean {
  return namedTunnelConfig() !== null
}

function publicMcpUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, '')
  return withMcpToken(trimmed.endsWith('/mcp') ? trimmed : `${trimmed}/mcp`)
}

export function getPublicMcpUrl(): string | null {
  return publicBaseUrl ? publicMcpUrl(publicBaseUrl) : null
}

export function getLocalMcpUrl(): string {
  return VANTA_MCP_URL
}

export function getTunnelError(): string | null {
  return lastError
}

function spawnCloudflared(named: NamedTunnel | null): TunnelProc {
  const args = named
    ? ['--yes', 'cloudflared', 'tunnel', '--no-autoupdate', 'run']
    : ['--yes', 'cloudflared', 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${VANTA_MCP_PORT}`]
  // Token goes through the environment so it never shows up in the process command line.
  const env = named ? { ...process.env, TUNNEL_TOKEN: named.token } : process.env
  // Windows: npx.cmd via shell so PATH resolves.
  if (process.platform === 'win32') {
    return spawn('npx.cmd', args, { windowsHide: true, shell: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  return spawn('npx', args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

export async function ensureMcpTunnel(): Promise<string | null> {
  if (publicBaseUrl && tunnelProc && !tunnelProc.killed) {
    return publicMcpUrl(publicBaseUrl)
  }
  if (starting) return starting

  lastError = null
  publicBaseUrl = null
  const named = namedTunnelConfig()

  starting = new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (url: string | null, error?: string) => {
      if (settled) return
      settled = true
      starting = null
      if (error) lastError = error
      resolve(url ? publicMcpUrl(url) : null)
    }

    let child: TunnelProc
    try {
      child = spawnCloudflared(named)
    } catch (error) {
      finish(null, error instanceof Error ? error.message : String(error))
      return
    }

    tunnelProc = child
    let log = ''

    const onChunk = (buf: Buffer) => {
      const text = buf.toString('utf8')
      log += text
      if (log.length > 8000) log = log.slice(-4000)
      if (named) {
        if (!NAMED_READY_RE.test(text) && !NAMED_READY_RE.test(log)) return
        publicBaseUrl = named.publicUrl
      } else {
        const match = text.match(QUICK_URL_RE) || log.match(QUICK_URL_RE)
        if (!match?.[0]) return
        publicBaseUrl = match[0]
      }
      lastError = null
      finish(publicBaseUrl)
    }

    child.stdout.on('data', onChunk)
    child.stderr.on('data', onChunk)
    child.on('error', (error) => {
      tunnelProc = null
      publicBaseUrl = null
      finish(null, error.message)
    })
    child.on('exit', (code) => {
      const wasReady = Boolean(publicBaseUrl)
      if (tunnelProc === child) tunnelProc = null
      publicBaseUrl = null
      if (!wasReady) {
        finish(null, `cloudflared exited (${code ?? '?'}). ${log.trim().slice(-240)}`)
      }
    })

    setTimeout(() => {
      if (publicBaseUrl) return
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      tunnelProc = null
      finish(
        null,
        named
          ? 'Timed out connecting the named Cloudflare tunnel. Check VANTA_TUNNEL_TOKEN and your network.'
          : 'Timed out waiting for Cloudflare tunnel URL. Check network / npx cloudflared.'
      )
    }, 60_000)
  })

  return starting
}

export function stopMcpTunnel(): void {
  starting = null
  publicBaseUrl = null
  lastError = null
  const proc = tunnelProc
  tunnelProc = null
  if (!proc || proc.killed) return
  try {
    proc.kill()
  } catch {
    /* ignore */
  }
}
