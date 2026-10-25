import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A kind mark's border, fill and ink come out of the cascade the same way whichever stylesheet loads first. The
 * stylesheets that draw a mark are found by what they say, then loaded into a real browser in several orders; the
 * painted colours of every kind in every place a mark appears must not change with the order.
 */
const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url))
const sheets = [...readdirSync(STYLES).filter((name) => name.endsWith('.css')), ...readdirSync(join(STYLES, 'vendor')).filter((name) => name.endsWith('.css')).map((name) => `vendor/${name}`)]
  .filter((name) => /api-nav__kind|api-badge|--mk-/.test(readFileSync(join(STYLES, name), 'utf8')))
const css = new Map(sheets.map((name) => [name, readFileSync(join(STYLES, name), 'utf8')]))

const palette = readFileSync(join(STYLES, 'api-kinds.css'), 'utf8')
const KINDS = [...new Set([...palette.matchAll(/\.api-badge--kind-([a-z-]+)/g)].map(([, kind]) => kind!))]
// A kind no family claims keeps the neutral fallback.
const UNKNOWN = 'unclaimed'

const mark = (kind: string, glyph = 'k') => `<span class="api-nav__kind api-badge--kind-${kind}" aria-hidden="true"><span class="api-badge__label" data-mark="cap">${glyph}</span></span>`
const legend = (kind: string) => `<span class="api-badge api-badge--kind api-badge--kind-${kind} api-leg"><span class="api-leg__m"><span class="api-leg__g" data-mark="cap">k</span></span><span class="api-leg__w"><span class="api-badge__label api-leg__wl">${kind}</span></span></span>`
/** Each place a mark appears, as the markup around it: the tree, a table, a callout, the contents column, a related chip, and a selected row. */
const PLACES: Record<string, (kind: string) => string> = {
  bare: (kind) => mark(kind),
  tree: (kind) => `<div class="api-nav"><a class="api-nav__row">${mark(kind)}</a></div>`,
  selected: (kind) => `<div class="api-nav"><a class="api-nav__leaf" aria-current="page">${mark(kind)}</a></div>`,
  table: (kind) => `<table><tbody><tr><td>${mark(kind)}</td></tr></tbody></table>`,
  callout: (kind) => `<div class="aside">${mark(kind)}</div>`,
  contents: (kind) => `<div class="api-page-contents">${mark(kind)}</div>`,
  related: (kind) => `<nav class="api-related"><a href="#">${mark(kind)}<code>Name</code></a></nav>`,
  legend,
}
const fixtures = (): string => [...KINDS, UNKNOWN].flatMap((kind) => Object.entries(PLACES).map(([place, draw]) =>
  `<div data-fixture="${kind} in ${place}">${draw(kind)}</div>`)).join('\n')

/** The orders to load the sheets in: as listed, reversed, and each sheet first and last. */
function orders(): string[][] {
  const named = [...css.keys()]
  const list = [named, [...named].reverse(), ...named.flatMap((name) => {
    const rest = named.filter((other) => other !== name)
    return [[name, ...rest], [...rest, name]]
  })]
  return [...new Map(list.map((order) => [order.join('|'), order])).values()]
}

const SCHEMES = { 'explicit light': { attribute: 'light', media: 'light' }, 'explicit dark': { attribute: 'dark', media: 'light' }, 'system dark': { attribute: undefined, media: 'dark' } } as const

const FIELDS = ['part', 'top border', 'right border', 'bottom border', 'left border', 'fill', 'ink', 'ring']

/** What a reader sees of each mark: border, fill, ink and ring, for the mark and each of its parts. */
async function painted(page: Page, order: string[], scheme: keyof typeof SCHEMES): Promise<Record<string, string[]>> {
  const { attribute, media } = SCHEMES[scheme]
  await page.emulateMedia({ colorScheme: media })
  await page.setContent(`<!doctype html><html${attribute ? ` data-color-scheme="${attribute}"` : ''}><head><style>:root { --color-foreground-primary: #202830; --background-color: #ffffff; }</style>${
    order.map((name) => `<style>${css.get(name)}</style>`).join('')}</head><body>${fixtures()}</body></html>`)
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-fixture]')].map((host) => [
    host.getAttribute('data-fixture')!,
    [...host.querySelectorAll('.api-nav__kind, .api-leg, .api-leg__m, .api-leg__w')].map((node) => {
      const style = getComputedStyle(node)
      return [node.className.split(' ')[0], style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor, style.backgroundColor, style.color, style.boxShadow].join(' | ')
    }),
  ])))
}

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) })
afterAll(async () => { await browser?.close() })

describe('kind marks across stylesheet order', () => {
  it('finds every stylesheet that draws a mark, and every kind the palette names', () => {
    expect(sheets).toEqual(expect.arrayContaining(['api-kinds.css', 'kind-marks.css', 'api-tree.css']))
    expect(KINDS).toEqual(expect.arrayContaining(['class', 'interface', 'method', 'property', 'exception', 'tool']))
    expect(orders().length).toBeGreaterThan(sheets.length)
  })

  it.each(Object.keys(SCHEMES) as (keyof typeof SCHEMES)[])('paints the same borders, fills and inks in every load order, %s', async (scheme) => {
    const page = await browser.newPage()
    try {
      const [first, ...others] = orders()
      const reference = await painted(page, first!, scheme)
      expect(Object.keys(reference).length).toBe((KINDS.length + 1) * Object.keys(PLACES).length)
      // The measurement sees paint: the palette's families differ, and a kind no family claims is neutral.
      const fill = (kind: string) => reference[`${kind} in bare`]![0]!.split(' | ')[5]
      expect(new Set(['class', 'interface', 'method', 'property', 'exception', 'tool'].map(fill)).size).toBe(6)
      expect(fill(UNKNOWN)).toBe('rgba(0, 0, 0, 0)')
      for (const order of others) {
        const found = await painted(page, order, scheme)
        const moved = Object.keys(reference).flatMap((key) => reference[key]!.flatMap((was, part) => was.split(' | ').flatMap((value, field) => {
          const now = found[key]![part]!.split(' | ')[field]
          return now === value ? [] : [`${key}, ${FIELDS[field]}: ${value} became ${now}`]
        })))
        expect(moved.slice(0, 3), `${scheme}: ${moved.length} painted values change when loaded as ${order.join(', ')}`).toEqual([])
      }
    } finally { await page.close() }
  })
})
