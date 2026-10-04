import assert from 'node:assert/strict'

/** Compact cycling and wide radios share the same saved preference. */
export async function checkColorScheme(browser, base) {
  for (const blocked of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 596, height: 777 }, colorScheme: 'light', reducedMotion: 'reduce' })
    try {
      if (blocked) {
        await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) => route.fulfill({ contentType: 'application/javascript', body: 'export {}' }))
        await context.addInitScript(() => Object.defineProperty(window, 'localStorage', {
          get() { throw new DOMException('Storage blocked', 'SecurityError') },
        }))
      }
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/?prompt=agent-orchestrator`)
      const cycle = page.locator('[data-scheme-cycle]')
      const radio = page.locator('[data-scheme-switch]')
      await cycle.waitFor({ state: 'visible' })
      assert.equal(await radio.isVisible(), false, 'A single button replaces the radio group at compact widths')
      assert.equal(await page.locator('.site-header__search-label').isVisible(), false)
      const check = async (preference, label, next, mode) => {
        assert.equal(await page.locator('html').getAttribute('data-color-scheme'), preference)
        assert.equal(await page.locator('html').getAttribute('data-theme-mode'), mode)
        assert.equal(await cycle.getAttribute('aria-label'), `Colour scheme: ${label}. Switch to ${next}`)
        assert.equal(await radio.locator('input:checked').inputValue(), preference)
        assert.equal(await cycle.locator('svg').count(), 1)
      }
      await check('system', 'Auto', 'Light', 'light')
      await cycle.click()
      await check('light', 'Light', 'Dark', 'light')
      await cycle.focus()
      await page.keyboard.press('Space')
      await check('dark', 'Dark', 'Auto', 'dark')
      assert(await cycle.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth) > 0), 'The cycling button has visible keyboard focus')
      await page.reload()
      await cycle.waitFor({ state: 'visible' })
      await check(blocked ? 'system' : 'dark', blocked ? 'Auto' : 'Dark', blocked ? 'Light' : 'Auto', blocked ? 'light' : 'dark')
      if (!blocked) {
        assert.equal(await page.evaluate(() => localStorage.getItem('color-scheme')), 'dark')
        await cycle.focus()
        await page.keyboard.press('Enter')
      }
      await check('system', 'Auto', 'Light', 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'dark')
      await check('system', 'Auto', 'Light', 'dark')
      await page.setViewportSize({ width: 763, height: 777 })
      assert(await radio.isVisible())
      assert.equal(await cycle.isVisible(), false)
      assert.equal(await page.locator('.site-header__search-label').isVisible(), false, 'Search text stays hidden at the intermediate width')
      await radio.locator('[data-scheme="light"]').click()
      await page.setViewportSize({ width: 628, height: 777 })
      await check('light', 'Light', 'Dark', 'light')
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 596, height: 777 } })
  try {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    assert.equal(await page.locator('[data-scheme-cycle]').isVisible(), false)
    assert(await page.locator('[data-scheme-switch]').isVisible(), 'The original radio group remains the no-JS fallback')
  } finally {
    await context.close()
  }
  console.log('Colour scheme: compact cycling, keyboard, accessible names, Auto, persistence, blocked storage, resize and no-JS fallback PASS')
}
