import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeNativeShell } from '../../scripts/normalize-native-shell.mjs'

/** Delay enhancement until the initial article and navigation can be inspected. */
export async function checkNativeFirstPaint(page, url) {
  let release
  const delayedScript = new Promise((resolve) => { release = resolve })
  const pendingRoutes = []
  const routeScript = (route) => {
    const pending = delayedScript.then(() => route.continue())
    pendingRoutes.push(pending)
    return pending
  }
  await page.route('**/_shell/shell.js', routeScript)
  try {
    const response = await page.goto(url, { waitUntil: 'commit' })
    assert(response?.ok(), `Native page: HTTP ${response?.status()}`)
    await page.locator('article h1').waitFor({ state: 'visible' })
    assert(await page.locator('[data-lt-shell="header"]').isVisible(), 'Native header is visible before shell.js arrives')
    assert.equal(await page.evaluate(() => customElements.get('libtmux-version-switcher') !== undefined), false,
      'Native content and navigation are visible while shell.js is still unavailable')
    const initial = await page.locator('article h1').boundingBox()
    await page.evaluate(() => { window.__initialNativeHeader = document.querySelector('[data-lt-shell="header"]') })
    release()
    await page.waitForLoadState('networkidle')
    assert.deepEqual(await page.locator('article h1').boundingBox(), initial, `Native first paint stays still at ${page.viewportSize().width}px`)
    assert(await page.evaluate(() => window.__initialNativeHeader === document.querySelector('[data-lt-shell="header"]')),
      'Enhancement preserves the initial header')
    assert.equal(await page.locator('[data-lt-shell="header"]').count(), 1)
  } finally {
    release()
    await Promise.all(pendingRoutes)
    await page.unroute('**/_shell/shell.js', routeScript)
  }
}

/** Exercise the real native adapter before, during and after script loading. */
export async function checkNativeLayout(browser) {
  const directory = mkdtempSync(join(tmpdir(), 'native-first-paint-'))
  const root = '/pr-42/en', version = 'v0.62.0', pagePath = `${root}/py/${version}/api/session/`
  const pageFile = join(directory, 'session/index.html')
  mkdirSync(join(directory, 'session'))
  writeFileSync(pageFile, '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:16px/1.5 Arial}article{padding:24px}h1{margin:0}</style></head><body><article><h1>Sessions</h1><p>Read the native reference while its controls load.</p><dt class="sig" id="libtmux.Session">Session</dt></article></body></html>')
  let server
  try {
    await normalizeNativeShell(directory, root, { sphinxPort: 'py', version })
    const assets = new Map([
      [pagePath, ['text/html', readFileSync(pageFile)]],
      [`${root}/py/${version}/api/_static/libtmux-org.css`, ['text/css', readFileSync(join(directory, '_static/libtmux-org.css'))]],
      ...['shell.js', 'tokens.css'].map((file) => [`${root}/_shell/${file}`, [file.endsWith('.js') ? 'text/javascript' : 'text/css', readFileSync(new URL(`../public/_shell/${file}`, import.meta.url))]]),
      [`${root}/versions.json`, ['application/json', JSON.stringify({ schema: 1, defaultVersion: { ts: 'stable' }, ports: {
        py: [{ slug: version, label: version, supported: true }, { slug: 'v0.63.0rc1', label: 'v0.63.0rc1', supported: true }],
      } })]],
      [`${root}/page-links.json`, ['application/json', JSON.stringify({ schema: 1, symbols: { py: {} }, indexes: {} })]],
    ])
    server = createServer((request, response) => {
      const asset = assets.get(request.url)
      response.writeHead(asset ? 200 : 404, { 'Content-Type': asset?.[0] ?? 'text/plain', 'Cache-Control': 'no-store' })
      response.end(asset?.[1] ?? 'Not found')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}${pagePath}`
    for (const width of [1440, 688, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } })
      try {
        const page = await context.newPage()
        await checkNativeFirstPaint(page, url)
        assert.equal(await page.locator('libtmux-version-switcher option').count(), 2)
        assert.equal(await page.locator('[data-port-home="ts"]').first().getAttribute('href'), `${root}/ts/stable/`)
      } finally {
        await context.close()
      }
      const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 } })
      try {
        const page = await noScript.newPage()
        await page.goto(url)
        assert(await page.locator('article h1').isVisible())
        await page.locator('[data-page-port-switcher] summary').click()
        assert(await page.locator('[data-page-port-switcher] a[aria-current]').isVisible(), 'Native disclosure works without JavaScript')
      } finally {
        await noScript.close()
      }
    }
    console.log('Native first paint: visible content, stable geometry, enhanced controls and no-JS navigation at 1440/688/390px')
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
}
