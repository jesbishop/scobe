import type { DesignNode } from '../shared/types'
import type { JevAnswers, JevChoiceAnswer, JevQuestions } from '../shared/jev'
import { enableAutoLayoutOnFrame, expandWithDescendants, isAutoLayout, normalizePadding, reflowAutoLayout } from '../shared/layoutEngine'
import {
  buildComponent,
  buttonPaint,
  buttonTextColor,
  checkboxPaint,
  checkMark,
  COMPONENT_ROLES,
  measureText,
  ROLE_LABEL,
  UI,
  type ButtonVariant,
  type UiKind
} from './jevComponents'
import { applyProperties, capabilityById, capabilityQuestions, matchCapabilities, type LastEdit, type PropertyEdit } from './jevCapabilities'
import { commandById, matchCommand, type CommandId } from './jevCommands'

export type JevStep = {
  key: string
  label: string
  tag: string
  title: string
  detail?: string
  state: 'done' | 'active' | 'pending'
}

export type JevOption = { key: string; label: string; probability: number }

export type JevDecision = {
  id: string
  request: string
  status: 'deciding' | 'applied' | 'needs-choice' | 'noop' | 'error' | 'undone'
  pointerLabel?: string
  steps: JevStep[]
  meta?: { latencyMs: number; questions: number; model: string }
  result?: string
  options?: JevOption[]
  error?: string
}

export type JevCanvas = {
  nodes: DesignNode[]
  pageId: string
  defaultPageId: string
  pointerId: string | null
  selectedIds: string[]
  lastTargetId: string | null
  center: { x: number; y: number }
  /** Previous property edit, for follow-ups like "thicker" or "again". */
  lastEdit?: LastEdit
}

type Candidate = { key: string; node: DesignNode; label: string; detail: string }

export type JevContext = {
  request: string
  root: DesignNode | null
  candidates: Candidate[]
  pointer: Candidate | null
  state: string
  contextTitle: string
  contextDetail: string
  /** Exactly the selected layers (not resolved to components). */
  selected: DesignNode[]
  lastEdit?: LastEdit
}

/** `command` runs a structure/app action in App; `delegate` hands the request to Claude. */
type Action = 'add' | 'create' | 'edit' | 'remove' | 'none' | 'command' | 'delegate'
type Position = 'end' | 'start' | 'after' | 'before' | 'inside'

const ACTIONS: Record<Exclude<Action, 'command' | 'delegate'>, string> = {
  add: 'Add a new element (text field, button, checkbox, heading, description, divider…) into the existing design on the canvas.',
  create:
    'Start a brand-new, separate design (e.g. "make a card", "create a login dialog") because the canvas has no design yet, or the user explicitly asks for a new or another one.',
  edit: 'Change something that already exists: its text or label, size, width, color, style variant, alignment, spacing, corners, shadow, order, or checked state.',
  remove: 'Delete, remove, or get rid of an existing element.',
  none: 'Not a design instruction: filler, chit-chat, thinking out loud, a question, or an incomplete fragment.'
}

const COMPONENTS: Record<UiKind, string> = {
  card: 'A card, dialog, modal, panel, or form container with a title.',
  heading: 'A heading or large title text.',
  description: 'A description, subtitle, or helper text under a title.',
  text: 'A plain paragraph or body text.',
  input: 'A single-line text input / text field (email, name, password, search…).',
  textarea: 'A multi-line text area for longer messages or comments.',
  select: 'A dropdown / select menu.',
  checkbox: 'A checkbox with a label (agree to terms, remember me…).',
  switch: 'A toggle switch with a label.',
  button: 'A button (submit, send, cancel, continue…).',
  divider: 'A horizontal divider line / separator.',
  badge: 'A small badge, pill, or tag label.',
  avatar: 'A round avatar / profile picture.',
  image: 'An image, photo, or media placeholder.'
}

type Edit =
  | 'text'
  | 'full_width'
  | 'fit_width'
  | 'wider'
  | 'narrower'
  | 'size'
  | 'color'
  | 'style_primary'
  | 'style_secondary'
  | 'style_outline'
  | 'style_ghost'
  | 'style_destructive'
  | 'bigger'
  | 'smaller'
  | 'bolder'
  | 'lighter'
  | 'rounder'
  | 'radius'
  | 'sharper'
  | 'align_center'
  | 'align_left'
  | 'align_right'
  | 'shadow_on'
  | 'shadow_off'
  | 'more_padding'
  | 'less_padding'
  | 'more_gap'
  | 'less_gap'
  | 'check'
  | 'uncheck'
  | 'dark'
  | 'light'
  | 'horizontal'
  | 'vertical'
  | 'flex'
  | 'move_up'
  | 'move_down'
  | 'hide'
  /** Any inspector property from the capability catalog. */
  | 'property'

const EDITS: Record<Exclude<Edit, 'property'>, string> = {
  text: 'Change the words: rename, relabel, retitle, change the text, label, title, placeholder or copy.',
  full_width: 'Make it full width / stretch it across / fill the available width.',
  fit_width: 'Make it fit its content / auto width / not full width.',
  wider: 'Make it a bit wider (relative), with no exact pixel size said.',
  narrower: 'Make it a bit narrower / thinner (relative), with no exact pixel size said.',
  size:
    'Set an exact size in pixels when the user gives numbers: "800×800", "800 by 800", "width 400 height 200", "make it 320px wide", "make this 200px", "set height to 48". A lone pixel value means width. Prefer this over bigger/smaller whenever dimensions are named.',
  color: 'Change it to a specific color (blue, red, green, purple, black, a hex code…).',
  style_primary: 'Make it the primary / solid / filled style.',
  style_secondary: 'Make it the secondary / subtle / gray style.',
  style_outline: 'Make it an outline / bordered style.',
  style_ghost: 'Make it a ghost / transparent / text-only style.',
  style_destructive: 'Make it destructive / danger / red warning style.',
  bigger: 'Make it relatively bigger / larger with no exact pixel size given.',
  smaller: 'Make it relatively smaller / shorter with no exact pixel size given.',
  bolder: 'Make the text bold / heavier.',
  lighter: 'Make the text regular weight / not bold.',
  rounder: 'Round the corners, add corner radius, or make it pill-shaped, when no exact pixel radius is given.',
  radius: 'Set an exact corner radius in pixels: "corner radius 12", "round the corners to 16", "8px radius".',
  sharper: 'Square corners / remove the rounding.',
  align_center: 'Center it / center the content.',
  align_left: 'Align it to the left / start.',
  align_right: 'Align it to the right / end.',
  shadow_on: 'Add a shadow / elevate it.',
  shadow_off: 'Remove the shadow / make it flat.',
  more_padding: 'Add more padding / breathing room inside.',
  less_padding: 'Reduce the padding / make it tighter inside.',
  more_gap: 'Add more space between the items.',
  less_gap: 'Reduce the space between the items.',
  check: 'Check it / turn it on / make it selected.',
  uncheck: 'Uncheck it / turn it off.',
  dark: 'Switch it to dark mode / dark theme.',
  light: 'Switch it to light mode / light theme.',
  horizontal: 'Lay the items out horizontally / side by side / in a row. The element already has auto layout.',
  vertical: 'Stack the items vertically / in a column. The element already has auto layout.',
  flex: 'Turn the selected layer into a flexbox / auto layout. Use this for "flexbox", "flex", or "auto layout", including when it is not a flex container yet. Row unless they say column.',
  move_up: 'Move it up / earlier / above the previous item.',
  move_down: 'Move it down / later / below the next item.',
  hide: 'Hide it (keep it but make it invisible).'
}

