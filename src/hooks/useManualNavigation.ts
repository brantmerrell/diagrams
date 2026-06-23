import { useState, useEffect, useRef } from 'react'
import yaml from 'js-yaml'

type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

export interface UseManualNavigationResult {
  yamlData: YamlValue
  rawYaml: string
  diagramStatus: Map<string, boolean>
}

function collectDiagramPaths(obj: YamlValue, paths: Set<string>): void {
  if (!obj) return
  if (typeof obj === 'string' && (obj.endsWith('.d2') || obj.endsWith('.mmd'))) {
    paths.add(obj)
  } else if (Array.isArray(obj)) {
    obj.forEach(item => collectDiagramPaths(item, paths))
  } else if (typeof obj === 'object') {
    Object.values(obj).forEach(val => collectDiagramPaths(val, paths))
  }
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

/** Fetches and polls pointers.yaml every 2 s; runs a single batch existence check on change. */
export function useManualNavigation(): UseManualNavigationResult {
  const [yamlData, setYamlData] = useState<YamlValue>(null)
  const [rawYaml, setRawYaml] = useState('')
  const [diagramStatus, setDiagramStatus] = useState<Map<string, boolean>>(new Map())
  const yamlDataRef = useRef<YamlValue>(null)

  useEffect(() => {
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

        const paths = new Set<string>()
        collectDiagramPaths(data, paths)
        const status = await batchCheckExistence(Array.from(paths), ac.signal)
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
  }, [])

  return { yamlData, rawYaml, diagramStatus }
}
