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
const loadedKeys = new Set<string>()
const pending = new Map<string, Promise<void>>()

export function allGoogleFonts(): GoogleFontEntry[] {
  return GOOGLE_FONTS
}

export function findGoogleFont(family: string | undefined): GoogleFontEntry | null {
  if (!family) return null
  const bare = family.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || ''
  return byFamily.get(bare.toLowerCase()) || null
}

export function isGoogleFont(family: string | undefined): boolean {
  return Boolean(findGoogleFont(family))
}

/** CSS font-family value with proper quoting for multi-word Google fonts. */
export function cssFontFamily(family?: string, fallback = 'system-ui, sans-serif'): string {
  const raw = (family || 'Inter').split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || 'Inter'
  const quoted = `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  return `${quoted}, ${fallback}`
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
  if (entry.axes.includes('wght')) {
    return entry.variants.some((variant) => variant.endsWith('i'))
      ? FONT_STYLE_OPTIONS
      : FONT_STYLE_OPTIONS.filter((option) => !option.italic)
  }
  return FONT_STYLE_OPTIONS.filter((option) => option.id === '400')
}

/** Pick the closest available style when switching families (e.g. Bold → Regular). */
export function nearestFontStyle(
  family: string | undefined,
  weight: number | string | undefined,
  italic = false
): FontStyleOption {
  const options = stylesForFamily(family)
  const want = Math.round(Number(weight) || 400)
  const sameSlope = options.filter((option) => option.italic === italic)
  const pool = sameSlope.length ? sameSlope : options
  return (
    pool.reduce((best, option) =>
      Math.abs(option.weight - want) < Math.abs(best.weight - want) ? option : best
    ) || options[0] || FONT_STYLE_OPTIONS[3]
  )
}

export function familyHasVariableAxes(family: string | undefined): boolean {
  const entry = findGoogleFont(family)
  return Boolean(entry?.axes?.length)
}

function googleFontsHref(entry: GoogleFontEntry, weight: number, italic: boolean): string {
  const familyParam = encodeURIComponent(entry.family).replace(/%20/g, '+')
  const hasItalic = entry.variants.some((variant) => variant.endsWith('i'))
  const variable = entry.axes.includes('wght')

  const weights = new Set<number>()
  for (const variant of entry.variants) {
    const numeric = Number.parseInt(variant, 10)
    if (Number.isFinite(numeric)) weights.add(numeric)
  }
  weights.add(Math.round(weight) || 400)
  if (!weights.size) weights.add(400)

  if (variable) {
    const sorted = [...weights].sort((a, b) => a - b)
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    if (hasItalic) {
      return `https://fonts.googleapis.com/css2?family=${familyParam}:ital,wght@0,${min}..${max};1,${min}..${max}&display=swap`
    }
    return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${min}..${max}&display=swap`
  }

  const sorted = [...weights].sort((a, b) => a - b)
  if (hasItalic) {
    // Only request italic pairs the family actually ships.
    const pairs: string[] = []
    for (const w of sorted) {
      if (entry.variants.includes(String(w))) pairs.push(`0,${w}`)
    }
    for (const w of sorted) {
      if (entry.variants.includes(`${w}i`)) pairs.push(`1,${w}`)
    }
    // Ensure the currently requested face is included when valid.
    const want = `${italic ? '1' : '0'},${Math.round(weight) || 400}`
    if (!pairs.includes(want) && entry.variants.includes(fontStyleId(weight, italic))) {
      pairs.push(want)
    }
    if (!pairs.length) pairs.push('0,400')
    return `https://fonts.googleapis.com/css2?family=${familyParam}:ital,wght@${pairs.join(';')}&display=swap`
  }

  if (sorted.length === 1 && sorted[0] === 400) {
    return `https://fonts.googleapis.com/css2?family=${familyParam}&display=swap`
  }
  return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${sorted.join(';')}&display=swap`
}

/** Icon fonts aren't in the text catalog but Snapshot imports their glyphs as live icons. */
const ICON_FONT_PARAMS: Record<string, string> = {
  'material symbols outlined': 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'material symbols rounded': 'Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'material symbols sharp': 'Material+Symbols+Sharp:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
  'material icons': 'Material+Icons',
  'material icons outlined': 'Material+Icons+Outlined',
  'material icons round': 'Material+Icons+Round',
  'material icons sharp': 'Material+Icons+Sharp',
  'material icons two tone': 'Material+Icons+Two+Tone'
}

function ensureIconFontLoaded(family: string): Promise<void> | null {
  const bare = family.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || ''
  const param = ICON_FONT_PARAMS[bare.toLowerCase()]
  if (!param) return null
  const key = `icon::${bare.toLowerCase()}`
  const existing = pending.get(key)
  if (existing) return existing
  const run = (async () => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.crossOrigin = 'anonymous'
    link.dataset.vantaFont = bare
    await new Promise<void>((resolve) => {
      link.addEventListener('load', () => resolve(), { once: true })
      link.addEventListener('error', () => resolve(), { once: true })
      window.setTimeout(resolve, 4000)
      link.href = `https://fonts.googleapis.com/css2?family=${param}&display=block`
      document.head.appendChild(link)
    })
    try {
      await document.fonts.load(`400 24px ${cssFontFamily(bare)}`)
    } catch {
      /* glyph falls back to its ligature name until the font arrives */
    }
  })()
  pending.set(key, run)
  return run
}

/** Inject a Google Fonts stylesheet and wait until the face can paint. */
export function ensureGoogleFontLoaded(
  family: string,
  weight: number | string = 400,
  italic = false
): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve()
  const icon = ensureIconFontLoaded(family)
  if (icon) return icon
  const entry = findGoogleFont(family)
  if (!entry) return Promise.resolve()

  const style = nearestFontStyle(entry.family, weight, italic)
  const href = googleFontsHref(entry, style.weight, style.italic)
  const key = `${entry.family}::${href}`

  const existing = pending.get(key)
  if (existing) return existing

  const run = (async () => {
    if (!loadedKeys.has(key)) {
      const attr = entry.family.replace(/"/g, '')
      let link = document.querySelector(`link[data-vanta-font="${attr}"]`) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.rel = 'stylesheet'
        link.crossOrigin = 'anonymous'
        link.dataset.vantaFont = entry.family
        document.head.appendChild(link)
      }
      if (link.getAttribute('href') !== href) {
        await new Promise<void>((resolve) => {
          let settled = false
          const done = () => {
            if (settled) return
            settled = true
            resolve()
          }
          link!.addEventListener('load', done, { once: true })
          link!.addEventListener('error', done, { once: true })
          link!.href = href
          window.setTimeout(done, 2500)
        })
      }
      loadedKeys.add(key)
    }

    const face = `${style.italic ? 'italic ' : ''}${style.weight} 16px ${cssFontFamily(entry.family)}`
    try {
      await document.fonts.load(face)
      await document.fonts.ready
    } catch {
      /* ignore — browser will fall back until the face arrives */
    }
  })()

  pending.set(key, run)
  return run
}

export function searchGoogleFonts(query: string, limit = 400): GoogleFontEntry[] {
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
