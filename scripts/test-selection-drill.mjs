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
const outfile = path.join(outDir, 'layoutEngine.mjs')
const bundle = spawnSync(
  process.execPath,
  [esbuildBin, path.join(root, 'src', 'shared', 'layoutEngine.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${outfile}`],
  { encoding: 'utf8' }
)
if (bundle.status !== 0) {
  console.error(bundle.stderr || bundle.stdout)
  process.exit(1)
}

const { resolveClickTarget, resolveDrillIn, defaultFrameLayout } = await import(pathToFileURL(outfile).href)

function base(partial) {
  return { pageId: 'p', x: 0, y: 0, width: 100, height: 50, name: partial.id, ...partial }
}

const outer = base({
  id: 'outer',
  type: 'frame',
  width: 400,
  height: 200,
  layout: { ...defaultFrameLayout(), mode: 'horizontal' }
})
const inner = base({
  id: 'inner',
  type: 'frame',
  parentId: 'outer',
  width: 200,
  height: 100,
  layout: { ...defaultFrameLayout(), mode: 'horizontal' }
})
const kid = base({ id: 'kid', type: 'rect', parentId: 'inner', width: 40, height: 40 })
const nodes = [outer, inner, kid]

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

assert('click kid → outer', resolveClickTarget(kid, nodes, []) === 'outer')
assert('click kid with outer selected → stay outer', resolveClickTarget(kid, nodes, ['outer']) === 'outer')
assert('drill from outer → inner', resolveDrillIn(kid, nodes, ['outer']) === 'inner')
assert('click kid with inner selected → stay inner', resolveClickTarget(kid, nodes, ['inner']) === 'inner')
assert('drill from inner → kid', resolveDrillIn(kid, nodes, ['inner']) === 'kid')
assert('drill at deepest → null', resolveDrillIn(kid, nodes, ['kid']) === null)
assert(
  'sibling click stays at depth',
  resolveClickTarget(base({ id: 'sib', type: 'rect', parentId: 'inner', width: 20, height: 20 }), [...nodes, base({ id: 'sib', type: 'rect', parentId: 'inner', width: 20, height: 20 })], ['kid']) === 'sib'
)

process.exit(failed ? 1 : 0)
