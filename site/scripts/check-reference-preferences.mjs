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
      if (details?.querySelector('summary') && !seen.has(details)) {
        seen.add(details)
        window.__sourceFrames.push({ path: location.pathname, open: details.open })
      }
      requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
    window.__docsPageLoaded = false
    document.addEventListener('astro:page-load', () => {
      window.__docsPageLoaded = true
    })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const source = page.locator('.api-source-details')
  const assertFirstFrame = async (open) => {
    await page.waitForFunction(() => window.__sourceFrames.length > 0)
    assert.equal(
      await page.evaluate(() => window.__sourceFrames.at(-1).open),
      open,
      'The first frame has the saved native disclosure state',
    )
    assert.equal(await source.evaluate((el) => el.open), open)
  }
  try {
    await page.goto(`${base}${path}`)
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
      assert(
        overview.scroll < errorsScroll - 20,
        `Overview returns above Errors with source ${open ? 'open' : 'closed'}`,
      )
      assert(overview.heading >= overview.header && overview.heading < 350, 'Overview reveals the heading')
    }
    await page.reload()
    await assertFirstFrame(false)
    await page.waitForFunction(() => window.__docsPageLoaded)
    // A real declaration link uses the client router, without replacing Window.
    const linked = page.locator('.api-overview a[href*="/java/latest/reference/"]').first()
    const target = await linked.getAttribute('href')
    await linked.click()
    await page.waitForURL(new URL(target, base).href)
    await page.waitForFunction(() => window.__sourceFrames.length === 2)
    await assertFirstFrame(false)
    await source.locator('summary').click()
    await page.waitForFunction((key) => localStorage.getItem(key) === 'open', key)
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server-livestate/`)
    await assertFirstFrame(true)
    await source.locator('summary').click()
    await page.waitForFunction((key) => localStorage.getItem(key) === 'closed', key)
    // A new tab and another port share the same persistent preference.
    const other = await context.newPage()
    await other.goto(`${base}${path}`)
    assert.equal(await other.locator('.api-source-details').evaluate((el) => el.open), false)
    await other.locator('.api-source-details > summary').click()
    await page.waitForFunction(() => document.querySelector('.api-source-details').open)
    await other.close()
    console.log(
      'Source and package: default open, keyboard, reload, client route, cross-port/tab and first-frame state pass',
    )
  } finally {
    await context.close()
  }

  for (const javaScriptEnabled of [false, true]) {
    const fallback = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' })
    if (javaScriptEnabled)
      await fallback.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('Storage blocked')
          },
        })
      })
    const page = await fallback.newPage()
    try {
      await page.goto(`${base}${path}`)
      const details = page.locator('.api-source-details')
      assert.equal(await details.evaluate((el) => el.open), true)
      await details.locator('summary').focus()
      await page.keyboard.press('Space')
      assert.equal(await details.evaluate((el) => el.open), false)
      await page.keyboard.press('Space')
      assert.equal(await details.evaluate((el) => el.open), true)
    } finally {
      await fallback.close()
    }
  }
  console.log('Source disclosure stays usable without JavaScript or localStorage')
}

/** The global header has no repeated destination strip, including without JS. */
export async function checkGlobalHeader(browser, base) {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const headerFrames = new Map()
    try {
      for (const path of [
        '/',
        '/tmux/latest/manual/capture-pane/',
        '/py/latest/',
        '/ts/latest/',
        '/api-example-probe/',
      ]) {
        await page.goto(`${base}${path}`)
        await page.waitForFunction(() => document.fonts.status === 'loaded')
        for (const width of [280, 304, 390, 768, 784, 1024, 1440, 1600, 1920]) {
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
            return {
              fits: document.documentElement.scrollWidth <= innerWidth + 1,
              frame: {
                left: bar.left,
                width: bar.width,
                height: bar.height,
                wordmark: brand.left,
                controls: controls.left,
                menu: menu.left,
              },
              wordmarkVisible:
                brand.width > 40 &&
                brand.height > 20 &&
                getComputedStyle(document.querySelector('.site-header__wordmark')).clipPath === 'none',
              separate: brand.right <= controls.left && controls.right <= menu.left,
            }
          })
          assert(geometry.fits && geometry.separate, `${path} at ${width}px: header controls fit without overlap`)
          assert(geometry.wordmarkVisible, `${path} at ${width}px: the wordmark remains a visible home link`)
          if (width >= 1600) {
            if (!headerFrames.has(width)) headerFrames.set(width, geometry.frame)
            assert.deepEqual(
              geometry.frame,
              headerFrames.get(width),
              `${path} at ${width}px: global controls keep their homepage positions`,
            )
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
  console.log(
    'Global header: usable menu and home link, stable wide-screen positions across home, prose, ports and reference, 280–1920px with/without JavaScript',
  )
  await checkScrollbarStability(browser, base)
}

/** Classic scrollbars must not move shared controls between short and long pages. */
export async function checkScrollbarStability(browser, base) {
  const classic = await browser.browserType().launch({
    ignoreDefaultArgs: ['--hide-scrollbars'],
    ...(browser.browserType().name() === 'chromium'
      ? {
          channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL,
          args: ['--disable-features=OverlayScrollbar'],
        }
      : {}),
  })
  try {
    for (const width of [280, 628, 1280])
      for (const colorScheme of ['light', 'dark'])
        for (const javaScriptEnabled of [true, false]) {
          const context = await classic.newContext({
            viewport: { width, height: 900 },
            colorScheme,
            javaScriptEnabled,
            reducedMotion: 'reduce',
          })
          const page = await context.newPage()
          const frame = () =>
            page.evaluate(() => {
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
                  bar: rect('.site-header__bar'),
                  wordmark: rect('.site-header__mark'),
                  toolbar: rect('.site-header__always'),
                  menu: rect('.site-header__menu-button'),
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
            assert(
              reference.scrolls && reference.scrollbar > 0,
              `${label}: the reference exercises a real classic scrollbar: ${JSON.stringify(reference)}`,
            )
            assert(!reference.overflow, `${label}: the reference has no horizontal overflow`)
            assert.deepEqual(
              reference.controls,
              home.controls,
              `${label}: a classic scrollbar does not move the shared header`,
            )
            // At 280px the homepage picker shares its row with the solution control.
            if (width >= 628)
              assert.equal(
                reference.pickerWidth,
                home.pickerWidth,
                `${label}: the unconstrained language picker keeps its width`,
              )
            await page.locator('.site-header__mark').click()
            await page.waitForURL(`${base}/`)
            await settle()
            const returned = await frame()
            assert(!returned.scrolls, `${label}: returning home removes the need to scroll`)
            assert.deepEqual(
              returned.controls,
              home.controls,
              `${label}: returning to a short page preserves header positions`,
            )
            assert.equal(
              returned.pickerWidth,
              home.pickerWidth,
              `${label}: returning home preserves its constrained picker width`,
            )
          } finally {
            await context.close()
          }
        }
  } finally {
    await classic.close()
  }
  console.log(
    'Classic scrollbars: short and long pages retain header positions in both themes, with and without JavaScript',
  )
}
