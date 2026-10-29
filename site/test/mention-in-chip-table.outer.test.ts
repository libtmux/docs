import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * A mention in a note beside a split chip, where a doc comment names another declaration, keeps the box and layout a
 * mention has in a paragraph. The chip rules style the mark of an equivalent's link as the cap of an outlined chip, and a
 * mention's badge is not a chip's cap: it leads a name in running text, so the rules leave it alone. Both containers that
 * hold such notes are measured: the usage table and an other-port entry. A table draws every mark without a hue, wherever
 * the mark is, so the fill is not compared. Measured in a real browser with the site's own stylesheets and no server.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = ['../src/styles/api-kinds.css', '../src/styles/kind-marks.css', '../src/styles/api-tree.css'].map(read).join('\n')

const badge = '<span class="api-link-kind api-nav__kind api-badge--kind-struct" data-api-kind="struct" aria-hidden="true"><span class="api-badge__label" data-mark="cap">S</span></span>'
const mention = `<a class="api-xref api-mention" id="note" href="/server/">${badge}<span class="api-symbol-link__name"><code class="api-literal api-literal--link">Server</code></span></a>`
const equivalent = '<a id="equivalent" href="/x/"><span aria-hidden="true" class="api-nav__kind api-badge--kind-struct"><span class="api-badge__label" data-mark="cap">S</span></span> <code>libtmux.Server</code></a>'
const CONTAINERS = {
  // The note of an equivalent in the "In other ports" table.
  '.tmux-usage': `<div class="tmux-usage"><table><tbody><tr><th scope="row">Julia</th><td>
    <span class="tmux-usage__links"><span class="tmux-usage__item">${equivalent}
    <span class="tmux-usage__when tmux-usage__note">Takes the ${mention} it opens.</span></span></span></td></tr></tbody></table></div>`,
  // The note of an entry in a symbol's "In other ports" disclosure.
  '.api-elsewhere-value': `<div class="api-elsewhere-value">${equivalent}<p class="api-elsewhere-note">Takes the ${mention} it opens.</p></div>`,
}
const page = (css: string, container: string) => `<!doctype html><html><head><style>:root { --text-color: #1a1c1e; --background-color: #ffffff; --color-foreground-primary: #1a1c1e; }
body { margin: 0; font: 13px/1.5 sans-serif; width: 40rem; }
code { font-family: monospace; font-size: .8125em; }\n${css}</style></head><body>
<p id="prose">Read ${mention.replace(' id="note"', '')} first.</p>${container}</body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

const PROPERTIES = ['display', 'borderTopWidth', 'borderInlineEndWidth', 'minHeight', 'overflow', 'alignItems', 'paddingLeft', 'verticalAlign']

/** The computed boxes of the mention's link and badge in a paragraph and in a note, and of the equivalent's chip. */
async function looks(css: string, container: string) {
  const target = await browser.newPage({ viewport: { width: 700, height: 400 } })
  await target.setContent(page(css, container))
  const result = await target.evaluate((properties) => {
    const of = (selector: string) => {
      const link = document.querySelector(selector)!
      const mark = link.querySelector(':scope > .api-nav__kind')!
      const pick = (element: Element) => Object.fromEntries(properties.map((name) => [name, getComputedStyle(element)[name as never] as string]))
      return { link: pick(link), mark: { ...pick(mark), width: getComputedStyle(mark).width, height: getComputedStyle(mark).height } }
    }
    return { prose: of('#prose a'), note: of('#note'), equivalent: of('#equivalent') }
  }, PROPERTIES)
  await target.close()
  return result
}

describe.each(Object.entries(CONTAINERS))('a mention in a note of %s', (_name, container) => {
  it('keeps the box it has in a paragraph, and the equivalent beside it stays a chip', async () => {
    const measured = await looks(styles, container)
    expect(measured.note).toEqual(measured.prose)
    expect(measured.equivalent.link.borderTopWidth).toBe('1px')
    expect(measured.equivalent.link.overflow).toBe('hidden')
    expect(measured.note.link.borderTopWidth).toBe('0px')
  })

  it('becomes a chip without the rule that leaves it alone, so the check above can fail', async () => {
    expect(styles).toContain(':where(:not(.api-link-kind))')
    const measured = await looks(styles.replaceAll(':where(:not(.api-link-kind))', ''), container)
    expect(measured.note).not.toEqual(measured.prose)
    expect(measured.note.link.borderTopWidth).toBe('1px')
  })
})
