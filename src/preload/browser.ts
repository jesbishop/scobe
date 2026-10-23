/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/** Runs inside canvas BrowserViews — forwards Ctrl/Cmd+wheel to the shell for canvas zoom. */
window.addEventListener(
  'wheel',
  (event) => {
    if (!(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    ipcRenderer.send('vanta:browser-wheel', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey
    })
  },
  { capture: true, passive: false }
)
