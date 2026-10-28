import type { AutoLayout, ConstraintH, ConstraintV, DesignNode, LayoutSizing } from '../shared/types'
import type { JevChoiceQuestion, JevQuestions } from '../shared/jev'
import { BLEND_MODES } from '../shared/blendModes'
import { defaultEffect, getNodeEffects, syncLegacyEffectFields, type DesignEffect, type EffectType } from '../shared/effects'
import {
  defaultGradient,
  defaultShader,
  defaultSolid,
  getNodePaints,
  legacyFromPaints,
  SHADER_OPTIONS,
  type GradientKind,
  type ShaderKind,
  type ShaderPaint
} from '../shared/paint'
import { enableAutoLayoutOnFrame, isAutoLayout, normalizePadding } from '../shared/layoutEngine'
import { allGoogleFonts, ensureGoogleFontLoaded, SYSTEM_FONTS } from './googleFonts'
import { remeasureText } from './textLayout'
import { extractColor, NAMED_COLORS } from './jevEngine'
import { COMMAND_AREA_DESCRIPTIONS, COMMANDS, type CommandArea } from './jevCommands'

/**
 * Every inspector property chat can change. Jev picks a capability by its description;
 * the value always comes from the user's words (Jev only ever chooses).
 */

export type CapArea =
  | 'shape'
  | 'size'
  | 'corners'
  | 'fill'
  | 'stroke'
  | 'effects'
  | 'appearance'
  | 'typography'
  | 'layout'
  | 'sizing'
  | 'constraints'
  | 'frame'

type ChoiceOption = { label: string; words: RegExp }

type Param =
  | { kind: 'number'; unit: 'px' | '%' | 'deg'; min?: number; max?: number; step: number; allowAuto?: boolean }
  | { kind: 'choice'; options: Record<string, ChoiceOption> }
  | { kind: 'color' }
  | { kind: 'toggle'; on?: RegExp; off?: RegExp }
  | { kind: 'text' }
  | { kind: 'font' }
  | { kind: 'gradient' }
  | { kind: 'shader' }
  | { kind: 'action' }

type ApplyCtx = { nodes: DesignNode[]; request: string; unit?: string }
type ApplyOut = Partial<DesignNode> | DesignNode[]

export type Capability = {
  id: string
  area: CapArea
  label: string
  /** What Jev reads when choosing. */
  description: string
  /** Local trigger; a match plus a readable value applies instantly without Jev. */
  keywords: RegExp
  /** Skip the local trigger when this also matches (e.g. "border radius" is not a stroke). */
  unless?: RegExp
  param: Param
  appliesTo: (node: DesignNode, nodes: DesignNode[]) => boolean
  /** Current value; numbers drive relative edits ("a bit bigger", "by 4"). */
  read: (node: DesignNode) => unknown
  apply: (node: DesignNode, value: any, ctx: ApplyCtx) => ApplyOut
}

/** `request` overrides the words used to read the value (repeating an earlier edit). */
export type PropertyEdit = { id: string; value?: unknown; request?: string }

/** The previous property edit, so "thicker", "more" or "again" can continue it. */
export type LastEdit = { properties: string[]; request: string }

// ---- node predicates ----

const isText = (n: DesignNode) => n.type === 'text'
const isFrame = (n: DesignNode) => n.type === 'frame' || n.type === 'section'
const isComment = (n: DesignNode) => n.type === 'comment'
const hasBox = (n: DesignNode) => !isComment(n) && n.type !== 'line' && n.type !== 'arrow'
const canFill = (n: DesignNode) => !isComment(n) && n.type !== 'line' && n.type !== 'arrow'
const canStroke = (n: DesignNode) => !isComment(n)
/** Lines, arrows and open paths: the stroke is the line itself, so it has ends but no inside/outside. */
const isOpenLine = (n: DesignNode) => n.type === 'line' || n.type === 'arrow' || (n.type === 'path' && !n.closed)
/** Lines draw at 2px until a weight is set; everything else needs a weight above 0. */
const hasVisibleStroke = (n: DesignNode) =>
  n.type === 'line' || n.type === 'arrow' ? (n.strokeWidth ?? 2) > 0 : (n.strokeWidth ?? 0) > 0

/** Same starting stroke the inspector's "+" adds; empty when the layer already has one. */
function strokeBase(n: DesignNode): Partial<DesignNode> {
  if (hasVisibleStroke(n)) return {}
  return {
    stroke: n.stroke || (n.type === 'section' ? '#000000' : '#1A1A1A'),
    strokeWidth: n.type === 'line' || n.type === 'arrow' ? 2 : 1,
    strokeOpacity: n.type === 'section' ? 0.1 : 1,
    strokeAlign: n.strokeAlign || (n.type === 'line' || n.type === 'arrow' || n.type === 'path' ? 'center' : 'inside')
  }
}
const anyLayer = (n: DesignNode) => !isComment(n)
const parentOf = (n: DesignNode, nodes: DesignNode[]) => (n.parentId ? nodes.find((p) => p.id === n.parentId) : undefined)
const inFlex = (n: DesignNode, nodes: DesignNode[]) => {
  const parent = parentOf(n, nodes)
  return Boolean(parent && isAutoLayout(parent))
}
const hasRoundableCorners = (n: DesignNode) =>
  ['frame', 'section', 'rect', 'image', 'widget'].includes(n.type)
/** Layers that render a shader as their fill; text and images take it as an overlay effect instead. */
const SHADER_FILL_TYPES = ['frame', 'section', 'rect', 'ellipse', 'polygon', 'star']
const canTakeShader = (n: DesignNode) => SHADER_FILL_TYPES.includes(n.type) || n.type === 'text' || n.type === 'image'
const hasShader = (n: DesignNode) =>
  getNodePaints(n).some((paint) => paint.type === 'shader') || getNodeEffects(n).some((fx) => fx.type === 'SHADER')

// ---- value readers ----

const NUMBER = /(?<![\w.#])(-?\d+(?:\.\d+)?)\s*(px|pixels?|%|percent|deg|degrees?|°)?(?![\w])/gi
const UP = /\b(bigger|larger|more|increase|raise|higher|thicker|heavier|wider|taller|longer|bump|grow|stronger|darker|looser|further)\b/i
const DOWN = /\b(smaller|less|decrease|reduce|lower|thinner|narrower|shorter|tighter|shrink|fainter|subtler|weaker|skinnier|slimmer)\b/i
/** "to 24" / "= 24" names the final value even when "increase" is also said. */
const ABSOLUTE = /\b(to|at)\s+-?\d|=\s*-?\d/i
const OFF_WORDS = /\b(no|remove|disable|turn off|without|unset|off|delete|clear|get rid of|drop|kill)\b/i

type NumberHit = { value: number; unit?: string; index: number; end: number }

function numbersIn(request: string): NumberHit[] {
  const hits: NumberHit[] = []
  for (const m of request.matchAll(NUMBER)) {
    const index = m.index ?? 0
    hits.push({ value: Number(m[1]), unit: m[2]?.toLowerCase(), index, end: index + m[0].length })
  }
  return hits
}

/** The number that belongs to this property: right after its keyword, else just before it, else the only number. */
function numberFor(request: string, keywords: RegExp): NumberHit | null {
  const hits = numbersIn(request)
  if (!hits.length) return null
  const flags = keywords.flags.includes('g') ? keywords.flags : `${keywords.flags}g`
  const re = new RegExp(keywords.source, flags)
  for (const m of request.matchAll(re)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const after = hits.find((hit) => hit.index >= end && hit.index - end <= 28)
    if (after) return after
    const before = [...hits].reverse().find((hit) => hit.end <= start && start - hit.end <= 14)
    if (before) return before
  }
  return hits.length === 1 ? hits[0] : null
}

function unitOf(hit: NumberHit | null): string | undefined {
  if (!hit?.unit) return undefined
  if (hit.unit.startsWith('px') || hit.unit.startsWith('pixel')) return 'px'
  if (hit.unit === '%' || hit.unit === 'percent') return '%'
  return 'deg'
}

function clampTo(param: Extract<Param, { kind: 'number' }>, value: number): number {
  const min = param.min ?? Number.NEGATIVE_INFINITY
  const max = param.max ?? Number.POSITIVE_INFINITY
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100))
}

type Resolved = { ok: true; value: unknown; unit?: string } | { ok: false; reason: string; needsChoice?: boolean }

/** How much "bigger" / "smaller" means: "a bit" 10%, plain 25%, "a lot" 50%, "double" / "half", or "30% bigger". */
function sizeFactor(request: string, down: boolean): number {
  const t = request.toLowerCase()
  if (/\b(double|twice)\b/.test(t)) return 2
  if (/\b(half|halve)\b/.test(t)) return 0.5
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/)
  if (pct) return down ? Math.max(0.05, 1 - Number(pct[1]) / 100) : 1 + Number(pct[1]) / 100
  const amount = /\b(a (little )?bit|slightly|a little|a touch|tad)\b/.test(t) ? 0.1 : /\b(a lot|much|way|really|very|huge|tons)\b/.test(t) ? 0.5 : 0.25
  return down ? 1 / (1 + amount) : 1 + amount
}

function resolveNumber(cap: Capability, request: string, node: DesignNode): Resolved {
  // Rotation reads its own amount and direction ("rotate it" alone means a quarter turn).
  if (cap.id === 'rotation') return { ok: true, value: rotationFor(node, request) }
  if (cap.id === 'shader_speed') return { ok: true, value: shaderSpeedFor(Number(cap.read(node)) || 1, request) }
  if (cap.id === 'scale') return { ok: true, value: sizeFactor(request, /\b(smaller|shrink|scale (it |this )?down|half)\b/i.test(request)) }
  const param = cap.param as Extract<Param, { kind: 'number' }>
  const t = request.toLowerCase()
  if (param.allowAuto && /\bauto\b/.test(t)) return { ok: true, value: 'auto' }
  const current = Number(cap.read(node))
  const base = Number.isFinite(current) ? current : 0
  const hit = numberFor(request, cap.keywords)
  const unit = unitOf(hit)
  const fraction = param.unit === '%' && cap.id !== 'letter_spacing'
  const toStored = (raw: number) => (fraction ? (raw > 1 || unit === '%' ? raw / 100 : raw) : raw)
  if (hit) {
    const amount = toStored(hit.value)
    if ((UP.test(t) || DOWN.test(t)) && !ABSOLUTE.test(t)) {
      return { ok: true, value: clampTo(param, base + (DOWN.test(t) ? -amount : amount)), unit }
    }
    return { ok: true, value: clampTo(param, amount), unit }
  }
  if (cap.id === 'nudge') return { ok: true, value: 10 }
  // Sizes grow and shrink in proportion ("wider" on a 1200px frame shouldn't mean +20px).
  if ((cap.id === 'width' || cap.id === 'height') && (UP.test(t) || DOWN.test(t))) {
    const factor = sizeFactor(request, DOWN.test(t) && !UP.test(t))
    return { ok: true, value: clampTo(param, Math.round((base || 100) * factor)) }
  }
  if (/\b(double|twice)\b/.test(t)) return { ok: true, value: clampTo(param, (base || param.step) * 2) }
  if (/\b(half|halve)\b/.test(t)) return { ok: true, value: clampTo(param, base / 2) }
  const step = fraction ? param.step / 100 : param.step
  if (DOWN.test(t)) return { ok: true, value: clampTo(param, base - step) }
  if (UP.test(t)) return { ok: true, value: clampTo(param, base + step) }
  return { ok: false, reason: `What ${cap.label.toLowerCase()}? Try “${cap.label.toLowerCase()} ${param.unit === '%' ? '50%' : param.unit === 'deg' ? '45°' : '16'}”.` }
}

function resolveChoice(cap: Capability, request: string): Resolved {
  if (cap.id === 'shape_type') {
    const shape = targetShape(request)
    return shape ? { ok: true, value: shape } : { ok: false, reason: 'Which shape?', needsChoice: true }
  }
  const param = cap.param as Extract<Param, { kind: 'choice' }>
  for (const [key, option] of Object.entries(param.options)) {
    if (option.words.test(request)) return { ok: true, value: key }
  }
  return { ok: false, reason: `Which ${cap.label.toLowerCase()}?`, needsChoice: true }
}

function resolveToggle(cap: Capability, request: string): Resolved {
  const param = cap.param as Extract<Param, { kind: 'toggle' }>
  if (param.off?.test(request)) return { ok: true, value: false }
  if (param.on?.test(request)) return { ok: true, value: true }
  return { ok: true, value: !OFF_WORDS.test(request) }
}

