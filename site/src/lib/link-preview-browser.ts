import type { LinkPreview } from './link-preview'
import { linkPreviewTarget, linkPreviewCandidate } from './link-preview-paint'
export { linkPreviewTarget } from './link-preview-paint'

const cache = new Map<string, LinkPreview>()
let dispose = () => {}

/** Keep keyword help and fetched previews inside the same viewport gutter. */
export function positionLinkPreview(panel: HTMLElement, trigger: HTMLElement) {
  if (!trigger.isConnected || !panel.matches(':popover-open')) return
  const anchor = trigger.getBoundingClientRect(), box = panel.getBoundingClientRect()
  const viewport = document.documentElement.getBoundingClientRect(), gap = 8
  const left = Math.max(viewport.left + gap, Math.min(anchor.left, viewport.right - box.width - gap))
  const below = anchor.bottom + gap
  const top = Math.max(gap, Math.min(below + box.height <= innerHeight - gap ? below : anchor.top - box.height - gap, innerHeight - box.height - gap))
  Object.assign(panel.style, { inset: 'auto', margin: '0', left: `${left}px`, top: `${top}px` })
}

function validPreview(value: unknown): value is LinkPreview {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<LinkPreview>
  return data.schema === 1 && typeof data.title === 'string' && typeof data.description === 'string'
    && typeof data.href === 'string' && (!data.detail || typeof data.detail === 'string')
    && (!data.signature || typeof data.signature === 'string')
}

export function disposeLinkPreviews() { dispose(); dispose = () => {} }

/** One cached card follows the current intent; late responses cannot replace it. */
export function initLinkPreviews() {
  disposeLinkPreviews()
  const panel = document.getElementById('reference-link-preview')
  if (!panel || !panel.showPopover) return
  const controller = new AbortController(), { signal } = controller
  const pending = new Map<string, Promise<LinkPreview>>()
  let current: HTMLAnchorElement | undefined
  let intent = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  let pinned = false, restoringFocus = false, shown = false
  const close = (restoreFocus = false) => {
    clearTimeout(timer); clearTimeout(closeTimer); intent++
    const trigger = current
    current = undefined; pinned = false; shown = false
    if (panel.matches(':popover-open')) panel.hidePopover()
    trigger?.removeAttribute('aria-details')
    if (restoreFocus && trigger?.isConnected) {
      restoringFocus = true; trigger.focus({ preventScroll: true }); restoringFocus = false
    }
  }
  dispose = () => { close(); controller.abort() }
  const place = () => { if (current) positionLinkPreview(panel, current) }
  const candidate = (target: EventTarget | null) => linkPreviewCandidate(target, location.href)
  // Signal the same preview behavior on every eligible link without fetching it.
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.closest('.api-index-card')) {
      delete link.dataset.linkPreview
      continue
    }
    if (candidate(link)) link.dataset.linkPreview = ''
  }
  const load = (endpoint: string) => {
    if (cache.has(endpoint)) return Promise.resolve(cache.get(endpoint)!)
    if (pending.has(endpoint)) return pending.get(endpoint)!
    const request = fetch(endpoint, { signal }).then(async (response) => {
      if (!response.ok) throw new Error('Preview unavailable')
      const value: unknown = await response.json()
      if (!validPreview(value)) throw new Error('Invalid preview')
      if (!signal.aborted) {
        cache.set(endpoint, value)
        if (cache.size > 64) cache.delete(cache.keys().next().value!)
      }
      return value
    }).finally(() => pending.delete(endpoint))
    pending.set(endpoint, request)
    return request
  }
  const show = async (link: HTMLAnchorElement, focus = false) => {
    const target = linkPreviewTarget(link.href, location.origin)
    if (!target) return
    close()
    const ticket = ++intent
    current = link; pinned = focus
    try {
      let preview = await load(target.endpoint)
      const fragment = decodeURIComponent(target.url.hash.slice(1))
      if (preview.terms && Object.hasOwn(preview.terms, fragment)) preview = preview.terms[fragment]
      if (ticket !== intent || signal.aborted || !link.isConnected) return
      if (!validPreview(preview)) throw new Error('Invalid preview')
      const destination = new URL(preview.href, location.origin)
      if (destination.origin !== location.origin) throw new Error('Invalid destination')
      if (target.url.hash) destination.hash = target.url.hash
      panel.querySelector('[data-preview-title]')!.textContent = preview.title
      panel.querySelector('[data-preview-description]')!.textContent = preview.description || 'Read the reference for this declaration.'
      for (const field of ['detail', 'signature'] as const) {
        const element = panel.querySelector<HTMLElement>(`[data-preview-${field}]`)!
        element.textContent = preview[field] ?? ''; element.hidden = !preview[field]
      }
      const open = panel.querySelector<HTMLAnchorElement>('[data-preview-open]')!
      open.href = destination.href
      panel.setAttribute('aria-label', `${preview.title} preview`)
      link.setAttribute('aria-details', panel.id)
      panel.showPopover({ source: link }); shown = true; place()
      if (focus) open.focus()
    } catch {
      if (ticket !== intent || signal.aborted) return
      close()
      // Failed previews retain the link's real destination, including its fragment.
      if (focus) location.assign(link.href)
    }
  }
  const schedule = (link: HTMLAnchorElement | undefined) => {
    if (!link || pinned || restoringFocus) return
    clearTimeout(timer); clearTimeout(closeTimer)
    if (current === link) return
    // A new target owns the intent immediately, even while its dwell timer runs.
    close()
    timer = setTimeout(() => { void show(link) }, 180)
  }
  const dismissUnused = () => {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      if (!pinned && !panel.matches(':hover, :focus-within') && !current?.matches(':hover, :focus')) close()
    }, 180)
  }
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') schedule(candidate(event.target))
  }, { signal })
  document.addEventListener('focusin', (event) => {
    if (restoringFocus || (event.target instanceof Node && panel.contains(event.target))) return
    const link = candidate(event.target)
    if (link) schedule(link)
    else close()
  }, { signal })
  document.addEventListener('beforetoggle', (event) => {
    if ((event as ToggleEvent).newState === 'open' && event.target instanceof Element
      && event.target !== panel && event.target.matches('.reference-link-preview')) close()
  }, { signal, capture: true })
  document.addEventListener('pointerout', (event) => {
    const link = candidate(event.target)
    if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) clearTimeout(timer)
    dismissUnused()
  }, { signal })
  document.addEventListener('focusout', dismissUnused, { signal })
  document.addEventListener('click', (event) => {
    const link = candidate(event.target)
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (linkPreviewTarget(link.href, location.origin)?.glossary) { event.preventDefault(); void show(link, true) }
    else close()
  // Intercept glossary activation before Astro's document-level navigation handler.
  }, { signal, capture: true })
  panel.querySelector('[data-preview-close]')!.addEventListener('click', () => close(true), { signal })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (current || panel.matches(':popover-open'))) { event.preventDefault(); close(pinned) }
  }, { signal, capture: true })
  panel.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed' && shown && !panel.matches(':popover-open')) close()
  }, { signal })
  window.addEventListener('resize', place, { signal })
  window.addEventListener('scroll', place, { signal, passive: true, capture: true })
}
