#!/usr/bin/env node
import assert from 'node:assert/strict'
import { dev } from 'astro'
import { chromium } from 'playwright'
import { checkClipboard } from './check-clipboard.mjs'

Object.assign(process.env, {
  LIBTMUX_DOCS_BASE: '/en/', LIBTMUX_DOCS_ROOT: '/en', LIBTMUX_DOCS_PORT_ROOT: '/en',
  LIBTMUX_DOCS_LOCALES_ROOT: '', LIBTMUX_DOCS_LOCALE: 'en', LIBTMUX_DOCS_PORT: '',
  LIBTMUX_DOCS_VERSION: 'latest', LIBTMUX_DOCS_PORT_DEFAULTS: '{"py":"stable"}',
})
const server = await dev({ root: new URL('../', import.meta.url), logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 } })
const base = `http://127.0.0.1:${server.address.port}/en`
let browser
const terminate = async () => {
  await browser?.close()
  await server.stop()
  process.exit(1)
}
process.on('SIGTERM', terminate)
process.on('SIGINT', terminate)

// Vite reloads a page when it finishes re-optimizing dependencies, which it
// does after `astro check` has written the cache with a different config.
// Waiting for `load` rather than network idle can land a check inside that
// reload, so a page gets one more attempt for that reason and no other.
async function retryReload(check) {
  try {
    await check()
  } catch (error) {
    if (!/Execution context was destroyed/.test(String(error))) throw error
    await check()
  }
}

try {
  browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  const manifest = await page.request.get(`${base}/page-links.json`)
  assert(manifest.ok(), `Native navigation manifest: HTTP ${manifest.status()}`)
  assert.equal((await manifest.json()).schema, 1)
  const clipboardPage = await browser.newPage()
  clipboardPage.setDefaultTimeout(10000)
  const clipboard = checkClipboard(clipboardPage, base).then(() => null, (error) => error)
  const paths = ['concepts/server-session-window-pane', 'mcp/tools', 'ts/latest/reference/session-session-panes',
    'ts/latest/workspace/internals/guides', 'py/stable/workspace/guides',
    'ts/latest/mcp/tools', 'dotnet/latest/mcp/tools/tmux_capture_pane']
  for (const path of paths) await retryReload(async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const response = await page.goto(`${base}/${path}/`, { waitUntil: 'load' })
    assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.locator('nav[aria-label="Language"] a').first().getAttribute('href'), '/en/py/stable/')
    const switcher = page.locator('[data-page-port-switcher]')
    const hasSwitcher = path !== 'mcp/tools'
    const isReference = path.includes('/reference/')
    const expected = path.includes('workspace/') ? `/en/${path}/`
      : path === 'dotnet/latest/mcp/tools/tmux_capture_pane' ? '/en/py/stable/mcp/tools/capture_pane/' : isReference
      ? '/en/py/stable/reference/libtmux-session-panes/' : `/en/py/stable/${path.replace(/^ts\/latest\//, '')}/`
    if (hasSwitcher) assert.equal(await switcher.locator('a').first().getAttribute('href'), expected)
    if (path === 'py/stable/workspace/guides') {
      assert.equal(await switcher.locator('a').count(), 1, 'Only Python has a workspace CLI guide')
      assert.equal(await switcher.locator('[aria-disabled="true"]').count(), 7)
    }
    if (path === 'ts/latest/workspace/internals/guides') {
      assert.match(await switcher.locator('[aria-disabled="true"]').textContent(), /Python/)
    }
    if (path === 'dotnet/latest/mcp/tools/tmux_capture_pane') {
      assert.equal(await switcher.locator('a').count(), 8)
      assert.equal(await switcher.locator('a[aria-current="page"]').getAttribute('href'), `/en/${path}/`)
    }
    if (isReference) {
      assert.match(await switcher.locator('[aria-disabled="true"]').textContent(), /Java/)
      const target = await page.request.get(base.replace(/\/en$/, '') + expected)
      assert(target.ok(), `Equivalent target: HTTP ${target.status()}`)
    }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      if (path.startsWith('reference/')) {
        await page.waitForFunction((narrow) => document.querySelector('#api-nav').inert === narrow,
          width < 1024)
        await page.locator('#api-nav').waitFor({ state: width < 1024 ? 'hidden' : 'visible' })
      }
      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        columns: [...document.querySelectorAll('table')].flatMap((table) => {
          const head = [...(table.tHead?.rows[0]?.cells ?? [])]
          const body = [...(table.tBodies[0]?.rows[0]?.cells ?? [])]
          return head.length === body.length && [...head, ...body].every((cell) => cell.colSpan === 1)
            ? head.map((cell, i) => Math.abs(cell.getBoundingClientRect().x - body[i].getBoundingClientRect().x)) : []
        }),
      }))
      assert(result.overflow <= 1, `${path} at ${width}px: page overflow ${result.overflow}px`)
      assert(result.columns.every((delta) => delta <= 1), `${path} at ${width}px: table columns misaligned`)
    }
    if (path.startsWith('reference/')) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.waitForFunction(() => !document.querySelector('#api-nav').inert)
      await page.locator('#api-nav [role=treeitem][tabindex="0"]').focus()
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.waitForFunction(() => document.querySelector('#api-nav').inert)
      assert(await page.locator('[data-api-nav-toggle]').evaluate((element) => document.activeElement === element),
        `${path}: collapsing focused navigation returns focus to its toggle`)
      const heading = page.locator('main h1').first()
      await heading.evaluate((element) => { element.tabIndex = -1; element.focus() })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.waitForFunction(() => !document.querySelector('#api-nav').inert)
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.waitForFunction(() => document.querySelector('#api-nav').inert)
      assert(await heading.evaluate((element) => document.activeElement === element),
        `${path}: collapsing navigation preserves focus in the content`)
    }
    if (hasSwitcher) {
      assert.equal(await switcher.count(), 1, `${path}: one page port switcher`)
      await switcher.locator('summary').click()
      const menu = await switcher.locator('ul').boundingBox()
      assert(menu && menu.x >= 0 && menu.x + menu.width <= 390, `${path}: dropdown leaves phone viewport`)
    }
  })
  for (const path of [
    'py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder',
    'java/latest/workspace/reference/io-github-libtmux-workspace-workspacebuilder-workspacebuilder',
  ]) await retryReload(async () => {
    const response = await page.goto(`${base}/${path}/`, { waitUntil: 'load' })
    assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
    await page.evaluate(() => document.fonts.ready)
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      assert(overflow <= 1, `${path} at ${width}px: declaration page overflow ${overflow}px`)
    }
  })
  const clipboardError = await clipboard
  if (clipboardError) throw clipboardError
  console.log('Fresh Astro + browser: prose, workspace, MCP tools and API equivalent; 1440/768/390px PASS')
} finally {
  await browser?.close()
  await server.stop()
}
