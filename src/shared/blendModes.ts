import type { CSSProperties } from 'react'

/** Figma layer blend mode labels (UI order). */
export const BLEND_MODE_GROUPS: Array<{ label?: string; modes: string[] }> = [
  { modes: ['Pass through', 'Normal'] },
  { modes: ['Darken', 'Multiply', 'Plus darker', 'Color burn'] },
  { modes: ['Lighten', 'Screen', 'Plus lighter', 'Color dodge'] },
  { modes: ['Overlay', 'Soft light', 'Hard light'] },
  { modes: ['Difference', 'Exclusion'] },
  { modes: ['Hue', 'Saturation', 'Color', 'Luminosity'] }
]

export const BLEND_MODES = BLEND_MODE_GROUPS.flatMap((group) => group.modes)

export const DEFAULT_BLEND_MODE = 'Pass through'

/** Map Figma blend mode label → CSS mix-blend-mode. */
export function cssBlendMode(mode: string | undefined): CSSProperties['mixBlendMode'] {
  const key = (mode || DEFAULT_BLEND_MODE).trim().toLowerCase()
  switch (key) {
    case 'pass through':
    case 'pass-through':
      // Children can blend through the parent; layer itself draws normally
      return 'normal'
    case 'normal':
      return 'normal'
    case 'darken':
      return 'darken'
    case 'multiply':
      return 'multiply'
    case 'plus darker':
    case 'plus-darker':
    case 'linear burn':
    case 'linear-burn':
      return 'plus-darker' as CSSProperties['mixBlendMode']
    case 'color burn':
    case 'color-burn':
      return 'color-burn'
    case 'lighten':
      return 'lighten'
    case 'screen':
      return 'screen'
    case 'plus lighter':
    case 'plus-lighter':
    case 'linear dodge':
    case 'linear-dodge':
      return 'plus-lighter' as CSSProperties['mixBlendMode']
    case 'color dodge':
    case 'color-dodge':
      return 'color-dodge'
    case 'overlay':
      return 'overlay'
    case 'soft light':
    case 'soft-light':
      return 'soft-light'
    case 'hard light':
    case 'hard-light':
      return 'hard-light'
    case 'difference':
      return 'difference'
    case 'exclusion':
      return 'exclusion'
    case 'hue':
      return 'hue'
    case 'saturation':
      return 'saturation'
    case 'color':
      return 'color'
    case 'luminosity':
      return 'luminosity'
    default:
      return 'normal'
  }
}

/** Pass through keeps children able to blend with layers behind the group. */
export function cssIsolation(mode: string | undefined): CSSProperties['isolation'] {
  const key = (mode || DEFAULT_BLEND_MODE).trim().toLowerCase()
  if (key === 'pass through' || key === 'pass-through') return 'auto'
  // Non-pass-through layer blend: isolate so descendants don't blend through
  return 'isolate'
}

export function normalizeBlendMode(mode: string | undefined): string {
  if (!mode) return DEFAULT_BLEND_MODE
  const found = BLEND_MODES.find((item) => item.toLowerCase() === mode.trim().toLowerCase())
  if (found) return found
  // Legacy values from older builds
  const legacy = mode.trim().toLowerCase()
  if (legacy === 'normal') return 'Normal'
  return DEFAULT_BLEND_MODE
}
