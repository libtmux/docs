import assert from 'node:assert/strict'
import { checkHomeResponsiveLayout } from './check-home-launcher.mjs'
import { checkPickerFilters } from './check-picker-filters.mjs'
import { checkNavigationBeforeAnalytics } from './check-navigation.mjs'

/** A bounded rendering sample; the publication audit runs the full matrix. */
export async function checkDevSample(browser, base) {
  await checkPickerFilters(browser, base)
  await checkNavigationBeforeAnalytics(browser, base)
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.setDefaultTimeout(10000)
  try {
    for (const path of ['tmux/concepts/server-session-window-pane/', 'mcp/tools/', 'api-example-probe/']) {
      const response = await page.goto(`${base}/${path}`)
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.locator('[data-scheme-cycle]:not([hidden])').waitFor({ state: 'attached' })
      await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.locator('main h1').count(), 1, `${path}: one main heading`)
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
            controls,
            tableColumns: head.length,
            columns: head.length === body.length ? head.map((cell, index) =>
              Math.abs(cell.getBoundingClientRect().x - body[index].getBoundingClientRect().x)) : null,
          }
        })
        assert(layout.overflow <= 1 && layout.header <= 49, `${path}/${width}: page and compact header fit`)
        assert(layout.controls.every((control) => control.height > 0
          && Math.abs(control.height - layout.controls[0].height) < .1
          && Math.abs(control.top - layout.controls[0].top) < .1), `${path}/${width}: visible controls align`)
        if (path === 'mcp/tools/') {
          assert(layout.tableColumns > 1 && layout.columns?.every((delta) => delta <= 1), `${width}: MCP table columns align`)
        }
      }
      if (path.startsWith('tmux/')) {
        assert.match(await page.title(), /\| tmux \| libtmux\.org$/)
        const picker = page.locator('[data-page-port-switcher]')
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
        const equivalents = page.locator('.api-elsewhere a')
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
    assert.deepEqual(errors, [], 'Sampled pages have no runtime errors')
    console.log('Fresh browser sample: prose, MCP table, API equivalents, phone picker, and homepage controls PASS')
  } finally {
    await context.close()
  }
}
