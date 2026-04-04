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
 * Derive the diagram filename (e.g. "seq_versioning_single_request.d2") from
 * a viewer URL pathname (e.g. "/diagram/vega/seq_versioning_single_request").
 * Returns null if the pathname is not a diagram route.
 */
export function diagramFilenameFromPathname(pathname: string): string | null {
  if (!pathname.startsWith('/diagram/')) return null
  const segments = pathname.replace('/diagram/', '').split('/')
  const last = segments[segments.length - 1]
  return last ? `${last}.d2` : null
}
