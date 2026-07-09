// D2 renders `link:` fields as `<a href="…">` wrapping a `<g class="… _link">`
// (see manual/classes/basic.d2). Neither attribute controls click target, so by
// default these navigate the current tab. Force them to open in a new tab.
const LINK_ANCHOR_RE = /<a\s+([^>]*)>(\s*<g\s+class="[^"]*\b_link\b[^"]*")/g

export function openLinkAnchorsInNewTab(svg: string): string {
  return svg.replace(LINK_ANCHOR_RE, '<a $1 target="_blank" rel="noopener noreferrer">$2')
}
