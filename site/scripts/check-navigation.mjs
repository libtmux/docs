import assert from 'node:assert/strict'
import { PORTS } from '../src/lib/ports.ts'

/** Shared section drawers navigate, disclose their children, and keep the current page visible. */
export async function checkDocumentationNavigation(browser, base, complete = false) {
  const ports = complete ? PORTS : PORTS.filter((port) => ['fsharp', 'ruby'].includes(port.slug))
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  try {
    for (const { slug } of ports) {
      const response = await page.goto(`${base}/${slug}/latest/`, { waitUntil: 'load' })
      assert(response?.ok(), `${slug}: documentation home responds`)
      const nav = page.locator('.sidebar-nav:visible')
      const sections = await nav.locator(':scope > details > summary > a').evaluateAll((links) =>
        links.map((link) => ({ label: link.textContent.trim(), href: link.getAttribute('href') })))
      assert.deepEqual(sections.map(({ label }) => label),
        PORTS.find((port) => port.slug === slug).parentLibrary
          ? ['Guides', 'Concepts', 'Examples'] : ['Guides', 'Concepts', 'Examples', 'Topics'],
        `${slug}: shared section names and reading order`)
      for (const { label, href } of sections) {
        assert.equal(await nav.locator('a').evaluateAll((links, href) => links.filter((link) =>
          link.getAttribute('href') === href).length, href), 1, `${slug}: ${label} has one section link`)
      }
      assert.equal(await nav.locator('details[open]').count(), 0, `${slug}: home has no unrelated expanded section`)
    }
    for (const slug of ['fsharp', 'ruby']) {
      await page.goto(`${base}/${slug}/latest/guides/`, { waitUntil: 'load' })
      assert.equal((await page.locator('main h1').textContent()).trim(), 'Guides')
      const nav = page.locator('.sidebar-nav:visible')
      const section = nav.locator('details').filter({ has: page.locator('summary > a', { hasText: /^Guides$/ }) })
      assert.equal(await section.evaluate((element) => element.open), true, `${slug}: current section starts open`)
      assert.deepEqual((await section.locator('.sidebar-link').allTextContents()).slice(0, 2)
        .map((label) => label.trim()), ['Getting started', 'Attaching to tmux'], `${slug}: setup leads the guides`)
      assert.equal(await nav.locator('a[href*="api-overview"]').count(), 0, `${slug}: no duplicate API guide`)
      const cards = page.locator('main .doc-card')
      assert.equal((await cards.first().locator('h3').textContent()).trim(), 'Getting started')
      await section.locator('summary > .api-nav__chevron').click()
      assert.equal(await section.evaluate((element) => element.open), false, `${slug}: chevron closes the drawer`)
      await section.locator('summary').focus()
      await page.keyboard.press('Enter')
      assert.equal(await section.evaluate((element) => element.open), true, `${slug}: keyboard opens the drawer`)
      await section.locator('.sidebar-link').first().click()
      await page.waitForURL(`${base}/${slug}/latest/guides/getting-started/`)
      const selected = page.locator('.sidebar-nav:visible a[aria-current="page"]')
      assert.equal((await selected.textContent()).trim(), 'Getting started')
      assert(await selected.isVisible(), `${slug}: current child remains visible`)
      const browse = slug === 'fsharp' ? 'Concepts' : 'Examples'
      await page.locator('.sidebar-nav:visible summary > a').filter({ hasText: new RegExp(`^${browse}$`) }).click()
      await page.waitForURL(`${base}/${slug}/latest/${browse.toLowerCase()}/`)
      assert.equal((await page.locator('main h1').textContent()).trim(), browse)
      assert.equal(await page.locator('main .doc-card').count(), slug === 'fsharp' ? 4 : 2,
        `${slug}: browse pages use the shared cards`)
    }
    const oldFsharp = `${base}/fsharp/latest/guides/api-overview/`
    await page.goto(`${oldFsharp}?from=bookmark`, { waitUntil: 'load' })
    await page.waitForURL(`${base}/fsharp/latest/reference/?from=bookmark`)
    assert.equal((await page.locator('main h1').textContent()).trim(), 'API reference',
      'The current portal already identifies the API language')
    assert.equal(await page.title(), 'F# API reference | libtmux', 'The browser title preserves language context')
    await page.goto(`${base}/ruby/latest/guides/overview/`, { waitUntil: 'load' })
    await page.waitForURL(`${base}/ruby/latest/guides/getting-started/`)
    console.log(`Documentation sections: ${ports.length} ports share ordered, unique section links; Ruby/F# setup, cards and legacy links pass`)
  } finally {
    await page.close()
  }

  if (!complete) return
  for (const javaScriptEnabled of [true, false]) {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ javaScriptEnabled, colorScheme, reducedMotion: 'reduce' })
      const reader = await context.newPage()
      reader.setDefaultTimeout(10000)
      try {
        if (javaScriptEnabled) await reader.addInitScript((scheme) => localStorage.setItem('color-scheme', scheme), colorScheme)
        for (const width of [390, 768, 1440]) {
          await reader.setViewportSize({ width, height: 900 })
          for (const slug of ['fsharp', 'ruby']) {
            const area = slug === 'fsharp' ? 'Concepts' : 'Guides'
            await reader.goto(`${base}/${slug}/latest/${area.toLowerCase()}/`, { waitUntil: 'load' })
            if (width < 1024) {
              if (javaScriptEnabled) await reader.locator('#mobile-sidebar-toggle').click()
              else await reader.locator('.mobile-fallback > details > summary').first().click()
            }
            const nav = reader.locator('.sidebar-nav:visible')
            const current = nav.locator('summary > a[aria-current="page"]')
            assert.equal((await current.textContent()).trim(), area, `${slug}/${width}: current section is identified`)
            const section = nav.locator('details').filter({ has: reader.locator('summary > a', { hasText: new RegExp(`^${area}$`) }) })
            assert.equal(await section.evaluate((element) => element.open), true)
            const summary = section.locator('summary')
            await summary.focus()
            await reader.keyboard.press('Space')
            assert.equal(await section.evaluate((element) => element.open), false, `${slug}/${width}: Space closes the drawer`)
            await reader.keyboard.press('Enter')
            assert.equal(await section.evaluate((element) => element.open), true)
            const geometry = await reader.evaluate(() => ({
              overflow: document.documentElement.scrollWidth - innerWidth,
              cards: [...document.querySelectorAll('main .doc-card')].map((card) => {
                const rect = card.getBoundingClientRect()
                return { left: rect.left, right: rect.right }
              }),
            }))
            assert(geometry.overflow <= 1, `${slug}/${width}/${colorScheme}/${javaScriptEnabled}: page fits`)
            assert(geometry.cards.every((card) => card.left >= 0 && card.right <= width + 1), `${slug}/${width}: cards fit`)
            const destination = slug === 'fsharp' ? 'Guides' : 'Examples'
            const target = nav.locator('summary > a').filter({ hasText: new RegExp(`^${destination}$`) })
            await target.focus()
            await reader.keyboard.press('Enter')
            await reader.waitForURL(`${base}/${slug}/latest/${destination.toLowerCase()}/`)
            if (width < 1024 && javaScriptEnabled) {
              assert.equal(await reader.locator('#mobile-sidebar-toggle').getAttribute('aria-expanded'), 'false',
                `${slug}/${width}: navigating closes the mobile drawer`)
            }
          }
        }
      } finally {
        await context.close()
      }
    }
  }
  console.log('Documentation drawers: mouse and keyboard navigation pass at phone/tablet/desktop widths, both themes, with and without JavaScript')
}

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

  const search = page.getByRole('searchbox', { name: 'Find a type or member' })
  const results = page.locator('[data-api-search-results]')
  await search.fill('Server:snapshot')
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  assert.equal(await page.locator('[role="tree"]').isVisible(), false)
  await page.locator('[data-api-search-kind="types"]').click()
  await page.waitForFunction(() => document.querySelector('[data-api-search-status]').textContent === '0 results')
  await page.locator('[data-api-search-kind="members"]').click()
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  await search.fill('Server snapshot')
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  await search.focus()
  await page.keyboard.press('ArrowDown')
  assert(await results.locator('a').first().evaluate((link) => link === document.activeElement))
  await page.keyboard.press('End')
  assert(await results.locator('a').last().evaluate((link) => link === document.activeElement))
  await page.keyboard.press('Home')
  assert(await results.locator('a').first().evaluate((link) => link === document.activeElement))
  await page.keyboard.press('Escape')
  assert(await search.evaluate((input) => input === document.activeElement))
  await page.keyboard.press('Escape')
  assert.equal(await search.inputValue(), '')
  assert(await page.locator('[role="tree"]').isVisible())
  await page.setViewportSize({ width: 390, height: 759 })
  await page.locator('[data-api-nav-toggle]').click()
  await search.fill('Server:snapshot')
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  assert.equal(await page.locator('[role="tree"]').isVisible(), false, 'Phone search replaces the tree')
  await page.locator('[data-api-nav-close]').click()
  await page.route('**/tree.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.reload()
  await page.locator('[data-api-nav-toggle]').click()
  await search.fill('Server:snapshot')
  await page.waitForFunction(() => document.querySelector('[data-api-search-status]').textContent.includes('could not load'))
  await page.unroute('**/tree.json')
  await page.getByRole('button', { name: 'Retry search' }).click()
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  console.log('API search: full member names, category filters, keyboard focus, phone layout and visible retryable failures pass')
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
