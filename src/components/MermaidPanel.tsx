import { useState, useEffect, useRef, useId } from 'react'
import mermaid from 'mermaid'
import { normalizeToCanonical } from '../lib/yamlExtract'
import Toast from './Toast'
import { useDiagramViewport } from '../hooks/useDiagramViewport'

// Initialized once globally in main.tsx — do not re-initialize here

interface MermaidPanelProps {
  diagramPath: string
}

const MermaidPanel: React.FC<MermaidPanelProps> = ({ diagramPath }) => {
  const [svgContent, setSvgContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const diagramId = useId().replace(/:/g, '_')
  const renderCount = useRef(0)

  const {
    scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  } = useDiagramViewport(diagramPath)

  const canonicalPath = normalizeToCanonical(diagramPath) // e.g. /manual/SDPVEDO-7489.mmd
  // Strip /manual/ prefix for server endpoint
  const serverPath = canonicalPath.startsWith('/manual/')
    ? canonicalPath.slice('/manual/'.length)
    : canonicalPath.startsWith('/')
      ? canonicalPath.slice(1)
      : canonicalPath

  const renderMermaid = async (source: string, signal: AbortSignal) => {
    if (signal.aborted) return
    renderCount.current += 1
    const id = `mermaid-${diagramId}-${renderCount.current}`
    try {
      const { svg } = await mermaid.render(id, source)
      if (!signal.aborted) {
        setSvgContent(svg)
        setError(null)
      }
    } catch (err) {
      if (!signal.aborted) {
        setError(err instanceof Error ? err.message : String(err))
        setSvgContent('')
      }
    }
  }

  const fetchAndRender = async (signal: AbortSignal, silent = false) => {
    try {
      const res = await fetch(`/api/mmd/source/${serverPath}?t=${Date.now()}`, { signal })
      if (!res.ok) {
        if (!silent && !signal.aborted) setError(`Could not load ${serverPath} (${res.status})`)
        return
      }
      const source = await res.text()
      await renderMermaid(source, signal)
    } catch (err) {
      if (!signal.aborted && !silent) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }
  }

  useEffect(() => {
    if (!diagramPath) return

    setSvgContent('')
    setError(null)

    const ac = new AbortController()

    fetchAndRender(ac.signal)

    // SSE for file-change events
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let delay = 1_000

    const connect = () => {
      if (ac.signal.aborted) return
      // eventPath: manual/SDPVEDO-7489.mmd
      const eventPath = canonicalPath.startsWith('/') ? canonicalPath.slice(1) : canonicalPath
      es = new EventSource(`/api/mmd/events/${eventPath}`)

      es.addEventListener('open', () => {
        delay = 1_000
        fetchAndRender(ac.signal, true)
      })

      es.onmessage = async (event) => {
        delay = 1_000
        const data = JSON.parse(event.data)
        if (data.type === 'change') {
          await fetchAndRender(ac.signal)
          setToastMessage('Mermaid diagram updated')
        }
      }

      es.onerror = () => {
        es?.close()
        if (!ac.signal.aborted) {
          reconnectTimer = setTimeout(connect, delay)
          delay = Math.min(delay * 2, 30_000)
        }
      }
    }

    connect()

    // SSE for dynamic views.yaml changes (only for dynamic diagrams)
    let viewsEs: EventSource | null = null
    const isDynamic = canonicalPath.startsWith('/manual/') || canonicalPath.startsWith('/dynamic/')

    if (isDynamic) {
      viewsEs = new EventSource('/api/dynamic/events')

      viewsEs.onmessage = async (event) => {
        const data = JSON.parse(event.data)
        if (data.type === 'reload') {
          await fetchAndRender(ac.signal)
          setToastMessage('Views updated - diagram reloaded')
        }
      }

      viewsEs.onerror = () => {
        viewsEs?.close()
        // Don't reconnect for views - it's less critical
      }
    }

    return () => {
      ac.abort()
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      es?.close()
      viewsEs?.close()
    }
  }, [diagramPath])

  if (error) {
    return (
      <div className="diagram-panel">
        <div className="mermaid-label">Mermaid</div>
        <div className="error">{error}</div>
      </div>
    )
  }

  if (!svgContent) {
    return (
      <div className="diagram-panel">
        <div className="mermaid-label">Mermaid</div>
        <div className="loading">Rendering diagram...</div>
      </div>
    )
  }

  return (
    <>
      <div
        ref={wheelRef}
        className="diagram-panel"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onDoubleClick={onDoubleClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <div className="mermaid-label">Mermaid</div>
        <div
          className="diagram-content"
          style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />

        <div className="zoom-controls" onDoubleClick={e => e.stopPropagation()}>
          <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomIn() }} title="Zoom In">+</button>
          <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomOut() }} title="Zoom Out">−</button>
          <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }} title="Reset Zoom">⟲</button>
          <div className="zoom-indicator">{Math.round(scale * 100)}%</div>
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} duration={3000} />
      )}
    </>
  )
}

export default MermaidPanel
