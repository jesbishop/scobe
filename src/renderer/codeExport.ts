import type { DesignNode } from '../shared/types'
import { getNodePaints, gradientCss, type Paint } from '../shared/paint'
import { getNodeEffects } from '../shared/effects'
import { isAutoLayout, normalizePadding } from '../shared/layoutEngine'
import { parseHex, withAlpha } from './colorMath'
import { decorationColor } from './textLayout'

/** Ordered CSS declarations (kebab-case property → value). */
type Decls = Array<[string, string]>

const px = (value: number) => `${Math.round(value * 100) / 100}px`

function color(hex: string | undefined, alpha = 1, fallback = '#000000'): string {
  const value = parseHex(hex || fallback, fallback)
  return alpha >= 1 ? value : withAlpha(value, alpha)
}

function paintLayer(paint: Paint, size: { width: number; height: number }): string | null {
  if (paint.type === 'solid') {
    const c = color(paint.color, paint.opacity)
    return `linear-gradient(${c}, ${c})`
  }
  if (paint.type === 'gradient') return gradientCss(paint, size)
  if (paint.type === 'image') {
    const src = paint.imageDataUrl && !paint.imageDataUrl.startsWith('data:') ? paint.imageDataUrl : 'image.png'
    return `url(${src})`
  }
  return null
}

function fillDecls(node: DesignNode, size: { width: number; height: number }): Decls {
  const paints = getNodePaints(node).filter((paint) => paint.visible !== false)
  if (!paints.length) {
    const shapeDefault = node.type === 'rect' || node.type === 'ellipse' || node.type === 'polygon' || node.type === 'star'
    return shapeDefault ? [['background-color', '#D9D9D9']] : []
  }
  if (paints.length === 1 && paints[0].type === 'solid') {
    return [['background-color', color(paints[0].color, paints[0].opacity)]]
  }
  const layers = paints.map((paint) => paintLayer(paint, size)).filter((layer): layer is string => Boolean(layer))
  if (!layers.length) return []
  const decls: Decls = [['background-image', layers.join(', ')]]
  if (paints.some((paint) => paint.type === 'image')) {
    decls.push(['background-size', 'cover'], ['background-position', 'center'])
  }
  return decls
}

function textColor(node: DesignNode): string {
  const paint = getNodePaints(node).find((item) => item.visible !== false)
  if (paint?.type === 'solid') return color(paint.color, paint.opacity)
  if (paint?.type === 'gradient') return color(paint.stops[0]?.color, paint.opacity)
  return color(node.fill, node.fillOpacity ?? 1)
}

function radiusValue(node: DesignNode): string | null {
  if (node.type === 'ellipse') return '50%'
  const r = node.cornerRadii
  if (r && (r.tl || r.tr || r.br || r.bl)) {
    if (r.tl === r.tr && r.tr === r.br && r.br === r.bl) return px(r.tl)
    return `${px(r.tl)} ${px(r.tr)} ${px(r.br)} ${px(r.bl)}`
  }
  return node.radius ? px(node.radius) : null
}

function strokeDecls(node: DesignNode): Decls {
  const width = node.strokeWidth || 0
  if (!width || node.type === 'text') return []
  const c = color(node.stroke, node.strokeOpacity ?? 1, '#1A1A1A')
  const align = node.strokeAlign || 'inside'
  if (align === 'inside') return [['border', `${px(width)} solid ${c}`], ['box-sizing', 'border-box']]
  if (align === 'outside') return [['outline', `${px(width)} solid ${c}`]]
  return [['outline', `${px(width)} solid ${c}`], ['outline-offset', px(-width / 2)]]
}

function effectDecls(node: DesignNode): Decls {
  const decls: Decls = []
  const shadows: string[] = []
  const filters: string[] = []
  let backdrop = ''
  for (const fx of getNodeEffects(node)) {
    if (fx.visible === false) continue
    if (fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW') {
      const c = color(fx.color, fx.opacity ?? 0.25)
      const parts = [px(fx.offsetX ?? 0), px(fx.offsetY ?? 4), px(fx.radius ?? 4), px(fx.spread ?? 0), c]
      shadows.push(`${fx.type === 'INNER_SHADOW' ? 'inset ' : ''}${parts.join(' ')}`)
    } else if (fx.type === 'LAYER_BLUR' && fx.radius) {
      filters.push(`blur(${px(fx.radius / 2)})`)
    } else if (fx.type === 'BACKGROUND_BLUR' && fx.radius) {
      backdrop = `blur(${px(fx.radius / 2)})`
    }
  }
  if (shadows.length) decls.push(['box-shadow', shadows.join(', ')])
  if (filters.length) decls.push(['filter', filters.join(' ')])
  if (backdrop) decls.push(['backdrop-filter', backdrop])
  return decls
}

