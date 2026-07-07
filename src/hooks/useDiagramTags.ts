import { useState, useEffect } from 'react'

export interface DiagramTagsResult {
  /** Tag names in the order defined by the quality-classes d2 file. */
  vocabulary: string[]
  /** Canonical diagram path (`/manual/foo.d2`) → tags applied in that file. */
  tags: Map<string, string[]>
}

interface TagsPayload {
  vocabulary: string[]
  tags: Record<string, string[]>
}

const EMPTY: DiagramTagsResult = { vocabulary: [], tags: new Map() }

/**
 * Quality-tag index for all diagrams. Fetches /api/manual/tags, falling back
 * to the static /manual/tags.json manifest on GitHub Pages (no backend).
 */
export function useDiagramTags(): DiagramTagsResult {
  const [result, setResult] = useState<DiagramTagsResult>(EMPTY)

  useEffect(() => {
    const ac = new AbortController()
    const load = async () => {
      try {
        let res = await fetch('/api/manual/tags', { signal: ac.signal })
        if (!res.ok) {
          res = await fetch('/manual/tags.json', { signal: ac.signal })
        }
        if (!res.ok) return
        const data = (await res.json()) as TagsPayload
        if (!ac.signal.aborted) {
          setResult({
            vocabulary: data.vocabulary ?? [],
            tags: new Map(Object.entries(data.tags ?? {})),
          })
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('Could not load diagram tags, filter disabled:', err.message)
        }
      }
    }
    load()
    return () => ac.abort()
  }, [])

  return result
}
