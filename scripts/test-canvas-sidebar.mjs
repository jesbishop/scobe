/**
 * Verify focused canvas sidebar factory: nesting + Fill sizing after reflow.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const outDir = path.join(projectRoot, 'scripts', '.layout-test-out')
const require = createRequire(path.join(projectRoot, 'package.json'))
const esbuildBin = require.resolve('esbuild/bin/esbuild')

fs.mkdirSync(outDir, { recursive: true })
const outfile = path.join(outDir, 'canvasSidebar.mjs')

const bundle = spawnSync(
  esbuildBin,
  [
    path.join(projectRoot, 'src', 'shared', 'canvasSidebar.ts'),
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
  buildSidebarNodes,
  canvasSidebarRootId,
  canvasSidebarId,
  canvasSidebarMainId
} = await import(pathToFileURL(outfile).href)

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

const nodes = buildSidebarNodes({
  x: 20,
  y: 20,
  width: 800,
  height: 500,
  sidebarWidth: 220,
  name: 'Demo shell',
  items: ['Home', 'Search', 'Profile'],
  idFactory: (() => {
    let n = 0
    return () => `c${++n}`
  })()
})

const byName = (name) => nodes.find((n) => n.name === name)
const artboard = byName('Demo shell')
const sidebar = byName('Sidebar')
const main = byName('Main')
const homeNav = byName('Nav — Home')

assert('artboard exists', Boolean(artboard))
assert('sidebar exists', Boolean(sidebar))
assert('main exists', Boolean(main))
assert(
  'helpers resolve ids',
  canvasSidebarRootId(nodes) === artboard?.id &&
    canvasSidebarId(nodes) === sidebar?.id &&
    canvasSidebarMainId(nodes) === main?.id
)

assert('sidebar nested under artboard', sidebar?.parentId === artboard?.id, sidebar?.parentId)
assert('main nested under artboard', main?.parentId === artboard?.id, main?.parentId)
assert('nav nested under sidebar', homeNav?.parentId === sidebar?.id, homeNav?.parentId)

assert('artboard is horizontal', artboard?.layout?.mode === 'horizontal')
assert('sidebar is vertical', sidebar?.layout?.mode === 'vertical')
assert('sidebar fixed width', sidebar?.layoutSizingH === 'fixed')
assert('sidebar fills height', sidebar?.layoutSizingV === 'fill')
assert('main fills W/H', main?.layoutSizingH === 'fill' && main?.layoutSizingV === 'fill')
assert('nav fills width', homeNav?.layoutSizingH === 'fill')
assert('header fills width', byName('Sidebar header')?.layoutSizingH === 'fill')

assert('sidebar height fills artboard', Math.abs((sidebar?.height || 0) - 500) < 1, sidebar?.height)
assert(
  'main width fills remainder',
  Math.abs((main?.width || 0) - (800 - (sidebar?.width || 0))) < 1,
  main?.width
)
assert('main height fills artboard', Math.abs((main?.height || 0) - 500) < 1, main?.height)

const navs = nodes.filter((n) => String(n.name || '').startsWith('Nav — '))
assert('custom nav items', navs.length === 3, navs.length)

if (failed) {
  console.error(`\n${failed} failure(s)`)
  process.exit(1)
}
console.log('\nAll canvas sidebar checks passed.')
