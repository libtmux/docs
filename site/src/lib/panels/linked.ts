/**
 * The panels that open beside a page in panel mode: the same page in each other port, from data the page already shows.
 *
 * An API symbol page takes the rows of its "In other ports" table. Every other page takes the language picker's links,
 * which exist only where the site maps the page to another port. Both are read back from the page's markup, so a page
 * that was fetched offers the same panels as one that was loaded, and the page carries nothing extra for the mode.
 */
import type { EquivalentRow } from '../api-equivalents'
import type { PagePortLink } from '../page-port-links'

export interface LinkedEntry {
  /** The concept's label on an API page; the page's title on any other. */
  label?: string
  qualifiedName?: string
  kind?: string
  summary?: string
  /** What differs from this page's declaration, each chip a word a reader can search for. */
  chips: string[]
  note?: string
  /** The page in the other port's own tree. */
  href: string
}

export interface LinkedPanel {
  /** `link:<port>`: a panel id names a role, so a saved layout applies on every page. */
  id: string
  port: string
  name: string
  entries: LinkedEntry[]
}

export const linkedId = (port: string): string => `link:${port}`

const panelFor = (panels: Map<string, LinkedPanel>, port: string, name: string): LinkedPanel => {
  let panel = panels.get(port)
  if (!panel) panels.set(port, panel = { id: linkedId(port), port, name, entries: [] })
  return panel
}

/** A panel for each other port with a mapped row, holding one entry for each concept the page belongs to. */
export function fromEquivalents(current: string, groups: readonly { label: string; rows: readonly EquivalentRow[] }[]): LinkedPanel[] {
  const panels = new Map<string, LinkedPanel>()
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.port === current || row.status !== 'mapped' || !row.href) continue
      panelFor(panels, row.port, row.name).entries.push({
        label: group.label, qualifiedName: row.qualifiedName, kind: row.kind, summary: row.summary,
        chips: row.chips, note: row.note, href: row.href,
      })
    }
  }
  return [...panels.values()]
}

/** A panel for each other port the page dropdown links; a link to a section overview in place of an equivalent is left out. */
export function fromPagePorts(current: string, pages: readonly PagePortLink[], title: string): LinkedPanel[] {
  const panels = new Map<string, LinkedPanel>()
  for (const page of pages) {
    if (page.port === current) continue
    for (const link of page.links) {
      if (link.fallback) continue
      panelFor(panels, page.port, page.name).entries.push({
        label: link.label ?? title, qualifiedName: link.api, chips: link.differences ?? [], href: link.href,
      })
    }
  }
  return [...panels.values()]
}

const textOf = (el: Element | null | undefined): string | undefined => el?.textContent?.replace(/\s+/g, ' ').trim() || undefined

/** The "In other ports" tables of a page, read back from the rows `EquivalentsTable.astro` writes. */
export function readEquivalents(root: ParentNode): { current: string; groups: { label: string; rows: EquivalentRow[] }[] } {
  let current = ''
  const groups = [...root.querySelectorAll('[data-eq-group]')].map((group) => ({
    label: textOf(group.querySelector('.api-eq-why b')) ?? '',
    rows: [...group.querySelectorAll<HTMLElement>('tbody tr[data-port]')].map((row): EquivalentRow => {
      const link = row.querySelector<HTMLAnchorElement>('a[href]')
      const isCurrent = row.hasAttribute('aria-current')
      if (isCurrent) current = row.dataset.port!
      return {
        port: row.dataset.port!, name: textOf(row.querySelector('th')) ?? row.dataset.port!, status: 'mapped', current: isCurrent,
        href: isCurrent ? undefined : link?.getAttribute('href') ?? undefined,
        qualifiedName: textOf(row.querySelector('code')),
        kind: /api-badge--kind-([\w-]+)/.exec(row.querySelector('.api-nav__kind')?.className ?? '')?.[1],
        summary: textOf(row.querySelector('.api-eq-sum')), note: textOf(row.querySelector('.api-eq-note')),
        chips: [...row.querySelectorAll('.api-eq-diff')].map((chip) => textOf(chip)!),
      }
    }),
  }))
  return { current, groups }
}

/** The language picker's links, read back from the options `PagePortSwitcher.astro` writes. A port with several links is one entry. */
export function readPagePorts(root: ParentNode): { current: string; pages: PagePortLink[] } {
  const pages = new Map<string, PagePortLink>()
  let current = ''
  for (const option of root.querySelectorAll<HTMLAnchorElement>('[data-page-port-switcher] a.doc-picker-option[data-port][href]')) {
    const port = option.dataset.port!
    if (option.getAttribute('aria-current') === 'page') current = port
    const page = pages.get(port) ?? { port, name: option.dataset.portName ?? port, links: [] }
    pages.set(port, page)
    const href = option.getAttribute('href')!
    if (page.links.some((link) => link.href === href)) continue
    const differences = textOf(option.querySelector('[data-picker-differences]'))?.replace(/^Differs:\s*/, '').split(' · ')
    const label = textOf(option.querySelector('small:not([data-qn], [data-picker-differences], .doc-picker-api)'))
    page.links.push({ href, ...(label ? { label } : {}), ...(option.querySelector('[data-qn]') ? { api: option.querySelector<HTMLElement>('[data-qn]')!.dataset.qn } : {}), ...(differences?.length ? { differences } : {}) })
  }
  return { current, pages: [...pages.values()] }
}

/**
 * The panels a page offers beside itself: its "In other ports" rows when it has them, else the language picker's links.
 * `title` names a picker entry that carries no label of its own.
 */
export function readLinked(root: ParentNode, title: string): LinkedPanel[] {
  const equivalents = readEquivalents(root)
  if (equivalents.groups.some((group) => group.rows.length)) return fromEquivalents(equivalents.current, equivalents.groups)
  const { current, pages } = readPagePorts(root)
  return fromPagePorts(current, pages, title)
}
