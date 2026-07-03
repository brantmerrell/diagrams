import { useState, useEffect, useRef, useId, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import mermaid from 'mermaid'
import { generateMermaid, flattenNodes, buildMmdToNodeIdMap } from '../lib/mermaidGenerator'
import { useDiagramViewport } from '../hooks/useDiagramViewport'
import type { ArchData, ArchNode, ArchView } from '../lib/architectureTypes'
import Toast from './Toast'
import ResizablePanels from './ResizablePanels'

// ── Data fetching ─────────────────────────────────────────────────────────────

function useArchData(): { data: ArchData | null; error: string | null } {
  const [data, setData] = useState<ArchData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/arch/data')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setData)
      .catch(e => setError(e.message))
  }, [])
  return { data, error }
}

// ── View search / filtering ───────────────────────────────────────────────────

/**
 * Whether a view "contains" a given nodeId.
 * A view contains a node if:
 *   - the node (or any ancestor) appears in nodes_include, OR
 *   - the node's root tags overlap with tags_include
 */
function viewContainsNode(view: ArchView, nodeId: string): boolean {
  if (view.nodes_include) {
    return view.nodes_include.some(inc =>
      inc === nodeId ||
      nodeId.startsWith(inc + '.') ||
      inc.startsWith(nodeId + '.')
    )
  }
  return false
}

/**
 * Filter views by a text query or a focused node.
 * Text query matches label, description, view id, and nodes_include entries.
 */
