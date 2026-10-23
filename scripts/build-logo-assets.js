const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'resources', 'vanta-logo-source-clean.png')

function readPng(file) {
  return PNG.sync.read(fs.readFileSync(file))
}

function writePng(file, png) {
  fs.writeFileSync(file, PNG.sync.write(png))
}

function isInk(data, idx) {
  const r = data[idx]
  const g = data[idx + 1]
  const b = data[idx + 2]
  const a = data[idx + 3]
  if (a < 20) return false
  // blackish ink on white
  return (r + g + b) / 3 < 140
}

function contentBounds(png) {
  let minX = png.width
  let minY = png.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2
      if (!isInk(png.data, idx)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error('No ink found in source logo')
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function cropInk(png, bounds, { color = [0, 0, 0], pad = 0 } = {}) {
  const out = new PNG({ width: bounds.width + pad * 2, height: bounds.height + pad * 2, colorType: 6 })
  out.data.fill(0)
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const sx = bounds.minX + x
      const sy = bounds.minY + y
      const sIdx = (png.width * sy + sx) << 2
      if (!isInk(png.data, sIdx)) continue
      const dx = x + pad
      const dy = y + pad
      const dIdx = (out.width * dy + dx) << 2
      out.data[dIdx] = color[0]
      out.data[dIdx + 1] = color[1]
      out.data[dIdx + 2] = color[2]
      out.data[dIdx + 3] = 255
    }
  }
  return out
}

function columnHasInk(png, x, bounds) {
  for (let y = bounds.minY; y <= bounds.maxY; y++) {
    const idx = (png.width * y + x) << 2
    if (isInk(png.data, idx)) return true
  }
  return false
}

function findLetterBounds(png, bounds) {
  const letters = []
  let inLetter = false
  let start = 0
  for (let x = bounds.minX; x <= bounds.maxX + 1; x++) {
    const filled = x <= bounds.maxX && columnHasInk(png, x, bounds)
    if (filled && !inLetter) {
      inLetter = true
      start = x
    } else if (!filled && inLetter) {
      inLetter = false
      letters.push({ minX: start, maxX: x - 1, minY: bounds.minY, maxY: bounds.maxY })
    }
  }
  return letters
}

function placeOnSquare(inkPng, size, { bg = [0, 0, 0, 255], ink = [255, 255, 255, 255], margin = 0.18 } = {}) {
  const out = new PNG({ width: size, height: size, colorType: 6 })
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0]
    out.data[i + 1] = bg[1]
    out.data[i + 2] = bg[2]
    out.data[i + 3] = bg[3]
  }
  const maxW = Math.round(size * (1 - margin * 2))
  const maxH = Math.round(size * (1 - margin * 2))
  const scale = Math.min(maxW / inkPng.width, maxH / inkPng.height)
  const drawW = Math.max(1, Math.round(inkPng.width * scale))
  const drawH = Math.max(1, Math.round(inkPng.height * scale))
  const ox = Math.floor((size - drawW) / 2)
  const oy = Math.floor((size - drawH) / 2)
  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      const sx = Math.min(inkPng.width - 1, Math.floor(x / scale))
      const sy = Math.min(inkPng.height - 1, Math.floor(y / scale))
      const sIdx = (inkPng.width * sy + sx) << 2
      if (inkPng.data[sIdx + 3] < 20) continue
      const dIdx = (size * (oy + y) + (ox + x)) << 2
      out.data[dIdx] = ink[0]
      out.data[dIdx + 1] = ink[1]
      out.data[dIdx + 2] = ink[2]
      out.data[dIdx + 3] = ink[3]
    }
  }
  return out
}

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

/**
 * 1-bit pixel icon: the mark is sampled onto a `grid`×`grid` board, shaded top-to-bottom, over a faint glow,
 * then ordered-dithered (Bayer 4×4). Corners are rounded on the pixel grid so they step like the art.
 */
