import { readFileSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cardHtml, previewCard } from '../src/lib/link-preview-card'
import type { LinkPreview } from '../src/lib/link-preview'
import { cardPayloads } from './link-preview-payloads'

/**
 * The card in a real browser, with the site's own stylesheets and no server: its surfaces and inks in light and dark,
 * the room it takes at the narrowest widths, a declaration too long for it, and the order a keyboard reaches its controls.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cardStyles = read('../src/components/LinkPreview.astro').match(/<style is:global>([\s\S]*?)<\/style>/)![1]!
const tokens = ['../src/styles/gp-sphinx-tokens.css', '../src/styles/api-kinds.css', '../src/styles/kind-marks.css'].map(read).join('\n')
// The one rule that colours a highlighted token, which the page's global stylesheet owns.
const tokenInk = read('../src/styles/global.css').match(/\.lm-highlighted span \{[^}]*\}\s*html\[data-theme-mode="dark"\] \.lm-highlighted span \{[^}]*\}/)![0]
const PAGE = `
:root { --font-sans: sans-serif; --font-mono: monospace; --background-color: #ffffff; --text-color: #1a1c1e; }
[data-theme-mode='dark'] { --background-color: #131416; --text-color: #cfd0d0; }
body { margin: 0; background: var(--background-color); color: var(--text-color); font: 16px/1.5 var(--font-sans); }`

const page = (cards: string, mode: 'light' | 'dark') => `<!doctype html><html data-theme-mode="${mode}" data-color-scheme="${mode}"><head><meta name="viewport" content="width=device-width">
<style>${tokens}\n${tokenInk}\n${PAGE}\n${cardStyles}</style></head><body><button id="trigger" popovertarget="card" popovertargetaction="show">Show</button>${cards}</body></html>`

/** The card as the page writes it, as a popover that a native control opens. */
const popover = (preview: LinkPreview) => `<span id="card" popover="auto" role="dialog" aria-label="${preview.title} preview" class="reference-link-preview not-prose">${cardHtml(previewCard(preview, { id: 'card' }))}</span>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

async function open(target: Page, preview: LinkPreview, mode: 'light' | 'dark', width = 480) {
  await target.setViewportSize({ width, height: 900 })
  await target.emulateMedia({ colorScheme: mode })
  await target.setContent(page(popover(preview), mode))
  await target.evaluate(() => (document.getElementById('card') as HTMLElement).showPopover())
}

/**
 * What spills: the card scrolls sideways, leaves the viewport, or has ink past its own edge. Ink is the text that a
 * reader sees, measured by the rectangles of its words; the spaces that a wrapped line hangs past its edge draw nothing.
 */
const spills = (target: Page) => target.evaluate(() => {
  const card = document.getElementById('card')!
  const box = card.getBoundingClientRect()
  const stray: string[] = []
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('[hidden]')) continue
    for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
      const range = document.createRange()
      range.setStart(node, word.index)
      range.setEnd(node, word.index + word[0].length)
      const right = Math.max(...[...range.getClientRects()].map((rect) => rect.right))
      if (right > box.right + 0.5) stray.push(`${node.parentElement?.tagName.toLowerCase()} ${JSON.stringify(word[0].slice(0, 30))} ends ${Math.round(right)} of ${Math.round(box.right)}`)
    }
  }
  return { scrolls: card.scrollWidth > card.clientWidth, outside: box.left < 0 || box.right > innerWidth, stray }
})

describe('the card in a browser', () => {
  it('draws the header, the declaration band, the summary and the footer on the site\'s own tokens, in light and dark', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const target = await browser.newPage()
    try {
      const surfaces = { light: { band: 'rgb(248, 249, 251)', page: 'rgb(255, 255, 255)', edge: 'rgb(238, 235, 238)', types: 'rgb(191, 219, 254)', callables: 'rgb(253, 230, 138)' },
        dark: { band: 'rgb(26, 28, 30)', page: 'rgb(19, 20, 22)', edge: 'rgb(48, 51, 53)', types: 'rgb(30, 64, 175)', callables: 'rgb(120, 53, 15)' } }
      for (const mode of ['light', 'dark'] as const) {
        await open(target, preview, mode)
        const seen = await target.evaluate(() => {
          const style = (selector: string) => getComputedStyle(document.querySelector(selector)!)
          return {
            card: style('#card').backgroundColor, edge: style('#card').borderTopColor,
            header: style('.reference-link-preview__heading').backgroundColor, headerEdge: style('.reference-link-preview__heading').borderBottomColor,
            band: style('.reference-link-preview__signature').backgroundColor, prose: style('.reference-link-preview__prose').backgroundColor,
            footerEdge: style('.reference-link-preview__footer').borderTopColor, name: style('[data-preview-title]'),
            chip: document.querySelector('[data-preview-kind] .api-leg')!.getBoundingClientRect().height,
            chipFill: style('[data-preview-kind] .api-leg').backgroundColor,
            mention: style('[data-preview-description] .api-nav__kind').backgroundColor,
          }
        })
        const want = surfaces[mode]
        expect(seen.card, mode).toBe(want.page)
        expect(seen.edge, mode).toBe(want.edge)
        expect(seen.header, mode).toBe(want.band)
        expect(seen.headerEdge, mode).toBe(want.edge)
        expect(seen.band, mode).toBe(want.band)
        // The summary sits on the page's own surface, so the band reads as a band.
        expect(seen.prose, mode).toBe('rgba(0, 0, 0, 0)')
        expect(seen.footerEdge, mode).toBe(want.edge)
        expect(seen.chipFill, mode).toBe(want.callables)
        // The first named type of this card is a method, so its mark carries the same tint as the header's.
        expect(seen.mention, mode).toBe(want.callables)
        expect(seen.chip, mode).toBeCloseTo(20, 0)
      }
    } finally { await target.close() }
  })

  it('keeps the mark of a named type tinted by its kind in the summary, apart from the header\'s kind', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const target = await browser.newPage()
    try {
      for (const [mode, types] of [['light', 'rgb(191, 219, 254)'], ['dark', 'rgb(30, 64, 175)']] as const) {
        await open(target, preview, mode)
        const fills = await target.evaluate(() => [...document.querySelectorAll('[data-preview-description] a > .api-nav__kind')]
          .map((mark) => [mark.getAttribute('data-api-kind'), getComputedStyle(mark).backgroundColor]))
        expect(fills.length).toBeGreaterThan(0)
        for (const [kind, fill] of fills) {
          if (kind === 'struct') expect(fill, `${mode} ${kind}`).toBe(types)
          else expect(fill, `${mode} ${kind}`).not.toBe('rgba(0, 0, 0, 0)')
        }
      }
    } finally { await target.close() }
  })

  it('stays inside the viewport with nothing sideways, for every kind, at the narrowest widths', { timeout: 60_000 }, async () => {
    const target = await browser.newPage()
    try {
      for (const [name, preview] of await cardPayloads()) {
        for (const mode of ['light', 'dark'] as const) {
          await open(target, preview, mode)
          for (const width of [280, 320, 390, 768]) {
            await target.setViewportSize({ width, height: 900 })
            expect(await spills(target), `${name} at ${width}px, ${mode}`).toEqual({ scrolls: false, outside: false, stray: [] })
            const box = (await target.locator('#card').boundingBox())!
            expect(box.width, `${name} at ${width}px`).toBeLessThanOrEqual(Math.min(448, width - 32) + 0.5)
            expect(box.height, `${name} at ${width}px`).toBeLessThanOrEqual(900 - 32 + 0.5)
          }
        }
      }
    } finally { await target.close() }
  })

  it('catches a card that spills, so that the check above can fail', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const wide = { ...preview, signature: `fn ${'a'.repeat(160)}()`, signatureHighlight: undefined, title: 'b'.repeat(120) }
    const target = await browser.newPage()
    try {
      // The control: the card as the site writes it wraps a name that has no break in it.
      await open(target, wide, 'light', 280)
      expect(await spills(target)).toEqual({ scrolls: false, outside: false, stray: [] })
      // The named failure: without `overflow-wrap`, the same card runs past its edge.
      await target.addStyleTag({ content: '.reference-link-preview { overflow-wrap: normal !important; } .reference-link-preview__signature { white-space: pre !important; }' })
      const found = await spills(target)
      expect(found.scrolls || found.stray.length > 0).toBe(true)
    } finally { await target.close() }
  })

  it('shows the head of a very long declaration and keeps the card within its height', { timeout: 30_000 }, async () => {
    const lines = Array.from({ length: 400 }, (_, index) => `  KEYC_CASE_${index} = ${index},`)
    const huge: LinkPreview = { schema: 1, title: 'enum', kind: 'enum', description: 'Key codes.', signature: `enum {\n${lines.join('\n')}\n}`, signatureLanguage: 'c', href: '/en/tmux/latest/reference/enum/' }
    const target = await browser.newPage()
    try {
      await open(target, huge, 'light', 390)
      const code = target.locator('[data-preview-signature]')
      const text = (await code.textContent())!
      expect(text.split('\n').length).toBeLessThanOrEqual(13)
      expect(text.endsWith('\n…')).toBe(true)
      expect((await code.boundingBox())!.height).toBeLessThan(13 * 13 * 1.6 + 20)
      const card = (await target.locator('#card').boundingBox())!
      expect(card.height).toBeLessThan(900 - 32)
      expect(await spills(target)).toEqual({ scrolls: false, outside: false, stray: [] })
    } finally { await target.close() }
  })

  it('gives the close control a target of at least 24 px each way, at every width', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const target = await browser.newPage()
    try {
      for (const width of [280, 390, 768]) {
        await open(target, preview, 'light', width)
        const box = (await target.locator('[data-preview-close]').boundingBox())!
        expect(box.width, `${width}px`).toBeGreaterThanOrEqual(24)
        expect(box.height, `${width}px`).toBeGreaterThanOrEqual(24)
      }
    } finally { await target.close() }
  })

  it('opens from its trigger, reaches the close control, each named type and the way to the page in that order, and closes on Escape', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const target = await browser.newPage()
    try {
      await target.setViewportSize({ width: 480, height: 900 })
      await target.setContent(page(popover(preview), 'light'))
      await target.locator('#trigger').focus()
      await target.keyboard.press('Enter')
      await target.locator('#card').waitFor({ state: 'visible' })
      const focused = () => target.evaluate(() => {
        const element = document.activeElement!
        return element.hasAttribute('data-preview-close') ? 'close' : element.hasAttribute('data-preview-open') ? 'open' : element.classList.contains('api-xref') ? `type ${element.getAttribute('aria-label')}` : element.tagName
      })
      const wanted = await target.evaluate(() => [...document.querySelectorAll('#card .api-xref')].map((link) => `type ${link.getAttribute('aria-label')}`))
      expect(wanted.length).toBeGreaterThan(0)
      const order: string[] = []
      for (let step = 0; step < wanted.length + 2; step++) { await target.keyboard.press('Tab'); order.push(await focused()) }
      expect(order).toEqual(['close', ...wanted, 'open'])
      // A focused control shows its ring inside the card, where the card's own scrolling does not clip it.
      const ring = await target.evaluate(() => {
        const open = document.activeElement as HTMLElement
        const card = document.getElementById('card')!.getBoundingClientRect(), box = open.getBoundingClientRect()
        return { outline: getComputedStyle(open).outlineStyle, inside: box.left - 3 >= card.left && box.right + 3 <= card.right && box.bottom + 3 <= card.bottom }
      })
      expect(ring).toEqual({ outline: 'solid', inside: true })
      await target.keyboard.press('Escape')
      await target.locator('#card').waitFor({ state: 'hidden' })
    } finally { await target.close() }
  })

  it('reaches the control that shows the whole name of a long one, ahead of the declaration', { timeout: 30_000 }, async () => {
    const long = (await cardPayloads()).find(([name]) => name === 'API name long enough to abbreviate')![1]
    const target = await browser.newPage()
    try {
      await target.setViewportSize({ width: 480, height: 900 })
      await target.setContent(page(popover(long), 'light'))
      await target.locator('#trigger').focus()
      await target.keyboard.press('Enter')
      await target.locator('#card').waitFor({ state: 'visible' })
      await target.keyboard.press('Tab')
      await target.keyboard.press('Tab')
      expect(await target.evaluate(() => document.activeElement!.hasAttribute('data-preview-expand'))).toBe(true)
      const outline = await target.evaluate(() => {
        const strip = document.activeElement as HTMLElement
        const card = document.getElementById('card')!.getBoundingClientRect(), box = strip.getBoundingClientRect()
        return { drawn: getComputedStyle(strip).outlineStyle, inside: parseFloat(getComputedStyle(strip).outlineOffset) < 0 && box.left >= card.left }
      })
      expect(outline).toEqual({ drawn: 'solid', inside: true })
    } finally { await target.close() }
  })
})

/** The room above and below the summary: from the edge of what sits over it to its top, and from its bottom to the footer. */
const summaryGaps = (target: Page) => target.evaluate(() => {
  const box = document.querySelector('.reference-link-preview__prose')!.getBoundingClientRect()
  const summary = document.querySelector('[data-preview-description]')!.getBoundingClientRect()
  return { above: summary.top - box.top, below: box.bottom - summary.bottom }
})

describe('the room around the summary', () => {
  const summary = 'Sends the keys to the pane and returns once tmux has accepted them, so a caller that needs the output waits for it separately.'
  const declared: LinkPreview = { schema: 1, title: 'send_keys', kind: 'method', description: summary, signature: 'fn send_keys(&self, keys: &str)', href: '/en/x/' }
  const bare: LinkPreview = { ...declared, signature: undefined }
  // The padding the card had before: the summary sat close under a declaration and far above the footer.
  const unequal = '.reference-link-preview__prose { padding: .55rem .8rem .7rem; } .reference-link-preview__signature:not([hidden]) + .reference-link-preview__prose { padding-top: .1rem; }'

  it('is the same above and below, with a declaration over it or without, at a narrow and a wide card', { timeout: 30_000 }, async () => {
    const target = await browser.newPage()
    try {
      for (const [name, preview] of [['with a declaration', declared], ['without one', bare]] as const) {
        for (const width of [320, 480]) {
          await open(target, preview, 'light', width)
          const { above, below } = await summaryGaps(target)
          expect(above, `${name} at ${width}px: above`).toBeGreaterThan(8)
          expect(Math.abs(above - below), `${name} at ${width}px: ${above.toFixed(1)} above, ${below.toFixed(1)} below`).toBeLessThan(0.5)
        }
      }
    } finally { await target.close() }
  })

  it('keeps every line of a summary that names a type the height of the others', { timeout: 30_000 }, async () => {
    const [, preview] = (await cardPayloads())[0]!
    const target = await browser.newPage()
    try {
      for (const width of [320, 480]) {
        await open(target, preview, 'light', width)
        const { lines, marks, ratio } = await target.evaluate(() => {
          const summary = document.querySelector('[data-preview-description]') as HTMLElement
          const style = getComputedStyle(summary)
          return {
            lines: summary.getBoundingClientRect().height / parseFloat(style.lineHeight),
            // The marks of the named types are what the line height has to leave room for.
            marks: summary.querySelectorAll('.api-link-kind').length,
            ratio: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
          }
        })
        expect(marks, `${width}px: the summary names a type with a mark`).toBeGreaterThan(0)
        expect(ratio, `${width}px: the line height`).toBeCloseTo(1.55, 2)
        expect(Math.abs(lines - Math.round(lines)), `${width}px: ${lines} lines`).toBeLessThan(0.05)
      }
    } finally { await target.close() }
  })

  it('sees the old padding as gaps that differ, so that the checks above can fail', { timeout: 30_000 }, async () => {
    const target = await browser.newPage()
    try {
      for (const [preview, least] of [[declared, 5], [bare, 1.5]] as const) {
        await open(target, preview, 'light')
        await target.addStyleTag({ content: unequal })
        const { above, below } = await summaryGaps(target)
        expect(below - above, preview.signature ? 'with a declaration' : 'without one').toBeGreaterThan(least)
      }
    } finally { await target.close() }
  })
})

describe('a card with no summary', () => {
  const named = async (name: string) => (await cardPayloads()).find(([entry]) => entry === name)![1]
  /** How far the box under the declaration, or under the header when there is none, stands from the footer, and whether the summary box is drawn. */
  const stackedGap = (target: Page) => target.evaluate(() => {
    const edge = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const above = document.querySelector('[data-preview-signature]:not([hidden])') ? edge('[data-preview-signature]') : edge('.reference-link-preview__heading')
    return { gap: edge('.reference-link-preview__footer').top - above.bottom, drawn: getComputedStyle(document.querySelector('.reference-link-preview__prose')!).display !== 'none' }
  })

  it('goes from the declaration, or from the header, straight to the footer', { timeout: 30_000 }, async () => {
    const target = await browser.newPage()
    try {
      for (const name of ['declaration with a signature and no summary', 'declaration with nothing under its name']) {
        for (const mode of ['light', 'dark'] as const) {
          await open(target, await named(name), mode)
          const { gap, drawn } = await stackedGap(target)
          expect(drawn, `${name}, ${mode}`).toBe(false)
          expect(Math.abs(gap), `${name}, ${mode}`).toBeLessThan(0.5)
        }
      }
    } finally { await target.close() }
  })

  it('leaves a gap when the summary box is drawn anyway, so that the check above can fail', { timeout: 30_000 }, async () => {
    const target = await browser.newPage()
    try {
      await open(target, await named('declaration with a signature and no summary'), 'light')
      await target.addStyleTag({ content: '.reference-link-preview__prose { display: block !important; }' })
      const { gap, drawn } = await stackedGap(target)
      expect(drawn).toBe(true)
      expect(gap).toBeGreaterThan(8)
    } finally { await target.close() }
  })

  it('keeps the context line of a card whose only text is that, without a gap above it', { timeout: 30_000 }, async () => {
    const target = await browser.newPage()
    try {
      await open(target, { schema: 1, title: 'inherited', kind: 'method', description: '', detail: 'Inherited from Base.', href: '/en/x/' }, 'light')
      const seen = await target.evaluate(() => {
        const prose = document.querySelector('.reference-link-preview__prose')!, detail = document.querySelector('[data-preview-detail]')!
        return { display: getComputedStyle(prose).display, inset: detail.getBoundingClientRect().top - prose.getBoundingClientRect().top }
      })
      expect(seen.display).toBe('block')
      expect(seen.inset).toBeCloseTo(9.6, 0)
    } finally { await target.close() }
  })
})
