import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'

/**
 * Ask the app window to do something only it can (render a design layer to PNG, read the
 * Tokens panel) and wait for the answer. Canvas tools run in main; the canvas lives in the window.
 */

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

const pending = new Map<string, Pending>()
let getWindow: () => BrowserWindow | null = () => null

export function initRendererRpc(window: () => BrowserWindow | null): void {
  getWindow = window
  ipcMain.on('vanta:rpcResult', (_event, reply: { id: string; ok: boolean; result?: unknown; error?: string }) => {
    const entry = pending.get(reply?.id)
    if (!entry) return
    pending.delete(reply.id)
    clearTimeout(entry.timer)
    if (reply.ok) entry.resolve(reply.result)
    else entry.reject(new Error(reply.error || 'The canvas could not complete that request.'))
  })
}

export function callRenderer<T>(method: string, args?: unknown, timeoutMs = 20000): Promise<T> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return Promise.reject(new Error('Scobe’s canvas window is not open.'))
  const id = randomUUID()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`The canvas took too long to answer (${method}).`))
    }, timeoutMs)
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    win.webContents.send('vanta:rpc', { id, method, args })
  })
}
