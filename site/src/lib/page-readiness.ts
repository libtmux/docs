type Appearance = {
  wait: (work: Promise<unknown>) => void
  layout: (work: () => void) => void
}

declare global {
  interface Window { __libtmuxAppearance?: Appearance }
}

/** Include asynchronous initial state in the page's first visible appearance. */
export function waitForAppearance(work: Promise<unknown>) {
  if (window.__libtmuxAppearance) window.__libtmuxAppearance.wait(work)
  else void work.catch((error: unknown) => console.error(error))
}

/** Measure connected initial state after required scripts, effects, and fonts. */
export function layoutBeforeAppearance(work: () => void) {
  if (window.__libtmuxAppearance) window.__libtmuxAppearance.layout(work)
  else work()
}

/** Serialized into the shared head, before required modules can load or fail. */
export function initializePageReadiness(decorate: (win: Window) => unknown, mask: string) {
  const root = document.documentElement
  const pending = new Set<Promise<void>>()
  const layouts = new Set<() => void>()
  const observed = new WeakSet<Element>()
  const loaded = new WeakSet<Element>()
  const resources = new WeakMap<Element, { resolve: () => void; reject: () => void }>()
  const watchedFonts = new WeakSet<FontFace>()
  const decoded = new Set<string>()
  const decodedImages = new WeakMap<HTMLImageElement, string>()
  let revision = 0
  let parsed = false
  let finished = false
  let failure: unknown
  let outlet: HTMLElement | undefined
  root.dataset.pageReadiness = 'pending'
  root.classList.add('fonts-pending', 'link-hints-pending')

  const showFailure = () => {
    if (!document.body || outlet) return
    outlet = document.createElement('div')
    outlet.id = 'page-load-status'
    outlet.setAttribute('role', 'alert')
    outlet.textContent = 'This page could not finish loading. '
    const reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Reload'
    reload.addEventListener('click', () => location.reload())
    outlet.append(reload)
    document.body.append(outlet)
  }
  const fail = (error: unknown) => {
    if (finished || failure) return
    failure = error || new Error('Required appearance failed')
    console.error('Page appearance failed', failure)
    root.dataset.pageReadiness = 'failed'
    showFailure()
  }
  const wait = (work: Promise<unknown>) => {
    if (finished) { void work.catch((error: unknown) => console.error(error)); return }
    revision++
    const task = Promise.resolve(work).then(() => {}, fail).finally(() => pending.delete(task))
    pending.add(task)
  }
  window.__libtmuxAppearance = {
    wait,
    layout: (work) => {
      if (finished) work()
      else if (!layouts.has(work)) { revision++; layouts.add(work) }
    },
  }
  const watchFonts = () => {
    for (const face of document.fonts) {
      // Astro's metric fallbacks use optional local Arial/Courier faces.
      if (face.family.includes(' fallback: ')) continue
      if (face.status === 'error') fail(new Error('Required font failed'))
      if (watchedFonts.has(face)) continue
      watchedFonts.add(face)
      // Observe failure independently of fonts.ready: another held face must
      // not postpone the recovery outlet. Unused faces do not delay readiness.
      void face.loaded?.catch(fail)
    }
  }
  document.fonts.addEventListener('loading', watchFonts)

  // Resource discovery precedes module execution; a missing registration cannot
  // make a delayed or failed module appear ready. Analytics is optional.
  const observe = (element: Element) => {
    if (observed.has(element)) return
    observed.add(element)
    if (element instanceof HTMLScriptElement) {
      if (!element.src || element.hasAttribute('data-cf-beacon') ||
          (element.src && new URL(element.src).hostname === 'static.cloudflareinsights.com')) return
      if (element.type && !['module', 'text/javascript', 'application/javascript'].includes(element.type)) return
    } else if (element instanceof HTMLLinkElement) {
      if (element.rel !== 'stylesheet' || element.sheet ||
          (element.media && !matchMedia(element.media).matches)) return
    } else return
    if (loaded.has(element)) return
    wait(new Promise<void>((resolve, reject) => {
      resources.set(element, { resolve, reject: () => reject(new Error('Required resource failed')) })
    }))
  }
  document.addEventListener('load', (event) => {
    if (!(event.target instanceof Element)) return
    loaded.add(event.target)
    resources.get(event.target)?.resolve()
    watchFonts()
  }, true)
  document.addEventListener('error', (event) => {
    if (!(event.target instanceof Element)) return
    observe(event.target)
    resources.get(event.target)?.reject()
  }, true)
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return
    observe(node)
    node.querySelectorAll('script, link[rel="stylesheet"]').forEach(observe)
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(scan)
    if (failure) showFailure()
  })
  observer.observe(root, { childList: true, subtree: true })
  root.querySelectorAll('script, link[rel="stylesheet"]').forEach(observe)
  window.addEventListener('error', (event) => {
    if (event instanceof ErrorEvent && event.error &&
        !event.filename.includes('cloudflareinsights.com')) fail(event.error)
  })

  try { decorate(window) } catch (error) { fail(error) }
  const image = new Image()
  image.src = mask
  wait(image.decode())

  const drain = async () => {
    while (pending.size && !failure) await Promise.all(pending)
  }
  const decodeImages = () => {
    for (const image of document.images) {
      const source = image.currentSrc || image.src
      if (!source || image.loading === 'lazy' || decodedImages.get(image) === source) continue
      decodedImages.set(image, source)
      wait(image.decode())
    }
    const urls = new Set<string>()
    const visit = (sheet: CSSStyleSheet, base = sheet.href || location.href) => {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSImportRule) {
          if (!rule.styleSheet) throw new Error('Required stylesheet import failed')
          visit(rule.styleSheet)
        }
        else if ('cssRules' in rule) visit(rule as unknown as CSSStyleSheet, base)
        else if (rule instanceof CSSStyleRule) {
          for (const property of ['background', 'background-image', 'mask', 'mask-image', '-webkit-mask-image', 'content', 'list-style-image']) {
            const value = rule.style.getPropertyValue(property)
            for (const match of value.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)]*?))\s*\)/g)) {
              urls.add(new URL(match[1] ?? match[2] ?? match[3], base).href)
            }
          }
        }
      }
    }
    Array.from(document.styleSheets).forEach((sheet) => visit(sheet))
    for (const url of urls) {
      if (decoded.has(url)) continue
      decoded.add(url)
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.src = url
      wait(image.decode())
    }
  }
  const complete = async () => {
    if (parsed) return
    parsed = true
    observer.takeRecords().forEach((record) => record.addedNodes.forEach(scan))
    try {
      // Registered work can add resources or layout during font loading. Reach
      // a completed dependency graph, rather than assume a fixed phase count.
      while (!failure) {
        const before = revision
        await drain()
        decodeImages()
        await drain()
        void document.body.offsetHeight
        watchFonts()
        await document.fonts.ready
        watchFonts()
        const callbacks = [...layouts]
        layouts.clear()
        for (const layout of callbacks) layout()
        observer.takeRecords().forEach((record) => record.addedNodes.forEach(scan))
        // Layout may introduce images or change which fonts are used. Verify
        // that result in another pass even when it registered no new tasks.
        if (!callbacks.length && before === revision && !pending.size && !layouts.size) break
      }
      if (failure) return
      finished = true
      observer.disconnect()
      root.dataset.pageReadiness = 'ready'
      root.classList.remove('fonts-pending', 'link-hints-pending')
      document.dispatchEvent(new CustomEvent('libtmux:page-ready'))
    } catch (error) { fail(error) }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'loading') void complete()
    })
  } else void complete()
}
