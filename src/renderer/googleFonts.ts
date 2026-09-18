import catalog from './data/googleFonts.json'

export type GoogleFontEntry = {
  family: string
  category: string
  variants: string[]
  axes: string[]
  popularity: number
}

export type FontStyleOption = {
  id: string
  label: string
  weight: number
  italic: boolean
}

/** Figma-style weight / style menu. */
export const FONT_STYLE_OPTIONS: FontStyleOption[] = [
  { id: '100', label: 'Thin', weight: 100, italic: false },
  { id: '200', label: 'Extra Light', weight: 200, italic: false },
  { id: '300', label: 'Light', weight: 300, italic: false },
  { id: '400', label: 'Regular', weight: 400, italic: false },
  { id: '500', label: 'Medium', weight: 500, italic: false },
  { id: '600', label: 'Semi Bold', weight: 600, italic: false },
  { id: '700', label: 'Bold', weight: 700, italic: false },
  { id: '800', label: 'Extra Bold', weight: 800, italic: false },
  { id: '900', label: 'Black', weight: 900, italic: false },
  { id: '100i', label: 'Thin Italic', weight: 100, italic: true },
  { id: '200i', label: 'Extra Light Italic', weight: 200, italic: true },
  { id: '300i', label: 'Light Italic', weight: 300, italic: true },
  { id: '400i', label: 'Italic', weight: 400, italic: true },
  { id: '500i', label: 'Medium Italic', weight: 500, italic: true },
  { id: '600i', label: 'Semi Bold Italic', weight: 600, italic: true },
  { id: '700i', label: 'Bold Italic', weight: 700, italic: true },
  { id: '800i', label: 'Extra Bold Italic', weight: 800, italic: true },
  { id: '900i', label: 'Black Italic', weight: 900, italic: true }
]

export const SYSTEM_FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'system-ui']

const GOOGLE_FONTS: GoogleFontEntry[] = (catalog as { fonts: GoogleFontEntry[] }).fonts || []
const byFamily = new Map(GOOGLE_FONTS.map((font) => [font.family.toLowerCase(), font]))
const loaded = new Set<string>()

export function allGoogleFonts(): GoogleFontEntry[] {
  return GOOGLE_FONTS
}

export function findGoogleFont(family: string | undefined): GoogleFontEntry | null {
  if (!family) return null
  return byFamily.get(family.toLowerCase()) || null
}

export function isGoogleFont(family: string | undefined): boolean {
  return Boolean(findGoogleFont(family))
}

export function fontStyleId(weight: number | string | undefined, italic?: boolean): string {
  const n = Math.round(Number(weight) || 400)
  const snapped = [100, 200, 300, 400, 500, 600, 700, 800, 900].reduce((best, value) =>
    Math.abs(value - n) < Math.abs(best - n) ? value : best
  )
  return italic ? `${snapped}i` : String(snapped)
}

export function fontStyleLabel(weight: number | string | undefined, italic?: boolean): string {
  const id = fontStyleId(weight, italic)
  return FONT_STYLE_OPTIONS.find((item) => item.id === id)?.label || 'Regular'
}

export function stylesForFamily(family: string | undefined): FontStyleOption[] {
  const entry = findGoogleFont(family)
  if (!entry) return FONT_STYLE_OPTIONS
  const available = new Set(entry.variants)
  const filtered = FONT_STYLE_OPTIONS.filter((option) => available.has(option.id))
  if (filtered.length) return filtered
  // Variable fonts often expose a continuous axis without discrete keys beyond a few.
  if (entry.axes.includes('wght')) return FONT_STYLE_OPTIONS
  return FONT_STYLE_OPTIONS.filter((option) => option.id === '400' || option.id === '700')
}

export function familyHasVariableAxes(family: string | undefined): boolean {
  const entry = findGoogleFont(family)
  return Boolean(entry?.axes?.length)
}

/** Inject a Google Fonts stylesheet for the family (idempotent). */
export function ensureGoogleFontLoaded(
  family: string,
  weight: number | string = 400,
  italic = false
): void {
  if (typeof document === 'undefined') return
  if (!isGoogleFont(family)) return
  const entry = findGoogleFont(family)
  if (!entry) return

  const weights = new Set<number>([400, 700, Math.round(Number(weight) || 400)])
  for (const variant of entry.variants) {
    const numeric = Number.parseInt(variant, 10)
    if (Number.isFinite(numeric)) weights.add(numeric)
  }

  const sorted = [...weights].sort((a, b) => a - b)
  const hasItalic = entry.variants.some((variant) => variant.endsWith('i')) || italic
  const axis = hasItalic
    ? `ital,wght@0,${sorted.join(';0,')};1,${sorted.join(';1,')}`
    : `wght@${sorted.join(';')}`
  const key = `${family}::${axis}`
  if (loaded.has(key)) return
  loaded.add(key)

  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`
  const attr = family.replace(/"/g, '')
  const existing = document.querySelector(`link[data-vanta-font="${attr}"]`) as HTMLLinkElement | null
  if (existing) {
    existing.href = href
    return
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.vantaFont = family
  document.head.appendChild(link)
}

export function searchGoogleFonts(query: string, limit = 80): GoogleFontEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return GOOGLE_FONTS.slice(0, limit)
  const scored: Array<{ font: GoogleFontEntry; score: number }> = []
  for (const font of GOOGLE_FONTS) {
    const name = font.family.toLowerCase()
    if (name === q) scored.push({ font, score: 0 })
    else if (name.startsWith(q)) scored.push({ font, score: 1 })
    else if (name.includes(q)) scored.push({ font, score: 2 })
  }
  scored.sort((a, b) => a.score - b.score || a.font.popularity - b.font.popularity)
  return scored.slice(0, limit).map((item) => item.font)
}
