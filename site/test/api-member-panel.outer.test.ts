import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { siteCss } from './site-css'

/**
 * A group of members on a reference page, in a real browser with the site's compiled stylesheet and no server: the bar that
 * names the group, and the list under it. They are one panel, so the bar and the list meet on one edge with one divider,
 * and the corners that face each other are square.
 */
const API = readFileSync(new URL('../src/styles/api.css', import.meta.url), 'utf8')
const PANEL = /\/\* A group's bar and its list are one panel[\s\S]*?\*\/\n\.api-members > \.api-member-group > h3 \{[^}]*\}\n\.api-members > \.api-member-group > h3 \+ \.api-member-list \{[^}]*\}\n/

const member = (name: string) => `<li><span><a class="api-member-link" href="#${name}">${name}</a></span><span class="api-member-badges"></span><span class="api-member-summary">Does ${name}.</span></li>`
const group = (id: string, label: string, names: string[], bar = '') => `<section class="api-member-group" aria-labelledby="${id}">
  <h3 id="${id}"${bar}>${label}<span class="api-section-count">${names.length}</span></h3>
  <ul class="api-member-list mt-3">${names.map(member).join('')}</ul></section>`
/** The page as ApiReference writes it: the Members bar, two groups, and a list that has no group bar over it. */
const page = (sticky = false) => `<main style="width: 760px"><article class="prose max-w-none">
  <div class="api-members mt-8"${sticky ? ' data-api-sticky-members' : ''}>
    <h2 class="api-section-heading text-lg font-semibold" id="api-members">Members<span class="api-section-count">5</span></h2>
    ${group('methods', 'Methods', ['attach', 'detach'])}
    ${group('properties', 'Properties', ['id', 'name', 'size'], sticky ? ' data-api-stuck' : '')}
    <section class="api-member-group api-member-group--single"><ul class="api-member-list mt-3">${member('only')}</ul></section>
  </div></article></main>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

interface Panel {
  gap: number
  /** The border widths where the bar and the list meet, summed: one divider is 1. */
  divider: number
  /** How far the list's left and right edges stand from the bar's. */
  left: number
  right: number
  bar: Corners
  list: Corners
  barTopBorder: string
}
interface Corners { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number }

async function measure(css: string, sticky = false) {
  const target = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  try {
    await target.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${page(sticky)}</body></html>`)
    return await target.evaluate(() => {
      const corners = (style: CSSStyleDeclaration) => ({ topLeft: parseFloat(style.borderTopLeftRadius), topRight: parseFloat(style.borderTopRightRadius),
        bottomRight: parseFloat(style.borderBottomRightRadius), bottomLeft: parseFloat(style.borderBottomLeftRadius) })
      const panels = [...document.querySelectorAll('.api-member-group > h3')].map((bar): Panel => {
        const list = bar.nextElementSibling!, a = bar.getBoundingClientRect(), b = list.getBoundingClientRect()
        const barStyle = getComputedStyle(bar), listStyle = getComputedStyle(list)
        return { gap: b.top - a.bottom, divider: parseFloat(barStyle.borderBottomWidth) + parseFloat(listStyle.borderTopWidth),
          left: b.left - a.left, right: b.right - a.right, bar: corners(barStyle), list: corners(listStyle), barTopBorder: barStyle.borderTopColor }
      })
      const single = getComputedStyle(document.querySelector('.api-member-group--single .api-member-list')!)
      return { panels, single: { ...corners(single), top: parseFloat(single.borderTopWidth) } }
    })
  } finally { await target.close() }
}

/** What keeps a bar and its list from reading as one panel. */
function splits(panel: Panel): string[] {
  const found: string[] = []
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01
  if (Math.abs(panel.gap) > 0.5) found.push(`${panel.gap.toFixed(1)}px between the bar and the list`)
  if (panel.divider !== 1) found.push(`${panel.divider}px of divider where they meet`)
  if (Math.abs(panel.left) > 0.5 || Math.abs(panel.right) > 0.5) found.push('the list does not share the bar\'s edges')
  const radius = panel.list.bottomLeft
  if (!(radius > 0) || !near(panel.list.bottomRight, radius)) found.push('the list has no radius on its bottom corners')
  if (!near(panel.bar.topLeft, radius) || !near(panel.bar.topRight, radius)) found.push(`the bar's top radii ${panel.bar.topLeft}px and ${panel.bar.topRight}px are not the list's ${radius}px`)
  if (panel.bar.bottomLeft !== 0 || panel.bar.bottomRight !== 0) found.push('the bar rounds the corners that face the list')
  if (panel.list.topLeft !== 0 || panel.list.topRight !== 0) found.push('the list rounds the corners that face the bar')
  return found
}

describe('a group of members as one panel', () => {
  it('meets the list to the bar on one edge with one divider, rounds only the outer corners and shares one radius', { timeout: 30_000 }, async () => {
    const seen = await measure(`${await siteCss(['prose', 'max-w-none', 'mt-3', 'mt-8', 'text-lg', 'font-semibold'])}\n${API}`)
    expect(seen.panels).toHaveLength(2)
    for (const [index, panel] of seen.panels.entries()) expect(splits(panel), `group ${index + 1}`).toEqual([])
    // A list with no bar over it is a box of its own: a full border and four corners, of the radius the panels share.
    expect(seen.single.top).toBe(1)
    expect([seen.single.topLeft, seen.single.topRight, seen.single.bottomLeft, seen.single.bottomRight]).toEqual(Array(4).fill(seen.panels[0]!.list.bottomLeft))
  })

  it('keeps the stuck bar joined to the Members bar, with its top corners square and its top border transparent', { timeout: 30_000 }, async () => {
    const seen = await measure(`${await siteCss(['prose', 'max-w-none', 'mt-3', 'mt-8', 'text-lg', 'font-semibold'])}\n${API}`, true)
    const [free, stuck] = seen.panels as [Panel, Panel]
    expect(splits(free), 'a free bar').toEqual([])
    expect(stuck.bar.topLeft + stuck.bar.topRight).toBe(0)
    expect(stuck.barTopBorder).toBe('rgba(0, 0, 0, 0)')
    // Squared at the top, it still meets its list on one edge with one divider.
    expect({ gap: stuck.gap, divider: stuck.divider, bottom: [stuck.bar.bottomLeft, stuck.bar.bottomRight] }).toEqual({ gap: 0, divider: 1, bottom: [0, 0] })
    expect(stuck.list).toEqual(free.list)
  })

  it('splits into two boxes without the panel rules, so that the checks above can fail', { timeout: 30_000 }, async () => {
    expect(API).toMatch(PANEL)
    const seen = await measure(`${await siteCss(['prose', 'max-w-none', 'mt-3', 'mt-8', 'text-lg', 'font-semibold'])}\n${API.replace(PANEL, '')}`)
    const found = splits(seen.panels[0]!)
    expect(found).toEqual(expect.arrayContaining([
      expect.stringContaining('of divider where they meet'),
      expect.stringContaining('are not the list\'s'),
      expect.stringContaining('the bar rounds the corners that face the list'),
      expect.stringContaining('the list rounds the corners that face the bar'),
    ]))
  })
})
