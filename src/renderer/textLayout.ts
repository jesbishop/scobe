import type { CSSProperties } from 'react'
import type { DesignNode } from '../shared/types'
import { cssFontFamily } from './googleFonts'

export type TextSize = { width: number; height: number }

export type TextParagraph = { text: string; marker?: string }

export function resolveLetterSpacingPx(node: DesignNode, fontSize: number): number {
  const value = node.letterSpacing || 0
  if (!value) return 0
  const unit = node.letterSpacingUnit || (value > 3 ? 'px' : 'percent')
  return unit === 'percent' ? (value / 100) * fontSize : value
}

export function formatTextCase(text: string, textCase?: DesignNode['textCase']): string {
  if (!textCase || textCase === 'none' || textCase === 'small-caps') return text
  if (textCase === 'upper') return text.toUpperCase()
  if (textCase === 'lower') return text.toLowerCase()
  if (textCase === 'title') {
    return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
  }
  return text
}

/** Lists, paragraph spacing and indents need one block per paragraph; plain text renders as a single run. */
export function usesParagraphBlocks(node: DesignNode): boolean {
  return (
    Boolean(node.listStyle && node.listStyle !== 'none') ||
    (node.paragraphSpacing || 0) > 0 ||
    (node.paragraphIndent || 0) > 0
  )
}

export function textParagraphs(node: DesignNode, text: string): TextParagraph[] {
  const lines = formatTextCase(text, node.textCase).split('\n')
  let n = 0
  return lines.map((line) => {
    if (node.listStyle === 'unordered') return { text: line, marker: line ? '•' : undefined }
    if (node.listStyle === 'ordered') {
      if (!line) return { text: line }
      n += 1
      return { text: line, marker: `${n}.` }
    }
    return { text: line }
  })
}

export function listIndentEm(node: DesignNode, paragraphs: TextParagraph[]): number {
  if (node.listStyle === 'ordered') {
    const widest = paragraphs.reduce((max, para) => Math.max(max, para.marker?.length || 0), 2)
    return 0.55 * widest + 0.6
  }
  return node.listStyle === 'unordered' ? 1.2 : 0
}