function transformDecl(node: DesignNode): Decls {
  const parts: string[] = []
  if (node.flipX) parts.push('scaleX(-1)')
  if (node.flipY) parts.push('scaleY(-1)')
  if (node.rotation) parts.push(`rotate(${Math.round(node.rotation * 100) / 100}deg)`)
  return parts.length ? [['transform', parts.join(' ')]] : []
}

function textDecls(node: DesignNode): Decls {
  const decls: Decls = [['color', textColor(node)]]
  decls.push(['font-family', `'${node.fontFamily || 'Inter'}', system-ui, sans-serif`])
  decls.push(['font-size', px(node.fontSize || 12)])
  const weight = node.fontWeight ?? 400
  if (String(weight) !== '400') decls.push(['font-weight', String(weight)])
  if (node.fontStyle === 'italic') decls.push(['font-style', 'italic'])
  if (node.lineHeight) decls.push(['line-height', px(node.lineHeight)])
  if (node.letterSpacing) {
    const unit = node.letterSpacingUnit || 'percent'
    decls.push(['letter-spacing', unit === 'px' ? px(node.letterSpacing) : `${Math.round(node.letterSpacing) / 100}em`])
  }
  if (node.textAlign && node.textAlign !== 'left') decls.push(['text-align', node.textAlign])
  if (node.textDecoration && node.textDecoration !== 'none') {
    decls.push(['text-decoration', node.textDecoration])
    if (node.textDecorationStyle && node.textDecorationStyle !== 'solid') decls.push(['text-decoration-style', node.textDecorationStyle])
    if (node.textDecorationThickness != null) {
      decls.push(['text-decoration-thickness', `${+(node.textDecorationThickness / 100).toFixed(3)}em`])
    }
    if (node.textUnderlineOffset != null) {
      decls.push(['text-underline-offset', `${+(node.textUnderlineOffset / 100).toFixed(3)}em`])
    }
    if (node.textDecorationSkipInk === false) decls.push(['text-decoration-skip-ink', 'none'])
    const decoColor = decorationColor(node)
    if (decoColor) decls.push(['text-decoration-color', decoColor])
  }
  const textCase = node.textCase
  if (textCase === 'upper') decls.push(['text-transform', 'uppercase'])
  else if (textCase === 'lower') decls.push(['text-transform', 'lowercase'])
  else if (textCase === 'title') decls.push(['text-transform', 'capitalize'])
  else if (textCase === 'small-caps') decls.push(['font-variant', 'small-caps'])
  if (node.paragraphIndent) decls.push(['text-indent', px(node.paragraphIndent)])
  if (node.leadingTrim === 'cap') decls.push(['text-box', 'trim-both cap alphabetic'])
  if (node.textWrapStyle && node.textWrapStyle !== 'auto') decls.push(['text-wrap-style', node.textWrapStyle])
  const numeric = [
    node.numberStyle === 'lining' ? 'lining-nums' : node.numberStyle === 'oldstyle' ? 'oldstyle-nums' : '',
    node.numberSpacing === 'tabular' ? 'tabular-nums' : node.numberSpacing === 'proportional' ? 'proportional-nums' : '',
    node.fractions ? 'diagonal-fractions' : '',
    node.slashedZero ? 'slashed-zero' : ''
  ].filter(Boolean)
  if (numeric.length) decls.push(['font-variant-numeric', numeric.join(' ')])
  if (node.ligatures === false) decls.push(['font-variant-ligatures', 'no-common-ligatures'])
  if (node.textTruncation) {
    decls.push(['overflow', 'hidden'])
    decls.push(['display', '-webkit-box'])
    decls.push(['-webkit-line-clamp', String(node.maxLines || 1)])
    decls.push(['-webkit-box-orient', 'vertical'])
  }
  if (node.textResize === 'auto-width') decls.push(['white-space', 'pre'])
  else decls.push(['white-space', 'pre-wrap'])
  return decls
}

