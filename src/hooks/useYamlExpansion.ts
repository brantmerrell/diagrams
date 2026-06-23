import { useState, useEffect, useRef } from 'react'
import { containsDiagram, isDiagramCurrentPath } from '../lib/yamlExtract'

export type ViewMode = 'full' | 'context' | 'focused'
type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

export interface UseYamlExpansionResult {
  expandedSections: Set<string>
  toggleSection: (path: string) => void
  yamlTreeRef: React.RefObject<HTMLDivElement>
  /** Call before navigating to prevent the post-expand auto-scroll from firing. */
  suppressNextAutoScroll: () => void
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function containsCurrentDiagram(obj: YamlValue, urlPath: string): boolean {
  if (!obj) return false
  if (typeof obj === 'string') return (obj.endsWith('.d2') || obj.endsWith('.mmd')) && isDiagramCurrentPath(obj, urlPath)
  if (Array.isArray(obj)) return obj.some(item => containsCurrentDiagram(item, urlPath))
  if (typeof obj === 'object') return Object.values(obj).some(val => containsCurrentDiagram(val, urlPath))
  return false
}

function autoExpandActivePath(obj: YamlValue, urlPath: string, path: string, expanded: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key
    if (containsCurrentDiagram(value, urlPath)) {
      expanded.add(currentPath)
      if (value && typeof value === 'object') {
        autoExpandActivePath(value, urlPath, currentPath, expanded)
      }
    }
  }
}

function autoExpandWithContext(obj: YamlValue, urlPath: string, parentPath: string, path: string, expanded: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key
    // Expand if we're on the path to the parent OR if we're on the path to the current diagram
    const isOnParentPath = currentPath === parentPath || parentPath.startsWith(currentPath + '.')
    const containsCurrent = containsCurrentDiagram(value, urlPath)
    
    if (isOnParentPath || containsCurrent) {
      expanded.add(currentPath)
      if (value && typeof value === 'object') {
        autoExpandWithContext(value, urlPath, parentPath, currentPath, expanded)
      }
    }
  }
}

function expandAll(obj: YamlValue, path: string, expanded: Set<string>): void {
  if (!obj || typeof obj !== 'object') return
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key
    if (containsDiagram(value)) {
      expanded.add(currentPath)
      if (value && typeof value === 'object') expandAll(value, currentPath, expanded)
    }
  }
}

/**
 * Find and scroll to the active diagram element.
 * If diagramParent is specified, prefer the instance within that section.
 * Otherwise, use the first instance found.
 */
function scrollToActive(container: HTMLDivElement, diagramParent?: string): void {
  let active: HTMLElement | null = null
  
  if (diagramParent) {
    // Try to find the diagram within its parent section context
    // Look for parent sections by their data-section attribute or search upward
    const allActive = container.querySelectorAll<HTMLElement>('.yaml-diagram-current')
    
    for (const elem of allActive) {
      // Walk up the DOM tree to find if this element is within the diagramParent section
      let current = elem.parentElement
      while (current && current !== container) {
        const sectionLabel = current.querySelector('.yaml-key')?.textContent
        if (sectionLabel?.includes(diagramParent.split('.').pop() || '')) {
          active = elem
          break
        }
        current = current.parentElement
      }
      if (active) break
    }
  }
  
  // Fallback to first instance if not found in parent context or no parent specified
  if (!active) {
    active = container.querySelector<HTMLElement>('.yaml-diagram-current')
  }
  
  if (!active) return
  container.scrollTop = active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages which YAML tree sections are expanded and keeps the active diagram
 * scrolled into view. The `yamlTreeRef` must be attached to the scrollable
 * tree container in the consuming component.
 *
 * @param diagramParent - Optional parent YAML path to ground expansion (set when clicking a diagram from within a parent)
 */
export function useYamlExpansion(
  yamlData: YamlValue,
  urlPath: string,
  viewMode: ViewMode,
  diagramStatus: Map<string, boolean>,
  diagramParent?: string,
): UseYamlExpansionResult {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const yamlTreeRef = useRef<HTMLDivElement>(null)
  const hasScrolledOnLoad = useRef(false)
  const shouldScrollAfterExpand = useRef(false)
  const suppressNextScroll = useRef(false)

  // Recompute which sections are open whenever navigation, data, or view mode changes
  useEffect(() => {
    if (!yamlData) return
    const newExpanded = new Set<string>()
    if (viewMode === 'full') {
      expandAll(yamlData, '', newExpanded)
    } else if (diagramParent) {
      autoExpandWithContext(yamlData, urlPath, diagramParent, '', newExpanded)
    } else {
      autoExpandActivePath(yamlData, urlPath, '', newExpanded)
    }
    shouldScrollAfterExpand.current = true
    setExpandedSections(newExpanded)
  }, [urlPath, yamlData, viewMode, diagramParent])

  // Scroll to active diagram after the DOM settles post-expansion
  useEffect(() => {
    if (!shouldScrollAfterExpand.current) return
    shouldScrollAfterExpand.current = false
    if (suppressNextScroll.current) {
      suppressNextScroll.current = false
      return
    }
    // Double RAF to ensure DOM has fully updated with new classes
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (yamlTreeRef.current) scrollToActive(yamlTreeRef.current, diagramParent)
      })
    })
  }, [expandedSections, diagramParent])

  // One-time scroll once diagram statuses are first populated
  useEffect(() => {
    if (hasScrolledOnLoad.current || diagramStatus.size === 0) return
    hasScrolledOnLoad.current = true
    // Double RAF to ensure DOM has fully updated
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (yamlTreeRef.current) scrollToActive(yamlTreeRef.current, diagramParent)
      })
    })
  }, [diagramStatus, diagramParent])

  const toggleSection = (path: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  const suppressNextAutoScroll = () => { suppressNextScroll.current = true }

  return { expandedSections, toggleSection, yamlTreeRef, suppressNextAutoScroll }
}
