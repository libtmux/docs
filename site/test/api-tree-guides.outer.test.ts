import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Sidebar guide lines in a real browser, with the site's own stylesheets and no server. A guide line marks a row's
 * parent, so it sits under the parent's label and never crosses the row's own.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = ['../src/styles/kind-marks.css', '../src/styles/api-tree.css'].map(read).join('\n')
// The rule that moves the guide for mixed marks, which have no kind-mark gutter.
const mixedGuide = /\/\* Mixed marks have no kind-mark gutter[\s\S]*?\n\}\n/

// The MCP sidebar as the page writes it: Outline, mixed marks, a section, a subsection and a resource.
const tree = `<div id="api-nav" class="api-nav" data-marks="mixed" data-presentation="outline"><nav class="api-nav__nav"><ul role="tree" class="api-nav__tree">
<li role="treeitem" class="api-nav__item" aria-level="1" aria-expanded="true" aria-description="section" data-lazy="type:section:resources">
  <div class="api-nav__row" style="--level:1"><span class="api-nav__chevron" aria-hidden="true"></span><a class="api-nav__label" href="#">Resources</a><span class="api-nav__count">1</span></div>
  <ul role="group" class="api-nav__group">
    <li role="treeitem" class="api-nav__item" aria-level="2" aria-expanded="true" aria-description="section" data-lazy="type:section:resources-fixed-resources">
      <div class="api-nav__row" style="--level:2"><span class="api-nav__chevron" aria-hidden="true"></span><a class="api-nav__label" href="#">Fixed resources</a><span class="api-nav__count">1</span></div>
      <ul role="group" class="api-nav__group"><li role="none">
        <a role="treeitem" class="api-nav__row api-nav__leaf" aria-level="3" href="#" aria-current="page" aria-description="resource" style="--level:3"><span class="api-nav__label">capabilities</span></a>
      </li></ul>
    </li>
  </ul>
</li></ul></nav></div>`

const page = (css: string) => `<!doctype html><html><head><style>:root { --text-color: #1a1c1e; --background-color: #ffffff; }
body { margin: 0; font: 14px/1.5 sans-serif; width: 18rem; }\n${css}</style></head><body>${tree}</body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

/** Each nested row's guide line, its own label's text and its parent label's text, as page x positions. */
async function guides(css: string) {
  const target = await browser.newPage({ viewport: { width: 400, height: 300 } })
  await target.setContent(page(css))
  const rows = await target.evaluate(() => {
    const textLeft = (label: Element) => { const range = document.createRange(); range.selectNodeContents(label); return range.getBoundingClientRect().left }
    return [...document.querySelectorAll('[aria-level]:not([aria-level="1"])')].map((row) => {
      const label = row.matches('a') ? row.querySelector('.api-nav__label')! : row.querySelector(':scope > .api-nav__row > .api-nav__label')!
      const guide = getComputedStyle(label, '::before')
      const parent = row.parentElement!.closest('[aria-level]')!.querySelector(':scope > .api-nav__row > .api-nav__label')!
      return { text: label.textContent!.trim(), line: guide.borderInlineStartWidth,
        guide: label.parentElement!.getBoundingClientRect().left + parseFloat(guide.left), own: textLeft(label), parent: textLeft(parent) }
    })
  })
  await target.close()
  return rows
}

describe('sidebar guide lines with mixed marks', () => {
  it('sit under the parent label and clear the row label', async () => {
    const rows = await guides(styles)
    expect(rows.map((row) => row.text)).toEqual(['Fixed resources', 'capabilities'])
    for (const row of rows) {
      expect(row.line, row.text).toBe('1px')
      expect(Math.abs(row.guide - row.parent), `${row.text}: guide under its parent label`).toBeLessThan(1)
      expect(row.guide, `${row.text}: guide clears its own label`).toBeLessThan(row.own - 4)
    }
  })

  it('cross the row label without the mixed-marks rule, so the check above can fail', async () => {
    expect(styles).toMatch(mixedGuide)
    const rows = await guides(styles.replace(mixedGuide, ''))
    for (const row of rows) expect(row.guide, `${row.text}: the general rule's gutter puts the guide in the text`).toBeGreaterThan(row.own)
  })
})
