import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workspaceShowcase } from '../src/lib/workspace-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Uint8Array } } } }

/**
 * A configuration is one panel: its tab strip and its code share one border,
 * one divider and one radius, and the active tab joins the panel with no line
 * under it. The gate paints the real stylesheet in Chromium and measures the
 * join. It also paints two broken variants, the tab strip and panel as they were
 * first drawn and the panel with Expressive Code's own frame left in, and
 * requires the gate to name what is wrong with each, so it can fail.
 */
const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const SHEET = read('styles/workspace-showcase.css')

/** Expressive Code's frame as it draws before a stylesheet narrows it: a border and a radius of its own. */
const FRAME = `.expressive-code { margin: 1rem 0; }
.expressive-code .frame { display: block; border: 1px solid #d0d7de; border-radius: 7px; overflow: hidden; }
.expressive-code .frame .header { display: block; border-radius: 7px 7px 0 0; }
.expressive-code pre { margin: 0; padding: 1rem; border: 0; font: 0.875rem/1.7 monospace; white-space: pre; overflow: auto; background: #fff; }`
const TOKENS = `:root { --color-edge: #dddddd; --color-surface: #f8f9fb; --color-muted: #666666; --text-color: #000000; --background-color: #ffffff; --theme-primary: #4f46e5; }
html[data-theme-mode="dark"] { --color-edge: #303335; --color-surface: #1a1c1e; --color-muted: #81868d; --text-color: #cfd0d0; --background-color: #131416; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 44rem; padding: 1rem; background: var(--background-color); color: var(--text-color); font: 16px/1.5 sans-serif; }`

/** The tab strip and panel as first drawn: a strip with its own bottom border over the code's own framed box. */
const OLD_CSS = `.ws-tabs { position: relative; margin-block: 1.25rem; }
.ws-tabs__radio { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
.ws-tabs__list { display: flex; gap: 0.125rem; border-bottom: 1px solid var(--color-edge); }
.ws-tabs__list label { padding: 0.3rem 0.7rem; border: 1px solid transparent; border-bottom: 0; border-radius: 0.35rem 0.35rem 0 0; font-size: 0.8rem; font-weight: 500; line-height: 1.4; color: var(--color-muted); cursor: pointer; }
.ws-tabs__panel { display: none; }
.ws-tabs__radio:nth-of-type(1):checked ~ .ws-tabs__panel--yaml, .ws-tabs__radio:nth-of-type(2):checked ~ .ws-tabs__panel--json { display: block; }
.ws-tabs__radio:nth-of-type(1):checked ~ .ws-tabs__list label:nth-child(1), .ws-tabs__radio:nth-of-type(2):checked ~ .ws-tabs__list label:nth-child(2) { border-color: var(--color-edge); background: var(--color-surface); font-weight: 600; }
.ws-tabs__panel .expressive-code { margin-top: 0; }`

