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

/** Squircle-ish app-icon corners: fades alpha outside a rounded square, antialiased with 4×4 supersampling. */
function roundCorners(png, radiusRatio = 0.225) {
  const size = png.width
  const r = size * radiusRatio
  const coverage = (px, py) => {
    let inside = 0
    for (let sy = 0; sy < 4; sy++) {
      for (let sx = 0; sx < 4; sx++) {
        const x = px + (sx + 0.5) / 4
        const y = py + (sy + 0.5) / 4
        const cx = Math.min(Math.max(x, r), size - r)
        const cy = Math.min(Math.max(y, r), size - r)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) inside++
      }
    }
    return inside / 16
  }
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const nearCorner = (x < r || x >= size - r) && (y < r || y >= size - r)
      if (!nearCorner) continue
      const idx = (png.width * y + x) << 2
      png.data[idx + 3] = Math.round(png.data[idx + 3] * coverage(x, y))
    }
  }
  return png
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

const icon256 = roundCorners(placeOnSquare(markWhite, 256, { bg: [0, 0, 0, 255], ink: [255, 255, 255, 255], margin: 0.2 }))
const icon32 = roundCorners(placeOnSquare(markWhite, 32, { bg: [0, 0, 0, 255], ink: [255, 255, 255, 255], margin: 0.18 }))
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
