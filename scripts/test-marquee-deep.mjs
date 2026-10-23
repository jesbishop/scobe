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

const { marqueeSelectIds, defaultFrameLayout } = await import(pathToFileURL(outfile).href)

function base(partial) {
  return { pageId: 'p', x: 0, y: 0, width: 100, height: 50, name: partial.id, ...partial }
}

const outer = base({
  id: 'outer',
  type: 'frame',
  x: 0,
  y: 0,
  width: 400,
  height: 800,
  layout: { ...defaultFrameLayout(), mode: 'vertical' }
})
const kid = base({ id: 'kid', type: 'rect', parentId: 'outer', x: 40, y: 40, width: 120, height: 48 })
const nodes = [outer, kid]

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

// Partial deep marquee over kid only — must NOT select outer
{
  const hits = marqueeSelectIds(nodes, { x: 20, y: 20, width: 160, height: 90 }, { deep: true })
  assert('deep partial → kid only', hits.length === 1 && hits[0] === 'kid', hits)
}

// Full enclose outer — select outer (kid pruned)
{
  const hits = marqueeSelectIds(nodes, { x: -10, y: -10, width: 420, height: 820 }, { deep: true })
  assert('deep full outer → outer only', hits.length === 1 && hits[0] === 'outer', hits)
}

// Without deep, partial over outer selects top-level outer
{
  const hits = marqueeSelectIds(nodes, { x: 20, y: 20, width: 160, height: 90 }, { deep: false })
  assert('shallow partial → outer', hits.length === 1 && hits[0] === 'outer', hits)
}

process.exit(failed ? 1 : 0)
