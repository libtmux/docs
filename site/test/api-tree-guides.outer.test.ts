import { readFileSync } from 'node:fs'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Sidebar rows and guide lines in a real browser, with the site's own stylesheets and no server. Every ancestor level draws a
 * guide, hung from the centre of that ancestor's mark.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const styles = ['../src/styles/kind-marks.css', '../src/styles/api-tree.css'].map(read).join('\n')

const page = (css: string) => `<!doctype html><html><head><style>:root { --text-color: #1a1c1e; --background-color: #ffffff; }
body { margin: 0; font: 14px/1.5 sans-serif; width: 18rem; }\n${css}</style></head><body></body></html>`

let browser: Browser
beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 60_000)
afterAll(async () => { await browser?.close() })

// The API reference's tree as it writes it: a bucket, a type, a member with members of its own, and a leaf.
const mark = (label: string) => `<span class="api-nav__kind api-badge--kind-class" aria-hidden="true"><span class="api-badge__label">${label}</span></span>`
const branch = (level: number, label: string, children: string) => `<li role="treeitem" class="api-nav__item" aria-level="${level}" aria-expanded="true"${level > 1 ? ' aria-description="class"' : ''}>
  <div class="api-nav__row" style="--level:${level}"><span class="api-nav__chevron" aria-hidden="true"></span>${level > 1 ? mark('C') : ''}<span class="api-nav__label">${label}</span><span class="api-nav__count">1</span></div>
  <ul role="group" class="api-nav__group">${children}</ul>
</li>`
const leaf = (level: number, label: string, current = false) => `<li role="none"><a role="treeitem" class="api-nav__row api-nav__leaf" aria-level="${level}" href="#"${current ? ' aria-current="page"' : ''} aria-description="method" style="--level:${level}">${mark('m')}<span class="api-nav__label">${label}</span><span class="api-nav__count">2</span></a></li>`
const outline = `<div id="api-nav" class="api-nav" data-presentation="outline"><nav class="api-nav__nav"><ul role="tree" class="api-nav__tree">${
  branch(1, 'Server', branch(2, 'Pane', branch(3, 'Resize', leaf(4, 'width', true)) + leaf(3, 'a_rather_long_method_name_that_wraps_onto_several_lines')))}</ul></nav></div>`
// Tailwind's preflight sets border-box on every element of the site, and the row's `min-height` is measured by it.
const outlinePage = (css: string) => page(`*, ::before, ::after { box-sizing: border-box; }\n${css}`)
  .replace(/<body>[\s\S]*<\/body>/, `<body>${outline}</body>`).replace('width: 18rem', 'width: 15rem')

/** Each row's mark offset, height and guide lines, and the centres of the marks that its ancestors draw. */
async function outlineRows(css: string, options: { hasTouch?: boolean; forcedColors?: 'active' } = {}) {
  const context = await browser.newContext({ viewport: { width: 400, height: 600 }, ...options })
  const target = await context.newPage()
  await target.setContent(outlinePage(css))
  const rows = await target.evaluate(() => {
    const centre = (box: DOMRect) => box.left + box.width / 2
    return [...document.querySelectorAll('[aria-level]')].map((item) => {
      const row = item.matches('a') ? item : item.querySelector(':scope > .api-nav__row')!
      const box = row.getBoundingClientRect()
      const after = getComputedStyle(row, '::after')
      // The gradient's stops are 0, the line's width, the same again, and the period between lines.
      const stops = [...after.backgroundImage.matchAll(/([\d.]+)px/g)].map((match) => Number(match[1]))
      const period = stops.at(-1) ?? 0
      const width = parseFloat(after.width) || 0
      const lines = period ? Array.from({ length: Math.round(width / period) }, (_, k) => box.left + parseFloat(after.left) + k * period + stops[1] / 2) : []
      const ancestors: number[] = []
      for (let up = item.parentElement!.closest('li[aria-level]'); up; up = up.parentElement!.closest('li[aria-level]')) {
        const ancestor = up.querySelector(':scope > .api-nav__row > .api-nav__kind')
        if (ancestor) ancestors.unshift(centre(ancestor.getBoundingClientRect()))
      }
      const label = row.querySelector('.api-nav__label')!
      const range = document.createRange()
      range.selectNodeContents(label)
      const first = range.getClientRects()[0]
      const own = row.querySelector(':scope > .api-nav__kind')?.getBoundingClientRect()
      const count = row.querySelector(':scope > .api-nav__count')!.getBoundingClientRect()
      return { level: Number(item.getAttribute('aria-level')), text: label.textContent!.trim(), height: box.height, lines, ancestors,
        markOffset: own ? own.left - box.left : null, lineCount: range.getClientRects().length,
        markAbove: own ? own.top + own.height / 2 - (first.top + first.height / 2) : null, countAbove: count.top + count.height / 2 - (first.top + first.height / 2),
        before: getComputedStyle(row, '::before').content, afterFill: after.backgroundColor,
        edges: [row, label].map((element) => [getComputedStyle(element).borderInlineStartWidth, getComputedStyle(element).boxShadow]) }
    })
  })
  await context.close()
  return rows
}

