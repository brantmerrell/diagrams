import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import yaml from 'js-yaml'
import Toast from './Toast'
import { extractDiagramContext, diagramFilenameFromPathname } from '../lib/yamlExtract'

interface YamlPanelProps {
  currentDiagram: string
  onCollapseChange?: (collapsed: boolean) => void
}

const YamlPanel: React.FC<YamlPanelProps> = ({ currentDiagram, onCollapseChange }) => {
  const [yamlData, setYamlData] = useState<any>(null)
  const [rawYaml, setRawYaml] = useState<string>('')
  const [isFiltered, setIsFiltered] = useState<boolean>(false)
  const [filteredYamlData, setFilteredYamlData] = useState<any>(null)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [diagramStatus, setDiagramStatus] = useState<Map<string, boolean>>(new Map())
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState<boolean>(false)
  const [savedScrollPosition, setSavedScrollPosition] = useState<number>(0)
  const yamlTreeRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // Check if a value or any descendant contains a diagram path
  const containsDiagram = (obj: any): boolean => {
    if (!obj) return false
    if (typeof obj === 'string') {
      return obj.includes('.d2')
    }
    if (Array.isArray(obj)) {
      return obj.some(item => containsDiagram(item))
    }
    if (typeof obj === 'object') {
      return Object.values(obj).some(val => containsDiagram(val))
    }
    return false
  }

  // Auto-expand sections that contain diagrams
  const autoExpandDiagramSections = (obj: any, path: string = '', expanded: Set<string>) => {
    if (!obj || typeof obj !== 'object') return

    Object.entries(obj).forEach(([key, value]) => {
      const currentPath = path ? `${path}.${key}` : key

      if (containsDiagram(value)) {
        expanded.add(currentPath)
        if (typeof value === 'object') {
          autoExpandDiagramSections(value, currentPath, expanded)
        }
      }
    })
  }

  // Collect all diagram paths from YAML
  const collectDiagramPaths = (obj: any, paths: Set<string>) => {
    if (!obj) return
    if (typeof obj === 'string' && obj.includes('.d2')) {
      paths.add(obj)
    } else if (Array.isArray(obj)) {
      obj.forEach(item => collectDiagramPaths(item, paths))
    } else if (typeof obj === 'object') {
      Object.values(obj).forEach(val => collectDiagramPaths(val, paths))
    }
  }

  // Check if diagram files exist (check the .d2 source file, not the generated .svg)
  const checkDiagramExistence = async (diagramPaths: Set<string>) => {
    const statusMap = new Map<string, boolean>()

    for (const path of diagramPaths) {
      // Convert YAML path to actual file path
      // Current format: /vega/seq_authoring_workflow_init.d2 -> /d2/vega/seq_authoring_workflow_init.d2
      // Legacy format: ~/2-focus/src-cd/vega/seq_authoring_workflow_init.d2 -> /d2/vega/seq_authoring_workflow_init.d2

      let relativePath = path

      // Handle legacy format with src-cd
      const legacyMatch = path.match(/src-cd\/(.+\.d2)$/)
      if (legacyMatch) {
        relativePath = legacyMatch[1]
      } else {
        // Remove leading slash if present
        relativePath = path.replace(/^\/+/, '')
      }

      // Check for the .d2 source file
      const filePath = `/d2/${relativePath}`

      try {
        const response = await fetch(filePath)
        // For .d2 files, Vite should serve them as text/plain or similar
        // If we get HTML back, it means Vite returned index.html (file doesn't exist)
        const contentType = response.headers.get('content-type') || ''
        const isNotHtmlFallback = !contentType.includes('text/html')
        const exists = response.ok && response.status === 200 && isNotHtmlFallback
        statusMap.set(path, exists)
        console.log(`Checking ${path} -> ${filePath}: status=${response.status}, contentType=${contentType}, exists=${exists}`)
      } catch (err) {
        statusMap.set(path, false)
        console.log(`Checking ${path} -> ${filePath}: ERROR`, err)
      }
    }

    console.log('Diagram status map:', statusMap)
    setDiagramStatus(statusMap)
  }

  // Reset filter when the diagram changes
  useEffect(() => {
    setIsFiltered(false)
  }, [location.pathname])

  useEffect(() => {
    const loadYaml = async () => {
      try {
        // Add cache buster to force reload
        const response = await fetch(`/src.yaml?t=${Date.now()}`)
        const text = await response.text()
        const data = yaml.load(text)

        // Only update if content actually changed
        const dataString = JSON.stringify(data)
        if (dataString !== JSON.stringify(yamlData)) {
          setYamlData(data)
          setRawYaml(text)

          // Auto-expand sections containing diagrams
          const initialExpanded = new Set<string>()
          autoExpandDiagramSections(data, '', initialExpanded)
          setExpandedSections(initialExpanded)

          // Check diagram existence
          const diagramPaths = new Set<string>()
          collectDiagramPaths(data, diagramPaths)
          await checkDiagramExistence(diagramPaths)
        }
      } catch (error) {
        console.error('Error loading YAML:', error)
      }
    }

    loadYaml()

    // Poll for YAML changes every 2 seconds
    const interval = setInterval(loadYaml, 2000)

    return () => clearInterval(interval)
  }, [yamlData])

  const toggleSection = (path: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(path)) {
      newExpanded.delete(path)
    } else {
      newExpanded.add(path)
    }
    setExpandedSections(newExpanded)
  }

  const handleDiagramClick = (diagramPath: string) => {
    // Clear any existing toast message
    setToastMessage(null)

    // Extract diagram name and category from path
    // Current format: /vega/seq_authoring_workflow_init.d2
    // or /seq_workflow_status_init.d2
    // or /publishing/seq-process-job.d2
    // Legacy format: ~/2-focus/src-cd/vega/seq_authoring_workflow_init.d2

    let relativePath = diagramPath

    // Handle legacy format with src-cd
    const legacyMatch = diagramPath.match(/src-cd\/(.+\.d2)$/)
    if (legacyMatch) {
      relativePath = legacyMatch[1]
    } else {
      // Remove leading slash if present
      relativePath = diagramPath.replace(/^\/+/, '')
    }

    // Remove .d2 extension
    relativePath = relativePath.replace(/\.d2$/, '')

    // Check if we're already viewing this diagram
    const targetPath = `/diagram/${relativePath}`
    if (location.pathname === targetPath) {
      setToastMessage('Already viewing this diagram')
      return
    }

    // Navigate to the diagram
    navigate(targetPath)
  }

  // Check if a diagram path matches the currently displayed diagram
  const isCurrentDiagram = (diagramPath: string): boolean => {
    if (!location.pathname.startsWith('/diagram/')) return false

    // Extract the diagram path from the URL
    const urlPath = location.pathname.replace('/diagram/', '')

    // Extract the diagram path from the YAML value
    let yamlPath = diagramPath
    const legacyMatch = diagramPath.match(/src-cd\/(.+\.d2)$/)
    if (legacyMatch) {
      yamlPath = legacyMatch[1]
    } else {
      yamlPath = diagramPath.replace(/^\/+/, '')
    }

    // Remove .d2 extension for comparison
    yamlPath = yamlPath.replace(/\.d2$/, '')

    return urlPath === yamlPath
  }

  const handleFilterToggle = () => {
    if (isFiltered) {
      setIsFiltered(false)
      return
    }
    const filename = diagramFilenameFromPathname(location.pathname)
    if (!filename) {
      setToastMessage('No diagram selected')
      return
    }
    const extracted = extractDiagramContext(rawYaml, filename)
    if (!extracted) {
      setToastMessage(`No YAML context found for ${filename}`)
      return
    }
    setFilteredYamlData(yaml.load(extracted))
    setIsFiltered(true)
  }

  const renderYamlTree = (obj: any, path: string = '', depth: number = 0): React.ReactNode => {
    if (!obj || typeof obj !== 'object') {
      const valueStr = String(obj)
      const isDiagramPath = valueStr.includes('.d2')
      const diagramExists = diagramStatus.get(valueStr)
      const isNotFound = isDiagramPath && diagramStatus.has(valueStr) && diagramExists === false
      const isCurrent = isDiagramPath && isCurrentDiagram(valueStr)

      return (
        <span
          className={`yaml-value ${isDiagramPath ? 'yaml-diagram-link' : ''} ${isNotFound ? 'yaml-diagram-not-found' : ''} ${isCurrent ? 'yaml-diagram-current' : ''}`}
          onClick={(e) => {
            if (isDiagramPath && diagramExists !== false) {
              e.stopPropagation()
              handleDiagramClick(valueStr)
            }
          }}
          title={isNotFound ? 'Diagram not found' : undefined}
        >
          {valueStr}
          {isNotFound && ' ⚠️'}
        </span>
      )
    }

    return Object.entries(obj)
      .filter(([key, value]) => {
        // Only show entries that contain diagrams
        const currentPath = path ? `${path}.${key}` : key
        return containsDiagram(value)
      })
      .map(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key
        const isExpanded = expandedSections.has(currentPath)
        const hasChildren = value && typeof value === 'object'

        return (
          <div key={currentPath} className="yaml-node">
            <div
              onClick={() => hasChildren && toggleSection(currentPath)}
              style={{
                cursor: hasChildren ? 'pointer' : 'default',
                padding: '2px 0',
                paddingLeft: `${depth * 16}px`
              }}
            >
              {hasChildren && <span className="yaml-arrow">{isExpanded ? '▼' : '▶'} </span>}
              <span className="yaml-key">{key}:</span>
              {!hasChildren && <span> {renderYamlTree(value, currentPath, depth)}</span>}
            </div>
            {hasChildren && isExpanded && (
              <div className="yaml-children">
                {renderYamlTree(value, currentPath, depth + 1)}
              </div>
            )}
          </div>
        )
      })
  }

  if (!yamlData) {
    return <div className="yaml-panel">Loading YAML structure...</div>
  }

  return (
    <>
      <div className={`yaml-panel ${isPanelCollapsed ? 'collapsed' : ''}`}>
        {!isPanelCollapsed && (
          <>
            <div className="yaml-header">
              <h3>Notes</h3>
              <button
                className="copy-yaml-button"
                onClick={handleFilterToggle}
                title={isFiltered ? 'Show all diagrams' : 'Collapse to current diagram'}
              >
                {isFiltered ? 'EXPAND' : 'COLLAPSE'}
              </button>
              <button
                className="collapse-button"
                onClick={() => {
                  // Save scroll position before collapsing
                  if (yamlTreeRef.current) {
                    setSavedScrollPosition(yamlTreeRef.current.scrollTop)
                  }
                  setIsPanelCollapsed(true)
                  onCollapseChange?.(true)
                }}
                title="Collapse panel"
              >
                ◀
              </button>
            </div>
            <div className="yaml-tree" ref={yamlTreeRef}>
              {renderYamlTree(isFiltered ? filteredYamlData : yamlData)}
            </div>
          </>
        )}
        {toastMessage && (
          <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
        )}
      </div>
      {isPanelCollapsed && (
        <button
          className="expand-floating-button"
          onClick={() => {
            setIsPanelCollapsed(false)
            onCollapseChange?.(false)
            // Restore scroll position after expanding
            setTimeout(() => {
              if (yamlTreeRef.current) {
                yamlTreeRef.current.scrollTop = savedScrollPosition
              }
            }, 0)
          }}
          title="Expand YAML panel"
        >
          ▶
        </button>
      )}
    </>
  )
}

export default YamlPanel
