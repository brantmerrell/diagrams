import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Toast from './Toast'
import CodeView from './CodeView'
import { useDiagramWatch } from '../hooks/useDiagramWatch'
import { useDiagramViewport } from '../hooks/useDiagramViewport'
import { useDiagramTheme } from '../hooks/useDiagramTheme'
import { svgToPngBlob } from '../lib/svgToPng'
import { normalizeToCanonical } from '../lib/yamlExtract'

interface D2PanelProps {
  diagramPath?: string
  initialLayerName?: string
  onLayerChange?: (name: string) => void
}


const D2Panel: React.FC<D2PanelProps> = ({ diagramPath, initialLayerName, onLayerChange }) => {
  const {
    svgContent, error, toastMessage, clearToast,
    scenarios, activeScenarioIndex, goToScenario,
  } = useDiagramWatch(diagramPath, initialLayerName)

  const [searchParams, setSearchParams] = useSearchParams()
  const showCode = searchParams.get('view') === 'code'

  const [sourceCode, setSourceCode] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('⎘')
  const { theme, toggleTheme } = useDiagramTheme()

  const canonicalPath = diagramPath ? normalizeToCanonical(diagramPath) : ''
  const d2ServerPath = canonicalPath.startsWith('/') ? canonicalPath.slice(1) : canonicalPath

  // Reset cached source when diagram changes
  useEffect(() => { setSourceCode(null) }, [diagramPath])

  // Fetch source when entering code view (including on initial load with ?view=code)
  useEffect(() => {
    if (!showCode || sourceCode !== null || !d2ServerPath) return
    const controller = new AbortController()
    const load = async () => {
      try {
        let res = await fetch(`/api/d2/source/${d2ServerPath}?t=${Date.now()}`, { signal: controller.signal })
        if (!res.ok) {
          // Static deployment (no backend): deploy.yml publishes sources with a
          // .txt suffix so they can't shadow the SPA route of the same name.
          res = await fetch(`/${d2ServerPath}.txt?t=${Date.now()}`, { signal: controller.signal })
        }
        if (!res.ok) throw res.status
        const text = await res.text()
        if (!controller.signal.aborted) setSourceCode(text)
      } catch (err) {
        if (!controller.signal.aborted) setSourceCode(`// Could not load source (${err})`)
      }
    }
    load()
    return () => controller.abort()
  }, [showCode, sourceCode, d2ServerPath])

  const handleToggleCode = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      if (!showCode) p.set('view', 'code')
      else p.delete('view')
      return p
    }, { replace: true })
  }, [showCode, setSearchParams])

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (showCode && sourceCode !== null) {
        await navigator.clipboard.writeText(sourceCode)
      } else {
        if (!d2ServerPath) return
        setCopyLabel('…')
        let blob: Blob
        try {
          // The d2 CLI's own PNG renderer — full markdown/foreignObject fidelity,
          // unlike the client-side canvas fallback below. --theme keeps it roughly
          // in sync with the current light/dark toggle (see server.js).
          const response = await fetch(`/api/tech/png/${d2ServerPath}?theme=${theme}`)
          if (!response.ok) throw new Error(`PNG render failed: ${response.status}`)
          blob = await response.blob()
        } catch {
          // Static deployment (no backend): render the displayed SVG in-browser
          if (!svgContent) throw new Error('No diagram loaded to copy')
          blob = await svgToPngBlob(svgContent, theme)
        }
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      }
      setCopyLabel('✓')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      setCopyLabel('✗')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    }
  }, [showCode, sourceCode, d2ServerPath, svgContent, theme])

  const handleGoToScenario = useCallback((index: number) => {
    goToScenario(index)
    const len = scenarios?.length ?? 0
    if (len && onLayerChange) {
      const normalizedIndex = ((index % len) + len) % len
      const name = scenarios?.[normalizedIndex]?.name
      if (name) onLayerChange(name)
    }
  }, [goToScenario, scenarios, onLayerChange])

  // Keyboard layer navigation (h / l)
  useEffect(() => {
    if (!scenarios || scenarios.length <= 1 || showCode) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'l') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      handleGoToScenario(activeScenarioIndex + (e.key === 'l' ? 1 : -1))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [scenarios, showCode, activeScenarioIndex, handleGoToScenario])

  const {
    scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  } = useDiagramViewport(diagramPath, showCode)

  if (error) {
    return <div className="diagram-panel"><div className="error">{error}</div></div>
  }

  if (!svgContent) {
    return <div className="diagram-panel"><div className="loading">Waiting for diagram...</div></div>
  }

  const activeScenario = scenarios?.[activeScenarioIndex]

  return (
    <>
      <div
        ref={wheelRef}
        className="diagram-panel"
        data-diagram-theme={theme}
        {...(!showCode && {
          onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp,
          onDoubleClick, onTouchStart, onTouchMove, onTouchEnd,
        })}
        style={!showCode ? { cursor: isDragging ? 'grabbing' : 'grab', touchAction: 'none' } : {}}
      >
        {showCode ? (
          <CodeView code={sourceCode ?? 'Loading…'} />
        ) : (
          <div
            className="diagram-content"
            style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
        {!showCode && (copyLabel === '…' || copyLabel === '✓') && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '1.1rem', letterSpacing: '0.05em',
            pointerEvents: 'none',
          }}>
            {copyLabel === '…' ? 'Rendering PNG…' : 'Copied to clipboard'}
          </div>
        )}

        <div className="zoom-controls" onDoubleClick={e => e.stopPropagation()}>
          {scenarios && scenarios.length > 1 && !showCode && (
            <div className="scenario-controls">
              <button
                className="zoom-button"
                onClick={e => { e.stopPropagation(); handleGoToScenario(activeScenarioIndex - 1) }}
                title="Previous scenario (h)"
              >◀</button>
              <span className="scenario-label" title={activeScenario?.name}>
                {activeScenario?.name}
              </span>
              <button
                className="zoom-button"
                onClick={e => { e.stopPropagation(); handleGoToScenario(activeScenarioIndex + 1) }}
                title="Next scenario (l)"
              >▶</button>
            </div>
          )}
          {!showCode && <button className="zoom-button zoom-button--step" onClick={e => { e.stopPropagation(); zoomIn() }} title="Zoom In">+</button>}
          {!showCode && <button className="zoom-button zoom-button--step" onClick={e => { e.stopPropagation(); zoomOut() }} title="Zoom Out">−</button>}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }} title="Reset Zoom">⟲</button>}
          {!showCode && (
            <button
              className="zoom-button"
              onClick={e => { e.stopPropagation(); toggleTheme() }}
              title={theme === 'dark' ? 'Switch diagram to light theme' : 'Switch diagram to dark theme'}
            >{theme === 'dark' ? '☾' : '☀'}</button>
          )}
          <button
            className={`zoom-button${showCode ? ' zoom-button--active' : ''}`}
            onClick={handleToggleCode}
            title={showCode ? 'Show rendered diagram' : 'Show source code'}
          >{'</>'}</button>
          <button
            className="zoom-button"
            onClick={handleCopy}
            disabled={copyLabel === '…'}
            title={showCode ? 'Copy source code' : 'Copy PNG to clipboard'}
          >{copyLabel}</button>
          {!showCode && <div className="zoom-indicator">{Math.round(scale * 100)}%</div>}
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={clearToast} duration={5000} />
      )}
    </>
  )
}

export default D2Panel
