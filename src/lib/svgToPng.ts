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

const SVG_NS = 'http://www.w3.org/2000/svg'

function detaintSvgString(svgStr: string): string {
  return svgStr
    .replace(/@import\s[^;]+;/g, '')
    .replace(/@font-face\s*\{[^{}]*\}/gs, '')
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type StyledLine = { text: string; bold: boolean; fontSize: number }

function walkHtml(el: Element, lines: StyledLine[]): void {
  const tag = el.tagName.toLowerCase()
  if (tag === 'h1') {
    const t = el.textContent?.trim() ?? ''
    if (t) lines.push({ text: t, bold: true, fontSize: 20 })
  } else if (tag === 'h2') {
    const t = el.textContent?.trim() ?? ''
    if (t) lines.push({ text: t, bold: true, fontSize: 16 })
  } else if (tag === 'h3') {
    const t = el.textContent?.trim() ?? ''
    if (t) lines.push({ text: t, bold: true, fontSize: 14 })
  } else if (tag === 'p') {
    const t = el.textContent?.trim() ?? ''
    if (t) lines.push({ text: t, bold: false, fontSize: 13 })
  } else if (tag === 'li') {
    const t = el.textContent?.trim() ?? ''
    if (t) lines.push({ text: '• ' + t, bold: false, fontSize: 13 })
  } else {
    for (const child of Array.from(el.children)) walkHtml(child, lines)
  }
}

/**
 * String-level <foreignObject> replacement for the D2 path.
 * Runs before DOMParser so the canvas never sees <foreignObject>.
 * Inner HTML is re-parsed with text/html so <h2>, <li> etc. are real elements.
 */
function replaceForeignObjectsInString(svgStr: string): string {
  // D2 hardcodes fill="..." directly on <text> elements; grab the first one.
  const colorMatch =
    svgStr.match(/class="[^"]*\btext\b[^"]*"[^>]*fill="([^"]+)"/) ??
    svgStr.match(/fill="([^"]+)"[^>]*class="[^"]*\btext\b[^"]*"/)
  const textColor = colorMatch?.[1] ?? '#000000'

  return svgStr.replace(
    /<foreignObject([^>]*)>([\s\S]*?)<\/foreignObject>/g,
    (_, attrs, innerHtml) => {
      const get = (name: string) => {
        const m = new RegExp(`\\b${name}="([^"]+)"`).exec(attrs)
        return m ? parseFloat(m[1]) : 0
      }
      const foX = get('x'), foY = get('y'), foW = get('width'), foH = get('height')
      const cx = foX + foW / 2

      const htmlDoc = new DOMParser().parseFromString(innerHtml, 'text/html')
      const lines: StyledLine[] = []
      for (const child of Array.from(htmlDoc.body.children)) walkHtml(child, lines)

      if (!lines.length) return ''

      const lineHeight = 18
      const totalH = lines.length * lineHeight
      let curY = foY + (foH - totalH) / 2 + lineHeight * 0.8

      return lines.map(line => {
        const y = curY; curY += lineHeight
        return `<text x="${cx}" y="${y}" text-anchor="middle" font-size="${line.fontSize}" font-family="sans-serif" fill="${textColor}"${line.bold ? ' font-weight="bold"' : ''}>${escapeXml(line.text)}</text>`
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

function svgElToPngBlob(svgEl: SVGSVGElement): Promise<Blob> {
  const clone = svgEl.cloneNode(true) as SVGSVGElement

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
export function svgToPngBlob(svgContent: string): Promise<Blob> {
  const cleaned = replaceForeignObjectsInString(detaintSvgString(svgContent))
  return new Promise((resolve, reject) => {
    const parser = new DOMParser()
    const doc = parser.parseFromString(cleaned, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')
    if (!svgEl) return reject(new Error('No SVG element found'))
    svgElToPngBlob(svgEl as SVGSVGElement).then(resolve, reject)
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
