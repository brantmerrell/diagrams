// D2 embeds its dark-theme colors as a `@media (prefers-color-scheme: dark)`
// block, which only responds to the OS/browser preference. Rewrite it into a
// plain attribute selector so the app's own light/dark toggle can drive it
// instead — see useDiagramTheme.
const DARK_MEDIA_OPEN_RE = /@media screen and \(prefers-color-scheme:dark\)\{/

export function makeThemeToggleable(svg: string): string {
  const match = DARK_MEDIA_OPEN_RE.exec(svg)
  if (!match) return svg

  const start = match.index
  const bodyStart = start + match[0].length
  let depth = 1
  let i = bodyStart
  while (i < svg.length && depth > 0) {
    if (svg[i] === '{') depth++
    else if (svg[i] === '}') depth--
    i++
  }
  const mediaEnd = i // just past the media block's own closing brace
  const body = svg.slice(bodyStart, mediaEnd - 1)

  // Body is a flat sequence of `selector{decls}` rules (no further nesting) —
  // scope each selector to the toggle attribute instead of the media query.
  const scoped = body.replace(
    /([^{}]+)\{([^{}]*)\}/g,
    (_all, selector: string, decls: string) => `[data-diagram-theme="dark"] ${selector.trim()}{${decls}}`,
  )

  return svg.slice(0, start) + scoped + svg.slice(mediaEnd)
}
