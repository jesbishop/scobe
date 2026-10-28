import { useSyncExternalStore } from 'react'
import type { Paint, ShaderPaint } from '../shared/paint'

/** The shader open in the fill picker, so the canvas can show its on-object transform handles. */
export type ShaderEdit = {
  paint: ShaderPaint
  onChange: (paint: Paint) => void
} | null

let current: ShaderEdit = null
const listeners = new Set<() => void>()

export function setShaderEdit(next: ShaderEdit): void {
  if (current === next) return
  current = next
  for (const listener of listeners) listener()
}

export function getShaderEdit(): ShaderEdit {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useShaderEdit(): ShaderEdit {
  return useSyncExternalStore(subscribe, () => current)
}
