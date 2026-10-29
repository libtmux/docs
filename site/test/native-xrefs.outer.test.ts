import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { markNativeXrefs } from '../src/lib/native-xrefs'

/**
 * A marked native cross-reference in a real browser, with the site's own stylesheets and no server. The badge sits
 * before the name on the name's line, the dotted underline runs under the name and never under the badge, and the
 * paragraph around it keeps flowing.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = ['../src/styles/api-kinds.css', '../src/styles/kind-marks.css', '../src/styles/api-tree.css', '../src/styles/native-sphinx.css'].map(read).join('\n')
// The rule that draws the dotted underline under a marked cross-reference's name, found by what it selects.
const underlineRule = /html\[data-native-shell\] a\.api-mention:has\(> \.api-link-kind\) > \.api-symbol-link__name \{[^}]*\}\n/

const xref = '<a class="reference internal" href="../api/libtmux.server/#libtmux.Server" title="libtmux.server.Server"><code class="xref py py-class docutils literal notranslate"><span class="pre">Server</span></code></a>'
const marked = (() => {
  const window = new Window()
  window.document.body.innerHTML = `<article role="main"><p>Open a ${xref} and read its sessions, which keep running after the program that started them has gone away.</p></article>`
  const article = window.document.querySelector('article')! as unknown as Element
  markNativeXrefs(article, { 'libtmux.Server': 'class' })
  return article.innerHTML
})()

const page = (css: string) => `<!doctype html><html data-native-shell><head><style>:root { --text-color: #1a1c1e; --background-color: #ffffff; --color-link: #1e415e; }
body { margin: 0; font: 16px/1.5 sans-serif; width: 28rem; color: var(--text-color); }
a { color: var(--color-link); text-decoration: underline; }
code { font-family: monospace; }\n${css}</style></head><body><article role="main">${marked}</article></body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

async function measure(css: string) {
  const target = await browser.newPage({ viewport: { width: 600, height: 400 } })
  await target.setContent(page(css))
  const result = await target.evaluate(() => {
    const link = document.querySelector('a.api-mention')!
    const badge = link.querySelector('.api-link-kind')!
    const name = link.querySelector('.api-symbol-link__name')!
    const rect = (node: Element) => node.getBoundingClientRect()
    const line = (node: Element) => getComputedStyle(node)
    const centre = (node: Element) => rect(node).top + rect(node).height / 2
    return {
      display: line(link).display,
      badgeBeforeName: rect(badge).right <= rect(name).left + 0.5,
      centreGap: Math.abs(centre(badge) - centre(name)),
      linkLine: line(link).textDecorationLine,
      badgeLine: line(badge).textDecorationLine,
      nameLine: line(name).textDecorationLine,
      nameStyle: line(name).textDecorationStyle,
      paragraph: rect(document.querySelector('p')!).height,
      lineHeight: parseFloat(line(document.querySelector('p')!).lineHeight),
    }
  })
  await target.close()
  return result
}

describe('a marked native cross-reference', () => {
  it('leads the name on its line and draws the dotted underline under the name alone', async () => {
    const measured = await measure(styles)
    expect(measured.display).toBe('inline-flex')
    expect(measured.badgeBeforeName).toBe(true)
    expect(measured.centreGap).toBeLessThan(4)
    expect(measured.linkLine).toBe('none')
    expect(measured.badgeLine).toBe('none')
    expect(measured.nameLine).toContain('underline')
    expect(measured.nameStyle).toBe('dotted')
    // Two lines of text: the badge does not add a third.
    expect(measured.paragraph).toBeLessThanOrEqual(measured.lineHeight * 3)
  })

  it('underlines in the shared solid style without the native rule, so the check above can fail', async () => {
    expect(styles).toMatch(underlineRule)
    const measured = await measure(styles.replace(underlineRule, ''))
    expect(measured.nameStyle).not.toBe('dotted')
  })
})
