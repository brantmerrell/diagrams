/**
 * Chromium taints the canvas for SVGs that contain:
 *   1. @font-face rules with data-URI fonts
 *   2. <foreignObject> elements (always tainted, regardless of content)
 *
 * Strategy for D2 diagrams (svgToPngBlob):
 *   - Strip @font-face at string level before DOMParser.
 *   - Replace <foreignObject> blocks at string level before DOMParser, re-parsing
 *     their inner HTML content with a separate text/html DOMParser call so that
 *     <h2>, <li> etc. are accessible as real HTML elements (the image/svg+xml
 *     parser does not give accessible HTML children inside <foreignObject>).
 *
 * Strategy for Mermaid diagrams (svgDomToPngBlob):
 *   - Use the live DOM element; replace <foreignObject> at DOM level since the
 *     browser has already parsed the HTML inside them correctly.
 */

import themeCss from '../diagramSemanticThemes.css?raw'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * A PNG/canvas export renders the SVG in total isolation (via a blob-URL <img>),
 * so it never sees the page's external stylesheets and never sees the
 * data-diagram-theme attribute the live view sets on an ancestor <div> — see
 * useDiagramTheme.ts and diagramSemanticThemes.css. Bake both directly onto
 * the SVG root so the exported PNG matches whatever the browser is showing.
 */
function embedTheme(svgEl: SVGSVGElement, theme: 'light' | 'dark'): void {
  svgEl.setAttribute('data-diagram-theme', theme)
  const style = document.createElementNS(SVG_NS, 'style')
  style.textContent = themeCss
  svgEl.insertBefore(style, svgEl.firstChild)
}

function detaintSvgString(svgStr: string): string {
  return svgStr
    .replace(/@import\s[^;]+;/g, '')
    .replace(/@font-face\s*\{[^{}]*\}/gs, '')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type StyledLine = { text: string; bold: boolean; fontSize: number }

// Shared 2D context used only for measureText — never drawn to or attached to the page.
let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!
  return measureCtx
}

/** Greedily wraps `text` to fit `maxWidth`, measured in the given font (mirrors browser word-wrap). */
function wrapToWidth(text: string, maxWidth: number, bold: boolean, fontSize: number): string[] {
  const ctx = getMeasureCtx()
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/**
 * Splits an element's content on <br> boundaries (DOM parsing collapses <br> into
 * whitespace-free adjacency, so `.textContent` alone would run wrapped source lines
 * together) into hard-break segments, trimmed and with empties dropped.
 */
function getHardBreakSegments(el: Element): string[] {
  const segments: string[] = []
  let current = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      segments.push(current)
      current = ''
    } else {
      current += node.textContent ?? ''
    }
  }
  segments.push(current)
  return segments.map(s => s.trim()).filter(Boolean)
}

function pushWrapped(el: Element, bold: boolean, fontSize: number, maxWidth: number, lines: StyledLine[], prefix = ''): void {
  for (const segment of getHardBreakSegments(el)) {
    const wrapped = wrapToWidth(segment, maxWidth, bold, fontSize)
    wrapped.forEach((line, i) => lines.push({ text: i === 0 ? prefix + line : line, bold, fontSize }))
  }
}

function walkHtml(el: Element, lines: StyledLine[], maxWidth: number): void {
  const tag = el.tagName.toLowerCase()
  if (tag === 'h1') pushWrapped(el, true, 20, maxWidth, lines)
  else if (tag === 'h2') pushWrapped(el, true, 16, maxWidth, lines)
  else if (tag === 'h3') pushWrapped(el, true, 14, maxWidth, lines)
  else if (tag === 'p') pushWrapped(el, false, 13, maxWidth, lines)
  else if (tag === 'li') pushWrapped(el, false, 13, maxWidth, lines, '• ')
  else for (const child of Array.from(el.children)) walkHtml(child, lines, maxWidth)
}

/**
 * D2 renders markdown as `<div class="md color-NX">…</div>` inside the foreignObject,
 * where `color-NX` is one of D2's own theme classes (not this repo's) carrying the
 * markdown's actual text color, defined in the SVG's own embedded `<style>` block —
 * as a plain `.color-NX{color:...}` rule for light, and (after makeThemeToggleable
 * rewrites D2's dark media-query into an attribute selector — see svgTheme.ts)
 * `[data-diagram-theme="dark"] .d2-<hash> .color-NX{color:...}` for dark — note the
 * per-diagram `.d2-<hash>` scoping class between the attribute selector and the
 * class itself, so the two aren't adjacent. D2 always emits the light rule first,
 * so a plain first-match is reliably the light value.
 */
function resolveMarkdownColor(svgStr: string, divClass: string, theme: 'light' | 'dark' | undefined): string {
  const fallback = theme === 'dark' ? '#F4F6FA' : '#000410'
  const colorClass = divClass.split(/\s+/).find(c => /^color-/.test(c))
  if (!colorClass) return fallback
  const escaped = colorClass.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (theme === 'dark') {
    const dark = new RegExp(`\\[data-diagram-theme="dark"\\][^{]*\\.${escaped}\\{[^}]*color:([^;}]+)`).exec(svgStr)
    if (dark) return dark[1].trim()
  }
  const light = new RegExp(`\\.${escaped}\\{[^}]*color:([^;}]+)`).exec(svgStr)
  return light ? light[1].trim() : fallback
}

/**
 * String-level <foreignObject> replacement for the D2 path.
 * Runs before DOMParser so the canvas never sees <foreignObject>.
 * Inner HTML is re-parsed with text/html so <h2>, <li> etc. are real elements.
 */
