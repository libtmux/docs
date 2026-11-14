/**
 * The source pane: a declaration's pinned source beside the reference page.
 *
 * The source is the on-site page of the file (`sources/<file>/`, built from the
 * copy pinned at the model's revision), read when the pane opens, so no branch
 * head is ever fetched. What the pane shows is `source-state.ts`'s trail;
 * opening pushes `?source=<symbol-slug>`, so the browser's Back closes it and a
 * reload restores it. This file only draws that state and moves focus.
 */
import { kindMark, kindPalette, markClass } from './api-labels'
import {
  PANE_CLOSED, backEntry, closeAction, paneOpen, paneTop, pushEntry, recordClose, recordOpen, restoreSlug, trailLabel,
  PANE_COLUMN_FROM_REM, type PaneEntry, type PaneState,
} from './source-state'

/** What a source page holds that the pane shows. */
interface LoadedFile {
  pre: HTMLElement
  css: string
  github?: string
  provenance?: string
  rows: { slug: string; title: string; line: number; from: number; to: number; kind: string }[]
}

/** `[file, line, from, to, title, kind]` per symbol slug, from `sources.json`. */
type IndexEntry = [file: string, line: number, from: number, to: number, title: string, kind: string]

const TRIGGER = '[data-source-open]'

/** The reference path of this page, which every source URL hangs from. */
function referenceBase(): string {
  const at = location.pathname.indexOf('/reference/')
  return at < 0 ? '/reference/' : location.pathname.slice(0, at + '/reference/'.length)
}