function numericVariant(node: DesignNode): string | undefined {
  const parts = [
    node.numberStyle === 'lining' ? 'lining-nums' : node.numberStyle === 'oldstyle' ? 'oldstyle-nums' : '',
    node.numberSpacing === 'tabular' ? 'tabular-nums' : node.numberSpacing === 'proportional' ? 'proportional-nums' : '',
    node.fractions ? 'diagonal-fractions' : '',
    node.slashedZero ? 'slashed-zero' : ''
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : undefined
}

export function decorationColor(node: DesignNode): string | undefined {
  const hex = node.textDecorationColor
  if (!hex) return undefined
  const opacity = node.textDecorationOpacity ?? 1
  if (opacity >= 1) return hex
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

/** Inherited typography for a text box (font, spacing, decoration, OpenType features). */
export function textTypographyStyle(node: DesignNode): CSSProperties {
  const fontSize = node.fontSize || 12
  const letterSpacing = resolveLetterSpacingPx(node, fontSize)
  const decorated = Boolean(node.textDecoration && node.textDecoration !== 'none')
  return {
    fontFamily: cssFontFamily(node.fontFamily || 'Inter'),
    fontWeight: String(node.fontWeight || 400),
    fontStyle: node.fontStyle || 'normal',
    fontSize: `${fontSize}px`,
    lineHeight: node.lineHeight && node.lineHeight > 0 ? `${node.lineHeight}px` : 'normal',
    letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
    textAlign: node.textAlign || 'left',
    textDecorationLine: decorated ? node.textDecoration : undefined,
    textDecorationStyle: decorated && node.textDecorationStyle ? node.textDecorationStyle : undefined,
    textDecorationThickness:
      decorated && node.textDecorationThickness != null
        ? `${Math.max(0.5, (node.textDecorationThickness / 100) * fontSize)}px`
        : undefined,
    textUnderlineOffset:
      decorated && node.textUnderlineOffset != null ? `${(node.textUnderlineOffset / 100) * fontSize}px` : undefined,
    textDecorationSkipInk: decorated && node.textDecorationSkipInk === false ? 'none' : undefined,
    textDecorationColor: decorated && node.textDecorationColor ? decorationColor(node) : undefined,
    fontVariantCaps: node.textCase === 'small-caps' ? 'small-caps' : undefined,
    fontVariantNumeric: numericVariant(node),
    fontVariantLigatures: node.ligatures === false ? 'no-common-ligatures' : undefined,
    fontVariationSettings: node.fontVariationSettings || undefined,
    textTransform:
      node.textCase === 'upper'
        ? 'uppercase'
        : node.textCase === 'lower'
          ? 'lowercase'
          : node.textCase === 'title'
            ? 'capitalize'
            : undefined,
    textWrapStyle: node.textWrapStyle && node.textWrapStyle !== 'auto' ? node.textWrapStyle : undefined
  } as CSSProperties
}

/** Styles for the block that holds the lines: vertical trim + truncation. */
export function textBlockStyle(node: DesignNode): CSSProperties {
  return {
    ...(node.leadingTrim === 'cap' ? { textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic' } : {}),
    ...(node.textTruncation
      ? {
          display: '-webkit-box',
          WebkitLineClamp: String(node.maxLines || 1),
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden'
        }
      : {})
  } as CSSProperties
}

export function paragraphStyle(node: DesignNode, index: number, count: number, indentEm: number): CSSProperties {
  return {
    display: 'block',
    position: indentEm ? 'relative' : undefined,
    paddingLeft: indentEm ? `${indentEm}em` : undefined,
    marginBottom: index < count - 1 && node.paragraphSpacing ? `${node.paragraphSpacing}px` : undefined,
    textIndent: node.paragraphIndent ? `${node.paragraphIndent}px` : undefined
  }
}

let measureHost: HTMLDivElement | null = null
const cache = new Map<string, TextSize>()

function cssName(key: string): string {
  const kebab = key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
  return key.startsWith('Webkit') ? `-${kebab}` : kebab
}

function applyStyle(el: HTMLElement, style: CSSProperties) {
  for (const [key, value] of Object.entries(style)) {
    if (value == null || value === '') continue
    el.style.setProperty(cssName(key), String(value))
  }
}

function fontLoaded(node: DesignNode): boolean {
  try {
    const family = cssFontFamily(node.fontFamily || 'Inter')
    return document.fonts.check(
      `${node.fontStyle === 'italic' ? 'italic ' : ''}${node.fontWeight || 400} ${node.fontSize || 12}px ${family}`
    )
  } catch {
    return true
  }
}

/**
 * Lay the text out in a hidden DOM box styled exactly like the canvas text, so wrapping,
 * paragraph spacing, list indents, vertical trim and truncation all land in the size.
 * `editing` measures the raw editor text (no list markers / paragraph blocks).
 */
export function measureTextNode(node: DesignNode, text: string, opts?: { editing?: boolean }): TextSize {
  const fontSize = node.fontSize || 12
  if (typeof document === 'undefined') {
    return { width: Math.max(8, text.length * fontSize * 0.55), height: Math.round(fontSize * 1.2) }
  }
  const editing = Boolean(opts?.editing)
  const key = layoutKey(node, text, editing, 'size')
  const hit = cache.get(key)
  if (hit) return hit

  const el = buildLayout(node, text, editing, true)
  const rect = el.getBoundingClientRect()
  el.remove()
  const size = {
    width: Math.ceil(rect.width - 0.01),
    height: Math.max(1, Math.ceil(rect.height - 0.01))
  }
  if (cache.size > 2000) cache.clear()
  cache.set(key, size)
  return size
}

export interface TextLine {
  left: number
  top: number
  width: number
  height: number
}

/** Every laid-out line of the text (ignoring truncation), relative to the text box. */
export function measureTextLines(node: DesignNode, text: string): TextLine[] {
  if (typeof document === 'undefined') return []
  const key = layoutKey(node, text, false, 'lines')
  const hit = lineCache.get(key)
  if (hit) return hit

  const el = buildLayout(node, text, false, false)
  const origin = el.getBoundingClientRect()
  const range = document.createRange()
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
    range.selectNodeContents(textNode)
    for (const r of Array.from(range.getClientRects())) if (r.height > 0) rects.push(r)
  }
  range.detach()
  el.remove()

  const lines: TextLine[] = []
  for (const r of rects) {
    const top = r.top - origin.top
    const line = lines.find((l) => Math.abs(l.top - top) < Math.max(2, r.height * 0.4))
    if (line) {
      const right = Math.max(line.left + line.width, r.right - origin.left)
      line.left = Math.min(line.left, r.left - origin.left)
      line.width = right - line.left
      line.height = Math.max(line.height, r.height)
    } else {
      lines.push({ left: r.left - origin.left, top, width: r.width, height: r.height })
    }
  }
  lines.sort((a, b) => a.top - b.top)
  if (lineCache.size > 500) lineCache.clear()
  lineCache.set(key, lines)
  return lines
}

const lineCache = new Map<string, TextLine[]>()

function layoutKey(node: DesignNode, text: string, editing: boolean, kind: string): string {
  const resize = node.textResize || 'auto-width'
  return JSON.stringify([
    kind,
    text,
    editing,
    resize,
    resize === 'auto-width' ? 0 : node.width || 0,
    node.fontFamily,
    node.fontWeight,
    node.fontStyle,
    node.fontSize,
    node.lineHeight,
    node.letterSpacing,
    node.letterSpacingUnit,
    node.textCase,
    node.listStyle,
    node.paragraphSpacing,
    node.paragraphIndent,
    node.leadingTrim,
    node.textWrapStyle,
    node.textTruncation,
    node.maxLines,
    node.numberStyle,
    node.numberSpacing,
    node.fractions,
    node.slashedZero,
    node.ligatures,
    fontLoaded(node)
  ])
}

/** Attach a hidden element laid out like the canvas text. Caller removes it. */
function buildLayout(node: DesignNode, text: string, editing: boolean, clamp: boolean): HTMLDivElement {
  const resize = node.textResize || 'auto-width'
  const blocks = !editing && usesParagraphBlocks(node)
  if (!measureHost || !measureHost.isConnected) {
    measureHost = document.createElement('div')
    measureHost.setAttribute('aria-hidden', 'true')
    Object.assign(measureHost.style, {
      position: 'absolute',
      left: '-100000px',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      contain: 'layout style'
    })
    document.body.appendChild(measureHost)
  }

  const el = document.createElement('div')
  applyStyle(el, textTypographyStyle(node))
  const block = editing ? {} : textBlockStyle(node)
  if (!clamp) {
    delete block.WebkitLineClamp
    delete block.WebkitBoxOrient
    delete block.display
    delete block.overflow
  }
  if (!editing) applyStyle(el, block)
  else if (node.leadingTrim === 'cap') applyStyle(el, { textBoxTrim: 'trim-both', textBoxEdge: 'cap alphabetic' } as CSSProperties)
  el.style.position = 'absolute'
  el.style.display = clamp && !editing && node.textTruncation ? '-webkit-box' : 'block'
  el.style.whiteSpace = resize === 'auto-width' ? 'pre' : 'pre-wrap'
  el.style.wordBreak = resize === 'auto-width' ? 'normal' : 'break-word'
  el.style.width = resize === 'auto-width' ? 'max-content' : `${Math.max(1, node.width || 1)}px`

  if (blocks) {
    const paragraphs = textParagraphs(node, text)
    const indent = listIndentEm(node, paragraphs)
    paragraphs.forEach((para, index) => {
      const span = document.createElement('span')
      applyStyle(span, paragraphStyle(node, index, paragraphs.length, indent))
      span.textContent = para.text || '\u200b'
      el.appendChild(span)
    })
  } else {
    const shown = editing ? text : formatTextCase(text, node.textCase)
    el.textContent = shown ? (shown.endsWith('\n') ? `${shown}\u200b` : shown) : '\u200b'
  }

  measureHost.appendChild(el)
  return el
}


/** Sync a hugging text node's stored box with its laid-out text. */
export function remeasureText(node: DesignNode): DesignNode {
  if (node.type !== 'text' || node.editing) return node
  const resize = node.textResize || 'auto-width'
  if (resize === 'fixed') return node
  const size = measureTextNode(node, node.text || 'Text')
  if (resize === 'auto-width') {
    const width = Math.max(8, size.width)
    if (width === node.width && size.height === node.height) return node
    return { ...node, width, height: size.height }
  }
  if (size.height === node.height) return node
  return { ...node, height: size.height }
}
