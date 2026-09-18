const fs = require('fs')
const path = require('path')

const src = path.join(process.env.TEMP || '/tmp', 'gf-meta.json')
const out = path.join(__dirname, '..', 'src', 'renderer', 'data', 'googleFonts.json')

const raw = fs.readFileSync(src, 'utf8').replace(/^\)\]\}'\r?\n?/, '')
const data = JSON.parse(raw)
const list = (data.familyMetadataList || [])
  .map((f) => ({
    family: f.family,
    category: f.category || 'Sans Serif',
    variants: Object.keys(f.fonts || {}),
    axes: (f.axes || []).map((a) => a.tag),
    popularity: f.popularity ?? 9999
  }))
  .sort((a, b) => a.popularity - b.popularity || a.family.localeCompare(b.family))

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ version: 1, fonts: list }))
console.log(`Wrote ${list.length} fonts → ${out} (${fs.statSync(out).size} bytes)`)