const FONT_NAMES = (() => {
  const names = [...SYSTEM_FONTS.filter((name) => name !== 'system-ui'), ...allGoogleFonts().map((font) => font.family)]
  return names.sort((a, b) => b.length - a.length)
})()

function findFont(request: string): string | undefined {
  const t = request.toLowerCase()
  for (const name of FONT_NAMES) {
    const at = t.indexOf(name.toLowerCase())
    if (at < 0) continue
    const before = t[at - 1]
    const after = t[at + name.length]
    if ((before === undefined || !/[a-z0-9]/.test(before)) && (after === undefined || !/[a-z0-9]/.test(after))) return name
  }
  return undefined
}

function colorsIn(request: string): string[] {
  const out: Array<{ at: number; color: string }> = []
  for (const m of request.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) out.push({ at: m.index ?? 0, color: `#${m[1]}` })
  const re = new RegExp(`\\b(${Object.keys(NAMED_COLORS).join('|')})\\b`, 'gi')
  for (const m of request.matchAll(re)) out.push({ at: m.index ?? 0, color: NAMED_COLORS[m[1].toLowerCase()] })
  return out.sort((a, b) => a.at - b.at).map((item) => item.color)
}

/** Quoted text, or what follows "to" / "called". */
function textValue(request: string): string | undefined {
  const quoted = request.match(/["“']([^"”']+)["”']/)
  if (quoted) return quoted[1].trim()
  const m = request.match(/\b(?:to|as|called|named)\s+(.+?)[\s.!?]*$/i)
  return m?.[1]?.trim() || undefined
}

export function resolveValue(cap: Capability, request: string, node: DesignNode, preset?: unknown): Resolved {
  if (preset !== undefined) return { ok: true, value: preset }
  switch (cap.param.kind) {
    case 'number':
      return resolveNumber(cap, request, node)
    case 'choice':
      return resolveChoice(cap, request)
    case 'toggle':
      return resolveToggle(cap, request)
    case 'color': {
      const color = extractColor(request)
      return color ? { ok: true, value: color } : { ok: false, reason: 'Which color? Try a name like blue or a hex like #2563eb.' }
    }
    case 'text': {
      const value = textValue(request)
      return value ? { ok: true, value } : { ok: false, reason: 'What should it say? Put the new name in quotes.' }
    }
    case 'font': {
      const font = findFont(request)
      return font ? { ok: true, value: font } : { ok: false, reason: 'Which font? Try “use Inter” or “font Playfair Display”.' }
    }
    case 'gradient':
      return { ok: true, value: colorsIn(request) }
    case 'shader':
      // "add a shader" with no kind named gets the default mesh gradient.
      return { ok: true, value: findShaderKind(request) || 'mesh-gradient' }
    case 'action':
      return { ok: true, value: true }
  }
}

// ---- patch helpers ----

function setEffects(list: DesignEffect[]): Partial<DesignNode> {
  return syncLegacyEffectFields(list) as Partial<DesignNode>
}

function withShadow(node: DesignNode, edit: (fx: DesignEffect) => DesignEffect): Partial<DesignNode> {
  const list = getNodeEffects(node).slice()
  let index = list.findIndex((fx) => fx.type === 'DROP_SHADOW' || fx.type === 'INNER_SHADOW')
  if (index < 0) {
    list.push({ ...defaultEffect('DROP_SHADOW'), radius: 16, offsetY: 4, opacity: 0.15 })
    index = list.length - 1
  }
  list[index] = edit({ ...list[index], visible: true })
  return setEffects(list)
}

function toggleEffect(node: DesignNode, type: EffectType, on: boolean, defaults: Partial<DesignEffect> = {}): Partial<DesignNode> {
  const list = getNodeEffects(node).filter((fx) => on || fx.type !== type)
  if (on && !list.some((fx) => fx.type === type)) list.push({ ...defaultEffect(type), ...defaults })
  return setEffects(list.map((fx) => (fx.type === type ? { ...fx, visible: true } : fx)))
}

function setBlur(node: DesignNode, type: 'LAYER_BLUR' | 'BACKGROUND_BLUR', radius: number): Partial<DesignNode> {
  const list = getNodeEffects(node).filter((fx) => fx.type !== type)
  if (radius > 0) list.push({ ...defaultEffect(type), radius })
  return setEffects(list)
}

function solidFill(color: string): Partial<DesignNode> {
  return { fills: [defaultSolid(color, 1)], fill: color, fillOpacity: 1 }
}

/** Frames get auto layout switched on before a layout property is set. */
function withLayout(node: DesignNode, nodes: DesignNode[], patch: (layout: AutoLayout) => Partial<AutoLayout>): DesignNode[] {
  let working = nodes
  if (!isAutoLayout(node)) {
    working = nodes.map((item) => (item.id === node.id && item.type !== 'frame' ? { ...item, type: 'frame' as const } : item))
    working = enableAutoLayoutOnFrame(working, node.id, { mode: 'vertical' })
  }
  return working.map((item) => {
    if (item.id !== node.id || !item.layout) return item
    return { ...item, layout: { ...item.layout, ...patch(item.layout) } }
  })
}

function sizeFixedH(node: DesignNode): Partial<DesignNode> {
  return {
    layoutSizingH: 'fixed',
    ...(node.layout ? { layout: { ...node.layout, sizingH: 'fixed' as LayoutSizing } } : {}),
    ...(node.type === 'text' && (node.textResize || 'auto-width') === 'auto-width' ? { textResize: 'auto-height' as const } : {})
  }
}

function sizeFixedV(node: DesignNode): Partial<DesignNode> {
  return {
    layoutSizingV: 'fixed',
    ...(node.layout ? { layout: { ...node.layout, sizingV: 'fixed' as LayoutSizing } } : {}),
    ...(node.type === 'text' ? { textResize: 'fixed' as const } : {})
  }
}

function paddingSides(request: string): Array<'t' | 'r' | 'b' | 'l'> {
  const t = request.toLowerCase()
  if (/\b(horizontal|left and right|sides|x)\b/.test(t)) return ['l', 'r']
  if (/\b(vertical|top and bottom|y)\b/.test(t)) return ['t', 'b']
  const sides: Array<'t' | 'r' | 'b' | 'l'> = []
  if (/\btop\b/.test(t)) sides.push('t')
  if (/\bright\b/.test(t)) sides.push('r')
  if (/\bbottom\b/.test(t)) sides.push('b')
  if (/\bleft\b/.test(t)) sides.push('l')
  return sides.length ? sides : ['t', 'r', 'b', 'l']
}

/** Words that name each shader, most specific first (e.g. "static mesh" before "mesh"). */
const SHADER_WORDS: Array<[ShaderKind, RegExp]> = [
  ['static-mesh-gradient', /\bstatic[\s-]?mesh\b/i],
  ['static-radial-gradient', /\b(static[\s-]?radial|radial (shader|glow))\b/i],
  ['grain-gradient', /\bgrain(y)?(\s+gradient)?\b/i],
  ['mesh-gradient', /\bmesh(\s+gradient)?\b/i],
  ['dot-orbit', /\b(dot[\s-]?orbit|orbit\w*)\b/i],
  ['dot-grid', /\b(dot[\s-]?grid|dots|polka)\b/i],
  ['metaballs', /\b(metaballs?|blobs?|lava lamp)\b/i],
  ['simplex-noise', /\bsimplex\b/i],
  ['perlin-noise', /\bperlin\b/i],
  ['neuro-noise', /\bneuro\w*\b/i],
  ['voronoi', /\b(voronoi|cells|cellular)\b/i],
  ['warp', /\bwarp\w*\b/i],
  ['swirl', /\bswirl\w*\b/i],
  ['spiral', /\bspiral\w*\b/i],
  ['god-rays', /\b(god[\s-]?rays|light rays|sun[\s-]?rays|sunbeams?)\b/i],
  ['smoke-ring', /\bsmoke[\s-]?ring\b/i],
  ['gem-smoke', /\bgem(\s+smoke)?\b/i],
  ['dithering', /\bdither\w*\b/i],
  ['color-panels', /\bcolou?r[\s-]?panels?\b/i],
  ['pulsing-border', /\b(pulsing|glowing|animated)[\s-]?border\b/i],
  ['paper-texture', /\bpaper(\s+texture)?\b/i],
  ['heatmap', /\bheat[\s-]?map\b/i],
  ['liquid-metal', /\b(liquid[\s-]?metal|chrome|metallic)\b/i],
  ['waves', /\bwav(es|y)\b/i],
  ['simplex-noise', /\bnoise\b/i]
]

function findShaderKind(request: string): ShaderKind | undefined {
  return SHADER_WORDS.find(([, words]) => words.test(request))?.[0]
}

function shaderLabel(kind: string): string {
  return SHADER_OPTIONS.find((option) => option.id === kind)?.label || kind
}

/** Shader paint for the named kind, using any colors and speed words from the request. */
function buildShaderPaint(kind: ShaderKind, request: string): ShaderPaint {
  const paint = defaultShader(kind)
  const colors = colorsIn(request)
  if (colors.length) {
    paint.colors = colors.length >= paint.colors.length ? colors : [...colors, ...paint.colors.slice(colors.length)]
  }
  const t = request.toLowerCase()
  if (/\b(static|still|paused|frozen|not animated|no animation)\b/.test(t)) paint.speed = 0
  else if (/\bslow(ly)?\b/.test(t)) paint.speed = 0.3
  else if (/\bfast\b/.test(t)) paint.speed = 2
  return paint
}

/** New animation speed from the words: pause, play, faster, slower, or a value ("speed 50%"). */
function shaderSpeedFor(current: number, request: string): number {
  const t = request.toLowerCase()
  if (/\b(pause|stop|freeze|static|still)\b/.test(t)) return 0
  const hit = numbersIn(request)[0]
  if (hit) return Math.max(0, hit.unit === '%' || hit.value > 5 ? hit.value / 100 : hit.value)
  if (/\b(faster|speed (it )?up|quicker)\b/.test(t)) return Math.min(5, Math.round(((current || 1) * 1.6) * 100) / 100)
  if (/\b(slower|slow (it )?down)\b/.test(t)) return Math.round(((current || 1) * 0.6) * 100) / 100
  return 1
}

/** Same range as the inspector: (-180, 180]. Positive turns clockwise on screen. */
function normalizeAngle(deg: number): number {
  let next = Math.round(deg * 100) / 100
  while (next > 180) next -= 360
  while (next <= -180) next += 360
  return next
}

/** New rotation from the words: absolute ("angle 30", "rotation to 0", "straighten") or a turn by an amount. */
function rotationFor(node: DesignNode, request: string): number {
  const t = request.toLowerCase()
  const current = node.rotation ?? 0
  const hit = numberFor(request, /\b(rotat\w*|spin|tilt\w*|angle|turn\w*|degrees?)\b|°/i)
  if (!hit && /\b(straighten|unrotate|upright|level|reset|no rotation)\b/.test(t)) return 0
  const ccw = /\b(counter[\s-]?clockwise|anti[\s-]?clockwise|ccw|left)\b/.test(t)
  const absolute =
    Boolean(hit) &&
    (/\b(to|at)\s+-?\d/.test(t) || /\bset\b/.test(t) || (/\b(rotation|angle)\b/.test(t) && !/\b(rotate|spin|turn|tilt)\b/.test(t)))
  if (absolute && hit) return normalizeAngle(ccw ? -Math.abs(hit.value) : hit.value)
  let delta = hit ? hit.value : /\b(upside[\s-]?down|around|180)\b/.test(t) ? 180 : /\btilt\w*\b/.test(t) ? 15 : 90
  if (ccw) delta = -Math.abs(delta)
  // A single flip mirrors the spin direction; keep "clockwise" clockwise on screen (same as the inspector).
  if (Boolean(node.flipX) !== Boolean(node.flipY)) delta = -delta
  return normalizeAngle(current + delta)
}

function cornerPatch(node: DesignNode, corner: 'tl' | 'tr' | 'br' | 'bl', value: number): Partial<DesignNode> {
  const r = node.radius || 0
  const radii = node.cornerRadii || { tl: r, tr: r, br: r, bl: r }
  return { cornerRadii: { ...radii, [corner]: value } }
}

const choice = (words: RegExp, label: string): ChoiceOption => ({ label, words })

