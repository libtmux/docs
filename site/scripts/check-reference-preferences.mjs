import assert from 'node:assert/strict'

/** Exercise native disclosures and fragment navigation on a short API page. */
export async function checkReferencePreferences(browser, base) {
  const path = '/java/latest/reference/io-github-libtmux-buffers-buffers-delete/'
  const key = 'libtmux-docs.api-source-details'
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 784, height: 760 } })
  await context.addInitScript(() => {
    window.__sourceFrames = []
    const seen = new WeakSet()
    const observe = () => {
      const details = document.querySelector('.api-source-details')
      if (details?.querySelector('summary') && getComputedStyle(document.body).visibility === 'visible' && !seen.has(details)) {
        seen.add(details)
        window.__sourceFrames.push({ path: location.pathname, open: details.open })
      }
      requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
    window.__docsPageLoaded = false
    document.addEventListener('libtmux:page-ready', () => { window.__docsPageLoaded = true })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
  const source = page.locator('.api-source-details')
  const assertFirstFrame = async (open) => {
    await page.waitForFunction(() => window.__sourceFrames.length > 0)
    assert.equal(await page.evaluate(() => window.__sourceFrames.at(-1).open), open,
      'The first frame has the saved native disclosure state')
    assert.equal(await source.evaluate((el) => el.open), open)
  }
  try {
    await page.goto(`${base}${path}`, { waitUntil: 'commit' })
    await page.waitForFunction(() => window.__docsPageLoaded)
    await assertFirstFrame(true)
    // Exercise both possible disclosure heights on the reported short page.
    for (const open of [true, false]) {
      if (!open) {
        await source.locator('summary').focus()
        await page.keyboard.press('Space')
        await page.waitForFunction((key) => localStorage.getItem(key) === 'closed', key)
      }
      const sections = page.getByRole('navigation', { name: 'Reference sections', exact: true })
      await sections.getByRole('link', { name: 'Errors', exact: true }).click()
      const errorsScroll = await page.evaluate(() => scrollY)
      await sections.getByRole('link', { name: 'Overview', exact: true }).click()
      await page.waitForFunction(() => location.hash === '#api-overview')
      const overview = await page.evaluate(() => ({
        scroll: scrollY,
        heading: document.querySelector('h1').getBoundingClientRect().top,
        header: document.querySelector('.site-header').getBoundingClientRect().bottom,
      }))
      assert(overview.scroll < errorsScroll - 20, `Overview returns above Errors with source ${open ? 'open' : 'closed'}`)
      assert(overview.heading >= overview.header && overview.heading < 350, 'Overview reveals the heading')
    }
    await page.reload({ waitUntil: 'commit' })
    await assertFirstFrame(false)
    await page.waitForFunction(() => window.__docsPageLoaded)
    // A real declaration link restores the preference in a new document.
    const target = `${new URL(base).pathname}/java/latest/reference/io-github-libtmux-exception-targetgoneexception-targetgoneexception/`
    const linked = page.locator(`.api-overview a[href="${target}"]`).first()
    await linked.click()
    await page.waitForURL(new URL(target, base).href, { waitUntil: 'commit' })
    await assertFirstFrame(false)
    await source.locator('summary').click()
    await page.waitForFunction((key) => localStorage.getItem(key) === 'open', key)
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server-livestate/`, { waitUntil: 'commit' })
    await assertFirstFrame(true)
    await source.locator('summary').click()
    await page.waitForFunction((key) => localStorage.getItem(key) === 'closed', key)
    // A new tab and another port share the same persistent preference.
    const other = await context.newPage()
    await other.goto(`${base}${path}`, { waitUntil: 'commit' })
    await other.waitForFunction(() => document.documentElement.dataset.pageReadiness === 'ready')
    assert.equal(await other.locator('.api-source-details').evaluate((el) => el.open), false)
    await other.locator('.api-source-details > summary').click()
    await page.waitForFunction(() => document.querySelector('.api-source-details').open)
    await other.close()
    console.log('Source and package: default open, keyboard, reload, document links, cross-port/tab and first-frame state pass')
  } finally {
    await context.close()
  }

  for (const javaScriptEnabled of [false, true]) {
    const fallback = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' })
    if (javaScriptEnabled) await fallback.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked') } })
    })
    const page = await fallback.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.stack))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    try {
      await page.goto(`${base}${path}`, { waitUntil: 'commit' })
      if (javaScriptEnabled) {
        await page.waitForFunction(() => ['ready', 'failed'].includes(document.documentElement.dataset.pageReadiness))
        assert.equal(await page.locator('html').getAttribute('data-page-readiness'), 'ready', errors.join('\n'))
      }
      const details = page.locator('.api-source-details')
      const summary = details.locator('summary')
      await summary.waitFor({ state: 'visible' })
      assert.equal(await details.evaluate((el) => el.open), true)
      await summary.focus()
      assert(await summary.evaluate((element) => element === document.activeElement), 'The visible disclosure receives keyboard focus')
      await page.keyboard.press('Space')
      await page.waitForFunction(() => !document.querySelector('.api-source-details').open)
      assert.equal(await details.evaluate((el) => el.open), false)
      await page.keyboard.press('Space')
      await page.waitForFunction(() => document.querySelector('.api-source-details').open)
      assert.equal(await details.evaluate((el) => el.open), true)
    } finally {
      await fallback.close()
    }
  }
  console.log('Source disclosure stays usable without JavaScript or localStorage')
}

/**
 * The links each port page shows, in order, and then its disclosure. Rust and
 * Java have a reference host as well, so they show three chips; the others two.
 * Written out rather than read from the page, so a missing chip is a failure.
 */
const HEADER_PAGES = {
  '/py/latest/': ['source', 'package', 'destinations'],
  '/ts/latest/': ['source', 'package', 'destinations'],
  '/rs/latest/': ['source', 'package', 'api', 'destinations'],
  '/api-example-probe/': ['source', 'package', 'destinations'],
}

/**
 * The port's repository and package links and its packages disclosure sit in
 * the bar from 48rem and in the Menu panel below it, so the bar never grows and
 * exactly one copy is displayed.
 */
export async function checkHeaderLinks(page, path, width, scripted) {
  const compact = width < 768
  const where = `${path} at ${width}px`
  const state = await page.evaluate(() => {
    const box = (element) => { const { left, right, width, height } = element.getBoundingClientRect(); return { left, right, width, height } }
    const shown = (placement) => [
      ...document.querySelectorAll(`a[data-header-action][data-placement="${placement}"]`),
      ...document.querySelectorAll(`details[data-header-picker][data-placement="${placement}"] > summary`),
    ].filter((element) => element.checkVisibility()).map((element) => ({
      kind: element.dataset.headerAction ?? element.parentElement.dataset.headerPicker, ...box(element), name: element.getAttribute('aria-label'),
      // The shared hint's glyph would widen a chip, so a chip draws none.
      glyph: element.matches('a') ? getComputedStyle(element, '::after').content : 'none',
    }))
    const edges = (selector) => { const { left, right } = document.querySelector(selector).getBoundingClientRect(); return { left, right } }
    return {
      bar: shown('bar'), menu: shown('menu'), brand: edges('.site-header__mark'), controls: edges('.site-header__always'),
      height: document.querySelector('.site-header__bar').getBoundingClientRect().height,
      language: Boolean(document.querySelector('.site-header-language [data-page-port-switcher]')),
    }
  })
  const [exposed, hidden] = compact ? [state.menu, state.bar] : [state.bar, state.menu]
  assert.deepEqual(exposed.map(({ kind }) => kind), HEADER_PAGES[path], `${where}: the displayed links and disclosure`)
  assert.equal(hidden.length, 0, `${where}: the other copy is not displayed`)
  assert(state.height <= (state.language && width <= 560 ? 97 : 53), `${where}: the links leave the header height unchanged (${state.height}px)`)
  for (const entry of exposed) {
    assert(entry.width >= 24 && entry.height >= 24, `${where}: ${entry.kind} is at least 24px square`)
    assert(entry.name, `${where}: ${entry.kind} has an accessible name`)
    // A pseudo-element with no generated content computes to none, or to normal in some engines.
    assert(['none', 'normal'].includes(entry.glyph), `${where}: ${entry.kind} draws no external-link glyph of its own (${entry.glyph})`)
  }
  if (!compact) {
    assert(state.brand.right <= exposed[0].left && exposed.at(-1).right <= state.controls.left, `${where}: bar links sit between the wordmark and the controls`)
    assert(exposed.every((entry, index) => index === 0 || exposed[index - 1].right <= entry.left + 0.5), `${where}: the links do not overlap`)
    assert(exposed.every((entry) => entry.right <= state.controls.left), `${where}: the links end before the controls`)
  }
  const placement = compact ? 'menu' : 'bar'
  const picker = page.locator(`details[data-header-picker="destinations"][data-placement="${placement}"]`)
  await picker.locator(':scope > summary').click()
  // With JS the panel opens from the asynchronous toggle event, not the click.
  await picker.locator('[data-picker-panel]').waitFor({ state: 'visible' })
  const opened = await picker.evaluate((element) => {
    const { left, right } = element.querySelector('[data-picker-panel]').getBoundingClientRect()
    const rows = [...element.querySelectorAll('a[data-picker-option]')]
    return { open: element.open, shown: element.querySelector('[data-picker-panel]').checkVisibility(), left, right,
      fits: document.documentElement.scrollWidth <= innerWidth + 1, width: innerWidth,
      // One glyph per row: the shared hint's mask, and no arrow of the row's own.
      masks: rows.map((row) => getComputedStyle(row, '::after').maskImage),
      arrows: rows.filter((row) => /[↗⇗]/.test(row.textContent)).length }
  })
  assert(opened.open && opened.shown, `${where}: the disclosure opens`)
  assert(opened.fits && opened.left >= -0.5 && opened.right <= opened.width + 0.5, `${where}: the open disclosure stays inside the viewport`)
  assert.equal(opened.arrows, 0, `${where}: rows draw no arrow of their own`)
  if (scripted) assert(opened.masks.length > 0 && opened.masks.every((mask) => mask !== 'none'), `${where}: every row has the shared external-link glyph`)
  // Escape closes it and returns focus to its trigger.
  await page.keyboard.press('Escape')
  if (scripted) {
    const closed = await picker.locator('[data-picker-panel]').waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false)
    assert(closed, `${where}: Escape closes the disclosure`)
    assert(await picker.locator(':scope > summary').evaluate((summary) => summary === document.activeElement), `${where}: Escape returns focus to the trigger`)
  } else {
    await picker.locator(':scope > summary').click()
    await picker.locator('[data-picker-panel]').waitFor({ state: 'hidden' })
  }
}

/**
 * The check must fail when a chip is missing or hidden, a hint glyph widens a
 * chip, chips overlap or shrink, the open disclosure leaves the viewport, or
 * Escape stops closing it or stops returning focus. The control is the same
 * page and width with nothing broken, so a check that failed everything would
 * not satisfy the cases.
 */
export async function checkHeaderLinksFail(browser, base) {
  const run = async ({ path = '/rs/latest/', width = 1440, css, script }) => {
    const context = await browser.newContext({ javaScriptEnabled: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.setDefaultTimeout(process.env.CI ? 20000 : 10000)
    try {
      await page.goto(`${base}${path}`)
      await page.waitForFunction(() => document.fonts.status === 'loaded')
      await page.setViewportSize({ width, height: 900 })
      await page.waitForSelector('details[data-header-picker][data-enhanced]', { state: 'attached' })
      if (css) await page.addStyleTag({ content: css })
      if (script) await page.evaluate(script)
      await page.locator('.site-header__menu > summary').click()
      await checkHeaderLinks(page, path, width, true)
    } finally {
      await context.close()
    }
  }
  await run({})
  await run({ path: '/py/latest/', width: 390 })
  const controls = [
    ['a hidden package chip', { css: '.header-link[data-header-action="package"] { display: none !important }' }, /the displayed links and disclosure/],
    ['a hidden reference chip', { css: '.header-link[data-header-action="api"] { display: none !important }' }, /the displayed links and disclosure/],
    ['a hidden disclosure', { css: '.header-picker { display: none !important }' }, /the displayed links and disclosure/],
    ['a hint glyph on a chip', { css: '.site-header a.header-link::after { content: "x" !important }' }, /draws no external-link glyph/],
    ['overlapping chips', { css: '.site-header .header-link { margin-inline-end: -2rem !important }' }, /the links do not overlap/],
    ['a chip too small to press', { css: '.site-header .header-link { width: 10px !important; min-width: 0 !important; padding: 0 !important; overflow: hidden !important }' }, /at least 24px square/],
    ['a disclosure that leaves the viewport', { css: '.header-picker__panel { margin-left: 4000px !important }' }, /stays inside the viewport/],
    ['an Escape that is swallowed', { script: () => document.addEventListener('keydown', (event) => { if (event.key === 'Escape') event.stopImmediatePropagation() }, true) }, /Escape closes the disclosure/],
    // The disclosure closes, but focus is dropped instead of returned.
    ['an Escape that loses focus', { script: () => document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      document.querySelector('details[data-header-picker][open]').open = false
      document.activeElement.blur()
    }, true) }, /Escape returns focus to the trigger/],
    ['a missing menu copy', { path: '/py/latest/', width: 390, css: '.site-header__panel-destinations { display: none !important }' }, /the displayed links and disclosure/],
  ]
  for (const [name, options, failure] of controls) {
    await assert.rejects(() => run(options), failure, `the check fails with ${name}`)
  }
  console.log('Header links: the check fails on a hidden or missing chip or disclosure, a hint glyph, overlapping or tiny chips, a disclosure outside the viewport, and an Escape that is swallowed or loses focus')
}

/** The global header has no repeated destination strip, including without JS. */
export async function checkGlobalHeader(browser, base) {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const headerFrames = new Map()
    try {
      for (const path of ['/', '/tmux/latest/manual/capture-pane/', '/py/latest/', '/ts/latest/', '/rs/latest/', '/api-example-probe/']) {
        await page.goto(`${base}${path}`)
        await page.waitForFunction(() => document.fonts.status === 'loaded')
        for (const width of [280, 304, 320, 360, 390, 560, 561, 640, 767, 768, 784, 1024, 1440, 1600, 1920]) {
          await page.setViewportSize({ width, height: 900 })
          assert.equal(await page.locator('header nav[aria-label="Documentation destinations"]').count(), 0)
          const menu = page.locator('.site-header__menu')
          await menu.locator(':scope > summary').click()
          assert.equal(await menu.locator('[data-port-home]').count(), 0)
          const geometry = await page.evaluate(() => {
            const brand = document.querySelector('.site-header__mark').getBoundingClientRect()
            const controls = document.querySelector('.site-header__always').getBoundingClientRect()
            const menu = document.querySelector('.site-header__menu-button').getBoundingClientRect()
            const bar = document.querySelector('.site-header__bar').getBoundingClientRect()
            return { fits: document.documentElement.scrollWidth <= innerWidth + 1,
              frame: { left: bar.left, width: bar.width, height: bar.height, wordmark: brand.left, controls: controls.left, menu: menu.left },
              wordmarkVisible: brand.width > 40 && brand.height > 20
                && getComputedStyle(document.querySelector('.site-header__wordmark')).clipPath === 'none',
              separate: brand.right <= controls.left && controls.right <= menu.left }
          })
          assert(geometry.fits && geometry.separate, `${path} at ${width}px: header controls fit without overlap`)
          assert(geometry.wordmarkVisible, `${path} at ${width}px: the wordmark remains a visible home link`)
          // The probe renders a TypeScript reference page, so it has a port.
          if (HEADER_PAGES[path]) await checkHeaderLinks(page, path, width, javaScriptEnabled)
          else assert.equal(await page.locator('details[data-header-picker], a[data-header-action]').count(), 0, `${path}: pages without a port have no repository or package links`)
          if (width >= 1600) {
            if (!headerFrames.has(width)) headerFrames.set(width, geometry.frame)
            assert.deepEqual(geometry.frame, headerFrames.get(width), `${path} at ${width}px: global controls keep their homepage positions`)
          }
          await menu.locator(':scope > summary').click()
        }
      }
      await page.setViewportSize({ width: 280, height: 900 })
      await page.locator('.site-header__mark').focus()
      await page.keyboard.press('Enter')
      await page.waitForURL(`${base}/`)
    } finally {
      await context.close()
    }
  }
  console.log('Global header: usable menu and home link, stable wide-screen positions across home, prose, ports and reference, 280–1920px with/without JavaScript')
  await checkScrollbarStability(browser, base)
}

/** Classic scrollbars must not move shared controls between short and long pages. */
export async function checkScrollbarStability(browser, base) {
  const classic = await browser.browserType().launch({
    ignoreDefaultArgs: ['--hide-scrollbars'],
    ...(browser.browserType().name() === 'chromium' ? {
      channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL,
      args: ['--disable-features=OverlayScrollbar'],
    } : {}),
  })
  try {
    for (const width of [280, 628, 1280]) for (const colorScheme of ['light', 'dark']) for (const javaScriptEnabled of [true, false]) {
      const context = await classic.newContext({ viewport: { width, height: 900 }, colorScheme, javaScriptEnabled, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const frame = () => page.evaluate(() => {
        const rect = (selector) => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect()
          return { x, y, width, height }
        }
        return {
          scrolls: document.documentElement.scrollHeight > innerHeight,
          scrollbar: innerWidth - document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > innerWidth,
          pickerWidth: rect('header [data-page-port-switcher] > summary').width,
          controls: {
            bar: rect('.site-header__bar'), wordmark: rect('.site-header__mark'),
            toolbar: rect('.site-header__always'), menu: rect('.site-header__menu-button'),
          },
        }
      })
      // Wait for font layout before comparing header geometry.
      const settle = () => page.evaluate(() => document.fonts.ready)
      const label = `${width}px, ${colorScheme}, JavaScript ${javaScriptEnabled}`
      try {
        await page.goto(`${base}/?port=py`)
        await settle()
        const contentHeight = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width, height: contentHeight + 128 })
        await settle()
        const home = await frame()
        assert(!home.scrolls, `${label}: the real homepage fits the viewport`)
        assert(!home.overflow, `${label}: the homepage has no horizontal overflow`)
        await page.goto(`${base}/ts/latest/reference/server-server/`)
        await settle()
        const reference = await frame()
        assert(reference.scrolls && reference.scrollbar > 0, `${label}: the reference exercises a real classic scrollbar: ${JSON.stringify(reference)}`)
        assert(!reference.overflow, `${label}: the reference has no horizontal overflow`)
        assert.deepEqual(reference.controls, home.controls, `${label}: a classic scrollbar does not move the shared header`)
        // At 280px the homepage picker shares its row with the solution control.
        if (width >= 628) assert.equal(reference.pickerWidth, home.pickerWidth, `${label}: the unconstrained language picker keeps its width`)
        await page.locator('.site-header__mark').click()
        await page.waitForURL(`${base}/`)
        await settle()
        const returned = await frame()
        assert(!returned.scrolls, `${label}: returning home removes the need to scroll`)
        assert.deepEqual(returned.controls, home.controls, `${label}: returning to a short page preserves header positions`)
        assert.equal(returned.pickerWidth, home.pickerWidth, `${label}: returning home preserves its constrained picker width`)
      } finally {
        await context.close()
      }
    }
  } finally {
    await classic.close()
  }
  console.log('Classic scrollbars: short and long pages retain header positions in both themes, with and without JavaScript')
}
