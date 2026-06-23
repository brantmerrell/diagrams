import express from 'express'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

// Serve SVG files from manual/ folder
app.use('/manual', express.static(path.join(__dirname, 'manual'), {
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml')
    }
  },
  extensions: ['svg']
}))

// Store active d2 watch processes
const watchProcesses = new Map()

// Store SSE clients for each diagram
const sseClients = new Map()

// Store SVG file watchers — started lazily when SSE clients connect (mirrors mmd pattern)
const svgWatchers = new Map()  // diagramPath → { watcher, timer }

app.post('/api/manual/watch', (req, res) => {
  const { diagramPath } = req.body

  if (!diagramPath) {
    return res.status(400).json({ error: 'diagramPath is required' })
  }

  // Kill existing process for this diagram if any
  if (watchProcesses.has(diagramPath)) {
    watchProcesses.get(diagramPath).kill()
    watchProcesses.delete(diagramPath)
  }

  // Remove leading slash and construct file path
  const filePath = diagramPath.startsWith('/') ? diagramPath.slice(1) : diagramPath
  const fullPath = path.join(__dirname, filePath)

  // Prevent path traversal - ensure path is within __dirname
  if (!fullPath.startsWith(__dirname + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  console.log('Starting d2 watch process')

  // Spawn d2 -w process with --browser 0 to prevent opening a new tab
  const d2Process = spawn('d2', ['-w', '--browser', '0', fullPath], {
    cwd: __dirname,
  })

  let stderrBuffer = ''

  const notifyClients = (message) => {
    const clients = sseClients.get(diagramPath) || []
    clients.forEach((client) => {
      client.write(`data: ${JSON.stringify(message)}\n\n`)
    })
  }

  d2Process.stdout.on('data', (data) => {
    console.log(`d2 [${diagramPath}]: ${data.toString()}`)
  })

  d2Process.stderr.on('data', (data) => {
    const output = data.toString()
    console.log(`d2 [${diagramPath}]: ${output}`)

    // d2 uses stderr for both info and errors
    stderrBuffer += output

    if (output.toLowerCase().includes('err') ||
        output.toLowerCase().includes('syntax') ||
        output.toLowerCase().includes('failed')) {
      notifyClients({
        type: 'error',
        message: 'D2 compilation error - check server logs for details',
        error: stderrBuffer.trim()
      })
    } else {
      stderrBuffer = ''
    }
  })

  d2Process.on('close', (code) => {
    console.log(`d2 process for ${diagramPath} exited with code ${code}`)
    if (code !== 0 && code !== null) {
      notifyClients({
        type: 'error',
        message: `D2 process exited with code ${code}`,
        error: stderrBuffer.trim()
      })
    }
    watchProcesses.delete(diagramPath)
  })

  watchProcesses.set(diagramPath, d2Process)

  res.json({ success: true, message: `Started watching ${diagramPath}` })
})

// SSE endpoint for diagram events — lazily starts an fs.watch on the SVG output file,
// mirroring the mmd pattern. This is authoritative: fires when d2 writes its SVG to disk.
app.get('/api/manual/events/:diagramPath(*)', (req, res) => {
  const diagramPath = '/' + req.params.diagramPath

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  if (!sseClients.has(diagramPath)) sseClients.set(diagramPath, [])
  sseClients.get(diagramPath).push(res)

  // Start watching the SVG output for this diagram if not already doing so
  if (!svgWatchers.has(diagramPath)) {
    const rel = diagramPath.startsWith('/') ? diagramPath.slice(1) : diagramPath
    // rel = 'manual/foo.d2' or 'manual/sub/foo.d2'
    const manualDir = path.join(__dirname, 'manual')

    // Path relative to manual/ dir so we correctly handle files in subdirectories
    const svgRelInManual = rel.slice('manual/'.length).replace(/\.d2$/, '.svg')
    // e.g. 'foo.svg' or 'sub/foo.svg'
    const scenarioDirPrefix = svgRelInManual.replace(/\.svg$/, '/')
    // e.g. 'foo/' or 'sub/foo/'

    const entry = { watcher: null, timer: null }

    const notify = () => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        const clients = sseClients.get(diagramPath) || []
        clients.forEach(c => c.write(`data: ${JSON.stringify({ type: 'success', message: 'Diagram compiled successfully' })}\n\n`))
      }, 150)
    }

    if (fs.existsSync(manualDir)) {
      // recursive: true (FSEvents on macOS) catches both foo.svg and foo/scenario.svg
      entry.watcher = fs.watch(manualDir, { recursive: true }, (event, filename) => {
        if (!filename) return
        const f = filename.replace(/\\/g, '/')  // normalise Windows paths
        if (f === svgRelInManual || (f.startsWith(scenarioDirPrefix) && f.endsWith('.svg'))) {
          notify()
        }
      })
    }

    svgWatchers.set(diagramPath, entry)
  }

  req.on('close', () => {
    const clients = sseClients.get(diagramPath) || []
    const index = clients.indexOf(res)
    if (index > -1) clients.splice(index, 1)
    if (clients.length === 0) {
      sseClients.delete(diagramPath)
      const entry = svgWatchers.get(diagramPath)
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer)
        entry.watcher?.close()
        svgWatchers.delete(diagramPath)
      }
    }
  })
})