const POSITIONS: Record<Position, string> = {
  end: 'At the end / bottom of the design (default when no place is mentioned).',
  start: 'At the top / beginning / first.',
  after: 'Right after, below, or under the referenced element.',
  before: 'Right before or above the referenced element.',
  inside: 'Inside the referenced container (e.g. "in the header", "in this card").'
}

function byIdMap(nodes: DesignNode[]): Map<string, DesignNode> {
  return new Map(nodes.map((node) => [node.id, node]))
}

function topAncestor(node: DesignNode, byId: Map<string, DesignNode>): DesignNode {
  let cur = node
  const seen = new Set<string>()
  while (cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId)
    const parent = byId.get(cur.parentId)
    if (!parent) break
    cur = parent
  }
  return cur
}

/** Inner parts (labels, boxes, placeholders) resolve to the component that owns them. */
export function componentOf(node: DesignNode, byId: Map<string, DesignNode>): DesignNode {
  if (!node.uiRole || COMPONENT_ROLES.has(node.uiRole) || node.uiRole === 'title') return node
  let cur: DesignNode | undefined = node
  while (cur?.parentId) {
    cur = byId.get(cur.parentId)
    if (cur?.uiRole && COMPONENT_ROLES.has(cur.uiRole)) return cur
  }
  return node
}

function childrenIn(nodes: DesignNode[], parentId: string): DesignNode[] {
  return nodes.filter((node) => node.parentId === parentId)
}

