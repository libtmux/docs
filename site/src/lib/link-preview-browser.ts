import type { LinkPreview } from './link-preview'
import type { CodeHighlight } from './highlight'
import { linkPreviewTarget, linkPreviewCandidate, linkPreviewBlockLink, markLinkPreview } from './link-preview-paint'
import { abbreviateNamespace, kindMark, markClass } from './api-labels'
import { wordBreak } from './word-break'
import { limitPreviewSignature } from './preview-signature'
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
    && (!data.actionLabel || typeof data.actionLabel === 'string')
    && (!data.signature || typeof data.signature === 'string')
}

/**
 * The card's header carries the kind as the legend chip, the same token a
 * heading uses: the mark and the word in one box. A term that is not a kind
 * (a glossary entry such as "inherited") gets no chip.
 */
export function renderPreviewKind(slot: HTMLElement | null, kind?: string) {
  if (!slot) return
  slot.replaceChildren()
  const mark = kind && /^[a-z]+(?:-[a-z]+)*$/.test(kind) ? kindMark(kind) : undefined
  slot.hidden = !mark
  if (!mark || !kind) return
  const chip = document.createElement('span')
  chip.className = `api-badge api-badge--kind api-badge--kind-${kind} api-leg`
  chip.dataset.mark = markClass(mark)
  const markBox = document.createElement('span')
  markBox.className = 'api-leg__m'
  markBox.setAttribute('aria-hidden', 'true')
  const glyph = document.createElement('span')
  glyph.className = 'api-leg__g'
  glyph.dataset.mark = markClass(mark)
  glyph.textContent = mark
  markBox.append(glyph)
  const word = document.createElement('span')
  word.className = 'api-leg__w'
  const label = document.createElement('span')
  label.className = 'api-badge__label api-leg__wl'
  label.textContent = kind.replace(/-/g, ' ')
  word.append(label)
  chip.append(markBox, word)
  slot.append(chip)
}

/** Optional token metadata can fail independently of the real reference link. */
export function renderPreviewSignature(element: HTMLElement, preview: LinkPreview) {
  // The head of a declaration: a payload that carries more is cut here, and its highlighting no longer matches, so it is plain text.
  const signature = limitPreviewSignature(preview.signature ?? '')
  const value = preview.signatureHighlight
  const color = (input: unknown) => typeof input === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(input)
  const object = (input: unknown): input is Record<string, unknown> => !!input && typeof input === 'object'
  const palette = (input: unknown) => object(input) && color(input.foreground) && color(input.background)
  const style = (input: unknown) => object(input) && color(input.color)
    && typeof input.fontStyle === 'number' && Number.isInteger(input.fontStyle) && input.fontStyle >= 0 && input.fontStyle <= 15
  const valid = (input: unknown): input is CodeHighlight => object(input) && typeof input.language === 'string'
    && palette(input.light) && palette(input.dark) && Array.isArray(input.lines)
    && input.lines.every((line: unknown) => Array.isArray(line) && line.every((token: unknown) => object(token)
      && typeof token.content === 'string' && style(token.light) && style(token.dark)))
    && input.lines.map((line: { content: string }[]) => line.map((token) => token.content).join('')).join('\n') === signature

  element.replaceChildren()
  element.classList.remove('lm-highlighted')
  delete element.dataset.language
  for (const theme of ['light', 'dark']) {
    element.style.removeProperty(`--shiki-${theme}-bg`)
    element.style.removeProperty(`--shiki-${theme}`)
  }
  element.hidden = !signature
  if (!signature || !valid(value)) { element.textContent = signature; return }
  element.classList.add('lm-highlighted')
  element.dataset.language = value.language
  for (const theme of ['light', 'dark'] as const) {
    element.style.setProperty(`--shiki-${theme}-bg`, value[theme].background)
    element.style.setProperty(`--shiki-${theme}`, value[theme].foreground)
  }
  for (const [lineIndex, line] of value.lines.entries()) {
    if (lineIndex) element.append(document.createTextNode('\n'))
    for (const token of line) {
      const span = document.createElement('span')
      span.textContent = token.content
      for (const theme of ['light', 'dark'] as const) {
        const { fontStyle } = token[theme]
        span.style.setProperty(`--shiki-${theme}`, token[theme].color)
        span.style.setProperty(`--shiki-${theme}-font-style`, fontStyle & 1 ? 'italic' : 'normal')
        span.style.setProperty(`--shiki-${theme}-font-weight`, fontStyle & 2 ? 'bold' : 'normal')
        span.style.setProperty(`--shiki-${theme}-text-decoration`, [fontStyle & 4 ? 'underline' : '', fontStyle & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none')
      }
      element.append(span)
    }
  }
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
  let fullTitle = '', shortTitle = ''
  const title = panel.querySelector<HTMLElement>('[data-preview-title]')!
  const expandTitle = panel.querySelector<HTMLButtonElement>('[data-preview-expand]')!
  const defaultAction = panel.querySelector('[data-preview-open]')!.textContent
  const renderTitle = (expanded: boolean) => {
    title.replaceChildren(...wordBreak(expanded ? fullTitle : shortTitle).flatMap((part, index) =>
      index ? [document.createElement('wbr'), document.createTextNode(part)] : [document.createTextNode(part)]))
    title.title = fullTitle
    expandTitle.hidden = fullTitle === shortTitle
    expandTitle.setAttribute('aria-expanded', String(expanded))
    expandTitle.textContent = expanded ? 'Collapse' : 'Show full name'
  }
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
    if (link.closest('.api-index-card') || linkPreviewBlockLink(link)) {
      delete link.dataset.linkPreview
      continue
    }
    if (candidate(link)) markLinkPreview(link)
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
    markLinkPreview(link)
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
      fullTitle = preview.title
      shortTitle = abbreviateNamespace(fullTitle)
      renderTitle(false)
      renderPreviewKind(panel.querySelector<HTMLElement>('[data-preview-kind]'), preview.kind)
      panel.querySelector('[data-preview-description]')!.textContent = preview.description || 'Read the reference for this declaration.'
      const detail = panel.querySelector<HTMLElement>('[data-preview-detail]')!
      const context = [link.dataset.previewContext, preview.detail].filter(Boolean).join(' ')
      detail.textContent = context; detail.hidden = !context
      renderPreviewSignature(panel.querySelector<HTMLElement>('[data-preview-signature]')!, preview)
      const open = panel.querySelector<HTMLAnchorElement>('[data-preview-open]')!
      open.href = destination.href
      open.textContent = preview.actionLabel ?? defaultAction
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
  expandTitle.addEventListener('click', () => {
    renderTitle(expandTitle.getAttribute('aria-expanded') !== 'true')
    place()
  }, { signal })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (current || panel.matches(':popover-open'))) { event.preventDefault(); close(pinned) }
  }, { signal, capture: true })
  panel.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'closed' && shown && !panel.matches(':popover-open')) close()
  }, { signal })
  window.addEventListener('resize', place, { signal })
  window.addEventListener('scroll', place, { signal, passive: true, capture: true })
}
