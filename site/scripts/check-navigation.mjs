import assert from 'node:assert/strict'

/** Browser load can precede the router's initial page-load event in development. */
async function observeInitialPageLoad(page) {
  await page.addInitScript(() => {
    window.__docsPageLoaded = false
    document.addEventListener('astro:page-load', () => { window.__docsPageLoaded = true }, { once: true })
  })
}

/** Keep the API drawer usable after the router replaces the document. */
export async function checkApiNavigation(page, base) {
  await observeInitialPageLoad(page)
  const server = `${base}/lua/latest/reference/libtmux-server/`
  const snapshot = `${base}/lua/latest/reference/libtmux-server-snapshot/`
  for (const width of [688, 390]) {
    await page.setViewportSize({ width, height: 759 })
    await page.goto(server, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    await page.locator('[data-api-nav-toggle]').waitFor({ state: 'visible' })
    await page.evaluate(() => {
      window.__apiNavigationProbe = { loads: 0 }
      document.addEventListener('astro:page-load', () => window.__apiNavigationProbe.loads++)
    })
    await page.locator('.api-member-link[href$="libtmux-server-snapshot/"]').click()
    await page.waitForURL(snapshot)
    await page.waitForFunction(() => window.__apiNavigationProbe?.loads === 1)
    assert(await page.evaluate(() => window.__apiNavigationProbe), 'API navigation retains the document')
    assert(await page.locator('html').evaluate((el) => el.hasAttribute('data-api-nav')),
      `API navigation restores the drawer styles at ${width}px`)
    const nav = page.locator('#api-nav')
    const toggle = page.locator('[data-api-nav-toggle]')
    await nav.waitFor({ state: 'hidden' })
    const open = async () => {
      await toggle.click()
      await nav.waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.querySelector('#api-nav').getBoundingClientRect().left >= 0)
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    }
    for (const close of ['button', 'Escape', 'overlay']) {
      await open()
      await nav.locator('[role="tree"]').evaluate((el) => { el.scrollTop = el.scrollHeight })
      if (close === 'button') await nav.locator('[data-api-nav-close]').click()
      else if (close === 'Escape') await page.keyboard.press('Escape')
      else await page.locator('[data-api-nav-overlay]').click({ position: { x: width - 2, y: 400 } })
      await nav.waitFor({ state: 'hidden' })
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    }
    await page.goBack()
    await page.waitForURL(server)
    await page.waitForFunction(() => window.__apiNavigationProbe?.loads === 2)
    await open()
    const menu = nav.locator('.api-nav__menu')
    const summary = menu.locator(':scope > summary')
    const row = await summary.boundingBox(), section = await menu.boundingBox()
    assert(Math.abs(row.y + row.height / 2 - section.y - section.height / 2) <= 1,
      `Documentation disclosure is vertically centered at ${width}px`)
    await summary.click()
    assert.equal(await menu.evaluate((el) => el.open), true)
    await summary.click()
    assert.equal(await menu.evaluate((el) => el.open), false)
    await nav.locator('[data-api-nav-close]').click()
  }
  for (const path of ['', 'guides/overview/']) {
    const response = await page.goto(`${base}/lua/latest/${path}`, { waitUntil: 'load' })
    assert(response?.ok(), `Lua ${path || 'home'}: HTTP ${response?.status()}`)
    await page.waitForFunction(() => window.__docsPageLoaded)
    await page.locator('#mobile-sidebar-toggle').click()
    await page.locator('#mobile-sidebar a[href$="/reference/"]').click()
    await page.waitForURL(`${base}/lua/latest/reference/`)
    await page.locator('.api-index-card__link[href$="/reference/libtmux-server/"]').click()
    await page.waitForURL(server)
    assert(await page.locator('[data-api-nav-toggle]').isVisible(), `${path || 'Port home'} to API keeps the drawer toggle`)
    await page.locator('[data-api-nav-toggle]').click()
    await page.locator('[data-api-nav-close]').click()
    await page.locator('#api-nav').waitFor({ state: 'hidden' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#api-nav').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#api-nav').evaluate((el) => el.inert), false)
  assert.equal(await page.locator('[data-api-nav-toggle]').isVisible(), false)
  console.log('API navigation: client swaps, Back, drawer close controls, disclosure alignment and desktop pass')
}

/** Check the controls attached to a document after its content is replaced. */
export async function checkNavigation(page, base) {
  await observeInitialPageLoad(page)
  await page.goto(`${base}/examples/attach-and-send-keys/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  await page.evaluate(() => {
    localStorage.setItem('color-scheme', 'dark')
    localStorage.setItem('libtmux-docs.mcp-install.cooldown.enabled', '1')
    window.__applyTheme()
    window.__navigationProbe = { loads: 0, blank: false, wrongTheme: false }
    document.addEventListener('astro:page-load', () => window.__navigationProbe.loads++)
    document.addEventListener('astro:after-swap', () => {
      window.__navigationProbe.blank ||= document.documentElement.classList.contains('fonts-pending')
      window.__navigationProbe.wrongTheme ||= document.documentElement.dataset.themeMode !== 'dark'
    })
  })
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Examples', exact: true }).click()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 1)
  assert.match(page.url(), /\/examples\/$/)
  await page.locator('main').getByRole('link', { name: 'Attach and send keys', exact: true }).click()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 2)
  await page.keyboard.press('Control+k')
  await page.locator('#search-modal[open] .search-panel__input').waitFor({ state: 'visible' })
  assert(await page.locator('#search-modal .search-panel__input').evaluate((input) => document.activeElement === input))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('#search-modal').open)
  await page.locator('[data-page-actions] summary').click()
  await page.getByRole('button', { name: 'Print', exact: true }).waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-page-actions]').getAttribute('open'), null)
  const otherTab = page.locator('.code-tab[aria-selected="false"]').first()
  const port = await otherTab.getAttribute('data-port')
  await otherTab.click()
  assert.equal(await page.locator(`.code-tab[data-port="${port}"]`).first().getAttribute('aria-selected'), 'true')
  await page.goBack()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 3)
  assert.deepEqual(await page.evaluate(() => window.__navigationProbe), { loads: 3, blank: false, wrongTheme: false })
  assert.equal(await page.locator('html').getAttribute('data-mcp-install-cooldown-enabled'), '1')
  console.log('Navigation: document retained, Back, search, code tabs, menu and saved theme/cooldown pass')

  for (const [port, version] of [['ts', 'latest'], ['py', 'stable']]) {
    const prefix = new URL(`${base}/${port}/${version}/`).pathname
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const response = await page.goto(`${base}/${port}/${version}/examples/capture-pane-output/`, { waitUntil: 'load' })
      assert(response?.ok(), `${port}: owned example exists in the root build`)
      const sidebars = page.locator('nav.sidebar-nav')
      assert.equal(await sidebars.count(), 2, 'Desktop and mobile both have navigation')
      for (const sidebar of await sidebars.all()) {
        const query = sidebar.getByRole('link', { name: 'Filtering and queries', exact: true, includeHidden: true })
        assert.equal(await query.getAttribute('href'), `${prefix}concepts/queries/`,
          `${port} ${version} at ${width}px: shared query page stays in the selected port`)
        const links = await sidebar.locator('a[href^="/"]').evaluateAll((items) => items.map((a) => a.getAttribute('href')))
        for (const href of links) assert(href.startsWith(prefix), `${port} sidebar leaves ${prefix}: ${href}`)
      }
    }
  }
  console.log('Sidebars: root-mounted port pages retain the selected port and version on desktop and mobile')

  const legacy = `${base}/go/latest/examples/workspace-from-file/`
  const current = `${base}/go/latest/workspace/internals/examples/`
  await page.goto(`${legacy}?from=legacy#where-this-comes-from`, { waitUntil: 'load' })
  await page.waitForURL(`${current}?from=legacy#where-this-comes-from`)
  assert.equal(await page.locator('#where-this-comes-from').count(), 1, 'Legacy section still exists')
  const fallback = await page.context().browser().newContext({ javaScriptEnabled: false })
  try {
    const reader = await fallback.newPage()
    await reader.goto(legacy, { waitUntil: 'load' })
    await reader.waitForURL(current)
    assert.match(await reader.locator('h1').textContent(), /Go workspace/)
  } finally {
    await fallback.close()
  }
  console.log('Redirects: legacy query/section links and the JavaScript-disabled fallback pass')
}

/** Port references keep examples in the selected language. */
export async function checkApiExampleOwnership(page, base, path = 'ts/latest/reference/pane-pane-capture/') {
  await page.goto(`${base}/${path}`, { waitUntil: 'load' })
  const languages = await page.locator('main pre[data-language]').evaluateAll((blocks) =>
    blocks.map((block) => block.getAttribute('data-language')))
  assert(languages.length > 0, 'The capture reference keeps its own example')
  assert(languages.every((language) => language === 'typescript' || language === 'ts'),
    `TypeScript reference contains another language: ${languages.join(', ')}`)
  assert.equal(await page.locator('main .api-example-tabs').count(), 0)
  assert.equal(await page.locator('[data-page-port-switcher]').count(), 1,
    'Readers can still switch ports from the page toolbar')
  console.log('Reference examples: TypeScript examples stay visible without other languages')
}
