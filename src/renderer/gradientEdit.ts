import { useSyncExternalStore } from 'react'
import type { GradientPaint, Paint } from '../shared/paint'

/** The gradient open in the fill picker, so the canvas can show Figma's on-object gradient handles. */
export type GradientEdit = {
  paint: GradientPaint
  activeStopId: string | null
  onChange: (paint: Paint) => void
  onActiveStop: (id: string) => void
} | null

let current: GradientEdit = null
const listeners = new Set<() => void>()

export function setGradientEdit(next: GradientEdit): void {
  if (current === next) return
  current = next
  for (const listener of listeners) listener()
}

export function getGradientEdit(): GradientEdit {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGradientEdit(): GradientEdit {
  return useSyncExternalStore(subscribe, () => current)
}
