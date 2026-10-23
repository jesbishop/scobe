import type { DesignNode } from '../shared/types'
import { DEFAULT_TOKENS, type DesignTokens } from '../shared/designTokens'
import { measurePlainText } from './textPath'

/** @deprecated Prefer DEFAULT_TOKENS â€” kept as paint alias for edit paths. */
export const UI = {
  background: DEFAULT_TOKENS.background,
  foreground: DEFAULT_TOKENS.foreground,
  muted: DEFAULT_TOKENS.muted,
  border: DEFAULT_TOKENS.border,
  input: DEFAULT_TOKENS.input,
  placeholder: DEFAULT_TOKENS.placeholder,
  primary: DEFAULT_TOKENS.primary,
  primaryForeground: DEFAULT_TOKENS.primaryForeground,
  secondary: DEFAULT_TOKENS.secondary,
  destructive: DEFAULT_TOKENS.destructive
}

export type UiKind =
  | 'card'
  | 'heading'
  | 'description'
  | 'text'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'switch'
  | 'button'
  | 'divider'
  | 'badge'
  | 'avatar'
  | 'image'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'

/** Roles that stand for a whole component; inner parts climb to one of these. */
export const COMPONENT_ROLES = new Set([
  'card',
  'header',
  'heading',
  'description',
  'text',
  'field',
  'checkbox',
  'switch',
  'button',
  'divider',
  'badge',
  'avatar',
  'image'
])

export const ROLE_LABEL: Record<string, string> = {
  card: 'card',
  header: 'card header',
  heading: 'heading',
  title: 'title',
  description: 'description',
  text: 'text',
  field: 'text field',
  'field-label': 'field label',
  'field-box': 'field box',
  'field-placeholder': 'placeholder',
  checkbox: 'checkbox',
  'checkbox-box': 'checkbox box',
  'checkbox-label': 'checkbox label',
  switch: 'switch',
  'switch-track': 'switch track',
  'switch-label': 'switch label',
  button: 'button',
  'button-label': 'button label',
  divider: 'divider',
  badge: 'badge',
  avatar: 'avatar',
  image: 'image'
}

type Base = { parentId: string | null; pageId: string }

function uid(): string {
  return crypto.randomUUID()
}

export function measureText(text: string, size: number, weight: number): { width: number; height: number } {
  const m = measurePlainText(text || ' ', 'Inter', weight, size)
  return { width: Math.ceil(m.width), height: Math.ceil(m.height) }
}

function textNode(
  base: Base,
  value: string,
  opts: { size: number; weight?: number; color?: string; role: string; name?: string }
): DesignNode {
  const weight = opts.weight ?? 400
  const size = measureText(value, opts.size, weight)
  return {
    id: uid(),
    type: 'text',
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    text: value,
    name: opts.name || value,
    uiRole: opts.role,
    parentId: base.parentId,
    pageId: base.pageId,
    fill: opts.color || DEFAULT_TOKENS.foreground,
    fontFamily: 'Inter',
    fontSize: opts.size,
    fontWeight: weight,
    textResize: 'auto-width'
  }
}

function frame(base: Base, role: string, name: string, props: Partial<DesignNode>): DesignNode {
  return {
    id: uid(),
    type: 'frame',
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    name,
    uiRole: role,
    parentId: base.parentId,
    pageId: base.pageId,
    clipsContent: false,
    ...props
  }
}

export type BuildSpec = {
  kind: UiKind
  /** Primary text (title, label, button textâ€¦). */
  label?: string
  /** Secondary text (card description, field placeholder). */
  detail?: string
  variant?: ButtonVariant
  checked?: boolean
}

export const DEFAULT_LABEL: Record<UiKind, string> = {
  card: 'Untitled',
  heading: 'Heading',
  description: 'Add a short description',
  text: 'Body text',
  input: 'Label',
  textarea: 'Message',
  select: 'Select',
  checkbox: 'I agree to the terms',
  switch: 'Enable notifications',
  button: 'Continue',
  divider: 'Divider',
  badge: 'Badge',
  avatar: 'Avatar',
  image: 'Image'
}

