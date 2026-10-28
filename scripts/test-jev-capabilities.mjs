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
const outfile = path.join(outDir, 'jevCapabilities.mjs')
const bundle = spawnSync(
  process.execPath,
  [esbuildBin, path.join(root, 'src', 'renderer', 'jevCapabilities.ts'), '--bundle', '--platform=node', '--format=esm', '--loader:.json=json', `--outfile=${outfile}`],
  { encoding: 'utf8' }
)
if (bundle.status !== 0) {
  console.error(bundle.stderr || bundle.stdout)
  process.exit(1)
}

const { matchCapabilities, applyProperties } = await import(pathToFileURL(outfile).href)

const commandsOut = path.join(outDir, 'jevCommands.mjs')
const commandsBundle = spawnSync(
  process.execPath,
  [esbuildBin, path.join(root, 'src', 'renderer', 'jevCommands.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${commandsOut}`],
  { encoding: 'utf8' }
)
if (commandsBundle.status !== 0) {
  console.error(commandsBundle.stderr || commandsBundle.stdout)
  process.exit(1)
}
const { matchCommand } = await import(pathToFileURL(commandsOut).href)

const text = { id: 't', type: 'text', x: 0, y: 0, width: 80, height: 20, text: 'Hello', fontSize: 16, pageId: 'p', parentId: 'f' }
const frame = { id: 'f', type: 'frame', x: 0, y: 0, width: 300, height: 200, pageId: 'p', radius: 4, fill: '#ffffff' }
const line = { id: 'l', type: 'line', x: 0, y: 0, width: 100, height: 0, pageId: 'p' }
const nodes = [frame, text, line]

/** phrase, node, expected capability ids, optional check on the patched node */
const cases = [
  ['line height 24', text, ['line_height'], (n) => n.lineHeight === 24],
  ['letter spacing 2%', text, ['letter_spacing'], (n) => n.letterSpacing === 2 && n.letterSpacingUnit === 'percent'],
  ['letter spacing 1px', text, ['letter_spacing'], (n) => n.letterSpacingUnit === 'px'],
  ['tighter tracking', text, ['letter_spacing'], (n) => n.letterSpacing === -1],
  ['font size 32', text, ['font_size'], (n) => n.fontSize === 32],
  ['make the text bigger', text, ['font_size'], (n) => n.fontSize === 18],
  ['make the font 4px bigger', text, ['font_size'], (n) => n.fontSize === 20],
  ['use Playfair Display', text, [], null],
  ['change the font to Playfair Display', text, ['font_family'], (n) => n.fontFamily === 'Playfair Display'],
  ['make it semi bold', text, ['font_weight'], (n) => n.fontWeight === 600],
  ['bold', text, ['font_weight'], (n) => n.fontWeight === 700],
  ['italic', text, ['italic'], (n) => n.fontStyle === 'italic'],
  ['underline it', text, ['text_decoration'], (n) => n.textDecoration === 'underline'],
  ['all caps', text, ['text_case'], (n) => n.textCase === 'upper'],
  ['center the text', text, ['text_align'], (n) => n.textAlign === 'center'],
  ['make the text white', text, ['text_color'], (n) => n.fill === '#ffffff'],
  ['opacity 50%', frame, ['opacity'], (n) => n.opacity === 0.5],
  ['opacity 0.3', frame, ['opacity'], (n) => n.opacity === 0.3],
  ['corner radius 12', frame, ['corner_radius'], (n) => n.radius === 12],
  ['top left corner 20', frame, ['corner_tl'], (n) => n.cornerRadii?.tl === 20 && n.cornerRadii?.br === 4],
  ['background blue', frame, ['fill_color'], (n) => n.fill === '#2563eb'],
  ['2px dashed red border', frame, ['stroke_color', 'stroke_width', 'stroke_style'], (n) => n.strokeWidth === 2 && n.stroke === '#dc2626' && n.strokeDash === 6],
  ['thicker border', { ...frame, strokeWidth: 2, stroke: '#000' }, ['stroke_width'], (n) => n.strokeWidth === 3],
  ['remove the border', { ...frame, strokeWidth: 2, stroke: '#000' }, ['stroke_remove'], (n) => n.strokeWidth === 0],
  ['add a border', frame, ['stroke_add'], (n) => n.strokeWidth === 1 && n.stroke === '#1A1A1A' && n.strokeAlign === 'inside'],
  ['add a stroke', text, ['stroke_add'], (n) => n.strokeWidth === 1],
  ['add a 2px stroke to the text', text, ['stroke_width'], (n) => n.strokeWidth === 2 && n.fontSize === 16],
  ['give it a red outline', text, ['stroke_color'], (n) => n.stroke === '#dc2626' && n.strokeWidth === 1],
  ['outside stroke', frame, ['stroke_align'], (n) => n.strokeAlign === 'outside' && n.strokeWidth === 1],
  ['border opacity 30%', { ...frame, strokeWidth: 2, stroke: '#000' }, ['stroke_opacity'], (n) => n.strokeOpacity === 0.3],
  ['make the line thicker', line, ['stroke_width'], (n) => n.strokeWidth === 3],
  ['line weight 4', line, ['stroke_width'], (n) => n.strokeWidth === 4],
  ['make it a dashed line', line, ['stroke_style'], (n) => n.strokeDash === 6],
  ['round line ends', line, ['stroke_cap'], (n) => n.strokeCap === 'round'],
  ['dotted border', frame, ['stroke_style'], (n) => n.strokeDash === 1 && n.strokeWidth === 1],
  ['border radius 8', frame, ['corner_radius'], (n) => n.radius === 8],
  ['add a shadow', frame, ['drop_shadow'], (n) => n.effects?.some((fx) => fx.type === 'DROP_SHADOW')],
  ['remove the shadow', { ...frame, shadow: true }, ['drop_shadow'], (n) => !n.effects?.length],
  ['shadow blur 30', frame, ['shadow_blur'], (n) => n.effects?.[0]?.radius === 30],
  ['blur 10', frame, ['layer_blur'], (n) => n.effects?.some((fx) => fx.type === 'LAYER_BLUR' && fx.radius === 10)],
  ['background blur 20', frame, ['background_blur'], (n) => n.effects?.some((fx) => fx.type === 'BACKGROUND_BLUR' && fx.radius === 20)],
  ['blend mode multiply', frame, ['blend_mode'], (n) => n.blendMode === 'Multiply'],
  ['rotate 45', frame, ['rotation'], (n) => n.rotation === 45],
  ['rotate it', frame, ['rotation'], (n) => n.rotation === 90],
  ['rotate it 30 degrees counterclockwise', frame, ['rotation'], (n) => n.rotation === -30],
  ['rotate left', frame, ['rotation'], (n) => n.rotation === -90],
  ['rotate 45 more', { ...frame, rotation: 45 }, ['rotation'], (n) => n.rotation === 90],
  ['set the angle to 15', { ...frame, rotation: 45 }, ['rotation'], (n) => n.rotation === 15],
  ['angle -30', frame, ['rotation'], (n) => n.rotation === -30],
  ['rotation to 0', { ...frame, rotation: 45 }, ['rotation'], (n) => n.rotation === 0],
  ['straighten it', { ...frame, rotation: 12 }, ['rotation'], (n) => n.rotation === 0],
  ['turn it upside down', frame, ['rotation'], (n) => n.rotation === 180],
  ['rotate 270', frame, ['rotation'], (n) => n.rotation === -90],
  ['tilt it a little', frame, ['rotation'], (n) => n.rotation === 15],
  ['rotate it clockwise', { ...frame, flipX: true }, ['rotation'], (n) => n.rotation === -90],
  ['turn it blue', frame, [], null],
  ['flip it horizontally', frame, ['flip_horizontal'], (n) => n.flipX === true],
  ['mirror it', frame, ['flip_horizontal'], (n) => n.flipX === true],
  ['flip it upside down', frame, ['flip_vertical'], (n) => n.flipY === true],
  ['flip vertically', text, ['flip_vertical'], (n) => n.flipY === true],
  ['add a shader', frame, ['shader'], (n) => n.fills?.[0]?.type === 'shader' && n.fills[0].shader === 'mesh-gradient'],
  ['add a liquid metal shader', frame, ['shader'], (n) => n.fills?.[0]?.shader === 'liquid-metal'],
  ['make it a blue and purple mesh gradient', frame, ['shader'], (n) => n.fills?.[0]?.shader === 'mesh-gradient' && n.fills[0].colors[0] === '#2563eb' && n.fills[0].colors[1] === '#9333ea'],
  ['add god rays', frame, ['shader'], (n) => n.fills?.[0]?.shader === 'god-rays'],
  ['static mesh shader', frame, ['shader'], (n) => n.fills?.[0]?.shader === 'static-mesh-gradient'],
  ['add a slow voronoi shader', frame, ['shader'], (n) => n.fills?.[0]?.shader === 'voronoi' && n.fills[0].speed === 0.3],
  ['add a dithering shader to the text', text, ['shader'], (n) => n.effects?.some((fx) => fx.type === 'SHADER' && fx.shader?.shader === 'dithering')],
  ['put a grain gradient shader on top as an overlay', frame, ['shader'], (n) => n.effects?.some((fx) => fx.type === 'SHADER' && fx.shader?.shader === 'grain-gradient') && n.fills?.[0]?.type !== 'shader'],
  ['pause the shader', { ...frame, fills: [{ type: 'shader', shader: 'warp', colors: ['#000'], params: {}, opacity: 1, speed: 1 }] }, ['shader_speed'], (n) => n.fills?.[0]?.speed === 0],
  ['make the shader faster', { ...frame, fills: [{ type: 'shader', shader: 'warp', colors: ['#000'], params: {}, opacity: 1, speed: 1 }] }, ['shader_speed'], (n) => n.fills?.[0]?.speed === 1.6],
  ['remove the shader', { ...frame, fills: [{ type: 'shader', shader: 'warp', colors: ['#000'], params: {}, opacity: 1, speed: 1 }] }, ['shader_remove'], (n) => !n.fills?.some((paint) => paint.type === 'shader')],
  ['unflip it', { ...frame, flipX: true, flipY: true }, ['flip_reset'], (n) => !n.flipX && !n.flipY],
  ['width 320', frame, ['width'], (n) => n.width === 320],
  ['make it 40px wider', frame, ['width'], (n) => n.width === 340],
  ['height 48', frame, ['height'], (n) => n.height === 48],
  ['padding 24', frame, ['layout_padding'], (n) => n.layout?.padding === 24],
  ['horizontal padding 16', frame, ['layout_padding'], (n) => n.layout?.padding?.l === 16 && n.layout?.padding?.t === 0],
  ['gap 12', frame, ['layout_gap'], (n) => n.layout?.gap === 12],
  ['make it a flexbox', frame, ['layout_direction'], (n) => n.layout?.mode === 'horizontal'],
  ['flexbox column', frame, ['layout_direction'], (n) => n.layout?.mode === 'vertical'],
  ['remove auto layout', { ...frame, layout: { mode: 'vertical' } }, ['layout_direction'], (n) => n.layout?.mode === 'none'],
  ['space between', frame, ['justify_content'], (n) => n.layout?.justifyContent === 'space-between'],
  ['hide it', frame, ['visible'], (n) => n.visible === false],
  ['lock it', frame, ['locked'], (n) => n.locked === true],
  ['clip content', frame, ['clip_content'], (n) => n.clipsContent === true],
  ['linear gradient from blue to purple', frame, ['fill_gradient'], (n) => n.fills?.[0]?.type === 'gradient' && n.fills[0].stops.length === 2],
  ['move it right 20', frame, ['nudge'], (n) => n.x === 20],
  ['flip it', frame, ['flip_horizontal'], (n) => n.flipX === true],
  ['rename the text to "Launch 2024"', text, [], null],
  ['make it blue', frame, [], null],
  ['make it bigger', frame, ['scale'], (n) => n.width === 375]
]

const rect = { id: 'r', type: 'rect', x: 10, y: 10, width: 120, height: 80, pageId: 'p', fill: '#ff0000' }
const square = { ...rect, width: 100, height: 100 }
const strokeEdit = { properties: ['stroke_add'], request: 'add a border' }
const thickEdit = { properties: ['stroke_width'], request: 'make the border 2px thicker' }
cases.push(
  ['make this bigger', frame, ['scale'], (n) => n.width === 375 && n.height === 250],
  ['a bit smaller', frame, ['scale'], (n) => n.width === 273 && n.height === 182],
  ['make it twice as big', rect, ['scale'], (n) => n.width === 240 && n.height === 160],
  ['make it bigger', text, ['scale'], (n) => n.fontSize === 20],
  ['make this wider', frame, ['width'], (n) => n.width === 375],
  ['taller', frame, ['height'], (n) => n.height === 250],
  ['a little narrower', frame, ['width'], (n) => n.width === 273],
  ['Set to Fill', text, ['width_sizing'], (n) => n.width === 300 && n.x === 0 && n.constraintH === 'left-right'],
  ['fill the container', text, ['width_sizing'], (n) => n.width === 300],
  ['hug contents', text, ['width_sizing'], (n) => n.textResize === 'auto-width'],
  ['fill it with blue', rect, ['fill_color'], null],
  ['make this square a circle', square, ['shape_type'], (n) => n.type === 'ellipse' && n.width === 100 && n.height === 100],
  ['turn it into a star', rect, ['shape_type'], (n) => n.type === 'star'],
  ['make it a triangle', { ...rect, type: 'ellipse' }, ['shape_type'], (n) => n.type === 'polygon' && n.polygonCount === 3],
  ['change this rectangle into a circle', rect, ['shape_type'], (n) => n.type === 'ellipse' && n.width === 80],
  ['make it a square', rect, ['shape_type'], (n) => n.type === 'rect' && n.width === 80 && n.height === 80],
  ['make the frame a circle', frame, ['shape_type'], (n) => n.type === 'frame' && n.width === 200 && n.radius === 100],
  ['make the corners square', frame, [], null],
  ['thicker', { ...frame, strokeWidth: 1, stroke: '#000' }, ['stroke_width'], (n) => n.strokeWidth === 2, strokeEdit],
  ['a bit more', { ...frame, strokeWidth: 3, stroke: '#000' }, ['stroke_width'], (n) => n.strokeWidth === 4, thickEdit],
  ['again', { ...frame, strokeWidth: 3, stroke: '#000' }, ['stroke_width'], (n) => n.strokeWidth === 5, thickEdit],
  ['make it more blue', frame, [], null, strokeEdit],
  ['thicker', frame, [], null]
)

let pass = 0
const failures = []
for (const [phrase, node, expected, check, last] of cases) {
  const got = matchCapabilities(phrase, node, last).map((edit) => edit.id).sort()
  const want = [...expected].sort()
  let ok = JSON.stringify(got) === JSON.stringify(want)
  let detail = ok ? '' : `matched ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`
  if (ok && check && got.length) {
    const graph = nodes.map((item) => (item.id === node.id ? node : item)).concat(nodes.some((item) => item.id === node.id) ? [] : [node])
    const res = applyProperties(matchCapabilities(phrase, node, last), [node], graph, phrase, (n) => n.id)
    const after = 'nodes' in res ? res.nodes.find((item) => item.id === node.id) : null
    if (!after || !check(after)) {
      ok = false
      detail = 'error' in res ? `apply error: ${res.error}` : `bad result: ${JSON.stringify(after).slice(0, 300)}`
    }
  }
  if (ok) pass += 1
  else failures.push(`  ✗ "${phrase}" — ${detail}`)
}

const image = { id: 'i', type: 'image', x: 0, y: 0, width: 200, height: 200, pageId: 'p' }
const two = [frame, { ...frame, id: 'f2' }]
/** phrase, selection, expected command id (or null) */
const commandCases = [
  ['duplicate this', [frame], 'duplicate'],
  ['make a copy', [frame], 'duplicate'],
  ['group these', two, 'group'],
  ['wrap them in auto layout', two, 'wrap_flex'],
  ['ungroup', [frame], 'ungroup'],
  ['bring it to the front', [frame], 'bring_front'],
  ['send to back', [frame], 'send_back'],
  ['align left', two, 'align_left'],
  ['align their tops', two, 'align_top'],
  ['align left', [frame], null],
  ['add a rectangle', [], 'create_rect'],
  ['make a red circle 80px', [], 'create_ellipse'],
  ['add a frame', [], 'create_frame'],
  ['add text saying "Hello"', [], 'create_text'],
  ['draw a star', [], 'create_star'],
  ['add a triangle', [], 'create_polygon'],
  ['undo', [], 'undo'],
  ['redo that', [], 'redo'],
  ['add a new page called Pricing', [], 'add_page'],
  ['go to page 2', [], 'go_to_page'],
  ['rename the page to Home', [], 'rename_page'],
  ['create an icon of a rocket', [], 'create_svg'],
  ['remove the background', [image], 'remove_background'],
  ['remove the background', [frame], null],
  ['vectorize it', [image], 'vectorize'],
  ['export as png', [frame], 'export'],
  ['open stripe.com', [], 'open_browser'],
  ['make it a square', [frame], null],
  ['line height 24', [text], null],
  ['center the text', [text], null],
  ['make it blue', [frame], null],
  ['add a text field', [frame], null],
  ['make the export button blue', [frame], null],
  ['make the group blue', [frame], null],
  ['change the text to visit example.com', [text], null],
  ['add a button with a circle icon', [frame], null]
]
for (const [phrase, selection, expected] of commandCases) {
  const got = matchCommand(phrase, selection)
  if (got === expected) pass += 1
  else failures.push(`  ✗ command "${phrase}" — got ${got}, wanted ${expected}`)
}

const total = cases.length + commandCases.length
console.log(`${pass}/${total} phrases correct`)
if (failures.length) {
  console.log(failures.join('\n'))
  process.exit(1)
}
