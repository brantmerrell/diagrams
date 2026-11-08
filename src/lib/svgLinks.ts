// D2 renders `link:` fields as `<a href="…">` wrapping a `<g class="… _link">`
// (see the `_link` class in classes.d2). Neither attribute controls click target, so by
// default these navigate the current tab. Force them to open in a new tab.
const LINK_ANCHOR_RE = /<a\s+([^>]*)>(\s*<g\s+class="[^"]*\b_link\b[^"]*")/g

export function openLinkAnchorsInNewTab(svg: string): string {
  return svg.replace(LINK_ANCHOR_RE, '<a $1 target="_blank" rel="noopener noreferrer">$2')
}

// D2 writes `link: ./other.d2` as a relative href, and the browser resolves that
// against the *page* URL. Layered diagrams are served at
// /<dir>/<diagram>.d2/<layer>/<theme>, so `./other.d2` lands inside
// /<dir>/<diagram>.d2/<layer>/ instead of beside the diagram. Rewrite relative
// hrefs against the diagram's own directory (`diagramDir`, e.g. `/tech/cardforge/`)
// so they resolve the same way from every layer and theme URL.
// Both `href` and `xlink:href` are rewritten: D2 emits both on each link, and
// they're matched per attribute, not per anchor, so neither can be skipped.
const ANCHOR_TAG_RE = /<a\s[^>]*>/g
const HREF_ATTR_RE = /(\s(?:xlink:)?href=")([^"]*)(")/g
const ABSOLUTE_OR_SPECIAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i

export function resolveRelativeDiagramLinks(svg: string, diagramDir: string): string {
  return svg.replace(ANCHOR_TAG_RE, tag => tag.replace(HREF_ATTR_RE, (match, open: string, href: string, close: string) => {
    if (ABSOLUTE_OR_SPECIAL_RE.test(href)) return match
    const resolved = new URL(href, `http://local${diagramDir}`)
    return `${open}${resolved.pathname}${resolved.search}${resolved.hash}${close}`
  }))
}

// Directory of a canonical diagram path, with trailing slash: /tech/foo/bar.d2 → /tech/foo/
export function diagramDirOf(canonicalPath: string): string {
  return canonicalPath.slice(0, canonicalPath.lastIndexOf('/') + 1) || '/'
}
