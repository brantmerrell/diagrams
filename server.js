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

// Pending delayed stops, scheduled when a diagram's last SSE client disconnects.
// The grace period lets a page refresh reconnect without losing its d2 -w process —
// killing and respawning it would force a full recompile of an unchanged diagram.
const watcherStopTimers = new Map()  // diagramPath → Timeout
const WATCHER_STOP_GRACE_MS = 30_000

function cancelPendingStop(diagramPath) {
  const timer = watcherStopTimers.get(diagramPath)
  if (timer) {
    clearTimeout(timer)
    watcherStopTimers.delete(diagramPath)
  }
}

// Stop a diagram's watch process, if any. The map entry is removed up front;
// the close handler's identity guard keeps a dying process from ever deleting
// a successor's entry.
function stopWatcher(diagramPath) {
  const proc = watchProcesses.get(diagramPath)
  if (!proc) return
  watchProcesses.delete(diagramPath)
  proc.kill()
}

app.post('/api/manual/watch', (req, res) => {
  const { diagramPath } = req.body

  if (!diagramPath) {
    return res.status(400).json({ error: 'diagramPath is required' })
  }

  cancelPendingStop(diagramPath)

  // Reuse a healthy running watcher. A page refresh re-POSTs this endpoint, and
  // killing + respawning d2 -w would force a full recompile of an unchanged
  // diagram — during which d2 deletes and rewrites the output SVGs, blanking
  // the viewer for the duration of the compile.
  if (watchProcesses.has(diagramPath)) {
    return res.json({ success: true, message: `Already watching ${diagramPath}` })
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

    // d2 uses stderr for both info and errors, prefixing each line with
    // "success:", "info:", "warn:", or "err:" — classify on that prefix
    // rather than searching the whole chunk, since a plain substring search
    // for "err" also matches paths like manual/hackerrank/*.d2
    stderrBuffer += output

    const isErrorLine = output
      .split('\n')
      .some((line) => /^\s*err(or)?:/i.test(line))

    if (isErrorLine) {
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
    // Only clear the map entry if it still points to THIS process. A replaced
    // process takes 1-2s to die after SIGTERM; when its close fires, the map
    // already holds its successor — deleting unconditionally would untrack the
    // live successor, making it unkillable by every future watch/unwatch call
    // (this was the source of the duplicate d2 -w process leak).
    if (watchProcesses.get(diagramPath) === d2Process) {
      watchProcesses.delete(diagramPath)
    }
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

  // A viewer is (re)attached — keep the d2 -w process alive
  cancelPendingStop(diagramPath)

  // Start watching the SVG output for this diagram if not already doing so.
  // d2 writes single-board output next to the source (foo.d2 → foo.svg) and
  // multi-board output into a sibling directory (foo.d2 → foo/index.svg,
  // foo/<layer>.svg, …), so watch both locations at any nesting depth.
  if (!svgWatchers.has(diagramPath)) {
    const rel = diagramPath.startsWith('/') ? diagramPath.slice(1) : diagramPath
    const fullD2 = path.join(__dirname, rel)
    const svgDir = path.dirname(fullD2)
    const svgName = path.basename(fullD2).replace(/\.d2$/, '.svg')
    const scenarioDir = fullD2.replace(/\.d2$/, '')
    const scenarioDirName = path.basename(scenarioDir)

    const entry = {
      watchers: [],
      scenarioWatched: false,
      timer: null,
      close() { this.watchers.forEach(w => w.close()) },
    }

    const notify = () => {
      if (entry.timer) clearTimeout(entry.timer)
      entry.timer = setTimeout(() => {
        const clients = sseClients.get(diagramPath) || []
        clients.forEach(c => c.write(`data: ${JSON.stringify({ type: 'success', message: 'Diagram compiled successfully' })}\n\n`))
      }, 150)
    }

    const watchScenarioDir = () => {
      if (entry.scenarioWatched) return true
      if (!fs.existsSync(scenarioDir) || !fs.statSync(scenarioDir).isDirectory()) return false
      try {
        const w = fs.watch(scenarioDir, (event, filename) => {
          if (filename && filename.endsWith('.svg')) notify()
        })
        entry.watchers.push(w)
        entry.scenarioWatched = true
        return true
      } catch (_) {
        return false
      }
    }

    if (fs.existsSync(svgDir)) {
      const w = fs.watch(svgDir, (event, filename) => {
        if (!filename) return
        if (filename === svgName) notify()
        // d2 creates the multi-board output dir on first compile — attach a
        // watcher as soon as it appears and notify for the initial write
        else if (filename === scenarioDirName && watchScenarioDir()) notify()
      })
      entry.watchers.push(w)
    }
    watchScenarioDir()

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
        entry.close()
        svgWatchers.delete(diagramPath)
      }
      // Last viewer left — stop the d2 -w process after a grace period, so a
      // page refresh (SSE drops and reconnects within a second or two) keeps
      // the warm watcher instead of forcing a full recompile.
      cancelPendingStop(diagramPath)
      watcherStopTimers.set(diagramPath, setTimeout(() => {
        watcherStopTimers.delete(diagramPath)
        if (!sseClients.has(diagramPath)) stopWatcher(diagramPath)
      }, WATCHER_STOP_GRACE_MS))
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

// Render a .d2 file to PNG via d2 CLI and return the image bytes
app.get('/api/manual/png/:d2Path(*)', (req, res) => {
  const d2RelPath = req.params.d2Path  // already includes 'manual/' prefix
  const fullPath = path.join(__dirname, d2RelPath)

  if (!fullPath.startsWith(path.join(__dirname, 'manual') + path.sep)) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  const d2File = fullPath.endsWith('.d2') ? fullPath : `${fullPath}.d2`

  if (!fs.existsSync(d2File)) {
    return res.status(404).json({ error: 'D2 file not found' })
  }

  const tmpPng = path.join('/tmp', `d2-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  const d2Process = spawn('d2', [d2File, tmpPng], { cwd: __dirname })

  let stderr = ''
  d2Process.stderr.on('data', d => { stderr += d.toString() })

  d2Process.on('close', code => {
    if (code !== 0 || !fs.existsSync(tmpPng)) {
      console.error(`d2 PNG failed for ${d2File}:`, stderr)
      return res.status(500).json({ error: 'D2 PNG rendering failed' })
    }
    res.setHeader('Content-Type', 'image/png')
    const stream = fs.createReadStream(tmpPng)
    stream.pipe(res)
    stream.on('close', () => { try { fs.unlinkSync(tmpPng) } catch {} })
    stream.on('error', () => res.status(500).end())
  })

  d2Process.on('error', err => {
    console.error('d2 spawn error:', err)
    res.status(500).json({ error: 'Failed to spawn d2' })
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

// Serve raw .d2 source text
app.get('/api/d2/source/:d2Path(*)', (req, res) => {
  const d2Path = req.params.d2Path
  const fullPath = path.join(__dirname, d2Path.startsWith('manual/') ? d2Path : `manual/${d2Path}`)

  if (!fullPath.startsWith(path.join(__dirname, 'manual'))) {
    return res.status(400).json({ error: 'Invalid path' })
  }

  const filePath = fullPath.endsWith('.d2') ? fullPath : fullPath + '.d2'

  fs.readFile(filePath, 'utf-8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'D2 file not found' })
      return res.status(500).json({ error: 'Failed to read D2 file' })
    }
    res.type('text/plain').send(data)
  })
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
    entry.close()
  }
  process.exit()
})

const PORT = process.env.PORT || 3002
app.listen(PORT, () => {
  console.log(`D2 watch server running on http://localhost:${PORT}`)
})
