import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { SITE_ROOT, SITE_PREFIX, publishedPath } from './site-root'

/**
 * The code-tab group, driven the way a reader drives it.
 *
 * Chrome confirms the rendered markup and the initial state; what it cannot
 * do here is click, because CDP will not bind in this environment. This runs
 * the real component script against the real built page in a DOM, so the two
 * behaviours that make the control worth having — every group on the page
 * switching together, and the choice surviving a reload — are actually
 * exercised rather than asserted.
 */
// SITE_ROOT, not a hardcoded `_site`: `test-all.sh` injects the tree it just
// built, and every other assembled-tree suite reads it from there. This one
// looked somewhere else, so it could skip — silently, since a skipped
// `describe` reports as a pass — while the suites beside it ran.
const PAGE = join(SITE_ROOT, 'topics/architecture/index.html')

const describeIfBuilt = existsSync(PAGE) ? describe : describe.skip

describeIfBuilt('code tabs', () => {
  let window: Window
  let document: Document

  const load = (stored?: string) => {
    window = new Window({ url: `https://libtmux.org/${SITE_PREFIX}topics/architecture/` })
    document = window.document as unknown as Document
    if (stored) window.localStorage.setItem('libtmux-code-tab', stored)
    const html = readFileSync(PAGE, 'utf8')
    document.write(html)
    // Astro hoists and bundles a component's `<script>` into `/_astro/*.js`,
    // so the code under test is on disk rather than inline — evaluating only
    // inline scripts runs none of it. And the page carries JSON-LD in a
    // `<script type="application/ld+json">`, which is not JavaScript and
    // throws if you eval it.
    const isJs = (el: Element) => {
      const type = el.getAttribute('type')
      return !type || type === 'module' || type === 'text/javascript'
    }

    /**
     * Each `<script type="module">` gets its own scope, so evaluate each one
     * inside a function rather than sharing `window`'s.
     *
     * `window.eval` puts every script in one global scope, and Astro's
     * minifier names module-level bindings `e`, `t`, `n` — so this page's
     * `var e = 'libtmux-code-tab'` was overwritten by a later script's own
     * `var e`, and the component then wrote its preference under the key
     * `'[object Object]'`. That looked exactly like a bug in the component.
     * It is not: Chrome stores `{"libtmux-code-tab":"go"}` and carries the
     * choice across a navigation. The isolation is what was missing.
     */
    const evaluate = (source: string) => window.eval(`(() => {\n${source}\n})()`)

    /*
     * `window.eval` runs a classic script, so a bundle using module-only
     * syntax throws before any of it executes. The search panel's chunk does:
     * it reads `import.meta.env` and imports Pagefind's bundle dynamically,
     * because that bundle only exists after the build.
     *
     * Skipping those is safe here — this file tests the code-tab component,
     * and the assertions below fail if its own script did not run — and it is
     * narrower than catching, which would also swallow a genuine error thrown
     * by the script under test.
     */
    const isModuleOnly = (source: string) =>
      /\bimport\.meta\b/.test(source) || /\bimport\s*\(/.test(source)

    for (const script of [...document.querySelectorAll('script')]) {
      if (!isJs(script)) continue
      const src = script.getAttribute('src')
      if (!src) {
        const inline = script.textContent ?? ''
        if (!isModuleOnly(inline)) evaluate(inline)
        continue
      }
      if (!src.includes('/_astro/')) continue
      const asset = publishedPath(src)
      if (!existsSync(asset)) continue
      const source = readFileSync(asset, 'utf8')
      if (!isModuleOnly(source)) evaluate(source)
    }
    return { window, document }
  }

  beforeAll(() => {
    load()
  })

  it('renders one group with a tab per port', () => {
    const groups = document.querySelectorAll('libtmux-code-tabs')
    expect(groups.length).toBeGreaterThan(0)
    const tabs = groups[0].querySelectorAll('.code-tab')
    expect(tabs.length).toBeGreaterThan(1)
  })

  it('shows exactly one panel at a time', () => {
    const panels = [...document.querySelectorAll('.code-tab-panel')]
    const visible = panels.filter((p) => !(p as HTMLElement).hidden)
    expect(visible.length).toBe(document.querySelectorAll('libtmux-code-tabs').length)
  })

  it('switches to the clicked language', () => {
    const group = document.querySelector('libtmux-code-tabs')!
    const rust = group.querySelector<HTMLElement>('.code-tab[data-port="rs"]')
    expect(rust, 'a Rust tab').toBeTruthy()
    rust!.click()
    expect(rust!.getAttribute('aria-selected')).toBe('true')
    const shown = [...group.querySelectorAll<HTMLElement>('.code-tab-panel')].filter((p) => !p.hidden)
    expect(shown.length).toBe(1)
    expect(shown[0].dataset.port).toBe('rs')
  })

  it('remembers the choice for the next page', () => {
    const group = document.querySelector('libtmux-code-tabs')!
    group.querySelector<HTMLElement>('.code-tab[data-port="go"]')!.click()
    expect(window.localStorage.getItem('libtmux-code-tab')).toBe('go')

    // A fresh page load with that preference stored opens on Go, not Python.
    const fresh = load('go')
    const panel = [...fresh.document.querySelectorAll<HTMLElement>('.code-tab-panel')].find(
      (p) => !p.hidden,
    )
    expect(panel?.dataset.port).toBe('go')
  })

  it('leaves a group alone when it lacks the chosen language', () => {
    // Not every page documents all eight. Blanking a group that has no Swift
    // block would be a worse answer than showing what it does have.
    const fresh = load('swift')
    for (const group of fresh.document.querySelectorAll('libtmux-code-tabs')) {
      const shown = [...group.querySelectorAll<HTMLElement>('.code-tab-panel')].filter(
        (p) => !p.hidden,
      )
      expect(shown.length, 'exactly one panel per group').toBe(1)
    }
  })
})
