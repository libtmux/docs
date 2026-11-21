/**
 * The link every heading carries after its text, on every page family (design record 0006): one link icon, muted and
 * always visible, stronger on hover, focus and `:target`. A click copies the section's URL and the browser still follows
 * the link, so the hash is set and the section scrolled to. `HeadingLink.astro` draws it for components, the Markdown
 * pipeline draws it through `headingLinkContent`, and `bindHeadingLinks` is the one click handler for all of them.
 */

/** The two arcs of the link glyph, in a 16 x 16 box. */
export const HEADING_LINK_PATHS = [
  'M6.6 9.4a2.8 2.8 0 0 0 4 0l2.2-2.2a2.8 2.8 0 0 0-4-4l-.9.9',
  'M9.4 6.6a2.8 2.8 0 0 0-4 0L3.2 8.8a2.8 2.8 0 0 0 4 4l.9-.9',
]

/** The icon as hast, for `rehype-autolink-headings`. */
export function headingLinkContent() {
  return [{
    type: 'element' as const,
    tagName: 'svg',
    properties: {
      className: ['heading-link__icon'], width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.6, strokeLinecap: 'round', ariaHidden: 'true', focusable: 'false',
    },
    children: HEADING_LINK_PATHS.map((d) => ({ type: 'element' as const, tagName: 'path', properties: { d }, children: [] })),
  }]
}

/** The options `rehype-autolink-headings` takes to append the link to every Markdown heading. */
export const HEADING_LINK_AUTOLINK = {
  behavior: 'append' as const,
  properties: { className: ['heading-link'], ariaLabel: 'Link to this section', dataPagefindIgnore: 'all' },
  content: headingLinkContent,
}

/** How long "Copied" stays on the icon. */
const SHOWN_MS = 1500
const STATUS_ID = 'heading-link-status'

const visuallyHidden = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap'

/** The polite live region that announces a copy; the body is replaced by a page swap, so it is looked up each time. */
function status(doc: Document): HTMLElement {
  let region = doc.getElementById(STATUS_ID)
  if (!region) {
    region = doc.createElement('div')
    region.id = STATUS_ID
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.setAttribute('style', visuallyHidden)
    region.setAttribute('data-pagefind-ignore', 'all')
    doc.body.append(region)
  }
  return region
}

async function copy(doc: Document, text: string): Promise<boolean> {
  try {
    await doc.defaultView!.navigator.clipboard.writeText(text)
    return true
  } catch {
    // No async clipboard (an insecure origin, a denied permission): select the text in a scratch field and copy it.
    const field = doc.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.setAttribute('style', visuallyHidden)
    doc.body.append(field)
    field.select()
    try { return doc.execCommand('copy') } catch { return false } finally { field.remove() }
  }
}

/**
 * Copy the URL of the section a heading link names when it is clicked. One listener on the document serves every page,
 * so it needs no rebinding after a client-side page swap. A modified click, which opens a tab or window, copies nothing.
 */
export function bindHeadingLinks(doc: Document): () => void {
  const win = doc.defaultView!
  const timers = new WeakMap<Element, number>()
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof win.Element ? event.target.closest<HTMLAnchorElement>('a.heading-link') : null
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    // Resolved before the browser follows the link, against the page the reader is on.
    const url = new win.URL(link.getAttribute('href') ?? '', win.location.href).href
    void copy(doc, url).then((copied) => {
      link.dataset.copied = String(copied)
      win.clearTimeout(timers.get(link))
      timers.set(link, win.setTimeout(() => { delete link.dataset.copied }, SHOWN_MS))
      // A repeated copy says the same words again; a trailing no-break space makes each one a change worth announcing.
      const region = status(doc)
      const text = copied ? 'Link copied' : 'Copy failed'
      region.textContent = region.textContent === text ? `${text}\u00a0` : text
    })
  }
  // Capturing, and indifferent to `defaultPrevented`: the router and the member list cancel a same-page link's own navigation
  // to scroll to it themselves, and a copy must not depend on which of them did.
  doc.addEventListener('click', onClick, true)
  return () => doc.removeEventListener('click', onClick, true)
}