function replaceForeignObjectsInString(svgStr: string, theme?: 'light' | 'dark'): string {
  return svgStr.replace(
    /<foreignObject([^>]*)>([\s\S]*?)<\/foreignObject>/g,
    (_, attrs, innerHtml) => {
      const get = (name: string) => {
        const m = new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)
        return m ? parseFloat(m[1]) : 0
      }
      const foX = get('x'), foY = get('y'), foW = get('width'), foH = get('height')
      const padding = 8
      const textX = foX + padding
      const maxWidth = Math.max(foW - padding * 2, 10)

      const htmlDoc = new DOMParser().parseFromString(innerHtml, 'text/html')
      const divClass = htmlDoc.body.firstElementChild?.getAttribute('class') ?? ''
      const textColor = resolveMarkdownColor(svgStr, divClass, theme)

      const lines: StyledLine[] = []
      for (const child of Array.from(htmlDoc.body.children)) walkHtml(child, lines, maxWidth)

      if (!lines.length) return ''

      const lineHeight = 18
      const totalH = lines.length * lineHeight
      let curY = foY + Math.max((foH - totalH) / 2, 0) + lineHeight * 0.8

      return lines.map(line => {
        const y = curY; curY += lineHeight
        return `<text x="${textX}" y="${y}" text-anchor="start" font-size="${line.fontSize}" font-family="sans-serif" fill="${textColor}"${line.bold ? ' font-weight="bold"' : ''}>${escapeXml(line.text)}</text>`
      }).join('\n')
    },
  )
}

/** DOM-level <foreignObject> replacement for the Mermaid live-DOM path. */
function replaceForeignObjects(clone: SVGSVGElement): void {
  const textColor = clone.querySelector('text[fill]')?.getAttribute('fill') ?? '#000000'

  for (const fo of Array.from(clone.querySelectorAll('foreignObject'))) {
    const rawText = fo.textContent?.trim() ?? ''
    if (!rawText) { fo.remove(); continue }

    const x = parseFloat(fo.getAttribute('x') ?? '0') + parseFloat(fo.getAttribute('width') ?? '0') / 2
    const y = parseFloat(fo.getAttribute('y') ?? '0') + parseFloat(fo.getAttribute('height') ?? '0') / 2

    const text = document.createElementNS(SVG_NS, 'text')
    text.setAttribute('x', String(x))
    text.setAttribute('y', String(y))
    text.setAttribute('text-anchor', 'middle')
    text.setAttribute('dominant-baseline', 'middle')
    text.setAttribute('font-size', '13')
    text.setAttribute('font-family', 'sans-serif')
    text.setAttribute('fill', textColor)

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l)
    if (lines.length <= 1) {
      text.textContent = rawText
    } else {
      const lineHeight = 16
      const startDy = -((lines.length - 1) * lineHeight) / 2
      lines.forEach((line, i) => {
        const tspan = document.createElementNS(SVG_NS, 'tspan')
        tspan.setAttribute('x', String(x))
        tspan.setAttribute('dy', i === 0 ? String(startDy) : String(lineHeight))
        tspan.textContent = line
        text.appendChild(tspan)
      })
    }

    fo.parentNode?.replaceChild(text, fo)
  }
}

function svgElToPngBlob(svgEl: SVGSVGElement, theme?: 'light' | 'dark'): Promise<Blob> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement

  if (theme) embedTheme(clone, theme)
  replaceForeignObjects(clone)

  const widthAttr = clone.getAttribute('width') ?? ''
  const heightAttr = clone.getAttribute('height') ?? ''
  const isPercent = (v: string) => v.includes('%')
  let width = isPercent(widthAttr) ? 0 : parseFloat(widthAttr)
  let height = isPercent(heightAttr) ? 0 : parseFloat(heightAttr)

  if (!width || !height) {
    const vb = clone.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    if (vb && vb.length === 4) { width = vb[2]; height = vb[3] }
  }
  if (!width || !height) {
    const rect = svgEl.getBoundingClientRect()
    width = rect.width || 800
    height = rect.height || 600
  }

  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  return new Promise((resolve, reject) => {
    // Serialize then strip @font-face at string level (belt-and-suspenders)
    const rawStr = new XMLSerializer().serializeToString(clone)
    const svgStr = detaintSvgString(rawStr)
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }))

    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const dpr = window.devicePixelRatio || 1
        canvas.width = width * dpr
        canvas.height = height * dpr
        const ctx = canvas.getContext('2d')!
        ctx.scale(dpr, dpr)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        URL.revokeObjectURL(url)
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/png')
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}

/**
 * For D2 diagrams: replace <foreignObject> blocks at string level (before DOMParser)
 * so the HTML inside them can be parsed correctly by a separate text/html DOMParser.
 */
export function svgToPngBlob(svgContent: string, theme?: 'light' | 'dark'): Promise<Blob> {
  const cleaned = replaceForeignObjectsInString(detaintSvgString(svgContent), theme)
  return new Promise((resolve, reject) => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(cleaned, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return reject(new Error('No SVG element found'))
    svgElToPngBlob(svgEl as SVGSVGElement, theme).then(resolve, reject)
  })
}

/**
 * For Mermaid diagrams: use the live DOM element (avoids DOMParser re-parsing
 * issues with mermaid-generated SVG strings).
 */
export function svgDomToPngBlob(container: HTMLElement): Promise<Blob> {
  const svgEl = container.querySelector('svg')
  if (!svgEl) return Promise.reject(new Error('No SVG element found'))
  return svgElToPngBlob(svgEl as SVGSVGElement)
}
