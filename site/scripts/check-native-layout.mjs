import assert from 'node:assert/strict'

/** Keep one page picker and visible native header controls. */
export async function checkNativeHeader(page) {
  assert.equal(await page.locator('[data-lt-shell]').count(), 0)
  assert.equal(await page.locator('[data-page-port-switcher]').count(), 1)
  const controls = await page.locator('.site-header').evaluate((container) => {
    const links = [...container.querySelectorAll('summary, a, button')]
      .filter((link) => link.checkVisibility({ visibilityProperty: true }))
    const bounds = links.map((link) => link.getBoundingClientRect())
    return {
      count: links.length,
      visible: bounds.every((rect) => rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth),
      covered: links.filter((link, i) => {
        const rect = bounds[i]
        return !link.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }).map((link) => link.getAttribute('aria-label') ?? link.textContent.trim()),
    }
  })
  assert(controls.count >= 3, 'Native page, search and menu controls remain available')
  assert(controls.visible, 'Native header controls fit the viewport')
  assert.deepEqual(controls.covered, [], 'Native header controls are reachable')
}

/** Delay enhancement until the initial article and navigation can be inspected. */
export async function checkNativeFirstPaint(page, url) {
  let release
  const delayedScript = new Promise((resolve) => { release = resolve })
  const pendingRoutes = []
  const routeScript = (route) => {
    const pending = delayedScript.then(() => route.continue())
    pendingRoutes.push(pending)
    return pending
  }
  await page.route('**/_astro/*.js', routeScript)
  try {
    const response = await page.goto(url, { waitUntil: 'commit' })
    assert(response?.ok(), `Native page: HTTP ${response?.status()}`)
    await page.locator('article h1').waitFor({ state: 'visible' })
    assert(await page.locator('.site-header').isVisible(), 'Compiled native header is visible before enhancement arrives')
    assert.equal(await page.locator('[data-page-port-switcher]').getAttribute('data-enhanced'), null,
      'Native navigation is visible before enhancement')
    await checkNativeHeader(page)
    const initial = await page.locator('article h1').boundingBox()
    await page.evaluate(() => { window.__initialNativeHeader = document.querySelector('.site-header') })
    release()
    await page.waitForLoadState('networkidle')
    assert.deepEqual(await page.locator('article h1').boundingBox(), initial, `Native first paint stays still at ${page.viewportSize().width}px`)
    assert(await page.evaluate(() => window.__initialNativeHeader === document.querySelector('.site-header')),
      'Enhancement preserves the initial header')
    assert.equal(await page.locator('.site-header').count(), 1)
  } finally {
    release()
    await Promise.all(pendingRoutes)
    await page.unroute('**/_astro/*.js', routeScript)
  }
}
