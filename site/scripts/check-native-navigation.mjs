#!/usr/bin/env node
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base = (process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080/en').replace(/\/$/, '')
const version = process.argv.find((arg) => arg.startsWith('--version='))?.slice('--version='.length) ?? 'stable'
const root = `${base}/py/${version}/api/`
const browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })

async function openNativeLink(page, suffix) {
  const opener = page.locator('[data-api-nav-toggle]')
  if (await opener.isVisible() && await opener.getAttribute('aria-expanded') !== 'true') await opener.click()
  const links = page.locator('.api-nav__tree a[href]')
  const index = await links.evaluateAll((links, suffix) => links.findIndex((link) => link.pathname.endsWith(suffix)), suffix)
  assert(index >= 0, `No native sidebar destination: ${suffix}`)
  const link = links.nth(index)
  await link.evaluate((link) => {
    for (let item = link.closest('li'); item; item = item.parentElement?.closest('li')) {
      if (item.hasAttribute('aria-expanded')) item.setAttribute('aria-expanded', 'true')
    }
  })
  await link.scrollIntoViewIfNeeded()
  const scroll = await page.locator('.api-nav__tree').evaluate((element) => element.scrollTop)
  await link.click()
  await page.waitForURL((url) => url.pathname.endsWith(suffix))
  await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
  return scroll
}

async function checkMetadata(page) {
  const html = await (await page.request.get(page.url())).text()
  await page.waitForFunction((html) => {
    const fresh = new DOMParser().parseFromString(html, 'text/html')
    return document.querySelector('article h1')?.textContent === fresh.querySelector('article h1')?.textContent
  }, html)
  const metadata = await page.evaluate((html) => {
    const fresh = new DOMParser().parseFromString(html, 'text/html')
    const read = (doc) => ({
      title: doc.title,
      canonical: doc.querySelector('link[rel=canonical]')?.getAttribute('href'),
      ports: doc.querySelector('[data-native-page-ports]')?.textContent,
      markdown: [...doc.querySelectorAll('footer a[href]')].find((link) => link.textContent.trim() === 'Markdown')?.getAttribute('href'),
      source: doc.querySelector('footer code')?.textContent,
    })
    return { actual: read(document), expected: read(fresh) }
  }, html)
  assert.deepEqual(metadata.actual, metadata.expected, 'Navigation retained metadata from the previous page')
  assert(metadata.actual.markdown && metadata.actual.source, 'Native source and Markdown links are missing')
  assert.equal(await page.locator('[data-surface-picker] .surface-current small').textContent(), 'Upstream reference')
}

try {
  for (const [width, colorScheme, reducedMotion] of [[1027, 'light', 'no-preference'], [390, 'dark', 'reduce']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion, permissions: ['clipboard-read', 'clipboard-write'] })
    try {
      const page = await context.newPage()
      const errors = [], documents = []
      page.on('pageerror', (error) => errors.push(String(error)))
      page.on('request', (request) => { if (request.isNavigationRequest()) documents.push(request.url()) })
      await page.goto(root)
      await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
      await page.evaluate(() => { window.nativeNavigationIdentity = true })
      const before = await openNativeLink(page, 'internals/api/libtmux._internal.constants/')
      assert.equal(await page.evaluate(() => window.nativeNavigationIdentity), undefined, 'Native links create a new document')
      await checkMetadata(page)
      const scroll = await page.evaluate((before) => {
        const sidebar = document.querySelector('.api-nav__tree')
        return { actual: sidebar.scrollTop, expected: Math.min(before, sidebar.scrollHeight - sidebar.clientHeight) }
      }, before)
      assert(Math.abs(scroll.actual - scroll.expected) <= 1, `Sidebar position changed: ${JSON.stringify(scroll)}`)
      assert.equal(await page.locator('.api-nav').getAttribute('data-open'), null, 'A page navigation left the drawer open')
      await openNativeLink(page, 'internals/api/libtmux._internal.query_list/')
      await checkMetadata(page)
      await page.locator('dt[id="libtmux._internal.query_list.QueryList"]').hover()
      await page.locator('a.headerlink[href="#libtmux._internal.query_list.QueryList"]:visible').click()
      await page.waitForFunction(() => document.querySelector('[data-page-port-switcher] a[aria-current]')?.hash === location.hash)
      const target = await page.locator('dt[id="libtmux._internal.query_list.QueryList"]').boundingBox()
      const header = await page.locator('.site-header').boundingBox()
      assert(target.y >= header.y + header.height - 1 && target.y < 900, 'Client fragment arrival is hidden')
      await page.goBack()
      await page.goBack()
      await page.waitForURL(`${root}internals/api/libtmux._internal.constants/`)
      await checkMetadata(page)
      await page.goBack()
      await page.waitForURL(root)
      await checkMetadata(page)
      await page.waitForFunction(() => document.querySelectorAll('.copybtn').length === document.querySelectorAll('div.highlight pre').length)
      const copy = page.locator('div.highlight .copybtn').first()
      const expected = (await page.locator('div.highlight pre').first().innerText()).replace(/^\$ /, '').trimEnd()
      await copy.click()
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected, 'Native copy changed after Back navigation')
      assert.equal(await copy.getAttribute('data-tooltip'), 'Copied!')
      await page.goForward()
      await page.waitForURL(`${root}internals/api/libtmux._internal.constants/`)
      await checkMetadata(page)
      assert(documents.includes(`${root}internals/api/libtmux._internal.constants/`), 'Native links request their destination document')
      assert.deepEqual(errors, [], 'Native transitions threw browser errors')
      assert.equal(await page.evaluate(() => document.body.dataset.theme), colorScheme)
      // The generated reference is an independently built shell boundary.
      await page.evaluate(() => { window.nativeNavigationIdentity = true })
      await page.locator('[data-surface-picker] > summary').click()
      await page.locator(`[data-surface-picker] a[href="${new URL(base).pathname}/py/${version}/reference/"]`).click()
      await page.waitForURL(`${base}/py/${version}/reference/`)
      await page.locator('html[data-page-readiness="ready"]').waitFor({ state: 'attached' })
      assert.equal(await page.evaluate(() => window.nativeNavigationIdentity), undefined, 'A different shell reused native global scripts')
      console.log(`Native navigation: ${width}px ${colorScheme} ${reducedMotion}, document links, metadata, anchors, history, copy, theme, and boundary PASS`)
    } finally { await context.close() }
  }
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 1027, height: 1450 }, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      await page.goto(root)
      await page.locator('#mobile-toc-toggle').click()
      const links = page.locator('#native-toc a[href^="#"]').filter({ hasNotText: /^libtmux$/ })
      assert.deepEqual((await links.allTextContents()).map((text) => text.trim()), ['Install', 'At a glance', 'Know where you’re running', 'Testing'])
      await links.first().click({ trial: true })
      await page.goto(`${root}genindex/`)
      assert.equal(await page.locator('#mobile-toc-toggle').count(), 0, 'An empty native index offers Contents')
      assert.equal(await page.locator('#native-toc').isVisible(), false)
      await page.locator('.api-nav__tree a').first().focus()
      await page.keyboard.press('Tab')
      assert.notEqual(await page.evaluate(() => document.activeElement.id), '__toc', 'Empty Contents remains a keyboard stop')
    } finally { await context.close() }
  }
} finally { await browser.close() }
