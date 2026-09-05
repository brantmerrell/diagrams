/**
 * Extract the subset of YAML that references a given diagram file.
 *
 * Logic mirrors extract.py but matches diagram filenames instead of ticket prefixes:
 *   - Find every line whose value contains the diagram filename (e.g. "seq_versioning_single_request.d2")
 *   - Include all parent keys leading to each match
 *   - Include all children under each match
 *   - Exclude sibling subtrees that don't reference the file
 *
 * Intentionally kept free of UI / browser dependencies so it can be called
 * from an MCP server, CLI script, or the React frontend equally.
 */

function getIndentLevel(line: string): number {
  return line.length - line.trimStart().length
}

/** True if a string value is a diagram file path (.d2 or .mmd). */
export function isDiagramPath(p: string): boolean {
  return p.endsWith('.d2') || p.endsWith('.mmd')
}

/** True if this line's value contains the diagram filename. */
function isDiagramReferenced(line: string, diagramFilename: string): boolean {
  return line.includes(diagramFilename)
}

class YamlExtractor {
  private relevantIndices: Set<number> = new Set()

  constructor(
    private readonly lines: string[],
    private readonly diagramFilename: string,
  ) {}

  private findMatchingLines(): Set<number> {
    const matched = new Set<number>()
    for (let i = 0; i < this.lines.length; i++) {
      if (isDiagramReferenced(this.lines[i], this.diagramFilename)) {
        matched.add(i)
      }
    }
    return matched
  }

  private addParents(lineIndex: number): void {
    let targetIndent = getIndentLevel(this.lines[lineIndex])

    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = this.lines[i]
      if (!line.trim()) continue

      const indent = getIndentLevel(line)
      if (indent < targetIndent) {
        this.relevantIndices.add(i)
        targetIndent = indent
        if (indent === 0) break
      }
    }
  }

  private addChildren(lineIndex: number): void {
    const parentIndent = getIndentLevel(this.lines[lineIndex])
    this.relevantIndices.add(lineIndex)

    for (let i = lineIndex + 1; i < this.lines.length; i++) {
      const line = this.lines[i]
      if (!line.trim()) {
        this.relevantIndices.add(i)
        continue
      }
      if (getIndentLevel(line) <= parentIndent) break
      this.relevantIndices.add(i)
    }
  }

  extract(): string[] {
    const matchedLines = this.findMatchingLines()
    if (matchedLines.size === 0) return []

    for (const idx of [...matchedLines].sort((a, b) => a - b)) {
      this.addParents(idx)
      this.addChildren(idx)
    }

    const output: string[] = []
    let skipUntilIndent: number | null = null

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]
      const indent = getIndentLevel(line)

      // Reset skip when we return to the same or shallower indent
      if (skipUntilIndent !== null && indent <= skipUntilIndent) {
        skipUntilIndent = null
      }

      if (skipUntilIndent !== null) continue

      if (this.relevantIndices.has(i)) {
        output.push(line)
      } else if (line.trim() && line.includes(':')) {
        // Non-relevant key — skip its entire subtree
        skipUntilIndent = indent
      }
    }

    return output
  }
}

/**
 * Return the filtered YAML text that contains only the paths referencing
 * `diagramFilename` (e.g. "seq_versioning_single_request.d2"), preserving
 * the full parent hierarchy and excluding unrelated siblings.
 *
 * Returns an empty string if no references are found.
 */
export function extractDiagramContext(yamlText: string, diagramFilename: string): string {
  const lines = yamlText.split('\n').map(l => l + '\n')
  // Remove trailing newline artefact from the last split segment
  if (lines.length > 0 && lines[lines.length - 1] === '\n') {
    lines.pop()
  }

  const extractor = new YamlExtractor(lines, diagramFilename)
  return extractor.extract().join('')
}

/**
 * True if `obj` contains (or is) a diagram file reference (.d2 or .mmd) anywhere in its tree.
 * Used to prune branches of the YAML tree that have no diagrams.
 */
export function containsDiagram(obj: unknown): boolean {
  if (!obj) return false
  if (typeof obj === 'string') return isDiagramPath(obj)
  if (Array.isArray(obj)) return obj.some(containsDiagram)
  if (typeof obj === 'object') return Object.values(obj).some(containsDiagram)
  return false
}

export interface DiagramEntry {
  path: string
  /** Nearest named-key ancestor (e.g. "foo" or "bar.baz") — same value YamlNavigator
   *  passes as sectionPath / handleDiagramClick's parentPath / the diagramParent param. */
  parent?: string
}

/**
 * Collect every diagram path in a parsed pointers.yaml tree, in document order,
 * tagged with its nearest named-key ancestor. Unlike collectAllDiagramPaths, this
 * does NOT dedupe by path: the same diagram referenced from two different YAML
 * locations produces two entries, one per location, so keyboard nav (which
 * disambiguates "current" by path *and* parent) can visit both instead of the
 * second occurrence being silently absorbed into the first.
 */
export function collectAllDiagramEntries(obj: unknown, sectionPath = '', out: DiagramEntry[] = []): DiagramEntry[] {
  if (!obj) return out
  if (typeof obj === 'string') {
    if (isDiagramPath(obj)) out.push({ path: obj, parent: sectionPath })
    return out
  }
  if (Array.isArray(obj)) { obj.forEach(item => collectAllDiagramEntries(item, sectionPath, out)); return out }
  if (typeof obj === 'object') {
    Object.entries(obj as Record<string, unknown>).forEach(([key, v]) => {
      collectAllDiagramEntries(v, sectionPath ? `${sectionPath}.${key}` : key, out)
    })
  }
  return out
}

