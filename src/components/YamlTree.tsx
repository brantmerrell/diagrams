import { containsDiagram, isDiagramCurrentPath, isDiagramPath } from '../lib/yamlExtract'

interface YamlTreeProps {
  data: any
  expandedSections: Set<string>
  diagramStatus: Map<string, boolean>
  /** location.pathname with the leading `/` stripped */
  urlPath: string
  onDiagramClick: (diagramPath: string) => void
  onToggleSection: (sectionPath: string) => void
}

/**
 * Stateless recursive renderer for the pointers.yaml navigation tree.
 * All interaction state lives in the parent (PointersView) via the hook layer.
 */
const YamlTree: React.FC<YamlTreeProps> = ({
  data,
  expandedSections,
  diagramStatus,
  urlPath,
  onDiagramClick,
  onToggleSection,
}) => {
  const renderNode = (obj: any, path: string, depth: number): React.ReactNode => {
    // Leaf: render a clickable diagram link or plain value
    if (!obj || typeof obj !== 'object') {
      const valueStr = String(obj)
      const isD = isDiagramPath(valueStr)
      const diagramExists = diagramStatus.get(valueStr)
      const isNotFound = isD && diagramStatus.has(valueStr) && diagramExists === false
      const isCurrent = isD && isDiagramCurrentPath(valueStr, urlPath)

      return (
        <span
          className={[
            'yaml-value',
            isD ? 'yaml-diagram-link' : '',
            isNotFound ? 'yaml-diagram-not-found' : '',
            isCurrent ? 'yaml-diagram-current' : '',
          ].join(' ').trim()}
          onClick={e => {
            if (isD && diagramExists !== false) {
              e.stopPropagation()
              onDiagramClick(valueStr)
            }
          }}
          title={isNotFound ? 'Diagram not found' : undefined}
        >
          {valueStr}
          {isNotFound && ' ⚠️'}
        </span>
      )
    }

    // Branch: render collapsible section rows, filtering out diagram-free subtrees
    return Object.entries(obj)
      .filter(([, value]) => containsDiagram(value))
      .map(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key
        const isExpanded = expandedSections.has(currentPath)
        const childVal = value as any
        const hasChildren = Boolean(childVal && typeof childVal === 'object')

        return (
          <div key={currentPath} className="yaml-node">
            <div
              onClick={() => hasChildren && onToggleSection(currentPath)}
              style={{
                cursor: hasChildren ? 'pointer' : 'default',
                padding: '2px 0',
                paddingLeft: `${depth * 16}px`,
              }}
            >
              {hasChildren && (
                <span className="yaml-arrow">{isExpanded ? '▼' : '▶'} </span>
              )}
              <span className="yaml-key">{key}:</span>
              {!hasChildren && (
                <span> {renderNode(childVal, currentPath, depth)}</span>
              )}
            </div>
            {hasChildren && isExpanded && (
              <div className="yaml-children">
                {renderNode(childVal, currentPath, depth + 1)}
              </div>
            )}
          </div>
        )
      })
  }

  return <>{renderNode(data, '', 0)}</>
}

export default YamlTree
