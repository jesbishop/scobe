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
const outfile = path.join(outDir, 'layoutEngine-fill-modes.mjs')

const bundle = spawnSync(
  esbuildBin,
  [
    path.join(root, 'src', 'shared', 'layoutEngine.ts'),
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

const { allowChildFill, layoutSizeModes } = await import(pathToFileURL(outfile).href)

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

const parent = { id: 'p', type: 'frame', x: 0, y: 0, width: 200, height: 100, pageId: 'page' }
const section = { id: 's', type: 'section', x: 0, y: 0, width: 400, height: 300, pageId: 'page' }

assert('root has no fill', allowChildFill(null) === false)
assert('undefined parent has no fill', allowChildFill(undefined) === false)
assert('child of frame allows fill', allowChildFill(parent) === true)
assert('child of section allows fill', allowChildFill(section) === true)
assert('absolute child denies fill', allowChildFill(parent, { layoutAbsolute: true }) === false)
assert('non-absolute child allows fill', allowChildFill(parent, { layoutAbsolute: false }) === true)

assert(
  'nested child modes include fill for W/H',
  JSON.stringify(
    layoutSizeModes({ showResizing: true, allowFill: true })
  ) === JSON.stringify(['fixed', 'hug', 'fill', 'relative'])
)

assert(
  'root flex frame modes are fixed/hug only',
  JSON.stringify(
    layoutSizeModes({ showResizing: true, allowFill: false, hasFlexFrame: true })
  ) === JSON.stringify(['fixed', 'hug'])
)

assert(
  'nested flex frame modes include fill',
  JSON.stringify(
    layoutSizeModes({ showResizing: true, allowFill: true, hasFlexFrame: true })
  ) === JSON.stringify(['fixed', 'hug', 'fill', 'relative'])
)

assert(
  'nested text modes include fill',
  JSON.stringify(
    layoutSizeModes({ showResizing: true, allowFill: true, textMode: true })
  ) === JSON.stringify(['fixed', 'hug', 'fill'])
)

assert(
  'root text modes exclude fill',
  JSON.stringify(
    layoutSizeModes({ showResizing: true, allowFill: false, textMode: true })
  ) === JSON.stringify(['fixed', 'hug'])
)

assert(
  'no resizing → fixed only',
  JSON.stringify(layoutSizeModes({ showResizing: false, allowFill: true })) ===
    JSON.stringify(['fixed'])
)

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nAll child fill sizing checks passed')