/**
 * Collect every distinct diagram path (.d2 or .mmd) in a parsed pointers.yaml
 * tree, in document order. Diagrams referenced from more than one location
 * (see collectAllDiagramEntries) are still listed once here.
 */
export function collectAllDiagramPaths(obj: unknown): string[] {
  return Array.from(new Set(collectAllDiagramEntries(obj).map(e => e.path)))
}

/**
 * Convert a diagram path as stored in pointers.yaml (`./tech/...` or `/tech/...`)
 * to the viewer URL path suffix (no leading slash), e.g. `tech/publishing/PRs/367.d2`.
 * Returns null for paths that don't match either prefix (use `yamlPathToUrlSegment`
 * if you also need legacy `src-cd/…` support or a guaranteed non-null result).
 * Handles both .d2 and .mmd extensions.
 */
export function pointersYamlDiagramToUrlPath(srcPath: string): string | null {
  if (!srcPath || !isDiagramPath(srcPath)) return null
  if (srcPath.startsWith('./')) return srcPath.slice(2)
  if (srcPath.startsWith('/')) return srcPath.slice(1)
  return null
}

// ── Canonical path utilities ─────────────────────────────────────────────────
//
// Canonical form is `/<repo-relative path>`, e.g. `/tech/publishing/PRs/367.d2`
// or `/class_legend.d2` for a diagram that lives at the repo root next to
// `classes.d2`. URL segment form is the same string without the leading slash,
// so the browser pathname *is* the repo-relative path — `tech/` is just the
// directory most diagrams happen to live in, not a hardcoded prefix.
//
// Representations in the wild:
//   YAML value   ./tech/foo.d2  or  /tech/foo.d2  (legacy: src-cd/foo.d2)
//   URL segment  tech/publishing/PRs/foo.d2     (browser pathname minus leading /)
//   Canonical    /tech/publishing/PRs/foo.d2      (sent to server, used as Map key)
//   SVG URL      /tech/publishing/PRs/foo.svg     (served as static file by Vite)

/**
 * Any diagram path format → canonical repo-rooted form.
 *   `./tech/foo.d2`  → `/tech/foo.d2`
 *    `/tech/foo.d2`  → `/tech/foo.d2`  (no-op)
 *     `tech/foo.d2`  → `/tech/foo.d2`
 *   `./class_legend.d2` → `/class_legend.d2`
 */
export function normalizeToCanonical(p: string): string {
  if (p.startsWith('./')) return p.slice(1)    // ./tech/… → /tech/…
  if (!p.startsWith('/')) return '/' + p       //  tech/… → /tech/…
  return p
}

/**
 * URL segment (e.g. `tech/publishing/PRs/367.d2`) → canonical `/tech/publishing/PRs/367.d2`.
 */
export function urlSegmentToCanonical(urlSeg: string): string {
  return `/${urlSeg}`
}

/**
 * Canonical `/tech/foo.d2` → SVG URL `/tech/foo.svg`.
 * (Only applicable for .d2 files; .mmd files are rendered client-side.)
 */
export function canonicalToSvgPath(canonical: string): string {
  return canonical.replace(/\.d2$/, '.svg')
}

/**
 * True if a canonical path refers to a Mermaid diagram.
 */
export function isMermaidPath(p: string): boolean {
  return p.endsWith('.mmd')
}

/**
 * Any pointers.yaml diagram path value → URL segment (canonical path without the
 * leading `/`), e.g. `tech/dev/make.d2` or `class_legend.d2`.
 * Handles the legacy `src-cd/…` format, current `./tech/…` and `/tech/…` formats,
 * and falls back gracefully for any other canonical or bare path.
 * Unlike `pointersYamlDiagramToUrlPath`, never returns null.
 */
export function yamlPathToUrlSegment(diagramPath: string): string {
  // Legacy: src-cd/publishing/PRs/foo.d2 → tech/publishing/PRs/foo.d2
  const legacyMatch = diagramPath.match(/src-cd\/(.+\.(d2|mmd))$/)
  if (legacyMatch) return `tech/${legacyMatch[1]}`
  return normalizeToCanonical(diagramPath).slice(1)
}

/**
 * True when `diagramPath` (a pointers.yaml value) resolves to the same URL segment
 * as `urlPath` (location.pathname with the leading `/` removed).
 */
export function isDiagramCurrentPath(diagramPath: string, urlPath: string): boolean {
  if (!urlPath) return false
  return yamlPathToUrlSegment(diagramPath) === urlPath
}

/**
 * Derive the diagram filename (e.g. "seq_versioning_single_request.d2") from
 * a viewer URL pathname (e.g. "/vega/seq_versioning_single_request.d2").
 * Returns null if the pathname is not a diagram route.
 */
export function diagramFilenameFromPathname(pathname: string): string | null {
  if (pathname === '/') return null
  const p = pathname.substring(1) // Remove leading /
  if (p.endsWith('.d2') || p.endsWith('.mmd')) {
    const segments = p.split('/')
    return segments[segments.length - 1]
  }
  return null
}


