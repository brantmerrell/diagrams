import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import yaml from 'js-yaml'
import Toast from './Toast'
import YamlTree from './YamlTree'
import { usePointersYaml } from '../hooks/usePointersYaml'
import { useYamlExpansion, ViewMode } from '../hooks/useYamlExpansion'
import {
  containsDiagram,
  extractDiagramContext,
  diagramFilenameFromPathname,
  yamlPathToUrlSegment,
  isDiagramCurrentPath,
} from '../lib/yamlExtract'

interface PointersViewProps {
  onCollapseChange?: (collapsed: boolean) => void
}

function collectAllDiagramPaths(obj: any, seen = new Set<string>(), out: string[] = []): string[] {
  if (!obj) return out
  if (typeof obj === 'string') {
    if ((obj.endsWith('.d2') || obj.endsWith('.mmd')) && !seen.has(obj)) { seen.add(obj); out.push(obj) }
    return out
  }
  if (Array.isArray(obj)) { obj.forEach(item => collectAllDiagramPaths(item, seen, out)); return out }
  if (typeof obj === 'object') { Object.values(obj).forEach(v => collectAllDiagramPaths(v, seen, out)); return out }
  return out
}

const PointersView: React.FC<PointersViewProps> = ({ onCollapseChange }) => {
  const { yamlData, rawYaml, diagramStatus } = usePointersYaml()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [filteredYamlData, setFilteredYamlData] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── yamlView URL param ────────────────────────────────────────────────────

  useEffect(() => {
    if (!searchParams.get('yamlView')) {
      const p = new URLSearchParams(searchParams)
      p.set('yamlView', 'context')
      setSearchParams(p, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const viewMode = (searchParams.get('yamlView') as ViewMode) || 'context'

  const updateViewMode = (m: ViewMode) => {
    const p = new URLSearchParams(searchParams)
    p.set('yamlView', m)
    setSearchParams(p, { replace: true })
  }

  // ── Expansion / scroll ────────────────────────────────────────────────────

  const urlPath = location.pathname === '/' ? '' : location.pathname.substring(1)
  const { expandedSections, toggleSection, yamlTreeRef, suppressNextAutoScroll } =
    useYamlExpansion(yamlData, urlPath, viewMode, diagramStatus)

  // ── Focused view: filter YAML to only the active diagram's subtree ────────

  useEffect(() => {
    if (viewMode !== 'focused' || !rawYaml) return
    const filename = diagramFilenameFromPathname(location.pathname)
    if (!filename) { setFilteredYamlData(null); return }
    const extracted = extractDiagramContext(rawYaml, filename)
    setFilteredYamlData(extracted ? yaml.load(extracted) : null)
  }, [location.pathname, rawYaml, viewMode])

  // ── Search ────────────────────────────────────────────────────────────────

  const allDiagramPaths = useMemo(() => collectAllDiagramPaths(yamlData), [yamlData])

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return null
    return allDiagramPaths.filter(p => {
      const filename = yamlPathToUrlSegment(p).split('/').pop() ?? ''
      return filename.toLowerCase().includes(q)
    })
  }, [searchQuery, allDiagramPaths])

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleDiagramClick = (diagramPath: string) => {
    setToastMessage(null)

    const targetPath = `/${yamlPathToUrlSegment(diagramPath)}`
    if (location.pathname === targetPath) {
      setToastMessage('Already viewing this diagram')
      return
    }

    suppressNextAutoScroll()
    navigate({ pathname: targetPath, search: searchParams.toString() })
  }

  // ── Copy helpers ──────────────────────────────────────────────────────────

  // Build a YAML-serialisable snapshot of what is currently expanded
  const buildVisibleYaml = (obj: any, path = ''): any => {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
      return obj
        .filter(item => containsDiagram(item))
        .map(item => (item && typeof item === 'object' ? buildVisibleYaml(item, path) : item))
    }
    const result: Record<string, any> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (!containsDiagram(value)) continue
      const currentPath = path ? `${path}.${key}` : key
      const hasChildren = value && typeof value === 'object'
      result[key] = hasChildren && !expandedSections.has(currentPath)
        ? {}
        : buildVisibleYaml(value, currentPath)
    }
    return result
  }

  const handleCopyVisible = () => {
    const data = viewMode === 'focused' ? filteredYamlData : yamlData
    const text = yaml.dump(buildVisibleYaml(data), { indent: 2 })
    navigator.clipboard.writeText(text)
      .then(() => setToastMessage('Copied to clipboard'))
      .catch(() => setToastMessage('Copy failed'))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!yamlData) {
    return <div className="yaml-panel">Loading pointers...</div>
  }

  const treeData = viewMode === 'focused' ? filteredYamlData : yamlData

  return (
    <>
      <div className={`yaml-panel ${isPanelCollapsed ? 'collapsed' : ''}`}>
        <div className="yaml-header">
          <h3>Pointers</h3>
          <select
            className="view-mode-select"
            value={viewMode}
            onChange={e => updateViewMode(e.target.value as ViewMode)}
            title="Choose view mode"
          >
            <option value="full">Full</option>
            <option value="context">Context</option>
            <option value="focused">Focused</option>
          </select>
          <button
            className="copy-yaml-button"
            onClick={handleCopyVisible}
            title="Copy visible YAML to clipboard"
          >
            COPY
          </button>
          <button
            className="collapse-button"
            onClick={() => { setIsPanelCollapsed(true); onCollapseChange?.(true) }}
            title="Collapse panel"
          >
            ◀
          </button>
        </div>

        <div className="pointers-search-bar">
          <input
            type="text"
            className="pointers-search-input"
            placeholder="Search diagrams…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            spellCheck={false}
          />
          {searchQuery && (
            <button
              className="pointers-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="yaml-tree" ref={yamlTreeRef}>
          {searchResults !== null ? (
            <div className="pointers-search-results">
              {searchResults.length === 0 ? (
                <div className="pointers-search-empty">No diagrams match "{searchQuery}"</div>
              ) : searchResults.map((path, i) => {
                const urlSeg = yamlPathToUrlSegment(path)
                const exists = diagramStatus.get(path)
                const isCurrent = isDiagramCurrentPath(path, urlPath)
                return (
                  <div
                    key={`${i}:${path}`}
                    className={[
                      'pointers-search-result',
                      isCurrent ? 'yaml-diagram-current' : '',
                      exists === false ? 'yaml-diagram-not-found' : '',
                      exists !== false ? 'yaml-diagram-link' : '',
                    ].join(' ').trim()}
                    onClick={() => exists !== false && handleDiagramClick(path)}
                    title={exists === false ? 'Diagram not found' : urlSeg}
                  >
                    {urlSeg}
                    {exists === false && ' ⚠️'}
                  </div>
                )
              })}
            </div>
          ) : (
            <YamlTree
              data={treeData}
              expandedSections={expandedSections}
              diagramStatus={diagramStatus}
              urlPath={urlPath}
              onDiagramClick={handleDiagramClick}
              onToggleSection={toggleSection}
            />
          )}
        </div>

        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>

      {isPanelCollapsed && (
        <button
          className="expand-floating-button"
          onClick={() => { setIsPanelCollapsed(false); onCollapseChange?.(false) }}
          title="Expand pointers panel"
        >
          ▶
        </button>
      )}
    </>
  )
}

export default PointersView