/** The last segment of a qualified name: `Pane.Capture` is `Capture` in the trail. */
const leaf = (entry: PaneEntry) => entry.title.split(/[.:#]/).at(-1) || entry.title

const lastSegment = (href: string) => new URL(href, location.href).pathname.split('/').filter(Boolean).at(-1) ?? ''

function kindMarkup(doc: Document, kind: string): HTMLElement {
  const mark = kindMark(kind) ?? kind.slice(0, 1)
  const outer = doc.createElement('span')
  outer.className = `api-nav__kind api-badge--kind-${kindPalette(kind)}`
  outer.setAttribute('aria-hidden', 'true')
  const label = doc.createElement('span')
  label.className = 'api-badge__label'
  label.dataset.mark = markClass(mark)
  label.textContent = mark
  outer.append(label)
  return outer
}

export function mountSourcePane(doc: Document = document): void {
  const found = doc.querySelector<HTMLElement>('[data-source-pane]')
  if (!found || found.dataset.mounted) return
  // A named, non-null binding: function declarations below run later and cannot see the narrowing above.
  const pane: HTMLElement = found
  pane.dataset.mounted = ''
  const layout = pane.parentElement!
  const part = <T extends HTMLElement>(name: string) => pane.querySelector<T>(`[data-pane-${name}]`)!
  const [title, prov, body, crumbs, backButton, closeButton, live] =
    ['title', 'prov', 'body', 'crumbs', 'back', 'close', 'live'].map((name) => part(name))
  const base = referenceBase()
  // A router swap replaces the page; the listeners on the document go with it.
  const abort = new AbortController()
  const { signal } = abort
  doc.addEventListener('astro:before-swap', () => abort.abort(), { once: true })

  let state: PaneState = PANE_CLOSED
  let opener: HTMLElement | null = null
  let scrollY = 0
  let index: Promise<Record<string, IndexEntry> | undefined> | undefined
  // Read synchronously by the click handler, which must decide before the router navigates.
  let indexed: Record<string, IndexEntry> | undefined
  const files = new Map<string, Promise<LoadedFile | undefined>>()
  const loadedFiles = new Map<string, LoadedFile>()

  // The links are links to GitHub without this script. With it they are buttons that open the pane,
  // and their address becomes the on-site page of the file, which is where a new tab should go.
  const triggers = () => [...doc.querySelectorAll<HTMLElement>(TRIGGER)]
  for (const trigger of triggers()) {
    trigger.setAttribute('role', 'button')
    trigger.setAttribute('aria-expanded', 'false')
    trigger.setAttribute('aria-label', `Show the source of ${trigger.dataset.sourceTitle ?? 'this declaration'} beside the page`)
    if (trigger instanceof HTMLAnchorElement) trigger.href = `${base}sources/${trigger.dataset.sourceFile}/?from=${encodeURIComponent(trigger.dataset.sourceSlug ?? '')}#L${trigger.dataset.sourceLine}`
  }

  const loadIndex = () => index ??= fetch(`${base}sources.json`).then((response) => response.ok
    ? response.json().then((data: { symbols: Record<string, IndexEntry> }) => (indexed = data.symbols)) : undefined).catch(() => undefined)

  function load(file: string): Promise<LoadedFile | undefined> {
    let loaded = files.get(file)
    if (!loaded) {
      loaded = fetch(`${base}sources/${file}/`).then(async (response) => {
        if (!response.ok) return undefined
        const page = new DOMParser().parseFromString(await response.text(), 'text/html')
        const pre = page.querySelector<HTMLElement>('[data-source-body] .lm-src')
        if (!pre) return undefined
        const clone = doc.importNode(pre, true)
        for (const element of clone.querySelectorAll('[id]')) element.removeAttribute('id')
        for (const range of clone.querySelectorAll('.lm-range')) range.remove()
        return {
          pre: clone,
          css: [...page.querySelectorAll('main style')].map((style) => style.textContent ?? '').join('\n').replace(/[^{}]*:target[^{}]*\{[^}]*\}/g, ''),
          github: page.querySelector<HTMLAnchorElement>('[data-source-github]')?.getAttribute('href')?.split('#')[0],
          provenance: page.querySelector('.lm-provenance')?.textContent ?? undefined,
          rows: [...page.querySelectorAll<HTMLElement>('[data-source-row]')].map((row) => ({
            slug: row.dataset.slug ?? '', title: row.dataset.title ?? '', kind: row.querySelector('[class*="api-badge--kind-"]')?.className.match(/api-badge--kind-(\S+)/)?.[1] ?? '',
            line: Number(row.dataset.line), from: Number(row.dataset.from), to: Number(row.dataset.to),
          })),
        }
      }).then((result) => { if (result) loadedFiles.set(file, result); return result }).catch(() => undefined)
      files.set(file, loaded)
    }
    return loaded
  }

  const announce = (text: string) => { live.textContent = ''; live.textContent = text }

  /** Everything outside the pane stops taking focus and clicks while the pane overlays the page. */
  function inertPage(on: boolean) {
    for (let node: Element = pane; node !== doc.body && node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue
        sibling.toggleAttribute('inert', on)
      }
    }
  }
  /** A column pane is as tall as what is left of the viewport below the header, or below the top of the layout while that is lower. */
  function fit() {
    if (!paneOpen(state) || overlay()) { pane.style.removeProperty('height'); return }
    const header = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('--api-header-height')) || 0
    pane.style.height = `${Math.max(0, innerHeight - Math.max(header, layout.getBoundingClientRect().top))}px`
  }
  let fitting = 0
  const refit = () => { cancelAnimationFrame(fitting); fitting = requestAnimationFrame(fit) }
  const overlay = () => !matchMedia(`(min-width: ${PANE_COLUMN_FROM_REM}rem)`).matches
  const applyMode = () => { inertPage(paneOpen(state) && overlay()); fit() }

  function renderHead() {
    const top = paneTop(state)
    if (!top) return
    title.replaceChildren(kindMarkup(doc, top.kind), top.title)
    backButton.hidden = state.trail.length < 2
    if (state.trail.length > 1) backButton.textContent = `\u2190 ${leaf(state.trail.at(-2)!)}`
    crumbs.textContent = trailLabel(state, leaf)
  }

  async function show() {
    const top = paneTop(state)
    if (!top) return
    renderHead()
    for (const trigger of triggers()) trigger.setAttribute('aria-expanded', String(trigger.dataset.sourceSlug === top.slug))
    body.setAttribute('aria-busy', 'true')
    const loaded = await load(top.file)
    if (paneTop(state)?.slug !== top.slug) return
    body.removeAttribute('aria-busy')
    if (!loaded) {
      prov.replaceChildren()
      const message = doc.createElement('div')
      message.className = 'lm-pane__state'
      const heading = doc.createElement('strong')
      heading.textContent = 'The source did not load.'
      const note = doc.createElement('p')
      note.textContent = 'The reference page is complete without it.'
      message.append(heading, note)
      body.replaceChildren(message)
      return
    }
    // The page knows the whole declaration and its heading; the model records only where it starts.
    const row = loaded.rows.find((entry) => entry.line === top.line && entry.slug === top.slug) ?? loaded.rows.find((entry) => entry.line === top.line)
    const [from, to] = row ? [row.from, row.to] : [top.from, top.to]
    if (row && row.title !== top.title) {
      state = { trail: [...state.trail.slice(0, -1), { ...top, title: row.title, from, to }] }
      renderHead()
    }
    const pre = loaded.pre.cloneNode(true) as HTMLElement
    for (const line of pre.querySelectorAll<HTMLElement>('[data-n]')) {
      const n = Number(line.dataset.n)
      line.classList.toggle('hl', n >= from && n <= to)
    }
    const style = doc.createElement('style')
    style.textContent = loaded.css
    body.replaceChildren(style, pre)
    const range = from === to ? `${from}` : `${from}–${to}`
    const github = loaded.github && `${loaded.github}#L${from}${to > from ? `-L${to}` : ''}`
    prov.replaceChildren()
    for (const text of [loaded.provenance, `${top.file}:${range}`]) { const span = doc.createElement('span'); span.textContent = text ?? ''; prov.append(span) }
    for (const [label, href] of [['Open on GitHub', github], ['Open full file', `${base}sources/${top.file}/?from=${encodeURIComponent(top.slug)}#L${from}${to > from ? `-L${to}` : ''}`]] as const) {
      if (!href) continue
      const link = doc.createElement('a')
      link.href = href
      link.textContent = label
      if (label === 'Open on GitHub') link.rel = 'noopener'
      prov.append(link)
    }
    const first = pre.querySelector<HTMLElement>(`[data-n="${from}"]`)
    body.scrollTop = first ? Math.max(0, first.offsetTop - 60) : 0
  }

  function open(entry: PaneEntry, trigger: HTMLElement | null, record = true) {
    const wasOpen = paneOpen(state)
    if (!wasOpen) { opener = trigger; scrollY = window.scrollY }
    state = pushEntry(state, entry)
    if (record) recordOpen(history, location.href, entry.slug, wasOpen)
    pane.hidden = false
    layout.dataset.paneState = 'open'
    applyMode()
    void loadIndex()
    void show()
    if (record) closeButton.focus({ preventScroll: true })
    announce(`Source of ${entry.title} opened beside the page`)
  }

  function closeInterface() {
    if (!paneOpen(state)) return
    state = PANE_CLOSED
    pane.hidden = true
    delete layout.dataset.paneState
    pane.style.removeProperty('height')
    inertPage(false)
    for (const trigger of triggers()) trigger.setAttribute('aria-expanded', 'false')
    window.scrollTo(0, scrollY)
    // The opener may have been swapped out of the page; its replacement is found by slug.
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    announce(`Source pane closed. Focus returned to ${opener?.textContent?.trim() || 'the page'}`)
    opener = null
  }

  /** Close by button or Escape: step back over the entry this page pushed, or clear the address in place. */
  function requestClose() {
    if (closeAction(history.state) === 'back') history.back()
    else { recordClose(history, location.href); closeInterface() }
  }

  const entryOf = (trigger: HTMLElement): PaneEntry => {
    const line = Number(trigger.dataset.sourceLine)
    return { slug: trigger.dataset.sourceSlug ?? '', title: trigger.dataset.sourceTitle ?? '', kind: trigger.dataset.sourceKind ?? '', file: trigger.dataset.sourceFile ?? '', line, from: line, to: line }
  }
  const entryFromIndex = (slug: string, found: IndexEntry): PaneEntry => ({ slug, file: found[0], line: found[1], from: found[2], to: found[3], title: found[4], kind: found[5] })

  /** Show the entry a URL names: a reload, a shared link, or Forward. */
  async function sync() {
    const slug = restoreSlug(location.search, history.state)
    if (!slug) { closeInterface(); return }
    if (paneTop(state)?.slug === slug) return
    const trigger = triggers().find((candidate) => candidate.dataset.sourceSlug === slug)
    if (trigger) { open(entryOf(trigger), trigger, false); return }
    const found = (await loadIndex())?.[slug]
    if (found) open(entryFromIndex(slug, found), null, false)
  }

  // In the capture phase, before the router's click handler decides to navigate.
  doc.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    if (link.matches(TRIGGER)) {
      event.preventDefault()
      const entry = entryOf(link)
      if (paneTop(state)?.slug === entry.slug) requestClose()
      else open(entry, link)
      return
    }
    const slug = lastSegment(link.href)
    const top = paneTop(state)
    if (pane.contains(link)) {
      // A gutter mark in the pane: the declaration it documents opens on the pane's trail.
      const row = top && loadedFiles.get(top.file)?.rows.find((entry) => entry.slug === slug)
      if (row && top) { event.preventDefault(); open({ slug, title: row.title, kind: row.kind, file: top.file, line: row.line, from: row.from, to: row.to }, opener) }
      return
    }
    // With the pane open, a link in the page to a documented declaration follows it in the pane.
    const found = top && link.closest('.api-reference-content') && link.pathname.startsWith(base) ? indexed?.[slug] : undefined
    if (found) { event.preventDefault(); open(entryFromIndex(slug, found), opener) }
  }, { signal, capture: true })

  doc.addEventListener('keydown', (event) => {
    const target = event.target as Element | null
    if (event.key === ' ' && target?.matches(TRIGGER)) { event.preventDefault(); (target as HTMLElement).click(); return }
    if (event.key === 'Escape' && paneOpen(state) && !event.defaultPrevented) { event.preventDefault(); requestClose() }
  }, { signal })
  backButton.addEventListener('click', () => { state = backEntry(state); const top = paneTop(state); if (top) recordOpen(history, location.href, top.slug, true); void show(); closeButton.focus({ preventScroll: true }) })
  closeButton.addEventListener('click', requestClose)
  window.addEventListener('popstate', () => void sync(), { signal })
  window.addEventListener('scroll', refit, { signal, passive: true })
  window.addEventListener('resize', refit, { signal })
  matchMedia(`(min-width: ${PANE_COLUMN_FROM_REM}rem)`).addEventListener('change', applyMode, { signal })

  void sync()
}

document.addEventListener('astro:page-load', () => mountSourcePane())
if (document.readyState !== 'loading') mountSourcePane()
