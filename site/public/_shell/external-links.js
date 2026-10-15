/** One external-destination hint for Astro, Markdown and native documentation. */
export function installExternalLinks(win = window) {
  const doc = win.document
  const originals = new Map()
  const iconOnly = (link) => {
    if (!link.querySelector('svg, img, picture, canvas')) return false
    const label = link.cloneNode(true)
    label.querySelectorAll('svg, img, picture, canvas, [hidden], [aria-hidden="true"], .sr-only, .visually-hidden')
      .forEach((node) => node.remove())
    return !label.textContent.trim()
  }
  const restore = (link) => {
    const original = originals.get(link)
    if (!original) return
    for (const [name, value] of Object.entries(original)) {
      if (value === null) link.removeAttribute(name)
      else link.setAttribute(name, value)
    }
    link.removeAttribute('data-external-link')
    link.removeAttribute('data-external-link-icon')
    originals.delete(link)
  }
  const decorate = (link) => {
    if (!link.hasAttribute('href')) { restore(link); return }
    let url
    try { url = new URL(link.getAttribute('href'), doc.baseURI) } catch { restore(link); return }
    if (!/^https?:$/.test(url.protocol) || url.origin === win.location.origin) { restore(link); return }
    if (!originals.has(link)) originals.set(link, {
      title: link.getAttribute('title'),
      'aria-description': link.getAttribute('aria-description'),
    })
    const original = originals.get(link)
    const destination = `View on ${url.hostname}`
    link.setAttribute('data-external-link', url.hostname)
    link.toggleAttribute('data-external-link-icon', iconOnly(link))
    link.setAttribute('title', original.title ? `${destination} — ${original.title}` : destination)
    link.setAttribute('aria-description', [original['aria-description'], `External site: ${url.hostname}`].filter(Boolean).join('. '))
  }
  const scan = (node) => {
    if (node.nodeType !== 1 && node.nodeType !== 9) return
    if (node.matches?.('a[href]')) decorate(node)
    node.querySelectorAll('a[href]').forEach(decorate)
  }
  scan(doc)
  const observer = new win.MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach(scan)
        for (const node of record.removedNodes) {
          if (node.nodeType === 1) for (const link of originals.keys()) if (node.contains(link)) restore(link)
        }
      }
      const link = record.target.closest?.('a') ?? record.target.parentElement?.closest('a')
      if (link) decorate(link)
    }
  })
  observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['href', 'class', 'hidden', 'aria-hidden'] })
  return () => { observer.disconnect(); for (const link of originals.keys()) restore(link) }
}

if (typeof window !== 'undefined') {
  let cleanup
  const boot = () => {
    cleanup?.()
    cleanup = installExternalLinks(window)
    document.dispatchEvent(new CustomEvent('libtmux:external-links-ready', {
      detail: { generation: document.documentElement.dataset.linkHintsGeneration, href: location.href },
    }))
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
  else boot()
  document.addEventListener('astro:page-load', boot)
  document.addEventListener('astro:before-swap', () => cleanup?.())
}
