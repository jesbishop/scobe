export type OpenTabCandidate = {
  id: string
  windowId?: string
  title: string
  url: string
  favicon?: string
}

export type UrlSuggestKind = 'tab' | 'history' | 'search' | 'url'

export type UrlSuggestItem = {
  id: string
  kind: UrlSuggestKind
  label: string
  subtitle: string
  url: string
  favicon?: string
  tabId?: string
  windowId?: string
  score: number
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (parsed.pathname === '/') parsed.pathname = ''
    return `${parsed.protocol}//${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}${parsed.search}`
  } catch {
    return url.trim()
  }
}

export function urlsMatch(a: string, b: string): boolean {
  return canonicalUrl(a) === canonicalUrl(b)
}

function displayTitle(title: string, url: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  return hostOf(url) || url
}

function scoreText(query: string, haystack: string): number {
  const q = query.toLowerCase()
  const h = haystack.toLowerCase()
  if (!q) return 0
  if (h === q) return 120
  if (h.startsWith(q)) return 90
  const idx = h.indexOf(q)
  if (idx === 0) return 80
  if (idx > 0) return 50 - Math.min(idx, 30)
  return 0
}

export function looksLikeUrlQuery(query: string): boolean {
  const q = query.trim()
  if (!q) return false
  if (/\s/.test(q)) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(q)) return true
  if (q.includes('/') || q.includes('.')) return true
  return false
}

export function buildUrlSuggestions(input: {
  query: string
  history: Array<{ url: string; title: string; favicon?: string; visitedAt: number; visitCount: number }>
  openTabs: OpenTabCandidate[]
  searchPhrases?: string[]
  limit?: number
}): UrlSuggestItem[] {
  const query = input.query.trim()
  const limit = input.limit ?? 8
  const items: UrlSuggestItem[] = []
  const seen = new Set<string>()

  const openByUrl = new Map<string, OpenTabCandidate>()
  for (const tab of input.openTabs) {
    if (tab.url && tab.url !== 'about:blank') openByUrl.set(canonicalUrl(tab.url), tab)
  }

  const push = (item: UrlSuggestItem) => {
    const key = item.kind === 'tab' ? `tab:${item.tabId}` : `${item.kind}:${canonicalUrl(item.url)}`
    if (seen.has(key)) return
    // Prefer an open tab over history/url for the same destination.
    if (item.kind !== 'tab' && openByUrl.has(canonicalUrl(item.url)) && seen.has(`url-open:${canonicalUrl(item.url)}`)) {
      return
    }
    seen.add(key)
    if (item.kind === 'tab') seen.add(`url-open:${canonicalUrl(item.url)}`)
    items.push(item)
  }

  for (const tab of input.openTabs) {
    if (!tab.url || tab.url === 'about:blank') continue
    const title = displayTitle(tab.title, tab.url)
    const host = hostOf(tab.url)
    const score =
      scoreText(query, title) * 1.2 +
      scoreText(query, host) * 1.1 +
      scoreText(query, tab.url) +
      (query ? 0 : 8)
    if (!query || score > 0) {
      push({
        id: `tab:${tab.id}`,
        kind: 'tab',
        label: title,
        subtitle: host || tab.url,
        url: tab.url,
        favicon: tab.favicon,
        tabId: tab.id,
        windowId: tab.windowId,
        score: score + 40
      })
    }
  }

  for (const visit of input.history) {
    if (openByUrl.has(canonicalUrl(visit.url))) continue
    const title = displayTitle(visit.title, visit.url)
    const host = hostOf(visit.url)
    const recency = Math.max(0, 20 - (Date.now() - visit.visitedAt) / (1000 * 60 * 60 * 24))
    const score =
      scoreText(query, title) +
      scoreText(query, host) * 1.15 +
      scoreText(query, visit.url) +
      Math.min(visit.visitCount, 12) +
      recency
    if (!query || score > 0) {
      const openMatch = openByUrl.get(canonicalUrl(visit.url))
      push({
        id: `history:${visit.url}`,
        kind: 'history',
        label: title,
        subtitle: host || visit.url,
        url: visit.url,
        favicon: visit.favicon || openMatch?.favicon,
        score
      })
    }
  }

  for (const phrase of input.searchPhrases || []) {
    const text = phrase.trim()
    if (!text) continue
    push({
      id: `search:${text}`,
      kind: 'search',
      label: text,
      subtitle: 'Search Google',
      url: `https://www.google.com/search?q=${encodeURIComponent(text)}`,
      score: 35 + scoreText(query, text)
    })
  }

  if (query && looksLikeUrlQuery(query)) {
    const url = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(query)
      ? query
      : query.startsWith('//')
        ? `https:${query}`
        : `https://${query}`
    push({
      id: `url:${url}`,
      kind: 'url',
      label: query,
      subtitle: 'Open URL',
      url,
      score: 70
    })
  } else if (query && !looksLikeUrlQuery(query)) {
    push({
      id: `search-exact:${query}`,
      kind: 'search',
      label: query,
      subtitle: 'Search Google',
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      score: 25
    })
  }

  return items.sort((a, b) => b.score - a.score).slice(0, limit)
}