const JUSTIFY: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' }
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }

function layoutDecls(node: DesignNode): Decls {
  const layout = node.layout
  if (!layout || !isAutoLayout(node)) return []
  const decls: Decls = [['display', 'flex']]
  if (layout.mode === 'vertical') decls.push(['flex-direction', 'column'])
  if (layout.wrap) decls.push(['flex-wrap', 'wrap'])
  const spaceBetween = layout.gap === 'auto' || layout.justifyContent === 'space-between'
  const justify = spaceBetween ? 'space-between' : layout.justifyContent || 'start'
  if (justify !== 'start') decls.push(['justify-content', JUSTIFY[justify]])
  const align = layout.alignItems || 'start'
  if (align !== 'stretch') decls.push(['align-items', ALIGN[align]])
  if (!spaceBetween && typeof layout.gap === 'number' && layout.gap > 0) {
    const counter = layout.wrap && typeof layout.counterGap === 'number' ? layout.counterGap : null
    if (counter != null && counter !== layout.gap) {
      decls.push(layout.mode === 'vertical' ? ['column-gap', px(counter)] : ['row-gap', px(counter)])
      decls.push(layout.mode === 'vertical' ? ['row-gap', px(layout.gap)] : ['column-gap', px(layout.gap)])
    } else decls.push(['gap', px(layout.gap)])
  }
  const pad = normalizePadding(layout.padding)
  if (pad.t || pad.r || pad.b || pad.l) {
    decls.push([
      'padding',
      pad.t === pad.b && pad.l === pad.r
        ? pad.t === pad.l
          ? px(pad.t)
          : `${px(pad.t)} ${px(pad.r)}`
        : `${px(pad.t)} ${px(pad.r)} ${px(pad.b)} ${px(pad.l)}`
    ])
  }
  return decls
}

function sizeDecls(node: DesignNode, parent: DesignNode | null, inFlow: boolean): Decls {
  const decls: Decls = []
  const width = Math.max(0, node.width || 0)
  const height = Math.max(0, node.height || (node.type === 'text' ? (node.fontSize || 12) * 1.2 : 0))
  const parentVertical = parent?.layout?.mode === 'vertical'
  const hMode = inFlow ? node.layoutSizingH : node.layout?.sizingH
  const vMode = inFlow ? node.layoutSizingV : node.layout?.sizingV
  const textAutoW = node.type === 'text' && node.textResize === 'auto-width'
  const textAutoH = node.type === 'text' && (node.textResize === 'auto-width' || node.textResize === 'auto-height')

  if (inFlow && hMode === 'fill') {
    if (parentVertical) decls.push(['align-self', 'stretch'])
    else decls.push(['flex', '1 1 0%'], ['min-width', '0'])
  } else if (inFlow && hMode === 'relative' && node.layoutPercentH) {
    decls.push(['width', `${node.layoutPercentH}%`])
  } else if (hMode !== 'hug' && !textAutoW) {
    decls.push(['width', px(width)])
  }

  if (inFlow && vMode === 'fill') {
    if (parentVertical) decls.push(['flex', '1 1 0%'], ['min-height', '0'])
    else decls.push(['align-self', 'stretch'])
  } else if (inFlow && vMode === 'relative' && node.layoutPercentV) {
    decls.push(['height', `${node.layoutPercentV}%`])
  } else if (vMode !== 'hug' && !textAutoH) {
    decls.push(['height', px(height)])
  }

  if (inFlow && hMode !== 'fill' && vMode !== 'fill') decls.push(['flex-shrink', '0'])
  return decls
}

