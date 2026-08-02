import { useCallback, useEffect, useState } from 'react'

export type DiagramTheme = 'light' | 'dark'

const STORAGE_KEY = 'diagramTheme'

function getInitialTheme(): DiagramTheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Tracks the user's manual light/dark preference for rendered .d2 diagrams,
// independent of the OS/browser color-scheme (see svgTheme.ts for why that
// distinction is needed) — persisted so it survives a reload.
export function useDiagramTheme() {
  const [theme, setTheme] = useState<DiagramTheme>(getInitialTheme)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  return { theme, toggleTheme }
}