function filterViews(
  views: Record<string, ArchView>,
  query: string,
  focusedNodeId: string | null,
): Array<[string, ArchView]> {
  const entries = Object.entries(views)
  if (focusedNodeId) {
    return entries.filter(([, v]) => viewContainsNode(v, focusedNodeId))
  }
  if (!query) return entries
  const q = query.toLowerCase()
  return entries.filter(([id, v]) => {
    if (id.includes(q)) return true
    if ((v.label ?? '').toLowerCase().includes(q)) return true
    if ((v.description ?? '').toLowerCase().includes(q)) return true
    if (v.nodes_include?.some(n => n.toLowerCase().includes(q))) return true
    if (v.tags_include?.some(t => t.toLowerCase().includes(q))) return true
    return false
  })
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface SidebarProps {
  views: Record<string, ArchView>
  activeViewId: string | null
  focusedNodeId: string | null
  focusedNode: ArchNode | null
  onSelect: (id: string) => void
  onClearFocus: () => void
  onCollapse: () => void
}

const Sidebar: React.FC<SidebarProps> = ({
  views, activeViewId, focusedNodeId, focusedNode, onSelect, onClearFocus, onCollapse,
}) => {
  const [search, setSearch] = useState('')

  const filtered = filterViews(views, focusedNodeId ? '' : search, focusedNodeId)

  return (
    <div className="arch-sidebar">
      <div className="arch-sidebar-header">
        <span className="arch-sidebar-title">Architecture</span>
        <button className="collapse-button" onClick={onCollapse} title="Collapse">◀</button>
      </div>

      {focusedNodeId ? (
        <div className="arch-node-focus-bar">
          <div className="arch-node-focus-label">
            {focusedNode?.label ?? focusedNodeId}
          </div>
          <div className="arch-node-focus-sub">views containing this node</div>
          <button className="pointers-search-clear arch-node-focus-clear" onClick={onClearFocus} title="Clear filter">✕ all views</button>
        </div>
      ) : (
        <div className="pointers-search-bar">
          <input
            className="pointers-search-input"
            placeholder="Search views…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            spellCheck={false}
          />
          {search && (
            <button className="pointers-search-clear" onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      )}

      <div className="arch-view-list">
        {filtered.length === 0 && (
          <div className="pointers-search-empty">
            {focusedNodeId ? 'No views include this node' : 'No views match'}
          </div>
        )}
        {filtered.map(([id, view]) => (
          <div
            key={id}
            className={`arch-view-item ${activeViewId === id ? 'arch-view-item--active' : ''}`}
            onClick={() => onSelect(id)}
            title={view.description}
          >
            <div className="arch-view-label">{view.label ?? id}</div>
            {view.description && (
              <div className="arch-view-desc">{view.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Mermaid render panel ──────────────────────────────────────────────────────

interface RenderPanelProps {
  source: string
  viewId: string
  onNodeClick: (mmdSafeId: string) => void
}

const RenderPanel: React.FC<RenderPanelProps> = ({ source, viewId, onNodeClick }) => {
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)
  const uid = useId().replace(/:/g, '_')
  const renderSeq = useRef(0)
  const svgHostRef = useRef<HTMLDivElement>(null)    // direct SVG parent — bindFunctions target

  const { scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  } = useDiagramViewport(viewId)

  const onNodeClickRef = useRef(onNodeClick)
  useEffect(() => { onNodeClickRef.current = onNodeClick }, [onNodeClick])

  // Keep the global callback in sync so Mermaid's click directive also works.
  useEffect(() => {
    ;(window as any).archNodeClick = (nodeId: string) => onNodeClickRef.current(nodeId)
    return () => { delete (window as any).archNodeClick }
  }, [])

  useEffect(() => {
    if (!source || !svgHostRef.current) return
    setRendering(true)
    setError(null)
    const seq = ++renderSeq.current
    const id = `arch-mmd-${uid}-${seq}`

    mermaid.render(id, source).then(({ svg, bindFunctions }) => {
      if (seq !== renderSeq.current) return   // stale render
      const host = svgHostRef.current!
      host.innerHTML = svg

      // bindFunctions wires up all `click` directives defined in the diagram source
      bindFunctions?.(host)

      // Also attach our own listeners for every node g[data-id], which is more
      // reliable than click directives for nodes inside subgraphs.
      host.querySelectorAll<SVGGElement>('g[data-id]').forEach(el => {
        if (el.classList.contains('cluster')) return
        const nodeId = el.getAttribute('data-id') ?? ''
        if (!nodeId) return
        el.style.cursor = 'pointer'
        el.addEventListener('click', (e) => {
          e.stopPropagation()
          onNodeClickRef.current(nodeId)
        })
      })

      setRendering(false)
    }).catch(e => {
      setError(e instanceof Error ? e.message : String(e))
      setRendering(false)
    })
  }, [source])

  if (error) {
    return (
      <div className="diagram-panel">
        <div className="error" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
          {error}{'\n\n── Source ──\n'}{source}
        </div>
      </div>
    )
  }

  return (
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
      {rendering && <div className="loading" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>Rendering…</div>}
      <div
        className="diagram-content"
        ref={svgHostRef}
        style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${scale})` }}
      />
      <div className="zoom-controls" onDoubleClick={e => e.stopPropagation()}>
        <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomIn() }}>+</button>
        <button className="zoom-button" onClick={e => { e.stopPropagation(); zoomOut() }}>−</button>
        <button className="zoom-button" onClick={e => { e.stopPropagation(); reset() }}>⟲</button>
        <div className="zoom-indicator">{Math.round(scale * 100)}%</div>
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

const ArchitectureView: React.FC = () => {
  const { viewId: urlViewId } = useParams<{ viewId?: string }>()
  const navigate = useNavigate()
  const { data, error: dataError } = useArchData()

  const [mermaidSource, setMermaidSource] = useState<string>('')
  const [toast, setToast] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)

  // Flat node map + mmd→nodeId reverse map, rebuilt when data loads
  const flatNodeMap = data ? flattenNodes(data.nodes) : new Map<string, ArchNode>()
  const mmdToNodeId = data ? buildMmdToNodeIdMap(flatNodeMap) : new Map<string, string>()

  // Derive active view from URL; fall back to first view
  const activeViewId = (() => {
    if (!data) return null
    if (urlViewId && data.views[urlViewId]) return urlViewId
    return Object.keys(data.views)[0] ?? null
  })()

  // Redirect bare /arch to /arch/<first-view>
  useEffect(() => {
    if (!data || urlViewId) return
    const first = Object.keys(data.views)[0]
    if (first) navigate(`/arch/${first}`, { replace: true })
  }, [data, urlViewId])

  // Navigate when a sidebar item is clicked
  const handleSelectView = useCallback((id: string) => {
    navigate(`/arch/${id}`)
  }, [navigate])

  // Generate Mermaid whenever active view or data changes
  useEffect(() => {
    if (!data || !activeViewId) return
    try {
      setMermaidSource(generateMermaid(data, activeViewId))
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Mermaid generation error')
    }
  }, [data, activeViewId])

  // Handle Mermaid node click: resolve mmd id → node id, set focus
  const handleNodeClick = useCallback((mmdSafeId: string) => {
    const nodeId = mmdToNodeId.get(mmdSafeId)
    if (!nodeId) return
    setFocusedNodeId(prev => prev === nodeId ? null : nodeId)
  }, [mmdToNodeId])

  if (dataError) {
    return <div className="diagram-panel"><div className="error">Failed to load architecture data: {dataError}</div></div>
  }
  if (!data) {
    return <div className="diagram-panel"><div className="loading">Loading architecture…</div></div>
  }

  const focusedNode = focusedNodeId ? (flatNodeMap.get(focusedNodeId) ?? null) : null

  const sidebar = (
    <Sidebar
      views={data.views}
      activeViewId={activeViewId}
      focusedNodeId={focusedNodeId}
      focusedNode={focusedNode}
      onSelect={handleSelectView}
      onClearFocus={() => setFocusedNodeId(null)}
      onCollapse={() => setCollapsed(true)}
    />
  )

  const renderPanel = activeViewId && mermaidSource
    ? <RenderPanel source={mermaidSource} viewId={activeViewId} onNodeClick={handleNodeClick} />
    : <div className="diagram-panel"><div className="loading">Select a view</div></div>

  return (
    <>
      {collapsed ? (
        <>
          <button className="expand-floating-button" onClick={() => setCollapsed(false)}>▶</button>
          {renderPanel}
        </>
      ) : (
        <ResizablePanels
          leftPanel={sidebar}
          rightPanel={renderPanel}
          defaultLeftWidth={22}
          minLeftWidth={0}
          minRightWidth={5}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  )
}

export default ArchitectureView
