import { useState, useRef, useEffect, ReactNode } from 'react'

interface ResizablePanelsProps {
  leftPanel: ReactNode
  rightPanel: ReactNode
  defaultLeftWidth?: number
  minLeftWidth?: number
  minRightWidth?: number
  forceLeftWidth?: number
}

const ResizablePanels: React.FC<ResizablePanelsProps> = ({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 40, // percentage
  minLeftWidth = 10,
  minRightWidth = 10,
  forceLeftWidth,
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth)
  const actualLeftWidth = forceLeftWidth !== undefined ? forceLeftWidth : leftWidth
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100

      // Enforce min/max constraints
      if (newLeftWidth >= minLeftWidth && newLeftWidth <= (100 - minRightWidth)) {
        setLeftWidth(newLeftWidth)
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, minLeftWidth, minRightWidth])

  const handleMouseDown = () => {
    setIsDragging(true)
  }

  return (
    <div ref={containerRef} className="resizable-container">
      <div className="resizable-panel-left" style={{ width: `${actualLeftWidth}%` }}>
        {leftPanel}
      </div>
      {actualLeftWidth > 0 && (
        <div
          className={`resizable-divider ${isDragging ? 'dragging' : ''}`}
          onMouseDown={handleMouseDown}
        >
          <div className="resizable-divider-handle" />
        </div>
      )}
      <div className="resizable-panel-right" style={{ width: `${100 - actualLeftWidth}%` }}>
        {rightPanel}
      </div>
    </div>
  )
}

export default ResizablePanels
