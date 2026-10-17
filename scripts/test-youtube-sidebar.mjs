/**
 * Verify YouTube homepage canvas factory: nesting, chips, grid, Fill sizing.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'scripts', '.layout-test-out')
const require = createRequire(path.join(root, 'package.json'))
const esbuildBin = require.resolve('esbuild/bin/esbuild')

fs.mkdirSync(outDir, { recursive: true })
const outfile = path.join(outDir, 'youtubeSidebar.mjs')

const bundle = spawnSync(
  esbuildBin,
  [
    path.join(root, 'src', 'shared', 'youtubeSidebar.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outfile=${outfile}`
  ],
  { encoding: 'utf8' }
)
if (bundle.status !== 0) {
  console.error(bundle.stderr || bundle.stdout)
  process.exit(1)
}

const {
  buildYoutubeHomepageNodes,
  buildYoutubeSidebarNodes,
  youtubeHomepageRootId,
  youtubeSidebarRootId,
  youtubeSidebarId,
  youtubeChipsId,
  youtubeGridId
} = await import(pathToFileURL(outfile).href)

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

const nodes = buildYoutubeHomepageNodes({
  x: 40,
  y: 40,
  width: 1440,
  height: 900,
  idFactory: (() => {
    let n = 0
    return () => `t${++n}`
  })()
})

const byName = (name) => nodes.find((n) => n.name === name)
const artboard = byName('YouTube — Home')
const sidebar = byName('YouTube Sidebar')
const main = byName('Main')
const topBar = byName('Top bar')
const content = byName('Content')
const chips = byName('Chips')
const grid = byName('Video grid')
const homeNav = byName('Nav — Home')
const allChip = byName('Chip — All')

assert('artboard exists', Boolean(artboard))
assert('sidebar exists', Boolean(sidebar))
assert('top bar exists', Boolean(topBar))
assert('chips exists', Boolean(chips))
assert(
  'helpers resolve ids',
  youtubeHomepageRootId(nodes) === artboard?.id &&
    youtubeSidebarId(nodes) === sidebar?.id &&
    youtubeChipsId(nodes) === chips?.id &&
    youtubeGridId(nodes) === grid?.id
)
assert('sidebar alias matches homepage', youtubeSidebarRootId(nodes) === artboard?.id)
assert(
  'sidebar alias builds same shell',
  buildYoutubeSidebarNodes({ idFactory: () => 'alias' }).some((n) => n.name === 'Chips')
)

assert('sidebar nested under artboard', sidebar?.parentId === artboard?.id, sidebar?.parentId)
assert('main nested under artboard', main?.parentId === artboard?.id, main?.parentId)
assert('top bar nested under main', topBar?.parentId === main?.id, topBar?.parentId)
assert('content nested under main', content?.parentId === main?.id, content?.parentId)
assert('chips nested under content', chips?.parentId === content?.id, chips?.parentId)
assert('grid nested under content', grid?.parentId === content?.id, grid?.parentId)
assert('nav nested under sidebar', homeNav?.parentId === sidebar?.id, homeNav?.parentId)
assert('All chip nested under chips', allChip?.parentId === chips?.id, allChip?.parentId)

assert('artboard is horizontal', artboard?.layout?.mode === 'horizontal')
assert('sidebar is vertical', sidebar?.layout?.mode === 'vertical')
assert('main fills width', main?.layoutSizingH === 'fill')
assert('main fills height', main?.layoutSizingV === 'fill')
assert('sidebar fills height', sidebar?.layoutSizingV === 'fill')
assert('sidebar fixed width', sidebar?.layoutSizingH === 'fixed')
assert('content fills W/H', content?.layoutSizingH === 'fill' && content?.layoutSizingV === 'fill')
assert('chips fill width', chips?.layoutSizingH === 'fill')
assert('grid fills W/H', grid?.layoutSizingH === 'fill' && grid?.layoutSizingV === 'fill')
assert('nav item fills width', homeNav?.layoutSizingH === 'fill')
assert('search fills top bar', byName('Search')?.layoutSizingH === 'fill')

assert('sidebar height fills artboard', Math.abs((sidebar?.height || 0) - 900) < 1, sidebar?.height)
assert(
  'main width fills remainder',
  Math.abs((main?.width || 0) - (1440 - (sidebar?.width || 0))) < 1,
  main?.width
)
assert('main height fills artboard', Math.abs((main?.height || 0) - 900) < 1, main?.height)

const chipFrames = nodes.filter((n) => String(n.name || '').startsWith('Chip — '))
assert('has filter chips', chipFrames.length === 9, chipFrames.length)

const videos = nodes.filter((n) => /^Video \d+$/.test(String(n.name || '')))
assert('has eight video cards', videos.length === 8, videos.length)

const thumbs = nodes.filter((n) => /^Thumb \d+$/.test(String(n.name || '')))
assert('has video thumbs', thumbs.length === 8, thumbs.length)
assert(
  'thumb fills card width',
  thumbs.every((t) => t.layoutSizingH === 'fill'),
  thumbs.map((t) => t.layoutSizingH).join(',')
)

const metaRows = nodes.filter((n) => String(n.name || '').startsWith('Meta '))
assert('cards have meta rows', metaRows.length === 8, metaRows.length)
assert(
  'meta fills card width',
  metaRows.every((m) => m.layoutSizingH === 'fill'),
  metaRows.map((m) => m.layoutSizingH).join(',')
)

if (failed) {
  console.error(`\n${failed} failure(s)`)
  process.exit(1)
}
console.log('\nAll YouTube homepage checks passed.')
