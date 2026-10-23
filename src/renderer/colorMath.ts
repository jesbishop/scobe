/** Color space conversions for Figma-style picker (Hex / RGB / CSS / HSL / HSB). */

export type RGB = { r: number; g: number; b: number }
export type HSL = { h: number; s: number; l: number }
export type HSB = { h: number; s: number; b: number }

export function clamp(n: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, n))
}

export function parseHex(input: string, fallback = '#D9D9D9'): string {
  let value = input.trim()
  if (!value.startsWith('#')) value = `#${value}`
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toUpperCase()
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase()
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7).toUpperCase()
  return fallback.toUpperCase()
}

export function hexToRgb(hex: string): RGB {
  const value = parseHex(hex)
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16)
  }
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return { h: h * 360, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = ((h % 360) + 360) % 360 / 360
  const sn = clamp(s / 100)
  const ln = clamp(l / 100)
  if (sn === 0) {
    const v = Math.round(ln * 255)
    return { r: v, g: v, b: v }
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)
  }
}

export function rgbToHsb({ r, g, b }: RGB): HSB {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return { h: h * 360, s: max === 0 ? 0 : (d / max) * 100, b: max * 100 }
}

export function hsbToRgb({ h, s, b }: HSB): RGB {
  const hn = ((h % 360) + 360) % 360 / 360
  const sn = clamp(s / 100)
  const bn = clamp(b / 100)
  const i = Math.floor(hn * 6)
  const f = hn * 6 - i
  const p = bn * (1 - sn)
  const q = bn * (1 - f * sn)
  const t = bn * (1 - (1 - f) * sn)
  let rn = 0
  let gn = 0
  let bl = 0
  switch (i % 6) {
    case 0:
      rn = bn
      gn = t
      bl = p
      break
    case 1:
      rn = q
      gn = bn
      bl = p
      break
    case 2:
      rn = p
      gn = bn
      bl = t
      break
    case 3:
      rn = p
      gn = q
      bl = bn
      break
    case 4:
      rn = t
      gn = p
      bl = bn
      break
    default:
      rn = bn
      gn = p
      bl = q
  }
  return { r: Math.round(rn * 255), g: Math.round(gn * 255), b: Math.round(bl * 255) }
}

export function hexToHsb(hex: string): HSB {
  return rgbToHsb(hexToRgb(hex))
}

export function hsbToHex(hsb: HSB): string {
  return rgbToHex(hsbToRgb(hsb))
}

export type LCH = { l: number; c: number; h: number }

function srgbToLinear(c: number) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(c: number) {
  const v = clamp(c)
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))
}

export function rgbToLch({ r, g, b }: RGB): LCH {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)
  const x = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  const xn = x / 0.95047
  const yn = y / 1
  const zn = z / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(xn)
  const fy = f(yn)
  const fz = f(zn)
  const L = 116 * fy - 16
  const a = 500 * (fx - fy)
  const bb = 200 * (fy - fz)
  const C = Math.sqrt(a * a + bb * bb)
  let H = (Math.atan2(bb, a) * 180) / Math.PI
  if (H < 0) H += 360
  return { l: L, c: C, h: H }
}

export function lchToRgb({ l, c, h }: LCH): RGB {
  const hr = (h * Math.PI) / 180
  const a = Math.cos(hr) * c
  const b = Math.sin(hr) * c
  const fy = (l + 16) / 116
  const fx = a / 500 + fy
  const fz = fy - b / 200
  const finv = (t: number) => {
    const t3 = t * t * t
    return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787
  }
  const x = 0.95047 * finv(fx)
  const y = 1 * finv(fy)
  const z = 1.08883 * finv(fz)
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
  const G = x * -0.969266 + y * 1.8760108 + z * 0.041556
  const B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
  return { r: linearToSrgb(R), g: linearToSrgb(G), b: linearToSrgb(B) }
}

export function withAlpha(hex: string, alpha = 1): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`
}

/** Map a light canvas fill to a dark-mode companion (preserves hue). */
export function deriveDarkCanvasFill(hex: string): string {
  const parsed = parseHex(hex, '#EEEEEE')
  if (/^#(EEE(?:EEE)?|E8E8E8|F5F5F5|FAFAFA|F0F0F0|FFFFFF)$/i.test(parsed)) return '#2C2C2C'
  if (/^#2C2C2C$/i.test(parsed)) return '#2C2C2C'
  const hsl = rgbToHsl(hexToRgb(parsed))
  if (hsl.l <= 40) {
    return rgbToHex(hslToRgb({ h: hsl.h, s: Math.min(hsl.s, 28), l: Math.max(12, Math.min(hsl.l, 28)) }))
  }
  const nextL = Math.max(12, Math.min(28, 100 - hsl.l * 0.82))
  const nextS = Math.min(hsl.s * 0.55, 32)
  return rgbToHex(hslToRgb({ h: hsl.h, s: nextS, l: nextL }))
}

export function resolvePageFill(
  page: { fill?: string; fillDark?: string; fillHidden?: boolean },
  theme: 'light' | 'dark'
): string {
  if (page.fillHidden) return theme === 'dark' ? '#2C2C2C' : '#EEEEEE'
  if (theme === 'dark') {
    return parseHex(page.fillDark || deriveDarkCanvasFill(page.fill || '#EEEEEE'), '#2C2C2C')
  }
  return parseHex(page.fill || '#EEEEEE', '#EEEEEE')
}

export function checkerboardCss(size = 8) {
  return `repeating-conic-gradient(#c8c8c8 0% 25%, #fff 0% 50%) 50% / ${size}px ${size}px`
}
