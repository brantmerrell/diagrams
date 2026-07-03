// Writes a scenarios.json manifest into each multi-board d2 output directory
// (e.g. manual/hi/seq_frontend/), mirroring the /api/manual/scenarios response
// shape from server.js. Static deployments (GitHub Pages) have no API, so the
// frontend falls back to fetching this manifest to discover layer/scenario SVGs.
// Run after compiling .d2 files, before copying manual/ into dist/.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manualDir = path.join(root, 'manual')

function* walkD2Files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walkD2Files(full)
    else if (entry.name.endsWith('.d2')) yield full
  }
}

let count = 0
for (const d2File of walkD2Files(manualDir)) {
  const scenarioDir = d2File.replace(/\.d2$/, '')
  if (!fs.existsSync(scenarioDir) || !fs.statSync(scenarioDir).isDirectory()) continue

  const svgFiles = fs.readdirSync(scenarioDir)
    .filter(f => f.endsWith('.svg'))
    .sort((a, b) => {
      if (a === 'index.svg') return -1
      if (b === 'index.svg') return 1
      return a.localeCompare(b)
    })

  if (svgFiles.length === 0) continue

  const basePath = '/' + path.relative(root, scenarioDir).replace(/\\/g, '/')
  const manifest = {
    scenarios: svgFiles.map(f => ({
      name: f === 'index.svg' ? 'base' : f.replace('.svg', ''),
      path: `${basePath}/${f}`,
    })),
  }

  fs.writeFileSync(path.join(scenarioDir, 'scenarios.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`wrote ${path.relative(root, scenarioDir)}/scenarios.json (${svgFiles.length} scenarios)`)
  count++
}

console.log(count ? `${count} manifest(s) written` : 'no scenario directories found')
