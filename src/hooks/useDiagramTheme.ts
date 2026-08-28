import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export type DiagramTheme = 'light' | 'dark'

const STORAGE_KEY = 'diagramTheme'

function isDiagramTheme(v: string | null): v is DiagramTheme {
  return v === 'light' || v === 'dark'
}

function getStoredOrSystemTheme(): DiagramTheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isDiagramTheme(stored)) return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Tracks the user's manual light/dark preference for rendered .d2 diagrams,
// independent of the OS/browser color-scheme (see svgTheme.ts for why that
// distinction is needed). Lives in the `theme` URL param, falling back to
// localStorage and then the OS preference only for a link that carries no
// param at all — so a reload keeps the preference, and once resolved the
// theme is written back into the URL so a copied link is self-describing
// even if the visitor never touches the toggle.
export function useDiagramTheme() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlTheme = searchParams.get('theme')

  const [theme, setTheme] = useState<DiagramTheme>(() =>
    isDiagramTheme(urlTheme) ? urlTheme : getStoredOrSystemTheme(),
  )

  // No ?theme= yet (fresh link, or one with no theme at all) — stamp the
  // resolved value in so the address bar always reflects what's rendered.
  useEffect(() => {
    if (isDiagramTheme(urlTheme)) return
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('theme', theme)
      return p
    }, { replace: true })
  }, [urlTheme, theme, setSearchParams])

  // An explicit ?theme= in the URL (shared link, back/forward nav) wins.
  useEffect(() => {
    if (isDiagramTheme(urlTheme) && urlTheme !== theme) setTheme(urlTheme)
  }, [urlTheme, theme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      setSearchParams(sp => {
        const p = new URLSearchParams(sp)
        p.set('theme', next)
        return p
      }, { replace: true })
      return next
    })
  }, [setSearchParams])

  return { theme, toggleTheme }
}
