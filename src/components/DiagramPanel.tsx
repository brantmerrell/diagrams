import { useEffect, useState, useRef } from 'react'
import Toast from './Toast'

interface DiagramPanelProps {
  content?: string
  diagramPath?: string
}

const DiagramPanel: React.FC<DiagramPanelProps> = ({ diagramPath }) => {
  const [svgContent, setSvgContent] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [scale, setScale] = useState<number>(1)
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [lastPinchDistance, setLastPinchDistance] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!diagramPath) return

    // Reset zoom and pan when diagram changes
    setSvgContent('')
    setScale(1)
    setPosition({ x: 0, y: 0 })

    let abortController = new AbortController()

    const startD2Watch = async () => {
      try {
        setError(null)

        // Start d2 watch process via backend API
        const response = await fetch('/api/d2/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diagramPath }),
          signal: abortController.signal,
        })

        if (!response.ok) {
          setError(`Failed to start d2 watch for ${diagramPath}`)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Error starting d2 watch:', err)
        }
      }
    }

    const connectToEventStream = () => {
      const eventPath = diagramPath.replace(/^\//, '')
      const eventSource = new EventSource(`/api/d2/events/${eventPath}`)

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === 'error') {
          console.error('D2 compilation error:', data.error)
          setToastMessage(data.message)
        } else if (data.type === 'success') {
          // Diagram compiled successfully, SVG polling will pick it up
          console.log('D2 compilation successful')
        }
      }

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error)
        eventSource.close()
      }

      return eventSource
    }

    const loadSvg = async () => {
      try {
        const svgPath = diagramPath.replace('.d2', '.svg')
        const response = await fetch(`${svgPath}?t=${Date.now()}`, {
          signal: abortController.signal,
        })

        if (response.ok) {
          const svg = await response.text()
          setSvgContent(svg)
          console.log('SVG loaded, length:', svg.length)
        } else {
          console.warn('Failed to load SVG:', svgPath, response.status)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Error loading SVG:', err)
        }
      }
    }

    startD2Watch()
    loadSvg()
    const eventSource = connectToEventStream()

    // Poll for SVG changes every 1 second
    const interval = setInterval(loadSvg, 1000)

    return () => {
      abortController.abort()
      clearInterval(interval)
      eventSource.close()
    }
  }, [diagramPath])

  // Handle keyboard navigation and zoom
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const step = 50 // pixels to move per arrow key press

      // Arrow keys for panning
      switch(e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setPosition(pos => ({ x: pos.x, y: pos.y + step }))
          break
        case 'ArrowDown':
          e.preventDefault()
          setPosition(pos => ({ x: pos.x, y: pos.y - step }))
          break
        case 'ArrowLeft':
          e.preventDefault()
          setPosition(pos => ({ x: pos.x + step, y: pos.y }))
          break
        case 'ArrowRight':
          e.preventDefault()
          setPosition(pos => ({ x: pos.x - step, y: pos.y }))
          break
      }

      // Ctrl+= and Ctrl+- for zoom (also handle Ctrl++ for keyboards where + requires Shift)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          setScale(s => Math.min(s * 1.2, 5))
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          setScale(s => Math.max(s / 1.2, 0.1))
        } else if (e.key === '0') {
          // Ctrl+0 to reset zoom
          e.preventDefault()
          setScale(1)
          setPosition({ x: 0, y: 0 })
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Handle zoom with mouse wheel (with proper event stopPropagation)
  const handleWheel = (e: React.WheelEvent) => {
    // Check if this is a pinch gesture (ctrlKey is set for trackpad pinch on most browsers)
    if (e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      // Trackpad pinch gestures have larger deltaY values
      const delta = e.deltaY * -0.005
      const newScale = Math.min(Math.max(0.1, scale + delta), 5)
      setScale(newScale)
    } else {
      // Regular mouse wheel scroll
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY * -0.001
      const newScale = Math.min(Math.max(0.1, scale + delta), 5)
      setScale(newScale)
    }
  }

  // Handle trackpad pinch gestures (touch events)
  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null
    const touch1 = touches[0]
    const touch2 = touches[1]
    const dx = touch2.clientX - touch1.clientX
    const dy = touch2.clientY - touch1.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const distance = getTouchDistance(e.touches)
      setLastPinchDistance(distance)
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastPinchDistance !== null) {
      e.preventDefault()
      const distance = getTouchDistance(e.touches)
      if (distance !== null) {
        const delta = (distance - lastPinchDistance) * 0.01
        const newScale = Math.min(Math.max(0.1, scale + delta), 5)
        setScale(newScale)
        setLastPinchDistance(distance)
      }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      setLastPinchDistance(null)
    }
  }

  // Handle pan with mouse drag
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  // Reset zoom and pan on double-click
  const handleDoubleClick = () => {
    setScale(1)
    setPosition({ x: 0, y: 0 })
  }

  if (error) {
    return (
      <div className="diagram-panel">
        <div className="error">{error}</div>
      </div>
    )
  }

  if (!svgContent) {
    return <div className="diagram-panel"><div className="loading">Waiting for diagram...</div></div>
  }

  return (
    <>
      <div
        ref={containerRef}
        className="diagram-panel"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none'
        }}
      >
        <div
          className="diagram-content"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
        <div className="zoom-controls" onDoubleClick={(e) => e.stopPropagation()}>
          <button
            className="zoom-button"
            onClick={(e) => {
              e.stopPropagation()
              setScale(Math.min(scale * 1.2, 5))
            }}
            title="Zoom In"
          >
            +
          </button>
          <button
            className="zoom-button"
            onClick={(e) => {
              e.stopPropagation()
              setScale(Math.max(scale / 1.2, 0.1))
            }}
            title="Zoom Out"
          >
            −
          </button>
          <button
            className="zoom-button"
            onClick={(e) => {
              e.stopPropagation()
              setScale(1)
              setPosition({ x: 0, y: 0 })
            }}
            title="Reset Zoom"
          >
            ⟲
          </button>
          <div className="zoom-indicator">{Math.round(scale * 100)}%</div>
        </div>
      </div>
      {toastMessage && (
        <Toast
          message={toastMessage}
          onClose={() => setToastMessage(null)}
          duration={5000}
        />
      )}
    </>
  )
}

export default DiagramPanel
