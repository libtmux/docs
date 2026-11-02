import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import ts from 'typescript'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { presetOptions, workspaceShowcase } from '../src/lib/workspace-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * The picker in a real browser: the site's searchable menu opens, filters and
 * chooses; a roll never repeats; choosing a preset, a window or a roll moves
 * nothing; the configuration and the drawing stand side by side at equal height
 * where there is room and stack where there is not; a preset that is not shown
 * paints nothing; nothing scrolls the page sideways; the remembered or named
 * preset is on screen before the picker's script runs; and a page without
 * script shows the first preset with every example below it.
 *
 * The page is the real picker and examples templates, the real stylesheets,
 * the real client code and the site's own menu script. Expressive Code is
 * replaced by a frame with its own border, radius, padding and line height,
 * since the claims are about the panel's box and not about the code's colours.
 */
const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
/** One classic script from modules: types erased, exports made local and imports dropped (the imported modules are listed first). */
const script = (...names: string[]) => names
  .map((name) => ts.transpileModule(read(name).replace(/^import .*$/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  .join('\n').replace(/^export /gm, '')
// The picker imports the home page's hover binding and the status badges' hover delay.
const CLIENT = script('lib/home-hover-preview.ts', 'lib/status-toggletip.ts', 'lib/workspace-picker.ts')
const MENU = script('components/docs/documentation-navigation.ts')
const REROLL = /<style is:global>([\s\S]*?)<\/style>/.exec(read('components/RerollButton.astro'))![1]!

/** Expressive Code's frame as it draws before a stylesheet narrows it: a border and a radius of its own. */
const FRAME = `.expressive-code { margin: 1rem 0; }
.expressive-code .frame { display: block; border: 1px solid #d0d7de; border-radius: 7px; overflow: hidden; }
.expressive-code .frame .header { display: block; border-radius: 7px 7px 0 0; }
.expressive-code pre { margin: 0; padding: 1rem; border: 0; font: 0.875rem/1.7 monospace; white-space: pre; overflow: auto; background: #fff; }`
const TOKENS = `:root { --color-edge: #ddd; --color-surface: #f8f9fb; --color-surface-hover: #efeff4; --color-muted: #666; --text-color: #000; --background-color: #fff; --theme-primary: #4f46e5;
  --color-link: #4f46e5; --focus-ring-color: #4f46e5; --text-color-inverted: #fff; --lm-shell-prompt: #a855f7; --color-background-secondary: #f8f9fb; --color-foreground-muted: #666; }
html[data-theme-mode="dark"] { --color-edge: #303335; --color-surface: #1a1c1e; --color-surface-hover: #1e2124; --color-muted: #81868d; --text-color: #cfd0d0; --background-color: #131416; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 52rem; padding: 0 1rem; background: var(--background-color); color: var(--text-color); font: 16px/1.5 sans-serif; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }`
const SHEETS = ['styles/documentation-picker.css', 'styles/tmux-layout.css', 'styles/workspace-showcase.css', 'styles/workspace-picker.css'].map(read).join('\n')
const STYLES = `${TOKENS}\n${FRAME}\n${REROLL}\n${SHEETS}`

const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<div class="expressive-code"><figure class="frame"><figcaption class="header"></figcaption><pre><code>${props.code}</code></pre></figure></div>`)
const modules = { 'astro-expressive-code/components': { Code } }
const REAL = ['components/RerollButton.astro', 'components/workspace/WorkspaceConfig.astro', 'components/workspace/WorkspaceWindows.astro', 'components/docs/PickerSearch.astro']
const showcase = workspaceShowcase('rs')!
const PRESETS = presetOptions(showcase)
const IDS = PRESETS.map((preset) => preset.id)
const WIDTHS = [1440, 1024, 768, 390] as const

interface Early { selected: string | null; shown: string[]; label: (string | null)[]; upgraded: boolean }

/** The page. `styles` may replace the stylesheet, to prove a check fails on a bad one. */
async function html(styles = STYLES): Promise<string> {
  const picker = await renderAstroTemplate(await loadAstroTemplate('components/workspace/WorkspacePicker.astro', { real: REAL, modules, inlineScripts: true }), { props: { showcase } })
  const examples = await renderAstroTemplate(await loadAstroTemplate('components/workspace/WorkspaceShowcase.astro', { real: REAL, modules }), { props: { showcase } })
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Workspace</title>
<script>document.documentElement.dataset.js = ''</script><style>${styles}</style></head>
<body><p id="before">Intro</p>${picker}
<script>
  // What is on screen once the picker's markup is parsed, before any script of its own has run.
  const picker = document.querySelector('libtmux-workspace-picker')
  window.__early = {
    selected: picker.getAttribute('data-selected'),
    shown: [...picker.querySelectorAll('.ws-picker__panel')].filter((panel) => getComputedStyle(panel).visibility === 'visible').map((panel) => panel.dataset.preset),
    label: [...picker.querySelectorAll('.ws-picker__current > span')].filter((label) => getComputedStyle(label).visibility === 'visible').map((label) => label.textContent),
    upgraded: Boolean(customElements.get('libtmux-workspace-picker')),
  }
</script>
<p id="after">After the picker</p>${examples}
<script>${MENU}\ninitDocumentationNavigation()</script>
<script>${CLIENT}\ndefineWorkspacePicker()</script></body></html>`
}

const ADDRESS = 'http://workspace.test/en/rs/latest/workspace/'
let browser: Browser
let page: string

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  page = await html()
}, 60_000)
afterAll(async () => { await browser?.close() })

