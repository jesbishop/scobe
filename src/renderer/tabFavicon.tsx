import { useEffect, useState } from 'react'
import type { BrowserTab } from '../shared/types'

export function faviconSrc(tab: Pick<BrowserTab, 'url' | 'favicon'>): string | null {
  if (tab.favicon) return tab.favicon
  try {
    const parsed = new URL(tab.url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`
  } catch {
    return null
  }
}

export function TabFavicon({ tab }: { tab: Pick<BrowserTab, 'url' | 'favicon'> }) {
  const src = faviconSrc(tab)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [src])
  if (!src || failed) return <span className="tab-favicon is-empty" />
  return <img className="tab-favicon" src={src} alt="" onError={() => setFailed(true)} />
}
