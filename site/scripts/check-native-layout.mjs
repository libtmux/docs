import assert from 'node:assert/strict'

/** Bind native parameter anchors to their displayed overload and local fields. */
export async function checkNativeSignatureLinks(header, symbol) {
  assert(symbol?.signatures.length > 0, 'Native signature owner is present in the model')
  const { parameterId } = await import('../../packages/api-model/src/link.ts')
  const displayed = await header.evaluate((element) => ({
    owner: element.getAttribute('data-symbol-id'),
    signatures: [...element.querySelectorAll('.api-native-signature')].map((signature) =>
      [...signature.querySelectorAll('a')].map((link) => ({
        name: link.textContent, href: link.getAttribute('href'), parameter: link.classList.contains('api-parameter-name'),
      }))),
    targets: [...element.ownerDocument.querySelectorAll('[id]')].map((target) => target.id),
  }))
  assert.equal(displayed.owner, symbol.id, 'Native signature owner matches the displayed declaration')
  assert.equal(displayed.signatures.length, symbol.signatures.length, 'Every native overload is displayed')
  for (const [index, links] of displayed.signatures.entries()) {
    const parameters = links.filter((link) => link.parameter)
    assert.deepEqual(parameters.map((link) => link.name), symbol.signatures[index].params.map((parameter) => parameter.name),
      `Native parameter links match overload ${index + 1}`)
    for (const link of parameters) {
      const target = parameterId(symbol, link.name)
      assert.equal(link.href, `#${encodeURIComponent(target)}`, `Native parameter ${link.name} has its exact local destination`)
      assert.equal(displayed.targets.filter((id) => id === target).length, 1,
        `Native parameter ${link.name} resolves to one local target`)
    }
  }
  return displayed.signatures.flat()
}

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