function tokensOrDefault(tokens?: DesignTokens): DesignTokens {
  return tokens || DEFAULT_TOKENS
}

/** Primitive builders â€” apply toolkit for both hand specs and recipes. */
export const primitives = {
  frame,
  text: textNode,
  field(
    base: Base,
    label: string,
    opts: { kind?: 'input' | 'textarea' | 'select'; placeholder?: string; fillWidth?: boolean; tokens?: DesignTokens }
  ): DesignNode[] {
    const t = tokensOrDefault(opts.tokens)
    const kind = opts.kind || 'input'
    const multiline = kind === 'textarea'
    const grow: Partial<DesignNode> = opts.fillWidth !== false ? { layoutSizingH: 'fill' } : {}
    const group = frame(base, 'field', `${label} field`, {
      width: 352,
      height: 60,
      ...grow,
      layout: { mode: 'vertical', gap: t.space.sm, padding: 0, alignItems: 'start', sizingH: 'fixed', sizingV: 'hug' }
    })
    const inner = { parentId: group.id, pageId: base.pageId }
    const box = frame(inner, 'field-box', 'Input', {
      width: 352,
      height: multiline ? 80 : 36,
      layoutSizingH: 'fill',
      fill: t.input,
      radius: t.radius.md,
      stroke: t.border,
      strokeWidth: 1,
      strokeAlign: 'inside',
      layout: {
        mode: 'horizontal',
        gap: t.space.sm,
        padding: multiline ? { t: 10, r: 12, b: 10, l: 12 } : { t: 0, r: 12, b: 0, l: 12 },
        alignItems: multiline ? 'start' : 'center',
        justifyContent: kind === 'select' ? 'space-between' : 'start',
        sizingH: 'fixed',
        sizingV: 'fixed'
      }
    })
    const inBox = { parentId: box.id, pageId: base.pageId }
    const nodes = [
      group,
      textNode(inner, label, { size: t.type.sm, weight: 500, role: 'field-label' }),
      box,
      textNode(inBox, opts.placeholder || placeholderFor(label, kind === 'select' ? 'select' : kind === 'textarea' ? 'textarea' : 'input'), {
        size: t.type.sm,
        color: t.placeholder,
        role: 'field-placeholder'
      })
    ]
    if (kind === 'select') nodes.push(textNode(inBox, 'âŒ„', { size: t.type.sm, color: t.muted, role: 'field-icon' }))
    return nodes
  },
  button(
    base: Base,
    label: string,
    opts: { variant?: ButtonVariant; fillWidth?: boolean; tokens?: DesignTokens } = {}
  ): DesignNode[] {
    const t = tokensOrDefault(opts.tokens)
    const variant = opts.variant || 'primary'
    const button = frame(base, 'button', `${label} button`, {
      width: opts.fillWidth ? 352 : 120,
      height: 36,
      radius: t.radius.md,
      ...(opts.fillWidth ? { layoutSizingH: 'fill' } : {}),
      ...buttonPaint(variant, t),
      layout: {
        mode: 'horizontal',
        gap: t.space.sm,
        padding: { t: 0, r: 16, b: 0, l: 16 },
        alignItems: 'center',
        justifyContent: 'center',
        sizingH: opts.fillWidth ? 'fixed' : 'hug',
        sizingV: 'fixed'
      }
    })
    return [
      button,
      textNode({ parentId: button.id, pageId: base.pageId }, label, {
        size: t.type.sm,
        weight: 500,
        color: buttonTextColor(variant, t),
        role: 'button-label'
      })
    ]
  },
  checkbox(base: Base, label: string, opts: { checked?: boolean; tokens?: DesignTokens } = {}): DesignNode[] {
    const t = tokensOrDefault(opts.tokens)
    const row = frame(base, 'checkbox', `${label} checkbox`, {
      width: 200,
      height: 20,
      layout: { mode: 'horizontal', gap: 10, padding: 0, alignItems: 'center', sizingH: 'hug', sizingV: 'hug' }
    })
    const inner = { parentId: row.id, pageId: base.pageId }
    const box = frame(inner, 'checkbox-box', 'Checkbox', {
      width: 16,
      height: 16,
      radius: t.radius.sm - 2,
      ...checkboxPaint(Boolean(opts.checked), t),
      layout: {
        mode: 'horizontal',
        gap: 0,
        padding: 0,
        alignItems: 'center',
        justifyContent: 'center',
        sizingH: 'fixed',
        sizingV: 'fixed'
      }
    })
    const nodes = [row, box]
    if (opts.checked) nodes.push(checkMark(box.id, base.pageId, t))
    nodes.push(textNode(inner, label, { size: t.type.sm, weight: 500, role: 'checkbox-label' }))
    return nodes
  }
}

