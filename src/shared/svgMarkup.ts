/**
 * SVG markup helpers shared by the MCP/agent tools, Snapshot and the canvas renderer.
 * String based (no DOM) so they run in the main process too.
 */

const ATTR_VALUE = String.raw`\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`
const BLOCKED_ELEMENTS = 'script|foreignObject|iframe|object|embed|audio|video|canvas|handler|listener'

function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim()
}

/**
 * Vector layers are injected with innerHTML, so strip anything that can run code or reach outside
 * the drawing: scripts, event handlers, foreign HTML and javascript: links.
 */
export function sanitizeSvg(markup: string): string {
  let svg = String(markup || '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(new RegExp(`<(${BLOCKED_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<(${BLOCKED_ELEMENTS})\\b[^>]*>`, 'gi'), '')
    .replace(new RegExp(String.raw`\son[a-z-]+` + ATTR_VALUE, 'gi'), '')
    .replace(/@import[^;]*;?/gi, '')
  svg = svg.replace(new RegExp(String.raw`\s(?:xlink:)?href` + ATTR_VALUE, 'gi'), (match, value: string) => {
    const href = unquote(value)
    return href.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(href) || /^https?:/i.test(href)
      ? match
      : ''
  })
  svg = svg.replace(/\s[\w:-]+\s*=\s*("\s*(?:javascript|vbscript):[^"]*"|'\s*(?:javascript|vbscript):[^']*')/gi, '')
  return svg.trim()
}

function rootTag(markup: string): RegExpMatchArray | null {
  return markup.match(/<svg\b([^>]*)>/i)
}

function readAttr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(String.raw`\s${name}` + ATTR_VALUE, 'i'))
  return match ? unquote(match[1]) : null
}

function stripAttr(attrs: string, name: string): string {
  return attrs.replace(new RegExp(String.raw`\s${name}` + ATTR_VALUE, 'gi'), '')
}

/** The drawing's own size: viewBox first, then numeric width/height. */
export function svgIntrinsicSize(markup: string): { width: number; height: number } | null {
  const tag = rootTag(markup)
  if (!tag) return null
  const viewBox = readAttr(tag[1], 'viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] }
  }
  const width = parseFloat(readAttr(tag[1], 'width') || '')
  const height = parseFloat(readAttr(tag[1], 'height') || '')
  if (width > 0 && height > 0) return { width, height }
  return null
}

/**
 * Inline SVGs share one document, so ids (gradients, clip paths, masks) and <style> rules from one
 * vector would hit another. Prefix every id and scope every rule to this drawing.
 */
export function scopeSvg(markup: string, scope: string): string {
  const ids = new Set<string>()
  for (const match of markup.matchAll(/\sid\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const id = match[2] ?? match[3]
    if (id) ids.add(id)
  }
  let svg = markup
  if (ids.size) {
    const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const id of ids) {
      const next = `${scope}-${id}`
      const e = escape(id)
      svg = svg
        .replace(new RegExp(String.raw`(\sid\s*=\s*["'])${e}(["'])`, 'g'), `$1${next}$2`)
        .replace(new RegExp(String.raw`url\(\s*(["']?)#${e}\1\s*\)`, 'g'), `url(#${next})`)
        .replace(new RegExp(String.raw`(href\s*=\s*["'])#${e}(["'])`, 'g'), `$1#${next}$2`)
    }
  }
  if (/<style[\s>]/i.test(svg)) {
    svg = svg.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open: string, css: string, close: string) => {
      const scoped = css.replace(/([^{}]+)\{/g, (rule, selector: string) => {
        const sel = selector.trim()
        if (!sel || sel.startsWith('@') || /^(from|to|\d+(\.\d+)?%)(\s*,|$)/i.test(sel)) return rule
        return `${sel
          .split(',')
          .map((part) => `.${scope} ${part.trim()}`)
          .join(', ')} {`
      })
      return `${open}${scoped}${close}`
    })
    svg = svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
      const existing = readAttr(attrs, 'class')
      const rest = stripAttr(attrs, 'class')
      return `<svg${rest} class="${existing ? `${existing} ` : ''}${scope}">`
    })
  }
  return svg
}

/** Make the root fill whatever box the layer is: viewBox kept, width/height 100%. */
export function scalableSvg(markup: string, fit: 'meet' | 'none' = 'meet'): string {
  let svg = markup.trim()
  if (!/<svg[\s>]/i.test(svg)) svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${svg}</svg>`
  const size = svgIntrinsicSize(svg) || { width: 24, height: 24 }
  return svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
    let next = attrs
    const viewBox = readAttr(next, 'viewBox')
    const style = readAttr(next, 'style')
    for (const name of ['width', 'height', 'preserveAspectRatio', 'style', 'x', 'y']) next = stripAttr(next, name)
    if (!/\sxmlns\s*=/i.test(next)) next = ` xmlns="http://www.w3.org/2000/svg"${next}`
    if (!viewBox) next += ` viewBox="0 0 ${size.width} ${size.height}"`
    const display = `display:block;overflow:visible${style ? `;${style.replace(/"/g, "'")}` : ''}`
    const aspect = fit === 'none' ? 'none' : 'xMidYMid meet'
    return `<svg${next} width="100%" height="100%" preserveAspectRatio="${aspect}" style="${display}">`
  })
}

const KEEP_PAINT = /^(none|transparent|inherit|url\(.*\))$/i

/** One-color recolor: every visible fill and stroke (and currentColor) becomes `color`. */
export function recolorSvg(markup: string, color: string): string {
  let svg = markup
    .replace(/(\s(fill|stroke)\s*=\s*)("([^"]*)"|'([^']*)')/gi, (match, lead: string, _p: string, _q: string, a?: string, b?: string) => {
      const value = (a ?? b ?? '').trim()
      return KEEP_PAINT.test(value) ? match : `${lead}"${color}"`
    })
    .replace(/((?:^|[;{\s"'])(fill|stroke)\s*:\s*)([^;}"']+)/gi, (match, lead: string, _p: string, value: string) =>
      KEEP_PAINT.test(value.trim()) ? match : `${lead}${color}`
    )
    .replace(/currentColor/g, color)
  if (!/\sfill\s*=|fill\s*:/i.test(svg)) svg = svg.replace(/<svg\b/i, `<svg fill="${color}"`)
  return svg
}

/** Sanitized, id-scoped, box-filling markup ready to store on a vector layer. */
export function prepareSvg(markup: string, scope: string, opts?: { color?: string; fit?: 'meet' | 'none' }): string {
  let svg = sanitizeSvg(markup)
  if (!/<svg[\s>]/i.test(svg)) throw new Error('That is not SVG markup')
  if (opts?.color) svg = recolorSvg(svg, opts.color)
  return scalableSvg(scopeSvg(svg, scope), opts?.fit)
}
