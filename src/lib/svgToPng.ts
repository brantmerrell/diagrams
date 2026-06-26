/**
 * Chromium taints the canvas for SVGs that contain:
 *   1. @font-face rules with data-URI fonts
 *   2. <foreignObject> elements (always tainted, regardless of content)
 *
 * Strategy:
 *   - Apply string-level @font-face stripping to the RAW SVG string BEFORE
 *     DOMParser touches it — this is confirmed to work at the string level and
 *     sidesteps any DOMParser/XMLSerializer CDATA round-trip surprises.
 *   - After cloning, remove <foreignObject> elements (replacing with SVG <text>
 *     so labels are preserved as plain text).
 *   - Apply string-level stripping again after XMLSerializer as a final fallback.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

function detaintSvgString(svgStr: string): string {
  return svgStr
    .replace(/@import\s[^;]+;/g, '')
    .replace(/@font-face\s*\{[^{}]*\}/gs, '')
}

/** Replace each <foreignObject> with a plain SVG <text> so text labels survive. */
function replaceForeignObjects(clone: SVGSVGElement): void {
  for (const fo of Array.from(clone.querySelectorAll('foreignObject'))) {
    const rawText = fo.textContent?.replace(/\s+/g, ' ').trim() ?? ''
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
    text.setAttribute('fill', 'currentColor')

    // Split on real newlines or double-space from collapsed whitespace
    const lines = rawText.split(/\n/)
    if (lines.length === 1) {
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
 * For D2 diagrams: strip @font-face from the raw string FIRST (before DOMParser),
 * then proceed with DOM-level foreignObject replacement and serialization.
 */
export function svgToPngBlob(svgContent: string): Promise<Blob> {
  // Apply string-level strip BEFORE DOMParser so no @font-face reaches the DOM
  const cleaned = detaintSvgString(svgContent)
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

