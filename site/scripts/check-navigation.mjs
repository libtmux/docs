import assert from 'node:assert/strict'
import { PORTS, productAvailable } from '../src/lib/ports.ts'
import { checkPickerFilters } from './check-picker-filters.mjs'

/** Optional scripts injected at the end of the body cannot gate navigation. */
export async function checkNavigationBeforeAnalytics(browser, base) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(5000)
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  const url = `${base}/tmux/concepts/server-session-window-pane/`
  const analytics = `${base}/pending-analytics.js`
  let release
  const pending = new Promise((resolve) => { release = resolve })
  let requested = false
  let completed = false
  await page.route(analytics, async (route) => {
    requested = true
    await pending
    await route.fulfill({ contentType: 'text/javascript', body: '' })
    completed = true
  })
  await page.route(url, async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    assert(body.includes('</body>'), 'The real documentation page has a body')
    await route.fulfill({ response, body: body.replace('</body>',
      `<script type="module" src="${analytics}"></script></body>`) })
  })
  try {
    await page.goto(url, { waitUntil: 'commit' })
    const visibility = await page.evaluate(async () => {
      if (document.readyState === 'loading') {
        await new Promise((resolve) => document.addEventListener('readystatechange', resolve, { once: true }))
      }
      await document.fonts.ready
      return getComputedStyle(document.body).visibility
    })
    assert.equal(visibility, 'visible', 'Loaded fonts reveal the page while analytics and the fallback timer are still pending')
    await page.clock.resume()
    const picker = page.locator('[data-surface-picker][data-enhanced]')
    await picker.waitFor({ state: 'visible' })
    await picker.locator(':scope > summary').focus()
    await page.keyboard.press('Enter')
    const search = picker.locator('[data-surface-search]')
    await search.waitFor({ state: 'visible' })
    assert(await search.evaluate((input) => input === document.activeElement), 'Picker search receives keyboard focus')
    await page.keyboard.press('Escape')
    assert.equal(await picker.getAttribute('open'), null, 'Escape closes the picker')
    assert(await picker.locator(':scope > summary').evaluate((node) => node === document.activeElement), 'Picker returns focus')
    const drawer = page.locator('#mobile-sidebar-toggle')
    await drawer.click()
    assert.equal(await drawer.getAttribute('aria-expanded'), 'true', 'Mobile navigation opens')
    await page.keyboard.press('Escape')
    assert.equal(await drawer.getAttribute('aria-expanded'), 'false', 'Escape closes mobile navigation')
    assert(await drawer.evaluate((node) => node === document.activeElement), 'Mobile navigation returns focus')
    assert(requested && !completed, 'Navigation works while the injected analytics module is still pending')
    assert.equal(await page.evaluate(() => document.readyState), 'interactive', 'Navigation does not await document load')
    console.log('Navigation: picker and mobile drawer work before pending analytics completes')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
    await page.close()
  }
}

async function checkNoticeAlignment(page, centered = false) {
  const { noticeLeft, contentLeft, artworkLeft } = await page.evaluate((landing) => {
    const badge = document.querySelector('.prerelease-notice__badge')
    const content = document.querySelector(landing ? 'main' : '.site-header__mark')
    const artwork = document.querySelector('[data-documentation-context] [data-surface-picker] > summary .surface-artwork')
    return {
      noticeLeft: badge.getBoundingClientRect().left,
      contentLeft: content.getBoundingClientRect().left + (landing ? parseFloat(getComputedStyle(content).paddingLeft) : 0),
      artworkLeft: artwork?.getBoundingClientRect().left,
    }
  }, centered)
  assert(Math.abs(noticeLeft - contentLeft) <= 1, `${page.url()}: notice at ${noticeLeft}px aligns with ${centered ? 'landing content' : 'documentation header'} at ${contentLeft}px`)
  if (artworkLeft !== undefined) {
    assert(Math.abs(noticeLeft - artworkLeft) <= 1, `${page.url()}: notice at ${noticeLeft}px aligns with documentation artwork at ${artworkLeft}px`)
  }
}

