/** Own a forwarding proxy per check context; redirects and route.fetch share its origin boundary. */
import { once } from 'node:events'
import { Agent, createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { pipeline } from 'node:stream'

async function proxyFor(base) {
  const own = new URL(base)
  const allowed = own.origin
  const agent = new Agent({ keepAlive: true, maxSockets: 32 })
  const sockets = new Set()
  const track = (socket) => {
    if (sockets.has(socket)) return socket
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    return socket
  }
  const targetFor = (raw, tunnel = false) => {
    const target = new URL(tunnel ? `${own.protocol}//${raw}` : raw)
    const origin = target.origin.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
    return origin === allowed ? target : undefined
  }
  const server = createServer((incoming, outgoing) => {
    let target
    try { target = targetFor(incoming.url) } catch {}
    if (!target || target.protocol !== 'http:') { incoming.socket.destroy(); return }
    const headers = { ...incoming.headers, host: target.host }
    delete headers['proxy-connection']
    delete headers['proxy-authorization']
    const upstream = httpRequest(target, { method: incoming.method, headers, agent }, (response) => {
      outgoing.writeHead(response.statusCode, response.headers)
      pipeline(response, outgoing, (error) => { if (error) upstream.destroy() })
    })
    upstream.on('socket', track)
    upstream.on('error', () => outgoing.destroy())
    incoming.on('error', () => upstream.destroy())
    incoming.on('aborted', () => upstream.destroy())
    outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy() })
    incoming.pipe(upstream)
  })
  server.on('connection', track)
  server.on('connect', (request, client, head) => {
    let target
    try { target = targetFor(request.url, true) } catch {}
    if (!target) { client.destroy(); return }
    const upstream = track(connect(Number(target.port || (own.protocol === 'https:' ? 443 : 80)), target.hostname))
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
  })
  server.on('upgrade', (request, client, head) => {
    let target
    try { target = targetFor(request.url) } catch {}
    if (!target || !['http:', 'ws:'].includes(target.protocol)) { client.destroy(); return }
    const upstream = track(connect(Number(target.port || 80), target.hostname))
    upstream.once('connect', () => {
      const headers = Object.entries(request.headers).filter(([key]) => key !== 'proxy-connection')
        .map(([key, value]) => `${key}: ${value}`).join('\r\n')
      upstream.write(`${request.method} ${target.pathname}${target.search} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`)
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
    client.on('close', () => upstream.destroy())
    upstream.on('close', () => client.destroy())
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    server: `http://127.0.0.1:${server.address().port}`,
    close() {
      server.close()
      agent.destroy()
      for (const socket of sockets) socket.destroy()
    },
  }
}

async function mockForeignImages(context, base) {
  const origin = new URL(base).origin
  await context.route((url) => url.origin !== origin, (route) => route.request().resourceType() === 'image'
    ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' })
    : route.abort())
}

export async function newCheckContext(browser, base, options = {}) {
  const proxy = await proxyFor(base)
  let context
  try {
    context = await browser.newContext({ ...options, serviceWorkers: 'block', proxy: { server: proxy.server, bypass: '<-loopback>' } })
    context.once('close', () => proxy.close())
    await mockForeignImages(context, base)
    return context
  } catch (error) { proxy.close(); await context?.close().catch(() => {}); throw error }
}

export async function newCheckPage(browser, base, options = {}) {
  const proxy = await proxyFor(base)
  let page
  try {
    page = await browser.newPage({ ...options, serviceWorkers: 'block', proxy: { server: proxy.server, bypass: '<-loopback>' } })
    page.context().once('close', () => proxy.close())
    await mockForeignImages(page.context(), base)
    return page
  } catch (error) { proxy.close(); await page?.close().catch(() => {}); throw error }
}