function ditherIcon(inkPng, size, { grid = 32, margin = 0.16, radiusRatio = 0.225 } = {}) {
  const out = new PNG({ width: size, height: size, colorType: 6 })
  out.data.fill(0)
  const inner = grid * (1 - margin * 2)
  const scale = Math.min(inner / inkPng.width, inner / inkPng.height)
  const drawW = inkPng.width * scale
  const drawH = inkPng.height * scale
  const ox = (grid - drawW) / 2
  const oy = (grid - drawH) / 2
  const inkAt = (gx, gy) => {
    const sx = Math.floor((gx - ox) / scale)
    const sy = Math.floor((gy - oy) / scale)
    if (sx < 0 || sy < 0 || sx >= inkPng.width || sy >= inkPng.height) return 0
    return inkPng.data[((inkPng.width * sy + sx) << 2) + 3] > 20 ? 1 : 0
  }
  const radius = grid * radiusRatio
  const cell = size / grid
  const mark = []
  for (let gy = 0; gy < grid; gy++) {
    const row = []
    for (let gx = 0; gx < grid; gx++) {
      let coverage = 0
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) coverage += inkAt(gx + (sx + 0.5) / 4, gy + (sy + 0.5) / 4)
      }
      row.push(coverage >= 8)
    }
    mark.push(row)
  }
  const nearMark = (gx, gy) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (mark[gy + dy]?.[gx + dx]) return true
    }
    return false
  }
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const cx = gx + 0.5
      const cy = gy + 0.5
      const kx = Math.min(Math.max(cx, radius), grid - radius)
      const ky = Math.min(Math.max(cy, radius), grid - radius)
      if ((cx - kx) ** 2 + (cy - ky) ** 2 > radius * radius) continue

      // Background brightens toward the bottom; a 1-cell black moat keeps the mark legible.
      const rise = Math.max(0, (cy / grid - 0.35) / 0.65)
      const tone = mark[gy][gx] ? 1 : nearMark(gx, gy) ? 0 : rise * rise * 0.62
      const on = tone * 16 > BAYER4[gy % 4][gx % 4] + 0.5

      const value = on ? 255 : 0
      const x0 = Math.round(gx * cell)
      const y0 = Math.round(gy * cell)
      const x1 = Math.round((gx + 1) * cell)
      const y1 = Math.round((gy + 1) * cell)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (size * y + x) << 2
          out.data[idx] = value
          out.data[idx + 1] = value
          out.data[idx + 2] = value
          out.data[idx + 3] = 255
        }
      }
    }
  }
  return out
}

function pngToDataUri(png) {
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

const source = readPng(sourcePath)
const bounds = contentBounds(source)
console.log('content', bounds)

const wordmark = cropInk(source, bounds, { color: [0, 0, 0] })
const wordmarkWhite = cropInk(source, bounds, { color: [255, 255, 255] })
const letters = findLetterBounds(source, bounds)
console.log(
  'letters',
  letters.map((l, i) => ({ i, w: l.maxX - l.minX + 1, h: l.maxY - l.minY + 1 }))
)
if (!letters.length) throw new Error('Could not split letters')

const vBounds = letters[0]
// tighten vertical crop for V
let vminY = vBounds.maxY
let vmaxY = vBounds.minY
for (let y = vBounds.minY; y <= vBounds.maxY; y++) {
  for (let x = vBounds.minX; x <= vBounds.maxX; x++) {
    const idx = (source.width * y + x) << 2
    if (!isInk(source.data, idx)) continue
    if (y < vminY) vminY = y
    if (y > vmaxY) vmaxY = y
  }
}
const markBounds = { minX: vBounds.minX, maxX: vBounds.maxX, minY: vminY, maxY: vmaxY, width: vBounds.maxX - vBounds.minX + 1, height: vmaxY - vminY + 1 }
const mark = cropInk(source, markBounds, { color: [0, 0, 0] })
const markWhite = cropInk(source, markBounds, { color: [255, 255, 255] })

const assets = path.join(root, 'src', 'renderer', 'assets')
const pub = path.join(root, 'src', 'renderer', 'public')
const resources = path.join(root, 'resources')

writePng(path.join(assets, 'vanta-logo.png'), wordmark)
writePng(path.join(assets, 'vanta-logo-white.png'), wordmarkWhite)
writePng(path.join(assets, 'vanta-mark.png'), mark)
writePng(path.join(assets, 'vanta-mark-white.png'), markWhite)

const icon256 = ditherIcon(markWhite, 256)
const icon32 = ditherIcon(markWhite, 32)
writePng(path.join(resources, 'icon.png'), icon256)
writePng(path.join(pub, 'favicon.png'), icon256)
writePng(path.join(pub, 'favicon-32.png'), icon32)

const aspect = wordmark.width / wordmark.height
const markAspect = mark.width / mark.height

const logoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Vanta">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmark)}" xlink:href="${pngToDataUri(wordmark)}"/>
</svg>
`
const logoLight = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Vanta">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmark)}" xlink:href="${pngToDataUri(wordmark)}"/>
</svg>
`
const logoDark = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Vanta">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmarkWhite)}" xlink:href="${pngToDataUri(wordmarkWhite)}"/>
</svg>
`
const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" role="img" aria-label="Vanta">
  <image width="256" height="256" href="${pngToDataUri(icon256)}" xlink:href="${pngToDataUri(icon256)}"/>
</svg>
`
const iconSvg = faviconSvg

fs.writeFileSync(path.join(assets, 'vanta-logo.svg'), logoSvg)
fs.writeFileSync(path.join(assets, 'vanta-logo-light.svg'), logoLight)
fs.writeFileSync(path.join(assets, 'vanta-logo-dark.svg'), logoDark)
fs.writeFileSync(path.join(pub, 'favicon.svg'), faviconSvg)
fs.writeFileSync(path.join(resources, 'icon.svg'), iconSvg)

fs.writeFileSync(
  path.join(assets, 'logo-meta.json'),
  JSON.stringify({ wordmark: { width: wordmark.width, height: wordmark.height, aspect }, mark: { width: mark.width, height: mark.height, aspect: markAspect } }, null, 2)
)

console.log('Wrote logo + favicon assets', { aspect, markAspect })
