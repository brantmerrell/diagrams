import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import yaml from 'js-yaml'
import ManualNavigator from './ManualNavigator'
import D2Panel from './D2Panel'
import MermaidPanel from './MermaidPanel'
import ResizablePanels from './ResizablePanels'
import { useIsMobile } from '../hooks/useIsMobile'
import { useManualNavigation } from '../hooks/useManualNavigation'
import { useDiagramTags } from '../hooks/useDiagramTags'
import {
  yamlPathToUrlSegment,
  normalizeToCanonical,
  urlSegmentToCanonical,
  isMermaidPath,
  isDiagramPath,
  isDiagramCurrentPath,
  collectAllDiagramPaths,
} from '../lib/yamlExtract'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

// Walk a parsed YAML object and return the first diagram path (.d2 or .mmd)
function findFirstDiagramPath(obj: YamlValue): string | null {
  if (typeof obj === 'string') return isDiagramPath(obj) ? obj : null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstDiagramPath(item)
      if (found) return found
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const found = findFirstDiagramPath(val)
      if (found) return found
    }
  }
  return null
}

// Find the pointers.yaml path that corresponds to a URL path
function findDiagramPathForUrl(obj: YamlValue, targetUrlPath: string): string | null {
  if (typeof obj === 'string' && isDiagramPath(obj)) {
    if (yamlPathToUrlSegment(obj) === targetUrlPath) return obj
    return null
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findDiagramPathForUrl(item, targetUrlPath)
      if (found) return found
    }
  } else if (obj && typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const found = findDiagramPathForUrl(val, targetUrlPath)
      if (found) return found
    }
  }
  return null
}


interface DiagramContent {
  d2Path?: string
  mmdPath?: string
}

const ManualDiagramViewer: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [content, setContent] = useState<DiagramContent>({})
  const [loading, setLoading] = useState(true)
  const [isYamlCollapsed, setIsYamlCollapsed] = useState(false)
  const isMobile = useIsMobile()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  // ── Mobile prev/next diagram arrows (j/k equivalents) ─────────────────────
  // The keyboard handler lives in ManualNavigator, which on mobile is only
  // mounted while the drawer is open — so the cycling logic is replicated
  // here, over the same tag-filtered, existing-diagram list.

  const { yamlData: navYamlData, diagramStatus } = useManualNavigation(isMobile)
  const { tags } = useDiagramTags()
  const tagFilter = searchParams.get('tag') || ''

  const navigable = useMemo(() => {
    return collectAllDiagramPaths(navYamlData).filter(p => {
      if (diagramStatus.get(p) === false) return false
      if (!tagFilter) return true
      return tags.get(normalizeToCanonical(p))?.includes(tagFilter) ?? false
    })
  }, [navYamlData, diagramStatus, tags, tagFilter])

  const goToAdjacentDiagram = useCallback((direction: 1 | -1) => {
    if (navigable.length === 0) return
    const urlPath = location.pathname.startsWith('/manual/')
      ? location.pathname.substring('/manual/'.length)
      : ''
    const currentIndex = navigable.findIndex(p => isDiagramCurrentPath(p, urlPath))
    const nextIndex = (currentIndex + direction + navigable.length) % navigable.length
    // Drop params specific to the diagram being left (mirrors ManualNavigator)
    const params = new URLSearchParams(searchParams)
    params.delete('diagramParent')
    params.delete('layer')
    navigate({
      pathname: `/manual/${yamlPathToUrlSegment(navigable[nextIndex])}`,
      search: params.toString(),
    })
  }, [navigable, location.pathname, searchParams, navigate])

  const initialLayerName = searchParams.get('layer') || undefined

  const handleLayerChange = useCallback((name: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('layer', name)
      return next
    }, { replace: true })
  }, [setSearchParams])

  useEffect(() => {
    const ac = new AbortController()
    const { signal } = ac

    // If at bare /manual, load first diagram from pointers.yaml
    if (location.pathname === '/manual' || location.pathname === '/manual/') {
      fetch('/pointers.yaml', { signal })
        .then((r) => r.text())
        .then((text) => {
          const data = yaml.load(text) as YamlValue
          const firstPath = findFirstDiagramPath(data)
          const urlPath = firstPath ? yamlPathToUrlSegment(firstPath) : null
          if (urlPath) navigate(`/manual/${urlPath}`, { replace: true })
          else setLoading(false)
        })
        .catch((err) => { if (err?.name !== 'AbortError') setLoading(false) })
      return () => ac.abort()
    }

    setLoading(true)
    // Strip /manual/ prefix from pathname to get the diagram path
    const urlPath = location.pathname.startsWith('/manual/')
      ? location.pathname.substring('/manual/'.length)
      : location.pathname.substring(1)

    fetch('/pointers.yaml', { signal })
      .then((response) => response.text())
      .then((text) => {
        const data = yaml.load(text) as YamlValue
        const yamlPath = findDiagramPathForUrl(data, urlPath)
        const canonical = yamlPath ? normalizeToCanonical(yamlPath) : urlSegmentToCanonical(urlPath)

        if (isMermaidPath(canonical)) {
          setContent({ mmdPath: canonical })
        } else {
          setContent({ d2Path: canonical })
        }
        setLoading(false)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') {
          const canonical = urlSegmentToCanonical(urlPath)
          setContent(isMermaidPath(canonical) ? { mmdPath: canonical } : { d2Path: canonical })
          setLoading(false)
        }
      })
    return () => ac.abort()
  }, [location.pathname, navigate])

  const { d2Path, mmdPath } = content

  const rightPanel = useMemo(() => {
    return mmdPath ? (
      <MermaidPanel diagramPath={mmdPath} />
    ) : (
      <D2Panel diagramPath={d2Path} initialLayerName={initialLayerName} onLayerChange={handleLayerChange} />
    )
  }, [d2Path, mmdPath, initialLayerName, handleLayerChange])

  if (loading) {
    return <div className="loading">Loading diagram...</div>
  }

  if (isMobile) {
    return (
      <div className="mobile-layout">
        {rightPanel}
        {!isDrawerOpen && (
          <>
            <button
              className="mobile-nav-button mobile-nav-button--menu"
              onClick={() => setIsDrawerOpen(true)}
              title="Open navigator"
              aria-label="Open navigator"
            >
              ☰
            </button>
            {navigable.length > 1 && (
              <>
                <button
                  className="mobile-nav-button mobile-arrow-prev"
                  onClick={() => goToAdjacentDiagram(-1)}
                  title="Previous diagram (k)"
                  aria-label="Previous diagram"
                >
                  ▲
                </button>
                <button
                  className="mobile-nav-button mobile-arrow-next"
                  onClick={() => goToAdjacentDiagram(1)}
                  title="Next diagram (j)"
                  aria-label="Next diagram"
                >
                  ▼
                </button>
              </>
            )}
          </>
        )}
        {isDrawerOpen && (
          <div className="mobile-drawer">
            <ManualNavigator onRequestClose={() => setIsDrawerOpen(false)} />
          </div>
        )}
      </div>
    )
  }

  return (
    <ResizablePanels
      leftPanel={<ManualNavigator onCollapseChange={setIsYamlCollapsed} />}
      rightPanel={rightPanel}
      defaultLeftWidth={25}
      minLeftWidth={0}
      minRightWidth={5}
      forceLeftWidth={isYamlCollapsed ? 0 : undefined}
    />
  )
}

export default ManualDiagramViewer