function nodeDecls(node: DesignNode, parent: DesignNode | null, isRoot: boolean, hasKids: boolean): Decls {
  const inFlow = Boolean(parent && isAutoLayout(parent) && !node.layoutAbsolute)
  const decls: Decls = []
  if (!isRoot && !inFlow) {
    decls.push(['position', 'absolute'], ['left', px(node.x || 0)], ['top', px(node.y || 0)])
  } else if (hasKids) {
    decls.push(['position', 'relative'])
  }
  decls.push(...layoutDecls(node))
  decls.push(...sizeDecls(node, parent, inFlow))
  const size = { width: node.width || 0, height: node.height || 0 }
  if (node.type === 'text') decls.push(...textDecls(node))
  else if (node.type !== 'image' && node.type !== 'line' && node.type !== 'arrow') decls.push(...fillDecls(node, size))
  if (node.type === 'line' || node.type === 'arrow') {
    decls.push(['border-top', `${px(node.strokeWidth || 1)} solid ${color(node.stroke || node.fill, node.strokeOpacity ?? 1, '#1A1A1A')}`])
  } else {
    decls.push(...strokeDecls(node))
  }
  const radius = radiusValue(node)
  if (radius) decls.push(['border-radius', radius])
  if ((node.type === 'frame' && node.clipsContent !== false && hasKids) || node.type === 'image') decls.push(['overflow', 'hidden'])
  if (node.opacity != null && node.opacity < 1) decls.push(['opacity', String(Math.round(node.opacity * 100) / 100)])
  decls.push(...effectDecls(node))
  decls.push(...transformDecl(node))
  if (node.blendMode && node.blendMode !== 'normal' && node.blendMode !== 'pass-through') {
    decls.push(['mix-blend-mode', node.blendMode])
  }
  if (node.type === 'image') decls.push(['object-fit', 'cover'])
  return decls
}

// ---------- React inline styles ----------

const camel = (prop: string) => prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

function styleObject(decls: Decls): string {
  if (!decls.length) return ''
  const body = decls.map(([prop, value]) => `${camel(prop)}: ${JSON.stringify(value)}`).join(', ')
  return ` style={{ ${body} }}`
}

// ---------- Tailwind ----------

const arb = (value: string) => value.replace(/\s+/g, '_')