async function open(context: BrowserContext, path = '', body = page): Promise<Page> {
  await context.route('http://workspace.test/**', (route) => route.fulfill({ contentType: 'text/html', body }))
  const tab = await context.newPage()
  await tab.goto(`${ADDRESS}${path}`)
  return tab
}

/**
 * The page as a slow connection delivers it: up to the second preset, then the rest once the browser
 * has painted that much. A page served whole is parsed before it is first painted, so a test that
 * relied on the speed of a load would pass or fail with the speed of the machine.
 */
async function serveInPieces(body: string): Promise<{ url: string; close: () => Promise<void> }> {
  const panel = '<section class="ws-picker__panel"'
  const second = body.indexOf(panel, body.indexOf(panel) + 1)
  expect(second).toBeGreaterThan(0)
  let painted = () => {}
  const waiting = new Promise<void>((done) => { painted = done })
  const server = createServer(async (request, response) => {
    if (request.url === '/painted') {
      painted()
      response.writeHead(204).end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.write(`${body.slice(0, second)}<script>requestAnimationFrame(() => requestAnimationFrame(() => fetch('/painted')))</script>`)
    await waiting
    response.end(body.slice(second))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections() }) }
}

const layoutShift = () => {
  const shifts = { total: 0 }
  ;(window as unknown as { __shifts: typeof shifts }).__shifts = shifts
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) shifts.total += entry.value
  }).observe({ type: 'layout-shift', buffered: true })
}
const shifts = (tab: Page) => tab.evaluate(() => (window as unknown as { __shifts: { total: number } }).__shifts.total)
const early = (tab: Page) => tab.evaluate(() => (window as unknown as { __early: Early }).__early)

const settle = (tab: Page) => tab.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
/** Choose a preset the way a click on its row does. */
const choose = async (tab: Page, id: string) => {
  await tab.evaluate((preset) => document.querySelector<HTMLElement>(`[data-preset-option="${preset}"]`)!.click(), id)
  await settle(tab)
}

/** The preset on screen, and what each element of the picker's box says about itself. */
const measure = (tab: Page) => tab.evaluate(() => {
  const box = (node: Element | null) => {
    const rect = node?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null
  }
  const root = document.querySelector('libtmux-workspace-picker')!
  const selected = root.getAttribute('data-selected')
  const panels = [...document.querySelectorAll<HTMLElement>('.ws-picker__panel')]
  const active = panels.find((panel) => panel.dataset.preset === selected) ?? null
  const shown = (node: Element) => node.checkVisibility({ visibilityProperty: true })
  return {
    selected,
    stage: box(document.querySelector('.ws-picker__stage'))!,
    after: document.getElementById('after')!.getBoundingClientRect().top + scrollY,
    config: box(active?.querySelector('.ws-config') ?? null),
    layout: box(active?.querySelector('.ws-layout') ?? null),
    visible: panels.filter((panel) => getComputedStyle(panel).visibility === 'visible').map((panel) => panel.dataset.preset),
    reachable: panels.filter((panel) => !panel.inert).map((panel) => panel.dataset.preset),
    window: [...(active?.querySelectorAll<HTMLElement>('[data-window]') ?? [])].map((figure) => getComputedStyle(figure).visibility === 'visible'),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    wide: [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !node.closest('svg, pre, .ws-layout__tabs') && getComputedStyle(node).visibility !== 'hidden')
      .slice(0, 6).map((node) => `${node.tagName.toLowerCase()}.${String(node.getAttribute('class') ?? '').split(' ')[0]}`).join(' '),
    // Anything of a preset that is not shown which a reader could still see.
    leaks: panels.filter((panel) => panel !== active).flatMap((panel) => [...panel.querySelectorAll('*')].filter((node) => shown(node) && node.getBoundingClientRect().width > 0).map((node) => `${panel.dataset.preset}:${node.tagName.toLowerCase()}`)).slice(0, 5),
    captions: [...document.querySelectorAll('.ws-picker .ws-win figcaption')].filter(shown).map((caption) => caption.textContent!.trim()),
    label: [...document.querySelectorAll('.ws-picker__current > span')].filter((label) => getComputedStyle(label).visibility === 'visible').map((label) => label.textContent),
    menu: box(document.querySelector('.ws-picker__menu > summary')),
    roll: box(document.querySelector('[data-action="roll"]')),
  }
})

/** The window-tab strip of one preset, its buttons and its slider, as the browser lays them out. */
const strip = (tab: Page, preset: string) => tab.evaluate((id) => {
  const panel = document.querySelector(`.ws-picker__panel[data-preset="${id}"]`)!
  const bar = panel.querySelector<HTMLElement>('.ws-layout__tabs')!
  const box = (node: Element | null | undefined) => {
    const rect = node?.getBoundingClientRect()
    return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null
  }
  const [start, end] = [...panel.querySelectorAll<HTMLElement>('.ws-layout__scroll')]
  const slider = panel.querySelector<HTMLElement>('[data-slider]')
  const thumb = slider?.querySelector<HTMLElement>('[data-thumb]')
  const control = (node: HTMLElement | undefined) => node && { hidden: node.hidden, shown: node.checkVisibility({ visibilityProperty: true }), box: box(node), fade: getComputedStyle(node).backgroundImage, label: node.getAttribute('aria-label') }
  return {
    scrollLeft: bar.scrollLeft, clientWidth: bar.clientWidth, scrollWidth: bar.scrollWidth,
    strip: box(bar)!, tabs: bar.querySelectorAll('[role="tab"]').length, firstTab: bar.querySelector<HTMLElement>('[role="tab"]')!.offsetWidth,
    selected: box(bar.querySelector('[role="tab"][aria-selected="true"]'))!,
    start: control(start), end: control(end),
    slider: slider && { hidden: slider.hidden, shown: slider.checkVisibility({ visibilityProperty: true }), box: box(slider), ariaHidden: slider.getAttribute('aria-hidden') },
    thumb: thumb && box(thumb),
  }
}, preset)