async function checkContextControls(page) {
  // Native view transitions temporarily route hit testing to the root element.
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-astro-transition'))
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('[data-documentation-context]')
    const controls = [...bar.querySelectorAll('.doc-picker > summary, .documentation-context-navigation > button, [data-context-settings-toggle], [data-context-settings-back]')]
      .map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        const hit = document.elementFromPoint(x + width / 2, y + height / 2)
        return { name: element.getAttribute('aria-label') ?? element.textContent.trim(), x, y, width, height,
          selector: element.matches('.documentation-context-selectors .doc-picker > summary'),
          reachable: element.contains(hit), coveredBy: hit?.outerHTML.slice(0, 180) }
      }).filter(({ width, height }) => width > 0 && height > 0)
    return { height: bar.getBoundingClientRect().height, controls }
  })
  for (const [index, control] of layout.controls.entries()) {
    if (control.selector) assert.equal(control.height, 36, `${page.url()}: ${control.name} matches the homepage's 36px controls`)
    assert(control.reachable, `${page.url()}: context control is reachable: ${JSON.stringify(control)}`)
    for (const other of layout.controls.slice(index + 1)) {
      const overlap = Math.min(control.x + control.width, other.x + other.width) - Math.max(control.x, other.x)
      assert(overlap <= 1, `${page.url()}: ${control.name} and ${other.name} do not overlap`)
    }
  }
  assert(layout.height <= 58, `${page.url()}: context remains a single compact row`)
}

/** Narrow settings use the existing bar and preserve a keyboard return path. */
export async function checkContextSettings(page, javaScriptEnabled = true) {
  const context = page.locator('[data-documentation-context]')
  const toggle = context.locator('[data-context-settings-toggle]')
  const settings = context.locator('[data-context-settings]')
  const back = context.locator('[data-context-settings-back]')
  const navigation = context.locator('.documentation-context-navigation > button')
  const compact = await page.evaluate(() => matchMedia('(max-width: 24rem)').matches)
  assert.equal(await toggle.isVisible(), javaScriptEnabled && compact, 'The cog appears on enhanced narrow screens')
  if (!await toggle.isVisible()) {
    assert(await settings.isVisible(), 'Version and locale remain directly available without compact enhancement')
    return
  }
  for (const button of await navigation.all()) assert(!await button.isVisible(), 'Narrow navigation controls live in the cog view')
  const before = await context.boundingBox()
  await toggle.focus()
  await page.keyboard.press('Enter')
  assert(await settings.isVisible(), 'Cog opens version and locale in the bar')
  assert(!await context.locator('[data-surface-picker] > summary').isVisible(), 'Settings replace the primary controls')
  assert(await back.evaluate((button) => button === document.activeElement), 'Settings focus Back')
  const after = await context.boundingBox()
  assert(Math.abs(before.height - after.height) <= 1 && before.width === after.width, 'Settings stay within the same container')
  await checkContextControls(page)
  for (const button of await navigation.all()) {
    assert(await button.isVisible(), 'The cog view exposes navigation controls')
    await button.click()
    assert.equal(await button.getAttribute('aria-expanded'), 'true', 'Navigation opens from the cog view')
    await page.keyboard.press('Escape')
    assert.equal(await button.getAttribute('aria-expanded'), 'false', 'Escape closes navigation')
    assert(await settings.isVisible(), 'Closing navigation returns to the cog view')
    assert(await button.evaluate((control) => control === document.activeElement), 'Closing navigation restores its control focus')
  }
  const version = settings.locator('[data-version-picker]')
  await version.locator(':scope > summary').click()
  await version.locator('[data-picker-panel]').waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  assert(await settings.isVisible(), 'First Escape dismisses the picker without leaving settings')
  await page.keyboard.press('Escape')
  assert(!await settings.isVisible(), 'Second Escape returns to the primary view')
  assert(await toggle.evaluate((button) => button === document.activeElement), 'Returning restores focus to the cog')
  await toggle.click()
  await back.click()
  assert(!await settings.isVisible(), 'Back returns to the primary view')
  assert(await page.locator('.site-header-language [data-page-port-switcher] > summary').isVisible(), 'The language picker remains available in the top bar')
  const drawerButton = (await navigation.all())[0]
  if (drawerButton) {
    const viewport = page.viewportSize()
    await page.setViewportSize({ ...viewport, width: 641 })
    await drawerButton.click()
    await page.setViewportSize(viewport)
    await context.locator(':scope[data-settings-open]').waitFor()
    await page.keyboard.press('Escape')
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert(await drawerButton.isVisible(), 'Resizing an open drawer keeps its return control visible')
    assert(await drawerButton.evaluate((button) => button === document.activeElement), 'Drawer return focus survives a resize into compact mode')
    await back.click()
  }
}

