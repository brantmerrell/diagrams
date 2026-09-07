// Generates Open Graph / Twitter Card link-preview pages for every
// diagram (and every layer of every multi-layer diagram).
//
// Social crawlers (Facebook, LinkedIn, Twitter/X) fetch a URL's raw HTML
// and read <meta property="og:image"> etc. straight out of it — they never
// run JavaScript, and none of them accept SVG for a preview image (raster
// only). A static host (GitHub Pages) also can't vary a response by query
// string, only by path — so a diagram+layer combination is only previewable
// if it has its own real file at its own path. See splitLayerFromPathname
// in src/lib/yamlExtract.ts for the matching path scheme the app itself
// reads (`/tech/foo.d2/1_pattern`).
//
// For every diagram this renders one PNG per layer via the d2 CLI (needs
// Chromium — see the `echo y |` warm-up in the "Compile d2 files to SVG"
// step) and writes a small HTML page at dist/<diagram-path>[/<layer>]/index.html:
// a copy of the built index.html with per-page <meta> tags injected, so a
// crawler gets the right preview and a real browser still boots the full
// interactive app at exactly that diagram+layer. The default/first layer's
// page is additionally written to the diagram's own bare path, since that's
// the URL most people will actually share.
//
// Must run after `vite build` (needs dist/index.html as the template) and
// after build-scenario-manifests.mjs (a diagram's own scenarios.json is how
// this script knows which layers it has).
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { walkD2Files } from './lib/tags.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const siteUrl = 'https://diagrams.jbm.eco'

const indexTemplate = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Best-effort: pull a title/description out of a diagram's first markdown
// context block (`context: |md\n  ## Title\n  body...\n|`), if it has one.
function truncateAtWord(s, maxLen) {
  if (s.length <= maxLen) return s
  const cut = s.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}

function extractSummary(d2Source) {
  const m = /context:\s*\|md\s*\n([\s\S]*?)\n\s*\|/.exec(d2Source)
  if (!m) return {}
  const lines = m[1].split('\n').map(l => l.trim().replace(/\\$/, '').trim()).filter(Boolean)
  const title = lines.find(l => l.startsWith('#'))?.replace(/^#+\s*/, '')
  const body = truncateAtWord(lines.filter(l => !l.startsWith('#')).join(' '), 200)
  return { title, body }
}

function writePreviewPage(urlPath, pngUrlPath, title, description) {
  const outDir = path.join(distDir, urlPath)
  fs.mkdirSync(outDir, { recursive: true })
  const meta = `
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${siteUrl}${pngUrlPath}" />
    <meta property="og:url" content="${siteUrl}/${urlPath}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${siteUrl}${pngUrlPath}" /></head>`
  fs.writeFileSync(path.join(outDir, 'index.html'), indexTemplate.replace('</head>', meta))
}

let pageCount = 0
let pngCount = 0
let failCount = 0

for (const d2File of walkD2Files(root)) {
  // tags.d2 defines the quality-tag vocabulary rather than being a diagram
  // itself (see scripts/lib/tags.mjs) — skip it here for the same reason.
  if (path.basename(d2File) === 'tags.d2') continue
  const relD2 = path.relative(root, d2File).replace(/\\/g, '/') // e.g. tech/foo/bar.d2
  const diagramName = path.basename(d2File, '.d2')
  const summary = extractSummary(fs.readFileSync(d2File, 'utf8'))

  const scenarioDir = d2File.replace(/\.d2$/, '')
  const manifestPath = path.join(scenarioDir, 'scenarios.json')
  const scenarios = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scenarios
    : null

  // null layer = single-board diagram, rendered once at the bare diagram path
  const layers = scenarios && scenarios.length ? scenarios.map(s => s.name) : [null]

  layers.forEach((layer, i) => {
    const urlPath = layer ? `${relD2}/${layer}` : relD2
    const pngUrlPath = `/${urlPath}/preview.png`
    const pngAbsPath = path.join(distDir, urlPath, 'preview.png')
    fs.mkdirSync(path.dirname(pngAbsPath), { recursive: true })

    const target = layer && layer !== 'base' ? `--target=layers.${layer}` : '--target='
    try {
      execFileSync('d2', [target, d2File, pngAbsPath], { stdio: 'pipe' })
      pngCount++
    } catch (err) {
      console.warn(`preview render failed for ${urlPath}: ${err.message.split('\n')[0]}`)
      failCount++
      return
    }

    const bareTitle = summary.title || diagramName
    const title = layer ? `${bareTitle} — ${layer}` : bareTitle
    const description = summary.body || `A d2 diagram: ${relD2}`

    writePreviewPage(urlPath, pngUrlPath, title, description)
    pageCount++

    // The first/default layer's page is also the diagram's own bare-path
    // preview — that's the URL most people will actually share. Its title
    // skips the layer name: nobody sharing the plain link cares that the
    // default view happens to be internally named "0_base".
    if (i === 0 && layer) {
      writePreviewPage(relD2, pngUrlPath, bareTitle, description)
      pageCount++
    }
  })
}

console.log(`wrote ${pageCount} preview page(s), ${pngCount} preview image(s)${failCount ? `, ${failCount} failed` : ''}`)
