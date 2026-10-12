/** Keep external hints ready at reveal; deferred behavior still owns decoration. */
export function initializeLinkHintReadiness() {
  let generation = 0
  type Gate = {
    token: string
    root: HTMLElement
    href: string
    decorated: boolean
    maskReady: boolean
    settled: boolean
    timer: ReturnType<typeof setTimeout>
  }
  let current: Gate
  const pageHref = (href: string) => {
    const url = new URL(href)
    url.hash = ''
    return url.href
  }
  const roots = (gate: Gate) => {
    const live = document.documentElement
    return live.dataset.linkHintsGeneration === gate.token ? [gate.root, live] : [gate.root]
  }
  const finish = (gate: Gate, ready: boolean) => {
    if (current !== gate || gate.settled) return
    gate.settled = true
    clearTimeout(gate.timer)
    for (const root of roots(gate)) {
      root.classList.toggle('link-hints-suppressed', !ready)
      root.classList.remove('link-hints-pending')
    }
  }
  const revealIfReady = (gate: Gate) => {
    if (gate.decorated && gate.maskReady) finish(gate, true)
  }
  const begin = (doc: Document, href: string) => {
    if (current) clearTimeout(current.timer)
    const root = doc.documentElement
    const gate: Gate = {
      token: String(++generation),
      root,
      href: pageHref(href),
      decorated: false,
      maskReady: false,
      settled: false,
      timer: setTimeout(() => finish(gate, false), 3000),
    }
    current = gate
    root.dataset.linkHintsGeneration = gate.token
    root.classList.remove('link-hints-suppressed')
    root.classList.add('link-hints-pending')
    const mask = doc.querySelector<HTMLLinkElement>('link[data-link-hints-mask]')
    if (!mask) {
      finish(gate, false)
      return
    }
    const image = new Image()
    // CSS masks use CORS fetches; share their decoded cache entry.
    image.crossOrigin = 'anonymous'
    image.onerror = () => finish(gate, false)
    image.onload = () => {
      // Loading the bytes is not sufficient: wait until the mask can paint.
      const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve()
      decoded.then(
        () => {
          gate.maskReady = true
          revealIfReady(gate)
        },
        () => finish(gate, false),
      )
    }
    image.src = new URL(mask.getAttribute('href')!, href).href
  }
  document.addEventListener('libtmux:external-links-ready', (event: Event) => {
    const detail = (event as CustomEvent<{ generation: string; href: string }>).detail
    if (!detail || detail.generation !== current.token || pageHref(detail.href) !== current.href) return
    current.decorated = true
    revealIfReady(current)
  })
  document.addEventListener(
    'error',
    (event) => {
      if (
        event.target instanceof HTMLScriptElement &&
        event.target.isConnected &&
        event.target.hasAttribute('data-link-hints-module')
      )
        finish(current, false)
    },
    true,
  )
  document.addEventListener('astro:before-swap', (event) => begin(event.newDocument, event.to.href))
  begin(document, location.href)
}
