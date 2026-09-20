/** Photo adjustments stored on image fills (each channel is -1…1, 0 = unchanged). */

export type ImageAdjust = {
  exposure?: number
  contrast?: number
  saturation?: number
  temperature?: number
  tint?: number
  highlights?: number
  shadows?: number
}

const KEYS: Array<keyof ImageAdjust> = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows'
]

export function imageAdjustActive(adjust?: ImageAdjust | null): boolean {
  if (!adjust) return false
  return KEYS.some((key) => Math.abs(adjust[key] || 0) > 0.0001)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

/** Tone curve: exposure, contrast, then shadow / highlight recovery. */
export function toneAt(input: number, adjust: ImageAdjust): number {
  let c = clamp01(input)
  const exposure = adjust.exposure || 0
  if (exposure) c *= Math.pow(2, exposure * 2)

  const contrast = 1 + (adjust.contrast || 0) * 0.85
  c = (c - 0.5) * contrast + 0.5

  const shadows = adjust.shadows || 0
  const highlights = adjust.highlights || 0
  if (shadows || highlights) {
    const lum = clamp01(c)
    c += shadows * 0.62 * Math.pow(1 - lum, 1.65)
    c += highlights * 0.45 * Math.pow(lum, 1.65)
  }
  return clamp01(c)
}

export function toneTable(adjust: ImageAdjust, steps = 33): string {
  const values: string[] = []
  for (let i = 0; i < steps; i++) values.push(toneAt(i / (steps - 1), adjust).toFixed(4))
  return values.join(' ')
}

export function saturateAmount(adjust: ImageAdjust): number {
  return Math.max(0, 1 + (adjust.saturation || 0))
}

/** White-balance matrix. Temperature + = warm, tint + = green. Identity at 0. */
export function whiteBalanceMatrix(adjust: ImageAdjust): string {
  const temperature = Math.max(-1, Math.min(1, adjust.temperature || 0))
  const tint = Math.max(-1, Math.min(1, adjust.tint || 0))
  const rScale = 1 + temperature * 0.22 - Math.min(0, tint) * 0.08
  const gScale = 1 + tint * 0.2 + Math.abs(temperature) * -0.02
  const bScale = 1 - temperature * 0.28 - Math.min(0, tint) * 0.06
  const rOff = temperature * 0.04 + Math.max(0, -tint) * 0.05
  const gOff = tint * 0.03
  const bOff = -temperature * 0.05 + Math.max(0, -tint) * 0.04
  return [
    rScale, 0, 0, 0, rOff,
    0, gScale, 0, 0, gOff,
    0, 0, bScale, 0, bOff,
    0, 0, 0, 1, 0
  ].join(' ')
}

export function imageAdjustFilterMarkup(adjust: ImageAdjust): string {
  const table = toneTable(adjust)
  return [
    `<feComponentTransfer>`,
    `<feFuncR type="table" tableValues="${table}"/>`,
    `<feFuncG type="table" tableValues="${table}"/>`,
    `<feFuncB type="table" tableValues="${table}"/>`,
    `</feComponentTransfer>`,
    `<feColorMatrix type="saturate" values="${saturateAmount(adjust)}"/>`,
    `<feColorMatrix type="matrix" values="${whiteBalanceMatrix(adjust)}"/>`
  ].join('')
}

/** CSS filter that stays correct under canvas zoom. Each slider moves the image. */
export function imageAdjustCss(adjust?: ImageAdjust | null): string | undefined {
  if (!imageAdjustActive(adjust) || !adjust) return undefined
  const exposure = adjust.exposure || 0
  const contrast = adjust.contrast || 0
  const saturation = adjust.saturation || 0
  const temperature = adjust.temperature || 0
  const tint = adjust.tint || 0
  const highlights = adjust.highlights || 0
  const shadows = adjust.shadows || 0

  const brightness = Math.pow(2, exposure * 1.5) * (1 + shadows * 0.32 + highlights * 0.14)
  const contrastAmt = Math.max(0.05, (1 + contrast) * (1 - shadows * 0.4) * (1 + highlights * 0.35))
  const sat = Math.max(0, 1 + saturation)
  const parts = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrastAmt.toFixed(3)})`,
    `saturate(${sat.toFixed(3)})`
  ]
  if (temperature > 0) {
    parts.push(`sepia(${(temperature * 0.55).toFixed(3)})`)
    parts.push(`saturate(${(1 + temperature * 0.45).toFixed(3)})`)
    parts.push(`hue-rotate(${(-12 * temperature).toFixed(2)}deg)`)
  } else if (temperature < 0) {
    const cool = -temperature
    parts.push(`hue-rotate(${(18 * cool).toFixed(2)}deg)`)
    parts.push(`saturate(${Math.max(0, 1 - cool * 0.25).toFixed(3)})`)
  }
  if (tint > 0) parts.push(`hue-rotate(${(28 * tint).toFixed(2)}deg)`)
  else if (tint < 0) parts.push(`hue-rotate(${(22 * tint).toFixed(2)}deg)`)
  return parts.join(' ')
}
