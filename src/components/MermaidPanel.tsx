import { useState, useEffect, useRef, useId, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import mermaid from 'mermaid'
import { normalizeToCanonical } from '../lib/yamlExtract'
import Toast from './Toast'
import CodeView from './CodeView'
import { useDiagramViewport } from '../hooks/useDiagramViewport'
import { svgDomToPngBlob } from '../lib/svgToPng'

// Initialized once globally in main.tsx — do not re-initialize here

interface MermaidPanelProps {
  diagramPath: string
}

const MermaidPanel: React.FC<MermaidPanelProps> = ({ diagramPath }) => {
  const [svgContent, setSvgContent] = useState<string>('')
  const [mmdSource, setMmdSource] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const showCode = searchParams.get('view') === 'code'
  const diagramId = useId().replace(/:/g, '_')
  const renderCount = useRef(0)
  const lastMermaidIdRef = useRef<string | null>(null)
  const diagramRef = useRef<HTMLDivElement>(null)

  const {
    scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  } = useDiagramViewport(diagramPath, showCode)

  const [copyLabel, setCopyLabel] = useState('⎘')
  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (showCode && mmdSource) {
        await navigator.clipboard.writeText(mmdSource)
      } else {
        if (!diagramRef.current) return
        const blob = await svgDomToPngBlob(diagramRef.current)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      }
      setCopyLabel('✓')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      setCopyLabel('✗')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    }
  }, [showCode, mmdSource])

  const canonicalPath = normalizeToCanonical(diagramPath) // e.g. /manual/SDPVEDO-7489.mmd
  // Strip /manual/ prefix for server endpoint
  const serverPath = canonicalPath.startsWith('/manual/')
    ? canonicalPath.slice('/manual/'.length)
    : canonicalPath.startsWith('/')
      ? canonicalPath.slice(1)
      : canonicalPath

  const renderMermaid = async (source: string, signal: AbortSignal) => {
    if (signal.aborted) return
    // Clean up any leftover element from a previous render (e.g. from HMR or StrictMode)
    if (lastMermaidIdRef.current) {
      document.getElementById(lastMermaidIdRef.current)?.remove()
      lastMermaidIdRef.current = null
    }
    renderCount.current += 1
    const id = `mermaid-${diagramId}-${renderCount.current}`
    lastMermaidIdRef.current = id
    try {
      const { svg } = await mermaid.render(id, source)
      // mermaid may append a container element to document.body — remove it
      document.getElementById(id)?.remove()
      lastMermaidIdRef.current = null
      if (!signal.aborted) {
        setSvgContent(svg)
        setError(null)
      }
    } catch (err) {
      document.getElementById(id)?.remove()
      lastMermaidIdRef.current = null
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
      setMmdSource(source)
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
    setMmdSource('')
    setError(null)

    const ac = new AbortController()

    fetchAndRender(ac.signal)

    // SSE for file-change events
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let delay = 1_000

    const connect = () => {
      if (ac.signal.aborted) return
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
      }
    }

    return () => {
      ac.abort()
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      es?.close()
      viewsEs?.close()
      // Clean up any mermaid element that was left in document.body
      if (lastMermaidIdRef.current) {
        document.getElementById(lastMermaidIdRef.current)?.remove()
        lastMermaidIdRef.current = null
      }
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
        {...(!showCode && {
          onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp,
          onDoubleClick, onTouchStart, onTouchMove, onTouchEnd,
        })}
        style={!showCode ? { cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' } : {}}
      >
        <div className="mermaid-label">Mermaid</div>
        {showCode ? (
          <CodeView code={mmdSource} />
        ) : (
          <div
            ref={diagramRef}
            className="diagram-content"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}

        <div className="zoom-controls" onDoubleClick={e => e.stopPropagation()}>
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomIn() }} title="Zoom In">+</button>}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomOut() }} title="Zoom Out">−</button>}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }} title="Reset Zoom">⟲</button>}
          <button
            className={`zoom-button${showCode ? ' zoom-button--active' : ''}`}
            onClick={e => {
              e.stopPropagation()
              setSearchParams(prev => {
                const p = new URLSearchParams(prev)
                if (!showCode) p.set('view', 'code')
                else p.delete('view')
                return p
              }, { replace: true })
            }}
            title={showCode ? 'Show rendered diagram' : 'Show source code'}
          >{'</>'}</button>
          <button
            className="zoom-button"
            onClick={handleCopy}
            title={showCode ? 'Copy source code' : 'Copy PNG to clipboard'}
          >{copyLabel}</button>
          {!showCode && <div className="zoom-indicator">{Math.round(scale * 100)}%</div>}
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} duration={3000} />
      )}
    </>
  )
}

export default MermaidPanel