/** Builds a component subtree. The first node is the component root. */
export function buildComponent(spec: BuildSpec, base: Base, fillWidth = true, tokens: DesignTokens = DEFAULT_TOKENS): DesignNode[] {
  const label = spec.label?.trim() || DEFAULT_LABEL[spec.kind]
  const grow: Partial<DesignNode> = fillWidth ? { layoutSizingH: 'fill' } : {}
  const t = tokens
  switch (spec.kind) {
    case 'card': {
      const card = frame(base, 'card', `${label} card`, {
        width: 400,
        height: 120,
        fill: t.background,
        radius: t.radius.lg,
        stroke: t.border,
        strokeWidth: 1,
        strokeAlign: 'inside',
        shadow: true,
        shadowColor: t.shadow.color,
        shadowOpacity: t.shadow.opacity,
        shadowX: t.shadow.x,
        shadowY: t.shadow.y,
        shadowBlur: t.shadow.blur,
        layout: { mode: 'vertical', gap: t.space.md + 4, padding: t.space.lg, alignItems: 'start', sizingH: 'fixed', sizingV: 'hug' }
      })
      const inner = { parentId: card.id, pageId: base.pageId }
      const header = frame(inner, 'header', 'Header', {
        width: 352,
        height: 28,
        layoutSizingH: 'fill',
        layout: { mode: 'vertical', gap: 6, padding: 0, alignItems: 'start', sizingH: 'fixed', sizingV: 'hug' }
      })
      const head = { parentId: header.id, pageId: base.pageId }
      const nodes = [card, header, textNode(head, label, { size: t.type.lg, weight: 600, role: 'title' })]
      if (spec.detail) nodes.push(textNode(head, spec.detail, { size: t.type.sm, color: t.muted, role: 'description' }))
      return nodes
    }
    case 'heading':
      return [textNode(base, label, { size: t.type.xl - 2, weight: 600, role: 'heading' })]
    case 'description':
      return [textNode(base, label, { size: t.type.sm, color: t.muted, role: 'description' })]
    case 'text':
      return [textNode(base, label, { size: t.type.sm, role: 'text' })]
    case 'input':
    case 'textarea':
    case 'select':
      return primitives.field(base, label, {
        kind: spec.kind,
        placeholder: spec.detail,
        fillWidth,
        tokens: t
      })
    case 'checkbox':
      return primitives.checkbox(base, label, { checked: spec.checked, tokens: t })
    case 'switch': {
      const row = frame(base, 'switch', `${label} switch`, {
        width: 200,
        height: 20,
        layout: { mode: 'horizontal', gap: 10, padding: 0, alignItems: 'center', sizingH: 'hug', sizingV: 'hug' }
      })
      const inner = { parentId: row.id, pageId: base.pageId }
      const on = spec.checked !== false
      const track = frame(inner, 'switch-track', 'Switch', {
        width: 36,
        height: 20,
        radius: 10,
        fill: on ? t.primary : t.border,
        layout: {
          mode: 'horizontal',
          gap: 0,
          padding: 2,
          alignItems: 'center',
          justifyContent: on ? 'end' : 'start',
          sizingH: 'fixed',
          sizingV: 'fixed'
        }
      })
      const thumb: DesignNode = {
        id: uid(),
        type: 'ellipse',
        x: 0,
        y: 0,
        width: 16,
        height: 16,
        name: 'Thumb',
        uiRole: 'switch-thumb',
        parentId: track.id,
        pageId: base.pageId,
        fill: '#ffffff'
      }
      return [row, track, thumb, textNode(inner, label, { size: t.type.sm, weight: 500, role: 'switch-label' })]
    }
    case 'button':
      return primitives.button(base, label, { variant: spec.variant || 'primary', fillWidth: false, tokens: t })
    case 'divider':
      return [
        {
          id: uid(),
          type: 'rect',
          x: 0,
          y: 0,
          width: 352,
          height: 1,
          ...grow,
          name: 'Divider',
          uiRole: 'divider',
          parentId: base.parentId,
          pageId: base.pageId,
          fill: t.border
        }
      ]
    case 'badge': {
      const badge = frame(base, 'badge', `${label} badge`, {
        width: 60,
        height: 22,
        radius: t.radius.full,
        fill: t.secondary,
        layout: {
          mode: 'horizontal',
          gap: t.space.xs,
          padding: { t: 2, r: 10, b: 2, l: 10 },
          alignItems: 'center',
          sizingH: 'hug',
          sizingV: 'hug'
        }
      })
      return [badge, textNode({ parentId: badge.id, pageId: base.pageId }, label, { size: t.type.xs, weight: 500, role: 'badge-label' })]
    }
    case 'avatar':
      return [
        {
          id: uid(),
          type: 'ellipse',
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          name: 'Avatar',
          uiRole: 'avatar',
          parentId: base.parentId,
          pageId: base.pageId,
          fill: t.border
        }
      ]
    case 'image':
      return [
        {
          id: uid(),
          type: 'rect',
          x: 0,
          y: 0,
          width: 352,
          height: 180,
          ...grow,
          radius: t.radius.md,
          name: 'Image',
          uiRole: 'image',
          parentId: base.parentId,
          pageId: base.pageId,
          fill: '#f0f0f0'
        }
      ]
  }
}