const WEIGHTS: Record<string, ChoiceOption> = {
  '100': choice(/\b(thin|hairline|100)\b/i, 'Thin'),
  '200': choice(/\b(extra[\s-]?light|ultra[\s-]?light|200)\b/i, 'Extra Light'),
  '300': choice(/\b(light(?![\s-]?(mode|theme|gray|grey|blue|green))|300)\b/i, 'Light'),
  '400': choice(/\b(regular|normal|book|400|not bold|unbold)\b/i, 'Regular'),
  '500': choice(/\b(medium|500)\b/i, 'Medium'),
  '600': choice(/\b(semi[\s-]?bold|demi[\s-]?bold|600)\b/i, 'Semi Bold'),
  '700': choice(/\b(?<!semi[\s-]?|extra[\s-]?|ultra[\s-]?)(bold|700)\b/i, 'Bold'),
  '800': choice(/\b(extra[\s-]?bold|ultra[\s-]?bold|800)\b/i, 'Extra Bold'),
  '900': choice(/\b(black weight|heavy|900|weight black|font black)\b/i, 'Black')
}

const ALIGN_ITEMS: Record<string, ChoiceOption> = {
  start: choice(/\b(start|top|left|beginning)\b/i, 'Start (top / left)'),
  center: choice(/\b(center|centre|middle)\b/i, 'Center'),
  end: choice(/\b(end|bottom|right)\b/i, 'End (bottom / right)'),
  stretch: choice(/\b(stretch|fill)\b/i, 'Stretch')
}

const SHAPES: Record<string, ChoiceOption> = {
  circle: choice(/\b(circle|circular)\b/i, 'Circle'),
  ellipse: choice(/\b(ellipse|oval|elliptical)\b/i, 'Ellipse'),
  square: choice(/\bsquare\b/i, 'Square'),
  rectangle: choice(/\b(rectangle|rect)\b/i, 'Rectangle'),
  triangle: choice(/\btriangle\b/i, 'Triangle'),
  diamond: choice(/\b(diamond|rhombus)\b/i, 'Diamond'),
  pentagon: choice(/\bpentagon\b/i, 'Pentagon'),
  hexagon: choice(/\bhexagon\b/i, 'Hexagon'),
  octagon: choice(/\boctagon\b/i, 'Octagon'),
  polygon: choice(/\bpolygon\b/i, 'Polygon'),
  star: choice(/\bstar\b/i, 'Star')
}

/** The shape being turned INTO is the last one named ("make this square a circle" → circle). */
function targetShape(request: string): string | undefined {
  let best: { key: string; at: number } | null = null
  for (const [key, option] of Object.entries(SHAPES)) {
    const re = new RegExp(option.words.source, 'gi')
    for (const m of request.matchAll(re)) {
      const at = m.index ?? 0
      if (!best || at > best.at) best = { key, at }
    }
  }
  return best?.key
}

/** Change a layer's shape while keeping its fill, stroke, effects and position. */
function reshape(n: DesignNode, kind: string): Partial<DesignNode> {
  const w = n.width ?? 100
  const h = n.height ?? 100
  const side = Math.round(Math.min(w, h))
  const sides: Record<string, number> = { triangle: 3, diamond: 4, pentagon: 5, hexagon: 6, octagon: 8, polygon: 5 }
  // Frames and images keep their type (they hold content); round or square their corners instead.
  if (n.type === 'frame' || n.type === 'image') {
    if (kind === 'circle') return { width: side, height: side, radius: side / 2, cornerRadii: undefined, ...sizeFixedH(n), ...sizeFixedV(n) }
    if (kind === 'ellipse') return { radius: Math.round(Math.min(w, h) / 2), cornerRadii: undefined }
    if (kind === 'square') return { width: side, height: side, radius: 0, cornerRadii: undefined, ...sizeFixedH(n), ...sizeFixedV(n) }
    return { radius: 0, cornerRadii: undefined }
  }
  const clear = { arcStart: undefined, arcSweep: undefined, arcInnerRadius: undefined, cornerRadii: undefined }
  if (kind === 'circle') return { ...clear, type: 'ellipse', width: side, height: side }
  if (kind === 'ellipse') return { ...clear, type: 'ellipse' }
  if (kind === 'square') return { ...clear, type: 'rect', width: side, height: side, radius: 0 }
  if (kind === 'rectangle') return { ...clear, type: 'rect', radius: 0 }
  if (kind === 'star') return { ...clear, type: 'star', starCount: n.starCount ?? 5, starRatio: n.starRatio ?? 0.382 }
  return { ...clear, type: 'polygon', polygonCount: sides[kind] ?? 5 }
}

const SIZING: Record<string, ChoiceOption> = {
  fixed: choice(/\bfixed\b/i, 'Fixed'),
  hug: choice(/\b(hug|fit|wrap content|shrink to fit|auto)\b/i, 'Hug contents'),
  fill: choice(/\b(fill|stretch|full)\b/i, 'Fill container')
}

// ---- the catalog ----