function descendantsOf(nodes: DesignNode[], rootId: string): DesignNode[] {
  const out: DesignNode[] = []
  const walk = (id: string) => {
    for (const child of childrenIn(nodes, id)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(rootId)
  return out
}

const PRIMARY_TEXT_ROLE: Record<string, string> = {
  card: 'title',
  header: 'title',
  field: 'field-label',
  checkbox: 'checkbox-label',
  switch: 'switch-label',
  button: 'button-label',
  badge: 'badge-label'
}

function primaryTextNode(node: DesignNode, nodes: DesignNode[]): DesignNode | null {
  if (node.type === 'text') return node
  const all = descendantsOf(nodes, node.id)
  const role = node.uiRole ? PRIMARY_TEXT_ROLE[node.uiRole] : undefined
  return (role && all.find((item) => item.uiRole === role)) || all.find((item) => item.type === 'text') || null
}

function quote(value: string, max = 40): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return `“${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}”`
}

export function describeNode(node: DesignNode, nodes: DesignNode[]): string {
  const role = node.uiRole
  const words = primaryTextNode(node, nodes)?.text
  if (role && ROLE_LABEL[role]) {
    if (role === 'title' || role === 'description' || role === 'heading' || role === 'text') {
      return `${ROLE_LABEL[role]} ${quote(node.text || '')}`
    }
    return words ? `${quote(words)} ${ROLE_LABEL[role]}` : ROLE_LABEL[role]
  }
  if (node.type === 'text') return `text ${quote(node.text || node.name || '')}`
  const name = node.name && !/^(frame|rect|ellipse|text)\s*\d*$/i.test(node.name) ? node.name : ''
  return `${node.type}${name ? ` ${quote(name)}` : words ? ` ${quote(words)}` : ''}`
}

/** Compact inspector readout so chat and Jev see the layer’s real settings, not just its name. */
export function describeProperties(node: DesignNode): string {
  const layout = node.layout
  const pad = layout ? normalizePadding(layout.padding) : null
  const bits = [
    node.type,
    node.width != null ? `width ${Math.round(node.width)}px` : '',
    node.height != null ? `height ${Math.round(node.height)}px` : '',
    node.radius ? `corner radius ${Math.round(node.radius)}px` : 'corners square',
    node.cornerRadii ? `corners ${node.cornerRadii.tl}/${node.cornerRadii.tr}/${node.cornerRadii.br}/${node.cornerRadii.bl}` : '',
    node.fill ? `fill ${node.fill}` : '',
    node.stroke ? `stroke ${node.stroke}${node.strokeWidth ? ` ${node.strokeWidth}px` : ''}` : '',
    node.opacity != null && node.opacity !== 1 ? `opacity ${node.opacity}` : '',
    node.rotation ? `rotation ${Math.round(node.rotation)}°` : '',
    node.fontFamily ? `font ${node.fontFamily}` : '',
    node.fontSize ? `font size ${node.fontSize}px` : '',
    node.fontWeight ? `weight ${node.fontWeight}` : '',
    node.textAlign ? `text align ${node.textAlign}` : '',
    node.text ? `text ${quote(node.text, 48)}` : '',
    layout && layout.mode !== 'none'
      ? `flex ${layout.mode}${layout.wrap ? ' wrap' : ''}${layout.gap != null ? ` gap ${layout.gap}` : ''}${pad ? ` padding ${pad.t}/${pad.r}/${pad.b}/${pad.l}` : ''}`
      : 'not a flexbox',
    node.layoutSizingH ? `width sizing ${node.layoutSizingH}` : '',
    node.layoutSizingV ? `height sizing ${node.layoutSizingV}` : '',
    node.visible === false ? 'hidden' : '',
    node.locked ? 'locked' : ''
  ]
  return bits.filter(Boolean).join(', ')
}

export function buildContext(request: string, canvas: JevCanvas): JevContext {
  const nodes = canvas.nodes
  const byId = byIdMap(nodes)
  const selectedNodes = canvas.selectedIds
    .map((id) => byId.get(id))
    .filter((node): node is DesignNode => Boolean(node))
  const pointerNode = canvas.pointerId ? byId.get(canvas.pointerId) : undefined
  // Selection always counts as the working target when nothing is being pointed at.
  const focusNode = pointerNode || selectedNodes[selectedNodes.length - 1]
  const last = canvas.lastTargetId ? byId.get(canvas.lastTargetId) : undefined
  const tops = nodes.filter(
    (node) =>
      !node.parentId && node.type !== 'comment' && (node.pageId || canvas.defaultPageId) === canvas.pageId
  )
  const anchor = focusNode || last
  const root = anchor
    ? topAncestor(anchor, byId)
    : [...tops].reverse().find((node) => node.uiRole === 'card') || null

  const listed: DesignNode[] = []
  const pushUnique = (node: DesignNode | null | undefined) => {
    if (!node) return
    if (listed.some((item) => item.id === node.id)) return
    listed.push(node)
  }
  // Selected layers first so prompts always see what the user is working on.
  for (const node of selectedNodes) {
    pushUnique(componentOf(node, byId))
    pushUnique(node)
  }
  if (focusNode) {
    pushUnique(componentOf(focusNode, byId))
    pushUnique(focusNode)
  }
  if (root) {
    pushUnique(root)
    for (const node of descendantsOf(nodes, root.id)) {
      if (node.uiRole && !COMPONENT_ROLES.has(node.uiRole) && node.uiRole !== 'title') continue
      pushUnique(node)
    }
  }
  for (const node of tops) if (listed.length < 60) pushUnique(node)

  const pointerComponent = focusNode ? componentOf(focusNode, byId) : null
  const selectedIdSet = new Set(canvas.selectedIds)
  const candidates: Candidate[] = listed.slice(0, 60).map((node, index) => {
    const parent = node.parentId ? byId.get(node.parentId) : null
    const siblings = parent ? childrenIn(nodes, parent.id) : []
    const where = parent
      ? `item ${siblings.indexOf(node) + 1} inside ${describeNode(componentOf(parent, byId), nodes)}`
      : node === root
        ? 'the design being worked on'
        : 'another design on the canvas'
    const flags: string[] = []
    if (pointerComponent?.id === node.id) flags.push('the user is pointing at this right now')
    if (selectedIdSet.has(node.id)) flags.push('currently selected')
    if (last?.id === node.id) flags.push('changed by the previous request')
    return {
      key: `e${index + 1}`,
      node,
      label: describeNode(node, nodes),
      detail: `${where}${flags.length ? ` — ${flags.join(', ')}` : ''}`
    }
  })
  const pointer = pointerComponent ? candidates.find((item) => item.node.id === pointerComponent.id) || null : null
  const selectedCandidates = candidates.filter((item) => selectedIdSet.has(item.node.id))

  const depthOf = (node: DesignNode) => {
    let d = 0
    let cur: DesignNode | undefined = node
    while (cur?.parentId && d < 12) {
      cur = byId.get(cur.parentId)
      d += 1
    }
    return d
  }
  const outline = candidates
    .map((item) => `${'  '.repeat(Math.max(0, depthOf(item.node) - (root ? depthOf(root) : 0)))}- ${item.key}: ${item.label} (${item.detail})`)
    .join('\n')
  const count = root ? descendantsOf(nodes, root.id).filter((n) => !n.uiRole || COMPONENT_ROLES.has(n.uiRole)).length : 0

  const focusCandidate = pointer || selectedCandidates[selectedCandidates.length - 1] || null
  const selectionLine =
    selectedCandidates.length > 1
      ? `The user has selected ${selectedCandidates.length} elements: ${selectedCandidates.map((item) => `${item.key} (${item.label}; ${describeProperties(item.node)})`).join(', ')}. Apply the request to these selected elements.`
      : focusCandidate
        ? `The user has selected ${focusCandidate.key}: ${focusCandidate.label}. Current settings: ${describeProperties(focusCandidate.node)}. Apply the request to this layer. Prefer this as the target.`
        : 'The user is not pointing at or selecting any element.'

  const state = [
    `Spoken design request: "${request}"`,
    selectionLine,
    last ? `The previous request changed: ${describeNode(last, nodes)}.` : '',
    root ? `Canvas: a design is in progress.` : 'Canvas: empty — no design exists yet.',
    outline ? `Elements:\n${outline}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  return {
    request,
    root,
    candidates,
    pointer,
    state,
    contextTitle: root ? describeNode(root, nodes).replace(/^“(.*)” card$/, '$1') : 'Empty canvas',
    contextDetail: root ? `Existing component · ${count} element${count === 1 ? '' : 's'}` : 'Start a new design',
    selected: selectedNodes,
    lastEdit: canvas.lastEdit
  }
}

export function buildIntentQuestions(ctx: JevContext): JevQuestions {
  const targets: Record<string, string> = {
    none: 'No existing element — the request makes something new without referring to anything, or nothing matches.'
  }
  for (const item of ctx.candidates) targets[item.key] = `${item.label}; ${item.detail}`
  return {
    action: {
      type: 'choice',
      instructions: 'What kind of change is the user asking for on the design canvas?',
      criteria: ACTIONS
    },
    target: {
      type: 'choice',
      instructions:
        'Which existing element does the request refer to? For edits or removals it is the element to change. For additions it is the container or neighbour the new item goes into or next to. "This", "that" and "here" mean the element the user is pointing at; "it" means the pointed element, otherwise the element changed by the previous request.',
      criteria: targets
    }
  }
}

export function buildQuestions(ctx: JevContext): JevQuestions {
  return {
    ...buildIntentQuestions(ctx),
    component: {
      type: 'choice',
      instructions: 'If something is being added or created, which UI component is it? Otherwise pick the closest match.',
      criteria: COMPONENTS
    },
    edit: {
      type: 'choice',
      instructions: 'If an existing element is being changed, which change is requested? Otherwise pick the closest match.',
      criteria: EDITS
    },
    position: {
      type: 'choice',
      instructions: 'If something is being added, where should it go relative to the referenced element?',
      criteria: POSITIONS
    },
    multi_step: {
      type: 'noul',
      instructions:
        'Does this request need a whole screen, section, or layout designed, several new elements built, or an open-ended redesign — more than one simple change?',
      criteria: {
        true: 'Yes, e.g. "build a login screen", "design a pricing section with three plans", "make a landing page hero", "make this look like Stripe", "create a dashboard".',
        false: 'No: one change to an existing element, one structure or app action, or adding a single simple component.'
      }
    },
    ...capabilityQuestions()
  }
}

/** Big build or open-ended redesign wording, used when Jev's multi-step answer is unavailable. */
const MULTI_STEP =
  /\b(build|design|create|make|generate|mock ?up|lay ?out)\s+(me\s+)?(a|an|the|some)?\s*([\w-]+\s+){0,4}(screen|section|layout|landing page|dashboard|hero|navbar|nav bar|footer|pricing (section|page|table)|website|onboarding flow)\b|\b(look|feel)\s+like\b|\bredesign\b|\brestyle\b/i

function choice(answers: JevAnswers, key: string): JevChoiceAnswer | null {
  const answer = answers[key]
  return answer && answer.type === 'choice' ? answer : null
}

export type ApplyResult = { nodes: DesignNode[]; summary: string; touchedId: string | null } | { error: string }

// ---- deterministic text extraction (Jev only picks; words come from the transcript) ----

const STRIP_END = /[\s.,!?;:]+$/

function cleanPhrase(value: string): string {
  return value
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .replace(STRIP_END, '')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim()
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

const DESCRIPTION_CLAUSE =
  /[,\s]+(?:and|with)\s+(?:a\s+|the\s+)?(?:description|subtitle|subtext|caption)\b[\s,:]*(?:saying|that says|which says|of|reading|that reads)?[\s,:]*(.+)$/i

export function extractDescription(request: string): string | undefined {
  const m = request.match(DESCRIPTION_CLAUSE)
  return m ? cleanPhrase(m[1]) || undefined : undefined
}

const COMPONENT_WORDS =
  'input|field|text field|textfield|text box|textbox|text area|textarea|button|badge|checkbox|check box|toggle|switch|dropdown|select|card|dialog|modal|heading|title'
const ADJECTIVES =
  /\b(?:new|another|primary|secondary|outline(?:d)?|ghost|destructive|danger|full[- ]width|small|large|big|little|simple|basic|single|multi[- ]line|red|blue|green|black|white|gray|grey)\b/gi

export function extractLabel(request: string, kind: UiKind): string | undefined {
  const body = request.replace(DESCRIPTION_CLAUSE, '')
  const named = body.match(
    /\b(?:titled|entitled|called|named|labell?ed|saying|that says|which says|reading|that reads|with (?:the )?(?:text|label|title|copy|heading))\s*[,:]?\s*(.+)$/i
  )
  if (named) return capitalize(cleanPhrase(named[1]))
  const quoted = body.match(/["“]([^"”]+)["”]/)
  if (quoted) return cleanPhrase(quoted[1])
  if (kind === 'card' || kind === 'divider' || kind === 'avatar' || kind === 'image') return undefined
  const noun = body.match(new RegExp(`\\b(?:an?|the|one)\\s+([\\w' -]+?)\\s+(?:${COMPONENT_WORDS})\\b`, 'i'))
  if (noun) {
    const words = noun[1].replace(ADJECTIVES, ' ').replace(/\s+/g, ' ').trim()
    if (words && words.split(' ').length <= 4) return capitalize(words)
  }
  return undefined
}

export function extractNewText(request: string): string | undefined {
  const quoted = request.match(/["“]([^"”]+)["”]/)
  if (quoted) return cleanPhrase(quoted[1])
  const m = request.match(
    /\b(?:to say|to read|say|read|rename(?:d)?(?:\s+(?:it|this|that|the\s+[\w -]+?))?\s+(?:to|as)|(?:change|set|update|make)(?:\s+(?:it|this|that|the\s+[\w -]+?))?\s+to|to)\s+(.+)$/i
  )
  return m ? capitalize(cleanPhrase(m[1])) || undefined : undefined
}

export const NAMED_COLORS: Record<string, string> = {
  // Core
  red: '#dc2626',
  maroon: '#800000',
  crimson: '#dc143c',
  scarlet: '#ff2400',
  coral: '#ff7f50',
  salmon: '#fa8072',
  orange: '#ea580c',
  amber: '#f59e0b',
  gold: '#ca8a04',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#16a34a',
  emerald: '#059669',
  mint: '#99f6e4',
  teal: '#0d9488',
  cyan: '#0891b2',
  aqua: '#22d3ee',
  sky: '#0ea5e9',
  blue: '#2563eb',
  navy: '#1e3a8a',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  purple: '#9333ea',
  magenta: '#d946ef',
  fuchsia: '#c026d3',
  pink: '#db2777',
  rose: '#e11d48',
  brown: '#92400e',
  chocolate: '#7b3f00',
  tan: '#d2b48c',
  beige: '#f5f5dc',
  cream: '#fffdd0',
  ivory: '#fffff0',
  peach: '#ffcba4',
  lavender: '#c4b5fd',
  lilac: '#c8a2c8',
  plum: '#8b5cf6',
  olive: '#6b7280',
  charcoal: '#374151',
  black: '#0a0a0a',
  white: '#ffffff',
  gray: '#737373',
  grey: '#737373',
  silver: '#c0c0c0',
  // CSS keyword aliases
  rebeccapurple: '#663399',
  darkred: '#8b0000',
  darkblue: '#00008b',
  darkgreen: '#006400',
  lightblue: '#add8e6',
  lightgreen: '#90ee90',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  hotpink: '#ff69b4',
  deeppink: '#ff1493',
  turquoise: '#40e0d0',
  slate: '#64748b',
  steel: '#4682b4'
}

export function extractColor(request: string): string | undefined {
  const hex = request.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i)
  if (hex) return `#${hex[1]}`
  const word = request.toLowerCase().match(new RegExp(`\\b(${Object.keys(NAMED_COLORS).join('|')})\\b`))
  return word ? NAMED_COLORS[word[1]] : undefined
}

/** Pull exact pixel dimensions from speech/text. Words come from the transcript; Jev only picks `size`. */
export function extractDimensions(request: string): { width?: number; height?: number } | undefined {
  const clamp = (n: number) => Math.max(1, Math.min(10000, Math.round(n)))
  const pair =
    request.match(
      /(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)\s*(?:px|pixels?)?/i
    ) ||
    request.match(
      /\b(?:size|resize|make(?:\s+it)?|set(?:\s+it)?(?:\s+to)?)\s+(\d+(?:\.\d+)?)\s*(?:[x×*]|by)\s*(\d+(?:\.\d+)?)/i
    )
  if (pair) return { width: clamp(Number(pair[1])), height: clamp(Number(pair[2])) }

  const widthOnly = request.match(
    /\b(?:width|wide|w)\s*(?:to|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\b|\b(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s*(?:wide|width)\b/i
  )
  const heightOnly = request.match(
    /\b(?:height|tall|h)\s*(?:to|=|:)?\s*(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\b|\b(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s*(?:tall|height)\b/i
  )
  const width = widthOnly ? Number(widthOnly[1] || widthOnly[2]) : undefined
  const height = heightOnly ? Number(heightOnly[1] || heightOnly[2]) : undefined
  if (width != null || height != null) {
    return {
      ...(width != null && Number.isFinite(width) ? { width: clamp(width) } : {}),
      ...(height != null && Number.isFinite(height) ? { height: clamp(height) } : {})
    }
  }
  // "make this 200px" with no axis means the width, unless the number belongs to radius, gap, type, etc.
  if (/\b(radius|corner|gap|padding|font|opacity|blur|weight)\b/i.test(request)) return undefined
  const lone = request.match(/\b(\d+(?:\.\d+)?)\s*(?:px|pixels?)\b/i)
  if (!lone || !Number.isFinite(Number(lone[1]))) return undefined
  return { width: clamp(Number(lone[1])) }
}

/** Exact corner radius from "round the corners to 16" or "corner radius 12". */
export function extractCornerRadius(request: string): number | undefined {
  const match =
    request.match(/\bround(?:ed)?\s+(?:the\s+|its\s+)?corners?\s+(?:to|at|by)\s*(\d+(?:\.\d+)?)/i) ||
    request.match(/\b(?:corner\s*radius|border\s*radius|radius)\s*(?:to|of|=|:)?\s*(\d+(?:\.\d+)?)/i) ||
    request.match(/\b(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s*(?:corner\s*)?radius\b/i) ||
    request.match(/\b(\d+(?:\.\d+)?)\s*(?:px|pixels?)?\s+corners?\b/i)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(9999, Math.round(value)))
}

function extractVariant(request: string): ButtonVariant | undefined {
  const m = request.toLowerCase().match(/\b(primary|secondary|outline|outlined|ghost|destructive|danger)\b/)
  if (!m) return undefined
  if (m[1] === 'outlined') return 'outline'
  if (m[1] === 'danger') return 'destructive'
  return m[1] as ButtonVariant
}

/** Whisper often emits these on silence. */
export function isNoise(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
  return !t || /^(you|thank you|thanks|bye|okay|ok|um+|uh+|hmm+|so)$/.test(t)
}

/** Words that start a new instruction, so "make it bigger and round the corners" is two edits. */
const INSTRUCTION_VERB =
  'make|set|add|remove|round|change|turn|give|put|rotate|flip|mirror|center|align|move|nudge|duplicate|hide|show|lock|unlock|bold|underline|italicize|increase|decrease|use|apply|resize|scale|wrap|group|ungroup|send|bring|delete|fill|hug|pause|straighten|tilt|outline|rename|switch|convert|reduce|raise|lower|shrink|grow|copy'
const CLAUSE_BREAK = new RegExp(`\\s*(?:,\\s*(?:and\\s+|then\\s+|and then\\s+)?|\\s+and\\s+(?:then\\s+)?|\\s+then\\s+|;\\s*)(?=(?:${INSTRUCTION_VERB})\\b)`, 'i')

/** Splits a dictated paragraph into one instruction per sentence, and chained instructions within a sentence. */
export function splitRequests(text: string): string[] {
  return text
    .split(/(?<=[.!?]["”']?)\s+(?=[A-Z])/)
    .flatMap((sentence) => sentence.split(CLAUSE_BREAK))
    .map((part) => part.trim().replace(/^(and|then)\s+/i, ''))
    .filter((part) => part && !isNoise(part))
}

// ---- plan + apply ----

export type JevPlan = {
  action: Action
  target: Candidate | null
  kind: UiKind
  edit: Edit
  position: Position
  confidence: number
  targetConfidence: number
  /** Set when `edit === 'property'`. */
  properties?: PropertyEdit[]
  /** Set when `action === 'command'`. */
  command?: CommandId
  /** What to do instead when `delegate` can't reach Claude (no API key). */
  fallbackAction?: Action
}

export function planFromAnswers(ctx: JevContext, answers: JevAnswers, override?: Partial<Record<string, string>>): JevPlan {
  const pick = (key: string, fallback: string) => override?.[key] || choice(answers, key)?.choice || fallback
  const action = pick('action', 'none') as Action
  const targetKey = pick('target', 'none')
  let target = ctx.candidates.find((item) => item.key === targetKey) || null
  // Editing or removing always needs a subject; fall back to what the user points at.
  if (!target && (action === 'edit' || action === 'remove')) target = ctx.pointer
  const plan: JevPlan = {
    action,
    target,
    kind: pick('component', 'text') as UiKind,
    edit: pick('edit', 'text') as Edit,
    position: pick('position', 'end') as Position,
    confidence: override?.action ? 1 : (choice(answers, 'action')?.confidence ?? 0),
    targetConfidence: override?.target ? 1 : (choice(answers, 'target')?.confidence ?? 0)
  }
  const area = pick('area', 'component')
  const local = matchCommand(ctx.request, ctx.selected)
  if (local) return { ...plan, action: 'command', command: local }
  const multiStep = answers.multi_step?.type === 'noul' ? answers.multi_step.noul > 0.5 : false
  if (action !== 'none' && (multiStep || MULTI_STEP.test(ctx.request))) {
    return { ...plan, action: 'delegate', fallbackAction: action }
  }
  if (area === 'structure' || area === 'app') {
    const commandId = choice(answers, `cap_${area}`)?.choice
    if (commandId && commandById(commandId) && action !== 'none') return { ...plan, action: 'command', command: commandId as CommandId }
  }
  if (action === 'edit' && target && area !== 'component') {
    const capId = choice(answers, `cap_${area}`)?.choice
    if (capId && capabilityById(capId)) {
      // The words may name more than one property ("2px dashed red border"); keep them all when Jev's pick is among them.
      const local = matchCapabilities(ctx.request, target.node, ctx.lastEdit)
      plan.edit = 'property'
      plan.properties = local.some((item) => item.id === capId) ? local : [{ id: capId }]
    }
  }
  return plan
}

/**
 * Instant local plan when the transcript + pointer already make the edit obvious.
 * Skips the Jev round-trip so typing feels real-time; Send still re-checks with Jev.
 */
export function fastPlanFromRequest(request: string, ctx: JevContext): JevPlan | null {
  const command = matchCommand(request, ctx.selected)
  if (command) {
    return { action: 'command', command, target: ctx.pointer, kind: 'text', edit: 'text', position: 'end', confidence: 1, targetConfidence: 1 }
  }
  const target = ctx.pointer
  if (!target) return null
  const base = {
    action: 'edit' as const,
    target,
    kind: 'text' as UiKind,
    position: 'end' as Position,
    confidence: 1,
    targetConfidence: 1
  }

  const properties = matchCapabilities(request, target.node, ctx.lastEdit)
  if (properties.length) return { ...base, edit: 'property', properties }

  if (extractCornerRadius(request) != null) return { ...base, edit: 'radius' }
  if (extractDimensions(request)) return { ...base, edit: 'size' }
  if (extractColor(request)) return { ...base, edit: 'color' }
  if (extractNewText(request)) return { ...base, edit: 'text' }

  const t = request.toLowerCase()
  if (/\b(flex\s*box|flexbox|auto[-\s]?layout)\b/.test(t) || /\bmake\s+(?:it|this|that)\s+(?:a\s+)?flex\b/.test(t)) {
    return { ...base, edit: 'flex' }
  }
  if (/\bround(?:ed)?\s+(?:the\s+|its\s+)?corners?\b/.test(t) || /\bmake\s+(?:it|this|the\s+corners?)\s+round/.test(t)) {
    return { ...base, edit: 'rounder' }
  }
  if (/\bfull[\s-]?width\b/.test(t) || /\bstretch\b/.test(t)) return { ...base, edit: 'full_width' }
  if (/\bfit[\s-]?width\b|\bhug\b|\bauto[\s-]?width\b/.test(t)) return { ...base, edit: 'fit_width' }
  if (/\bwider\b/.test(t)) return { ...base, edit: 'wider' }
  if (/\bnarrower\b|\bthinner\b/.test(t)) return { ...base, edit: 'narrower' }
  if (/\b(bigger|larger|taller)\b/.test(t)) return { ...base, edit: 'bigger' }
  if (/\b(smaller|shorter)\b/.test(t)) return { ...base, edit: 'smaller' }
  if (/\bbold(er)?\b/.test(t)) return { ...base, edit: 'bolder' }
  if (/\blighter\b|\bregular\b/.test(t)) return { ...base, edit: 'lighter' }
  if (/\brounder\b|\bpill\b/.test(t)) return { ...base, edit: 'rounder' }
  if (/\bsharper\b|\bsquare\b/.test(t)) return { ...base, edit: 'sharper' }
  if (/\bcenter(ed)?\b/.test(t)) return { ...base, edit: 'align_center' }
  if (/\balign\s*left\b|\bleft[\s-]?align/.test(t)) return { ...base, edit: 'align_left' }
  if (/\balign\s*right\b|\bright[\s-]?align/.test(t)) return { ...base, edit: 'align_right' }
  if (/\bshadow\b/.test(t) && /\b(off|remove|no)\b/.test(t)) return { ...base, edit: 'shadow_off' }
  if (/\bshadow\b/.test(t)) return { ...base, edit: 'shadow_on' }
  if (/\bmore\s+padding\b|\bspacious\b/.test(t)) return { ...base, edit: 'more_padding' }
  if (/\bless\s+padding\b|\btighter\b/.test(t)) return { ...base, edit: 'less_padding' }
  if (/\bmore\s+gap\b/.test(t)) return { ...base, edit: 'more_gap' }
  if (/\bless\s+gap\b/.test(t)) return { ...base, edit: 'less_gap' }
  if (/\b(check|checked|select)\b/.test(t) && !/\buncheck\b/.test(t)) return { ...base, edit: 'check' }
  if (/\buncheck\b/.test(t)) return { ...base, edit: 'uncheck' }
  if (/\bdark(\s*mode)?\b/.test(t)) return { ...base, edit: 'dark' }
  if (/\blight(\s*mode)?\b/.test(t)) return { ...base, edit: 'light' }
  if (/\bhorizontal\b|\brow\b|\bside\s*by\s*side\b/.test(t)) return { ...base, edit: 'horizontal' }
  if (/\bvertical\b|\bcolumn\b|\bstack\b/.test(t)) return { ...base, edit: 'vertical' }
  if (/\b(hide|hidden)\b/.test(t)) return { ...base, edit: 'hide' }
  if (/\b(delete|remove|get rid)\b/.test(t)) {
    return { ...base, action: 'remove', edit: 'text' }
  }
  if (/\bprimary\b/.test(t)) return { ...base, edit: 'style_primary' }
  if (/\bsecondary\b/.test(t)) return { ...base, edit: 'style_secondary' }
  if (/\boutline\b/.test(t)) return { ...base, edit: 'style_outline' }
  if (/\bghost\b/.test(t)) return { ...base, edit: 'style_ghost' }
  if (/\b(destructive|danger)\b/.test(t)) return { ...base, edit: 'style_destructive' }

  return null
}

export function topOptions(answers: JevAnswers, key: string, labels: Record<string, string>, count = 3): JevOption[] {
  const answer = choice(answers, key)
  if (!answer) return []
  return Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .filter(([option]) => labels[option])
    .map(([option, probability]) => ({ key: option, label: labels[option], probability }))
}

export const ACTION_LABELS: Record<Action, string> = {
  add: 'Add to the existing component',
  create: 'Start a new design',
  edit: 'Edit the existing component',
  remove: 'Remove from the component',
  none: 'No design change',
  command: 'Run an action',
  delegate: 'Hand off to Claude'
}

function insertAt(nodes: DesignNode[], fresh: DesignNode[], index: number): DesignNode[] {
  const out = nodes.slice()
  out.splice(Math.max(0, Math.min(out.length, index)), 0, ...fresh)
  return out
}

function remeasure(node: DesignNode, patch: Partial<DesignNode>): DesignNode {
  const next = { ...node, ...patch }
  if (next.type !== 'text') return next
  const size = measureText(next.text || '', next.fontSize || 14, Number(next.fontWeight) || 400)
  return { ...next, width: size.width, height: size.height }
}

function containerFor(plan: JevPlan, ctx: JevContext, nodes: DesignNode[], byId: Map<string, DesignNode>): {
  container: DesignNode | null
  anchor: DesignNode | null
  position: Position
} {
  const target = plan.target ? componentOf(plan.target.node, byId) : null
  const isContainer = (node: DesignNode | null | undefined) =>
    Boolean(node && (node.uiRole === 'card' || node.uiRole === 'header' || (!node.uiRole && node.type === 'frame')))
  const headerOf = (card: DesignNode) => childrenIn(nodes, card.id).find((item) => item.uiRole === 'header') || null

  if (target && isContainer(target) && (plan.position === 'inside' || plan.position === 'end' || plan.position === 'start')) {
    if ((plan.kind === 'description' || plan.kind === 'heading') && target.uiRole === 'card') {
      return { container: headerOf(target) || target, anchor: null, position: 'end' }
    }
    return { container: target, anchor: null, position: plan.position === 'start' ? 'start' : 'end' }
  }
  if (target && (plan.position === 'after' || plan.position === 'before')) {
    const parent = target.parentId ? byId.get(target.parentId) || null : null
    return { container: parent, anchor: target, position: plan.position }
  }
  if (target?.parentId) {
    const parent = byId.get(target.parentId) || null
    if (plan.kind === 'description' && target.uiRole === 'title') return { container: parent, anchor: target, position: 'after' }
    return { container: parent, anchor: null, position: plan.position === 'start' ? 'start' : 'end' }
  }
  const root = ctx.root && isContainer(ctx.root) ? ctx.root : null
  if (root && (plan.kind === 'description' || plan.kind === 'heading') && root.uiRole === 'card') {
    return { container: headerOf(root) || root, anchor: null, position: 'end' }
  }
  return { container: root, anchor: null, position: plan.position === 'start' ? 'start' : 'end' }
}

function applyAdd(plan: JevPlan, ctx: JevContext, canvas: JevCanvas): ApplyResult {
  const nodes = canvas.nodes
  const byId = byIdMap(nodes)
  const kind = plan.kind
  const label = extractLabel(ctx.request, kind)
  const detail = kind === 'card' ? extractDescription(ctx.request) : undefined
  const spec = { kind, label, detail, variant: extractVariant(ctx.request), checked: /\bchecked\b/i.test(ctx.request) }

  const where = plan.action === 'create' || kind === 'card' ? { container: null, anchor: null, position: 'end' as Position } : containerFor(plan, ctx, nodes, byId)
  const container = where.container
  const flowsVertical = container?.layout?.mode === 'vertical'
  const built = buildComponent(spec, { parentId: container?.id || null, pageId: canvas.pageId }, flowsVertical)
  const root = built[0]

  if (!container) {
    const size = { w: root.width || 100, h: root.height || 40 }
    const lastTop = plan.action !== 'create' && ctx.root ? ctx.root : null
    const at = lastTop
      ? { x: lastTop.x, y: lastTop.y + (lastTop.height || 0) + 32 }
      : { x: Math.round(canvas.center.x - size.w / 2), y: Math.round(canvas.center.y - Math.max(size.h, 160) / 2) }
    built[0] = { ...root, x: at.x, y: at.y }
    return { nodes: [...nodes, ...built], summary: `Created ${describeNode(built[0], built)}`, touchedId: root.id }
  }

  if (!container.layout || container.layout.mode === 'none') {
    const kids = childrenIn(nodes, container.id)
    const bottom = kids.reduce((max, kid) => Math.max(max, kid.y + (kid.height || 0)), 0)
    built[0] = { ...root, x: 16, y: bottom + 12 }
  }

  const siblings = childrenIn(nodes, container.id)
  let index: number
  if (where.anchor && siblings.includes(where.anchor)) {
    const at = nodes.indexOf(where.anchor)
    index = where.position === 'before' ? at : at + 1
  } else if (where.position === 'start') {
    index = siblings.length ? nodes.indexOf(siblings[0]) : nodes.indexOf(container) + 1
  } else {
    index = siblings.length ? nodes.indexOf(siblings[siblings.length - 1]) + 1 : nodes.indexOf(container) + 1
  }
  return {
    nodes: insertAt(nodes, built, index),
    summary: `Added ${describeNode(built[0], built)}`,
    touchedId: root.id
  }
}

const DARK_SWAP: Record<string, string> = {
  '#ffffff': '#0a0a0a',
  '#0a0a0a': '#fafafa',
  '#171717': '#fafafa',
  '#fafafa': '#171717',
  '#e5e5e5': '#262626',
  '#f5f5f5': '#262626',
  '#d4d4d4': '#404040',
  '#737373': '#a3a3a3',
  '#a3a3a3': '#737373',
  '#f0f0f0': '#262626'
}
const LIGHT_SWAP: Record<string, string> = Object.fromEntries(Object.entries(DARK_SWAP).map(([a, b]) => [b, a]))

function applyEdit(plan: JevPlan, ctx: JevContext, canvas: JevCanvas): ApplyResult {
  if (!plan.target) return { error: 'Point at the element you want to change.' }
  let nodes = canvas.nodes
  const byId = byIdMap(nodes)
  const picked = plan.target.node
  if (plan.edit === 'property' && plan.properties?.length) {
    // Property edits land on exactly what's selected (even a text inside a component), and on every selected layer.
    const selected = canvas.selectedIds.map((id) => byId.get(id)).filter((node): node is DesignNode => Boolean(node))
    const coversTarget = selected.some((node) => node.id === picked.id || componentOf(node, byId).id === picked.id)
    const targets = coversTarget ? selected : [picked]
    return applyProperties(plan.properties, targets, nodes, ctx.request, (node, all) => describeNode(componentOf(node, byIdMap(all)), all))
  }
  const target = plan.edit === 'text' ? picked : componentOf(picked, byId)
  const subtree = [target, ...descendantsOf(nodes, target.id)]
  const patches = new Map<string, Partial<DesignNode>>()
  const patch = (node: DesignNode, value: Partial<DesignNode>) =>
    patches.set(node.id, { ...(patches.get(node.id) || {}), ...value })
  const texts = subtree.filter((node) => node.type === 'text')
  const find = (role: string) => subtree.find((node) => node.uiRole === role) || null
  const parent = target.parentId ? byId.get(target.parentId) : undefined

  switch (plan.edit) {
    case 'text': {
      const value = extractNewText(ctx.request)
      if (!value) return { error: 'I didn’t catch the new text — try “rename it to …”.' }
      const component = componentOf(picked, byId)
      const wantsPlaceholder = /placeholder/i.test(ctx.request)
      const node =
        (wantsPlaceholder && descendantsOf(nodes, component.id).find((item) => item.uiRole === 'field-placeholder')) ||
        primaryTextNode(picked, nodes)
      if (!node) return { error: 'That element has no text to change.' }
      patch(node, { text: value, name: value })
      if (component.id !== node.id && component.uiRole && ROLE_LABEL[component.uiRole] && !wantsPlaceholder) {
        patch(component, { name: `${value} ${ROLE_LABEL[component.uiRole]}` })
      }
      break
    }
    case 'full_width':
      if (parent?.layout && parent.layout.mode !== 'none') {
        patch(target, { layoutSizingH: 'fill', ...(target.layout ? { layout: { ...target.layout, sizingH: 'fixed' } } : {}) })
      } else if (parent) {
        patch(target, { x: 0, width: parent.width })
      } else return { error: 'Top-level designs have nothing to fill.' }
      break
    case 'fit_width':
      patch(target, { layoutSizingH: 'fixed', ...(target.layout ? { layout: { ...target.layout, sizingH: 'hug' } } : {}) })
      break
    case 'wider':
    case 'narrower':
    case 'bigger':
    case 'smaller':
    case 'size': {
      // Exact pixel sizes always win over relative bigger/wider when the transcript has numbers.
      const dims =
        plan.edit === 'size' ||
        /(?:\d+\s*(?:[x×*]|by)\s*\d+)|(?:\b(?:width|height|wide|tall)\b.*\d)|(?:\d+\s*(?:px|pixels?)?\s*(?:wide|tall|width|height))/i.test(
          ctx.request
        )
          ? extractDimensions(ctx.request)
          : undefined
      if (dims && (dims.width != null || dims.height != null)) {
        const next: Partial<DesignNode> = {
          layoutSizingH: 'fixed',
          layoutSizingV: 'fixed',
          ...(target.layout
            ? { layout: { ...target.layout, sizingH: 'fixed', sizingV: 'fixed' } }
            : {})
        }
        if (dims.width != null) next.width = dims.width
        if (dims.height != null) next.height = dims.height
        patch(target, next)
        break
      }
      if (plan.edit === 'size') {
        return { error: 'Which size? Try “make it 800×800” or “set width to 400”.' }
      }
      if (plan.edit === 'wider' || plan.edit === 'narrower') {
        const factor = plan.edit === 'wider' ? 1.25 : 0.8
        patch(target, {
          width: Math.round((target.width || 100) * factor),
          layoutSizingH: 'fixed',
          ...(target.layout ? { layout: { ...target.layout, sizingH: 'fixed' } } : {})
        })
        break
      }
      {
        const up = plan.edit === 'bigger'
        for (const t of texts) patch(t, { fontSize: Math.max(8, Math.round((t.fontSize || 14) * (up ? 1.2 : 0.85))) })
        if (target.uiRole === 'button') patch(target, { height: up ? 44 : 32 })
        const box = find('field-box')
        if (box) patch(box, { height: Math.max(28, (box.height || 36) + (up ? 8 : -6)) })
        if (target.uiRole === 'card') patch(target, { width: Math.round((target.width || 400) * (up ? 1.15 : 0.87)) })
        if (!texts.length && target.type !== 'frame') {
          patch(target, {
            width: Math.round((target.width || 40) * (up ? 1.25 : 0.8)),
            height: Math.round((target.height || 40) * (up ? 1.25 : 0.8))
          })
        }
      }
      break
    }
    case 'color': {
      const color = extractColor(ctx.request)
      if (!color) return { error: 'Which color? Try “make it blue”.' }
      const surface =
        target.type === 'text' ? target : target.uiRole === 'checkbox' ? find('checkbox-box') : target.uiRole === 'field' ? find('field-box') : target
      if (!surface) break
      patch(surface, { fill: color, fills: undefined, fillOpacity: 1 })
      if (target.uiRole === 'button' || target.uiRole === 'badge') {
        const light = ['#ffffff', '#eab308'].includes(color)
        for (const t of texts) patch(t, { fill: light ? UI.foreground : UI.primaryForeground })
      }
      break
    }
    case 'style_primary':
    case 'style_secondary':
    case 'style_outline':
    case 'style_ghost':
    case 'style_destructive': {
      const variant = plan.edit.slice(6) as ButtonVariant
      patch(target, buttonPaint(variant))
      for (const t of texts) patch(t, { fill: buttonTextColor(variant) })
      break
    }
    case 'bolder':
    case 'lighter':
      for (const t of texts) patch(t, { fontWeight: plan.edit === 'bolder' ? 700 : 400 })
      break
    case 'rounder':
    case 'radius':
    case 'sharper': {
      const surface = target.uiRole === 'field' ? find('field-box') : target.uiRole === 'checkbox' ? find('checkbox-box') : target
      if (!surface) break
      if (plan.edit === 'radius') {
        const radius = extractCornerRadius(ctx.request)
        if (radius == null) return { error: 'Which corner radius? Try “round the corners to 12”.' }
        patch(surface, { radius, cornerRadii: undefined })
        break
      }
      const r = surface.radius || 0
      patch(surface, { radius: plan.edit === 'rounder' ? (r >= 12 ? 999 : r === 0 ? 12 : r + 6) : 0, cornerRadii: undefined })
      break
    }
    case 'align_center':
    case 'align_left':
    case 'align_right': {
      const align = plan.edit === 'align_center' ? 'center' : plan.edit === 'align_left' ? 'start' : 'end'
      const host = target.layout && target.layout.mode !== 'none' ? target : parent?.layout ? parent : null
      if (!host?.layout) return { error: 'That element isn’t in a layout I can align.' }
      if (host.layout.mode === 'vertical') patch(host, { layout: { ...host.layout, alignItems: align } })
      else patch(host, { layout: { ...host.layout, justifyContent: align } })
      break
    }
    case 'shadow_on':
      patch(target, { shadow: true, shadowOpacity: 0.12, shadowY: 8, shadowBlur: 24, effects: undefined })
      break
    case 'shadow_off':
      patch(target, { shadow: false, effects: undefined })
      break
    case 'more_padding':
    case 'less_padding':
    case 'more_gap':
    case 'less_gap': {
      const host = target.layout ? target : parent
      if (!host?.layout) return { error: 'That element has no spacing to adjust.' }
      const delta = plan.edit.startsWith('more') ? 8 : -8
      if (plan.edit.endsWith('padding')) {
        const p = normalizePadding(host.layout.padding)
        const bump = (v: number) => Math.max(0, v + delta)
        patch(host, { layout: { ...host.layout, padding: { t: bump(p.t), r: bump(p.r), b: bump(p.b), l: bump(p.l) } } })
      } else {
        const gap = typeof host.layout.gap === 'number' ? host.layout.gap : 8
        patch(host, { layout: { ...host.layout, gap: Math.max(0, gap + delta) } })
      }
      break
    }
    case 'check':
    case 'uncheck': {
      const on = plan.edit === 'check'
      const box = find('checkbox-box')
      const track = find('switch-track')
      if (box) {
        patch(box, checkboxPaint(on))
        const mark = descendantsOf(nodes, box.id).find((item) => item.uiRole === 'checkbox-check')
        if (on && !mark) {
          const idx = nodes.indexOf(box) + 1
          nodes = insertAt(nodes, [checkMark(box.id, canvas.pageId)], idx)
        } else if (!on && mark) {
          nodes = nodes.filter((item) => item.id !== mark.id)
        }
      } else if (track?.layout) {
        patch(track, { fill: on ? UI.primary : UI.border, layout: { ...track.layout, justifyContent: on ? 'end' : 'start' } })
      } else return { error: 'That isn’t a checkbox or switch.' }
      break
    }
    case 'dark':
    case 'light': {
      const map = plan.edit === 'dark' ? DARK_SWAP : LIGHT_SWAP
      for (const node of subtree) {
        const fill = node.fill?.toLowerCase()
        const stroke = node.stroke?.toLowerCase()
        const next: Partial<DesignNode> = {}
        if (fill && map[fill]) next.fill = map[fill]
        if (stroke && map[stroke]) next.stroke = map[stroke]
        if (Object.keys(next).length) patch(node, { ...next, fills: undefined })
      }
      break
    }
    case 'horizontal':
    case 'vertical': {
      const host = target.layout ? target : parent
      if (!host?.layout || host.layout.mode === 'none') return { error: 'That element has no layout direction. Say “make this a flexbox” first.' }
      patch(host, { layout: { ...host.layout, mode: plan.edit } })
      break
    }
    case 'flex': {
      const host = target
      const mode = /\b(vertical|column|stack)\b/i.test(ctx.request) ? 'vertical' : 'horizontal'
      let working = nodes.map((node) => (node.id === host.id && node.type !== 'frame' ? { ...node, type: 'frame' as const } : node))
      const frame = working.find((node) => node.id === host.id)
      if (!frame) return { error: 'Select a layer to turn into a flexbox.' }
      if (isAutoLayout(frame)) {
        working = reflowAutoLayout(
          working.map((node) =>
            node.id === frame.id && node.layout ? { ...node, layout: { ...node.layout, mode, grid: undefined } } : node
          )
        )
      } else {
        working = enableAutoLayoutOnFrame(working, frame.id, { mode })
      }
      const label = describeNode(frame, working)
      return { nodes: working, summary: `Made ${label} a flexbox`, touchedId: frame.id }
    }
    case 'move_up':
    case 'move_down': {
      if (!parent) return { error: 'Only items inside a design can be reordered.' }
      const siblings = childrenIn(nodes, parent.id)
      const at = siblings.indexOf(target)
      const swap = siblings[plan.edit === 'move_up' ? at - 1 : at + 1]
      if (!swap) return { error: plan.edit === 'move_up' ? 'It’s already first.' : 'It’s already last.' }
      const i = nodes.indexOf(target)
      const j = nodes.indexOf(swap)
      nodes = nodes.slice()
      nodes[i] = swap
      nodes[j] = target
      break
    }
    case 'hide':
      patch(target, { visible: false })
      break
  }

  const next = nodes.map((node) => {
    const value = patches.get(node.id)
    return value ? remeasure(node, value) : node
  })
  const updated = next.find((node) => node.id === target.id) || target
  const label = describeNode(componentOf(updated, byIdMap(next)), next)
  return { nodes: next, summary: `Updated ${label}`, touchedId: componentOf(updated, byIdMap(next)).id }
}

function applyRemove(plan: JevPlan, canvas: JevCanvas): ApplyResult {
  if (!plan.target) return { error: 'Point at the element you want to remove.' }
  const byId = byIdMap(canvas.nodes)
  const target = componentOf(plan.target.node, byId)
  const doomed = expandWithDescendants(canvas.nodes, new Set([target.id]))
  return {
    nodes: canvas.nodes.filter((node) => !doomed.has(node.id)),
    summary: `Removed ${describeNode(target, canvas.nodes)}`,
    touchedId: target.parentId || null
  }
}

export function applyPlan(plan: JevPlan, ctx: JevContext, canvas: JevCanvas): ApplyResult {
  switch (plan.action) {
    case 'add':
    case 'create':
      return applyAdd(plan, ctx, canvas)
    case 'edit':
      return applyEdit(plan, ctx, canvas)
    case 'remove':
      return applyRemove(plan, canvas)
    default:
      return { error: 'Not a design instruction.' }
  }
}

export function targetStep(plan: JevPlan, ctx: JevContext, nodes: DesignNode[]): JevStep {
  const target = plan.target
  if (!target) {
    return {
      key: 'target',
      label: 'Resolve target',
      tag: 'Resolved',
      title: plan.action === 'create' ? 'New design' : ctx.root ? describeNode(ctx.root, nodes) : 'Canvas',
      detail: plan.action === 'create' ? 'Placed at the center of the view' : 'Appended to the design',
      state: 'done'
    }
  }
  const parent = target.node.parentId ? nodes.find((node) => node.id === target.node.parentId) : null
  const index = parent ? childrenIn(nodes, parent.id).indexOf(target.node) + 1 : 0
  return {
    key: 'target',
    label: 'Resolve target',
    tag: ctx.pointer?.key === target.key ? 'Pointer' : 'Resolved',
    title: target.label,
    detail: [parent ? describeNode(parent, nodes).replace(/^“.*” /, '') : 'Canvas', index ? `item ${index}` : '', `#${target.node.uiRole || target.node.type}`]
      .filter(Boolean)
      .join(' · '),
    state: 'done'
  }
}
