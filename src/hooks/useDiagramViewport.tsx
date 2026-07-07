import { useState, useEffect, useCallback, useRef } from 'react'

const SCALE_MIN = 0.1
const SCALE_MAX = 5
const PAN_STEP = 50

function clampScale(s: number) {
  return Math.min(Math.max(SCALE_MIN, s), SCALE_MAX)
}

export interface UseDiagramViewportResult {
  scale: number
  position: { x: number; y: number }
  isDragging: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onMouseMove: (e: React.MouseEvent) => void
  onMouseUp: () => void
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
  onDoubleClick: () => void
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
  wheelRef: (node: HTMLElement | null) => void
}

function touchDistance(touches: React.TouchList): number | null {
  if (touches.length < 2) return null
  const dx = touches[1].clientX - touches[0].clientX
  const dy = touches[1].clientY - touches[0].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

/** Pan/zoom state and event handlers for the diagram canvas. Resets when diagramPath changes. */
export function useDiagramViewport(diagramPath: string | undefined, showCode = false): UseDiagramViewportResult {
  const showCodeRef = useRef(showCode)
  showCodeRef.current = showCode

  const [scale, setScale] = useState(1)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null)

  // Reset viewport when the diagram changes
  useEffect(() => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }, [diagramPath])

  // Native wheel listener with { passive: false } to allow preventDefault()
  const handleWheel = useCallback((e: WheelEvent) => {
    if (showCodeRef.current) return
    e.preventDefault()
    e.stopPropagation()
    // ctrlKey is set for trackpad pinch; deltaY magnitude differs but formula is the same
    const delta = e.deltaY * (e.ctrlKey ? -0.005 : -0.001)
    setScale(s => clampScale(s + delta))
  }, [])

  // Track the node for cleanup
  const nodeRef = useRef<HTMLElement | null>(null)

  // Attach wheel listener with passive: false
  const wheelRef = useCallback((node: HTMLElement | null) => {
    // Remove listener from previous node if any
    if (nodeRef.current) {
      nodeRef.current.removeEventListener('wheel', handleWheel)
    }

    // Add listener to new node
    if (node) {
      node.addEventListener('wheel', handleWheel, { passive: false })
    }

    nodeRef.current = node
  }, [handleWheel])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeRef.current) {
        nodeRef.current.removeEventListener('wheel', handleWheel)
      }
    }
  }, [handleWheel])

  // Keyboard pan and zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      switch (e.key) {
        case 'ArrowUp':    e.preventDefault(); setPosition(p => ({ ...p, y: p.y + PAN_STEP })); break
        case 'ArrowDown':  e.preventDefault(); setPosition(p => ({ ...p, y: p.y - PAN_STEP })); break
        case 'ArrowLeft':  e.preventDefault(); setPosition(p => ({ x: p.x + PAN_STEP, y: p.y })); break
        case 'ArrowRight': e.preventDefault(); setPosition(p => ({ x: p.x - PAN_STEP, y: p.y })); break
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); setScale(s => clampScale(s * 1.2)) }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); setScale(s => clampScale(s / 1.2)) }
        else if (e.key === '0') { e.preventDefault(); setScale(1); setPosition({ x: 0, y: 0 }) }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const onMouseUp = () => setIsDragging(false)

  // Safety net: a right-click during a drag opens the native context menu, which
  // swallows the mouseup that would normally clear isDragging, leaving the panel
  // stuck panning under the cursor. Reset on contextmenu and on any mouseup/pointerup
  // reaching the window, not just the panel.
  useEffect(() => {
    const clear = () => setIsDragging(false)
    window.addEventListener('mouseup', clear)
    window.addEventListener('contextmenu', clear)
    return () => {
      window.removeEventListener('mouseup', clear)
      window.removeEventListener('contextmenu', clear)
    }
  }, [])

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      setLastPinchDistance(touchDistance(e.touches))
      setIsDragging(false)
    } else if (e.touches.length === 1) {
      setIsDragging(true)
      setDragStart({ x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y })
    }
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistance !== null) {
      const dist = touchDistance(e.touches)
      if (dist !== null) {
        setScale(s => clampScale(s + (dist - lastPinchDistance) * 0.01))
        setLastPinchDistance(dist)
      }
      return
    }
    if (e.touches.length === 1 && isDragging) {
      setPosition({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y })
    }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) setLastPinchDistance(null)
    if (e.touches.length === 1) {
      // Pinch ended with one finger still down: re-anchor so the pan doesn't jump
      setIsDragging(true)
      setDragStart({ x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y })
    } else if (e.touches.length === 0) {
      setIsDragging(false)
    }
  }

  const onDoubleClick = () => { setScale(1); setPosition({ x: 0, y: 0 }) }

  const zoomIn  = () => setScale(s => clampScale(s * 1.2))
  const zoomOut = () => setScale(s => clampScale(s / 1.2))
  const reset   = () => { setScale(1); setPosition({ x: 0, y: 0 }) }

  return {
    scale, position, isDragging,
    onMouseDown, onMouseMove, onMouseUp,
    onTouchStart, onTouchMove, onTouchEnd,
    onDoubleClick, zoomIn, zoomOut, reset,
    wheelRef,
  }
}
