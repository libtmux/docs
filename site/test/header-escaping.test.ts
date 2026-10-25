import type { Element, Window } from 'happy-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import * as headerLinks from '../src/lib/header-links'
import { INVENTORY, type InventoryEntry } from '../src/lib/port-inventory'
import { PORT_BY_SLUG } from '../src/lib/ports'
import { loadHeaderTemplates, parseHtml, renderPage, type HeaderTemplates } from './header-page'

/**
 * The inventory is data, and the header writes it into text and into the
 * `data-match` attribute the picker's search reads. A label or alias with
 * markup in it must come back out of the rendered page as the same
 * characters, and must not become an element or an attribute.
 */
const LABEL = `<b>"&'"><img src=x onerror=alert(1)>`
// An alias that already looks like an entity, so a second decode would change it.
const ALIAS = `"><img onerror=alert(2)>&amp;'<i>`
const SLUG = 'rs'
const ID = 'tmux-workspace'

const hostile = (): Record<string, readonly InventoryEntry[]> => ({
  ...INVENTORY,
  [SLUG]: INVENTORY[SLUG]!.map((entry) => (entry.id === ID ? { ...entry, label: LABEL, aliases: [ALIAS] } : entry)),
})

const windows: Window[] = []
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.abort()
  vi.unstubAllEnvs()
})

let plain: HeaderTemplates
let rendered: HeaderTemplates
beforeAll(async () => {
  plain = await loadHeaderTemplates()
  // The same templates, handed the hostile inventory wherever they ask for a port's links.
  rendered = await loadHeaderTemplates({
    '../lib/header-links': { ...headerLinks, portHeaderLinks: (port: Parameters<typeof headerLinks.portHeaderLinks>[0]) => headerLinks.portHeaderLinks(port, hostile()) },
  })
})

const render = async (templates: HeaderTemplates) => {
  const win = parseHtml(await renderPage(templates.baseLayout, `/en/${SLUG}/latest/guides/panes/`, { pagePath: 'guides/panes', portSlug: SLUG }))
  windows.push(win)
  return win.document
}
type Doc = Awaited<ReturnType<typeof render>>

/** What would be injected: any element carrying a handler, and any element the benign page does not have. */
const handlers = (root: Element | Doc) => [...root.querySelectorAll('*')].filter((element) => element.getAttributeNames().some((name) => name.startsWith('on')))
const shape = (document: Doc) => [...document.querySelectorAll('.site-header *')].map((element) => element.tagName)
const picker = (document: Doc, placement: 'bar' | 'menu') => document.querySelector(`details[data-header-picker][data-placement="${placement}"]`)!
const rowsFor = (details: Element) => [...details.querySelectorAll('a[data-picker-option]')].filter((row) => row.getAttribute('data-entries')!.split(' ').includes(ID))

describe('header links escape the inventory', () => {
  it.each(['bar', 'menu'] as const)('shows a label and alias full of markup as text only, in the %s copy', async (placement) => {
    const document = await render(rendered)
    const details = picker(document, placement)
    const rows = rowsFor(details)
    // The source, package and API rows of the entry, each reachable by its own destination.
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      'https://github.com/libtmux/libtmux-rs/tree/master/crates/tmux-workspace', 'https://crates.io/crates/tmux-workspace', 'https://docs.rs/tmux-workspace',
    ])
    const expected = headerLinks.portHeaderLinks(PORT_BY_SLUG[SLUG]!, hostile()).rows.filter((row) => row.entries.includes(ID))
    for (const [index, row] of rows.entries()) {
      // The characters come back unchanged: not decoded twice, and not left as entities.
      expect(row.querySelector('.header-picker__name')!.textContent, row.getAttribute('href')!).toBe(LABEL)
      expect(row.getAttribute('data-match'), row.getAttribute('href')!).toBe(expected[index]!.match)
      expect(row.getAttribute('data-match')).toContain(ALIAS)
      expect(row.getAttribute('data-match')).toContain(LABEL)
      expect(headerLinks.matchesSearch({ match: row.getAttribute('data-match')! }, ALIAS), 'the alias still finds the row').toBe(true)
      // Nothing from the label became markup inside the row.
      expect([...row.querySelectorAll('*')].map((element) => element.tagName)).not.toContain('B')
      expect(row.querySelector('img, i, b')).toBeNull()
    }
  })

  it('adds no element, handler or attribute that the same page without markup does not have', async () => {
    const [benign, injected] = [await render(plain), await render(rendered)]
    expect(shape(injected)).toEqual(shape(benign))
    expect(handlers(injected)).toEqual([])
    expect(injected.querySelector('.site-header img[src="x"]')).toBeNull()
    for (const placement of ['bar', 'menu'] as const) {
      const attributes = (details: Element) => [...details.querySelectorAll('*')].map((element) => element.getAttributeNames().join(','))
      expect(attributes(picker(injected, placement))).toEqual(attributes(picker(benign, placement)))
    }
  })

  it('survives being written out and read back', async () => {
    const document = await render(rendered)
    const details = picker(document, 'bar')
    // Read the serialized picker as a browser would, and compare what it holds with what was rendered.
    const again = parseHtml(`<body>${details.outerHTML}</body>`)
    windows.push(again)
    const read = (root: Element | Doc) => [...root.querySelectorAll('a[data-picker-option]')].map((row) => [
      row.getAttribute('href'), row.getAttribute('data-match'), row.getAttribute('data-entries'), row.querySelector('.header-picker__name')!.textContent, row.querySelector('small')!.textContent,
    ])
    expect(read(again.document)).toEqual(read(details))
    expect(handlers(again.document)).toEqual([])
    expect(again.document.querySelectorAll('img')).toHaveLength(0)
  })

  it('has a detector that sees markup when markup is injected', () => {
    // Control: the same inspection on a row that wrote the label out unescaped finds what the escaped page does not.
    const raw = parseHtml(`<a data-picker-option data-match="${LABEL}"><span class="header-picker__name">${LABEL}</span></a>`)
    windows.push(raw)
    expect(raw.document.querySelectorAll('img').length).toBeGreaterThan(0)
    expect(handlers(raw.document).length).toBeGreaterThan(0)
    expect(raw.document.querySelector('b')).not.toBeNull()
  })
})
