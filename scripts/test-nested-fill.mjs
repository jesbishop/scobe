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

const { reflowAutoLayout, defaultFrameLayout } = await import(pathToFileURL(outfile).href)

function base(partial) {
  return {
    pageId: 'p',
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    name: partial.id,
    ...partial
  }
}

let failed = 0
function assert(name, cond, detail) {
  if (cond) console.log('PASS', name)
  else {
    failed++
    console.log('FAIL', name, detail ?? '')
  }
}

{
  const outer = base({
    id: 'outer',
    type: 'frame',
    width: 400,
    height: 200,
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'fixed',
      sizingV: 'fixed',
      gap: 0,
      padding: 0
    }
  })
  const inner = base({
    id: 'inner',
    type: 'frame',
    parentId: 'outer',
    width: 80,
    height: 40,
    layoutSizingH: 'fill',
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'fixed',
      sizingV: 'hug',
      gap: 8,
      padding: 10
    }
  })
  const kid = base({
    id: 'kid',
    type: 'rect',
    parentId: 'inner',
    width: 60,
    height: 30,
    layoutSizingH: 'fill'
  })
  const sibling = base({
    id: 'sib',
    type: 'rect',
    parentId: 'outer',
    width: 100,
    height: 40
  })

  const result = reflowAutoLayout([outer, inner, kid, sibling])
  const byId = Object.fromEntries(result.map((n) => [n.id, n]))
  console.log('case1', {
    inner: { w: byId.inner.width, h: byId.inner.height },
    kid: { w: byId.kid.width, h: byId.kid.height }
  })
  assert('inner fills remaining width (300)', Math.abs(byId.inner.width - 300) < 1, byId.inner.width)
  assert('inner hugs child height (50)', Math.abs(byId.inner.height - 50) < 1, byId.inner.height)
  assert('kid fills inner content width (280)', Math.abs(byId.kid.width - 280) < 1, byId.kid.width)
}

{
  const outer = base({
    id: 'outer',
    type: 'frame',
    width: 200,
    height: 300,
    layout: {
      ...defaultFrameLayout(),
      mode: 'vertical',
      sizingH: 'fixed',
      sizingV: 'fixed',
      gap: 0,
      padding: 0
    }
  })
  const inner = base({
    id: 'inner',
    type: 'frame',
    parentId: 'outer',
    width: 50,
    height: 40,
    layoutSizingH: 'fill',
    layoutSizingV: 'fill',
    layout: {
      ...defaultFrameLayout(),
      mode: 'vertical',
      sizingH: 'fixed',
      sizingV: 'fixed',
      gap: 0,
      padding: 0
    }
  })
  const kid = base({
    id: 'kid',
    type: 'rect',
    parentId: 'inner',
    width: 40,
    height: 20,
    layoutSizingH: 'fill',
    layoutSizingV: 'fill'
  })
  const result = reflowAutoLayout([outer, inner, kid])
  const byId = Object.fromEntries(result.map((n) => [n.id, n]))
  console.log('case2', {
    inner: { w: byId.inner.width, h: byId.inner.height },
    kid: { w: byId.kid.width, h: byId.kid.height }
  })
  assert('inner fills outer width', Math.abs(byId.inner.width - 200) < 1, byId.inner.width)
  assert('inner fills outer height', Math.abs(byId.inner.height - 300) < 1, byId.inner.height)
  assert('kid fills nested width', Math.abs(byId.kid.width - 200) < 1, byId.kid.width)
  assert('kid fills nested height', Math.abs(byId.kid.height - 300) < 1, byId.kid.height)
}

{
  const outer = base({
    id: 'outer',
    type: 'frame',
    width: 400,
    height: 200,
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'fixed',
      sizingV: 'fixed',
      gap: 0,
      padding: 20
    }
  })
  const inner = base({
    id: 'inner',
    type: 'frame',
    parentId: 'outer',
    width: 50,
    height: 40,
    layoutSizingH: 'relative',
    layoutPercentH: 50,
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'fixed',
      sizingV: 'hug',
      gap: 0,
      padding: 0
    }
  })
  const kid = base({ id: 'kid', type: 'rect', parentId: 'inner', width: 30, height: 24 })
  const result = reflowAutoLayout([outer, inner, kid])
  const byId = Object.fromEntries(result.map((n) => [n.id, n]))
  console.log('case3', { innerW: byId.inner.width })
  assert('relative 50% of parent content', Math.abs(byId.inner.width - 180) < 1, byId.inner.width)
}

// Paper screenshot case: nested flex W=Fill H=Fit inside horizontal parent
{
  const outer = base({
    id: 'outer',
    type: 'frame',
    width: 320,
    height: 180,
    layout: {
      ...defaultFrameLayout(),
      mode: 'vertical',
      sizingH: 'fixed',
      sizingV: 'fixed',
      gap: 8,
      padding: 12
    }
  })
  const row = base({
    id: 'row',
    type: 'frame',
    parentId: 'outer',
    width: 40,
    height: 20,
    layoutSizingH: 'fill',
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'fixed',
      sizingV: 'hug',
      gap: 6,
      padding: 0
    }
  })
  const a = base({ id: 'a', type: 'rect', parentId: 'row', width: 48, height: 24 })
  const b = base({ id: 'b', type: 'rect', parentId: 'row', width: 48, height: 24, layoutSizingH: 'fill' })
  const result = reflowAutoLayout([outer, row, a, b])
  const byId = Object.fromEntries(result.map((n) => [n.id, n]))
  // outer content = 320-24 = 296
  console.log('case4', {
    row: { w: byId.row.width, h: byId.row.height },
    a: { w: byId.a.width },
    b: { w: byId.b.width }
  })
  assert('paper: row fills parent content width', Math.abs(byId.row.width - 296) < 1, byId.row.width)
  assert('paper: row hugs row height', Math.abs(byId.row.height - 24) < 1, byId.row.height)
  assert('paper: fill sibling takes leftover', Math.abs(byId.b.width - (296 - 48 - 6)) < 1, byId.b.width)
}

// Parent Fit collapses to Fixed when a child is Fill
{
  const outer = base({
    id: 'outer',
    type: 'frame',
    width: 200,
    height: 100,
    layout: {
      ...defaultFrameLayout(),
      mode: 'horizontal',
      sizingH: 'hug',
      sizingV: 'hug',
      gap: 0,
      padding: 0
    }
  })
  const kid = base({
    id: 'kid',
    type: 'rect',
    parentId: 'outer',
    width: 50,
    height: 40,
    layoutSizingH: 'fill'
  })
  const result = reflowAutoLayout([outer, kid])
  const byId = Object.fromEntries(result.map((n) => [n.id, n]))
  console.log('case5', {
    outer: { w: byId.outer.width, sizingH: byId.outer.layout?.sizingH },
    kid: { w: byId.kid.width }
  })
  assert('fill child forces parent hug→fixed on axis', byId.outer.layout?.sizingH === 'fixed', byId.outer.layout?.sizingH)
  assert('fill child keeps parent fixed width', Math.abs(byId.outer.width - 200) < 1, byId.outer.width)
  assert('fill child expands to parent width', Math.abs(byId.kid.width - 200) < 1, byId.kid.width)
}

process.exit(failed ? 1 : 0)
