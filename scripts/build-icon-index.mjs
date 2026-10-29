// Writes resources/icons/lucide.json from lucide-react so the main process can draw any Lucide icon
// without shipping lucide-react. Run after upgrading lucide-react: `npm run icons`.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(root, 'node_modules', 'lucide-react', 'dist', 'esm', 'icons')
const outFile = join(root, 'resources', 'icons', 'lucide.json')

const files = readdirSync(iconsDir).filter((file) => file.endsWith('.mjs'))
const index = {}
for (const file of files) {
  const mod = await import(pathToFileURL(join(iconsDir, file)).href)
  const data = mod.__iconData
  if (!data?.name || !Array.isArray(data.node)) continue
  const nodes = data.node.map(([tag, attrs]) => {
    const { key: _key, ...rest } = attrs || {}
    return [tag, rest]
  })
  index[data.name] = data.aliases?.length ? { n: nodes, a: data.aliases } : { n: nodes }
}

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, JSON.stringify(index))
console.log(`Wrote ${Object.keys(index).length} Lucide icons to ${outFile}`)
