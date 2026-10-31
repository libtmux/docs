import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))

const { PNG } = createRequire(import.meta.url)('pngjs') as { PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Uint8Array } } } }

/**
 * The Qualified name row of the source and package disclosure is as tall as the rows around it, and its copy control sits
 * inside the row. The control is the height of the line beside it; a target of at least 30px square reaches past it
 * through a pseudo-element that takes no layout, and the focus ring frames the control and not that target. Measured in a
 * real browser with the site's own stylesheet and the component's own markup, no server.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = ['../src/styles/api.css', '../src/styles/api-kinds.css'].map(read).join('\n')

/** The rules before this change, laid over the stylesheet: a 1.875rem box that stretched the row, or overhung it by a negative margin. */
const BOX = '.api-copy-name { width: 1.875rem; height: 1.875rem; margin-block: 0; } .api-copy-name::before { content: none; }'
const STRETCHED = BOX
const OVERHANG = `${BOX} .api-copy-name { margin-block: calc((1lh - 1.875rem) / 2); }`
/** The control as it is, with nothing extending its target. */
const NO_TARGET = '.api-copy-name::before { content: none; }'

let browser: Browser
let qualified: string
beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const template = await loadAstroTemplate('components/api/ApiQualifiedName.astro', { real: ['components/api/SymbolName.astro'] })
  qualified = withoutScope(await renderAstroTemplate(template, { props: { name: 'libtmux::pane::Pane::send_keys', kind: 'method' } }))
}, 60_000)
afterAll(async () => { await browser?.close() })

/** A page that resets the button as the site's base styles do: it takes its font and line height from the row. */
const page = (css: string) => `<!doctype html><html><head><style>:root { --color-edge: #d6dce3; --color-muted: #53606d; --color-link: #6f1a24; --focus-ring-color: #ff00ff; }
body { margin: 0; padding: 12px; font: 16px/1.5 sans-serif; width: 50rem; } button { font: inherit; background: none; border: 0; }
${css}</style></head><body><dl class="api-definition">
<dt>Qualified name</dt><dd>${qualified}</dd>
<dt>Module</dt><dd><a href="/pane/">libtmux::pane</a></dd>
<dt>Declared in</dt><dd><a href="/pane/"><code>Pane</code></a></dd>
<dt>Source</dt><dd><a href="/src/">crates/libtmux/src/pane.rs</a></dd>
</dl></body></html>`

interface Box { left: number; top: number; right: number; bottom: number }

/** Everything the tests read about one stylesheet, in CSS pixels. */
async function measure(css: string) {
  const target = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await target.setContent(page(css))
  const layout = await target.evaluate(() => {
    const box = (element: Element): Box => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const rows = [...document.querySelectorAll('.api-definition > dd')].map((dd) => dd.getBoundingClientRect().height)
    const button = document.querySelector<HTMLElement>('.api-copy-name')!
    ;(window as unknown as { clicks: number }).clicks = 0
    button.addEventListener('click', () => { (window as unknown as { clicks: number }).clicks++ })
    return { rows, button: box(button), name: box(document.querySelector('.api-qualified-name')!), value: box(document.querySelector('.api-definition > dd')!) }
  })
  const centre = { x: (layout.button.left + layout.button.right) / 2, y: (layout.button.top + layout.button.bottom) / 2 }
  // The middle of each edge of a square target `reach` pixels from the centre: its corners would miss a rounded control.
  const edges = (reach: number) => [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([x, y]) => ({ x: centre.x + x! * reach, y: centre.y + y! * reach }))
  const hits = async (reach: number) => Promise.all(edges(reach).map((point) => target.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.closest('.api-copy-name') != null, point)))
  const reached = { inside: await hits(14.5), outside: await hits(20) }
  // A real click on the edge of the target above the control, outside the control's own box.
  const [above] = edges(14.5).slice(2)
  await target.mouse.click(above!.x, above!.y)
  const clicks = await target.evaluate(() => (window as unknown as { clicks: number }).clicks)
  // Focus by keyboard on a fresh page, since the click above focused the button already, then find the ring in the
  // pixels: it is the only magenta on the page.
  await target.setContent(page(css))
  await target.keyboard.press('Tab')
  const png = PNG.sync.read(await target.screenshot())
  const ring: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const at = (y * png.width + x) * 4
    if (png.data[at]! > 200 && png.data[at + 1]! < 90 && png.data[at + 2]! > 200) {
      ring.left = Math.min(ring.left, x); ring.top = Math.min(ring.top, y); ring.right = Math.max(ring.right, x + 1); ring.bottom = Math.max(ring.bottom, y + 1)
    }
  }
  await target.close()
  return { ...layout, reached, clicks, ring }
}

describe('the copy control of the Qualified name row', () => {
  it('keeps the row as tall as its neighbours', async () => {
    const { rows } = await measure(styles)
    expect(rows.every((height) => Math.abs(height - rows[1]!) < 0.5), `row heights ${rows}`).toBe(true)
  })

  it('keeps its own box inside the row, as the reference check requires', async () => {
    const { button, name, value } = await measure(styles)
    for (const row of [name, value]) {
      expect(button.top).toBeGreaterThanOrEqual(row.top - 1)
      expect(button.bottom).toBeLessThanOrEqual(row.bottom + 1)
    }
  })

  it('takes clicks over a target 30px across, and no further', async () => {
    const { reached, clicks } = await measure(styles)
    expect(reached.inside, 'the edges of a 29px square').toEqual([true, true, true, true])
    expect(reached.outside, 'the edges of a 40px square').toEqual([false, false, false, false])
    expect(clicks, 'a click on the target above the control').toBe(1)
  })

  it('frames the visible control with its focus ring, not the larger target', async () => {
    const { button, ring } = await measure(styles)
    // A 2px ring 2px off the control: 4px beyond its box on every side, give or take the pixel grid.
    for (const side of ['left', 'top'] as const) expect(button[side] - ring[side], side).toBeGreaterThanOrEqual(3)
    for (const side of ['right', 'bottom'] as const) expect(ring[side] - button[side], side).toBeGreaterThanOrEqual(3)
    // Around the control it is 4px each side of its height. Around the 30px target it would be 38px.
    expect(ring.bottom - ring.top, 'the ring is as tall as the control and its margin').toBeLessThan(button.bottom - button.top + 10)
    expect(ring.bottom - ring.top, 'the ring does not frame the target').toBeLessThan(34)
  })

  describe('negative controls: each check fails on the rules it replaces', () => {
    it('sees the row stretch under a 1.875rem box in the flow', async () => {
      const { rows } = await measure(`${styles}\n${STRETCHED}`)
      expect(rows[0]).toBeGreaterThan(rows[1]! + 5)
    })

    it('sees the box leave the row under the negative margin that overhung it', async () => {
      const { rows, button, name } = await measure(`${styles}\n${OVERHANG}`)
      expect(rows.every((height) => Math.abs(height - rows[1]!) < 0.5)).toBe(true)
      expect(button.top).toBeLessThan(name.top - 1)
      expect(button.bottom).toBeGreaterThan(name.bottom + 1)
    })

    it('sees the target shrink to the control without the pseudo-element', async () => {
      const { reached } = await measure(`${styles}\n${NO_TARGET}`)
      expect(reached.inside).not.toEqual([true, true, true, true])
    })
  })
})