/** Surface selection changes the page tree without losing the port or version. */
export async function checkDocumentationNavigation(browser, base, complete = false) {
  await checkPickerFilters(browser, base, complete)
  await checkNavigationBeforeAnalytics(browser, base)
  const ports = complete ? PORTS : PORTS.filter((port) => ['fsharp', 'ruby'].includes(port.slug))
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  await observeInitialPageLoad(page)
  const desktopPicker = (reader) => reader.locator('[data-documentation-context] [data-surface-picker]')
  const group = (picker, label) => picker.locator('[data-surface-group]').filter({
    has: picker.page().locator('summary strong', { hasText: new RegExp(`^${label}$`) }),
  })
  const openPicker = async (picker, enhanced = true) => {
    await picker.locator(':scope > summary').click()
    if (enhanced) {
      const search = picker.locator('[data-surface-search]')
      await search.waitFor({ state: 'visible' })
      assert(await search.evaluate((element) => element === document.activeElement), 'Opening the picker focuses search')
    }
  }
  try {
    await page.goto(`${base}/`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    await checkNoticeAlignment(page, true)
    for (const port of ports) {
      const { slug, parentLibrary } = port
      const response = await page.goto(`${base}/${slug}/latest/`, { waitUntil: 'load' })
      assert(response?.ok(), `${slug}: documentation home responds`)
      await checkNoticeAlignment(page)
      assert.equal(await page.locator('[data-page-toolbar]').count(), 0, `${slug}: home has no redundant breadcrumb/action row`)
      assert.equal(await page.locator('.port-hero h1').count(), 1, `${slug}: one port heading`)
      const picker = desktopPicker(page)
      await picker.locator(':scope > summary').waitFor({ state: 'visible' })
      assert.equal((await picker.locator('.surface-current').innerText()).replace(/\s+/g, ' ').trim(), 'Core Library Home')
      await openPicker(picker)
      const core = group(picker, 'Core Library')
      const sections = await core.locator('.surface-options a').evaluateAll((links) =>
        links.map((link) => ({ label: link.textContent.trim().replace(/\s*✓$/, ''), href: link.getAttribute('href') })))
      for (const label of ['Home', 'Guides', 'Concepts', 'Examples', 'API Reference']) {
        assert.equal(sections.filter((section) => section.label === label).length, 1,
          `${slug}: ${label} has one real destination`)
      }
      assert(sections.every(({ href }) => href.startsWith(`${new URL(base).pathname}/${slug}/latest/`)),
        `${slug}: sections retain the selected port and version`)
      const names = await picker.locator('[data-surface-group] > summary strong').allTextContents()
      assert.equal(names[0], 'Core Library', `${slug}: the library is the default surface`)
      const appNames = parentLibrary ? [] : [
        ...(productAvailable(port, 'mcp') ? ['MCP'] : []),
        ...(productAvailable(port, 'workspace') ? ['Workspace Manager'] : []),
      ]
      assert.deepEqual(names.slice(1).sort(), appNames, `${slug}: only available applications appear`)
      assert.equal(await picker.locator('[data-surface-option]:not(a[href])').count(), 0,
        `${slug}: every section has a real destination`)
      assert.equal(await picker.getByText('Navigation preview').count(), 0, `${slug}: no empty section placeholders`)
      await page.keyboard.press('Escape')
      assert.equal(await picker.getAttribute('open'), null)
    }
    for (const slug of ['fsharp', 'ruby']) {
      await page.goto(`${base}/${slug}/latest/guides/`, { waitUntil: 'load' })
      assert.equal((await page.locator('main h1').textContent()).trim(), 'Guides')
      const nav = page.locator('.sidebar-nav:visible')
      assert.equal(await nav.getByRole('link', { name: 'Overview', exact: true }).getAttribute('href'), `${new URL(base).pathname}/${slug}/latest/guides/`)
      const guideLinks = nav.locator('a').filter({ hasNotText: /^\s*Overview\s*$/ })
      assert.deepEqual((await guideLinks.allTextContents()).slice(0, 2).map((label) => label.trim()),
        ['Getting started', 'Attaching to tmux'], `${slug}: setup leads the guides`)
      assert.equal(await nav.locator('a[href*="api-overview"]').count(), 0, `${slug}: no duplicate API guide`)
      assert.equal((await page.locator('main .doc-card').first().locator('h3').textContent()).trim(), 'Getting started')
      await guideLinks.first().click()
      await page.waitForURL(`${base}/${slug}/latest/guides/getting-started/`)
      const selected = page.locator('.sidebar-nav:visible a[aria-current="page"]')
      assert.equal((await selected.textContent()).trim(), 'Getting started')
      assert(await selected.isVisible(), `${slug}: current child remains visible`)
      const browse = slug === 'fsharp' ? 'Concepts' : 'Examples'
      const picker = desktopPicker(page)
      await openPicker(picker)
      await group(picker, 'Core Library').getByRole('link', { name: browse, exact: true }).click()
      await page.waitForURL(`${base}/${slug}/latest/${browse.toLowerCase()}/`)
      assert.equal((await page.locator('main h1').textContent()).trim(), browse)
      assert.equal(await page.locator('main .doc-card').count(), slug === 'fsharp' ? 4 : 2,
        `${slug}: browse pages use the shared cards`)
    }
    await page.goto(`${base}/fsharp/latest/guides/api-overview/?from=bookmark`, { waitUntil: 'load' })
    await page.waitForURL(`${base}/fsharp/latest/reference/?from=bookmark`)
    assert.equal((await page.locator('main h1').textContent()).trim(), 'API reference')
    assert.equal(await page.title(), 'F# API reference | libtmux-fsharp')
    await page.goto(`${base}/ruby/latest/guides/overview/`, { waitUntil: 'load' })
    await page.waitForURL(`${base}/ruby/latest/guides/getting-started/`)
    console.log(`Documentation surfaces: ${ports.length} ports retain real section links; Ruby/F# setup, cards and legacy links pass`)
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
        for (const width of [320, 390, 641, 768, 1440, 1920]) {
          await reader.setViewportSize({ width, height: 900 })
          await reader.goto(`${base}/go/latest/workspace/`, { waitUntil: 'load' })
          await checkNoticeAlignment(reader)
          await checkContextControls(reader)
          await checkContextSettings(reader, javaScriptEnabled)
          const picker = desktopPicker(reader)
          const layout = await reader.evaluate(() => {
            const bounds = (selector) => {
              const visible = [...document.querySelectorAll(selector)].find((node) => node.checkVisibility())
              const { top, bottom, height, width } = visible.getBoundingClientRect()
              return { top, bottom, height, width }
            }
            return { bar: bounds('[data-documentation-context]'), surface: bounds('[data-surface-picker] > summary'),
              port: bounds('[data-page-port-switcher] > summary'), header: ['.site-header__search', '.scheme-switch, .scheme-cycle', '.site-header__menu-button'].map(bounds) }
          })
          assert(layout.bar.height <= 58, `${width}: context remains a single compact row`)
          assert(Math.abs((layout.surface.top + layout.surface.bottom) - (layout.port.top + layout.port.bottom)) <= 1,
            `${width}: surface and context controls are vertically centered`)
          assert(layout.surface.width >= 60, `${width}: the surface trigger remains usable`)
          assert(layout.header.every((item) => Math.abs(item.height - layout.header[0].height) < .1
            && Math.abs(item.top - layout.header[0].top) < .1), `${width}: Search, scheme and menu have equal heights`)
          assert.equal((await picker.locator('.surface-current').innerText()).replace(/\s+/g, ' ').trim(), 'Workspace Manager Home')
          await openPicker(picker, javaScriptEnabled)
          if (javaScriptEnabled) {
            const search = picker.locator('[data-surface-search]')
            await search.fill('no-such-documentation')
            assert(await picker.locator('[data-surface-empty]').isVisible(), 'Unknown searches show an empty state')
            await search.fill('mcp guides')
            const links = picker.locator('a[data-surface-option]:visible')
            assert.equal(await links.count(), 1, 'Search matches both the surface and section')
            assert.equal(await links.first().getAttribute('href'), `${new URL(base).pathname}/go/latest/mcp/guides/`)
            await search.press('ArrowDown')
            assert(await links.first().evaluate((link) => link === document.activeElement), 'ArrowDown reaches a result')
            await reader.keyboard.press('Escape')
            assert.equal(await picker.getAttribute('open'), null, 'Escape closes the picker')
            await openPicker(picker)
            await search.fill('workspace guides')
          }
          const panel = await picker.locator('[data-surface-panel]').boundingBox()
          const usableWidth = await reader.evaluate(() => document.documentElement.clientWidth)
          assert(panel.x >= 0 && panel.x + panel.width <= usableWidth + 1, `${width}/${colorScheme}: picker fits beside the scrollbar`)
          if (javaScriptEnabled) assert(panel.y >= 0 && panel.y + panel.height <= 901, `${width}: floating picker fits vertically`)
          const target = group(picker, 'Workspace Manager').getByRole('link', { name: 'Guides', exact: true })
          if (javaScriptEnabled) await picker.locator('[data-surface-search]').press('Enter')
          else { await target.focus(); await reader.keyboard.press('Enter') }
          await reader.waitForURL(`${base}/go/latest/workspace/guides/`)
          assert.equal((await reader.locator('main h1').textContent()).trim(), 'Guides', 'Guides has a real browse page')
          assert(await reader.locator('main .doc-card').count() >= 5, 'Workspace guides show task cards')
          if (width < 1024 && javaScriptEnabled) assert.equal(await reader.locator('#mobile-sidebar-toggle').getAttribute('aria-expanded'), 'false',
            'Changing sections closes the mobile drawer')
          if (javaScriptEnabled) {
            if (width < 1024) {
              const settings = reader.locator('[data-context-settings-toggle]')
              if (await settings.isVisible()) await settings.click()
              await reader.locator('#mobile-sidebar-toggle').click()
            }
            const search = reader.locator('[data-section-search]:visible')
            await search.fill('troubleshoot')
            const links = reader.locator('.sidebar-nav:visible a:visible')
            assert.equal(await links.count(), 1, 'Section search filters its own pages')
            assert((await links.first().getAttribute('href')).endsWith('/workspace/guides/troubleshooting/'))
            await search.fill('')
            assert(await links.count() > 1, 'Clearing search restores the page list')
          }
          await reader.goBack()
          await reader.waitForURL(`${base}/go/latest/workspace/`)
          await reader.goForward()
          await reader.waitForURL(`${base}/go/latest/workspace/guides/`)
          assert(await reader.locator('[data-surface-picker] > summary').first().getAttribute('aria-label').then((label) => label.endsWith('Workspace Manager, Guides')),
            'History restores the selected surface and section')
          assert(await reader.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: page has no horizontal overflow`)
          await openPicker(picker, javaScriptEnabled)
          if (javaScriptEnabled) await picker.locator('[data-surface-search]').fill('')
          const core = group(picker, 'Core Library')
          if (!(await core.evaluate((element) => element.open))) await core.locator(':scope > summary').click()
          await core.getByRole('link', { name: 'API Reference', exact: true }).click()
          await reader.waitForURL(`${base}/go/latest/reference/`)
          await checkNoticeAlignment(reader)
          await checkContextControls(reader)
          assert(await reader.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}: reference has no horizontal overflow`)
          if (width === 320 || width === 1920) {
            await reader.goto(`${base}/`, { waitUntil: 'load' })
            await checkNoticeAlignment(reader, true)
          }
        }
      } finally {
        await context.close()
      }
    }
  }
  console.log('Surface picker: search, keyboard, history and scoped page lists pass on phone/tablet/desktop, both themes and without JavaScript')
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
    const menu = page.locator('[data-documentation-context] [data-surface-picker]')
    assert(await menu.locator(':scope > summary').isVisible(), 'Documentation context is available above the closed API drawer')
    await menu.locator(':scope > summary').click()
    assert.equal(await menu.evaluate((el) => el.open), true)
    await page.keyboard.press('Escape')
    assert.equal(await menu.evaluate((el) => el.open), false)
  }
  for (const path of ['', 'guides/overview/']) {
    const response = await page.goto(`${base}/lua/latest/${path}`, { waitUntil: 'load' })
    assert(response?.ok(), `Lua ${path || 'home'}: HTTP ${response?.status()}`)
    await page.waitForFunction(() => window.__docsPageLoaded)
    const picker = page.locator('[data-documentation-context] [data-surface-picker]')
    await picker.locator(':scope > summary').click()
    await picker.locator('a[href$="/lua/latest/reference/"]').click()
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

/** Public symbol fragments and earlier declaration links reach the same bar. */
export async function checkApiAnchorArrival(browser, base) {
  const paths = new Set([`${base}/py/latest/reference/libtmux-_internal-query_list-querylist/`])
  const catalog = await browser.newPage()
  try {
    for (const port of PORTS) {
      await catalog.goto(`${base}/${port.slug}/latest/reference/`, { waitUntil: 'load' })
      const href = await catalog.locator('.api-index-card__link').first().getAttribute('href')
      assert(href, `${port.slug}: the reference index links a real declaration`)
      paths.add(new URL(href, base).href)
    }
  } finally {
    await catalog.close()
  }
  for (const [width, colorScheme, javaScriptEnabled] of [
    [390, 'light', true], [1280, 'dark', true],
    [390, 'dark', false], [1280, 'light', false],
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme,
      javaScriptEnabled, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    try {
      for (const path of paths) {
        const response = await page.goto(path, { waitUntil: 'load' })
        assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
        const declaration = page.locator('dt.gp-sphinx-api-header').first()
        const href = await declaration.locator('a.headerlink').getAttribute('href')
        const identity = href.slice(1)
        const idleColor = await declaration.evaluate((element) => getComputedStyle(element).backgroundColor)
        assert.equal(await declaration.getAttribute('id'), identity, `${path}: the symbol link reaches its declaration`)
        for (const fragment of [identity, `${identity}.declaration`]) {
          await page.goto(`${path}#${encodeURIComponent(fragment)}`, { waitUntil: 'load' })
          await page.evaluate(() => document.fonts.ready)
          if (javaScriptEnabled) await page.waitForFunction((id) =>
            document.getElementById(id)?.hasAttribute('data-anchor-arrival'), identity)
          const arrival = await declaration.evaluate((element, fragment) => {
            const rect = element.getBoundingClientRect()
            return { ownsFragment: element.contains(document.getElementById(fragment)),
              target: element.matches(':target, :has(> .section-anchor-alias:target)'),
              color: getComputedStyle(element).backgroundColor, top: rect.top,
              header: document.querySelector('.site-header').getBoundingClientRect().bottom,
              viewport: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth }
          }, fragment)
          assert(arrival.ownsFragment && arrival.target, `${path}: ${fragment} targets the declaration`)
          assert(arrival.color !== idleColor && arrival.color !== 'rgba(0, 0, 0, 0)' && arrival.color !== 'transparent',
            `${path}#${fragment}: arrival changes the declaration background`)
          assert(arrival.top >= arrival.header - 1 && arrival.top < arrival.viewport && arrival.overflow <= 1,
            `${path}#${fragment} at ${width}px (JavaScript ${javaScriptEnabled}): the declaration is visible below the header without overflow: ${JSON.stringify(arrival)}`)
        }
      }
    } finally {
      await context.close()
    }
  }
  console.log(`API anchors: ${paths.size} declarations across ${PORTS.length} ports, primary and retained fragments, phone/desktop, both themes and no-JavaScript navigation pass`)
}

/** Check the controls attached to a document after its content is replaced. */
export async function checkNavigation(page, base) {
  await observeInitialPageLoad(page)
  await page.goto(`${base}/tmux/examples/attach-and-send-keys/`, { waitUntil: 'load' })
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
  const example = page.locator('main').getByRole('link').filter({
    has: page.getByRole('heading', { name: 'Attach and send keys', exact: true }),
  })
  await example.click()
  await page.waitForFunction(() => window.__navigationProbe?.loads === 2)
  assert.match(page.url(), /\/examples\/attach-and-send-keys\/$/)
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
        const current = sidebar.locator('a[aria-current="page"]')
        assert.equal(await current.getAttribute('href'), `${prefix}examples/capture-pane-output/`,
          `${port} ${version} at ${width}px: the section menu identifies the current example`)
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
    'Readers can still switch ports from the documentation context')
  console.log('Reference examples: TypeScript examples stay visible without other languages')
}