export const CAPABILITIES: Capability[] = [
  // Shape
  {
    id: 'shape_type',
    area: 'shape',
    label: 'Shape',
    description: 'Turn it into a different shape: circle, ellipse / oval, square, rectangle, triangle, diamond, pentagon, hexagon, octagon, or star ("make this square a circle").',
    keywords:
      /\b(make|turn|change|convert|transform|morph|switch|reshape)\b.*\b(into|to|a|an)\s+(a\s+|an\s+)?(circle|circular|ellipse|oval|square|rectangle|rect|triangle|diamond|rhombus|pentagon|hexagon|octagon|polygon|star)\b/i,
    unless: /\bcorners?\b|\bsquare (off|corners|edges)\b|\b(add|create|draw|insert)\s+(a|an|another|new)\b/i,
    param: { kind: 'choice', options: SHAPES },
    appliesTo: (n) => ['rect', 'ellipse', 'polygon', 'star', 'frame', 'image'].includes(n.type),
    read: (n) => n.type,
    apply: (n, kind: string) => reshape(n, kind)
  },

  // Size & position
  {
    id: 'width',
    area: 'size',
    label: 'Width',
    description: 'Set or change the width ("width 320", "make it 40px wider", "make this wider", "narrower").',
    keywords: /\b(width|wide|wider|narrower|skinnier|slimmer)\b/i,
    unless: /\b(fill|hug|fixed)\b|\bline\s+(width|weight)\b|\b(stroke|border|outline)\b/i,
    param: { kind: 'number', unit: 'px', min: 1, step: 20 },
    appliesTo: hasBox,
    read: (n) => n.width ?? 0,
    apply: (n, v: number) => ({ width: v, ...sizeFixedH(n) })
  },
  {
    id: 'height',
    area: 'size',
    label: 'Height',
    description: 'Set or change the height ("height 48", "make it taller", "shorter").',
    keywords: /\b(height|tall|taller|shorter)\b/i,
    unless: /\bline[\s-]?height\b|\b(fill|hug|fixed)\b/i,
    param: { kind: 'number', unit: 'px', min: 1, step: 20 },
    appliesTo: hasBox,
    read: (n) => n.height ?? 0,
    apply: (n, v: number) => ({ height: v, ...sizeFixedV(n) })
  },
  {
    id: 'scale',
    area: 'size',
    label: 'Size',
    description:
      'Make the whole layer bigger or smaller, keeping its proportions ("make this bigger", "a bit smaller", "twice as big", "30% smaller"). Text grows its font size.',
    keywords: /\b(bigger|larger|smaller|grow|shrink|enlarge|scale (it |this )?(up|down)|twice as (big|large)|half (the|as) (size|big))\b/i,
    unless: /\b(font|text size|stroke|border|outline|shadow|blur|radius|corners?|padding|gap|spacing|letter|line[\s-]?height|icon)\b/i,
    param: { kind: 'number', unit: '%', min: 0.05, max: 20, step: 25 },
    appliesTo: (n) => !isComment(n) && n.type !== 'path' && n.type !== 'line' && n.type !== 'arrow',
    read: () => 1,
    apply: (n, factor: number) => {
      if (n.type === 'text') {
        return {
          fontSize: Math.max(1, Math.round((n.fontSize ?? 12) * factor)),
          ...(n.textResize && n.textResize !== 'auto-width' && n.width ? { width: Math.round(n.width * factor) } : {})
        }
      }
      return {
        width: Math.max(1, Math.round((n.width ?? 100) * factor)),
        height: Math.max(1, Math.round((n.height ?? 100) * factor)),
        ...sizeFixedH(n),
        ...sizeFixedV(n)
      }
    }
  },
  {
    id: 'x',
    area: 'size',
    label: 'X position',
    description: 'Set the X position ("x 120", "set x to 0").',
    keywords: /\b(x position|set x|x to|x =|x:|x coordinate)\b/i,
    param: { kind: 'number', unit: 'px', step: 10 },
    appliesTo: anyLayer,
    read: (n) => n.x,
    apply: (_n, v: number) => ({ x: v })
  },
  {
    id: 'y',
    area: 'size',
    label: 'Y position',
    description: 'Set the Y position ("y 40", "set y to 0").',
    keywords: /\b(y position|set y|y to|y =|y:|y coordinate)\b/i,
    param: { kind: 'number', unit: 'px', step: 10 },
    appliesTo: anyLayer,
    read: (n) => n.y,
    apply: (_n, v: number) => ({ y: v })
  },
  {
    id: 'nudge',
    area: 'size',
    label: 'Move',
    description: 'Move it a distance in a direction ("move it right 20", "shift it up 10px", "nudge left").',
    keywords: /\b(move|shift|nudge|push)\b.*\b(left|right|up|down)\b/i,
    param: { kind: 'number', unit: 'px', step: 10 },
    appliesTo: anyLayer,
    read: () => 0,
    apply: (n, v: number, ctx) => {
      const t = ctx.request.toLowerCase()
      const d = Math.abs(v) || 10
      if (/\bleft\b/.test(t)) return { x: n.x - d }
      if (/\bright\b/.test(t)) return { x: n.x + d }
      if (/\bup\b/.test(t)) return { y: n.y - d }
      return { y: n.y + d }
    }
  },
  {
    id: 'rotation',
    area: 'size',
    label: 'Rotation',
    description:
      'Rotate it, change its angle, or straighten it: "rotate 45", "rotate it" (90° clockwise), "rotate 30 counterclockwise", "angle 15", "set rotation to -90", "turn it upside down", "straighten it".',
    keywords:
      /\b(rotat\w*|spin|tilt\w*|angle|degrees?|clockwise|counter[\s-]?clockwise|anti[\s-]?clockwise|straighten|unrotate|sideways)\b|°|\bturn\w*\b.*\b(-?\d+|degrees?|clockwise|sideways|upside[\s-]?down|around)\b|\b(make|turn)\s+(it|this|them)\s+(upright|level)\b/i,
    unless: /\b(gradient|shadow)\b|\bflip\w*\b|\bmirror\w*\b/i,
    param: { kind: 'number', unit: 'deg', step: 90 },
    appliesTo: anyLayer,
    read: (n) => n.rotation ?? 0,
    apply: (_n, v: number) => ({ rotation: v })
  },
  {
    id: 'flip_horizontal',
    area: 'size',
    label: 'Flip horizontal',
    description: 'Flip or mirror it horizontally / left to right.',
    keywords: /\b(flip|mirror)\w*\b(?!.*\b(vertical\w*|upside[\s-]?down|top to bottom|both)\b)/i,
    unless: /\b(unflip|reset|remove|undo)\b/i,
    param: { kind: 'action' },
    appliesTo: anyLayer,
    read: (n) => Boolean(n.flipX),
    apply: (n) => ({ flipX: !n.flipX })
  },
  {
    id: 'flip_vertical',
    area: 'size',
    label: 'Flip vertical',
    description: 'Flip or mirror it vertically / upside down / top to bottom.',
    keywords: /\b(flip|mirror)\w*\b.*\b(vertical\w*|upside[\s-]?down|top to bottom|both)\b/i,
    unless: /\b(unflip|reset|remove|undo)\b/i,
    param: { kind: 'action' },
    appliesTo: anyLayer,
    read: (n) => Boolean(n.flipY),
    apply: (n) => ({ flipY: !n.flipY })
  },
  {
    id: 'flip_reset',
    area: 'size',
    label: 'Remove flip',
    description: 'Undo any flipping so it faces the original way.',
    keywords: /\b(unflip|un-flip|reset (the )?flip|remove (the )?flip|no flip|unmirror|un-mirror)\b/i,
    param: { kind: 'action' },
    appliesTo: anyLayer,
    read: () => undefined,
    apply: () => ({ flipX: false, flipY: false })
  },
  {
    id: 'aspect_lock',
    area: 'size',
    label: 'Lock aspect ratio',
    description: 'Lock or unlock the aspect ratio / constrain proportions.',
    keywords: /\b(aspect[\s-]?ratio|proportions?)\b/i,
    param: { kind: 'toggle', off: /\b(unlock|free|don'?t keep|stop)\b/i },
    appliesTo: hasBox,
    read: (n) => Boolean(n.aspectLocked),
    apply: (_n, v: boolean) => ({ aspectLocked: v })
  },

  // Corners
  {
    id: 'corner_radius',
    area: 'corners',
    label: 'Corner radius',
    description: 'Set an exact corner radius for all corners ("corner radius 12", "round the corners to 8").',
    keywords: /\b(corner[\s-]?radius|border[\s-]?radius|radius|rounded corners?|round the corners)\b/i,
    unless: /\b(top|bottom)[\s-]?(left|right)\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 9999, step: 4 },
    appliesTo: hasRoundableCorners,
    read: (n) => n.radius ?? 0,
    apply: (_n, v: number) => ({ radius: v, cornerRadii: undefined })
  },
  ...(
    [
      ['tl', 'top left', /\btop[\s-]?left\b/i],
      ['tr', 'top right', /\btop[\s-]?right\b/i],
      ['br', 'bottom right', /\bbottom[\s-]?right\b/i],
      ['bl', 'bottom left', /\bbottom[\s-]?left\b/i]
    ] as const
  ).map(
    ([corner, name, words]): Capability => ({
      id: `corner_${corner}`,
      area: 'corners',
      label: `${name[0].toUpperCase()}${name.slice(1)} corner`,
      description: `Round only the ${name} corner ("${name} corner 16").`,
      keywords: new RegExp(`${words.source}.*\\b(corner|radius|round)\\b|\\b(corner|radius|round)\\b.*${words.source}`, 'i'),
      param: { kind: 'number', unit: 'px', min: 0, max: 9999, step: 4 },
      appliesTo: hasRoundableCorners,
      read: (n) => n.cornerRadii?.[corner] ?? n.radius ?? 0,
      apply: (n, v: number) => cornerPatch(n, corner, v)
    })
  ),

  // Fill
  {
    id: 'fill_color',
    area: 'fill',
    label: 'Fill color',
    description: 'Change the fill / background color of a shape or frame ("background blue", "fill #111").',
    keywords: /\b(fill|background|bg)\b/i,
    unless: /\b(blur|gradient|opacity|remove|no fill)\b/i,
    param: { kind: 'color' },
    appliesTo: canFill,
    read: (n) => n.fill,
    apply: (_n, v: string) => solidFill(v)
  },
  {
    id: 'fill_opacity',
    area: 'fill',
    label: 'Fill opacity',
    description: 'Change only the fill opacity, keeping the layer itself opaque ("fill opacity 50%").',
    keywords: /\bfill[\s-]?opacity\b|\bbackground[\s-]?opacity\b/i,
    param: { kind: 'number', unit: '%', min: 0, max: 1, step: 10 },
    appliesTo: canFill,
    read: (n) => n.fillOpacity ?? 1,
    apply: (n, v: number) => {
      const paints = getNodePaints(n).map((paint) => ({ ...paint, opacity: v }))
      return { fills: paints, ...legacyFromPaints(paints) }
    }
  },
  {
    id: 'fill_gradient',
    area: 'fill',
    label: 'Gradient fill',
    description: 'Give it a gradient fill (linear, radial, angular, or diamond), optionally between named colors.',
    keywords: /\bgradient\b/i,
    param: { kind: 'gradient' },
    appliesTo: canFill,
    read: () => undefined,
    apply: (_n, colors: string[], ctx) => {
      const t = ctx.request.toLowerCase()
      const kind: GradientKind = /\bradial\b/.test(t) ? 'radial' : /\b(angular|conic)\b/.test(t) ? 'angular' : /\bdiamond\b/.test(t) ? 'diamond' : 'linear'
      const paint = defaultGradient(kind)
      if (colors.length) {
        const list = colors.length === 1 ? [colors[0], '#ffffff'] : colors
        paint.stops = list.map((color, i) => ({ id: crypto.randomUUID(), position: i / (list.length - 1), color, opacity: 1 }))
      }
      const angle = numberFor(ctx.request, /\b(deg|degrees?|°|angle)\b/i)
      if (angle && kind === 'linear') paint.angle = angle.value
      return { fills: [paint], ...legacyFromPaints([paint]) }
    }
  },
  {
    id: 'fill_remove',
    area: 'fill',
    label: 'Remove fill',
    description: 'Remove the fill / make the background transparent.',
    keywords: /\b(remove|no|clear|delete)\s+(the\s+)?(fill|background)\b|\btransparent background\b/i,
    param: { kind: 'action' },
    appliesTo: canFill,
    read: () => undefined,
    apply: () => ({ fills: [], fill: undefined, fillOpacity: undefined })
  },
  {
    id: 'shader',
    area: 'fill',
    label: 'Shader',
    description:
      'Add or change a shader (animated generative fill): mesh gradient, static mesh, static radial, grain gradient, dot orbit, dot grid, metaballs, waves, simplex / perlin / neuro noise, voronoi, warp, swirl, spiral, god rays, smoke ring, dithering, color panels, pulsing border, gem smoke, paper texture, heatmap, liquid metal. Shapes and frames get it as their fill; text and images get it as an overlay.',
    keywords:
      /\bshaders?\b|\b(mesh[\s-]?gradient|static[\s-]?mesh|grain(y)? gradient|liquid[\s-]?metal|god[\s-]?rays|metaballs?|voronoi|perlin|simplex|dither\w*|heat[\s-]?map|smoke[\s-]?ring|gem[\s-]?smoke|paper[\s-]?texture|pulsing[\s-]?border|colou?r[\s-]?panels|dot[\s-]?orbit|dot[\s-]?grid|neuro[\s-]?noise|lava lamp)\b/i,
    unless:
      /\b(remove|delete|clear|no|without|get rid of|turn off)\b.*\bshaders?\b|\bshaders?\b.*\b(speed|faster|slower|pause|stop|freeze|resume|play)\b|\b(pause|stop|freeze|resume|play|speed up|slow down)\b.*\bshaders?\b/i,
    param: { kind: 'shader' },
    appliesTo: canTakeShader,
    read: (n) => getNodePaints(n).find((paint) => paint.type === 'shader')?.type,
    apply: (n, kind: ShaderKind, ctx) => {
      const paint = buildShaderPaint(kind, ctx.request)
      const overlay = n.type === 'text' || n.type === 'image' || /\b(overlay|on top|over (it|this|the)|layer it)\b/i.test(ctx.request)
      if (overlay) {
        const opacity = /\b(full|solid|opaque|100\s*%)\b/i.test(ctx.request) ? 1 : 0.6
        const effects = getNodeEffects(n).filter((fx) => fx.type !== 'SHADER')
        effects.push({ ...defaultEffect('SHADER'), shader: { ...paint, opacity } })
        return setEffects(effects)
      }
      return { fills: [paint], ...legacyFromPaints([paint]) }
    }
  },
  {
    id: 'shader_speed',
    area: 'fill',
    label: 'Shader speed',
    description: 'Pause, play, speed up, or slow down a shader’s animation ("pause the shader", "shader speed 50%").',
    keywords:
      /\bshaders?\b.*\b(speed|faster|slower|pause\w*|stop|freeze|resume|play|animat\w*|static|still)\b|\b(pause|stop|freeze|resume|play|animate|speed up|slow down)\s+(the\s+|its\s+)?(shaders?|animation)\b/i,
    param: { kind: 'number', unit: '%', min: 0, max: 5, step: 50 },
    appliesTo: hasShader,
    read: (n) => getNodePaints(n).find((paint): paint is ShaderPaint => paint.type === 'shader')?.speed ?? 1,
    apply: (n, speed: number) => {
      const fills = getNodePaints(n).map((paint) => (paint.type === 'shader' ? { ...paint, speed } : paint))
      const effects = getNodeEffects(n).map((fx) => (fx.type === 'SHADER' && fx.shader ? { ...fx, shader: { ...fx.shader, speed } } : fx))
      return {
        ...(n.fills?.length ? { fills } : {}),
        ...(effects.some((fx) => fx.type === 'SHADER') ? setEffects(effects) : {})
      }
    }
  },
  {
    id: 'shader_remove',
    area: 'fill',
    label: 'Remove shader',
    description: 'Remove the shader (fill or overlay) from the layer.',
    keywords: /\b(remove|delete|clear|no|without|get rid of|turn off)\b.*\bshaders?\b/i,
    param: { kind: 'action' },
    appliesTo: hasShader,
    read: () => undefined,
    apply: (n) => {
      const kept = getNodePaints(n).filter((paint) => paint.type !== 'shader')
      const fills = kept.length || n.type === 'frame' || n.type === 'section' ? kept : [defaultSolid('#D9D9D9', 1)]
      const effects = getNodeEffects(n).filter((fx) => fx.type !== 'SHADER')
      return { fills, ...legacyFromPaints(fills), ...setEffects(effects) }
    }
  },

  // Stroke
  {
    id: 'stroke_add',
    area: 'stroke',
    label: 'Add stroke',
    description: 'Add a stroke / border / outline with the default style (1px).',
    keywords: /\b(add|give|put)\b.*\b(stroke|border|outline)s?\b/i,
    unless: /\b(radius|remove|no (stroke|border|outline))\b/i,
    param: { kind: 'action' },
    appliesTo: canStroke,
    read: (n) => hasVisibleStroke(n),
    apply: (n) => strokeBase(n)
  },
  {
    id: 'stroke_color',
    area: 'stroke',
    label: 'Stroke color',
    description: 'Add a stroke / border / outline in a color, or change its color ("red border", "stroke #000").',
    keywords: /\b(stroke|border|outline)\b/i,
    unless: /\b(radius|remove|no (stroke|border|outline))\b/i,
    param: { kind: 'color' },
    appliesTo: canStroke,
    read: (n) => n.stroke,
    apply: (n, v: string) => ({ ...strokeBase(n), stroke: v, strokePaint: undefined })
  },
  {
    id: 'stroke_width',
    area: 'stroke',
    label: 'Stroke width',
    description: 'Set or change the stroke / border / line thickness ("2px border", "thicker stroke", "line weight 4").',
    keywords:
      /\b(stroke|border|outline)\b|\bline\s+(weight|width|thickness)\b|\b(thicker|thinner)\s+(line|arrow)\b|\b(line|arrow)\b.*\b(thicker|thinner)\b/i,
    unless: /\b(radius|remove|no (stroke|border|outline)|opacity|transparen\w*|faint\w*)\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 200, step: 1 },
    appliesTo: canStroke,
    read: (n) => (n.type === 'line' || n.type === 'arrow' ? n.strokeWidth ?? 2 : n.strokeWidth ?? 0),
    apply: (n, v: number) => ({ ...strokeBase(n), strokeWidth: v })
  },
  {
    id: 'stroke_opacity',
    area: 'stroke',
    label: 'Stroke opacity',
    description: 'Set the stroke / border opacity ("border opacity 30%", "fainter border").',
    keywords:
      /\b(stroke|border|outline)\b.*\b(opacity|transparen\w*|faint\w*|subtle)\b|\b(faint\w*|subtle|transparent)\s+(stroke|border|outline)\b/i,
    unless: /\b(remove|no (stroke|border|outline))\b/i,
    param: { kind: 'number', unit: '%', min: 0, max: 1, step: 20 },
    appliesTo: canStroke,
    read: (n) => n.strokeOpacity ?? 1,
    apply: (n, v: number) => ({ ...strokeBase(n), strokeOpacity: v })
  },
  {
    id: 'stroke_align',
    area: 'stroke',
    label: 'Stroke position',
    description: 'Put the stroke inside, centered, or outside the edge.',
    keywords: /\b(stroke|border|outline)\b.*\b(inside|outside|center|centre|middle)\b|\b(inside|outside|center|centre)\s+(stroke|border|outline)\b/i,
    param: {
      kind: 'choice',
      options: {
        inside: choice(/\binside\b/i, 'Inside'),
        center: choice(/\b(center|centre|middle)\b/i, 'Center'),
        outside: choice(/\boutside\b/i, 'Outside')
      }
    },
    appliesTo: (n) => canStroke(n) && !isOpenLine(n),
    read: (n) => n.strokeAlign,
    apply: (n, v: 'inside' | 'center' | 'outside') => ({ ...strokeBase(n), strokeAlign: v })
  },
  {
    id: 'stroke_style',
    area: 'stroke',
    label: 'Stroke style',
    description: 'Make the stroke / border / line solid, dashed, or dotted.',
    keywords: /\b(dashed|dotted|dashes|dots|solid (stroke|border|line|outline))\b/i,
    param: {
      kind: 'choice',
      options: {
        dashed: choice(/\bdash(ed|es)?\b/i, 'Dashed'),
        dotted: choice(/\bdot(ted|s)?\b/i, 'Dotted'),
        solid: choice(/\bsolid\b/i, 'Solid')
      }
    },
    // Text strokes trace glyphs and can't dash.
    appliesTo: (n) => canStroke(n) && n.type !== 'text',
    read: (n) => (n.strokeDash ? 'dashed' : 'solid'),
    apply: (n, v: string) => {
      if (v === 'dashed') return { ...strokeBase(n), strokeDash: 6, strokeGap: 4, strokeProfile: undefined }
      if (v === 'dotted') return { ...strokeBase(n), strokeDash: 1, strokeGap: 3, strokeCap: 'round' as const, strokeProfile: undefined }
      return { strokeDash: 0, strokeGap: undefined }
    }
  },
  {
    id: 'stroke_cap',
    area: 'stroke',
    label: 'Line ends',
    description: 'Set the line end cap of a line, arrow, or open path: none, round, or square.',
    keywords: /\b(cap|caps|line ends?|end cap|ends)\b/i,
    param: {
      kind: 'choice',
      options: {
        round: choice(/\bround(ed)?\b/i, 'Round'),
        square: choice(/\bsquare\b/i, 'Square'),
        none: choice(/\b(none|flat|butt)\b/i, 'None')
      }
    },
    appliesTo: isOpenLine,
    read: (n) => n.strokeCap,
    apply: (_n, v: 'none' | 'square' | 'round') => ({ strokeCap: v })
  },
  {
    id: 'stroke_join',
    area: 'stroke',
    label: 'Corner joins',
    description: 'Set how a drawn path’s stroke corners join: miter, round, or bevel.',
    keywords: /\b(join|joins|miter|bevel)\b/i,
    param: {
      kind: 'choice',
      options: {
        round: choice(/\bround(ed)?\b/i, 'Round'),
        bevel: choice(/\bbevel(ed)?\b/i, 'Bevel'),
        miter: choice(/\bmiter(ed)?\b|\bsharp\b/i, 'Miter')
      }
    },
    appliesTo: (n) => n.type === 'path',
    read: (n) => n.strokeJoin,
    apply: (_n, v: 'miter' | 'round' | 'bevel') => ({ strokeJoin: v })
  },
  {
    id: 'stroke_remove',
    area: 'stroke',
    label: 'Remove stroke',
    description: 'Remove the stroke / border / outline.',
    keywords: /\b(remove|no|clear|delete|without|get rid of)\s+(the\s+|its\s+)?(stroke|border|outline)s?\b/i,
    param: { kind: 'action' },
    appliesTo: canStroke,
    read: () => undefined,
    apply: () => ({ strokeWidth: 0, strokePaint: undefined })
  },

  // Effects
  {
    id: 'drop_shadow',
    area: 'effects',
    label: 'Drop shadow',
    description: 'Add or remove a drop shadow.',
    keywords: /\b(drop[\s-]?shadow|shadow)\b/i,
    unless: /\binner\b|\bshadow\s+(blur|offset|spread|color|colour|opacity|x|y)\b/i,
    param: { kind: 'toggle' },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).some((fx) => fx.type === 'DROP_SHADOW'),
    apply: (n, v: boolean) => toggleEffect(n, 'DROP_SHADOW', v, { radius: 16, offsetY: 4, opacity: 0.15 })
  },
  {
    id: 'inner_shadow',
    area: 'effects',
    label: 'Inner shadow',
    description: 'Add or remove an inner shadow.',
    keywords: /\binner[\s-]?shadow\b/i,
    param: { kind: 'toggle' },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).some((fx) => fx.type === 'INNER_SHADOW'),
    apply: (n, v: boolean) => toggleEffect(n, 'INNER_SHADOW', v)
  },
  {
    id: 'shadow_blur',
    area: 'effects',
    label: 'Shadow blur',
    description: 'Make the shadow softer or sharper; set its blur ("shadow blur 24").',
    keywords: /\bshadow\b.*\b(blur|soft(er)?|sharp(er)?)\b|\b(soft(er)?|sharp(er)?)\s+shadow\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 400, step: 8 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.radius ?? 0,
    apply: (n, v: number) => withShadow(n, (fx) => ({ ...fx, radius: v }))
  },
  {
    id: 'shadow_offset_y',
    area: 'effects',
    label: 'Shadow distance',
    description: 'Move the shadow down or up; set its Y offset / distance ("shadow y 8", "shadow further down").',
    keywords: /\bshadow\b.*\b(offset|distance|y|lower|further|down|elevation)\b/i,
    unless: /\bshadow\b.*\bx\b/i,
    param: { kind: 'number', unit: 'px', min: -400, max: 400, step: 4 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.offsetY ?? 0,
    apply: (n, v: number) => withShadow(n, (fx) => ({ ...fx, offsetY: v }))
  },
  {
    id: 'shadow_offset_x',
    area: 'effects',
    label: 'Shadow X offset',
    description: 'Move the shadow left or right; set its X offset.',
    keywords: /\bshadow\b.*\bx\b|\bshadow\b.*\b(left|right)\b/i,
    param: { kind: 'number', unit: 'px', min: -400, max: 400, step: 4 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.offsetX ?? 0,
    apply: (n, v: number) => withShadow(n, (fx) => ({ ...fx, offsetX: v }))
  },
  {
    id: 'shadow_spread',
    area: 'effects',
    label: 'Shadow spread',
    description: 'Set the shadow spread.',
    keywords: /\bshadow\b.*\bspread\b|\bspread\b/i,
    param: { kind: 'number', unit: 'px', min: -200, max: 200, step: 2 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.spread ?? 0,
    apply: (n, v: number) => withShadow(n, (fx) => ({ ...fx, spread: v }))
  },
  {
    id: 'shadow_color',
    area: 'effects',
    label: 'Shadow color',
    description: 'Change the shadow color ("blue shadow").',
    keywords: /\bshadow\b/i,
    unless: /\b(remove|no shadow|without)\b/i,
    param: { kind: 'color' },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.color,
    apply: (n, v: string) => withShadow(n, (fx) => ({ ...fx, color: v }))
  },
  {
    id: 'shadow_opacity',
    area: 'effects',
    label: 'Shadow opacity',
    description: 'Make the shadow stronger, darker, lighter, or fainter; set its opacity.',
    keywords: /\bshadow\b.*\b(opacity|strength|stronger|darker|lighter|fainter|subtle|intense)\b|\b(stronger|darker|lighter|subtler|fainter)\s+shadow\b/i,
    param: { kind: 'number', unit: '%', min: 0, max: 1, step: 10 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type.endsWith('SHADOW'))?.opacity ?? 0.25,
    apply: (n, v: number) => withShadow(n, (fx) => ({ ...fx, opacity: v }))
  },
  {
    id: 'layer_blur',
    area: 'effects',
    label: 'Layer blur',
    description: 'Blur the layer itself ("blur 8", "remove the blur").',
    keywords: /\b(layer[\s-]?blur|blur|blurry|blurred)\b/i,
    unless: /\b(background|backdrop|shadow|frosted|glass)\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 400, step: 4 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type === 'LAYER_BLUR')?.radius ?? 0,
    apply: (n, v: number, ctx) => setBlur(n, 'LAYER_BLUR', OFF_WORDS.test(ctx.request) && !numbersIn(ctx.request).length ? 0 : v)
  },
  {
    id: 'background_blur',
    area: 'effects',
    label: 'Background blur',
    description: 'Blur what is behind the layer (frosted glass / backdrop blur).',
    keywords: /\b(background|backdrop)[\s-]?blur\b|\bfrosted\b|\bglass(y)?\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 400, step: 4 },
    appliesTo: anyLayer,
    read: (n) => getNodeEffects(n).find((fx) => fx.type === 'BACKGROUND_BLUR')?.radius ?? 0,
    apply: (n, v: number, ctx) => setBlur(n, 'BACKGROUND_BLUR', OFF_WORDS.test(ctx.request) && !numbersIn(ctx.request).length ? 0 : v || 16)
  },
  {
    id: 'remove_effects',
    area: 'effects',
    label: 'Remove effects',
    description: 'Remove all effects (shadows and blurs).',
    keywords: /\b(remove|clear|no)\s+(all\s+)?effects\b/i,
    param: { kind: 'action' },
    appliesTo: anyLayer,
    read: () => undefined,
    apply: () => setEffects([])
  },

  // Appearance
  {
    id: 'opacity',
    area: 'appearance',
    label: 'Opacity',
    description: 'Set the layer opacity / transparency ("opacity 50%", "more transparent").',
    keywords: /\b(opacity|opaque|transparen\w*|see[\s-]?through|faded?|alpha)\b/i,
    unless: /\b(fill|background|shadow|stroke|border|outline)\s*opacity\b|\btransparent background\b/i,
    param: { kind: 'number', unit: '%', min: 0, max: 1, step: 10 },
    appliesTo: anyLayer,
    read: (n) => n.opacity ?? 1,
    apply: (_n, v: number, ctx) => {
      // "more transparent" lowers opacity even though it reads as "more".
      if (/\bmore\s+transparen/i.test(ctx.request) && !numbersIn(ctx.request).length) return { opacity: Math.max(0, (_n.opacity ?? 1) - 0.2) }
      return { opacity: v }
    }
  },
  {
    id: 'blend_mode',
    area: 'appearance',
    label: 'Blend mode',
    description: 'Change the layer blend mode (multiply, screen, overlay, darken, lighten, …).',
    keywords: /\bblend(ing)?\b|\b(multiply|darken|color burn|color dodge|soft light|hard light|difference|exclusion|luminosity|plus darker|plus lighter)\b/i,
    param: {
      kind: 'choice',
      options: Object.fromEntries(BLEND_MODES.map((mode) => [mode, choice(new RegExp(`\\b${mode.replace(/\s+/g, '[\\s-]?')}\\b`, 'i'), mode)]))
    },
    appliesTo: anyLayer,
    read: (n) => n.blendMode,
    apply: (_n, v: string) => ({ blendMode: v })
  },
  {
    id: 'visible',
    area: 'appearance',
    label: 'Visibility',
    description: 'Hide or show the layer.',
    keywords: /\b(hide|hidden|show|unhide|visible|invisible|visibility)\b/i,
    param: { kind: 'toggle', on: /\b(show|unhide|visible|reveal)\b/i, off: /\b(hide|hidden|invisible)\b/i },
    appliesTo: anyLayer,
    read: (n) => n.visible !== false,
    apply: (_n, v: boolean) => ({ visible: v })
  },
  {
    id: 'locked',
    area: 'appearance',
    label: 'Lock',
    description: 'Lock or unlock the layer so it can’t be moved or edited.',
    keywords: /\b(lock|unlock|locked)\b/i,
    unless: /\baspect|proportion/i,
    param: { kind: 'toggle', on: /\block\b/i, off: /\bunlock\b/i },
    appliesTo: anyLayer,
    read: (n) => Boolean(n.locked),
    apply: (_n, v: boolean) => ({ locked: v })
  },

  // Typography
  {
    id: 'text_color',
    area: 'typography',
    label: 'Text color',
    description: 'Change the text / font color ("make the text white").',
    keywords: /\b(text|font|type|label|title|heading|copy)\s+colou?r\b|\bcolou?r\s+of\s+the\s+(text|font|label|title|heading)\b|\b(make|turn|set|change)\s+(the\s+)?(text|font|label|title|heading|words)\s+(to\s+)?(#\w+|[a-z]+)\b/i,
    unless: /\b(background|bg|fill|border|stroke|shadow|size|family|rename|say|says|read|reads)\b|["“]/i,
    param: { kind: 'color' },
    appliesTo: isText,
    read: (n) => n.fill,
    apply: (_n, v: string) => solidFill(v)
  },
  {
    id: 'font_family',
    area: 'typography',
    label: 'Font',
    description: 'Change the font family / typeface ("use Inter", "font Playfair Display").',
    keywords: /\b(font|typeface|family|serif|sans)\b/i,
    unless: /\bfont[\s-]?(size|weight|colou?r)\b/i,
    param: { kind: 'font' },
    appliesTo: isText,
    read: (n) => n.fontFamily || 'Inter',
    apply: (n, v: string) => {
      void ensureGoogleFontLoaded(v, n.fontWeight || 400, n.fontStyle === 'italic').catch(() => undefined)
      return { fontFamily: v }
    }
  },
  {
    id: 'font_size',
    area: 'typography',
    label: 'Font size',
    description: 'Set or change the font size ("font size 24", "bigger text", "text 18px").',
    keywords: /\b(font[\s-]?size|text[\s-]?size|type[\s-]?size|font|text|pt)\b/i,
    unless: /\b(colou?r|weight|family|align\w*|line[\s-]?height|letter|spacing|decoration|case|width|wide|height|rename|say|says|read|reads|label|copy|words?|lines?|stroke|border|outline|shadow|shader)\b|["“]/i,
    param: { kind: 'number', unit: 'px', min: 1, max: 1000, step: 2 },
    appliesTo: isText,
    read: (n) => n.fontSize ?? 12,
    apply: (_n, v: number) => ({ fontSize: v })
  },
  {
    id: 'font_weight',
    area: 'typography',
    label: 'Font weight',
    description: 'Set the font weight: thin, light, regular, medium, semi bold, bold, extra bold, black.',
    keywords: /\b(weight|bold|semi[\s-]?bold|medium|regular|thin|heavy|unbold|not bold)\b/i,
    param: { kind: 'choice', options: WEIGHTS },
    appliesTo: isText,
    read: (n) => String(n.fontWeight ?? 400),
    apply: (_n, v: string) => ({ fontWeight: Number(v) })
  },
  {
    id: 'italic',
    area: 'typography',
    label: 'Italic',
    description: 'Make the text italic or upright.',
    keywords: /\b(italic|italics|oblique|upright|slanted)\b/i,
    param: { kind: 'toggle', off: /\b(not italic|no italic|remove italic|upright|un-?italic)\b/i },
    appliesTo: isText,
    read: (n) => n.fontStyle === 'italic',
    apply: (n, v: boolean) => {
      void ensureGoogleFontLoaded(n.fontFamily || 'Inter', n.fontWeight || 400, v).catch(() => undefined)
      return { fontStyle: v ? 'italic' : 'normal' }
    }
  },
  {
    id: 'line_height',
    area: 'typography',
    label: 'Line height',
    description: 'Set the line height / leading in pixels, or Auto ("line height 24", "more leading").',
    keywords: /\b(line[\s-]?height|leading|line spacing)\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 2000, step: 2, allowAuto: true },
    appliesTo: isText,
    read: (n) => (n.lineHeight && n.lineHeight > 0 ? n.lineHeight : Math.round((n.fontSize ?? 12) * 1.2)),
    apply: (_n, v: number | 'auto') => ({ lineHeight: v === 'auto' ? 0 : v })
  },
  {
    id: 'letter_spacing',
    area: 'typography',
    label: 'Letter spacing',
    description: 'Set the letter spacing / tracking in % (or px when said) ("letter spacing 2%", "tighter tracking").',
    keywords: /\b(letter[\s-]?spacing|tracking|kerning|character spacing)\b/i,
    param: { kind: 'number', unit: '%', min: -100, max: 1000, step: 1 },
    appliesTo: isText,
    read: (n) => n.letterSpacing ?? 0,
    apply: (_n, v: number, ctx) => ({ letterSpacing: v, letterSpacingUnit: ctx.unit === 'px' ? 'px' : 'percent' })
  },
  {
    id: 'text_align',
    area: 'typography',
    label: 'Text alignment',
    description: 'Align the text left, center, right, or justify it.',
    keywords: /\b(text[\s-]?align\w*|align\w*\s+(the\s+)?text|justif\w+\s+(the\s+)?text|(left|right|center|centre)[\s-]?(align(ed)?\s+)?(the\s+)?text)\b/i,
    param: {
      kind: 'choice',
      options: {
        left: choice(/\bleft\b/i, 'Left'),
        center: choice(/\b(center|centre|middle)\b/i, 'Center'),
        right: choice(/\bright\b/i, 'Right'),
        justify: choice(/\bjustif\w+\b/i, 'Justified')
      }
    },
    appliesTo: isText,
    read: (n) => n.textAlign || 'left',
    apply: (_n, v: 'left' | 'center' | 'right' | 'justify') => ({ textAlign: v })
  },
  {
    id: 'text_align_vertical',
    area: 'typography',
    label: 'Vertical text alignment',
    description: 'Align the text to the top, middle, or bottom of its box.',
    keywords: /\bvertical(ly)?\s+align\w*|\balign\w*\s+(the\s+)?text\s+(to\s+the\s+)?(top|bottom|middle)\b/i,
    param: {
      kind: 'choice',
      options: {
        top: choice(/\btop\b/i, 'Top'),
        middle: choice(/\b(middle|center|centre)\b/i, 'Middle'),
        bottom: choice(/\bbottom\b/i, 'Bottom')
      }
    },
    appliesTo: isText,
    read: (n) => n.textAlignVertical || 'top',
    apply: (_n, v: 'top' | 'middle' | 'bottom') => ({ textAlignVertical: v })
  },
  {
    id: 'text_decoration',
    area: 'typography',
    label: 'Decoration',
    description: 'Underline or strike through the text, or remove decoration.',
    keywords: /\b(underline\w*|strike[\s-]?through|strikethrough|line[\s-]?through|crossed out|decoration)\b/i,
    param: {
      kind: 'choice',
      options: {
        underline: choice(/\bunderline\w*\b(?!.*\b(remove|no)\b)/i, 'Underline'),
        'line-through': choice(/\b(strike[\s-]?through|strikethrough|line[\s-]?through|crossed out)\b/i, 'Strikethrough'),
        none: choice(/\b(remove|no|none|without)\b/i, 'None')
      }
    },
    appliesTo: isText,
    read: (n) => n.textDecoration || 'none',
    apply: (_n, v: 'none' | 'underline' | 'line-through') => ({ textDecoration: v })
  },
  {
    id: 'text_case',
    area: 'typography',
    label: 'Letter case',
    description: 'Change the case: uppercase / all caps, lowercase, title case, small caps, or as typed.',
    keywords: /\b(upper[\s-]?case|all caps|capitali[sz]e|lower[\s-]?case|title[\s-]?case|small[\s-]?caps|case)\b/i,
    param: {
      kind: 'choice',
      options: {
        upper: choice(/\b(upper[\s-]?case|all caps|caps lock|capitals)\b/i, 'UPPERCASE'),
        lower: choice(/\blower[\s-]?case\b/i, 'lowercase'),
        title: choice(/\b(title[\s-]?case|capitali[sz]e)\b/i, 'Title Case'),
        'small-caps': choice(/\bsmall[\s-]?caps\b/i, 'Small caps'),
        none: choice(/\b(normal|original|as typed|none|remove)\b/i, 'As typed')
      }
    },
    appliesTo: isText,
    read: (n) => n.textCase || 'none',
    apply: (_n, v: DesignNode['textCase']) => ({ textCase: v })
  },
  {
    id: 'text_resize',
    area: 'typography',
    label: 'Text box resizing',
    description: 'Make the text box auto width, auto height (wraps at a fixed width), or a fixed size.',
    keywords: /\b(auto[\s-]?width|auto[\s-]?height|fixed size|text box|wrap the text|wrapping|resiz\w*)\b/i,
    param: {
      kind: 'choice',
      options: {
        'auto-width': choice(/\bauto[\s-]?width\b|\bone line\b|\bno wrap\b/i, 'Auto width'),
        'auto-height': choice(/\bauto[\s-]?height\b|\bwrap\b/i, 'Auto height'),
        fixed: choice(/\bfixed\b/i, 'Fixed size')
      }
    },
    appliesTo: isText,
    read: (n) => n.textResize || 'auto-width',
    apply: (_n, v: 'auto-width' | 'auto-height' | 'fixed') => ({ textResize: v })
  },
  {
    id: 'paragraph_spacing',
    area: 'typography',
    label: 'Paragraph spacing',
    description: 'Set the space between paragraphs in pixels.',
    keywords: /\bparagraph[\s-]?spacing|space between paragraphs\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 1000, step: 4 },
    appliesTo: isText,
    read: (n) => n.paragraphSpacing ?? 0,
    apply: (_n, v: number) => ({ paragraphSpacing: v })
  },
  {
    id: 'paragraph_indent',
    area: 'typography',
    label: 'Paragraph indent',
    description: 'Indent the first line of each paragraph in pixels.',
    keywords: /\b(paragraph[\s-]?)?indent\w*\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 1000, step: 8 },
    appliesTo: isText,
    read: (n) => n.paragraphIndent ?? 0,
    apply: (_n, v: number) => ({ paragraphIndent: v })
  },
  {
    id: 'list_style',
    area: 'typography',
    label: 'List style',
    description: 'Turn the text into a bulleted list, a numbered list, or plain paragraphs.',
    keywords: /\b(bullet\w*|numbered|ordered list|unordered list|list)\b/i,
    param: {
      kind: 'choice',
      options: {
        unordered: choice(/\b(bullet\w*|unordered)\b/i, 'Bulleted'),
        ordered: choice(/\b(numbered|ordered|numbers)\b/i, 'Numbered'),
        none: choice(/\b(remove|no|plain|none)\b/i, 'None')
      }
    },
    appliesTo: isText,
    read: (n) => n.listStyle || 'none',
    apply: (_n, v: 'none' | 'ordered' | 'unordered') => ({ listStyle: v })
  },
  {
    id: 'truncate',
    area: 'typography',
    label: 'Truncate text',
    description: 'Truncate overflowing text with an ellipsis, or stop truncating.',
    keywords: /\b(truncat\w*|ellipsis|clamp)\b/i,
    param: { kind: 'toggle' },
    appliesTo: isText,
    read: (n) => Boolean(n.textTruncation),
    apply: (_n, v: boolean) => ({ textTruncation: v })
  },
  {
    id: 'max_lines',
    area: 'typography',
    label: 'Max lines',
    description: 'Limit the text to a number of lines ("max 2 lines").',
    keywords: /\b(max(imum)?\s+lines?|lines? max|limit to \d+ lines?|\d+\s+lines?)\b/i,
    param: { kind: 'number', unit: 'px', min: 1, max: 1000, step: 1 },
    appliesTo: isText,
    read: (n) => n.maxLines ?? 1,
    apply: (_n, v: number) => ({ maxLines: Math.round(v), textTruncation: true })
  },
  {
    id: 'text_wrap',
    area: 'typography',
    label: 'Text wrap style',
    description: 'Set how lines wrap: auto, pretty (avoids orphans), or balance (even lines).',
    keywords: /\b(balance\w*|pretty|orphans?|wrap style)\b/i,
    param: {
      kind: 'choice',
      options: {
        balance: choice(/\bbalance\w*\b/i, 'Balance'),
        pretty: choice(/\b(pretty|orphans?)\b/i, 'Pretty'),
        auto: choice(/\b(auto|normal|default)\b/i, 'Auto')
      }
    },
    appliesTo: isText,
    read: (n) => n.textWrapStyle || 'auto',
    apply: (_n, v: 'auto' | 'pretty' | 'balance') => ({ textWrapStyle: v })
  },

  // Auto layout (frames)
  {
    id: 'layout_direction',
    area: 'layout',
    label: 'Auto layout direction',
    description: 'Turn on auto layout / flexbox, switch it between row and column, or remove it.',
    keywords: /\b(flex\s*box|flexbox|auto[\s-]?layout|row|column|horizontal(ly)?|vertical(ly)?|side by side|stack(ed)?)\b/i,
    unless: /\b(align|justify|text|flip|mirror|padding|gap)\b/i,
    param: {
      kind: 'choice',
      options: {
        none: choice(/\b(remove|turn off|disable|get rid of)\b/i, 'Off'),
        vertical: choice(/\b(column|vertical(ly)?|stack(ed)?)\b/i, 'Column (vertical)'),
        horizontal: choice(/\b(row|horizontal(ly)?|side by side|flex\s*box|flexbox|flex|auto[\s-]?layout)\b/i, 'Row (horizontal)')
      }
    },
    appliesTo: isFrame,
    read: (n) => n.layout?.mode || 'none',
    apply: (n, v: 'horizontal' | 'vertical' | 'none', ctx) => {
      if (v === 'none') return { layout: { ...(n.layout || { mode: 'none' }), mode: 'none' } }
      if (!isAutoLayout(n)) {
        const working = ctx.nodes.map((item) => (item.id === n.id && item.type !== 'frame' ? { ...item, type: 'frame' as const } : item))
        return enableAutoLayoutOnFrame(working, n.id, { mode: v })
      }
      return { layout: { ...n.layout!, mode: v, grid: undefined } }
    }
  },
  {
    id: 'layout_gap',
    area: 'layout',
    label: 'Gap',
    description: 'Set the space between items in auto layout ("gap 12", "more space between items", "gap auto").',
    keywords: /\b(gap|gutter|space between|spacing between|item spacing)\b/i,
    unless: /\bparagraph/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 2000, step: 4, allowAuto: true },
    appliesTo: isFrame,
    read: (n) => (typeof n.layout?.gap === 'number' ? n.layout.gap : 0),
    apply: (n, v: number | 'auto', ctx) => withLayout(n, ctx.nodes, () => ({ gap: v === 'auto' ? 'auto' : v }))
  },
  {
    id: 'layout_padding',
    area: 'layout',
    label: 'Padding',
    description: 'Set padding inside the frame, on all or specific sides ("padding 24", "horizontal padding 16", "padding top 8").',
    keywords: /\bpadding\b|\binset\b/i,
    param: { kind: 'number', unit: 'px', min: 0, max: 2000, step: 8 },
    appliesTo: isFrame,
    read: (n) => {
      const p = normalizePadding(n.layout?.padding)
      return Math.max(p.t, p.r, p.b, p.l)
    },
    apply: (n, v: number, ctx) =>
      withLayout(n, ctx.nodes, (layout) => {
        const p = { ...normalizePadding(layout.padding) }
        for (const side of paddingSides(ctx.request)) p[side] = v
        return { padding: p.t === p.r && p.r === p.b && p.b === p.l ? p.t : p }
      })
  },
  {
    id: 'align_items',
    area: 'layout',
    label: 'Align items',
    description: 'Align the items on the cross axis of auto layout: start, center, end, or stretch ("center the items").',
    keywords: /\balign[\s-]?items\b|\b(center|centre)\s+(the\s+)?(items|children|content)\b|\b(items|children|content)\b.*\b(center|centre|top|bottom|left|right|stretch)\b/i,
    param: { kind: 'choice', options: ALIGN_ITEMS },
    appliesTo: isFrame,
    read: (n) => n.layout?.alignItems || 'start',
    apply: (n, v: AutoLayout['alignItems'], ctx) => withLayout(n, ctx.nodes, () => ({ alignItems: v }))
  },
  {
    id: 'justify_content',
    area: 'layout',
    label: 'Distribute items',
    description: 'Distribute items along the main axis: start, center, end, or space between.',
    keywords: /\b(justify\w*|space[\s-]?between|spread (them|the items) out|distribute)\b/i,
    unless: /\btext\b/i,
    param: {
      kind: 'choice',
      options: {
        'space-between': choice(/\b(space[\s-]?between|spread|distribute)\b/i, 'Space between'),
        center: choice(/\b(center|centre|middle)\b/i, 'Center'),
        start: choice(/\b(start|left|top|beginning)\b/i, 'Start'),
        end: choice(/\b(end|right|bottom)\b/i, 'End')
      }
    },
    appliesTo: isFrame,
    read: (n) => n.layout?.justifyContent || 'start',
    apply: (n, v: AutoLayout['justifyContent'], ctx) => withLayout(n, ctx.nodes, () => ({ justifyContent: v }))
  },
  {
    id: 'layout_wrap',
    area: 'layout',
    label: 'Wrap',
    description: 'Let auto-layout items wrap onto new lines, or keep them on one line.',
    keywords: /\b(wrap|wrapping|no[\s-]?wrap)\b/i,
    unless: /\btext\b/i,
    param: { kind: 'toggle', off: /\b(no[\s-]?wrap|don'?t wrap|stop wrapping|unwrap)\b/i },
    appliesTo: isFrame,
    read: (n) => Boolean(n.layout?.wrap),
    apply: (n, v: boolean, ctx) => withLayout(n, ctx.nodes, () => ({ wrap: v }))
  },
  {
    id: 'frame_width_mode',
    area: 'layout',
    label: 'Frame width',
    description: 'Make a frame’s width hug its contents or stay fixed.',
    keywords: /\b(hug|fit)\s+(the\s+)?(width|contents? horizontally)\b|\bwidth\s+(hug|fit|fixed)\b/i,
    param: { kind: 'choice', options: { hug: SIZING.hug, fixed: SIZING.fixed } },
    appliesTo: isFrame,
    read: (n) => n.layout?.sizingH || 'fixed',
    apply: (n, v: LayoutSizing, ctx) => withLayout(n, ctx.nodes, () => ({ sizingH: v }))
  },
  {
    id: 'frame_height_mode',
    area: 'layout',
    label: 'Frame height',
    description: 'Make a frame’s height hug its contents or stay fixed.',
    keywords: /\b(hug|fit)\s+(the\s+)?(height|contents? vertically)\b|\bheight\s+(hug|fit|fixed)\b/i,
    param: { kind: 'choice', options: { hug: SIZING.hug, fixed: SIZING.fixed } },
    appliesTo: isFrame,
    read: (n) => n.layout?.sizingV || 'fixed',
    apply: (n, v: LayoutSizing, ctx) => withLayout(n, ctx.nodes, () => ({ sizingV: v }))
  },

  // Sizing inside a flex parent
  {
    id: 'width_sizing',
    area: 'sizing',
    label: 'Resizing',
    description:
      'Make it fill its container / parent, hug its contents, or stay a fixed size ("set to fill", "fill the width", "hug contents", "make it fixed"). Width unless they say height or both.',
    keywords:
      /^\s*(please\s+)?(set\s+(it\s+|this\s+)?(to\s+)?|make\s+(it\s+|this\s+)?)?(fill|hug|fixed)\b(?!\s+(it|this|with|in)\b)|\b(fill|hug|fixed)\s+(the\s+)?(container|parent|width|height|contents?|space|available|horizontally|vertically|both)\b|\b(width|height)\s+(fill|hug|fixed)\b|\bmake\s+(it|this)\s+(fill|hug)\b|\bfill\s+(the\s+)?(frame|card|section|row|column)\b/i,
    unless: /\bshaders?\b|\b(colou?r|gradient|red|blue|green|black|white|#[0-9a-f]{3,6})\b/i,
    param: { kind: 'choice', options: SIZING },
    appliesTo: (n, nodes) => Boolean(n.parentId) || n.type === 'text' || isAutoLayout(n) || inFlex(n, nodes),
    read: (n) => n.layoutSizingH || 'fixed',
    apply: (n, v: LayoutSizing, ctx) => {
      const t = ctx.request.toLowerCase()
      const both = /\b(both|all|width and height|height and width|everything|fully)\b/.test(t)
      const vertical = both || /\b(height|vertical\w*|tall)\b/.test(t)
      const horizontal = both || !/\b(height|vertical\w*|tall)\b/.test(t)
      const parent = parentOf(n, ctx.nodes)
      const flex = inFlex(n, ctx.nodes)
      const patch: Partial<DesignNode> = {}
      if (v === 'fill') {
        if (flex) {
          if (horizontal) patch.layoutSizingH = 'fill'
          if (vertical) patch.layoutSizingV = 'fill'
        } else if (parent) {
          // Not in auto layout: stretch to the parent's edges and stay pinned when it resizes.
          if (horizontal) Object.assign(patch, { x: 0, width: parent.width ?? n.width, constraintH: 'left-right' as const })
          if (vertical) Object.assign(patch, { y: 0, height: parent.height ?? n.height, constraintV: 'top-bottom' as const })
        }
        if (n.type === 'text' && horizontal) patch.textResize = 'auto-height'
        return patch
      }
      if (v === 'hug') {
        if (n.type === 'text') return { textResize: horizontal ? 'auto-width' : 'auto-height', layoutSizingH: 'fixed' }
        if (isAutoLayout(n)) {
          return {
            layout: { ...n.layout!, ...(horizontal ? { sizingH: 'hug' as LayoutSizing } : {}), ...(vertical ? { sizingV: 'hug' as LayoutSizing } : {}) },
            ...(horizontal ? { layoutSizingH: 'fixed' as LayoutSizing } : {}),
            ...(vertical ? { layoutSizingV: 'fixed' as LayoutSizing } : {})
          }
        }
        return {}
      }
      return { ...(horizontal ? sizeFixedH(n) : {}), ...(vertical ? sizeFixedV(n) : {}) }
    }
  },
  {
    id: 'absolute_position',
    area: 'sizing',
    label: 'Absolute position',
    description: 'Take it out of the auto-layout flow (absolute position), or put it back in the flow.',
    keywords: /\b(absolute|ignore (auto )?layout|out of (the )?(flow|layout)|back in(to)? (the )?(flow|layout))\b/i,
    param: { kind: 'toggle', off: /\b(back in|not absolute|relative)\b/i },
    appliesTo: inFlex,
    read: (n) => Boolean(n.layoutAbsolute),
    apply: (_n, v: boolean) => ({ layoutAbsolute: v })
  },

  // Constraints
  {
    id: 'constraint_h',
    area: 'constraints',
    label: 'Horizontal constraint',
    description: 'Pin it horizontally when the parent resizes: left, right, left and right, center, or scale.',
    keywords: /\b(constrain\w*|pin\w*|anchor\w*)\b.*\b(left|right|horizontal\w*|center|centre|scale)\b/i,
    param: {
      kind: 'choice',
      options: {
        'left-right': choice(/\bleft (and|&) right\b|\bboth sides\b|\bstretch\b/i, 'Left and right'),
        left: choice(/\bleft\b/i, 'Left'),
        right: choice(/\bright\b/i, 'Right'),
        center: choice(/\b(center|centre)\b/i, 'Center'),
        scale: choice(/\bscale\b/i, 'Scale')
      }
    },
    appliesTo: (n) => Boolean(n.parentId),
    read: (n) => n.constraintH || 'left',
    apply: (_n, v: ConstraintH) => ({ constraintH: v })
  },
  {
    id: 'constraint_v',
    area: 'constraints',
    label: 'Vertical constraint',
    description: 'Pin it vertically when the parent resizes: top, bottom, top and bottom, center, or scale.',
    keywords: /\b(constrain\w*|pin\w*|anchor\w*)\b.*\b(top|bottom|vertical\w*)\b/i,
    param: {
      kind: 'choice',
      options: {
        'top-bottom': choice(/\btop (and|&) bottom\b/i, 'Top and bottom'),
        top: choice(/\btop\b/i, 'Top'),
        bottom: choice(/\bbottom\b/i, 'Bottom'),
        center: choice(/\b(center|centre)\b/i, 'Center'),
        scale: choice(/\bscale\b/i, 'Scale')
      }
    },
    appliesTo: (n) => Boolean(n.parentId),
    read: (n) => n.constraintV || 'top',
    apply: (_n, v: ConstraintV) => ({ constraintV: v })
  },

  // Frame
  {
    id: 'clip_content',
    area: 'frame',
    label: 'Clip content',
    description: 'Clip (hide) content that overflows the frame, or let it show outside.',
    keywords: /\b(clip\w*|overflow)\b/i,
    param: { kind: 'toggle', off: /\b(don'?t clip|no clip|unclip|show overflow|overflow visible|stop clipping)\b/i },
    appliesTo: isFrame,
    read: (n) => n.clipsContent !== false,
    apply: (_n, v: boolean) => ({ clipsContent: v })
  },
  {
    id: 'layer_name',
    area: 'frame',
    label: 'Layer name',
    description: 'Rename the layer in the layers panel (not the visible text).',
    keywords: /\b(layer name|rename (the |this )?layer|name (the |this )?layer)\b/i,
    param: { kind: 'text' },
    appliesTo: anyLayer,
    read: (n) => n.name,
    apply: (_n, v: string) => ({ name: v })
  }
]

const BY_ID = new Map(CAPABILITIES.map((cap) => [cap.id, cap]))

export function capabilityById(id: string): Capability | undefined {
  return BY_ID.get(id)
}

// ---- Jev questions ----

export const AREA_DESCRIPTIONS: Record<CapArea | 'component', string> = {
  component:
    'Not an inspector property: change the words or label, a button style variant (primary / outline / ghost), checked state, dark or light theme, reorder items, add or remove elements, or make it generally bigger / smaller / wider.',
  shape: 'Change what kind of shape it is: turn it into a circle, ellipse, square, rectangle, triangle, diamond, polygon, or star.',
  size: 'Size, making it bigger / smaller / wider / taller, position, rotation, flipping, or aspect ratio.',
  corners: 'Corner radius / rounded corners.',
  fill: 'Fill or background color, gradient, fill opacity, removing the fill, or adding / changing / pausing / removing a shader (animated generative fill like mesh gradient, liquid metal, god rays).',
  stroke: 'Stroke / border / outline on any layer (shapes, frames, images, text, lines, paths): adding one, color, thickness, opacity, dashed or dotted, inside / center / outside, line ends, corner joins, or removing it.',
  effects: 'Shadows (drop or inner, blur, distance, color, strength) and layer or background blur.',
  appearance: 'Layer opacity / transparency, blend mode, hiding or showing, locking.',
  typography: 'Text styling: font, size, weight, italic, text color, line height, letter spacing, alignment, case, decoration, lists, truncation, wrapping.',
  layout: 'Auto layout / flexbox on a frame: direction (row / column), gap, padding, aligning or distributing items, wrapping, hug or fixed frame size.',
  sizing: 'How a child sizes inside auto layout: fill container, hug contents, fixed, or absolute position.',
  constraints: 'Constraints / pinning to the parent edges when it resizes.',
  frame: 'Frame clipping / overflow, or renaming the layer.'
}

const AREAS = Object.keys(AREA_DESCRIPTIONS).filter((area) => area !== 'component') as CapArea[]

export function capabilityQuestions(): JevQuestions {
  const questions: JevQuestions = {
    area: {
      type: 'choice',
      instructions:
        'Which group does the request belong to? Pick "component" for UI component changes that are not a specific property, structure action, or app action.',
      criteria: { ...AREA_DESCRIPTIONS, ...COMMAND_AREA_DESCRIPTIONS }
    }
  }
  for (const area of AREAS) {
    const criteria: Record<string, string> = {}
    for (const cap of CAPABILITIES) if (cap.area === area) criteria[cap.id] = cap.description
    questions[`cap_${area}`] = {
      type: 'choice',
      instructions: `If the change is about ${area}, which exact property? Otherwise pick the closest.`,
      criteria
    }
  }
  for (const area of Object.keys(COMMAND_AREA_DESCRIPTIONS) as CommandArea[]) {
    const criteria: Record<string, string> = {}
    for (const command of COMMANDS) if (command.area === area) criteria[command.id] = command.description
    questions[`cap_${area}`] = {
      type: 'choice',
      instructions: `If the request is a ${area === 'app' ? 'app' : 'layer structure'} action, which one? Otherwise pick the closest.`,
      criteria
    }
  }
  return questions
}

/** Follow-up question when a choice value (e.g. which blend mode) isn't in the words. */
export function choiceQuestion(cap: Capability): JevChoiceQuestion | null {
  if (cap.param.kind !== 'choice') return null
  const criteria: Record<string, string> = {}
  for (const [key, option] of Object.entries(cap.param.options)) criteria[key] = option.label
  return { type: 'choice', instructions: `Which ${cap.label.toLowerCase()} is the user asking for?`, criteria }
}

// ---- matching + applying ----

const FOLLOW_WORD = /^(thicker|thinner|stronger|weaker|darker|increase|decrease|higher|lower|further|bump|more|less|again|repeat)$/
const FILLER = new Set(
  'make it this that them a an the bit little lot much even slightly please way some just do one time go keep going can you now still too so very really tad touch'.split(' ')
)
const REPEAT = /^\s*(again|do (that|it) again|one more time|keep going|repeat( that)?)\s*[.!]?\s*$/i

/** Only a nudge with no new subject ("thicker", "a bit more", "again"), not "make it more blue". */
function isFollowUp(request: string): boolean {
  const words = request.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  const content = words.filter((word) => !FILLER.has(word))
  return words.some((word) => FOLLOW_WORD.test(word)) && content.every((word) => FOLLOW_WORD.test(word))
}
/** The number to nudge when a follow-up names no property: "thicker" after adding a border means the border. */
const FOLLOW_NUMERIC: Partial<Record<CapArea, string>> = {
  stroke: 'stroke_width',
  corners: 'corner_radius',
  effects: 'shadow_blur',
  fill: 'fill_opacity',
  appearance: 'opacity',
  typography: 'font_size',
  layout: 'layout_gap',
  size: 'scale'
}

/** Continue the previous edit: "again" repeats it, "thicker" / "more" / "less" nudges its number. */
function followUp(request: string, last: LastEdit | undefined, node: DesignNode): PropertyEdit[] {
  if (!last?.properties.length || !(isFollowUp(request) || REPEAT.test(request))) return []
  if (REPEAT.test(request)) return last.properties.map((id) => ({ id, request: last.request }))
  const caps = last.properties.map((id) => capabilityById(id)).filter((cap): cap is Capability => Boolean(cap))
  const numeric = caps.filter((cap) => cap.param.kind === 'number')
  const ids = numeric.length ? numeric.map((cap) => cap.id) : [FOLLOW_NUMERIC[caps[0]?.area as CapArea]].filter((id): id is string => Boolean(id))
  return ids
    .map((id) => capabilityById(id))
    .filter((cap): cap is Capability => Boolean(cap) && resolveValue(cap!, request, node).ok)
    .map((cap) => ({ id: cap.id }))
}

/** Every capability the words clearly name, with a value we can read. Used for instant edits. */
export function matchCapabilities(request: string, node: DesignNode, last?: LastEdit): PropertyEdit[] {
  const found: PropertyEdit[] = []
  for (const cap of CAPABILITIES) {
    if (!cap.keywords.test(request)) continue
    if (cap.unless?.test(request)) continue
    // Jev-built components resize their parts smartly (button height, field box); leave "bigger" to that.
    if (cap.id === 'scale' && node.uiRole) continue
    const resolved = resolveValue(cap, request, node)
    if (!resolved.ok) continue
    found.push({ id: cap.id })
  }
  if (!found.length) return followUp(request, last, node)
  // A more specific capability wins over its generic sibling (e.g. corner_tl over corner_radius, shadow_blur over drop_shadow).
  const ids = new Set(found.map((edit) => edit.id))
  const drop = new Set<string>()
  if ([...ids].some((id) => id.startsWith('corner_') && id !== 'corner_radius')) drop.add('corner_radius')
  if ([...ids].some((id) => id.startsWith('shadow_'))) {
    drop.add('shadow_color')
    if (!/\b(add|drop)\b/i.test(request)) drop.add('drop_shadow')
  }
  if (ids.has('stroke_remove')) {
    for (const id of ['stroke_color', 'stroke_width', 'stroke_style', 'stroke_add', 'stroke_opacity']) drop.add(id)
  }
  // Any specific stroke setting already adds the stroke.
  if (['stroke_color', 'stroke_width', 'stroke_style', 'stroke_opacity', 'stroke_align'].some((id) => ids.has(id))) drop.add('stroke_add')
  if (ids.has('fill_remove') || ids.has('fill_gradient')) drop.add('fill_color')
  // Colors and "gradient" in a shader request describe the shader itself.
  if (ids.has('shader')) {
    for (const id of ['fill_color', 'fill_gradient', 'text_color', 'layout_wrap', 'stroke_color']) drop.add(id)
  }
  if (ids.has('text_color')) drop.add('fill_color')
  if (ids.has('font_family') && ids.has('font_size') && !numbersIn(request).length) drop.add('font_size')
  if (ids.has('width') && ids.has('height') && /\bline[\s-]?height\b/i.test(request)) drop.add('height')
  if (ids.has('width_sizing')) {
    for (const id of ['frame_width_mode', 'frame_height_mode', 'width', 'height']) drop.add(id)
  }
  // "make it bigger" resizes the whole thing; "wider" / "taller" / "the text bigger" only one thing.
  if (ids.has('scale') && (ids.has('width') || ids.has('height') || ids.has('font_size'))) drop.add('scale')
  if (ids.has('shape_type')) {
    for (const id of ['corner_radius', 'width', 'height']) drop.add(id)
  }
  return found.filter((edit) => !drop.has(edit.id))
}

/** Where a property lands: the layer itself, its text (for type edits), or its auto-layout frame. */
function targetsFor(cap: Capability, node: DesignNode, nodes: DesignNode[]): DesignNode[] {
  if (cap.appliesTo(node, nodes)) return [node]
  if (cap.area === 'typography') {
    const out: DesignNode[] = []
    const walk = (id: string) => {
      for (const child of nodes) {
        if (child.parentId !== id) continue
        if (isText(child)) out.push(child)
        walk(child.id)
      }
    }
    walk(node.id)
    return out
  }
  if (cap.area === 'layout') {
    let cur = parentOf(node, nodes)
    while (cur && !isFrame(cur)) cur = parentOf(cur, nodes)
    return cur ? [cur] : []
  }
  return []
}

function formatValue(cap: Capability, value: unknown, unit?: string): string {
  if (cap.param.kind === 'action') return ''
  if (cap.param.kind === 'toggle') return value ? 'on' : 'off'
  if (cap.param.kind === 'choice') return cap.param.options[String(value)]?.label || String(value)
  if (cap.param.kind === 'gradient') return Array.isArray(value) && value.length ? value.join(' → ') : ''
  if (cap.param.kind === 'shader') return shaderLabel(String(value))
  if (cap.id === 'shader_speed') return Number(value) === 0 ? 'paused' : `${Math.round(Number(value) * 100)}%`
  if (cap.param.kind === 'number') {
    if (value === 'auto') return 'Auto'
    const n = Number(value)
    if (cap.param.unit === '%') return cap.id === 'letter_spacing' && unit === 'px' ? `${n}px` : cap.id === 'letter_spacing' ? `${n}%` : `${Math.round(n * 100)}%`
    if (cap.param.unit === 'deg') return `${n}°`
    return cap.id === 'max_lines' ? String(n) : `${n}px`
  }
  return String(value)
}

export type PropertyResult = { nodes: DesignNode[]; summary: string; touchedId: string | null } | { error: string }

export function applyProperties(edits: PropertyEdit[], targets: DesignNode[], nodes: DesignNode[], request: string, labelOf: (node: DesignNode, nodes: DesignNode[]) => string): PropertyResult {
  let working = nodes
  const changed: string[] = []
  const touched = new Set<string>()
  let lastError = ''
  for (const edit of edits) {
    const cap = capabilityById(edit.id)
    if (!cap) continue
    let appliedHere = false
    let shown = ''
    for (const target of targets) {
      const live = working.find((item) => item.id === target.id)
      if (!live) continue
      for (const node of targetsFor(cap, live, working)) {
        const current = working.find((item) => item.id === node.id) || node
        const words = edit.request || request
        const resolved = resolveValue(cap, words, current, edit.value)
        if (!resolved.ok) {
          lastError = resolved.reason
          continue
        }
        const out = cap.apply(current, resolved.value, { nodes: working, request: words, unit: resolved.unit })
        working = Array.isArray(out) ? out : working.map((item) => (item.id === current.id ? { ...item, ...out } : item))
        touched.add(current.id)
        appliedHere = true
        shown = formatValue(cap, resolved.value, resolved.unit)
      }
    }
    if (appliedHere) changed.push(shown ? `${cap.label.toLowerCase()} ${shown}` : cap.label.toLowerCase())
    else if (!lastError) lastError = `${cap.label} doesn’t apply to that layer.`
  }
  if (!changed.length) return { error: lastError || 'Nothing to change.' }
  working = working.map((item) => (touched.has(item.id) && isText(item) ? remeasureText(item) : item))
  const first = targets[0]
  const label = first ? labelOf(working.find((item) => item.id === first.id) || first, working) : 'layer'
  const what = changed.length === 1 ? changed[0] : `${changed.slice(0, -1).join(', ')} and ${changed[changed.length - 1]}`
  return { nodes: working, summary: `Set ${what} on ${label}`, touchedId: first?.id || null }
}
