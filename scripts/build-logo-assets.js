const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'resources', 'scobe-logo-source.png')

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

/** Ink darkness → alpha, so edges stay anti-aliased and the white background drops out. */
function inkAlpha(data, idx) {
  const avg = (data[idx] + data[idx + 1] + data[idx + 2]) / 3
  const a = Math.min(1, Math.max(0, (225 - avg) / 175))
  return Math.round(a * (data[idx + 3] / 255) * 255)
}

function cropInk(png, bounds, { color = [0, 0, 0], pad = 0 } = {}) {
  const out = new PNG({ width: bounds.width + pad * 2, height: bounds.height + pad * 2, colorType: 6 })
  out.data.fill(0)
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      const sx = bounds.minX + x
      const sy = bounds.minY + y
      const alpha = inkAlpha(png.data, (png.width * sy + sx) << 2)
      if (!alpha) continue
      const dIdx = (out.width * (y + pad) + (x + pad)) << 2
      out.data[dIdx] = color[0]
      out.data[dIdx + 1] = color[1]
      out.data[dIdx + 2] = color[2]
      out.data[dIdx + 3] = alpha
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

/**
 * App icon: the mark in white, centred on a black rounded square. Both the mark and the corners are
 * anti-aliased with 4×4 supersampling so it stays crisp from 16px tabs up to the 1024px macOS icon.
 */
function markIcon(inkPng, size, { margin = 0.22, radiusRatio = 0.225 } = {}) {
  const out = new PNG({ width: size, height: size, colorType: 6 })
  const inner = size * (1 - margin * 2)
  const scale = Math.min(inner / inkPng.width, inner / inkPng.height)
  const ox = (size - inkPng.width * scale) / 2
  const oy = (size - inkPng.height * scale) / 2
  const r = size * radiusRatio
  const SS = 4
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let shape = 0
      let ink = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const py = y + (sy + 0.5) / SS
          const kx = Math.min(Math.max(px, r), size - r)
          const ky = Math.min(Math.max(py, r), size - r)
          if ((px - kx) ** 2 + (py - ky) ** 2 > r * r) continue
          shape++
          const ix = Math.floor((px - ox) / scale)
          const iy = Math.floor((py - oy) / scale)
          if (ix < 0 || iy < 0 || ix >= inkPng.width || iy >= inkPng.height) continue
          ink += inkPng.data[((inkPng.width * iy + ix) << 2) + 3] / 255
        }
      }
      const idx = (size * y + x) << 2
      const value = shape ? Math.round((ink / shape) * 255) : 0
      out.data[idx] = value
      out.data[idx + 1] = value
      out.data[idx + 2] = value
      out.data[idx + 3] = Math.round((shape / (SS * SS)) * 255)
    }
  }
  return out
}

function pngToDataUri(png) {
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

const source = readPng(sourcePath)
/** Grow a crop by 1px so the soft, anti-aliased edge pixels aren't clipped. */
function grow(box) {
  const minX = Math.max(0, box.minX - 1)
  const minY = Math.max(0, box.minY - 1)
  const maxX = Math.min(source.width - 1, box.maxX + 1)
  const maxY = Math.min(source.height - 1, box.maxY + 1)
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
const bounds = grow(contentBounds(source))
console.log('content', bounds)

const wordmark = cropInk(source, bounds, { color: [0, 0, 0] })
const wordmarkWhite = cropInk(source, bounds, { color: [255, 255, 255] })
const letters = findLetterBounds(source, bounds)
console.log(
  'letters',
  letters.map((l, i) => ({ i, w: l.maxX - l.minX + 1, h: l.maxY - l.minY + 1 }))
)
if (!letters.length) throw new Error('Could not split letters')

// The favicon mark is the first letter (the S), cropped tight.
const sBounds = letters[0]
let sminY = sBounds.maxY
let smaxY = sBounds.minY
for (let y = sBounds.minY; y <= sBounds.maxY; y++) {
  for (let x = sBounds.minX; x <= sBounds.maxX; x++) {
    const idx = (source.width * y + x) << 2
    if (!isInk(source.data, idx)) continue
    if (y < sminY) sminY = y
    if (y > smaxY) smaxY = y
  }
}
const markBounds = grow({ minX: sBounds.minX, maxX: sBounds.maxX, minY: sminY, maxY: smaxY })
const mark = cropInk(source, markBounds, { color: [0, 0, 0] })
const markWhite = cropInk(source, markBounds, { color: [255, 255, 255] })

const assets = path.join(root, 'src', 'renderer', 'assets')
const pub = path.join(root, 'src', 'renderer', 'public')
const resources = path.join(root, 'resources')

writePng(path.join(assets, 'vanta-logo.png'), wordmark)
writePng(path.join(assets, 'vanta-logo-white.png'), wordmarkWhite)
writePng(path.join(assets, 'vanta-mark.png'), mark)
writePng(path.join(assets, 'vanta-mark-white.png'), markWhite)

// Standalone downloads: transparent background, black ink and white ink.
writePng(path.join(resources, 'scobe-logo-black.png'), wordmark)
writePng(path.join(resources, 'scobe-logo-white.png'), wordmarkWhite)

const icon256 = markIcon(markWhite, 256)
const icon32 = markIcon(markWhite, 32)
writePng(path.join(resources, 'icon.png'), icon256)
// electron-builder needs ≥512px for the macOS .icns.
writePng(path.join(resources, 'icon-1024.png'), markIcon(markWhite, 1024))
writePng(path.join(pub, 'favicon.png'), icon256)
writePng(path.join(pub, 'favicon-32.png'), icon32)

const site = path.join(root, 'site')
writePng(path.join(site, 'icon.png'), icon256)
writePng(path.join(site, 'scobe-logo.png'), wordmarkWhite)

const aspect = wordmark.width / wordmark.height
const markAspect = mark.width / mark.height

const logoSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Scobe">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmark)}" xlink:href="${pngToDataUri(wordmark)}"/>
</svg>
`
const logoLight = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Scobe">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmark)}" xlink:href="${pngToDataUri(wordmark)}"/>
</svg>
`
const logoDark = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${wordmark.width} ${wordmark.height}" role="img" aria-label="Scobe">
  <image width="${wordmark.width}" height="${wordmark.height}" href="${pngToDataUri(wordmarkWhite)}" xlink:href="${pngToDataUri(wordmarkWhite)}"/>
</svg>
`
const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" role="img" aria-label="Scobe">
  <image width="256" height="256" href="${pngToDataUri(icon256)}" xlink:href="${pngToDataUri(icon256)}"/>
</svg>
`
const iconSvg = faviconSvg

fs.writeFileSync(path.join(assets, 'vanta-logo.svg'), logoSvg)
fs.writeFileSync(path.join(assets, 'vanta-logo-light.svg'), logoLight)
fs.writeFileSync(path.join(assets, 'vanta-logo-dark.svg'), logoDark)
fs.writeFileSync(path.join(pub, 'favicon.svg'), faviconSvg)
fs.writeFileSync(path.join(site, 'favicon.svg'), faviconSvg)
fs.writeFileSync(path.join(resources, 'icon.svg'), iconSvg)

fs.writeFileSync(
  path.join(assets, 'logo-meta.json'),
  JSON.stringify({ wordmark: { width: wordmark.width, height: wordmark.height, aspect }, mark: { width: mark.width, height: mark.height, aspect: markAspect } }, null, 2)
)

console.log('Wrote logo + favicon assets', { aspect, markAspect })