export function placeholderFor(label: string, kind: UiKind): string {
  if (kind === 'select') return 'Select an option'
  const key = label.toLowerCase()
  if (key.includes('email')) return 'email address'
  if (key.includes('password')) return '••••••••'
  if (key.includes('phone')) return '+1 (555) 000-0000'
  if (key.includes('search')) return 'Search…'
  if (key.includes('url') || key.includes('website')) return 'https://'
  if (key.includes('name')) return 'Jane Doe'
  if (kind === 'textarea') return 'Type your message here.'
  return `Enter ${key}`
}

export function buttonPaint(variant: ButtonVariant, tokens: DesignTokens = DEFAULT_TOKENS): Partial<DesignNode> {
  const clear = { fills: undefined, stroke: undefined, strokeWidth: 0 }
  switch (variant) {
    case 'secondary':
      return { ...clear, fill: tokens.secondary, fillOpacity: 1 }
    case 'outline':
      return { ...clear, fill: tokens.background, fillOpacity: 1, stroke: tokens.border, strokeWidth: 1, strokeAlign: 'inside' }
    case 'ghost':
      return { ...clear, fill: tokens.background, fillOpacity: 0 }
    case 'destructive':
      return { ...clear, fill: tokens.destructive, fillOpacity: 1 }
    default:
      return { ...clear, fill: tokens.primary, fillOpacity: 1 }
  }
}

export function buttonTextColor(variant: ButtonVariant, tokens: DesignTokens = DEFAULT_TOKENS): string {
  return variant === 'primary' || variant === 'destructive' ? tokens.primaryForeground : tokens.foreground
}

export function checkboxPaint(checked: boolean, tokens: DesignTokens = DEFAULT_TOKENS): Partial<DesignNode> {
  return checked
    ? { fill: tokens.primary, fillOpacity: 1, stroke: tokens.primary, strokeWidth: 1, strokeAlign: 'inside' }
    : { fill: tokens.background, fillOpacity: 1, stroke: '#d4d4d4', strokeWidth: 1, strokeAlign: 'inside' }
}

export function checkMark(parentId: string, pageId: string, tokens: DesignTokens = DEFAULT_TOKENS): DesignNode {
  return textNode(
    { parentId, pageId },
    'âœ“',
    { size: 11, weight: 700, color: tokens.primaryForeground, role: 'checkbox-check' }
  )
}
