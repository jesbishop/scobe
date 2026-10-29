import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export function CanvasBuildNotice({ open, onClose, onConnect }: { open: boolean; onClose: () => void; onConnect: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button')
        if (!buttons?.length) return
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus() }
  }, [open, onClose])
  return createPortal(<AnimatePresence>{open && <motion.div className="ca-connect-backdrop" data-chrome-overlay=""
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
    onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <motion.div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="canvas-build-notice-title" aria-describedby="canvas-build-notice-description"
      className="ca-connect-modal canvas-build-notice"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 4, scale: reduceMotion ? 1 : 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>
      <div className="ca-connect-head"><h2 id="canvas-build-notice-title">Build more with your agent</h2><button type="button" className="ca-connect-x" aria-label="Close" onClick={onClose}>×</button></div>
      <p id="canvas-build-notice-description">Connect your agent for full pages, app screens, and larger canvas builds. Use this chat for everyday questions and quick edits with Jev.</p>
      <div className="canvas-build-notice-actions"><button type="button" onClick={onClose}>Keep chatting</button><button type="button" className="is-primary" onClick={onConnect}>Connect your agent</button></div>
    </motion.div>
  </motion.div>}</AnimatePresence>, document.body)
}
