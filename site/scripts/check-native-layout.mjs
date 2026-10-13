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

const observedPages = new WeakSet()

/** Hold required enhancement, then inspect complete native first appearance. */
export async function checkNativeFirstPaint(page, url) {
  if (!observedPages.has(page)) {
    observedPages.add(page)
    await page.addInitScript(() => {
      window.__nativePaint = { document: crypto.randomUUID(), frames: [], first: null }
      const sample = () => {
        const heading = document.querySelector('article h1')
        const state = window.__nativePaint
        if (heading && getComputedStyle(document.body).visibility === 'visible') {
          const { x, y, width, height } = heading.getBoundingClientRect()
          state.frames.push({ x, y, width, height })
          if (!state.first) {
            state.first = {
              ready: document.documentElement.dataset.pageReadiness,
              fonts: [heading, document.querySelector('article code')].filter(Boolean).every((element) => {
                const s = getComputedStyle(element)
                const family = s.fontFamily.split(',')[0]
                const name = family.replace(/^['"]|['"]$/g, '')
                return family.includes('IBM Plex') && [...document.fonts].some((face) =>
                  face.family === name && face.status === 'loaded')
                  && document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${family}`)
              }),
            }
          }
        }
        if (state.frames.length < 2) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }
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
    const required = page.waitForRequest((request) => request.resourceType() === 'script'
      && /\/_astro\/[^/]+\.js$/.test(new URL(request.url()).pathname))
    void required.catch(() => {})
    let response = await page.goto(url, { waitUntil: 'commit' })
    if (!response) response = await page.reload({ waitUntil: 'commit' })
    assert(response?.ok(), `Native page: HTTP ${response?.status()}`)
    await required
    await page.locator('article h1').waitFor({ state: 'attached' })
    const held = await page.evaluate(() => ({ ...window.__nativePaint,
      readiness: document.documentElement.dataset.pageReadiness }))
    assert.equal(held.readiness, 'pending', 'Required native enhancement remains pending')
    assert.equal(held.first, null, 'Native content stays gated while required enhancement is held')
    release()
    const observation = await page.waitForFunction(() => {
      const result = window.__nativePaint
      return result.first && result.frames.length >= 2 ? structuredClone(result) : false
    })
    const result = await observation.jsonValue()
    assert.equal(result.document, held.document, 'Held and revealed native observations share a document')
    assert.equal(result.first.ready, 'ready')
    assert(result.first.fonts, 'Selected native heading and code faces are loaded IBM Plex at first reveal')
    assert.deepEqual(result.frames[1], result.frames[0], `Native first paint stays still at ${page.viewportSize().width}px`)
    await checkNativeHeader(page)
    assert.equal(await page.locator('.site-header').count(), 1)
  } finally {
    release()
    await Promise.all(pendingRoutes)
    await page.unroute('**/_astro/*.js', routeScript)
  }
}
