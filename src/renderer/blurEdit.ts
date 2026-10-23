import { useSyncExternalStore } from 'react'

type Point = { x: number; y: number }

/** The progressive blur open in the effects popover, so the canvas can show its start / end handles. */
export type BlurEdit = {
  start: Point
  end: Point
  onChange: (start: Point, end: Point) => void
} | null

let current: BlurEdit = null
const listeners = new Set<() => void>()

export function setBlurEdit(next: BlurEdit): void {
  if (current === next) return
  current = next
  for (const listener of listeners) listener()
}

export function getBlurEdit(): BlurEdit {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBlurEdit(): BlurEdit {
  return useSyncExternalStore(subscribe, () => current)
}
