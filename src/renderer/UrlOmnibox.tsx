import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { LanguageIcon, SearchIcon } from './lucideIcons'
import { normalizeUrl } from '../shared/url'
import {
  buildUrlSuggestions,
  looksLikeUrlQuery,
  type OpenTabCandidate,
  type UrlSuggestItem
} from '../shared/urlSuggest'
import { loadUrlHistory, recordVisit, type VisitEntry } from './urlHistory'
import { TabFavicon } from './tabFavicon'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (url: string) => void
  onSwitchTab?: (tab: { tabId: string; windowId?: string }) => void
  openTabs?: OpenTabCandidate[]
  placeholder?: string
  ariaLabel?: string
  className?: string
  inputClassName?: string
  onInputFocus?: () => void
  onInputPointerDown?: (event: React.PointerEvent<HTMLInputElement>) => void
  onInputMouseDown?: (event: React.MouseEvent<HTMLInputElement>) => void
}

function kindIcon(item: UrlSuggestItem): ReactNode {
  if (item.kind === 'search') return <SearchIcon sx={{ fontSize: 16 }} />
  if (item.url && item.url !== 'about:blank') {
    return <TabFavicon tab={{ url: item.url, favicon: item.favicon || '' }} />
  }
  return <LanguageIcon sx={{ fontSize: 16 }} />
}

function kindHint(item: UrlSuggestItem): string {
  if (item.kind === 'search') return 'Search'
  if (item.kind === 'url') return 'Open'
  if (item.kind === 'tab') return 'Open'
  return 'History'
}

async function fetchSearchPhrases(query: string): Promise<string[]> {
  if (!query.trim() || looksLikeUrlQuery(query)) return []
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(query.trim())}&type=list`,
      { signal: controller.signal }
    )
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
      return (data[1] as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 5)
    }
    if (Array.isArray(data)) {
      return data
        .map((item) =>
          item && typeof item === 'object' && 'phrase' in item ? String((item as { phrase: string }).phrase) : ''
        )
        .filter(Boolean)
        .slice(0, 5)
    }
  } catch {
    /* ignore network errors */
  } finally {
    window.clearTimeout(timer)
  }
  return []
}

export function UrlOmnibox({
  value,
  onChange,
  onSubmit,
  openTabs = [],
  placeholder = 'Search Google or type a URL',
  ariaLabel = 'Address',
  className,
  inputClassName,
  onInputFocus,
  onInputPointerDown,
  onInputMouseDown
}: Props) {
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [history, setHistory] = useState<VisitEntry[]>(() => loadUrlHistory())
  const [searchPhrases, setSearchPhrases] = useState<string[]>([])
  const [menuBox, setMenuBox] = useState<CSSProperties | null>(null)

  const suggestions = useMemo(
    () =>
      buildUrlSuggestions({
        query: value,
        history,
        openTabs,
        searchPhrases,
        limit: 8
      }),
    [value, history, openTabs, searchPhrases]
  )

  useEffect(() => {
    if (!open) return
    const q = value.trim()
    if (!q || looksLikeUrlQuery(q)) {
      setSearchPhrases([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void fetchSearchPhrases(q).then((phrases) => {
        if (!cancelled) setSearchPhrases(phrases)
      })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [value, open])

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null)
      return
    }

    let raf = 0
    let lastKey = ''
    let alive = true

    const tick = () => {
      if (!alive) return
      const el = inputRef.current || wrapRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        // Close if the address bar left the viewport (e.g. panned far away).
        if (rect.width < 8 || rect.bottom < 0 || rect.top > window.innerHeight) {
          setOpen(false)
          return
        }
        const width = Math.max(rect.width, 280)
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)
        const spaceBelow = window.innerHeight - rect.bottom - 12
        const spaceAbove = rect.top - 12
        const placeAbove = spaceBelow < 160 && spaceAbove > spaceBelow
        const maxHeight = Math.min(360, Math.max(120, placeAbove ? spaceAbove - 6 : spaceBelow))
        const top = placeAbove ? Math.max(8, rect.top - 6 - maxHeight) : rect.bottom + 6
        const key = `${Math.round(top)}:${Math.round(left)}:${Math.round(width)}:${Math.round(maxHeight)}`
        if (key !== lastKey) {
          lastKey = key
          setMenuBox({
            position: 'fixed',
            top,
            left,
            width,
            maxHeight
          })
          window.dispatchEvent(new Event('vanta:chrome-layout'))
        }
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    window.dispatchEvent(new Event('vanta:chrome-layout'))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.dispatchEvent(new Event('vanta:chrome-layout'))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if ((target as Element)?.closest?.('.url-omnibox-menu')) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [value, suggestions.length])

  const commit = (item?: UrlSuggestItem) => {
    const raw = item?.url || value
    const next = normalizeUrl(raw)
    recordVisit({ url: next, title: item?.label || '' })
    setHistory(loadUrlHistory())
    onChange(next)
    setOpen(false)
    void window.vanta.focusShell?.()
    onSubmit(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'ArrowDown') {
      if (!open) setOpen(true)
      event.preventDefault()
      setActive((index) => (suggestions.length ? (index + 1) % suggestions.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      if (!open) setOpen(true)
      event.preventDefault()
      setActive((index) => (suggestions.length ? (index - 1 + suggestions.length) % suggestions.length : 0))
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(open && suggestions[active] ? suggestions[active] : undefined)
    }
  }

  const showMenu = open && suggestions.length > 0 && menuBox

  return (
    <div ref={wrapRef} className={className ? `url-omnibox ${className}` : 'url-omnibox'}>
      <input
        ref={inputRef}
        className={inputClassName}
        value={value}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={Boolean(showMenu)}
        role="combobox"
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => {
          setHistory(loadUrlHistory())
          setOpen(true)
          onInputFocus?.()
        }}
        onPointerDown={onInputPointerDown}
        onMouseDown={onInputMouseDown}
        onKeyDown={onKeyDown}
      />
      {showMenu
        ? createPortal(
            <div
              className="url-omnibox-menu"
              data-chrome-overlay=""
              id={listId}
              role="listbox"
              style={menuBox}
            >
              {suggestions.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? 'url-omnibox-row is-active' : 'url-omnibox-row'}
                  onMouseEnter={() => setActive(index)}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setActive(index)
                    commit(item)
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                >
                  <span className="url-omnibox-icon" aria-hidden="true">
                    {kindIcon(item)}
                  </span>
                  <span className="url-omnibox-copy">
                    <span className="url-omnibox-title">{item.label}</span>
                    <span className="url-omnibox-sub">{item.subtitle}</span>
                  </span>
                  <span className="url-omnibox-hint">{kindHint(item)}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
