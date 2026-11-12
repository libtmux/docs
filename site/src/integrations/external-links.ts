import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AstroIntegration } from 'astro'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const PRODUCTION_ORIGIN = 'https://libtmux.org'
/** Elements that `installExternalLinks` treats as a link's icon, not its label. */
const MEDIA = new Set(['svg', 'img', 'picture', 'canvas'])
/** A page with no absolute or protocol-relative `href` has nothing to mark. */
const MAYBE_EXTERNAL = /\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i

// An SVG link's `xlink:href` has the local name `href` too, but `getAttribute('href')` does not read it.
const attribute = (element: Element, name: string) => element.attrs.find((attr) => attr.name === name && !attr.prefix)?.value
const hasAttribute = (element: Element, name: string) => element.attrs.some((attr) => attr.name === name && !attr.prefix)
const isElement = (node: Node): node is Element => 'tagName' in node
const childrenOf = (node: Node) => ('childNodes' in node ? node.childNodes : [])

/** An element the runtime strips before it reads a link's label. */
function isDecoration(element: Element): boolean {
  return MEDIA.has(element.tagName) || hasAttribute(element, 'hidden') || attribute(element, 'aria-hidden') === 'true'
    || (attribute(element, 'class')?.split(/\s+/).some((name) => name === 'sr-only' || name === 'visually-hidden') ?? false)
}

function hasMedia(node: Node): boolean {
  return childrenOf(node).some((child) => isElement(child) && (MEDIA.has(child.tagName) || hasMedia(child)))
}

function labelText(node: Node): string {
  return childrenOf(node).map((child) => {
    if (isElement(child)) return isDecoration(child) ? '' : labelText(child)
    return 'value' in child && child.nodeName === '#text' ? child.value : ''
  }).join('')
}

/** The same rule as `iconOnly` in `public/_shell/external-links.js`: a link with an icon and no visible text. */
function isIconOnly(link: Element): boolean {
  return hasMedia(link) && labelText(link).trim() === ''
}

/** The attribute text to insert after the link's last attribute, and where; none when the link needs nothing. */
function markLink(link: Element, internal: ReadonlySet<string>): [number, string] | undefined {
  const href = attribute(link, 'href')
  const attrs = link.sourceCodeLocation?.attrs
  if (href === undefined || !attrs) return
  let url: URL
  try { url = new URL(href, PRODUCTION_ORIGIN) } catch { return }
  if (!/^https?:$/.test(url.protocol) || internal.has(url.origin)) return
  const added = (hasAttribute(link, 'data-external-link') ? '' : ` data-external-link="${url.hostname}"`)
    + (!hasAttribute(link, 'data-external-link-icon') && isIconOnly(link) ? ' data-external-link-icon' : '')
  if (!added) return
  return [Math.max(...Object.values(attrs).map((location) => location.endOffset)), added]
}

/**
 * Mark the links that leave the site, in the HTML itself.
 *
 * The glyph rule in `public/_shell/external-links.css` matches `a[data-external-link]`, and
 * `installExternalLinks` sets that attribute once the page has parsed. A link the parser has already
 * painted then grows its glyph and pushes the text after it. Writing the attributes into the built
 * HTML puts the glyph in the first layout. The runtime still adds the title and description, and
 * marks links that arrive later, using the same origin and icon-only rules.
 *
 * `site` is the build's own origin. `https://libtmux.org` is always internal too, so a preview
 * published under a path prefix does not mark links to the production site. Only the attributes are
 * inserted; the rest of the page is returned byte for byte, and a marked page is returned unchanged.
 */
export function markExternalLinks(html: string, site: string = PRODUCTION_ORIGIN): string {
  if (!MAYBE_EXTERNAL.test(html)) return html
  const internal = new Set([new URL(site).origin, PRODUCTION_ORIGIN])
  const tree = parse(html, { scriptingEnabled: false, sourceCodeLocationInfo: true })
  // Keyed by offset: the parser may clone an element it reconstructs, and both copies share one start tag.
  const edits = new Map<number, string>()
  const visit = (node: Node) => {
    if (isElement(node) && node.tagName === 'a') {
      const edit = markLink(node, internal)
      if (edit) edits.set(edit[0], edit[1])
    }
    if ('content' in node) visit(node.content)
    childrenOf(node).forEach(visit)
  }
  visit(tree)
  if (edits.size === 0) return html
  const pieces: string[] = []
  let from = 0
  for (const [offset, text] of [...edits].sort((a, b) => a[0] - b[0])) {
    pieces.push(html.slice(from, offset), text)
    from = offset
  }
  pieces.push(html.slice(from))
  return pieces.join('')
}

/** Mark every built page under `directory`, and return how many changed. */
export function markExternalLinksIn(directory: string, site?: string): number {
  let marked = 0
  for (const page of (readdirSync(directory, { recursive: true }) as string[]).filter((file) => file.endsWith('.html'))) {
    const path = join(directory, page)
    const html = readFileSync(path, 'utf8')
    const next = markExternalLinks(html, site)
    if (next === html) continue
    writeFileSync(path, next)
    marked++
  }
  return marked
}

/** Mark the links that leave the site on every page of the build, so the glyph is in the first paint. */
export function externalLinks(): AstroIntegration {
  let site = PRODUCTION_ORIGIN
  return {
    name: 'libtmux:external-links',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site ?? PRODUCTION_ORIGIN
      },
      'astro:build:done': ({ dir, logger }) => {
        logger.info(`${markExternalLinksIn(fileURLToPath(dir), site)} pages carry the external-link marker in their HTML`)
      },
    },
  }
}
