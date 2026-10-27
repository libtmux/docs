import assert from 'node:assert/strict'
import { checkHomeResponsiveLayout } from './check-home-launcher.mjs'
import { checkPickerFilters } from './check-picker-filters.mjs'
import { checkNavigationBeforeAnalytics } from './check-navigation.mjs'
import { checkHeaderMenuSections } from './check-header-menu-sections.mjs'
import { checkStatusBadges } from './check-status-badges.mjs'
import { checkDeclarationControlsLevel } from './check-native-layout.mjs'
import { checkBlockLinksUndecorated, checkKindBadgeLinks, checkRequiredAppearance } from './check-page-readiness.mjs'
import { checkTmuxKeys } from './check-tmux-keys.mjs'

// Row-anchored tables with different first-cell shapes: plain text, code, a
// comma-separated flag pair, and code that wraps in a narrow column.
const ROW_PERMALINK_PAGES = [
  'rs/latest/concepts/server-session-window-pane/',
  'tmux/concepts/server-session-window-pane/',
  'ruby/latest/workspace/cli/',
]

/** Where each row's permalink and text sit, measured in the browser. */
function measureRowPermalinks() {
  const first = (rects) => Math.min(...rects.map((rect) => rect.left))
  const contentRects = (cell, link) => {
    const range = document.createRange()
    range.setStart(cell, 0)
    if (link) range.setEndBefore(link)
    else range.setEnd(cell, cell.childNodes.length)
    return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
  }
  return [...document.querySelectorAll('table:has(tr.anchored-entry)')].map((table) => {
    const header = table.tHead?.rows[0]?.cells[0]
    const headerRects = header ? contentRects(header) : []
    return {
      headerInset: headerRects.length ? first(headerRects) - header.getBoundingClientRect().left : null,
      rows: [...table.querySelectorAll('tr.anchored-entry')].map((row) => {
        const [cell, ...others] = row.cells
        const link = cell.querySelector('a[data-row-permalink]')
        const label = cell.textContent.replace('¶', '').trim()
        if (!link) return { label, link: false }
        const linkBox = link.getBoundingClientRect()
        const text = contentRects(cell, link)
        const y = linkBox.top + linkBox.height / 2
        const line = text.filter((rect) => rect.top - 1 <= y && y <= rect.bottom + 1)
        const last = text.at(-1)
        const inset = (target, rects) => rects.length ? first(rects) - target.getBoundingClientRect().left : null
        return {
          label,
          link: true,
          em: parseFloat(getComputedStyle(cell).fontSize),
          gap: line.length ? linkBox.left - Math.max(...line.map((rect) => rect.right)) : null,
          trailing: Boolean(last) && y >= last.top - 1 && y <= last.bottom + 1,
          inset: inset(cell, text),
          otherInsets: others.map((other) => inset(other, contentRects(other))),
          opacity: getComputedStyle(link).opacity,
        }
      }),
    }
  })
}

