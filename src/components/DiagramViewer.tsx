import { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import yaml from 'js-yaml'
import YamlPanel from './YamlPanel'
import DiagramPanel from './DiagramPanel'
import ResizablePanels from './ResizablePanels'

interface DiagramViewerProps {}

const getFirstDiagramPath = (obj: any): string | null => {
  if (!obj) return null
  if (typeof obj === 'string' && obj.includes('.d2')) return obj
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = getFirstDiagramPath(item)
      if (result) return result
    }
  }
  if (typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const result = getFirstDiagramPath(val)
      if (result) return result
    }
  }
  return null
}

const DiagramViewer: React.FC<DiagramViewerProps> = () => {
  const { name } = useParams<{ name?: string }>()
  const location = useLocation()
  const [diagramContent, setDiagramContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [isYamlCollapsed, setIsYamlCollapsed] = useState(false)
  const [firstDiagramPath, setFirstDiagramPath] = useState<string | null>(null)

  useEffect(() => {
    const loadFirstDiagram = async () => {
      try {
        const response = await fetch('/src.yaml')
        const text = await response.text()
        const data = yaml.load(text)
        setFirstDiagramPath(getFirstDiagramPath(data))
      } catch (error) {
        console.error('Error loading src.yaml:', error)
      }
    }
    loadFirstDiagram()
  }, [])

  useEffect(() => {
    setLoading(true)
    // Build diagram path from URL

    let diagramPath: string | null = null

    if (location.pathname.startsWith('/diagram/')) {
      // Extract everything after /diagram/
      const pathAfterDiagram = location.pathname.substring('/diagram/'.length)
      if (pathAfterDiagram) {
        diagramPath = `/d2/${pathAfterDiagram}.d2`
      }
    }

    if (!diagramPath) {
      if (!firstDiagramPath) return
      diagramPath = `/d2/${firstDiagramPath.replace(/^\/+/, '')}`
    }

    setDiagramContent(diagramPath)
    setLoading(false)
  }, [location.pathname, firstDiagramPath])

  if (loading) {
    return <div className="loading">Loading diagram...</div>
  }

  return (
    <ResizablePanels
      leftPanel={
        <YamlPanel
          currentDiagram={name || (firstDiagramPath ? firstDiagramPath.replace(/^\/+/, '').replace(/\.d2$/, '') : '')}
          onCollapseChange={setIsYamlCollapsed}
        />
      }
      rightPanel={<DiagramPanel diagramPath={diagramContent} />}
      defaultLeftWidth={25}
      minLeftWidth={0}
      minRightWidth={5}
      forceLeftWidth={isYamlCollapsed ? 0 : undefined}
    />
  )
}

export default DiagramViewer
