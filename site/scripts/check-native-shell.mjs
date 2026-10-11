#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { checkNativeFirstPaint, checkNativeHeader } from './check-native-layout.mjs'

const base = (process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080/en').replace(/\/$/, '')
const version = process.argv.find((arg) => arg.startsWith('--version='))?.slice('--version='.length) ?? 'stable'
const browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })
try {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      javaScriptEnabled,
      reducedMotion: 'reduce',
      viewport: { width: 390, height: 900 },
    })
    try {
      const page = await context.newPage()
      const id = 'libtmux._internal.query_list.QueryList'
      await page.goto(`${base}/py/${version}/api/internals/api/libtmux._internal.query_list/#${id}`, {
        waitUntil: 'load',
      })
      await page.evaluate(() => document.fonts.ready)
      const motion = await page.evaluate((id) => {
        const target = document.getElementById(id).getBoundingClientRect()
        return {
          behavior: getComputedStyle(document.documentElement).scrollBehavior,
          top: target.top,
          bottom: target.bottom,
          header: document.querySelector('.site-header').getBoundingClientRect().bottom,
          viewport: innerHeight,
        }
      }, id)
      assert.equal(
        motion.behavior,
        'auto',
        `Reduced motion with JavaScript ${javaScriptEnabled}: native fragment navigation animates`,
      )
      assert(
        motion.top >= motion.header - 1 && motion.bottom <= motion.viewport,
        `Reduced motion with JavaScript ${javaScriptEnabled}: the deep-link destination is not visible below the header`,
      )
    } finally {
      await context.close()
    }
  }
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const loaded = new Set()
  page.on('response', (response) => {
    if (response.ok()) loaded.add(response.url())
  })
  for (const width of [1440, 1062, 1027, 768, 688, 641, 390]) {
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await checkNativeFirstPaint(page, `${base}/py/${version}/api/api/libtmux.session/`)
      await page.evaluate(() => scrollTo(0, 900))
      await page.waitForFunction(() => scrollY >= 900)
      await checkNativeHeader(page)
      await page.evaluate(() => scrollTo(0, 0))
      const menu = page.locator('[data-page-port-switcher]')
      await menu.waitFor()
      await page.waitForFunction(() =>
        document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'),
      )
      assert(
        [...loaded].some((url) => url.includes(`/${version}/_astro/`) && url.endsWith('.css')),
        'Compiled native CSS did not load',
      )
      assert(
        [...loaded].some((url) => url.includes(`/${version}/_astro/DocumentationScript.`)),
        'Compiled shared navigation did not load',
      )
      assert(
        ![...loaded].some((url) => /(?:\/_shell\/shell\.js|\/spa-nav\.js|\/scripts\/furo\.js)/.test(url)),
        'A competing native shell/router loaded',
      )
      assert(
        await page.locator('meta[name="astro-view-transitions-enabled"]').count(),
        'Native pages have no shared client router',
      )
      assert.equal(
        await page.locator('[data-surface-picker] .surface-current small').textContent(),
        'Upstream reference',
      )
      assert.deepEqual(
        (await page.locator('[data-surface-picker] a[aria-current]').allTextContents()).map((text) =>
          text.replaceAll(/\s|✓/g, ''),
        ),
        ['Upstreamreference'],
      )
      await menu.locator('summary').focus()
      await page.keyboard.press('Enter')
      const bounds = await menu.evaluate((details) => {
        const current = details.querySelector('summary').getBoundingClientRect()
        const panel = details.querySelector('[data-picker-panel]')
        const rect = panel.getBoundingClientRect()
        const covered = [...panel.querySelectorAll('[data-picker-option]')]
          .filter((item) => {
            if (!item.checkVisibility()) return false
            const row = item.getBoundingClientRect()
            const y = row.top + row.height / 2
            if (y <= rect.top || y >= rect.bottom) return false
            return !item.contains(document.elementFromPoint(row.left + row.width / 2, y))
          })
          .map((item) => item.textContent.trim())
        return {
          open: details.open,
          controlHeight: current.height,
          left: rect.left,
          right: rect.right,
          viewport: innerWidth,
          covered,
        }
      })
      const context = `${width}px ${colorScheme}`
      assert(bounds.open, `${context}: keyboard did not open the port dropdown`)
      assert(
        bounds.controlHeight === 36 && bounds.left >= 0 && bounds.right <= bounds.viewport,
        `${context}: native dropdown has the wrong size or leaves the viewport`,
      )
      assert.deepEqual(bounds.covered, [], `${context}: native content covers port menu entries`)
      await page.keyboard.press('Escape')
      assert.equal(
        await menu.evaluate((details) => details.open),
        false,
        `${context}: keyboard did not close the port dropdown`,
      )
    }
  }
  await page.evaluate(() => {
    location.hash = 'sessions'
  })
  await page.waitForFunction(() =>
    document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'),
  )
  const picker = page.locator('[data-page-port-switcher]')
  await picker.locator('summary').click()
  await picker.locator('[data-picker-search]').fill('TypeScript')
  await page.evaluate(() => {
    location.hash = 'libtmux.Session.windows'
  })
  await page.waitForFunction(() =>
    document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session-windows/"]'),
  )
  assert.deepEqual(
    await picker
      .locator('[data-picker-option]')
      .evaluateAll((options) =>
        options
          .filter((option) => option.checkVisibility({ visibilityProperty: true }))
          .map((option) => option.dataset.port),
      ),
    ['ts'],
    'Fragment navigation preserves the active language filter',
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => scrollTo(0, 0))
  for (const [input, button] of [
    ['__navigation', 'mobile-sidebar-toggle'],
    ['__toc', 'mobile-toc-toggle'],
  ]) {
    await page.setViewportSize({ width: 641, height: 900 })
    const opener = page.locator(`#${button}`)
    await opener.focus()
    await page.keyboard.press('Enter')
    assert(await page.locator(`#${input}`).isChecked(), `${button}: keyboard opens the drawer`)
    assert(
      await page.evaluate(
        (id) => document.getElementById(id).contains(document.activeElement),
        input === '__navigation' ? 'native-navigation' : 'native-toc',
      ),
      `${button}: focus moves into the drawer`,
    )
    await page.waitForFunction(
      (id) => {
        const drawer = document.getElementById(id)
        const rect = drawer.getBoundingClientRect()
        if (rect.left < 0 || rect.right > innerWidth) return false
        const link = [...drawer.querySelectorAll('a[href]')].find((link) => link.checkVisibility())
        if (!link) return false
        const bounds = link.getBoundingClientRect()
        return link.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
      },
      input === '__navigation' ? 'native-navigation' : 'native-toc',
    )
    await page.keyboard.press('Control+k')
    await page.locator('dialog[open]').waitFor()
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
    assert(await page.locator(`#${input}`).isChecked(), `${button}: dismissing search preserves the underlying drawer`)
    await page.setViewportSize({ width: 380, height: 900 })
    await page.waitForFunction(() =>
      document.querySelector('[data-documentation-context]').hasAttribute('data-settings-open'),
    )
    assert(await opener.isVisible(), `${button}: resizing keeps the drawer opener visible`)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator(`#${input}`).isChecked(), false, `${button}: Escape closes the drawer`)
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      button,
      `${button}: Escape returns focus to the visible opener`,
    )
  }
  console.log(
    'Native shell: reduced-motion deep links with and without JavaScript, stable first paint, reachable scrolled header, assets, keyboard, unobscured dropdowns at 1440/1062/768/688/641/390px in light/dark, filtered class/member equivalents, and drawer focus across resizing passed',
  )
} finally {
  await browser.close()
}
