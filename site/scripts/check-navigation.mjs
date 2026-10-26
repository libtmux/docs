import assert from 'node:assert/strict'
import { PORTS, productAvailable, productStatus } from '../src/lib/ports.ts'
import registry from '../src/data/registry.json' with { type: 'json' }
import mcpCatalogs from '../src/data/mcp-tools.json' with { type: 'json' }
import { checkPickerFilters } from './check-picker-filters.mjs'

/** The version the dev build mounts a port's prose pages at: its default, as check-dev sets it. */
const defaultVersion = (port) => JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}')[port] ?? 'latest'

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
      `<script type="module" data-cf-beacon="{}" src="${analytics}"></script></body>`) })
  })
  try {
    await page.goto(url, { waitUntil: 'commit' })
    await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
    const readiness = await page.evaluate(() => {
      const root = document.documentElement
      return { visibility: getComputedStyle(document.body).visibility,
        suppressed: root.classList.contains('link-hints-suppressed') }
    })
    assert.equal(readiness.suppressed, false, 'Actual icon readiness succeeds while the page clock is frozen')
    assert.equal(readiness.visibility, 'visible', 'Loaded fonts and icons reveal the page while analytics is pending')
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
  await page.locator('[data-documentation-context] :is(.doc-picker > summary, [data-context-settings-toggle], [data-context-settings-back]):visible')
    .first().click({ trial: true })
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
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  await observeInitialPageLoad(page)
  const desktopPicker = (reader) => reader.locator('[data-documentation-context] [data-surface-picker]')
  const group = (picker, label) => picker.locator('[data-surface-group]').filter({
    has: picker.page().locator('summary .surface-label', { hasText: new RegExp(`^${label}$`) }),
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
      assert.equal((await picker.locator('.surface-current .surface-label, .surface-current small').allInnerTexts()).join(' '), 'Core Library Home')
      assert.equal(await picker.locator('.surface-current .status-badge').getAttribute('data-status'), productStatus(port, 'core', registry), `${slug}: the trigger states the library's status`)
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
      const groups = picker.locator('[data-surface-group]')
      const names = await groups.locator(':scope > summary .surface-label').allTextContents()
      assert.equal(names[0], 'Core Library', `${slug}: the library is the default surface`)
      const appNames = parentLibrary ? [] : [
        ...(productAvailable(port, 'mcp') ? ['MCP'] : []),
        ...(productAvailable(port, 'workspace') ? ['Workspace Manager'] : []),
      ]
      assert.deepEqual(names.slice(1).sort(), appNames, `${slug}: only available applications appear`)
      // A badge is the group's sibling, never inside its summary.
      const badgeOf = (entry) => entry.locator('xpath=..').locator(':scope > .status-toggletip > .status-badge')
      assert.equal(await core.locator('.status-badge').count(), 0, `${slug}: no badge inside the core summary`)
      assert.equal(await badgeOf(core).getAttribute('data-status'), productStatus(port, 'core', registry), `${slug}: core states its release stage`)
      assert.notEqual(await badgeOf(core).getAttribute('data-status'), 'concept', `${slug}: core has no example scope badge`)
      for (const label of appNames) {
        const app = group(picker, label)
        const badge = badgeOf(app)
        assert.equal(await badge.count(), 1, `${slug}: ${label} badge`)
        assert.equal(await badge.getAttribute('data-status'), productStatus(port, label === 'MCP' ? 'mcp' : 'workspace', registry), `${slug}: ${label} status`)
        if (slug !== 'py') {
          await app.locator(':scope > summary').click()
          assert.equal(await app.locator('.surface-concept-description').count(), 0, `${slug}: expanding a companion adds no paragraph`)
          await app.locator(':scope > summary').click()
        }
      }
      const catalog = appNames.includes('MCP') ? mcpCatalogs.ports[slug] : undefined
      const emptySections = catalog ? [
        ...(catalog.registrations.length ? [] : ['Tools']),
        ...(catalog.protocol.prompts.length ? [] : ['Prompts']),
        ...(catalog.protocol.resources.length || catalog.protocol.resourceTemplates.length ? [] : ['Resources']),
      ] : []
      const disabled = await picker.locator('[data-surface-option]:not(a[href])').evaluateAll((items) =>
        items.map((item) => ({ label: item.textContent.trim(), role: item.getAttribute('role'),
          disabled: item.getAttribute('aria-disabled'), title: item.getAttribute('title') })))
      assert.deepEqual(disabled, emptySections.map((label) => ({ label, role: 'link', disabled: 'true',
        title: `No ${label.toLowerCase()} advertised in the reference configuration` })),
      `${slug}: only empty protocol catalogs are disabled`)
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
      reader.setDefaultTimeout(process.env.CI ? 20000 : 10000)
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
              context: bounds('.documentation-context-selectors .doc-picker > summary, [data-context-settings-toggle]'), header: ['.site-header__search', '.scheme-switch, .scheme-cycle', '.site-header__menu-button'].map(bounds) }
          })
          assert(layout.bar.height <= 58, `${width}: context remains a single compact row`)
          assert(Math.abs((layout.surface.top + layout.surface.bottom) - (layout.context.top + layout.context.bottom)) <= 1,
            `${width}: surface and context controls are vertically centered`)
          assert(layout.surface.width >= 60, `${width}: the surface trigger remains usable`)
          assert(layout.header.every((item) => Math.abs(item.height - layout.header[0].height) < .1
            && Math.abs(item.top - layout.header[0].top) < .1), `${width}: Search, scheme and menu have equal heights`)
          assert.equal((await picker.locator('.surface-current .surface-label').innerText()).trim(), 'Workspace Manager')
          assert.equal((await picker.locator('.surface-current small').innerText()).trim(), 'Home')
          assert.equal(await picker.locator('.surface-current .status-badge[data-status="concept"]').count(), 1)
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

