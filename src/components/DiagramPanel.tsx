import Toast from './Toast'
import { useDiagramWatch } from '../hooks/useDiagramWatch'
import { useDiagramViewport } from '../hooks/useDiagramViewport'

interface DiagramPanelProps {
  diagramPath?: string
}

const DiagramPanel: React.FC<DiagramPanelProps> = ({ diagramPath }) => {
  const {
    svgContent, error, toastMessage, clearToast,
    scenarios, activeScenarioIndex, goToScenario,
  } = useDiagramWatch(diagramPath)

  const {
    scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  } = useDiagramViewport(diagramPath)

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
        className="diagram-panel"
        ref={wheelRef}
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
        <div
          className="diagram-content"
          style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />

        <div className="zoom-controls" onDoubleClick={e => e.stopPropagation()}>
          {scenarios && scenarios.length > 1 && (
            <div className="scenario-controls">
              <button
                className="zoom-button"
                onClick={e => { e.stopPropagation(); goToScenario(activeScenarioIndex - 1) }}
                title="Previous scenario"
              >◀</button>
              <span className="scenario-label" title={activeScenario?.name}>
                {activeScenario?.name}
              </span>
              <button
                className="zoom-button"
                onClick={e => { e.stopPropagation(); goToScenario(activeScenarioIndex + 1) }}
                title="Next scenario"
              >▶</button>
            </div>
          )}
          <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomIn() }} title="Zoom In">+</button>
          <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomOut() }} title="Zoom Out">−</button>
          <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }} title="Reset Zoom">⟲</button>
          <div className="zoom-indicator">{Math.round(scale * 100)}%</div>
        </div>
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={clearToast} duration={5000} />
      )}
    </>
  )
}

export default DiagramPanel
