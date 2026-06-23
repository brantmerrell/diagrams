import { containsDiagram, isDiagramCurrentPath, isDiagramPath } from '../lib/yamlExtract'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

interface YamlNavigatorProps {
  data: YamlValue
  expandedSections: Set<string>
  diagramStatus: Map<string, boolean>
  /** location.pathname with the leading `/` stripped */
  urlPath: string
  onDiagramClick: (diagramPath: string, parentPath?: string) => void
  onToggleSection: (sectionPath: string) => void
}

/**
 * Stateless recursive renderer for the pointers.yaml navigation tree.
 * All interaction state lives in the parent (ManualNavigator) via the hook layer.
 */
const YamlNavigator: React.FC<YamlNavigatorProps> = ({
  data,
  expandedSections,
  diagramStatus,
  urlPath,
  onDiagramClick,
  onToggleSection,
}) => {
  const renderNode = (obj: YamlValue, path: string, depth: number, sectionPath?: string): React.ReactNode => {
    // Leaf: render a clickable diagram link or plain value
    if (!obj || typeof obj !== 'object') {
      const valueStr = String(obj)
      const isD = isDiagramPath(valueStr)
      const diagramExists = diagramStatus.get(valueStr)
      const isNotFound = isD && diagramStatus.has(valueStr) && diagramExists === false
      const isCurrent = isD && isDiagramCurrentPath(valueStr, urlPath)

      return (
        <div style={{ paddingLeft: `${depth * 16}px` }}>
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
                // Pass the section path (closest named parent), not array indices
                onDiagramClick(valueStr, sectionPath)
              }
            }}
            title={isNotFound ? 'Diagram not found' : undefined}
          >
            {valueStr}
            {isNotFound && ' ⚠️'}
          </span>
        </div>
      )
    }

    // Array: pass current sectionPath through, don't create array-indexed paths
    if (Array.isArray(obj)) {
      return obj
        .filter(item => containsDiagram(item))
        .map((item, index) => (
          <div key={`${path}:${index}`}>
            {renderNode(item, path, depth + 1, sectionPath)}
          </div>
        ))
    }

    // Object: render collapsible section rows, filtering out diagram-free subtrees
    return Object.entries(obj)
      .filter(([, value]) => containsDiagram(value))
      .map(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key
        const isExpanded = expandedSections.has(currentPath)
        const hasChildren = Boolean(value && typeof value === 'object')

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
                <span> {renderNode(value, currentPath, depth, currentPath)}</span>
              )}
            </div>
            {hasChildren && isExpanded && (
              <div className="yaml-children">
                {renderNode(value, currentPath, depth + 1, currentPath)}
              </div>
            )}
          </div>
        )
      })
  }

  return <>{renderNode(data, '', 0)}</>
}

export default YamlNavigator