/** Observe the first visible appearance in every destination document. */
async function observeInitialPageLoad(page) {
  await page.addInitScript(() => {
    window.__docsPageLoaded = false
    document.addEventListener('libtmux:page-ready', () => { window.__docsPageLoaded = true }, { once: true })
    const observe = () => {
      if (document.querySelector('main h1') && getComputedStyle(document.body).visibility === 'visible') {
        window.__firstVisibleAppearance = {
          readiness: document.documentElement.dataset.pageReadiness,
          theme: document.documentElement.dataset.themeMode,
          cooldown: document.documentElement.dataset.mcpInstallCooldownEnabled,
        }
      } else requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
  })
}

/** Keep API controls and history usable across document navigation. */
export async function checkApiNavigation(page, base, { sabotage } = {}) {
  if (sabotage) await page.addInitScript(sabotage)
  await observeInitialPageLoad(page)
  const server = `${base}/lua/latest/reference/libtmux-server/`
  const snapshot = `${base}/lua/latest/reference/libtmux-server-snapshot/`
  for (const width of [688, 390]) {
    await page.setViewportSize({ width, height: 759 })
    await page.goto(server, { waitUntil: 'commit' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    await page.locator('[data-api-nav-toggle]').waitFor({ state: 'visible' })
    await page.evaluate(() => { window.__apiNavigationProbe = true })
    await page.locator('.api-member-link[href$="libtmux-server-snapshot/"]').click()
    await page.waitForURL(snapshot, { waitUntil: 'commit' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    assert.equal(await page.evaluate(() => window.__apiNavigationProbe), undefined, 'API navigation loads a new document')
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
      else {
        const overlay = page.locator('[data-api-nav-overlay]')
        const bounds = await overlay.boundingBox()
        assert(bounds, 'The open drawer exposes its dismissal overlay')
        await overlay.click({ position: { x: bounds.width - 2, y: 400 } })
      }
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${close}: API drawer closes`)
      await nav.waitFor({ state: 'hidden' })
      assert.equal(await page.evaluate(() => document.body.style.overflow), '')
    }
    await page.goBack({ waitUntil: 'commit' })
    await page.waitForURL(server, { waitUntil: 'commit' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    const menu = page.locator('[data-documentation-context] [data-surface-picker]')
    assert(await menu.locator(':scope > summary').isVisible(), 'Documentation context is available above the closed API drawer')
    await menu.locator(':scope > summary').click()
    assert.equal(await menu.evaluate((el) => el.open), true)
    await page.keyboard.press('Escape')
    assert.equal(await menu.evaluate((el) => el.open), false)
  }
  for (const path of ['', 'guides/overview/']) {
    const response = await page.goto(`${base}/lua/latest/${path}`, { waitUntil: 'commit' })
    assert(response?.ok(), `Lua ${path || 'home'}: HTTP ${response?.status()}`)
    await page.waitForFunction(() => window.__docsPageLoaded)
    const picker = page.locator('[data-documentation-context] [data-surface-picker]')
    await picker.locator(':scope > summary').click()
    await picker.locator('a[href$="/lua/latest/reference/"]').click()
    await page.waitForURL(`${base}/lua/latest/reference/`, { waitUntil: 'commit' })
    await page.locator('.api-index-card__link[href$="/reference/libtmux-server/"]').click()
    await page.waitForURL(server, { waitUntil: 'commit' })
    // URL arrival precedes completion of required appearance.
    await page.locator('[data-api-nav-toggle]').waitFor({ state: 'visible' })
    assert(await page.locator('[data-api-nav-toggle]').isVisible(), `${path || 'Port home'} to API keeps the drawer toggle`)
    await page.locator('[data-api-nav-toggle]').click()
    await page.locator('[data-api-nav-close]').click()
    await page.locator('#api-nav').waitFor({ state: 'hidden' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('#api-nav').waitFor({ state: 'visible' })
  assert.equal(await page.locator('#api-nav').evaluate((el) => el.inert), false)
  assert.equal(await page.locator('[data-api-nav-toggle]').isVisible(), false)
  console.log('API navigation: native documents, Back, drawer close controls, disclosure alignment and desktop pass')

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
  await page.evaluate(() => {
    const nav = document.querySelector('.api-nav')
    sessionStorage.removeItem(`libtmux:api-tree:${nav.dataset.base}`)
  })
  await page.route('**/tree.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.reload({ waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  await page.locator('[data-api-nav-toggle]').click()
  await search.fill('Server:snapshot')
  await page.waitForFunction(() => document.querySelector('[data-api-search-status]').textContent.includes('could not load'))
  await page.unroute('**/tree.json')
  await page.getByRole('button', { name: 'Retry search' }).click()
  await results.locator('a[href$="libtmux-server-snapshot/"]').waitFor()
  console.log('API search: full member names, category filters, keyboard focus, phone layout and visible retryable failures pass')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await search.fill('')
  await page.locator('[data-lazy="bucket:pane"]').focus()
  await page.keyboard.press('ArrowRight')
  await page.locator('[data-lazy="type:libtmux.Pane"]').focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('[data-lazy="type:libtmux.Pane"]')?.getAttribute('aria-expanded') === 'true')
  await page.locator('.api-nav__tree a[href$="/reference/libtmux-session/"]').click()
  await page.waitForURL(`${base}/lua/latest/reference/libtmux-session/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  assert.equal(await page.locator('[data-lazy="type:libtmux.Pane"]').getAttribute('aria-expanded'), 'true', 'Outline keeps other owners expanded across document navigation')
  const layout = async (mode) => {
    await page.locator('[data-api-actions] summary').click()
    await page.getByRole('radio', { name: mode, exact: true }).click()
    await page.waitForFunction((mode) => document.querySelector('.api-nav')?.dataset.presentation === mode, mode.toLowerCase())
  }
  await layout('Grouped')
  await page.reload({ waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  assert.equal(await page.locator('.api-nav').getAttribute('data-presentation'), 'grouped', 'A chosen layout survives reload')
  await page.locator('[data-api-owner]').click()
  await page.getByRole('combobox', { name: 'Filter types' }).fill('Window')
  await page.locator('[data-owner-id="libtmux.Window"]').click()
  await page.waitForURL(`${base}/lua/latest/reference/libtmux-window/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  assert.equal(await page.locator('.api-nav').getAttribute('data-symbol'), 'libtmux.Window', 'The picker navigates to the selected type')
  assert.equal(await page.locator('.api-nav').getAttribute('data-presentation'), 'grouped')

  await page.goto(`${base}/tmux/latest/manual/capture-pane/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  assert.equal(await page.locator('.api-nav').getAttribute('data-presentation'), 'grouped', 'The layout persists between a port and tmux CLI')
  await page.locator('[data-api-actions] summary').click()
  await page.getByRole('radio', { name: 'Grouped', exact: true }).focus()
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => document.querySelector('.api-nav').dataset.presentation === 'focus')
  assert.equal(await page.getByRole('radio', { name: 'Focus', exact: true }).evaluate((button) => button === document.activeElement), true, 'Arrow keys select and focus a layout')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('[data-api-actions] summary').evaluate((button) => button === document.activeElement), true)
  await page.locator('[data-api-owner]').click()
  await page.getByRole('combobox', { name: 'Filter sections' }).fill('Key bindings')
  await page.locator('[data-owner-id="section:key-bindings"]').click()
  await page.waitForURL(`${base}/tmux/latest/manual/#key-bindings`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded && document.querySelector('.api-nav')?.dataset.symbol === 'section:key-bindings')
  assert.equal(await page.locator('.api-nav__tree [aria-current="page"]').count(), 1, 'A manual section has one selected row')
  await page.setViewportSize({ width: 390, height: 759 })
  await page.locator('[data-api-nav-toggle]').click()
  await layout('Outline')
  assert.equal(await page.locator('.api-nav').getAttribute('role'), 'dialog')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.api-nav').evaluate((nav) => nav.inert), true, 'The CLI drawer dismisses with Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.route('**/tree.json', (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto(`${base}/lua/latest/reference/`, { waitUntil: 'commit' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  assert.equal(await page.locator('.api-nav__tree [role="treeitem"][tabindex="0"]').count(), 1, 'The server-rendered index remains keyboard reachable when its inventory cannot load')
  await page.unroute('**/tree.json')
  console.log('Sidebar layouts: persisted choice, native type navigation, radio keyboard controls and tmux section/mobile navigation pass')
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
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
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

/** The control for `checkApiNavigation`: a drawer whose close button does nothing must fail it. */
export async function checkApiNavigationFail(browser, base) {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  try {
    await assert.rejects(() => checkApiNavigation(page, base, { sabotage: () => {
      document.addEventListener('click', (event) => {
        if (event.target.closest('[data-api-nav-close]')) event.stopImmediatePropagation()
      }, true)
    } }), /button: API drawer closes/, 'The navigation check detects a broken close button')
  } finally { await page.close() }
}

/**
 * The tmux manual's sidebar in each layout: controls stay reachable and the column ends at the footer
 * while the page scrolls, and the highlighted section follows the one being read. `sabotage` adds a
 * style to the page, for the control below.
 */
export async function checkReferenceSidebarBounds(browser, base, { sabotage } = {}) {
  const page = await browser.newPage({ viewport: { width: 1233, height: 1220 }, reducedMotion: 'reduce', colorScheme: 'dark' })
  try {
    await page.goto(`${base}/tmux/latest/manual/#options`)
    await page.locator('html[data-page-readiness="ready"]').waitFor()
    await page.locator('.api-nav[data-presentation-ready="true"]').waitFor()
    if (sabotage) await page.addStyleTag({ content: sabotage })
    for (const mode of ['outline', 'focus', 'grouped']) {
      await page.locator('[data-api-actions] > summary').click()
      await page.getByRole('radio', { name: mode, exact: false }).click()
      await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }) })
      await page.waitForFunction(() => {
        const nav = document.querySelector('.api-nav').getBoundingClientRect()
        return Math.abs(nav.top - document.querySelector('.site-header').getBoundingClientRect().bottom) < 1
      }, undefined, { timeout: 1000 })
      const bounds = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect()
        const search = rect('.api-nav__search'), picker = rect('[data-api-owner]')
        return { nav: rect('.api-nav').toJSON(), column: rect('.api-nav-column').toJSON(), footer: rect('footer').toJSON(),
          searchVisible: document.querySelector('.api-nav__search').contains(document.elementFromPoint(search.x + search.width / 2, search.y + search.height / 2)),
          pickerVisible: document.querySelector('[data-api-owner]').contains(document.elementFromPoint(picker.x + picker.width / 2, picker.y + picker.height / 2)) }
      })
      assert(bounds.searchVisible && bounds.pickerVisible, `${mode}: sidebar controls remain reachable at the footer`)
      assert(Math.abs(bounds.column.bottom - bounds.footer.top) < 1, `${mode}: sidebar column meets the footer: ${JSON.stringify(bounds)}`)
      assert(bounds.nav.bottom <= bounds.footer.top + 1, `${mode}: navigation does not cover the footer`)
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
      await page.waitForFunction(() => document.querySelector('.api-nav').dataset.symbol === 'section:clients-and-sessions', undefined, { timeout: 1000 })
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      await page.waitForFunction(() => document.querySelector('.api-nav').dataset.symbol === 'section:options', undefined, { timeout: 1000 }).catch(() => {})
      assert.equal(await page.locator('.api-nav').getAttribute('data-symbol'), 'section:options', `${mode}: sidebar follows the last visible section`)
    }
    await page.setViewportSize({ width: 1233, height: 760 })
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForFunction(() => {
      const nav = document.querySelector('.api-nav').getBoundingClientRect()
      return nav.top >= document.querySelector('.site-header').getBoundingClientRect().bottom - 1 && nav.bottom <= innerHeight
    }, undefined, { timeout: 1000 })
    console.log('Reference sidebar: controls stay pinned, tree fits above footer, and sections follow scrolling in all layouts')
  } finally { await page.close() }
}

/** The controls for `checkReferenceSidebarBounds`: a column pushed off the footer and a hidden last section must each fail it. */
export async function checkReferenceSidebarBoundsFail(browser, base) {
  for (const [sabotage, failure] of [
    ['.api-nav-column { margin-bottom: 40px !important; }', /sidebar column meets the footer/],
    ['h2#options { display: none !important; }', /sidebar follows the last visible section/],
  ]) await assert.rejects(() => checkReferenceSidebarBounds(browser, base, { sabotage }), failure,
    'The sidebar check detects broken footer alignment and section tracking')
}

/**
 * Sticky Members and group bars in a real engine. Mocked geometry cannot show
 * where a browser aligns a sticky heading or whether the bars cover focus, so
 * this check drives the production reference page. `only` limits the scenarios
 * and `sabotage` adds a script or style to every page, for the control below.
 */
export async function checkApiStickyHeadings(browser, base, { only, sabotage } = {}) {
  const engine = browser.browserType().name()
  const path = `${base}/swift/latest/reference/server/`
  const timeout = process.env.CI ? 20000 : 10000
  const wants = (scenario) => !only || only.includes(scenario)
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport })
    if (sabotage?.script) await context.addInitScript(sabotage.script)
    const page = await context.newPage()
    page.setDefaultTimeout(timeout)
    await page.goto(path, { waitUntil: 'load' })
    await page.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready' && document.fonts.status === 'loaded')
    await page.waitForSelector('.api-members[data-api-sticky-members]', { state: 'attached' })
    if (sabotage?.css) await page.addStyleTag({ content: sabotage.css })
    return { context, page }
  }
  // The scroll position holds still and no heading is mid-arrival.
  const quiet = async (page) => {
    await page.evaluate(() => { window.__quiet = { y: -1, still: 0 } })
    await page.waitForFunction(() => {
      const state = window.__quiet
      if (scrollY === state.y && !document.querySelector('[data-api-arriving]')) state.still++
      else { state.y = scrollY; state.still = 0 }
      return state.still >= 12
    }, undefined, { polling: 'raf' })
  }
  const scrollTo = async (page, top) => {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), top)
    await quiet(page)
  }
  const groupsOf = (page) => page.evaluate(() => [...document.querySelectorAll('.api-members > .api-member-group')]
    .flatMap((group) => {
      const heading = group.querySelector(':scope > h3[id]')
      const { top, height } = group.getBoundingClientRect()
      return heading ? [{ id: heading.id, top: top + scrollY, height }] : []
    }))
  // Where a heading sits against the line below the bars above it, and whether anything covers it.
  const landing = (page, id) => page.evaluate((id) => {
    const heading = document.getElementById(id)
    const owner = heading.matches('.api-members > h2')
    const box = heading.parentElement.getBoundingClientRect()
    const rect = heading.getBoundingClientRect()
    const line = owner
      ? document.querySelector('.api-section-links').getBoundingClientRect().bottom +
        (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 0.75
      : document.querySelector('.api-members > h2').getBoundingClientRect().bottom
    const hit = document.elementFromPoint(rect.left + 20, rect.top + rect.height / 2)
    return { y: Math.round(scrollY), top: Math.round(rect.top), line: Math.round(line),
      start: Math.round(box.top), covered: !(hit && heading.contains(hit)) }
  }, id)
  const reached = (arrival, label) => {
    const where = JSON.stringify(arrival)
    assert(Math.abs(arrival.top - arrival.line) <= 2, `${engine}: ${label} lands at the reading line: ${where}`)
    assert(Math.abs(arrival.start - arrival.top) <= 2, `${engine}: ${label} lands at the start of its group, not its end: ${where}`)
    assert(!arrival.covered, `${engine}: ${label} is not covered by the bars above it: ${where}`)
  }
  // Sample the scroll position after each frame has rendered, so a corrected jump is not mistaken for a painted one.
  const track = (page) => page.evaluate(() => {
    window.__frames = []
    const sample = () => requestAnimationFrame(() => setTimeout(() => {
      window.__frames.push(Math.round(scrollY))
      if (window.__frames.length < 180) sample()
    }, 0))
    sample()
  })
  // The page scrolls once to its destination and never paints the end of the group on the way.
  const movedOnce = async (page, from, label) => {
    const frames = await page.evaluate(() => window.__frames)
    const moved = frames.findIndex((y) => Math.abs(y - from) > 1)
    const final = frames.at(-1)
    assert(moved >= 0, `${engine}: ${label} scrolls: ${JSON.stringify(frames)}`)
    assert(frames.slice(moved).every((y) => Math.abs(y - final) <= 2),
      `${engine}: ${label} scrolls once from ${from} to its destination: ${JSON.stringify(frames.slice(moved))}`)
  }
  const link = (page, selector) => page.locator(selector).filter({ visible: true }).first()
  // Keep the main thread busy through the next click, as a loaded page does.
  const hold = (page, busy) => page.evaluate((busy) => addEventListener('click', () => {
    for (const end = performance.now() + busy; performance.now() < end;);
  }, { capture: true, once: true }), busy)
  // A real pointer click where the link is. Locator clicks scroll the page first in some engines.
  const press = async (page, anchor) => {
    const box = await anchor.boundingBox()
    assert(box, `${engine}: the link to press is on screen`)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    assert(await anchor.evaluate((element, [x, y]) => element.contains(document.elementFromPoint(x, y)), [x, y]),
      `${engine}: nothing covers the link to press`)
    await page.mouse.click(x, y)
  }

  const desktop = { width: 1800, height: 1000 }
  for (const viewport of only ? [desktop] : [desktop, { width: 390, height: 844 }]) {
    const phone = viewport.width < 600
    const size = `${viewport.width}px`

    // Tabbing backward through a stuck group leaves each stop clear of the bars.
    if (wants('focus')) {
      const { context, page } = await open(viewport)
      try {
        const groups = await groupsOf(page)
        assert(groups.length >= 3, `${engine}: the Swift Server page keeps grouped members: ${JSON.stringify(groups)}`)
        const tall = groups.reduce((a, b) => a.height > b.height ? a : b)
        await scrollTo(page, tall.top + tall.height / 2)
        await page.evaluate(() => {
          const links = [...document.querySelectorAll('.api-members .api-member-group a[href]:not(.api-heading-link)')]
          links.find((a) => a.getBoundingClientRect().top >= innerHeight * 0.6).focus({ preventScroll: true })
        })
        let stops = 0
        for (let tab = 0; tab < 14; tab++) {
          await page.keyboard.press('Shift+Tab')
          await quiet(page)
          const stop = await page.evaluate(() => {
            const active = document.activeElement
            if (!active?.closest('.api-members')) return null
            const rect = active.getClientRects()[0]
            const x = rect.left + Math.min(rect.width / 2, 30)
            // Which of five points down the control show the control itself rather than a bar.
            const shown = [2, rect.height * 0.25, rect.height * 0.5, rect.height * 0.75, rect.height - 2]
              .map((offset) => active.contains(document.elementFromPoint(x, rect.top + offset)))
            return { y: Math.round(scrollY), top: Math.round(rect.top), shown, name: (active.getAttribute('aria-label') || active.textContent).trim().slice(0, 24) }
          })
          if (!stop) break
          stops++
          // WCAG 2.2 SC 2.4.11: a focused control is never entirely hidden. Gecko scrolls a focused
          // control only when none of it is visible; the other engines also clear its top edge.
          assert(stop.shown.some(Boolean), `${engine}/${size}: backward tab stop ${stops} is not entirely hidden by the sticky bars: ${JSON.stringify(stop)}`)
          if (engine !== 'firefox') assert(stop.shown[0], `${engine}/${size}: backward tab stop ${stops} starts below the sticky bars: ${JSON.stringify(stop)}`)
        }
        assert(stops >= 10, `${engine}/${size}: tabbing backward crosses a stuck group (${stops} stops)`)
        // Keyboard focus returns the Members bar to flow; the gap cover must not paint over it.
        await scrollTo(page, tall.top + tall.height / 2)
        await page.keyboard.press('Shift')
        await page.evaluate(() => document.querySelector('.api-members > h2 a.api-heading-link').focus())
        await quiet(page)
        const owner = await page.evaluate(() => {
          const heading = document.querySelector('.api-members > h2')
          const link = heading.querySelector('a.api-heading-link')
          const rect = link.getBoundingClientRect()
          const x = rect.left + rect.width / 2
          return { visible: link.matches(':focus-visible'), link: heading.contains(document.elementFromPoint(x, rect.top + 1)),
            bar: heading.contains(document.elementFromPoint(x, heading.getBoundingClientRect().top + 4)) }
        })
        assert(owner.visible && owner.link && owner.bar, `${engine}/${size}: the focused Members permalink is covered: ${JSON.stringify(owner)}`)
      } finally {
        await context.close()
      }
    }

    // A link to an earlier group, from inside a later one, is the first navigation on the page. The
    // second pass keeps the main thread busy through the click, so a frame renders before the URL changes.
    for (const busy of wants('link') ? [0, 30] : []) {
      const { context, page } = await open(viewport)
      try {
        const groups = await groupsOf(page)
        const [first, second] = groups
        await scrollTo(page, second.top + second.height / 2)
        // Phones keep the owner link in the section row; groups are in the rail.
        const id = phone ? 'api-members' : first.id
        const label = `a link to ${id} from a later group${busy ? ' on a busy page' : ''}`
        const anchor = link(page, `a[data-api-section-link][href="#${id}"]`)
        const start = await page.evaluate(() => Math.round(scrollY))
        await track(page)
        await hold(page, busy)
        await press(page, anchor)
        await quiet(page)
        reached(await landing(page, id), label)
        await movedOnce(page, start, label)
      } finally {
        await context.close()
      }
    }

    // A link to the heading that is already the page's hash returns to the group's start every time,
    // from the middle of the group and from its trailing edge, where the release displaces the bar.
    if (!phone && wants('permalink')) {
      const { context, page } = await open(viewport)
      try {
        const tall = (await groupsOf(page)).reduce((a, b) => a.height > b.height ? a : b)
        const permalink = page.locator(`[id="${tall.id}"] a.api-heading-link`)
        const rail = link(page, `a[data-api-section-link][href="#${tall.id}"]`)
        await scrollTo(page, tall.top + tall.height / 2)
        await press(page, permalink); await quiet(page)
        const once = await landing(page, tall.id)
        reached(once, 'a permalink to a stuck group heading')
        await scrollTo(page, tall.top + tall.height * 0.75)
        await hold(page, 30)
        await press(page, permalink); await quiet(page)
        const again = await landing(page, tall.id)
        reached(again, 'the same permalink clicked again on a busy page')
        assert(Math.abs(again.y - once.y) <= 2, `${engine}: the repeated permalink returns to ${once.y}, not ${again.y}`)
        const edge = await page.evaluate(() => document.querySelector('.api-section-links').getBoundingClientRect().bottom +
          (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 0.75)
        await scrollTo(page, tall.top + tall.height - edge)
        await press(page, rail); await quiet(page)
        const last = await landing(page, tall.id)
        reached(last, 'the same link clicked from the end of the group')
        assert(Math.abs(last.y - once.y) <= 2, `${engine}: the link from the end of the group returns to ${once.y}, not ${last.y}`)
      } finally {
        await context.close()
      }
    }

    // A typed or scripted hash for a group above the viewport follows the same rule as a click.
    for (const kind of wants('typed') ? ['group', 'owner'] : []) {
      const { context, page } = await open(viewport)
      try {
        const groups = await groupsOf(page)
        const last = groups.at(-1)
        const id = kind === 'owner' ? 'api-members' : groups[0].id
        await scrollTo(page, last.top + Math.min(last.height / 2, 600))
        await page.evaluate((id) => { location.hash = `#${id}` }, id)
        await quiet(page)
        reached(await landing(page, id), `a typed hash for ${id}`)
      } finally {
        await context.close()
      }
    }
    if (!only) console.log(`API sticky headings: ${engine} at ${size} keeps focus clear and lands links and typed hashes at the start of their group`)
  }
}

/** The sticky heading check fails when the clearance or the typed-hash handling it guards is removed. */
export async function checkApiStickyHeadingsFail(browser, base) {
  const engine = browser.browserType().name()
  const controls = [
    ['focus clearance', { only: ['focus'], sabotage: { css: '.api-members :where(a[href], button, summary, input, select, textarea, [tabindex]) { scroll-margin-top: 0 !important }' } },
      /backward tab stop \d+ (is not entirely hidden by|starts below) the sticky bars/],
    ['the Navigation API', { only: ['typed'], sabotage: { script: 'Object.defineProperty(window, "navigation", { value: undefined })' } },
      /a typed hash for [\w-]+ lands at the (reading line|start of its group)/],
    ['a positioned Members bar in flow', { only: ['focus'], sabotage: { css: '.api-members[data-api-sticky-members] > h2:has(:focus-visible) { position: static !important }' } },
      /the focused Members permalink is covered/],
  ]
  for (const [name, options, failure] of controls) {
    await assert.rejects(() => checkApiStickyHeadings(browser, base, options), failure, `${engine}: the check fails without ${name}`)
  }
  console.log(`API sticky headings: ${engine} fails without focus clearance, typed-hash handling or a positioned Members bar`)
}

/** Check document navigation, persisted preferences and controls at each arrival. */
export async function checkNavigation(page, base) {
  await observeInitialPageLoad(page)
  await page.goto(`${base}/tmux/examples/attach-and-send-keys/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  await page.evaluate(() => {
    localStorage.setItem('color-scheme', 'dark')
    localStorage.removeItem('libtmux-code-tab')
    localStorage.setItem('libtmux-docs.mcp-install.cooldown.enabled', '1')
    window.__applyTheme()
    window.__navigationProbe = true
  })
  const assertArrival = async () => {
    await page.waitForFunction(() => window.__firstVisibleAppearance)
    assert.deepEqual(await page.evaluate(() => window.__firstVisibleAppearance),
      { readiness: 'ready', theme: 'dark', cooldown: '1' }, 'Saved preferences are present at the first visible frame')
  }
  await page.getByRole('navigation', { name: 'Breadcrumb', exact: true }).getByRole('link', { name: 'Examples', exact: true }).click()
  await page.waitForURL(`${base}/tmux/examples/`)
  await page.waitForFunction(() => window.__docsPageLoaded)
  await assertArrival()
  assert.equal(await page.evaluate(() => window.__navigationProbe), undefined, 'A link loads a new document')
  assert.match(page.url(), /\/examples\/$/)
  const example = page.locator('main').getByRole('link').filter({
    has: page.getByRole('heading', { name: 'Attach and send keys', exact: true }),
  })
  await example.click()
  await page.waitForURL(`${base}/tmux/examples/attach-and-send-keys/`)
  await page.waitForFunction(() => window.__docsPageLoaded)
  await assertArrival()
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
  assert.equal(await page.locator('main libtmux-code-tabs').count(), 0, 'Native tmux prose has no language tabs')
  await page.goBack()
  await page.waitForURL(`${base}/tmux/examples/`)
  await page.waitForFunction(() => window.__docsPageLoaded)
  await assertArrival()
  assert.equal(await page.locator('html').getAttribute('data-theme-mode'), 'dark')
  assert.equal(await page.locator('html').getAttribute('data-page-readiness'), 'ready')
  assert.equal(await page.locator('html').getAttribute('data-mcp-install-cooldown-enabled'), '1')

  await page.goto(`${base}/code-tabs-probe/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__docsPageLoaded)
  await page.waitForFunction(() => customElements.get('libtmux-code-tabs'))
  await assertArrival()
  const savedTab = page.locator('.code-tab[aria-selected="false"]').first()
  const savedPort = await savedTab.getAttribute('data-port')
  await savedTab.click()
  assert.equal(await page.locator(`.code-tab-panel[data-port="${savedPort}"]:not([hidden])`).count(), 2)
  await page.evaluate(() => { window.__codeTabsProbeDocument = true })
  await page.getByRole('link', { name: 'Open the code tabs fixture', exact: true }).click()
  await page.waitForURL(`${base}/code-tabs-probe/?from=client`)
  await page.waitForFunction(() => window.__docsPageLoaded)
  await page.waitForFunction(() => customElements.get('libtmux-code-tabs'))
  await assertArrival()
  assert.equal(await page.evaluate(() => window.__codeTabsProbeDocument), undefined,
    'The query link initializes a new native document')
  assert.match(page.url(), /\/code-tabs-probe\/\?from=client$/)
  assert.equal(await page.locator(`.code-tab-panel[data-port="${savedPort}"]:not([hidden])`).count(), 2,
    'The new document restores the saved language in both real Markdown tab groups')
  const otherTab = page.locator('.code-tab[aria-selected="false"]').first()
  const port = await otherTab.getAttribute('data-port')
  await otherTab.click()
  assert.equal(await page.locator(`.code-tab[data-port="${port}"]`).first().getAttribute('aria-selected'), 'true')
  assert.equal(await page.locator(`.code-tab-panel[data-port="${port}"]:not([hidden])`).count(), 2,
    'Native navigation initializes both real Markdown tab groups')
  assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-code-tab')), port)
  await page.goBack()
  await page.waitForURL(`${base}/code-tabs-probe/`)
  await page.waitForFunction(() => window.__docsPageLoaded)
  await assertArrival()
  assert.equal(await page.locator('main libtmux-code-tabs').count(), 2)
  assert.equal(await page.evaluate(() => localStorage.getItem('libtmux-code-tab')), port,
    'Back preserves the saved language preference')
  console.log('Navigation: native documents, Back, search, code tabs, menu and saved theme/cooldown pass')

  for (const [port, version] of [['ts', 'latest'], ['py', defaultVersion('py')]]) {
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
