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

export function withAlpha(hex: string, alpha = 1): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha)})`
}

export function checkerboardCss(size = 8) {
  return `repeating-conic-gradient(#c8c8c8 0% 25%, #fff 0% 50%) 50% / ${size}px ${size}px`
}
