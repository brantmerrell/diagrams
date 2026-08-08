import { useState, useEffect, useRef } from 'react'
import yaml from 'js-yaml'
import { collectAllDiagramPaths } from '../lib/yamlExtract'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

export interface UseManualNavigationResult {
  yamlData: YamlValue
  rawYaml: string
  diagramStatus: Map<string, boolean>
}

async function batchCheckExistence(paths: string[], signal: AbortSignal): Promise<Map<string, boolean>> {
  const statusMap = new Map<string, boolean>()
  try {
    const response = await fetch('/api/manual/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths }),
      signal,
    })
    if (response.ok) {
      const data: Record<string, boolean> = await response.json()
      for (const [p, exists] of Object.entries(data)) {
        statusMap.set(p, exists)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name !== 'AbortError') {
      console.error('Error checking diagram existence:', err)
    }
  }
  return statusMap
}

/**
 * Fetches and polls pointers.yaml every 2 s; runs a single batch existence check on change.
 * Pass `enabled: false` to skip polling entirely (e.g. desktop layout where another
 * mounted instance already polls).
 */
export function useManualNavigation(enabled = true): UseManualNavigationResult {
  const [yamlData, setYamlData] = useState<YamlValue>(null)
  const [rawYaml, setRawYaml] = useState('')
  const [diagramStatus, setDiagramStatus] = useState<Map<string, boolean>>(new Map())
  const yamlDataRef = useRef<YamlValue>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let pollErrorLogged = false  // suppress repeated poll-failure spam
    const ac = new AbortController()

    const loadYaml = async () => {
      try {
        const response = await fetch(`/pointers.yaml?t=${Date.now()}`, { signal: ac.signal })
        const text = await response.text()
        const data = yaml.load(text) as YamlValue

        pollErrorLogged = false  // server is reachable again

        // Skip update if the content hasn't changed
        if (JSON.stringify(data) === JSON.stringify(yamlDataRef.current)) return
        if (cancelled) return

        yamlDataRef.current = data
        setYamlData(data)
        setRawYaml(text)

        const status = await batchCheckExistence(collectAllDiagramPaths(data), ac.signal)
        if (!cancelled) setDiagramStatus(status)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError' && !pollErrorLogged) {
          console.warn('pointers.yaml unreachable, will keep retrying:', err.message)
          pollErrorLogged = true
        }
      }
    }

    loadYaml()
    const interval = setInterval(loadYaml, 2000)
    return () => {
      cancelled = true
      ac.abort()
      clearInterval(interval)
    }
  }, [enabled])

  return { yamlData, rawYaml, diagramStatus }
}
