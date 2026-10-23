import type { KeyboardEvent } from 'react'

const NUMBER_TEXT = /^\s*(-?\d*\.?\d+)\s*(°|%|px)?\s*$/
const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

/**
 * Container-level keydown handler: ArrowUp/ArrowDown steps whatever number is in the
 * focused text input (Shift = ×10), going through the input's own onChange so each
 * field keeps its parsing and clamping. Fields that handle arrows themselves call
 * preventDefault and are left alone; hex fields opt out by class or data-arrow-step="off".
 */
export function stepNumberInput(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
  const input = event.target
  if (!(input instanceof HTMLInputElement) || input.type !== 'text' || input.readOnly || input.disabled) return
  if (/\bhex\b/.test(input.className) || input.closest('[data-arrow-step="off"]')) return
  const match = NUMBER_TEXT.exec(input.value)
  if (!match || !setInputValue) return
  event.preventDefault()

  const current = Number(match[1])
  const decimals = match[1].split('.')[1]?.length ?? 0
  const fine = decimals > 0 && Math.abs(current) < 1
  const step = (fine ? 0.01 : 1) * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1)
  const next = Number((current + step).toFixed(Math.max(decimals, fine ? 2 : 0)))

  setInputValue.call(input, `${next}${match[2] ?? ''}`)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  window.requestAnimationFrame(() => input.select())
}
