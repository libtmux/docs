#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { checkNativeFirstPaint } from './check-native-layout.mjs'

const base = (process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080/en').replace(/\/$/, '')
const version = process.argv.find((arg) => arg.startsWith('--version='))?.slice('--version='.length) ?? 'stable'
const browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const loaded = new Set()
  page.on('response', (response) => {
    if (response.ok()) loaded.add(response.url())
  })
  for (const width of [1440, 1062, 768, 688, 641, 390]) {
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await checkNativeFirstPaint(page, `${base}/py/${version}/api/api/libtmux.session/`)
      const menu = page.locator('[data-page-port-switcher]')
      await menu.waitFor()
      await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'))
      assert([...loaded].some((url) => url.includes(`/${version}/_astro/`) && url.endsWith('.css')), 'Compiled native CSS did not load')
      assert([...loaded].some((url) => url.includes(`/${version}/_astro/DocumentationScript.`)), 'Compiled shared navigation did not load')
      assert(![...loaded].some((url) => /(?:\/_shell\/shell\.js|\/spa-nav\.js)/.test(url)), 'A competing native shell/router loaded')
      await menu.locator('summary').focus()
      await page.keyboard.press('Enter')
      const bounds = await menu.evaluate((details) => {
        const current = details.querySelector('summary').getBoundingClientRect()
        const panel = details.querySelector('[data-picker-panel]')
        const rect = panel.getBoundingClientRect()
        const covered = [...panel.querySelectorAll('[data-picker-option]')].filter((item) => {
          if (!item.checkVisibility()) return false
          const row = item.getBoundingClientRect()
          const y = row.top + row.height / 2
          if (y <= rect.top || y >= rect.bottom) return false
          return !item.contains(document.elementFromPoint(row.left + row.width / 2, y))
        }).map((item) => item.textContent.trim())
        return { open: details.open, controlHeight: current.height, left: rect.left, right: rect.right, viewport: innerWidth, covered }
      })
      const context = `${width}px ${colorScheme}`
      assert(bounds.open, `${context}: keyboard did not open the port dropdown`)
      assert(bounds.controlHeight === 36 && bounds.left >= 0 && bounds.right <= bounds.viewport, `${context}: native dropdown has the wrong size or leaves the viewport`)
      assert.deepEqual(bounds.covered, [], `${context}: native content covers port menu entries`)
      await page.keyboard.press('Escape')
      assert.equal(await menu.evaluate((details) => details.open), false, `${context}: keyboard did not close the port dropdown`)
    }
  }
  await page.evaluate(() => { location.hash = 'sessions' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'))
  await page.evaluate(() => { location.hash = 'libtmux.Session.windows' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session-windows/"]'))
  console.log('Native shell: compact header, stable first paint, assets, keyboard, unobscured dropdowns at 1440/1062/768/688/641/390px in light/dark, and class/member equivalents passed')
} finally {
  await browser.close()
}
