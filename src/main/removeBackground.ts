import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'

export type RemoveBackgroundStatus = {
  state: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
}

let warmed: Promise<void> | null = null
let status: RemoveBackgroundStatus = { state: 'idle' }
const listeners = new Set<(status: RemoveBackgroundStatus) => void>()

function setStatus(next: RemoveBackgroundStatus): void {
  status = next
  for (const fn of listeners) fn(status)
}

export function removeBackgroundStatus(): RemoveBackgroundStatus {
  return status
}

export function onRemoveBackgroundStatus(fn: (status: RemoveBackgroundStatus) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function modelPublicPath(): string {
  // Ship models from the package dist; first run downloads ONNX weights into cache.
  // Packaged builds unpack this package (see asarUnpack) because the models are read as plain files.
  const root = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
  const dist = join(root, 'node_modules', '@imgly', 'background-removal-node', 'dist')
  const url = pathToFileURL(dist).href
  return url.endsWith('/') ? url : `${url}/`
}

/** @imgly/background-removal-node rejects data: URLs — convert to a Blob first. */
function dataUrlToBlob(imageDataUrl: string): Blob {
  const src = imageDataUrl.trim()
  if (!src) throw new Error('No image provided.')

  if (!src.startsWith('data:')) {
    return new Blob([Buffer.from(src, 'base64')], { type: 'image/png' })
  }

  const comma = src.indexOf(',')
  if (comma < 0) throw new Error('Invalid image data URL.')
  const header = src.slice(0, comma)
  const body = src.slice(comma + 1)
  const mime = header.slice(5).split(';')[0] || 'image/png'

  if (/;base64/i.test(header)) {
    return new Blob([Buffer.from(body, 'base64')], { type: mime })
  }

  return new Blob([Buffer.from(decodeURIComponent(body), 'utf8')], { type: mime })
}

const WARM_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

/** Prefetch the ONNX model so the first cutout isn’t a long cold start. */
export function warmRemoveBackground(): Promise<void> {
  if (warmed) return warmed
  setStatus({ state: 'loading' })
  warmed = (async () => {
    const { removeBackground } = await import('@imgly/background-removal-node')
    // Tiny 1×1 PNG blob — forces model/wasm load without meaningful work.
    await removeBackground(new Blob([WARM_PIXEL_PNG], { type: 'image/png' }), {
      publicPath: modelPublicPath(),
      model: 'medium',
      output: { format: 'image/png' }
    })
    setStatus({ state: 'ready' })
  })()
  warmed.catch((error: unknown) => {
    warmed = null
    setStatus({
      state: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  })
  return warmed
}

/**
 * Returns a PNG data URL with alpha. Accepts a data URL or raw base64 image.
 */
export async function removeImageBackground(
  imageDataUrl: string,
  onProgress?: (message: string) => void
): Promise<string> {
  onProgress?.('Loading background model…')
  await warmRemoveBackground().catch(() => undefined)

  const { removeBackground } = await import('@imgly/background-removal-node')
  onProgress?.('Removing background…')

  const input = dataUrlToBlob(imageDataUrl)
  const blob = await removeBackground(input, {
    publicPath: modelPublicPath(),
    model: 'medium',
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      if (!total) return
      const pct = Math.round((current / total) * 100)
      onProgress?.(`Downloading ${key}… ${pct}%`)
    }
  })

  const buffer = Buffer.from(await blob.arrayBuffer())
  return `data:image/png;base64,${buffer.toString('base64')}`
}
