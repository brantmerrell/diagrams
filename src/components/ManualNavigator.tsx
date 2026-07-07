import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import yaml from 'js-yaml'
import Toast from './Toast'
import YamlNavigator from './YamlNavigator'
import { useManualNavigation } from '../hooks/useManualNavigation'
import { useYamlExpansion, ViewMode } from '../hooks/useYamlExpansion'
import {
  containsDiagram,
  extractDiagramContext,
  diagramFilenameFromPathname,
  yamlPathToUrlSegment,
  isDiagramCurrentPath,
} from '../lib/yamlExtract'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

interface ManualNavigatorProps {
  onCollapseChange?: (collapsed: boolean) => void
  // Drawer mode (mobile): the ◀ button and diagram selection call this instead
  // of collapsing internally, letting the parent unmount the drawer.
  onRequestClose?: () => void
}

function collectAllDiagramPaths(obj: YamlValue, seen = new Set<string>(), out: string[] = []): string[] {
  if (!obj) return out
  if (typeof obj === 'string') {
    if ((obj.endsWith('.d2') || obj.endsWith('.mmd')) && !seen.has(obj)) { seen.add(obj); out.push(obj) }
    return out
  }
  if (Array.isArray(obj)) { obj.forEach(item => collectAllDiagramPaths(item, seen, out)); return out }
  if (typeof obj === 'object') { Object.values(obj).forEach(v => collectAllDiagramPaths(v, seen, out)); return out }
  return out
}

