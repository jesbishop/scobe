const SHAPE_PATHS: Record<string, string> = {
  circle: '<circle cx="50" cy="50" r="40"/>',
  diamond: '<path d="M50 8 92 50 50 92 8 50Z"/>',
  square: '<rect x="14" y="14" width="72" height="72" rx="6"/>',
  star: '<path d="M50 6 62.9 34.2 93.8 37.6 70.8 58.4 77.2 88.8 50 73.3 22.8 88.8 29.2 58.4 6.2 37.6 37.1 34.2Z"/>',
  heart:
    '<path d="M50 88C22 68 8 52 8 34 8 20 19 10 32 10 40 10 46 14 50 21 54 14 60 10 68 10 81 10 92 20 92 34 92 52 78 68 50 88Z"/>'
}

const cache = new Map<string, string>()

/** Black-on-transparent PNG-friendly SVG for a built-in shader shape. */
export function shaderShapeUrl(id: string): string {
  const key = SHAPE_PATHS[id] ? id : 'diamond'
  const hit = cache.get(key)
  if (hit) return hit
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 100 100" fill="#000">${SHAPE_PATHS[key]}</svg>`
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  cache.set(key, url)
  return url
}