describe('sidebar rows and guide lines', () => {
  it('indent the whole row, mark and label, one level at a time from the third', async () => {
    const rows = await outlineRows(styles)
    expect(rows.map((row) => row.level)).toEqual([1, 2, 3, 4, 3])
    // Half a rem of row padding, and a rem for each level past the second.
    expect(rows.filter((row) => row.markOffset !== null).map((row) => [row.level, row.markOffset])).toEqual([[2, 8], [3, 24], [4, 40], [3, 24]])
  })

  it('draw one guide for each ancestor level, hung from the centre of that ancestor\'s mark', async () => {
    const rows = await outlineRows(styles)
    expect(rows.map((row) => row.lines.length)).toEqual([0, 0, 1, 2, 1])
    const level4 = rows.find((row) => row.level === 4)!
    // The level-2 type's mark and the level-3 member's mark: two positions, and the old single guide cannot hold both.
    expect(level4.ancestors).toHaveLength(2)
    level4.lines.forEach((line, k) => expect(Math.abs(line - level4.ancestors[k]), `guide ${k + 1} of the level-4 row`).toBeLessThan(1))
    for (const row of rows.filter((entry) => entry.level === 3)) expect(Math.abs(row.lines[0] - row.ancestors[0]), row.text).toBeLessThan(1)
  })

  it('give the current row its tint and weight and no bar, from a pseudo-element, a border or a shadow', async () => {
    const [current] = (await outlineRows(styles)).filter((row) => row.text === 'width')
    expect(current.before).not.toContain('"')
    expect(current.afterFill).toBe('rgba(0, 0, 0, 0)')
    // The row and its label, whose start edge a border or a shadow could draw a bar on.
    expect(current.edges).toEqual([['0px', 'none'], ['0px', 'none']])
  })

  it('keep their guides in forced colours, where a gradient is otherwise dropped', async () => {
    const rows = await outlineRows(styles, { forcedColors: 'active' })
    expect(rows.map((row) => row.lines.length)).toEqual([0, 0, 1, 2, 1])
  })

  it('keep a wrapped name\'s mark and count beside its first line', async () => {
    const wrapped = (await outlineRows(styles)).find((row) => row.text.startsWith('a_rather_long'))!
    expect(wrapped.lineCount).toBeGreaterThan(1)
    expect(Math.abs(wrapped.markAbove!), 'mark against line 1').toBeLessThan(1)
    expect(Math.abs(wrapped.countAbove), 'count against line 1').toBeLessThan(1)
  })

  it('grow each row to 2.75rem on a coarse pointer', async () => {
    const fine = await outlineRows(styles)
    const coarse = await outlineRows(styles, { hasTouch: true })
    expect(fine.filter((row) => row.lineCount === 1).map((row) => row.height)).toEqual([32, 32, 32, 32])
    expect(coarse.filter((row) => row.lineCount === 1).map((row) => row.height)).toEqual([44, 44, 44, 44])
  })
})

// A top-level bucket closed over the current page, in a tree with a presentation and in one without. The tint and weight
// mark the page's row; no row draws a bar at its start edge, whatever the pseudo-element, border or shadow it would use.
const closedBucket = (attributes: string) => `<div id="api-nav" class="api-nav"${attributes}><nav class="api-nav__nav"><ul role="tree" class="api-nav__tree">
<li role="treeitem" class="api-nav__item" aria-level="1" aria-expanded="false" aria-description="class">
  <div class="api-nav__row" style="--level:1"><span class="api-nav__chevron" aria-hidden="true"></span><a class="api-nav__label" href="#">Server</a><span class="api-nav__count">1</span></div>
  <ul role="group" class="api-nav__group"><li role="none"><a role="treeitem" class="api-nav__row api-nav__leaf" aria-level="2" href="#" aria-current="page" style="--level:2"><span class="api-nav__label">kill</span></a></li></ul>
</li></ul></nav></div>`

describe.each([['without a presentation', ''], ['with a presentation', ' data-presentation="outline"']])('a closed top-level bucket over the current page, %s', (_mode, attributes) => {
  it('is semibold and draws no bar at its start edge', async () => {
    const target = await browser.newPage({ viewport: { width: 400, height: 300 } })
    await target.setContent(page(`*, ::before, ::after { box-sizing: border-box; }\n${styles}`).replace(/<body>[\s\S]*<\/body>/, `<body>${closedBucket(attributes)}</body>`))
    const rows = await target.evaluate(() => [...document.querySelectorAll('.api-nav__row')].map((row) => {
      const style = getComputedStyle(row)
      // A pseudo-element draws something when it has content and is not hidden.
      const before = getComputedStyle(row, '::before')
      return { text: row.textContent!.trim(), weight: style.fontWeight, before: before.display === 'none' ? 'none' : before.content, after: parseFloat(getComputedStyle(row, '::after').width) || 0,
        edge: [style.borderInlineStartWidth, style.boxShadow] }
    }))
    await target.close()
    expect(rows.map((row) => row.text.replace(/\d+$/, ''))).toEqual(['Server', 'kill'])
    expect(rows[0].weight, 'the closed bucket keeps its weight').toBe('600')
    for (const row of rows) {
      expect(row.before, `${row.text}: ::before`).not.toContain('"')
      expect(row.after, `${row.text}: ::after`).toBe(0)
      expect(row.edge, `${row.text}: border and shadow`).toEqual(['0px', 'none'])
    }
  })
})