/** The revealed permalink's contrast against what is behind it. */
function revealedContrast(id) {
  const link = document.getElementById(id).querySelector('a[data-row-permalink]')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const rgba = (css) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = '#000'
    context.fillStyle = css
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    return [r, g, b, a / 255]
  }
  const over = ([r, g, b, a], [br, bg, bb]) => [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]
  const layers = []
  for (let node = link; node; node = node.parentElement) layers.push(rgba(getComputedStyle(node).backgroundColor))
  let ground = [255, 255, 255]
  for (const layer of layers.reverse()) ground = over(layer, ground)
  const luminance = (channels) => {
    const [r, g, b] = channels.map((value) => {
      const unit = value / 255
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const text = over(rgba(getComputedStyle(link).color), ground)
  const [light, dark] = [luminance(text), luminance(ground)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * A row's permalink trails the end of its first cell's text with a small gap,
 * stays quiet until the row is hovered, focused or targeted, and every cell
 * of the row shares one left inset.
 */
export async function checkRowPermalinks(browser, base, pages = ROW_PERMALINK_PAGES) {
  let rows = 0
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ colorScheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    try {
      for (const path of pages) {
        const response = await page.goto(`${base}/${path}`)
        assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
        await page.locator('[data-scheme-cycle]:not([hidden])').waitFor({ state: 'attached' })
        await page.waitForFunction(() => document.fonts.status === 'loaded')
        for (const width of [1440, 768, 390]) {
          const where = `${colorScheme}/${path}/${width}px`
          await page.setViewportSize({ width, height: 1000 })
          await page.mouse.move(0, 0)
          const tables = await page.evaluate(measureRowPermalinks)
          assert(tables.length > 0, `${where}: the page has row-anchored tables`)
          for (const table of tables) {
            for (const row of table.rows) {
              assert(row.link, `${where}: row "${row.label}" has a permalink`)
              if (colorScheme === 'light' && width === 1440) rows++
              assert(row.gap !== null && row.trailing,
                `${where}: row "${row.label}" permalink is not on the last line of its text`)
              assert(row.gap >= 0.1 * row.em && row.gap <= 0.5 * row.em,
                `${where}: row "${row.label}" permalink starts ${row.gap.toFixed(1)}px after its text, outside 0.1em to 0.5em`)
              assert(row.inset >= 0.25 * row.em,
                `${where}: row "${row.label}" first-column text sits ${row.inset.toFixed(1)}px from the cell edge`)
              for (const inset of row.otherInsets.filter((value) => value !== null)) {
                assert(Math.abs(inset - row.inset) <= 1,
                  `${where}: row "${row.label}" first-column inset ${row.inset.toFixed(1)}px differs from another column's ${inset.toFixed(1)}px`)
              }
              assert.equal(row.opacity, '0', `${where}: row "${row.label}" permalink is quiet at rest`)
            }
            if (table.headerInset !== null) {
              assert(Math.abs(table.headerInset - table.rows[0].inset) <= 1,
                `${where}: header and body text share one inset in the first column`)
            }
          }
          const cell = page.locator('tr.anchored-entry > :first-child').first()
          const firstRow = page.locator('tr.anchored-entry').first()
          const id = await firstRow.getAttribute('id')
          const link = firstRow.locator('a[data-row-permalink]')
          const reveal = async (state) => {
            assert.equal(await link.evaluate((node) => getComputedStyle(node).opacity), '1',
              `${where}: the permalink appears when its row is ${state}`)
            assert(await page.evaluate(revealedContrast, id) >= 3,
              `${where}: the permalink stays legible when its row is ${state}`)
          }
          await cell.evaluate((node) => node.scrollIntoView({ block: 'center' }))
          const box = await cell.boundingBox()
          await page.mouse.move(box.x + 4, box.y + box.height / 2)
          await reveal('hovered')
          await page.mouse.move(0, 0)
          await link.focus()
          await reveal('focused')
          await link.evaluate((node) => node.blur())
          if (width === 390) {
            await page.evaluate((target) => { location.hash = target }, id)
            await reveal('targeted')
          }
        }
      }
    } finally {
      await context.close()
    }
  }
  console.log(`Row permalinks: ${rows} rows on ${pages.length} pages trail their text, share one inset and reveal on hover, focus and target in light and dark`)
}

/** A bounded rendering sample; the publication audit runs the full matrix. */
export async function checkDevSample(browser, base) {
  await checkPickerFilters(browser, base)
  await checkHeaderMenuSections(browser, base, { ports: ['py', 'java', 'csharp'], schemes: ['light'] })
  await checkStatusBadges(browser, base, { ports: ['go', 'py'], widths: [1440], schemes: ['light'], touch: false })
  await checkNavigationBeforeAnalytics(browser, base)
  await checkRequiredAppearance(browser, base)
  await checkRowPermalinks(browser, base)
  await checkKindBadgeLinks(browser, base, { sample: true })
  await checkBlockLinksUndecorated(browser, base, { sample: true })
  await checkTmuxKeys(browser, base)
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  try {
    for (const path of ['tmux/concepts/server-session-window-pane/', 'mcp/tools/', 'api-example-probe/']) {
      const response = await page.goto(`${base}/${path}`)
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.locator('[data-scheme-cycle]:not([hidden])').waitFor({ state: 'attached' })
      // Vite's first dependency reload may replace the document while fonts load.
      await page.waitForFunction(() => document.fonts.status === 'loaded')
      assert.equal(await page.locator('main h1').count(), 1, `${path}: one main heading`)
      const rootPath = new URL(base).pathname.replace(/\/$/, '')
      const inventoryLinks = await page.locator('footer a[href$=".inv"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
      assert.deepEqual(inventoryLinks, path === 'api-example-probe/'
        ? [`${rootPath}/ts/latest/objects.inv`, `${rootPath}/objects-full.inv`]
        : [...(path.startsWith('tmux/') ? [`${rootPath}/tmux/objects.inv`] : []), `${rootPath}/objects-full.inv`], `${path}: inventory links follow page scope`)
      assert.equal(await page.getByRole('link', { name: 'About Sphinx inventories', exact: true }).getAttribute('href'), `${rootPath}/meta/intersphinx/`)
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const layout = await page.evaluate(() => {
          const controls = ['.site-header__search', '.scheme-switch, .scheme-cycle', '.site-header__menu-button']
            .map((selector) => [...document.querySelectorAll(selector)].find((node) => node.checkVisibility()))
            .map((node) => { const { top, height } = node.getBoundingClientRect(); return { top, height } })
          const table = document.querySelector('table')
          const head = [...(table?.tHead?.rows[0]?.cells ?? [])]
          const body = [...(table?.tBodies[0]?.rows[0]?.cells ?? [])]
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            header: document.querySelector('.site-header__bar').getBoundingClientRect().height,
            headerPicker: Boolean(document.querySelector('.site-header-language [data-page-port-switcher]')),
            controls,
            tableColumns: head.length,
            columns: head.length === body.length ? head.map((cell, index) =>
              Math.abs(cell.getBoundingClientRect().x - body[index].getBoundingClientRect().x)) : null,
          }
        })
        const headerLimit = layout.headerPicker && width <= 560 ? 97 : 53
        assert(layout.overflow <= 1 && layout.header <= headerLimit, `${path}/${width}: page and responsive header fit`)
        assert(layout.controls.every((control) => control.height > 0
          && Math.abs(control.height - layout.controls[0].height) < .1
          && Math.abs(control.top - layout.controls[0].top) < .1), `${path}/${width}: visible controls align`)
        if (path === 'mcp/tools/') {
          assert(layout.tableColumns > 1 && layout.columns?.every((delta) => delta <= 1), `${width}: MCP table columns align`)
        }
        if (path === 'api-example-probe/') {
          await checkDeclarationControlsLevel(page.locator('dt.gp-sphinx-api-header').first(), `${path}/${width}: declaration controls`)
          const help = page.getByRole('link', { name: 'About Sphinx inventories', exact: true })
          await help.focus()
          const tip = page.locator('footer #inventory-tooltip')
          await tip.waitFor({ state: 'visible' })
          const bounds = await tip.boundingBox()
          assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}: inventory tooltip fits the viewport`)
          const guide = tip.getByRole('link', { name: 'Learn how to link to this documentation.', exact: true })
          assert.equal(await guide.getAttribute('href'), `${rootPath}/meta/intersphinx/`)
          await page.keyboard.press('Tab')
          assert(await guide.evaluate((node) => node === document.activeElement), 'Tab reaches the inventory setup link')
          await page.keyboard.press('Escape')
          await tip.waitFor({ state: 'hidden' })
          assert(await help.evaluate((node) => node === document.activeElement), 'Escape dismisses inventory help and returns focus to its trigger')
          await help.evaluate((node) => node.blur())
        }
      }
      if (path.startsWith('tmux/')) {
        assert.match(await page.title(), /\| tmux \| libtmux\.org$/)
        const picker = page.locator('[data-page-port-switcher]')
        assert.equal(await page.locator('.site-header-language [data-page-port-switcher]').count(), 1, 'Language selection is in the top bar')
        assert.equal(await page.locator('[data-documentation-context] [data-page-port-switcher]').count(), 0, 'The subbar has no duplicate language picker')
        await picker.locator('summary').click()
        const panel = picker.locator('[data-picker-panel]')
        await panel.waitFor({ state: 'visible' })
        const bounds = await panel.boundingBox()
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Phone language menu fits the viewport')
        await page.keyboard.press('Escape')
        assert.equal(await picker.getAttribute('open'), null)
        assert(await picker.locator('summary').evaluate((node) => node === document.activeElement), 'Escape restores focus')
      }
      if (path === 'api-example-probe/') {
        const declaration = page.locator('dt.gp-sphinx-api-header').first()
        const identity = await declaration.getAttribute('id')
        assert.equal(await declaration.locator('a.headerlink').getAttribute('href'), `#${identity}`,
          'A declaration permalink lands on its signature bar')
        assert.equal(await declaration.locator(':scope > .section-anchor-alias').getAttribute('id'), `${identity}.declaration`,
          'The previous declaration fragment remains available')
        const equivalents = page.locator('section:has(> #api-other-ports) .tmux-usage a')
        const hrefs = await equivalents.evaluateAll((links) => links.map((link) => link.getAttribute('href')))
        const java = hrefs.find((href) => /\/java\/latest\/reference\/.*capture/.test(href))
        assert(java, 'Pane.capture has its verified Java equivalent')
        const equivalent = await page.request.get(new URL(java, base).href)
        assert(equivalent.ok(), `${java}: equivalent declaration HTTP ${equivalent.status()}`)
        assert(await page.locator('.gp-sphinx-api-example [data-code]').count() > 0, 'API example has a copyable program')
      }
    }
    await page.goto(`${base}/?port=rs&prompt=eval-sweep&errors=1&cleanup=0`)
    await page.waitForSelector('[data-task-enhanced]:not([hidden])')
    const example = page.locator('[data-home-example="rs"]')
    assert(await example.locator('[data-home-view="errors"]').isVisible())
    await example.locator('[data-example-cleanup]').check()
    assert(await example.locator('[data-home-view="full"]').isVisible())
    assert.equal(new URL(page.url()).searchParams.get('cleanup'), '1')
    for (const width of [1440, 628, 390]) await checkHomeResponsiveLayout(page, width, 'rs')
    await page.getByRole('link', { name: 'About Sphinx inventories', exact: true }).focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForURL(`${base}/meta/intersphinx/`)
    assert.equal(await page.locator('main h1').innerText(), 'Link to libtmux from Sphinx', 'The inventory help link opens the setup guide')
    assert.deepEqual(errors, [], 'Sampled pages have no runtime errors')
    console.log('Fresh browser sample: prose, MCP table, API equivalents, phone picker, header menu sections, status badges and homepage controls PASS')
  } finally {
    await context.close()
  }
}