const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<div class="expressive-code"><figure class="frame"><figcaption class="header"></figcaption><pre><code>${props.code}</code></pre></figure></div>`)
const example = workspaceShowcase('rs')!.examples.find((entry) => entry.topic === 'three-pane')!

async function joined(): Promise<string> {
  const template = await loadAstroTemplate('components/workspace/WorkspaceConfig.astro', { modules: { 'astro-expressive-code/components': { Code } } })
  return renderAstroTemplate(template, { props: { id: 'gate', yaml: example.yaml, json: example.json } })
}

const frame = (code: string) => `<div class="expressive-code"><figure class="frame"><figcaption class="header"></figcaption><pre><code>${code}</code></pre></figure></div>`
const OLD_MARKUP = `<div class="ws-tabs" role="group"><input type="radio" name="g" id="g-yaml" class="ws-tabs__radio" checked aria-label="YAML"><input type="radio" name="g" id="g-json" class="ws-tabs__radio" aria-label="JSON">
<div class="ws-tabs__list" aria-hidden="true"><label for="g-yaml">YAML</label><label for="g-json">JSON</label></div>
<div class="ws-tabs__panel ws-tabs__panel--yaml">${frame(example.yaml)}</div><div class="ws-tabs__panel ws-tabs__panel--json">${frame(example.json)}</div></div>`

interface Variant {
  css: string
  markup: string
  /** The strip and the box the code sits in, as selectors. */
  strip: string
  panel: (format: 'yaml' | 'json') => string
  tab: (format: 'yaml' | 'json') => string
  /** Elements inside the panel that must draw no border and no rounded corner. */
  inner: string
}

const NEW = { strip: '.ws-config__tabs', panel: (format: 'yaml' | 'json') => `.ws-config__panel--${format}`, tab: (format: 'yaml' | 'json') => `.ws-config__tabs label[for="ws-cfg-gate-${format}"]`, inner: '.ws-config__panel .expressive-code, .ws-config__panel .frame, .ws-config__panel .header, .ws-config__panel pre' }
const variants = async (): Promise<Record<'joined' | 'old' | 'framed', Variant>> => {
  const markup = await joined()
  // The panel with the rule that narrows Expressive Code's frame taken out.
  const framed = SHEET.replace(/\/\*\n \* The code fills the panel[\s\S]*?\n\}\n\n\.ws-config \.ws-config__panel \.expressive-code pre \{[\s\S]*?\n\}\n/, '')
  return {
    joined: { css: SHEET, markup, ...NEW },
    framed: { css: framed, markup, ...NEW },
    old: {
      css: OLD_CSS, markup: OLD_MARKUP, strip: '.ws-tabs__list', panel: (format) => `.ws-tabs__panel--${format} .frame`,
      tab: (format) => `.ws-tabs__list label[for="g-${format}"]`, inner: '.ws-tabs__panel .header, .ws-tabs__panel pre',
    },
  }
}

let browser: Browser
let all: Record<'joined' | 'old' | 'framed', Variant>
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  all = await variants()
  expect(all.framed.css, 'the framed variant removes the frame rule').not.toBe(SHEET)
}, 60_000)
afterAll(async () => { await browser?.close() })

async function load(variant: Variant, { width = 800, dark = false } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height: 700 } })
  await page.setContent(`<!doctype html><html${dark ? ' data-theme-mode="dark"' : ''}><head><style>${TOKENS}\n${FRAME}\n${variant.css}</style></head><body>${variant.markup}</body></html>`)
  return page
}

const pixel = async (page: Page, x: number, y: number) => {
  const png = PNG.sync.read(await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }, type: 'png' }))
  return [...png.data.slice(0, 3)]
}

/** Measure where the tab strip meets its panel and name everything that is not one joined box. */
async function gate(page: Page, variant: Variant, format: 'yaml' | 'json'): Promise<string[]> {
  if (format === 'json') await page.click(variant.tab('json'))
  const facts = await page.evaluate(({ strip, panel, tab, inner, other }) => {
    const style = (node: Element) => getComputedStyle(node)
    const box = (selector: string) => document.querySelector(selector)!
    const rect = (node: Element) => node.getBoundingClientRect()
    const corners = (node: Element) => ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((corner) => parseFloat(style(node).getPropertyValue(`border-${corner.replace(/([A-Z])/g, '-$1').slice(1).toLowerCase()}-radius`)))
    const bar = box(strip)
    const body = box(panel)
    const active = box(tab)
    const idle = box(other)
    return {
      strip: rect(bar).toJSON(), panel: rect(body).toJSON(),
      stripBottom: parseFloat(style(bar).borderBottomWidth), panelTop: parseFloat(style(body).borderTopWidth),
      stripCorners: corners(bar), panelCorners: corners(body),
      active: rect(active).toJSON(), idle: rect(idle).toJSON(),
      inner: [...document.querySelectorAll(inner)].filter((node) => rect(node).width > 0).map((node) => ({
        name: `${node.tagName.toLowerCase()}.${node.getAttribute('class') ?? ''}`.trim(),
        border: ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(style(node).getPropertyValue(`border-${side.toLowerCase()}-width`))),
        radius: corners(node),
      })),
    }
  }, { strip: variant.strip, panel: variant.panel(format), tab: variant.tab(format), inner: variant.inner, other: variant.tab(format === 'yaml' ? 'json' : 'yaml') })
  const found: string[] = []
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01
  if (!near(facts.strip.bottom, facts.panel.top)) found.push(`a gap of ${(facts.panel.top - facts.strip.bottom).toFixed(2)}px between the strip and the panel`)
  if (!near(facts.strip.left, facts.panel.left) || !near(facts.strip.right, facts.panel.right)) found.push('the strip and the panel have different edges')
  const divider = facts.stripBottom + facts.panelTop
  if (divider !== 1) found.push(`a ${divider}px divider where one line is wanted`)
  const [topLeft, topRight, bottomRight, bottomLeft] = facts.stripCorners
  const [panelTopLeft, panelTopRight, panelBottomRight, panelBottomLeft] = facts.panelCorners
  if (!(topLeft! > 0 && near(topLeft!, topRight!))) found.push('the strip does not round its top corners with one radius')
  if (bottomRight !== 0 || bottomLeft !== 0) found.push('the strip rounds its bottom corners')
  if (panelTopLeft !== 0 || panelTopRight !== 0) found.push('the panel rounds the corners it shares with the strip')
  if (!(panelBottomLeft! > 0 && near(panelBottomLeft!, panelBottomRight!))) found.push('the panel does not round its bottom corners with one radius')
  if (!near(topLeft!, panelBottomLeft!)) found.push(`the radii differ: ${topLeft}px on the strip, ${panelBottomLeft}px on the panel`)
  for (const node of facts.inner) {
    if (node.border.some((width) => width > 0)) found.push(`${node.name} draws a border inside the panel`)
    if (node.radius.some((radius) => radius > 0)) found.push(`${node.name} rounds a corner inside the panel`)
  }
  // The divider row, read as pixels: under the active tab it takes the panel's colour, under the other tab it is the line.
  const row = facts.strip.bottom - 0.5
  const under = await pixel(page, facts.active.left + facts.active.width / 2, row)
  const beside = await pixel(page, facts.idle.left + facts.idle.width / 2, row)
  if (under.join() === beside.join()) found.push('a line runs under the active tab')
  const edge = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-edge').trim())
  const wanted = [1, 3, 5].map((index) => parseInt(edge.slice(index, index + 2), 16))
  if (beside.join() !== wanted.join()) found.push(`the divider is ${beside.join()}, not the edge colour ${wanted.join()}`)
  return found
}

describe('the configuration panel in Chromium', () => {
  for (const [name, options] of [['light', {}], ['dark', { dark: true }], ['a phone', { width: 360 }]] as const) {
    for (const format of ['yaml', 'json'] as const) {
      it(`is one box with one divider and one radius, ${format} showing, ${name}`, async () => {
        const page = await load(all.joined, options)
        expect(await gate(page, all.joined, format)).toEqual([])
        await page.close()
      })
    }
  }

  it('joins the active tab to the panel as the tab changes, and only that tab', async () => {
    const page = await load(all.joined)
    const first = await page.evaluate(() => getComputedStyle(document.querySelector('.ws-config__tabs label:nth-child(1)')!).backgroundColor)
    const second = await page.evaluate(() => getComputedStyle(document.querySelector('.ws-config__tabs label:nth-child(2)')!).backgroundColor)
    expect(first).not.toBe(second)
    await page.click('.ws-config__tabs label:nth-child(2)')
    const after = await page.evaluate(() => getComputedStyle(document.querySelector('.ws-config__tabs label:nth-child(1)')!).backgroundColor)
    expect(after).toBe(second)
    await page.close()
  })

  it('catches the strip and panel as first drawn: a double divider, mismatched corners and a line under the tab', async () => {
    const page = await load(all.old)
    const found = await gate(page, all.old, 'yaml')
    expect(found).toContain('a 2px divider where one line is wanted')
    expect(found).toContain('the strip does not round its top corners with one radius')
    expect(found).toContain('the panel rounds the corners it shares with the strip')
    expect(found).toContain('a line runs under the active tab')
    await page.close()
  })

  it('catches a frame left inside the panel as a second border and rounded corners', async () => {
    const page = await load(all.framed)
    const found = await gate(page, all.framed, 'yaml')
    expect(found.some((message) => message.startsWith('figure.frame draws a border inside the panel'))).toBe(true)
    expect(found.some((message) => message.startsWith('figure.frame rounds a corner inside the panel'))).toBe(true)
    await page.close()
  })
})