describe('the workspace picker in Chromium', { timeout: 60_000 }, () => {
  it('has presets of different heights to reserve for', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    const natural = await tab.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ws-picker__panel')].map((panel) => panel.querySelector('pre')!.scrollHeight))
    expect(natural).toHaveLength(IDS.length)
    expect(Math.max(...natural) - Math.min(...natural)).toBeGreaterThan(100)
    await context.close()
  })

  for (const width of WIDTHS) {
    it(`reserves the tallest preset's height at ${width} px, so no choice, window, search or roll shifts anything`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      await context.addInitScript(layoutShift)
      const tab = await open(context)
      const first = await measure(tab)
      expect(first.visible).toEqual([IDS[0]])
      for (const preset of [...IDS, ...IDS.toReversed()]) {
        await choose(tab, preset)
        const now = await measure(tab)
        expect(now.visible, preset).toEqual([preset])
        expect(now.stage.height, preset).toBe(first.stage.height)
        expect(now.after, preset).toBe(first.after)
        expect(now.sideways, preset).toBeLessThanOrEqual(0)
      }
      // Through the menu with a real pointer and keyboard: open, search, choose.
      for (const [query, preset] of [['sleep', 'sleep'], ['env', 'environment'], ['focus', 'focus-window-and-panes']] as const) {
        await tab.click('.ws-picker__menu > summary')
        await tab.fill('[data-picker-search]', query)
        await tab.click(`[data-preset-option="${preset}"]`)
        await settle(tab)
        const now = await measure(tab)
        expect(now.visible, preset).toEqual([preset])
        expect(now.after, preset).toBe(first.after)
      }
      // Every window of a preset that has several, one after another.
      await choose(tab, 'start-directory')
      const tabs = tab.locator('.ws-picker__panel[data-preset="start-directory"] [role="tab"]')
      const count = await tabs.count()
      expect(count).toBe(5)
      for (let window = 0; window < count; window++) {
        await tabs.nth(window).click()
        await settle(tab)
        const now = await measure(tab)
        expect(now.window).toEqual(Array.from({ length: count }, (_, index) => index === window))
        expect(now.stage.height, `window ${window}`).toBe(first.stage.height)
        expect(now.after, `window ${window}`).toBe(first.after)
      }
      // A run of rolls, from a generator that returns both ends of its range.
      await tab.evaluate(() => { let step = 0; Math.random = () => [0, 0.9999999, 0.5, 0.25, 0.75][step++ % 5]! })
      for (let roll = 0; roll < 12; roll++) {
        const before = (await measure(tab)).visible
        await tab.click('[data-action="roll"]')
        await settle(tab)
        const now = await measure(tab)
        expect(now.visible, `roll ${roll}`).not.toEqual(before)
        expect(now.stage.height, `roll ${roll}`).toBe(first.stage.height)
        expect(now.after, `roll ${roll}`).toBe(first.after)
      }
      expect(await shifts(tab)).toBe(0)
      await context.close()
    })
  }

  describe('while the page is still being parsed', () => {
    // At 390 px the drawing stands under the configuration, so a stack that grows as each preset
    // arrives pushes it down.
    const loaded = async (body: string) => {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
      await context.addInitScript(layoutShift)
      const served = await serveInPieces(body)
      const tab = await context.newPage()
      await tab.goto(served.url)
      await settle(tab)
      await tab.evaluate(() => new Promise<void>((done) => setTimeout(done, 300)))
      const total = await shifts(tab)
      expect((await measure(tab)).visible).toEqual([IDS[0]])
      await context.close()
      await served.close()
      return total
    }

    it('shifts nothing, because the picker shows once every preset is parsed', async () => {
      expect(page).toContain('ws-picker__end')
      expect(await loaded(page)).toBe(0)
    })

    it('does shift when the picker shows as it is parsed, so the check can fail', async () => {
      const shown = page.replace(/\.ws-picker:not\(:has\(\.ws-picker__end\)\)/g, '.ws-never')
      expect(shown).not.toBe(page)
      expect(await loaded(shown)).toBeGreaterThan(0)
    })
  })

  for (const width of [1440, 1024, 768]) {
    it(`puts the configuration and the drawing side by side at equal height at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const tab = await open(context)
      for (const preset of IDS) {
        await choose(tab, preset)
        const { config, layout, stage } = await measure(tab)
        expect(config!.right, preset).toBeLessThanOrEqual(layout!.left)
        expect(config!.height, preset).toBeCloseTo(layout!.height, 1)
        expect(config!.height, preset).toBeCloseTo(stage.height, 1)
        expect(config!.top, preset).toBeCloseTo(layout!.top, 1)
        // No gutter: the two cards together fill the section.
        expect(config!.left, preset).toBeCloseTo(stage.left, 1)
        expect(layout!.right, preset).toBeCloseTo(stage.right, 1)
      }
      await context.close()
    })
  }

  it('stacks the configuration over the drawing on a phone', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const tab = await open(context)
    const { config, layout, stage } = await measure(tab)
    expect(layout!.top).toBeGreaterThanOrEqual(config!.bottom)
    expect(config!.width).toBeCloseTo(stage.width, 1)
    expect(layout!.width).toBeCloseTo(stage.width, 1)
    await context.close()
  })

  it('keeps a long file inside its panel, where it scrolls', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const tab = await open(context)
    await choose(tab, 'start-directory')
    const pre = await tab.evaluate(() => {
      const code = document.querySelector<HTMLElement>('.ws-picker__panel[data-preset="start-directory"] .ws-config__panel--yaml pre')!
      return { client: code.clientHeight, scroll: code.scrollHeight }
    })
    expect(pre.scroll).toBeGreaterThan(pre.client)
    expect(pre.client).toBeLessThanOrEqual(24 * 16)
    await context.close()
  })

  for (const width of [320, 390, 480, 768, 1024, 1440]) {
    it(`never scrolls the page sideways at ${width} px, whichever preset shows, with the menu shut or open`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 } })
      const tab = await open(context)
      for (const preset of IDS) {
        await choose(tab, preset)
        const { sideways, wide } = await measure(tab)
        expect(wide, `${preset} at ${width} overflows`).toBe('')
        expect(sideways, `${preset} at ${width}`).toBeLessThanOrEqual(0)
      }
      await tab.click('.ws-picker__menu > summary')
      expect((await measure(tab)).sideways, `menu at ${width}`).toBeLessThanOrEqual(0)
      const panel = await tab.evaluate(() => { const rect = document.querySelector('.ws-picker__menu-panel')!.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: innerWidth } })
      expect(panel.left, 'menu panel inside the window').toBeGreaterThanOrEqual(0)
      expect(panel.right, 'menu panel inside the window').toBeLessThanOrEqual(panel.width)
      await context.close()
    })
  }

  for (const width of [320, 390, 480, 768, 1440]) {
    it(`paints nothing of a preset that is not shown, and takes no pointer or focus from it, at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 } })
      const tab = await open(context)
      for (const preset of IDS) {
        await choose(tab, preset)
        const now = await measure(tab)
        expect(now.leaks, preset).toEqual([])
        expect(now.visible, preset).toEqual([preset])
        expect(now.reachable, preset).toEqual([preset])
      }
      // Tabbing never lands in a preset that is hidden.
      await choose(tab, IDS[0]!)
      await tab.focus('[data-action="roll"]')
      for (let step = 0; step < 14; step++) {
        await tab.keyboard.press('Tab')
        const inPanel = await tab.evaluate(() => document.activeElement?.closest('.ws-picker__panel')?.getAttribute('data-preset') ?? null)
        expect([null, IDS[0]], `tab stop ${step}`).toContain(inPanel)
      }
      await context.close()
    })
  }

  it('catches a shown window that paints through a hidden preset, as the first stylesheet let it', async () => {
    const bad = STYLES.replace(/html\[data-js\] \.ws-layout__stack > \.ws-win:not\(\[data-active\]\) \{\s*visibility: hidden;\s*\}/, 'html[data-js] .ws-layout__stack > .ws-win { visibility: hidden; }\nhtml[data-js] .ws-layout__stack > .ws-win[data-active] { visibility: visible; }')
    expect(bad).not.toBe(STYLES)
    const context = await browser.newContext({ viewport: { width: 480, height: 800 } })
    const tab = await open(context, '?preset=start-directory', await html(bad))
    const { leaks } = await measure(tab)
    expect(leaks.length).toBeGreaterThan(0)
    expect(leaks.some((leak) => leak.startsWith('shorthand:'))).toBe(true)
    await context.close()
  })

  for (const width of [320, 390, 480, 768, 1024, 1440]) {
    it(`draws the window tabs above the drawing, never over it, with one caption, at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 } })
      const tab = await open(context)
      for (const preset of IDS) {
        await choose(tab, preset)
        const geometry = await tab.evaluate((id) => {
          const panel = document.querySelector(`.ws-picker__panel[data-preset="${id}"]`)!
          const bar = panel.querySelector<HTMLElement>('.ws-layout__tabs')!
          const strip = bar.getBoundingClientRect()
          const stack = panel.querySelector('.ws-layout__stack')!.getBoundingClientRect()
          const figure = [...panel.querySelectorAll<HTMLElement>('.ws-win')].find((node) => getComputedStyle(node).visibility === 'visible')!
          const svg = figure.querySelector('svg')!.getBoundingClientRect()
          const caption = figure.querySelector('figcaption')!.getBoundingClientRect()
          const style = getComputedStyle(bar)
          return {
            strip: { bottom: strip.bottom, height: strip.height },
            stack: { top: stack.top, left: stack.left, right: stack.right },
            svg: { top: svg.top, bottom: svg.bottom, left: svg.left, right: svg.right, width: svg.width },
            caption: { top: caption.top },
            wrap: style.flexWrap, overflowX: style.overflowX,
          }
        }, preset)
        const label = `${preset} at ${width}`
        // Above, never over: the strip ends where the stack begins, and the drawing sits inside the stack, below the strip.
        expect(geometry.strip.bottom, label).toBeLessThanOrEqual(geometry.stack.top + 1)
        expect(geometry.svg.top, label).toBeGreaterThanOrEqual(geometry.strip.bottom)
        expect(geometry.caption.top, label).toBeGreaterThanOrEqual(geometry.svg.bottom - 0.5)
        // The drawing scales to the card: inside its edges and centred.
        expect(geometry.svg.left, label).toBeGreaterThanOrEqual(geometry.stack.left)
        expect(geometry.svg.right, label).toBeLessThanOrEqual(geometry.stack.right)
        const slack = geometry.stack.right - geometry.stack.left - geometry.svg.width
        expect(Math.abs(geometry.svg.left - geometry.stack.left - slack / 2), label).toBeLessThanOrEqual(1.5)
        // The strip is one line that scrolls when it must, and keeps one height.
        expect(geometry.wrap, label).toBe('nowrap')
        expect(geometry.overflowX, label).toBe('auto')
        expect(geometry.strip.height, label).toBeLessThanOrEqual(36)
        // One caption on screen for the one window shown.
        expect((await measure(tab)).captions, label).toHaveLength(1)
      }
      await context.close()
    })
  }

  it('scrolls the window tabs of a preset with many inside their strip on a phone, and brings the one chosen into view', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const tab = await open(context, '?preset=start-directory')
    const strip = await tab.evaluate(() => {
      const node = document.querySelector<HTMLElement>('.ws-picker__panel[data-preset="start-directory"] .ws-layout__tabs')!
      return { client: node.clientWidth, scroll: node.scrollWidth, tops: new Set([...node.querySelectorAll('button')].map((button) => Math.round(button.getBoundingClientRect().top))).size }
    })
    expect(strip.scroll).toBeGreaterThan(strip.client)
    expect(strip.tops).toBe(1)
    await tab.focus('.ws-picker__panel[data-preset="start-directory"] [role="tab"][aria-selected="true"]')
    for (let step = 0; step < 4; step++) await tab.keyboard.press('ArrowRight')
    const last = await tab.evaluate(() => {
      const node = document.querySelector<HTMLElement>('.ws-picker__panel[data-preset="start-directory"] .ws-layout__tabs')!
      const tabRect = document.activeElement!.getBoundingClientRect()
      const stripRect = node.getBoundingClientRect()
      return { inside: tabRect.left >= stripRect.left - 1 && tabRect.right <= stripRect.right + 1, selected: document.activeElement!.getAttribute('aria-selected') }
    })
    expect(last).toEqual({ inside: true, selected: 'true' })
    await context.close()
  })

  for (const width of [320, 390, 480, 768, 1024, 1440]) {
    it(`shows the scroll buttons and the slider only on a strip that overflows, with the right ones at each end, at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: 'reduce' })
      const tab = await open(context)
      let overflowed = 0
      for (const preset of IDS) {
        await choose(tab, preset)
        const now = await strip(tab, preset)
        const overflow = now.scrollWidth - now.clientWidth > 1
        const label = `${preset} at ${width}`
        if (now.tabs === 1) {
          // One window cannot overflow, so it carries no controls at all.
          expect(now.start, label).toBeFalsy()
          expect(now.slider, label).toBeFalsy()
          continue
        }
        if (!overflow) {
          expect([now.start!.shown, now.end!.shown, now.slider!.shown], label).toEqual([false, false, false])
          continue
        }
        overflowed += 1
        // At the start: the end button, the slider and a fade at the right; no start button.
        expect(now.start!.shown, label).toBe(false)
        expect(now.end!.shown, label).toBe(true)
        expect(now.slider!.shown, label).toBe(true)
        expect(now.end!.fade, label).toContain('linear-gradient')
        expect(now.end!.label, label).toBe('Scroll windows right')
        // Over the strip's own edge, never beyond it, and not over the drawing.
        expect(now.end!.box!.right, label).toBeLessThanOrEqual(now.strip.right + 0.5)
        expect(now.end!.box!.left, label).toBeGreaterThanOrEqual(now.strip.left)
        expect(now.end!.box!.bottom, label).toBeLessThanOrEqual(now.strip.bottom)
        expect(now.slider!.ariaHidden, label).toBe('true')
        expect((await measure(tab)).sideways, label).toBeLessThanOrEqual(0)
      }
      // A narrow card overflows for some preset at every width; a wide one may need the longest names.
      if (width <= 768) expect(overflowed, `some preset overflows at ${width}`).toBeGreaterThan(0)
      await context.close()
    })
  }

  it('shows no controls on a strip whose tabs fit', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 } })
    const tab = await open(context, '?preset=window-index')
    const now = await strip(tab, 'window-index')
    expect(now.tabs).toBe(3)
    expect(now.scrollWidth - now.clientWidth).toBeLessThanOrEqual(1)
    expect([now.start!.shown, now.end!.shown, now.slider!.shown]).toEqual([false, false, false])
    await context.close()
  })

  for (const width of [390, 768, 1440]) {
    it(`scrolls about one tab with a click and keeps the slider in step, at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      await context.addInitScript(layoutShift)
      const tab = await open(context, '?preset=start-directory')
      const panel = '.ws-picker__panel[data-preset="start-directory"]'
      const track = (now: Awaited<ReturnType<typeof strip>>) => {
        const max = now.scrollWidth - now.clientWidth
        const thumbWidth = Math.min(now.slider!.box!.width, Math.max(24, now.slider!.box!.width * now.clientWidth / now.scrollWidth))
        return { thumbWidth, left: (now.slider!.box!.width - thumbWidth) * (now.scrollLeft / max) }
      }
      let now = await strip(tab, 'start-directory')
      expect(now.scrollWidth - now.clientWidth).toBeGreaterThan(1)
      const before = (await measure(tab)).after
      // Forward, one click at a time, to the end.
      for (let click = 0; click < 12 && !now.end!.hidden; click++) {
        const was = now.scrollLeft
        await tab.click(`${panel} .ws-layout__scroll--end`)
        await settle(tab)
        now = await strip(tab, 'start-directory')
        const moved = now.scrollLeft - was
        const max = now.scrollWidth - now.clientWidth
        expect(moved, `click ${click}`).toBeGreaterThan(0)
        // About a tab: the first tab's width, or what is left of the strip.
        if (now.scrollLeft < max - 1) expect(moved, `click ${click}`).toBeCloseTo(Math.max(80, now.firstTab), -1)
        expect(now.start!.shown, `click ${click}`).toBe(true)
        const expected = track(now)
        expect(now.thumb!.width, `click ${click}`).toBeCloseTo(expected.thumbWidth, 0)
        expect(now.thumb!.left - now.slider!.box!.left, `click ${click}`).toBeCloseTo(expected.left, 0)
      }
      // At the end the end button is gone, the start button stays, and the thumb is at the right edge.
      expect(now.end!.shown).toBe(false)
      expect(now.start!.shown).toBe(true)
      expect(now.thumb!.right).toBeCloseTo(now.slider!.box!.right, 0)
      // And back.
      for (let click = 0; click < 12 && !now.start!.hidden; click++) {
        await tab.click(`${panel} .ws-layout__scroll--start`)
        await settle(tab)
        now = await strip(tab, 'start-directory')
      }
      expect(now.scrollLeft).toBe(0)
      expect(now.start!.shown).toBe(false)
      expect(now.thumb!.left).toBeCloseTo(now.slider!.box!.left, 0)
      expect((await measure(tab)).after).toBe(before)
      expect((await measure(tab)).sideways).toBeLessThanOrEqual(0)
      expect(await shifts(tab)).toBe(0)
      await context.close()
    })
  }

  it('drags the thumb to scroll the strip, and pages when the track beside it is pressed', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const tab = await open(context, '?preset=start-directory')
    await tab.locator('.ws-picker__panel[data-preset="start-directory"] .ws-layout').scrollIntoViewIfNeeded()
    let now = await strip(tab, 'start-directory')
    const grab = { x: now.thumb!.left + now.thumb!.width / 2, y: now.thumb!.top + now.thumb!.height / 2 }
    await tab.mouse.move(grab.x, grab.y)
    await tab.mouse.down()
    await tab.mouse.move(grab.x + 30, grab.y, { steps: 5 })
    now = await strip(tab, 'start-directory')
    const room = now.slider!.box!.width - now.thumb!.width
    // Thirty pixels of thumb travel stand for 30 / room of the whole scroll.
    expect(now.scrollLeft).toBeCloseTo((30 / room) * (now.scrollWidth - now.clientWidth), -1)
    await tab.mouse.move(grab.x + 4000, grab.y, { steps: 3 })
    now = await strip(tab, 'start-directory')
    expect(now.scrollLeft).toBeCloseTo(now.scrollWidth - now.clientWidth, 0)
    await tab.mouse.up()
    const at = now.scrollLeft
    await tab.mouse.move(grab.x - 50, grab.y)
    expect((await strip(tab, 'start-directory')).scrollLeft).toBe(at)
    // A press on the track left of the thumb pages back, by a little less than the strip's width.
    await tab.mouse.click(now.slider!.box!.left + 3, now.slider!.box!.top + now.slider!.box!.height / 2)
    now = await strip(tab, 'start-directory')
    expect(now.scrollLeft).toBeCloseTo(Math.max(0, at - now.clientWidth * 0.8), -1)
    expect((await measure(tab)).sideways).toBeLessThanOrEqual(0)
    await context.close()
  })

  for (const width of [320, 390, 480, 768, 1440]) {
    it(`keeps the selected window's tab in view, clear of the buttons, as the arrow keys move along the tabs, at ${width} px`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
      const tab = await open(context, '?preset=start-directory')
      await tab.focus('.ws-picker__panel[data-preset="start-directory"] [role="tab"][aria-selected="true"]')
      const inView = async (label: string) => {
        const now = await strip(tab, 'start-directory')
        expect(now.selected.left, label).toBeGreaterThanOrEqual(now.strip.left - 1)
        expect(now.selected.right, label).toBeLessThanOrEqual(now.strip.right + 1)
        for (const button of [now.start, now.end]) {
          if (button?.shown) expect(now.selected.left >= button.box!.right - 1 || now.selected.right <= button.box!.left + 1, `${label} clear of a button`).toBe(true)
        }
        expect(await tab.evaluate(() => document.activeElement?.getAttribute('aria-selected'))).toBe('true')
      }
      await inView('first')
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'End', 'Home']) {
        await tab.keyboard.press(key)
        await settle(tab)
        await inView(key)
      }
      // A click on a tab that sits partly under the fade brings it fully into view too.
      await tab.keyboard.press('End')
      const now = await strip(tab, 'start-directory')
      const target = await tab.evaluate((limit) => {
        const bar = document.querySelector('.ws-picker__panel[data-preset="start-directory"] .ws-layout__tabs')!
        const edge = bar.getBoundingClientRect()
        const cut = [...bar.querySelectorAll<HTMLElement>('[role="tab"]')].findIndex((node) => { const r = node.getBoundingClientRect(); return r.left < edge.left + limit && r.right > edge.left })
        return cut
      }, 40)
      if (target >= 0 && now.scrollLeft > 1) {
        await tab.locator('.ws-picker__panel[data-preset="start-directory"] [role="tab"]').nth(target).click({ force: true })
        await settle(tab)
        await inView('partly hidden tab')
      }
      expect((await measure(tab)).sideways).toBeLessThanOrEqual(0)
      await context.close()
    })
  }

  it('keeps the buttons focusable and labelled, and hands focus to the tab when the one that has it goes', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
    const tab = await open(context, '?preset=start-directory')
    const end = '.ws-picker__panel[data-preset="start-directory"] .ws-layout__scroll--end'
    await tab.focus(end)
    expect(await tab.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Scroll windows right')
    for (let press = 0; press < 12 && !(await strip(tab, 'start-directory')).end!.hidden; press++) {
      await tab.keyboard.press('Enter')
      await settle(tab)
    }
    const now = await strip(tab, 'start-directory')
    expect(now.end!.hidden).toBe(true)
    expect(await tab.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('tab')
    expect(await tab.evaluate(() => document.activeElement?.getAttribute('aria-selected'))).toBe('true')
    // The start button is next to be shown, and it is labelled as well.
    expect(now.start!.label).toBe('Scroll windows left')
    await context.close()
  })

  it('fades the strip with the colour of the card in both colour schemes', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } })
    const tab = await open(context, '?preset=start-directory')
    const surface = (scheme: 'light' | 'dark') => tab.evaluate((mode) => {
      document.documentElement.dataset.themeMode = mode === 'dark' ? 'dark' : ''
      const probe = document.createElement('i')
      probe.style.background = 'var(--color-surface)'
      document.body.append(probe)
      const colour = getComputedStyle(probe).backgroundColor
      probe.remove()
      return { colour, fade: getComputedStyle(document.querySelector('.ws-picker__panel[data-preset="start-directory"] .ws-layout__scroll--end')!).backgroundImage }
    }, scheme)
    const light = await surface('light')
    const dark = await surface('dark')
    expect(light.fade).toContain(light.colour)
    expect(dark.fade).toContain(dark.colour)
    expect(light.colour).not.toBe(dark.colour)
    await context.close()
  })

  it('shows the current preset on the menu, with the roll button beside it, as the front page does', async () => {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      const tab = await open(context)
      const first = await measure(tab)
      expect(first.label).toEqual([PRESETS[0]!.title])
      expect(first.roll!.left).toBeGreaterThanOrEqual(first.menu!.right)
      expect(Math.abs(first.roll!.top + first.roll!.height / 2 - (first.menu!.top + first.menu!.height / 2))).toBeLessThanOrEqual(1)
      await choose(tab, 'environment')
      expect((await measure(tab)).label).toEqual(['Environment'])
      expect(await tab.locator('.ws-picker__menu > summary').getAttribute('aria-label')).toBe('Preset: Environment')
      await context.close()
    }
  })

  it('opens a searchable menu of every preset, each row a tile, a name and one line', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const tab = await open(context)
    await tab.click('.ws-picker__menu > summary')
    // The menu is a popover that opens on the details' toggle event, a task after the click.
    await tab.locator('.ws-picker__menu-panel').waitFor({ state: 'visible' })
    expect(await tab.locator('.doc-picker-title').textContent()).toContain('Choose a preset')
    expect(await tab.locator('[data-picker-search]').isVisible()).toBe(true)
    const rows = await tab.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-preset-option]')].map((row) => {
      const tile = row.querySelector('.ws-tile')!.getBoundingClientRect()
      const summary = row.querySelector('small')!
      return { id: row.dataset.presetOption, tile: [Math.round(tile.width), Math.round(tile.height)], oneLine: summary.scrollHeight <= summary.clientHeight + 2, ellipsis: getComputedStyle(summary).textOverflow, checked: !row.querySelector<HTMLElement>('.doc-picker-check')!.hidden }
    }))
    expect(rows.map((row) => row.id)).toEqual(IDS)
    for (const row of rows) {
      expect(row.tile, row.id).toEqual([32, 24])
      expect(row.oneLine, row.id).toBe(true)
      expect(row.ellipsis, row.id).toBe('ellipsis')
    }
    expect(rows.filter((row) => row.checked).map((row) => row.id)).toEqual([IDS[0]])
    await context.close()
  })

  it('filters the menu by name, summary and key, says when nothing matches, and closes with Escape', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const tab = await open(context)
    const shownRows = () => tab.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-preset-option]')].filter((row) => !row.hidden).map((row) => row.dataset.presetOption))
    await tab.click('.ws-picker__menu > summary')
    await tab.fill('[data-picker-search]', 'env')
    expect(await shownRows()).toEqual(expect.arrayContaining(['environment', 'env-variables']))
    expect((await shownRows()).length).toBeLessThan(IDS.length)
    await tab.fill('[data-picker-search]', 'synchronize')
    expect(await shownRows()).toContain('2-pane-synchronized')
    await tab.fill('[data-picker-search]', 'window_index')
    expect(await shownRows()).toContain('window-index')
    await tab.fill('[data-picker-search]', 'no preset says this')
    expect(await shownRows()).toEqual([])
    expect(await tab.locator('[data-picker-empty]').isVisible()).toBe(true)
    await tab.fill('[data-picker-search]', '')
    expect(await shownRows()).toEqual(IDS)
    await tab.keyboard.press('Escape')
    expect(await tab.locator('.ws-picker__menu-panel').isVisible()).toBe(false)
    expect(await tab.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY')
    await context.close()
  })

  it('chooses from the menu by keyboard: search, arrow down, enter', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    await tab.focus('.ws-picker__menu > summary')
    await tab.keyboard.press('Enter')
    // The menu opens on the details' toggle event and moves focus to its search field a task later.
    await tab.waitForFunction(() => document.activeElement?.matches('[data-picker-search]'))
    await tab.keyboard.type('sleep')
    await tab.keyboard.press('ArrowDown')
    await tab.keyboard.press('Enter')
    await settle(tab)
    const now = await measure(tab)
    expect(now.visible).toEqual(['sleep'])
    expect(now.label).toEqual(['Pause around a command'])
    expect(await tab.locator('.ws-picker__menu-panel').isVisible()).toBe(false)
    expect(await tab.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY')
    expect(tab.url()).toBe(`${ADDRESS}?preset=sleep`)
    await tab.click('.ws-picker__menu > summary')
    await tab.locator('.ws-picker__menu-panel').waitFor({ state: 'visible' })
    expect(await tab.locator('[data-preset-option="sleep"]').getAttribute('aria-current')).toBe('true')
    expect(await tab.locator('[data-preset-option="sleep"] .doc-picker-check').isVisible()).toBe(true)
    expect(await tab.locator('[data-picker-announce]').textContent()).toBe('Preset: Pause around a command')
    await context.close()
  })

  it('rolls to a different preset every time, with the front page\'s own button', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    expect(await tab.locator('[data-action="roll"]').evaluate((button) => button.classList.contains('lm-reroll') && button.textContent!.includes('🎲'))).toBe(true)
    await tab.evaluate(() => { let step = 0; Math.random = () => [0, 0.9999999, 0.5, 1, 0.1][step++ % 5]! })
    const seen = new Set<string>()
    for (let roll = 0; roll < 60; roll++) {
      const before = (await measure(tab)).selected
      await tab.click('[data-action="roll"]')
      const now = await measure(tab)
      expect(now.selected, `roll ${roll}`).not.toBe(before)
      expect(now.visible, `roll ${roll}`).toEqual([now.selected])
      expect(now.label, `roll ${roll}`).toEqual([PRESETS.find((preset) => preset.id === now.selected)!.title])
      seen.add(now.selected!)
    }
    expect(seen.size).toBeGreaterThan(3)
    await context.close()
  })

  it('remembers the choice per port, writes it to the address and opens on it again', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    await choose(tab, 'environment')
    expect(tab.url()).toBe(`${ADDRESS}?preset=environment`)
    expect(await tab.evaluate(() => localStorage.getItem('libtmux-workspace-preset:rs'))).toBe('environment')
    expect(await tab.evaluate(() => localStorage.getItem('libtmux-workspace-preset:go'))).toBeNull()
    const again = await context.newPage()
    await again.goto(ADDRESS)
    expect((await measure(again)).visible).toEqual(['environment'])
    expect(await again.locator('[data-preset-option][aria-current="true"]').getAttribute('data-preset-option')).toBe('environment')
    await context.close()
  })

  it('shows the remembered or named preset before the picker\'s own script runs, so nothing flashes', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    await choose(tab, 'environment')
    const visit = async (path: string, scheme: 'light' | 'dark' = 'light') => {
      const next = await context.newPage()
      await next.emulateMedia({ colorScheme: scheme })
      await next.goto(`${ADDRESS}${path}`)
      return early(next)
    }
    // Remembered: a fresh load already shows the stored choice, with the element not yet upgraded.
    expect(await visit('')).toEqual({ selected: 'environment', shown: ['environment'], label: ['Environment'], upgraded: false })
    // Named in the address, over the remembered one, in either colour scheme.
    for (const scheme of ['light', 'dark'] as const) {
      expect(await visit('?preset=start-directory', scheme), scheme).toEqual({ selected: 'start-directory', shown: ['start-directory'], label: ['Start directory'], upgraded: false })
    }
    // A name the port does not offer falls back to what is remembered, and with nothing remembered to the first.
    expect((await visit('?preset=nonsense')).selected).toBe('environment')
    const fresh = await browser.newContext()
    expect(await early(await open(fresh, '?preset=nonsense'))).toEqual({ selected: IDS[0], shown: [IDS[0]], label: [PRESETS[0]!.title], upgraded: false })
    await fresh.close()
    await context.close()
  })

  it('opens on the preset the address names in both colour schemes, with all of its windows', async () => {
    const context = await browser.newContext()
    const tab = await open(context)
    await choose(tab, 'environment')
    for (const scheme of ['light', 'dark'] as const) {
      const linked = await context.newPage()
      await linked.emulateMedia({ colorScheme: scheme })
      await linked.goto(`${ADDRESS}?preset=start-directory`)
      await linked.evaluate((mode) => { document.documentElement.dataset.themeMode = mode }, scheme)
      const now = await measure(linked)
      expect(now.visible, scheme).toEqual(['start-directory'])
      expect(now.label, scheme).toEqual(['Start directory'])
      expect(await linked.locator('.ws-picker__panel[data-preset="start-directory"] [role="tab"]').count(), scheme).toBe(5)
    }
    await context.close()
  })

  it('shows the first preset when storage is unavailable, and still swaps', async () => {
    const context = await browser.newContext()
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } })
    })
    const errors: string[] = []
    const tab = await open(context)
    tab.on('pageerror', (error) => errors.push(error.message))
    await tab.reload()
    expect((await measure(tab)).visible).toEqual([IDS[0]])
    await choose(tab, 'environment')
    expect((await measure(tab)).visible).toEqual(['environment'])
    await tab.click('[data-action="roll"]')
    expect((await measure(tab)).visible).not.toEqual(['environment'])
    expect(errors).toEqual([])
    await context.close()
  })

  it('without script shows the first preset alone and every example in full below it', async () => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const tab = await open(context)
    const panels = tab.locator('.ws-picker__panel')
    expect(await panels.count()).toBe(IDS.length)
    expect(await panels.first().isVisible()).toBe(true)
    for (const index of IDS.keys()) if (index > 0) expect(await panels.nth(index).isVisible(), IDS[index]).toBe(false)
    expect(await tab.locator('.ws-picker__bar').isVisible()).toBe(false)
    expect(await tab.locator('.ws-picker__panel').first().locator('.ws-win').first().isVisible()).toBe(true)
    const articles = tab.locator('.ws-example')
    expect(await articles.count()).toBe(IDS.length)
    for (const [index, preset] of PRESETS.entries()) {
      expect(await articles.nth(index).locator('.ws-config__panel--yaml').isVisible(), preset.id).toBe(true)
      // Every window is drawn, not only the first.
      const drawings = articles.nth(index).locator('svg.gp-tmux-layout')
      expect(await drawings.count(), preset.id).toBe(preset.windows.length)
      for (let window = 0; window < preset.windows.length; window++) expect(await drawings.nth(window).isVisible(), `${preset.id} ${window}`).toBe(true)
    }
    await context.close()
  })
})
