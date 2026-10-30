import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

/**
 * The Parameters label and the first line of its value in a real browser, with the site's own stylesheets and no server.
 * The alignment sits in a container query on the entry's width, which happy-dom does not evaluate.
 */
const read = (path: string) => readFileSync(new URL(`../src/styles/${path}`, import.meta.url), 'utf8')
const styles = ['api-kinds.css', 'api-headings.css', 'api.css', 'vendor/gp-sphinx-api.css'].map(read).join('\n')
const rule = /\n {2}dl\.py\.gp-sphinx-api-container > dd \.gp-sphinx-api-parameters > dl\.field-list > dt:has\(\+ dd \.api-heading-link\) \{\n {4}line-height: [^\n]+\n {2}\}/
const margin = /\n {2}dl\.py\.gp-sphinx-api-container > dd \.gp-sphinx-api-parameters > dl\.field-list > dd \{\n {4}margin-top: 0;\n {2}\}/
const baseline = '@container gp-sphinx-api-entry (width > 36rem) { dl.py.gp-sphinx-api-container > dd .gp-sphinx-api-parameters > dl.field-list { align-items: baseline; } }'

// A typed parameter, whose line holds its permalink, and a returned value in plain text. A prose page gives its labels a looser
// line height than the entry's values have, which the label rule has to override.
const entry = `<dl class="py gp-sphinx-api-container"><dt>Declaration</dt><dd><div class="gp-sphinx-api-parameters"><dl class="field-list simple">
  <dt>Parameters</dt><dd><ul class="simple api-parameters"><li><p><span class="api-parameter-signature"><strong><a href="#name"><code>name</code></a></strong></span> <a class="api-heading-link" href="#name">#</a></p></li></ul></dd>
  <dt>Returns</dt><dd><p>The pane.</p></dd>
</dl></div></dd></dl>`
const page = (css: string) => `<!doctype html><html><head><style>:root { --gp-sphinx-type-metadata: 0.875rem; --color-muted: #53606d; }
*, ::before, ::after { box-sizing: border-box; } ul, p, dd { margin: 0; padding: 0; } ul { list-style: none; } dt { line-height: 1.75; } body { margin: 0; font: 16px/1.5 sans-serif; width: 50rem; } code { font: 13px/1.2 monospace; }\n${css}</style></head><body>${entry}</body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

/** For each row, how far the label's baseline sits above its value's first baseline, and how far the label's top sits below the value's. */
async function rows(css: string) {
  const target = await browser.newPage({ viewport: { width: 900, height: 400 } })
  await target.setContent(page(css))
  const measured = await target.evaluate(() => {
    const baseline = (element: Element) => {
      const probe = Object.assign(document.createElement('i'), { style: 'display: inline-block; width: 0; height: 0;' })
      element.prepend(probe)
      const y = probe.getBoundingClientRect().bottom
      probe.remove()
      return y
    }
    const list = document.querySelector('dl.field-list')!
    const labels = [...list.querySelectorAll(':scope > dt')]
    return {
      rows: labels.map((label) => {
        const value = label.nextElementSibling!
        const first = value.querySelector('code') ?? value.querySelector('p')!
        return { label: label.textContent, baseline: baseline(label) - baseline(first), top: label.getBoundingClientRect().top - value.getBoundingClientRect().top }
      }),
      // The first label's inset from the top of the list, and the last value's from its bottom: what the entry's padding leaves alone.
      insetTop: labels[0]!.getBoundingClientRect().top - list.getBoundingClientRect().top,
      insetBottom: list.getBoundingClientRect().bottom - [...labels.at(-1)!.nextElementSibling!.querySelectorAll('p')].at(-1)!.getBoundingClientRect().bottom,
    }
  })
  await target.close()
  return measured
}

it('shares a baseline between each label and the first line of its value, and keeps both at the top of the row', async () => {
  const measured = await rows(styles)
  expect(measured.rows.map((row) => row.label)).toEqual(['Parameters', 'Returns'])
  for (const row of measured.rows) {
    expect(Math.abs(row.baseline), `${row.label}: baseline`).toBeLessThan(1)
    expect(Math.abs(row.top), `${row.label}: top`).toBeLessThan(0.5)
  }
  expect([Math.abs(measured.insetTop), Math.abs(measured.insetBottom)].every((inset) => inset < 0.5)).toBe(true)
})

it('leaves the label above the name without the line height, so the check above can fail', async () => {
  expect(styles).toMatch(rule)
  const [parameters] = (await rows(styles.replace(rule, ''))).rows
  expect(Math.abs(parameters.baseline)).toBeGreaterThan(1)
})

it('pushes the label off the top of its row when the items align on their baseline over the value\'s margin, which the entry\'s inset cannot take', async () => {
  expect(styles).toMatch(margin)
  const measured = await rows(`${styles.replace(rule, '').replace(margin, '')}\n${baseline}`)
  expect(Math.abs(measured.rows[0].top)).toBeGreaterThan(1)
})
