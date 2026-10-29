import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { sanitizeSvg } from '../shared/svgMarkup'

type LucideEntry = { n: Array<[string, Record<string, string | number>]>; a?: string[] }

const ICONIFY_API = 'https://api.iconify.design'

let lucide: Record<string, LucideEntry> | null = null
let aliases: Map<string, string> | null = null

function lucideIndex(): Record<string, LucideEntry> {
  if (!lucide) {
    lucide = JSON.parse(readFileSync(join(app.getAppPath(), 'resources', 'icons', 'lucide.json'), 'utf8')) as Record<
      string,
      LucideEntry
    >
    aliases = new Map()
    for (const [name, entry] of Object.entries(lucide)) for (const alias of entry.a || []) aliases.set(alias, name)
  }
  return lucide
}

/** "ArrowRight", "arrow_right", "arrow right" and "lucide:arrow-right" all mean arrow-right. */
export function normalizeIconName(raw: string): string {
  return raw
    .trim()
    .replace(/^lucide[:/]/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
}

function lucideName(raw: string): string | null {
  const index = lucideIndex()
  const name = normalizeIconName(raw)
  if (index[name]) return name
  return aliases?.get(name) || null
}

function escapeAttr(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function lucideSvg(name: string, color: string, strokeWidth: number): string {
  const body = lucideIndex()[name].n
    .map(([tag, attrs]) => {
      const attrText = Object.entries(attrs)
        .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
        .join('')
      return `<${tag}${attrText}/>`
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${escapeAttr(color)}" ` +
    `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  )
}

async function fetchText(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return { ok: res.ok, status: res.status, text: await res.text() }
  } catch (error) {
    throw new Error(`Could not reach ${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** SVG for an icon: Lucide names are drawn locally; `prefix:name` (mdi:home, tabler:bolt, ph:house) comes from Iconify. */
export async function iconSvg(
  raw: string,
  opts: { color: string; strokeWidth: number }
): Promise<{ svg: string; id: string; source: 'lucide' | 'iconify' }> {
  const local = lucideName(raw)
  if (local) return { svg: lucideSvg(local, opts.color, opts.strokeWidth), id: local, source: 'lucide' }

  const match = raw.trim().match(/^([a-z0-9-]+):([a-z0-9-]+)$/i)
  if (!match) {
    const suggestions = searchLucide(raw, 6)
    throw new Error(
      `No Lucide icon named "${raw}".` +
        (suggestions.length ? ` Close matches: ${suggestions.join(', ')}.` : '') +
        ' Use search_icons to find one, or an Iconify id like "mdi:home".'
    )
  }
  const [, prefix, name] = match
  const res = await fetchText(`${ICONIFY_API}/${prefix.toLowerCase()}/${name.toLowerCase()}.svg`)
  if (!res.ok || !/<svg[\s>]/i.test(res.text)) throw new Error(`Iconify has no icon "${prefix}:${name}"`)
  const svg = sanitizeSvg(res.text).replace(/currentColor/g, opts.color)
  return { svg, id: `${prefix.toLowerCase()}:${name.toLowerCase()}`, source: 'iconify' }
}

/** Lucide names ranked: exact, prefix, word match, then aliases. */
export function searchLucide(query: string, limit: number): string[] {
  const index = lucideIndex()
  const q = normalizeIconName(query)
  if (!q) return []
  const words = q.split('-').filter(Boolean)
  const scored: Array<[string, number]> = []
  for (const [name, entry] of Object.entries(index)) {
    const names = [name, ...(entry.a || [])]
    let best = Infinity
    for (const [i, candidate] of names.entries()) {
      const penalty = i === 0 ? 0 : 0.5
      if (candidate === q) best = Math.min(best, 0 + penalty)
      else if (candidate.startsWith(q)) best = Math.min(best, 1 + penalty)
      else if (candidate.split('-').some((part) => part === q)) best = Math.min(best, 2 + penalty)
      else if (candidate.includes(q)) best = Math.min(best, 3 + penalty)
      else if (words.length > 1 && words.every((word) => candidate.includes(word))) best = Math.min(best, 4 + penalty)
    }
    if (best < Infinity) scored.push([name, best + name.length / 1000])
  }
  return scored
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([name]) => name)
}

export async function searchIconify(query: string, limit: number): Promise<string[]> {
  const res = await fetchText(`${ICONIFY_API}/search?query=${encodeURIComponent(query)}&limit=${Math.max(32, limit)}`)
  if (!res.ok) return []
  try {
    const data = JSON.parse(res.text) as { icons?: string[] }
    return (data.icons || []).slice(0, limit)
  } catch {
    return []
  }
}

/** Fetch an SVG file from the web (logos, illustrations). */
export async function fetchSvg(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('SVG url must start with http:// or https://')
  const res = await fetchText(url, 10000)
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  if (res.text.length > 1_000_000) throw new Error('That SVG is larger than 1 MB')
  if (!/<svg[\s>]/i.test(res.text)) throw new Error('That URL did not return SVG')
  return res.text
}