// List scenario SVGs for a given diagram path
app.get('/api/manual/scenarios/:diagramPath(*)', (req, res) => {
  const diagramPath = req.params.diagramPath
  const fullPath = path.join(__dirname, diagramPath)

  // Prevent path traversal
  if (!fullPath.startsWith(__dirname)) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  // Scenario folder is the d2 file path with .d2 stripped
  const scenarioDir = fullPath.replace(/\.d2$/, '')

  if (!fs.existsSync(scenarioDir) || !fs.statSync(scenarioDir).isDirectory()) {
    return res.json({ scenarios: null })
  }

  const svgFiles = fs.readdirSync(scenarioDir)
    .filter(f => f.endsWith('.svg'))
    .sort((a, b) => {
      // index.svg always first
      if (a === 'index.svg') return -1
      if (b === 'index.svg') return 1
      return a.localeCompare(b)
    })

  if (svgFiles.length === 0) {
    return res.json({ scenarios: null })
  }

  const basePath = '/' + path.relative(__dirname, scenarioDir)
  res.json({
    scenarios: svgFiles.map(f => ({
      name: f === 'index.svg' ? 'base' : f.replace('.svg', ''),
      path: `${basePath}/${f}`,
    })),
  })
})

// ── Architecture YAML endpoints ───────────────────────────────────────────────

function loadYamlFile(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return null
  }
}

// Serve all architecture YAML files as a single merged bundle
app.get('/api/arch/data', (req, res) => {
  const archDir = path.join(__dirname, 'architecture')
  const result = { nodes: {}, edges: {}, views: {} }

  const nodesDir = path.join(archDir, 'nodes')
  if (fs.existsSync(nodesDir)) {
    for (const f of fs.readdirSync(nodesDir).filter(f => f.endsWith('.yaml'))) {
      const data = loadYamlFile(path.join(nodesDir, f))
      if (data && typeof data === 'object') {
        // strip the top-level repo/repo_url/notes meta keys
        for (const [k, v] of Object.entries(data)) {
          if (!['repo', 'repo_url', 'notes'].includes(k)) result.nodes[k] = v
        }
      }
    }
  }

  for (const key of ['edges', 'views']) {
    const filePath = path.join(archDir, `${key}.yaml`)
    if (fs.existsSync(filePath)) result[key] = loadYamlFile(filePath) ?? {}
  }

  res.json(result)
})

// ── Mermaid (.mmd) support ────────────────────────────────────────────────────

// Serve raw .mmd source text
app.get('/api/mmd/source/:mmdPath(*)', (req, res) => {
  const mmdPath = req.params.mmdPath
  const fullPath = path.join(__dirname, mmdPath.startsWith('manual/') ? mmdPath : `manual/${mmdPath}`)

  if (!fullPath.startsWith(path.join(__dirname, 'manual'))) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  const filePath = fullPath.endsWith('.mmd') ? fullPath : fullPath + '.mmd'

  fs.readFile(filePath, 'utf-8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'MMD file not found' })
      return res.status(500).json({ error: 'Failed to read MMD file' })
    }
    res.type('text/plain').send(data)
  })
})

// SSE endpoint — streams file-change events for a .mmd file using fs.watch
const mmdWatchClients = new Map()  // mmdPath → Set<res>
const mmdWatchers = new Map()      // mmdPath → FSWatcher

app.get('/api/mmd/events/:mmdPath(*)', (req, res) => {
  const mmdPath = '/' + req.params.mmdPath  // e.g. /manual/SDPVEDO-7489.mmd

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  if (!mmdWatchClients.has(mmdPath)) mmdWatchClients.set(mmdPath, new Set())
  mmdWatchClients.get(mmdPath).add(res)

  // Start fs.watch for this file if not already watching
  if (!mmdWatchers.has(mmdPath)) {
    const filePath = path.join(__dirname, mmdPath.startsWith('/') ? mmdPath.slice(1) : mmdPath)

    // Prevent path traversal - ensure path is within __dirname
    if (!filePath.startsWith(__dirname + path.sep)) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'Invalid path' })}\n\n`)
      return res.end()
    }

    if (fs.existsSync(filePath)) {
      const watcher = fs.watch(filePath, () => {
        const clients = mmdWatchClients.get(mmdPath)
        if (clients) {
          clients.forEach(client => {
            client.write(`data: ${JSON.stringify({ type: 'change' })}\n\n`)
          })
        }
      })
      mmdWatchers.set(mmdPath, watcher)
    }
  }

  req.on('close', () => {
    const clients = mmdWatchClients.get(mmdPath)
    if (clients) {
      clients.delete(res)
      if (clients.size === 0) {
        mmdWatchClients.delete(mmdPath)
        const watcher = mmdWatchers.get(mmdPath)
        if (watcher) { watcher.close(); mmdWatchers.delete(mmdPath) }
      }
    }
  })
})

// ── Batch file-existence check (shared for .d2 and .mmd) ──────────────────────

// Batch file-existence check — accepts { paths: string[] }, returns { [path]: boolean }
app.post('/api/manual/exists', (req, res) => {
  const { paths } = req.body
  if (!Array.isArray(paths)) {
    return res.status(400).json({ error: 'paths must be an array' })
  }
  const results = {}
  for (const p of paths) {
    // Normalise ./manual/foo.d2 → manual/foo.d2 and /manual/foo.d2 → manual/foo.d2
    let rel = p
    if (rel.startsWith('./')) rel = rel.slice(2)
    if (rel.startsWith('/')) rel = rel.slice(1)
    const fullPath = path.join(__dirname, rel)
    if (!fullPath.startsWith(__dirname)) {
      results[p] = false
    } else {
      results[p] = fs.existsSync(fullPath)
    }
  }
  // Also handle .mmd paths rooted outside of ./manual/ via the same logic above
  res.json(results)
})

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Stopping all d2 watch processes...')
  for (const proc of watchProcesses.values()) proc.kill()
  for (const entry of svgWatchers.values()) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher?.close()
  }
  process.exit()
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`D2 watch server running on http://localhost:${PORT}`)
})
