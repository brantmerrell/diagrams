import { useCallback, useEffect, useState } from 'react'
import type { PathTheme } from '../lib/yamlExtract'

export type DiagramTheme = PathTheme

const STORAGE_KEY = 'diagramTheme'

function getStoredOrSystemTheme(): DiagramTheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Tracks the user's manual light/dark preference for rendered .d2 diagrams,
// independent of the OS/browser color-scheme (see svgTheme.ts for why that
// distinction is needed). `initialTheme` comes from a `/light` or `/dark`
// path segment (see splitLayerFromPathname) — DiagramViewer owns the actual
// URL and passes it down, the same way it does for layer. Falls back to
// localStorage and then the OS preference only when the URL carries no theme
// segment at all, and calls `onThemeChange` to write the resolved value back
// so a copied link is self-describing even if the visitor never touches the
// toggle.
export function useDiagramTheme(initialTheme: DiagramTheme | undefined, onThemeChange: (theme: DiagramTheme) => void) {
  const [theme, setTheme] = useState<DiagramTheme>(() => initialTheme ?? getStoredOrSystemTheme())

  // No theme segment in the URL yet — stamp the resolved value in so the
  // address bar (and any link copied from it) always reflects what's shown.
  useEffect(() => {
    if (!initialTheme) onThemeChange(theme)
  }, [initialTheme, theme, onThemeChange])

  // An explicit theme segment in the URL (shared link, back/forward nav) wins.
  useEffect(() => {
    if (initialTheme && initialTheme !== theme) setTheme(initialTheme)
  }, [initialTheme, theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      onThemeChange(next)
      return next
    })
  }, [onThemeChange])

  return { theme, toggleTheme }
}
