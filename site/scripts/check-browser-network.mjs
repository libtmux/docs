import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { newCheckContext, newCheckPage } from './browser-context.mjs'

/** A held image on another origin must never reach its server or delay load. */
export async function checkBrowserNetwork(browser) {
  let result = Promise.withResolvers()
  let escaped = 0
  const foreign = createServer(() => {
    // Deliberately leave this image response pending until fixture teardown.
  })
  foreign.on('connection', () => {
    escaped += 1
    result.resolve('escaped')
  })
  foreign.listen(0, '127.0.0.1')
  await once(foreign, 'listening')
  const remote = `http://127.0.0.1:${foreign.address().port}`
  let truncated
  let pendingClosed = Promise.withResolvers()
  const local = createServer((request, response) => {
    if (['/truncated', '/pending'].includes(request.url)) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': '65536', 'X-Content-Type-Options': 'nosniff' })
      response.write('x'.repeat(16384))
      if (request.url === '/truncated') truncated = response
      else response.once('close', () => { pendingClosed.resolve(); local.emit('pending-closed') })
    } else if (request.url === '/release-truncated') {
      response.end('released')
      truncated.destroy()
    } else if (request.url === '/pending-state') {
      void pendingClosed.promise.then(() => { if (!response.destroyed) response.end('closed') })
    } else if (request.url === '/local.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' })
      response.end('window.localScript = true')
    } else if (request.url === '/local.css') {
      response.writeHead(200, { 'Content-Type': 'text/css' })
      response.end('h1 { color: rgb(1, 2, 3) }')
    } else if (request.url === '/redirected.svg') {
      response.writeHead(302, { Location: `${remote}/held.svg` })
      response.end()
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      const image = request.url === '/redirect-case' ? '/redirected.svg' : `${remote}/held.svg`
      response.end(`<title>Local fixture</title><link rel="stylesheet" href="/local.css"><script src="/local.js"></script><h1>Local fixture</h1><img src="${image}">`)
    }
  })
  const localSockets = new Set()
  local.on('connection', (socket) => {
    localSockets.add(socket)
    socket.once('close', () => localSockets.delete(socket))
    socket.on('error', () => socket.destroy())
  })
  local.on('upgrade', (request, socket) => {
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    socket.once('data', () => socket.end())
  })
  try {
    local.listen(0, '127.0.0.1')
    await once(local, 'listening')
    const base = `http://127.0.0.1:${local.address().port}`
    for (const factory of ['page', 'context', 'redirect', 'continued']) {
      const page = factory === 'page'
        ? await newCheckPage(browser, base, { viewport: { width: 640, height: 480 } })
        : await (await newCheckContext(browser, base, { viewport: { width: 640, height: 480 } })).newPage()
      const context = page.context()
      context.setDefaultNavigationTimeout(5000)
      context.on('requestfailed', (request) => {
        if (new URL(request.url()).origin === remote) result.resolve('blocked')
      })
      context.on('response', (response) => {
        if (new URL(response.url()).origin === remote) result.resolve('blocked')
      })
      try {
        if (factory === 'continued') await page.route('**/*', (route) => route.continue())
        result = Promise.withResolvers()
        let loaded = false
        const navigation = page.goto(base + (factory === 'redirect' ? '/redirect-case' : '/'), { waitUntil: 'load' }).then(() => { loaded = true }, (error) => { result.reject(error) })
        const outcome = await result.promise
        if (outcome === 'escaped') assert.equal(loaded, false, 'The held image delays document load')
        assert.equal(outcome, 'blocked', `${factory}: held image reached the foreign server`)
        await navigation
        assert.equal(await page.title(), 'Local fixture')
        assert.deepEqual(await page.evaluate(() => [window.localScript, getComputedStyle(document.querySelector('h1')).color]), [true, 'rgb(1, 2, 3)'])
        assert.equal(page.viewportSize().width, 640, 'Browser options survive the request policy')
        if (['page', 'context'].includes(factory)) {
          assert.equal(await page.evaluate(async () => {
            await Promise.all(Array.from(document.images, (image) => image.decode()))
            return document.images[0].naturalWidth
          }), 1, 'Off-origin image fixtures decode without contacting their server')
        }
        if (factory === 'context') {
          assert.equal(await page.evaluate((url) => new Promise((resolve, reject) => {
            const socket = new WebSocket(url)
            socket.onopen = () => { socket.close(); resolve('open') }
            socket.onerror = () => reject(new Error('The owned server WebSocket did not open'))
          }), base.replace('http:', 'ws:') + '/socket'), 'open')
          result = Promise.withResolvers()
          const incoming = page.waitForEvent('popup')
          await page.evaluate(() => window.open('/popup'))
          const popup = await incoming
          assert.equal(await result.promise, 'blocked', 'Popup requests inherit the context policy')
          await popup.waitForLoadState('load')
          assert.equal(await popup.title(), 'Local fixture')
          assert.equal(await popup.evaluate(async () => { await document.images[0].decode(); return document.images[0].naturalWidth }), 1)
          await popup.close()
          result = Promise.withResolvers()
          const fetched = context.request.get(`${remote}/api`, { timeout: 1000 })
            .then(() => 'responded', () => 'blocked')
          assert.equal(await Promise.race([result.promise, fetched]), 'blocked', 'Context request/fetch cannot escape through a decorator')
        }
        assert.equal(escaped, 0, 'No off-origin request reached the held-image server')
      } finally {
        if (factory === 'page') await page.close()
        else await context.close()
      }
    }
    const page = await newCheckPage(browser, base)
    try {
      await page.goto(base)
      const truncation = await page.evaluate(async () => {
        const controller = new AbortController()
        const limit = setTimeout(() => controller.abort(), 1000)
        try {
          const response = await fetch('/truncated', { signal: controller.signal })
          const reader = response.body.getReader()
          await reader.read()
          await fetch('/release-truncated')
          try {
            let chunk = await reader.read()
            while (!chunk.done) chunk = await reader.read()
            return { failed: false }
          }
          catch { return { failed: true, deadline: controller.signal.aborted } }
        } finally { clearTimeout(limit) }
      })
      assert.deepEqual(truncation, { failed: true, deadline: false }, 'Truncated upstream fails before the fixture deadline')
      pendingClosed = Promise.withResolvers()
      assert.equal(await page.evaluate(async () => {
        const controller = new AbortController()
        const response = await fetch('/pending', { signal: controller.signal })
        await response.body.getReader().read()
        controller.abort()
        return (await fetch('/pending-state', { signal: AbortSignal.timeout(1000) })).text()
      }), 'closed', 'Cancelling a client closes its owned upstream request')
    } finally { await page.close() }
    const context = await newCheckContext(browser, base)
    try {
      const page = await context.newPage()
      await page.goto(base)
      await page.evaluate(async () => { await (await fetch('/pending')).body.getReader().read() })
      await Promise.all([once(local, 'pending-closed', { signal: AbortSignal.timeout(1000) }), context.close()])
    } finally { await context.close() }
    const before = browser.contexts().length
    const failure = new Error('Image policy registration failed')
    const broken = {
      async newContext(options) {
        const context = await browser.newContext(options)
        context.route = async () => { throw failure }
        return context
      },
      async newPage(options) {
        const page = await browser.newPage(options)
        page.context().route = async () => { throw failure }
        return page
      },
    }
    await assert.rejects(newCheckContext(broken, base), (error) => error === failure)
    assert.equal(browser.contexts().length, before, 'Failed context policy registration closes its context')
    await assert.rejects(newCheckPage(broken, base), (error) => error === failure)
    assert.equal(browser.contexts().length, before, 'Failed page policy registration closes its context')
    const driver = browser.browserType()
    const closed = await driver.launch(driver.name() === 'chromium' ? { channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL } : {})
    await closed.close()
    await assert.rejects(newCheckContext(closed, base))
    await assert.rejects(newCheckPage(closed, base))
    console.log('Browser network: local assets load; off-origin images, redirects, decorators and popup requests cannot escape')
  } finally {
    local.closeAllConnections()
    foreign.closeAllConnections()
    for (const socket of localSockets) socket.destroy()
    await Promise.all([new Promise((resolve) => local.close(resolve)), new Promise((resolve) => foreign.close(resolve))])
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch()
  try { await checkBrowserNetwork(browser) } finally { await browser.close() }
}