const TW_KEYWORDS: Record<string, Record<string, string>> = {
  display: { flex: 'flex' },
  'flex-direction': { column: 'flex-col' },
  'flex-wrap': { wrap: 'flex-wrap' },
  'justify-content': { 'flex-start': 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', 'space-between': 'justify-between' },
  'align-items': { 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end', stretch: 'items-stretch' },
  'align-self': { stretch: 'self-stretch' },
  position: { absolute: 'absolute', relative: 'relative' },
  overflow: { hidden: 'overflow-hidden' },
  'box-sizing': { 'border-box': 'box-border' },
  'flex-shrink': { '0': 'shrink-0' },
  flex: { '1 1 0%': 'flex-1' },
  'text-align': { center: 'text-center', right: 'text-right', justify: 'text-justify' },
  'font-style': { italic: 'italic' },
  'text-decoration': { underline: 'underline', 'line-through': 'line-through' },
  'text-transform': { uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize' },
  'font-variant': { 'small-caps': '[font-variant:small-caps]' },
  'white-space': { pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap' },
  'object-fit': { cover: 'object-cover' },
  'background-size': { cover: 'bg-cover' },
  'background-position': { center: 'bg-center' }
}

const TW_PREFIX: Record<string, string> = {
  width: 'w',
  height: 'h',
  'min-width': 'min-w',
  'min-height': 'min-h',
  left: 'left',
  top: 'top',
  gap: 'gap',
  'row-gap': 'gap-y',
  'column-gap': 'gap-x',
  'background-color': 'bg',
  color: 'text',
  'font-size': 'text',
  'font-weight': 'font',
  'line-height': 'leading',
  'letter-spacing': 'tracking',
  'border-radius': 'rounded',
  opacity: 'opacity',
  'box-shadow': 'shadow',
  'outline-offset': 'outline-offset',
  'mix-blend-mode': 'mix-blend'
}

function twClass(prop: string, value: string): string[] {
  const keyword = TW_KEYWORDS[prop]?.[value]
  if (keyword) return [keyword]
  if (prop === 'padding') {
    const parts = value.split(' ')
    if (parts.length === 1) return [`p-[${parts[0]}]`]
    if (parts.length === 2) return [`py-[${parts[0]}]`, `px-[${parts[1]}]`]
    return [`pt-[${parts[0]}]`, `pr-[${parts[1]}]`, `pb-[${parts[2]}]`, `pl-[${parts[3]}]`]
  }
  if (prop === 'font-family') {
    const family = value.split(',')[0].replace(/'/g, '').trim()
    return [`font-['${arb(family)}']`]
  }
  if (prop === 'border' || prop === 'outline' || prop === 'border-top') {
    const [width, style, ...rest] = value.split(' ')
    const side = prop === 'border-top' ? 'border-t' : prop
    const kind = prop === 'outline' ? 'outline' : 'border'
    const styleClass = kind === 'outline' ? `[outline-style:${style}]` : `border-${style}`
    return [`${side}-[${width}]`, styleClass, `${kind}-[${arb(rest.join(' '))}]`]
  }
  if (prop === 'background-image') return [`bg-[image:${arb(value)}]`]
  if (prop === 'transform') {
    return value.split(' ').map((part) => {
      if (part === 'scaleX(-1)') return '-scale-x-100'
      if (part === 'scaleY(-1)') return '-scale-y-100'
      const deg = part.match(/^rotate\((.+)\)$/)?.[1]
      return deg ? `rotate-[${deg}]` : `[transform:${arb(part)}]`
    })
  }
  if (prop === 'filter' || prop === 'backdrop-filter') {
    const radius = value.match(/^blur\((.+)\)$/)?.[1]
    if (radius) return [`${prop === 'filter' ? 'blur' : 'backdrop-blur'}-[${radius}]`]
  }
  const prefix = TW_PREFIX[prop]
  if (prefix) return [`${prefix}-[${arb(value)}]`]
  return [`[${prop}:${arb(value)}]`]
}

function classAttr(decls: Decls): string {
  if (!decls.length) return ''
  return ` className="${decls.flatMap(([prop, value]) => twClass(prop, value)).join(' ')}"`
}

// ---------- Tree → JSX ----------

function jsxText(text: string): string {
  if (!text) return ''
  if (/[{}<>]/.test(text) || text.includes('\n')) return `{${JSON.stringify(text)}}`
  return text
}

function componentName(node: DesignNode): string {
  const words = (node.name || node.type || 'Component').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/)
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return /^[A-Za-z]/.test(name) ? name : `Layer${name}`
}

function renderNode(
  node: DesignNode,
  parent: DesignNode | null,
  all: DesignNode[],
  depth: number,
  tailwind: boolean,
  isRoot: boolean
): string[] {
  const pad = '  '.repeat(depth)
  const kids = all.filter((item) => item.parentId === node.id && item.visible !== false && item.type !== 'comment')
  const decls = nodeDecls(node, parent, isRoot, kids.length > 0)
  const attrs = tailwind ? classAttr(decls) : styleObject(decls)
  if (node.type === 'image') return [`${pad}<img src="image.png" alt="${(node.name || '').replace(/"/g, '')}"${attrs} />`]
  if (node.type === 'text') {
    const text = jsxText(node.text || '')
    return text ? [`${pad}<div${attrs}>${text}</div>`] : [`${pad}<div${attrs} />`]
  }
  if (node.type === 'path' || node.svgMarkup) {
    return [`${pad}{/* ${node.name || 'Vector'} */}`, `${pad}<div${attrs} />`]
  }
  if (!kids.length) return [`${pad}<div${attrs} />`]
  return [
    `${pad}<div${attrs}>`,
    ...kids.flatMap((kid) => renderNode(kid, node, all, depth + 1, tailwind, false)),
    `${pad}</div>`
  ]
}

/** React component source for the selected layers (inline styles or Tailwind classes). */
export function nodesToReact(roots: DesignNode[], all: DesignNode[], opts: { tailwind: boolean }): string {
  const visible = roots.filter((node) => node.type !== 'comment')
  if (!visible.length) return ''
  const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  const name = visible.length === 1 ? componentName(visible[0]) : 'Selection'
  const body =
    visible.length === 1
      ? renderNode(visible[0], null, all, 2, opts.tailwind, true)
      : ['    <>', ...visible.flatMap((node) => renderNode(node, null, all, 3, opts.tailwind, true)), '    </>']
  return [
    '/**',
    ' * from Scobe',
    ` * on ${date}`,
    ' */',
    `export default function ${name}() {`,
    '  return (',
    ...body,
    '  );',
    '}',
    ''
  ].join('\n')
}
