import { useSyncExternalStore, type FocusEvent, type PointerEvent } from 'react'
import type { PadSide } from './selectionSpace'

/** Which auto-layout spacing the inspector is pointing at, so the canvas can outline it (Figma). */
export type SpacingHint = { kind: 'gap' } | { kind: 'pad'; sides: PadSide[] } | null

let current: SpacingHint = null
const listeners = new Set<() => void>()

export function setSpacingHint(next: SpacingHint): void {
  if (current === next) return
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSpacingHint(): SpacingHint {
  return useSyncExternalStore(subscribe, () => current)
}

/** Hover/focus handlers for an inspector field that should outline spacing on the canvas. */
export function spacingHintProps(hint: Exclude<SpacingHint, null>) {
  return {
    onPointerEnter: () => setSpacingHint(hint),
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(document.activeElement)) setSpacingHint(null)
    },
    onFocus: () => setSpacingHint(hint),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.matches(':hover')) setSpacingHint(null)
    }
  }
}
