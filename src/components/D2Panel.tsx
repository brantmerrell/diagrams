import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import Toast from './Toast'
import CodeView from './CodeView'
import { useManualDiagramWatch } from '../hooks/useManualDiagramWatch'
import { useDiagramViewport } from '../hooks/useDiagramViewport'
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
  } = useManualDiagramWatch(diagramPath, initialLayerName)

  const [searchParams, setSearchParams] = useSearchParams()
  const showCode = searchParams.get('view') === 'code'

  const [sourceCode, setSourceCode] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('⎘')

  const canonicalPath = diagramPath ? normalizeToCanonical(diagramPath) : ''
  const d2ServerPath = canonicalPath.startsWith('/') ? canonicalPath.slice(1) : canonicalPath

  // Reset cached source when diagram changes
  useEffect(() => { setSourceCode(null) }, [diagramPath])

  // Fetch source when entering code view (including on initial load with ?view=code)
  useEffect(() => {
    if (!showCode || sourceCode !== null || !d2ServerPath) return
    const controller = new AbortController()
    fetch(`/api/d2/source/${d2ServerPath}?t=${Date.now()}`, { signal: controller.signal })
      .then(res => res.ok ? res.text() : Promise.reject(res.status))
      .then(text => { if (!controller.signal.aborted) setSourceCode(text) })
      .catch(err => { if (!controller.signal.aborted) setSourceCode(`// Could not load source (${err})`) })
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
        const response = await fetch(`/api/manual/png/${d2ServerPath}`)
        if (!response.ok) throw new Error(`PNG render failed: ${response.status}`)
        const blob = await response.blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      }
      setCopyLabel('✓')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      setCopyLabel('✗')
      setTimeout(() => setCopyLabel('⎘'), 2000)
    }
  }, [showCode, sourceCode, d2ServerPath])

  const handleGoToScenario = (index: number) => {
    goToScenario(index)
    const len = scenarios?.length ?? 0
    if (len && onLayerChange) {
      const normalizedIndex = ((index % len) + len) % len
      const name = scenarios?.[normalizedIndex]?.name
      if (name) onLayerChange(name)
    }
  }

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
                title="Previous scenario"
              >◀</button>
              <span className="scenario-label" title={activeScenario?.name}>
                {activeScenario?.name}
              </span>
              <button
                className="zoom-button"
                onClick={e => { e.stopPropagation(); handleGoToScenario(activeScenarioIndex + 1) }}
                title="Next scenario"
              >▶</button>
            </div>
          )}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomIn() }} title="Zoom In">+</button>}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomOut() }} title="Zoom Out">−</button>}
          {!showCode && <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }} title="Reset Zoom">⟲</button>}
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
