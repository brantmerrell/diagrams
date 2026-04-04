import express from 'express'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(express.json())

// Store active d2 watch processes
const watchProcesses = new Map()

// Store SSE clients for each diagram
const sseClients = new Map()

app.post('/api/d2/watch', (req, res) => {
  const { diagramPath } = req.body

  if (!diagramPath) {
    return res.status(400).json({ error: 'diagramPath is required' })
  }

  // Kill existing process for this diagram if any
  if (watchProcesses.has(diagramPath)) {
    const existingProcess = watchProcesses.get(diagramPath)
    existingProcess.kill()
    watchProcesses.delete(diagramPath)
  }

  // Remove leading slash and construct file path
  const filePath = diagramPath.startsWith('/') ? diagramPath.slice(1) : diagramPath
  const fullPath = path.join(__dirname, filePath)

  console.log(`Starting d2 watch for: ${fullPath}`)

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
    const output = data.toString()
    console.log(`d2 [${diagramPath}]: ${output}`)

    // Notify success on compilation
    if (output.includes('success')) {
      stderrBuffer = ''
      notifyClients({ type: 'success', message: 'Diagram compiled successfully' })
    }
  })

  d2Process.stderr.on('data', (data) => {
    const output = data.toString()
    console.log(`d2 [${diagramPath}]: ${output}`)

    // d2 uses stderr for both info and errors
    stderrBuffer += output

    // Check if this is an actual error
    if (output.toLowerCase().includes('err') ||
        output.toLowerCase().includes('syntax') ||
        output.toLowerCase().includes('failed')) {
      notifyClients({
        type: 'error',
        message: 'D2 compilation error - check server logs for details',
        error: stderrBuffer.trim()
      })
    } else if (!output.includes('success')) {
      // Clear buffer if it's just info messages
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

// SSE endpoint for diagram events
app.get('/api/d2/events/:diagramPath(*)', (req, res) => {
  const diagramPath = '/' + req.params.diagramPath

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // Add this client to the list
  if (!sseClients.has(diagramPath)) {
    sseClients.set(diagramPath, [])
  }
  sseClients.get(diagramPath).push(res)

  // Remove client on disconnect
  req.on('close', () => {
    const clients = sseClients.get(diagramPath) || []
    const index = clients.indexOf(res)
    if (index > -1) {
      clients.splice(index, 1)
    }
    if (clients.length === 0) {
      sseClients.delete(diagramPath)
    }
  })
})

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('Stopping all d2 watch processes...')
  for (const [path, process] of watchProcesses.entries()) {
    process.kill()
  }
  process.exit()
})

const PORT = 3001
app.listen(PORT, () => {
  console.log(`D2 watch server running on http://localhost:${PORT}`)
})
