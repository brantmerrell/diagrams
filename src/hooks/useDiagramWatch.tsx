import { useState, useCallback, useEffect, useRef } from 'react'
import { normalizeToCanonical, canonicalToSvgPath } from '../lib/yamlExtract'

export interface Scenario {
  name: string
  path: string
}

function scenariosEqual(a: Scenario[] | null, b: Scenario[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((s, i) => s.name === b[i].name && s.path === b[i].path)
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

  // Mirrors state into refs so the SSE handler below can read the latest value
  // without retriggering the scenario-reload effect on every recompile — a
  // multi-layer diagram recompiles each layer's SVG at a different time, firing
  // one SSE success event per layer, and only the truly active one should reload.
  const scenariosRef = useRef<Scenario[] | null>(null)
  const activeScenarioIndexRef = useRef(activeScenarioIndex)
  activeScenarioIndexRef.current = activeScenarioIndex

  const loadSvgFromPath = useCallback(async (svgPath: string, signal: AbortSignal, silent = false) => {
    try {
      const response = await fetch(`${svgPath}?t=${Date.now()}`, { signal })
      if (response.ok) {
        const text = await response.text()
        // d2 deletes and rewrites output SVGs during a recompile; a fetch landing
        // in that window gets an empty or truncated body. Keep the last good
        // render instead of blanking — the write's own SSE event refetches soon.
        if (!text.includes('<svg')) return
        // Skip the re-render when a sibling layer's compile fired this reload but
        // the active layer's own SVG didn't actually change — avoids a visible flash.
        setSvgContent(prev => text === prev ? prev : text)
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
          if (!scenariosEqual(scenariosRef.current, data.scenarios)) {
            scenariosRef.current = data.scenarios
            setScenarios(data.scenarios)
          }
          if (resetIndex) setActiveScenarioIndex(0)
          return data.scenarios
        }
      }
    } catch (err) {
      if (!silent && err instanceof Error && err.name !== 'AbortError') {
        console.warn('Error checking scenarios:', err.message)
      }
    }
    // Fewer than 2 scenarios listed (or the check failed): during a recompile
    // d2 briefly deletes the layer SVGs, so a check landing in that window sees
    // a truncated directory listing. Keep the established list rather than
    // tearing down the layer switcher on a transient read — it only resets when
    // the user navigates to a different diagram.
    if (scenariosRef.current) return scenariosRef.current
    return null
  }, [])

  useEffect(() => {
    if (!diagramPath) return

    setSvgContent('')
    setError(null)
    scenariosRef.current = null
    setScenarios(null)
    setActiveScenarioIndex(0)

    const ac = new AbortController()

    // Normalise once so all consumers (watch POST, SSE URL, scenario fetch) agree on the key
    const dp = normalizeToCanonical(diagramPath)    // e.g. /manual/foo.d2
    const svgPath = canonicalToSvgPath(dp)          // e.g. /manual/foo.svg
    const eventPath = dp.slice(1)                   // e.g. manual/foo.d2 (no leading /)

    const loadSvg = () => loadSvgFromPath(svgPath, ac.signal)

    // No-op on static deployments with no backend (e.g. GitHub Pages) — the
    // pre-compiled SVG fetched below is the source of truth there, so a failure
    // here is expected and shouldn't surface as a user-facing error.
    const startD2Watch = async () => {
      try {
        const response = await fetch('/api/manual/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diagramPath: dp }),
          signal: ac.signal,
        })
        if (!response.ok) {
          console.warn(`Could not start d2 watch for ${dp} (${response.status})`)
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.warn('Error starting d2 watch:', err.message)
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
          const idx = Math.min(activeScenarioIndexRef.current, (found?.length ?? 1) - 1)
          await (found ? loadSvgFromPath(found[idx].path, ac.signal, true) : loadSvgFromPath(svgPath, ac.signal, true))
        })

        es.onmessage = async (event) => {
          delay = 1_000 // reset backoff on a successful message
          const data = JSON.parse(event.data)
          if (data.type === 'error') {
            setToastMessage(data.message)
          } else if (data.type === 'success') {
            // Reload the active scenario directly from the fresh list rather than
            // relying on the scenarios-changed effect below — a multi-layer diagram
            // recompiles each layer at a different time, so a single edit fires one
            // success event per layer; only the currently active one should reload.
            const found = await checkScenarios(dp, ac.signal, false, true)
            if (found) {
              const idx = Math.min(activeScenarioIndexRef.current, found.length - 1)
              await loadSvgFromPath(found[idx].path, ac.signal)
            } else {
              await loadSvg()
            }
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
      // Closing the SSE stream is the unwatch signal: the server stops this
      // diagram's d2 -w process once its last SSE client has been gone for a
      // grace period, so a refresh's quick reconnect keeps the warm watcher.
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
