import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { DesignNode } from '../shared/types'
import { exportNodeAsPngBlob } from './exportNode'

export type ShaderShapeImage = { image: string; name: string; width: number; height: number }

type Session = { onPick: (shape: ShaderShapeImage) => void }

let session: Session | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Arm the "capture image from another element" eyedropper; the next canvas click picks a layer. */
export function startShapeCapture(onPick: (shape: ShaderShapeImage) => void) {
  session = { onPick }
  emit()
}

export function cancelShapeCapture() {
  if (!session) return
  session = null
  emit()
}

export function useShapeCaptureActive(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => session !== null
  )
}

const MAX_EDGE = 1200

async function blobToShape(blob: Blob, name: string): Promise<ShaderShapeImage> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read image'))
      el.src = url
    })
    const width = img.naturalWidth || 400
    const height = img.naturalHeight || 400
    const k = Math.min(1, MAX_EDGE / Math.max(width, height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * k))
    canvas.height = Math.max(1, Math.round(height * k))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { image: canvas.toDataURL('image/png'), name, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadShapeFile(file: File): Promise<ShaderShapeImage> {
  return blobToShape(file, file.name)
}

const EYEDROPPER_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M2.5 17.5l1.2-3.6 7.6-7.6 2.4 2.4-7.6 7.6z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/><path d="M11.3 6.3l2.2-2.2a1.7 1.7 0 0 1 2.4 2.4l-2.2 2.2" fill="#000" stroke="#000" stroke-width="1.2"/></svg>'
)}") 2 18, crosshair`

function nodeElementAt(x: number, y: number, excludeIds: string[]): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const host = (el as HTMLElement).closest?.<HTMLElement>('[data-node-id]')
    if (!host) continue
    if (excludeIds.includes(host.dataset.nodeId || '')) continue
    return host
  }
  return null
}

/** Full-window eyedropper layer shown while a shape capture is armed. */
export function ShapeCaptureOverlay({ nodes, excludeIds = [] }: { nodes: DesignNode[]; excludeIds?: string[] }) {
  const active = useShapeCaptureActive()
  const [hover, setHover] = useState<{ id: string; rect: DOMRect } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!active) {
      setHover(null)
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelShapeCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])

  if (!active) return null

  const pick = async (x: number, y: number) => {
    const current = session
    const host = nodeElementAt(x, y, excludeIds)
    const node = host ? nodes.find((item) => item.id === host.dataset.nodeId) : undefined
    if (!current || !node) {
      cancelShapeCapture()
      return
    }
    setBusy(true)
    try {
      const blob = await exportNodeAsPngBlob(node, nodes, 2)
      const shape = await blobToShape(blob, node.name || node.type)
      if (session === current) current.onPick(shape)
    } catch (error) {
      console.error('Shape capture failed', error)
    } finally {
      setBusy(false)
      if (session === current) cancelShapeCapture()
    }
  }

  return createPortal(
    <div
      className="shape-capture-overlay"
      style={{ cursor: busy ? 'progress' : EYEDROPPER_CURSOR }}
      onMouseMove={(event) => {
        const host = nodeElementAt(event.clientX, event.clientY, excludeIds)
        const id = host?.dataset.nodeId
        setHover(id && host ? { id, rect: host.getBoundingClientRect() } : null)
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (event.button !== 0) {
          cancelShapeCapture()
          return
        }
        if (!busy) void pick(event.clientX, event.clientY)
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {hover && (
        <div
          className="shape-capture-hover"
          style={{ left: hover.rect.left, top: hover.rect.top, width: hover.rect.width, height: hover.rect.height }}
        />
      )}
      <div className="shape-capture-hint">Click a layer to use it as the shape · Esc to cancel</div>
    </div>,
    document.body
  )
}
