import assert from 'node:assert/strict'

/** Real font selection, link drawing and geometry at the first visible frame. */
async function observeAppearance(context) {
  await context.addInitScript(() => {
    window.__appearance = { document: crypto.randomUUID(), first: null, shifts: 0, positions: [] }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (window.__appearance.first && !entry.hadRecentInput) window.__appearance.shifts += entry.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
    const sample = () => {
      const heading = document.querySelector('main h1')
      if (heading && getComputedStyle(document.body).visibility === 'visible') {
        const rect = heading.getBoundingClientRect()
        window.__appearance.positions.push([rect.x, rect.y, rect.width, rect.height])
        if (!window.__appearance.first) {
          const text = [heading, document.querySelector('main code')].filter(Boolean)
          const icon = document.querySelector('a[data-external-link]')
          const dotted = document.querySelector('.api-badge[data-link-preview] > .api-badge__label')
          window.__appearance.first = {
            readiness: document.documentElement.dataset.pageReadiness,
            fonts: text.every((element) => {
              const s = getComputedStyle(element)
              const family = s.fontFamily.split(',')[0]
              return family.includes('IBM Plex') && document.fonts.check(`${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${family}`)
            }),
            mask: icon ? getComputedStyle(icon, '::after').maskImage : null,
            underline: dotted ? getComputedStyle(dotted).textDecorationStyle : null,
            versions: document.querySelector('[data-select="version"]')?.options.length ?? 0,
            versionVisible: Boolean(document.querySelector('[data-version-control]:not([hidden])')),
          }
        }
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

/** Held and failed required resources must never become elapsed-time success. */
export async function checkRequiredAppearance(browser, base) {
  for (const [kind, path, width] of [
    ['font', '/', 390],
    ['module', '/java/latest/reference/io-github-libtmux-buffers-buffers-delete/', 1280],
    ['effect', '/prompts/?port=ts', 390],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    await observeAppearance(context)
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    let release, requested = false
    const hold = new Promise((resolve) => { release = resolve })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.clock.install()
      let module
      if (kind === 'module') {
        const html = await page.request.get(`${base}${path}`).then((response) => response.text())
        const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1])
        const attributes = scripts.find((attributes) => /type="module"/.test(attributes)
          && /src="/.test(attributes) && !/vite|toolbar|cloudflareinsights/.test(attributes))
        assert(attributes, 'The real page contains an external required module')
        module = new URL(attributes.match(/src="([^"]+)"/)[1], base).href
      }
      const required = (request) => kind === 'font' ? request.resourceType() === 'font'
          : kind === 'effect' ? new URL(request.url()).pathname.endsWith('/versions.json')
          : request.url() === module
      const incoming = page.waitForRequest(required)
      await page.route('**/*', async (route) => {
        if (required(route.request())) { requested = true; await hold }
        if (kind === 'effect' && required(route.request())) {
          // Exercise insertion even when a new preview's actual manifest has
          // only one published version for the selected port.
          const entries = [
            { slug: 'stable', label: 'stable', supported: true },
            { slug: 'latest', label: 'latest', supported: true },
          ]
          await route.fulfill({ json: { schema: 1, ports: { py: entries, ts: entries } } })
          return
        }
        await route.continue()
      })
      await page.goto(`${base}${path}`, { waitUntil: 'commit' })
      await incoming
      await page.waitForFunction(() => Boolean(document.querySelector('main h1')))
      // The test clock crosses the former cutoff; no product timer is used.
      await page.clock.fastForward(3500)
      assert(requested, `${kind}: the actual required request was held`)
      const held = await page.evaluate(() => ({ ...window.__appearance,
        readiness: document.documentElement.dataset.pageReadiness }))
      assert.equal(held.readiness, 'pending', `${kind}: stays pending past the old cutoff`)
      assert.equal(held.first, null, `${kind}: no incomplete visible frame`)
      release()
      const sample = await page.waitForFunction((document) => {
        const result = window.__appearance
        if (result.document !== document) return { changed: true }
        return result.first && result.positions.length >= 2 ? structuredClone(result) : false
      }, held.document)
      const result = await sample.jsonValue()
      if (result.changed) throw new Error('Appearance document changed during required-resource check')
      assert.equal(result.first.readiness, 'ready')
      assert(result.first.fonts, `${kind}: selected fonts succeeded before reveal`)
      assert.match(result.first.mask, /^url\("?data:image\/svg\+xml,/, `${kind}: the external icon draws at first reveal`)
      if (kind === 'module') assert.equal(result.first.underline, 'dotted', 'Reference underlines are present at first reveal')
      if (kind === 'effect') assert(result.first.versions > 1 && result.first.versionVisible, 'Visible version options finished before reveal')
      assert.deepEqual(result.positions[1], result.positions[0], `${kind}: text stays in place after reveal`)
      assert.equal(result.shifts, 0, `${kind}: no post-reveal layout shift`)
      assert.deepEqual(errors, [], `${kind}: no runtime errors`)
    } finally { release(); await context.close() }
  }

  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  try {
    await page.route('**/*', (route) => route.request().resourceType() === 'font' ? route.abort() : route.continue())
    await page.goto(`${base}/`, { waitUntil: 'commit' })
    await page.getByRole('alert').waitFor({ state: 'visible' })
    assert.equal(await page.locator('html').getAttribute('data-page-readiness'), 'failed')
    assert.equal(await page.locator('main h1').isVisible(), false, 'Required failure keeps incomplete content gated')
    await page.unroute('**/*')
    await page.getByRole('button', { name: 'Reload', exact: true }).click()
    await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
    assert(await page.locator('main h1').isVisible(), 'Reload recovers after the required resource becomes available')
  } finally { await context.close() }
  const legacy = await browser.newPage()
  try {
    const probe = `${base}/legacy-shell-probe/`
    await legacy.route(probe, (route) => route.fulfill({ contentType: 'text/html', body:
      `<link rel="stylesheet" href="${base}/_shell/anchors.css"><script type="module" src="${base}/_shell/anchors.js"></script><a href="https://example.com/">External</a>` }))
    await legacy.goto(probe)
    // The conditional decorator import can finish after window load.
    await legacy.locator('a[data-external-link]').waitFor({ state: 'attached' })
    assert.equal(await legacy.locator('a').getAttribute('data-external-link'), 'example.com', 'Standalone and cached older heads retain decoration')
    assert.match(await legacy.locator('a').evaluate((link) => getComputedStyle(link, '::after').maskImage), /external-link\.svg/)
  } finally { await legacy.close() }
  console.log('Appearance: held font/module/effect, first visible fonts/icons/dotted links, stable geometry, failure and Reload PASS')
}