const ManualNavigator: React.FC<ManualNavigatorProps> = ({ onCollapseChange, onRequestClose }) => {
  const { yamlData, rawYaml, diagramStatus } = useManualNavigation()
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [filteredYamlData, setFilteredYamlData] = useState<YamlValue>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [copyLabel, setCopyLabel] = useState('⎘')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastKeyRef = useRef<{ key: string; time: number } | null>(null)

  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── yamlView URL param ────────────────────────────────────────────────────

  const viewMode = (searchParams.get('yamlView') as ViewMode) || 'context'

  const updateViewMode = (m: ViewMode) => {
    const p = new URLSearchParams(searchParams)
    p.set('yamlView', m)
    setSearchParams(p, { replace: true })
  }

  // ── Expansion / scroll ────────────────────────────────────────────────────

  // Strip /manual/ prefix from pathname for YAML matching
  const urlPath = location.pathname.startsWith('/manual/')
    ? location.pathname.substring('/manual/'.length)
    : location.pathname === '/manual' || location.pathname === '/'
    ? ''
    : location.pathname.substring(1)
  const diagramParent = searchParams.get('diagramParent') || undefined
  const { expandedSections, toggleSection, yamlTreeRef } =
    useYamlExpansion(yamlData, urlPath, viewMode, diagramStatus, diagramParent)

  // ── Focused view: filter YAML to only the active diagram's subtree ────────

  useEffect(() => {
    if (viewMode !== 'focused' || !rawYaml) return
    const filename = diagramFilenameFromPathname(location.pathname)
    if (!filename) { setFilteredYamlData(null); return }
    const extracted = extractDiagramContext(rawYaml, filename)
    setFilteredYamlData(extracted ? yaml.load(extracted) as YamlValue : null)
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

  useEffect(() => { setHighlightedIndex(0) }, [searchResults])

  // ── Navigation ────────────────────────────────────────────────────────────

  const handleDiagramClick = useCallback((diagramPath: string, parentPath?: string) => {
    setToastMessage(null)

    const targetPath = `/manual/${yamlPathToUrlSegment(diagramPath)}`
    if (location.pathname === targetPath) {
      // In drawer mode, tapping the current diagram just closes the drawer to show it
      if (onRequestClose) onRequestClose()
      else setToastMessage('Already viewing this diagram')
      return
    }

    // Prepare search params, preserving yamlView and adding diagramParent if provided.
    // Drop 'layer' too — it's specific to the diagram being left and would otherwise
    // mislabel the new diagram's default view if it happens to share a layer name.
    const params = new URLSearchParams(searchParams)
    if (parentPath) {
      params.set('diagramParent', parentPath)
    } else {
      params.delete('diagramParent')
    }
    params.delete('layer')

    // Don't suppress scroll - user is clicking from navigator, the diagram
    // may not be visible yet and needs to be scrolled into view
    navigate({ pathname: targetPath, search: params.toString() })
    onRequestClose?.()
  }, [location.pathname, searchParams, navigate, onRequestClose])

  // While the search input is focused, up/down pick a result and Enter opens it —
  // instead of the global j/k/g/G handler below, which bails on focused inputs.
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSearchQuery('')
      e.currentTarget.blur()
      return
    }
    if (!searchResults || searchResults.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => (i + 1) % searchResults.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => (i - 1 + searchResults.length) % searchResults.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const path = searchResults[Math.min(highlightedIndex, searchResults.length - 1)]
      if (diagramStatus.get(path) !== false) handleDiagramClick(path)
    }
  }, [searchResults, highlightedIndex, diagramStatus, handleDiagramClick])

  // ── Keyboard navigation (j / k / gg / G / /) ─────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Any key other than 'g' breaks a pending gg sequence, even keys the rest
      // of this handler ignores or when focus is inside an input.
      if (e.key !== 'g') lastKeyRef.current = null

      if (!['j', 'k', 'g', 'G', '/'].includes(e.key)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      const navigable = (searchResults !== null ? searchResults : allDiagramPaths)
        .filter(p => diagramStatus.get(p) !== false)
      if (navigable.length === 0) return

      if (e.key === 'g') {
        const now = Date.now()
        if (lastKeyRef.current?.key === 'g' && now - lastKeyRef.current.time < 500) {
          lastKeyRef.current = null
          e.preventDefault()
          handleDiagramClick(navigable[0])
        } else {
          lastKeyRef.current = { key: 'g', time: now }
        }
        return
      }

      if (e.key === 'G') {
        e.preventDefault()
        handleDiagramClick(navigable[navigable.length - 1])
        return
      }

      const currentIndex = navigable.findIndex(p => isDiagramCurrentPath(p, urlPath))
      const nextIndex = e.key === 'j'
        ? (currentIndex + 1) % navigable.length
        : (currentIndex - 1 + navigable.length) % navigable.length

      e.preventDefault()
      handleDiagramClick(navigable[nextIndex])
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchResults, allDiagramPaths, diagramStatus, urlPath, handleDiagramClick])

  // ── Copy helpers ──────────────────────────────────────────────────────────

  // Build a YAML-serialisable snapshot of what is currently expanded
  const buildVisibleYaml = (obj: YamlValue, path = ''): YamlValue => {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
      return obj
        .filter(item => containsDiagram(item))
        .map(item => (item && typeof item === 'object' ? buildVisibleYaml(item, path) : item))
    }
    const result: Record<string, YamlValue> = {}
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
      .then(() => { setCopyLabel('✓'); setTimeout(() => setCopyLabel('⎘'), 2000) })
      .catch(() => { setCopyLabel('✗'); setTimeout(() => setCopyLabel('⎘'), 2000) })
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
            {copyLabel}
          </button>
          <button
            className="collapse-button"
            onClick={() => {
              if (onRequestClose) { onRequestClose(); return }
              setIsPanelCollapsed(true); onCollapseChange?.(true)
            }}
            title={onRequestClose ? 'Close navigator' : 'Collapse panel'}
          >
            ◀
          </button>
        </div>

        <div className="pointers-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            className="pointers-search-input"
            placeholder="Search diagrams…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
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
                      i === highlightedIndex ? 'pointers-search-result-highlighted' : '',
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
            <YamlNavigator
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

export default ManualNavigator
