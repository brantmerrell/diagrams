// Generates Open Graph / Twitter Card link-preview pages for every
// diagram, every layer of every multi-layer diagram, and both light/dark
// themes of each.
//
// Social crawlers (Facebook, LinkedIn, Twitter/X) fetch a URL's raw HTML
// and read <meta property="og:image"> etc. straight out of it — they never
// run JavaScript, and none of them accept SVG for a preview image (raster
// only). A static host (GitHub Pages) also can't vary a response by query
// string, only by path — so a diagram+layer+theme combination is only
// previewable if it has its own real file at its own path. See
// splitLayerFromPathname in src/lib/yamlExtract.ts for the matching path
// scheme the app itself reads (`/tech/foo.d2/1_pattern/dark`) — theme lives
// there rather than in `?theme=` for exactly this reason.
//
// For every diagram this renders one PNG per layer per theme via the d2 CLI
// (needs Chromium — see the `echo y |` warm-up in the "Compile d2 files to
// SVG" step) and writes a small HTML page at
// dist/<diagram-path>[/<layer>]/<theme>/index.html: a copy of the built
// index.html with per-page <meta> tags injected, so a crawler gets the right
// preview and a real browser still boots the full interactive app at exactly
// that diagram+layer+theme. The default layer's light-theme page is
// additionally written to the diagram's own fully bare path (no layer, no
// theme segment) — the URL a raw bookmark or manually typed link hits before
// the app has a chance to self-stamp its own layer/theme into the address bar.
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

// Strip the root template's own generic og:/twitter: tags (and the comment
// introducing them — see index.html) before injecting per-page ones below.
// Leaving both sets in the document let a crawler that takes the first
// occurrence of each og:/twitter: property (Twitter/X does) show the
// generic site-wide fallback instead of the diagram's own preview, even
// though the diagram-specific tags were present further down the page.
const indexTemplate = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8')
  .replace(/\s*<!--[\s\S]*?Site-wide fallback[\s\S]*?-->\n?/, '')
  .replace(/\s*<meta (?:property="og:|name="twitter:)[^>]*>\n?/g, '')

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

// d2 PNG rendering launches a fresh headless-Chromium process per call — on a
// resource-constrained CI runner, rendering ~200 of these back-to-back hits
// occasional Chromium crashes unrelated to the diagram itself (verified: every
// diagram that failed in a real run rendered fine when retried locally). One
// retry absorbs that flakiness instead of leaving the diagram without a
// preview image for the whole deploy.
const MAX_ATTEMPTS = 2

// d2's PNG export rejects --dark-theme outright ("cannot be used while
// exporting to another format other than .svg") — that flag only affects the
// @media(prefers-color-scheme:dark) block a browser picks between at view
// time, which a static raster can't do. A dark preview instead has to be a
// full alternate render using --theme with a self-contained dark preset.
// This isn't the same palette as the app's own automatic dark-mode rewrite
// (see svgTheme.ts) — just the closest good-faith dark rendering d2's PNG
// path can produce on its own.
const DARK_THEME_ID = 200 // "Dark Mauve" — see `d2 themes`

function renderPreviewPng(d2Args, d2File, pngAbsPath, urlPath) {
  let lastErr
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      execFileSync('d2', [...d2Args, d2File, pngAbsPath], { stdio: 'pipe', encoding: 'utf8' })
      return true
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`preview render failed for ${urlPath} (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`)
      }
    }
  }
  // With encoding: 'utf8', a failed execFileSync's err.stderr is d2/Chromium's
  // actual error text. Logging only err.message (the old behavior) prints
  // just "Command failed: <cmd>" — the wrapper's own message, no diagnostic
  // content at all.
  const detail = (lastErr.stderr || lastErr.message || '').toString().trim()
  console.warn(`preview render failed for ${urlPath} after ${MAX_ATTEMPTS} attempts:\n${detail}`)
  return false
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
    const layerUrlPath = layer ? `${relD2}/${layer}` : relD2
    const target = layer && layer !== 'base' ? `--target=layers.${layer}` : '--target='

    const bareTitle = summary.title || diagramName
    // Title skips the layer name for the bare-path fallback below: nobody
    // sharing the plain link cares that the default view happens to be
    // internally named "0_base".
    const title = layer ? `${bareTitle} — ${layer}` : bareTitle
    const description = summary.body || `A d2 diagram: ${relD2}`

    for (const theme of ['light', 'dark']) {
      const urlPath = `${layerUrlPath}/${theme}`
      const pngUrlPath = `/${urlPath}/preview.png`
      const pngAbsPath = path.join(distDir, urlPath, 'preview.png')
      fs.mkdirSync(path.dirname(pngAbsPath), { recursive: true })

      const d2Args = theme === 'dark' ? [`--theme=${DARK_THEME_ID}`, target] : [target]
      if (!renderPreviewPng(d2Args, d2File, pngAbsPath, urlPath)) {
        failCount++
        continue
      }
      pngCount++

      writePreviewPage(urlPath, pngUrlPath, title, description)
      pageCount++

      // The default layer's light-theme page is also written to the
      // diagram's fully bare path (no layer, no theme segment) — see the
      // file header for why that path still needs its own preview.
      if (i === 0 && theme === 'light') {
        writePreviewPage(relD2, pngUrlPath, bareTitle, description)
        pageCount++
      }
    }
  })
}

console.log(`wrote ${pageCount} preview page(s), ${pngCount} preview image(s)${failCount ? `, ${failCount} failed` : ''}`)
