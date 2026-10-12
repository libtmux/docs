/** Shared eligibility for the early visual state and deferred preview behavior. */
export function createLinkPreviewPolicy() {
  function target(href: string, origin: string) {
    let url: URL
    try { url = new URL(href, origin) } catch { return undefined }
    const reference = /\/reference\/[^/]+\/$/.test(url.pathname)
    const protocolObject = /\/mcp\/(?:tools\/[^/]+|prompts\/[^/]+|resources\/(?:templates\/)?[^/]+)\/$/.test(url.pathname)
      && !url.pathname.endsWith('/mcp/resources/templates/')
    if (url.origin !== origin || url.search || (!reference && !protocolObject)) return undefined
    return { url, endpoint: `${url.pathname.slice(0, -1)}.preview.json`, glossary: url.pathname.endsWith('/reference/glossary/') }
  }
  function candidate(eventTarget: EventTarget | null, base: string): HTMLAnchorElement | undefined {
    const link = eventTarget instanceof Element ? eventTarget.closest<HTMLAnchorElement>('a[href]') : null
    if (!link || link.matches('[data-preview-skip], [href^="#"], .api-heading-link, .api-index-card__link, .headerlink')
      || link.closest('nav, footer, [data-doc-picker], .api-index-card, .reference-link-preview')) return undefined
    try {
      const url = new URL(link.getAttribute('href')!, base)
      return target(url.href, new URL(base).origin) ? link : undefined
    } catch { return undefined }
  }
  function mark(link: HTMLAnchorElement) {
    link.dataset.linkPreview = ''
    // Empty titles also suppress tooltips inherited from enclosing elements.
    // Keep the visible name, explicit accessible label, and real link destination.
    link.title = ''
    for (const child of link.querySelectorAll('[title]')) child.removeAttribute('title')
  }
  return { target, candidate, mark }
}

export const { target: linkPreviewTarget, candidate: linkPreviewCandidate, mark: markLinkPreview } = createLinkPreviewPolicy()

/** Serialized into the shared head; keep dependencies in the supplied policy. */
export function initializeLinkPreviewPaint(policy: ReturnType<typeof createLinkPreviewPolicy>) {
  if (typeof HTMLElement.prototype.showPopover !== 'function') return
  function mark(root: Document | Element, base: string) {
    const enclosing = root instanceof Element ? root.closest<HTMLAnchorElement>('a[href]') : null
    const links = enclosing
      ? [enclosing, ...root.querySelectorAll<HTMLAnchorElement>('a[href]')]
      : root.querySelectorAll<HTMLAnchorElement>('a[href]')
    for (const link of links) {
      if (link.closest('.api-index-card')) delete link.dataset.linkPreview
      else if (policy.candidate(link, base)) policy.mark(link)
    }
  }
  if (document.documentElement.hasAttribute('data-reference-previews')) {
    mark(document, location.href)
    if (document.readyState === 'loading') {
      // Observe parsed subtrees, without rescanning anchors already encountered.
      const observe = (records: MutationRecord[]) => {
        const added = new Set<Element>()
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element) added.add(node)
        }
        for (const node of added) {
          let ancestor = node.parentElement
          while (ancestor && !added.has(ancestor)) ancestor = ancestor.parentElement
          if (!ancestor) mark(node, location.href)
        }
      }
      const observer = new MutationObserver(observe)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      document.addEventListener('DOMContentLoaded', () => {
        observe(observer.takeRecords())
        observer.disconnect()
      }, { once: true })
    }
  }
  // NativeShell shares this startup script but does not enable previews itself.
  document.addEventListener('astro:before-swap', (event) => {
    if (event.newDocument.documentElement.hasAttribute('data-reference-previews')) {
      mark(event.newDocument, event.to.href)
    }
  })
}
