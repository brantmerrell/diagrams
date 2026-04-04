import { useState, useEffect } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import YamlPanel from './YamlPanel'
import DiagramPanel from './DiagramPanel'
import ResizablePanels from './ResizablePanels'

interface DiagramViewerProps {}

const DiagramViewer: React.FC<DiagramViewerProps> = () => {
  const { name } = useParams<{ name?: string }>()
  const location = useLocation()
  const [diagramContent, setDiagramContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [isYamlCollapsed, setIsYamlCollapsed] = useState(false)

  useEffect(() => {
    setLoading(true)
    // Build diagram path from URL
    // URL format: /diagram/vega/seq_authoring_workflow_init
    // or /diagram/publishing/PRs/233
    // or /diagram/seq_workflow_status_init

    let diagramPath = '/d2/seq_workflow_status_init.d2'

    if (location.pathname.startsWith('/diagram/')) {
      // Extract everything after /diagram/
      const pathAfterDiagram = location.pathname.substring('/diagram/'.length)
      if (pathAfterDiagram) {
        diagramPath = `/d2/${pathAfterDiagram}.d2`
      }
    }

    setDiagramContent(diagramPath)
    setLoading(false)
  }, [location.pathname])

  if (loading) {
    return <div className="loading">Loading diagram...</div>
  }

  return (
    <ResizablePanels
      leftPanel={
        <YamlPanel
          currentDiagram={name || 'seq_workflow_status_init'}
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
