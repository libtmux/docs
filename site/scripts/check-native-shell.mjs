#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = (process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080/en').replace(/\/$/, '')
const browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const loaded = new Set()
  page.on('response', (response) => {
    if (response.ok()) loaded.add(response.url())
  })
  const response = await page.goto(`${base}/py/stable/api/api/libtmux.session/`)
  assert(response?.ok(), `Native Session page: HTTP ${response?.status()}`)
  const menu = page.locator('[data-page-port-switcher]')
  await menu.waitFor()
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/reference/ts/session-session/"]'))
  assert(loaded.has(`${base}/_shell/shell.js`), 'Native shell script did not load from this locale')
  assert(loaded.has(`${base}/_shell/tokens.css`), 'Native shell tokens did not load from this locale')
  await menu.locator('summary').click()
  const bounds = await menu.evaluate((details) => {
    const current = details.querySelector('summary').getBoundingClientRect()
    const locale = details.nextElementSibling.querySelector('summary').getBoundingClientRect()
    const panel = details.querySelector('ul').getBoundingClientRect()
    return { sameRow: Math.abs(current.y - locale.y) <= 1, left: panel.left, right: panel.right, viewport: innerWidth }
  })
  assert(bounds.sameRow && bounds.left >= 0 && bounds.right <= bounds.viewport, 'Native dropdowns split rows or leave the viewport')
  await page.evaluate(() => { location.hash = 'sessions' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/reference/ts/session-session/"]'))
  await page.evaluate(() => { location.hash = 'libtmux.Session.windows' })
  await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[href$="/reference/ts/session-session-windows/"]'))
  console.log('Native shell: script, tokens, phone dropdowns and class/member equivalents passed')
} finally {
  await browser.close()
}
