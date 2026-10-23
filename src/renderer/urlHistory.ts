export type VisitEntry = {
  url: string
  title: string
  favicon?: string
  visitedAt: number
  visitCount: number
}

const STORAGE_KEY = 'vanta-url-history'
const MAX_ENTRIES = 250

function read(): VisitEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw) as VisitEntry[]
    return Array.isArray(data) ? data.filter((item) => item && typeof item.url === 'string') : []
  } catch {
    return []
  }
}

function write(entries: VisitEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    /* ignore */
  }
}

export function loadUrlHistory(): VisitEntry[] {
  return read()
}

export function recordVisit(input: { url: string; title?: string; favicon?: string }): VisitEntry[] {
  const url = input.url.trim()
  if (!url || url === 'about:blank' || url.startsWith('devtools:')) return read()

  const now = Date.now()
  const current = read()
  const existing = current.find((item) => item.url === url)
  const next: VisitEntry = existing
    ? (() => {
        const bump = now - existing.visitedAt > 30_000
        return {
          ...existing,
          title: input.title?.trim() || existing.title,
          favicon: input.favicon || existing.favicon,
          visitedAt: bump ? now : Math.max(existing.visitedAt, now - 1),
          visitCount: existing.visitCount + (bump ? 1 : 0)
        }
      })()
    : {
        url,
        title: input.title?.trim() || '',
        favicon: input.favicon,
        visitedAt: now,
        visitCount: 1
      }

  const entries = [next, ...current.filter((item) => item.url !== url)].slice(0, MAX_ENTRIES)
  write(entries)
  return entries
}
