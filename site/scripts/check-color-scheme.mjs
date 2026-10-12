import assert from 'node:assert/strict'

/** Compact cycling and wide radios share the same saved preference. */
export async function checkColorScheme(browser, base) {
  for (const blocked of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 596, height: 777 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    try {
      if (blocked) {
        await context.route('**/astro/runtime/client/dev-toolbar/entrypoint.js', (route) =>
          route.fulfill({ contentType: 'application/javascript', body: 'export {}' }),
        )
        await context.addInitScript(() =>
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new DOMException('Storage blocked', 'SecurityError')
            },
          }),
        )
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
      assert(
        await cycle.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth) > 0),
        'The cycling button has visible keyboard focus',
      )
      await page.reload()
      await cycle.waitFor({ state: 'visible' })
      await check(
        blocked ? 'system' : 'dark',
        blocked ? 'Auto' : 'Dark',
        blocked ? 'Light' : 'Auto',
        blocked ? 'light' : 'dark',
      )
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
      assert.equal(
        await page.locator('.site-header__search-label').isVisible(),
        false,
        'Search text stays hidden at the intermediate width',
      )
      await radio.locator('[data-scheme="light"]').click()
      await page.setViewportSize({ width: 628, height: 777 })
      await check('light', 'Light', 'Dark', 'light')
      assert.deepEqual(errors, [])
    } finally {
      await context.close()
    }
  }
  const reader = await browser.newContext({
    viewport: { width: 1062, height: 789 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
  })
  try {
    const page = await reader.newPage()
    await page.goto(`${base}/tmux/concepts/server-session-window-pane/`)
    await page.locator('[data-scheme-cycle]').waitFor({ state: 'attached' })
    await page.waitForFunction(() => customElements.get('libtmux-code-tabs'))
    await page.locator('.code-tab[data-port="cxx"]').first().click()
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }))
    const position = await page.evaluate(() => scrollY)
    assert(position > 500, 'Exercise the sticky scheme controls while reading down the page')
    const checkPosition = async () => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(
        await page.evaluate(() => scrollY),
        position,
        'Changing colour scheme preserves the reading position',
      )
    }
    for (const scheme of ['dark', 'system', 'light']) {
      // Click the visible label: focusing the visually hidden radio directly
      // would let the automation scroll it first and conceal a focus jump.
      const box = await page.locator(`[data-scheme="${scheme}"]`).boundingBox()
      assert(box)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await checkPosition()
      assert.equal(await page.locator('html').getAttribute('data-color-scheme'), scheme)
      assert.equal(await page.evaluate(() => document.activeElement?.value), scheme)
    }
    await page.keyboard.press('ArrowRight')
    await checkPosition()
    assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'dark')
    assert(
      await page
        .locator('[data-scheme="dark"]')
        .evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth) > 0),
      'The radios retain visible keyboard focus',
    )
    await page.setViewportSize({ width: 596, height: 789 })
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), position)
    const compact = await page.locator('[data-scheme-cycle]').boundingBox()
    assert(compact)
    await page.mouse.click(compact.x + compact.width / 2, compact.y + compact.height / 2)
    await checkPosition()
    assert.equal(await page.locator('html').getAttribute('data-color-scheme'), 'system')
  } finally {
    await reader.close()
  }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 596, height: 777 } })
  try {
    const page = await context.newPage()
    await page.goto(`${base}/`)
    assert.equal(await page.locator('[data-scheme-cycle]').isVisible(), false)
    assert(
      await page.locator('[data-scheme-switch]').isVisible(),
      'The original radio group remains the no-JS fallback',
    )
  } finally {
    await context.close()
  }
  console.log(
    'Colour scheme: compact cycling, keyboard, accessible names, Auto, persistence, blocked storage, resize, reading position and no-JS fallback PASS',
  )
}
