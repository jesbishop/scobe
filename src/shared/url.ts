import { DEFAULT_URL } from './types'

const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_URL
  if (HAS_SCHEME.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed === 'localhost' || trimmed.startsWith('localhost:') || /^(\d{1,3}\.){3}\d{1,3}(:\d+)?/.test(trimmed)) {
    return `http://${trimmed}`
  }
  if (/^[^\s]+\.[^\s]+/.test(trimmed)) return `https://${trimmed}`
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}
