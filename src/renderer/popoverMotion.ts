/** Shared enter/exit motion for popovers that open beside the inspector (fill picker, shader library). */
export function besidePopoverMotion(reduceMotion: boolean | null) {
  return {
    initial: reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10, scale: 0.97 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: reduceMotion ? { opacity: 0 } : { opacity: 0, x: 8, scale: 0.98 },
    transition: popoverSpring(reduceMotion)
  }
}

export function popoverSpring(reduceMotion: boolean | null) {
  return reduceMotion ? { duration: 0.12 } : { type: 'spring' as const, stiffness: 460, damping: 30, mass: 0.72 }
}
