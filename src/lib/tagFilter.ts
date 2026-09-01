import { normalizeToCanonical } from './yamlExtract'

/**
 * The `tag` URL param holds a comma-separated list of quality tags.
 * A diagram matches when it carries *any* of the selected tags (OR),
 * which is what makes them tags rather than a single-choice category.
 */
export function parseTagFilter(param: string | null): string[] {
  if (!param) return []
  return [...new Set(param.split(',').map(t => t.trim()).filter(Boolean))]
}

export function serializeTagFilter(selected: string[]): string {
  return selected.join(',')
}

/** Toggle one tag in/out of the current selection, preserving vocabulary order. */
export function toggleTag(selected: string[], tag: string, vocabulary: string[]): string[] {
  const next = selected.includes(tag)
    ? selected.filter(t => t !== tag)
    : [...selected, tag]
  const order = new Map(vocabulary.map((t, i) => [t, i]))
  return next.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
}

export function tagsForPath(tags: Map<string, string[]>, diagramPath: string): string[] {
  return tags.get(normalizeToCanonical(diagramPath)) ?? []
}

/** Predicate over pointers.yaml diagram paths for the given selection. */
export function makeMatchesTag(selected: string[], tags: Map<string, string[]>) {
  if (selected.length === 0) return () => true
  return (diagramPath: string) => {
    const own = tagsForPath(tags, diagramPath)
    return selected.some(t => own.includes(t))
  }
}
