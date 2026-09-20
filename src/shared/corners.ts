/** Per-corner radii in CSS order: top-left, top-right, bottom-right, bottom-left. */
export type CornerRadii = {
  tl: number
  tr: number
  br: number
  bl: number
}

export function uniformRadii(value: number): CornerRadii {
  const r = Math.max(0, value)
  return { tl: r, tr: r, br: r, bl: r }
}

export function resolveCornerRadii(
  node: { radius?: number; cornerRadii?: CornerRadii | null },
  fallback = 0
): CornerRadii {
  if (node.cornerRadii) {
    return {
      tl: Math.max(0, node.cornerRadii.tl),
      tr: Math.max(0, node.cornerRadii.tr),
      br: Math.max(0, node.cornerRadii.br),
      bl: Math.max(0, node.cornerRadii.bl)
    }
  }
  return uniformRadii(node.radius ?? fallback)
}

export function cornersAreIndependent(radii: CornerRadii): boolean {
  return radii.tl !== radii.tr || radii.tr !== radii.br || radii.br !== radii.bl
}

/** Clamp each corner so it fits the box (Figma-style half-min limit). */
export function clampCornerRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const max = Math.max(0, Math.min(width, height) / 2)
  return {
    tl: Math.min(Math.max(0, radii.tl), max),
    tr: Math.min(Math.max(0, radii.tr), max),
    br: Math.min(Math.max(0, radii.br), max),
    bl: Math.min(Math.max(0, radii.bl), max)
  }
}

export function borderRadiusCss(radii: CornerRadii): string {
  const { tl, tr, br, bl } = radii
  if (tl === tr && tr === br && br === bl) return `${tl}px`
  return `${tl}px ${tr}px ${br}px ${bl}px`
}

/** SVG path for a rounded rect with independent corners at origin. */
export function roundedRectPath(width: number, height: number, radii: CornerRadii): string {
  const { tl, tr, br, bl } = clampCornerRadii(radii, width, height)
  const w = Math.max(0, width)
  const h = Math.max(0, height)
  const arc = (rx: number, ry: number, x: number, y: number) =>
    rx > 0 && ry > 0 ? `A ${rx} ${ry} 0 0 1 ${x} ${y}` : `L ${x} ${y}`
  return [
    `M ${tl} 0`,
    `H ${w - tr}`,
    arc(tr, tr, w, tr),
    `V ${h - br}`,
    arc(br, br, w - br, h),
    `H ${bl}`,
    arc(bl, bl, 0, h - bl),
    `V ${tl}`,
    arc(tl, tl, tl, 0),
    'Z'
  ].join(' ')
}
