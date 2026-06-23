import { useState, useCallback, useEffect } from 'react'
import { normalizeToCanonical, canonicalToSvgPath } from '../lib/yamlExtract'

export interface Scenario {
  name: string
  path: string
}

export interface UseDiagramWatchResult {
  svgContent: string
  error: string | null
  toastMessage: string | null
  scenarios: Scenario[] | null
  activeScenarioIndex: number
  goToScenario: (index: number) => void
  clearToast: () => void
}


export function useDiagramWatch(diagramPath: string | undefined): UseDiagramWatchResult {
  const [svgContent, setSvgContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null)
  const [activeScenarioIndex, setActiveScenarioIndex] = useState(0)

  const loadSvgFromPath = useCallback(async (svgPath: string, signal: AbortSignal, silent = false) => {
    try {
      const response = await fetch(`${svgPath}?t=${Date.now()}`, { signal })
      if (response.ok) {
        setSvgContent(await response.text())
      }
    } catch (err) {
      if (!silent && err instanceof Error && err.name !== 'AbortError') {
        console.warn('Error loading SVG:', err.message)
      }
    }
  }, [])

  const checkScenarios = useCallback(async (
    path: string,
    signal: AbortSignal,
    resetIndex = false,
    silent = false,
  ): Promise<Scenario[] | null> => {
    try {
      // path is normalised to /manual/…; strip the leading / for the URL
      const encodedPath = path.startsWith('/') ? path.slice(1) : path
      const response = await fetch(`/api/manual/scenarios/${encodedPath}`, { signal })
      if (response.ok) {
        const data = await response.json()
        if (data.scenarios && data.scenarios.length > 1) {
          setScenarios(data.scenarios)
          if (resetIndex) setActiveScenarioIndex(0)
          return data.scenarios
        }
      }
    } catch (err) {
      if (!silent && err instanceof Error && err.name !== 'AbortError') {
        console.warn('Error checking scenarios:', err.message)
      }
    }
    setScenarios(null)
    return null
  }, [])

  useEffect(() => {
    if (!diagramPath) return

    setSvgContent('')
    setError(null)
    setScenarios(null)
    setActiveScenarioIndex(0)

    const ac = new AbortController()

    // Normalise once so all consumers (watch POST, SSE URL, scenario fetch) agree on the key
    const dp = normalizeToCanonical(diagramPath)    // e.g. /manual/foo.d2
    const svgPath = canonicalToSvgPath(dp)          // e.g. /manual/foo.svg
    const eventPath = dp.slice(1)                   // e.g. manual/foo.d2 (no leading /)

    const loadSvg = () => loadSvgFromPath(svgPath, ac.signal)

    const startD2Watch = async () => {
      try {
        const response = await fetch('/api/manual/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diagramPath: dp }),
          signal: ac.signal,
        })
        if (!response.ok) {
          setError(`Failed to start d2 watch for ${dp}`)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Error starting d2 watch:', err)
        }
      }
    }

    // SSE connection with exponential-backoff reconnect.
    // Returns a cleanup function that cancels any pending reconnect and closes the stream.
    const connectToEventStream = () => {
      // Server SSE endpoint prepends '/', so this client-side path must NOT include it.
      // With dp = '/manual/foo.d2' → eventPath = 'manual/foo.d2'
      // Server key = '/' + 'manual/foo.d2' = '/manual/foo.d2' ✓ matches watch POST key.
      let es: EventSource | null = null
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null
      let delay = 1_000 // ms; doubles on each error, capped at 30 s

      const connect = () => {
        if (ac.signal.aborted) return
        es = new EventSource(`/api/manual/events/${eventPath}`)

        // On (re)connect: catch up in case a compile event fired while we were disconnected.
        // silent=true so a missing SVG (not compiled yet) doesn't pollute the console.
        es.addEventListener('open', async () => {
          delay = 1_000
          const found = await checkScenarios(dp, ac.signal, false, true)
          await (found ? loadSvgFromPath(found[0].path, ac.signal, true) : loadSvgFromPath(svgPath, ac.signal, true))
        })

        es.onmessage = async (event) => {
          delay = 1_000 // reset backoff on a successful message
          const data = JSON.parse(event.data)
          if (data.type === 'error') {
            setToastMessage(data.message)
          } else if (data.type === 'success') {
            const found = await checkScenarios(dp, ac.signal, false, true)
            await (found ? loadSvgFromPath(found[0].path, ac.signal) : loadSvg())
          }
        }

        es.onerror = () => {
          es?.close()
          if (!ac.signal.aborted) {
            reconnectTimer = setTimeout(connect, delay)
            delay = Math.min(delay * 2, 30_000)
          }
        }
      }

      connect()

      return () => {
        if (reconnectTimer !== null) clearTimeout(reconnectTimer)
        es?.close()
      }
    }

    const init = async () => {
      const found = await checkScenarios(dp, ac.signal, true)
      if (found) {
        await loadSvgFromPath(found[0].path, ac.signal)
      } else {
        await loadSvg()
      }
      await startD2Watch()
    }

    init()
    const cleanupEventStream = connectToEventStream()

    return () => {
      ac.abort()
      cleanupEventStream()
    }
  }, [diagramPath, loadSvgFromPath, checkScenarios])

  // Load the active scenario SVG when index changes
  useEffect(() => {
    const scenario = scenarios?.[activeScenarioIndex]
    if (!scenario) return
    const ac = new AbortController()
    loadSvgFromPath(scenario.path, ac.signal)
    return () => ac.abort()
  }, [scenarios, activeScenarioIndex, loadSvgFromPath])

  const goToScenario = useCallback((index: number) => {
    setActiveScenarioIndex(prev => {
      const len = scenarios?.length ?? 0
      if (!len) return prev
      return ((index % len) + len) % len
    })
  }, [scenarios])

  const clearToast = useCallback(() => setToastMessage(null), [])

  return { svgContent, error, toastMessage, scenarios, activeScenarioIndex, goToScenario, clearToast }
}
