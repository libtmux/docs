#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

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
  for (const width of [1440, 768, 390]) {
    for (const colorScheme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      const response = await page.goto(`${base}/py/${version}/api/api/libtmux.session/`)
      assert(response?.ok(), `Native Session page: HTTP ${response?.status()}`)
      const menu = page.locator('[data-page-port-switcher]')
      await menu.waitFor()
      await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'))
      assert(loaded.has(`${base}/_shell/shell.js`), 'Native shell script did not load from this locale')
      assert(loaded.has(`${base}/_shell/tokens.css`), 'Native shell tokens did not load from this locale')
      await menu.locator('summary').focus()
      await page.keyboard.press('Enter')
      const bounds = await menu.evaluate((details) => {
        const current = details.querySelector('summary').getBoundingClientRect()
        const locale = details.nextElementSibling.querySelector('summary').getBoundingClientRect()
        const panel = details.querySelector('ul')
        const rect = panel.getBoundingClientRect()
        const covered = [...panel.querySelectorAll('li')].filter((item) => {
          const row = item.getBoundingClientRect()
          return [rect.left + 12, rect.right - 12].some((x) => !item.contains(document.elementFromPoint(x, row.top + row.height / 2)))
        }).map((item) => item.textContent.trim())
        return { open: details.open, sameRow: Math.abs(current.y - locale.y) <= 1, left: rect.left, right: rect.right, viewport: innerWidth, covered }
      })
      const context = `${width}px ${colorScheme}`
      assert(bounds.open, `${context}: keyboard did not open the port dropdown`)
      assert(bounds.sameRow && bounds.left >= 0 && bounds.right <= bounds.viewport, `${context}: native dropdowns split rows or leave the viewport`)
      assert.deepEqual(bounds.covered, [], `${context}: native content covers port menu entries`)
      await page.keyboard.press('Enter')
      assert.equal(await menu.evaluate((details) => details.open), false, `${context}: keyboard did not close the port dropdown`)
    }
  }
  await page.evaluate(() => { location.hash = 'sessions' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session/"]'))
  await page.evaluate(() => { location.hash = 'libtmux.Session.windows' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/ts/latest/reference/session-session-windows/"]'))
  console.log('Native shell: assets, keyboard, unobscured dropdowns at 1440/768/390px in light/dark, and class/member equivalents passed')
} finally {
  await browser.close()
}
