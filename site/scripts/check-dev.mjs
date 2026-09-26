#!/usr/bin/env node
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from 'astro'
import { chromium } from 'playwright'
import { PORTS, productAvailable } from '../src/lib/ports.ts'
import { checkClipboard } from './check-clipboard.mjs'

const workspacePortCount = PORTS.filter((port) => productAvailable(port, 'workspace')).length
// `workspaceCli` alone also covers a port's local, unreleased dev CLI
// (`workspaceCliAvailability: 'local'`), which publishes no top-level
// `workspace/guides` page. Only a released CLI does.
const workspaceCliPortCount = PORTS.filter((port) => port.workspaceCliAvailability === 'released').length

Object.assign(process.env, {
  LIBTMUX_DOCS_BASE: '/en/', LIBTMUX_DOCS_ROOT: '/en', LIBTMUX_DOCS_PORT_ROOT: '/en',
  LIBTMUX_DOCS_LOCALES_ROOT: '', LIBTMUX_DOCS_LOCALE: 'en', LIBTMUX_DOCS_PORT: '',
  LIBTMUX_DOCS_VERSION: 'latest', LIBTMUX_DOCS_PORT_DEFAULTS: '{"py":"stable"}',
})
// Astro always writes root/.astro, so a separate cacheDir alone cannot isolate it.
const source = fileURLToPath(new URL('../', import.meta.url))
const mirror = mkdtempSync(join(tmpdir(), 'libtmux-docs-browser-'))
process.on('exit', () => rmSync(mirror, { recursive: true, force: true }))
const root = join(mirror, 'site')
mkdirSync(root)
cpSync(join(source, 'src'), join(root, 'src'), { recursive: true })
for (const file of ['astro.config.ts', 'package.json', 'tsconfig.json']) cpSync(join(source, file), join(root, file))
for (const file of ['public', 'node_modules']) symlinkSync(join(source, file), join(root, file), 'dir')
for (const file of ['scripts', 'packages', 'node_modules']) symlinkSync(join(source, '..', file), join(mirror, file), 'dir')
let server, browser
const terminate = async () => {
  await browser?.close()
  await server?.stop()
  process.exit(1)
}
process.on('SIGTERM', terminate)
process.on('SIGINT', terminate)
server = await dev({ root, cacheDir: join(mirror, 'cache'),
  vite: { cacheDir: join(mirror, 'vite') }, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 } })
const base = `http://127.0.0.1:${server.address.port}/en`

// Vite can reload once after its initial dependency optimization.
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
  const paths = ['concepts/server-session-window-pane', 'mcp/tools', 'ts/latest/workspace/reference/builder-applyworkspace',
    'ts/latest/workspace/internals/guides', 'py/stable/workspace/guides',
    'ts/latest/mcp/tools', 'dotnet/latest/mcp/tools/capture_pane']
  for (const path of paths) await retryReload(async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    const response = await page.goto(`${base}/${path}/`, { waitUntil: 'load' })
    assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.locator('nav[aria-label="Language"] a').first().getAttribute('href'), '/en/py/stable/')
    const switcher = page.locator('[data-page-port-switcher]')
    const hasSwitcher = path !== 'mcp/tools'
    const isReference = path.includes('/reference/')
    const expected = isReference ? '/en/py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder-build/' : path.includes('workspace/') ? `/en/${path}/`
      : path === 'dotnet/latest/mcp/tools/capture_pane' ? '/en/py/stable/mcp/tools/capture_pane/' : `/en/py/stable/${path.replace(/^ts\/latest\//, '')}/`
    if (hasSwitcher) assert.equal(await switcher.locator('a').first().getAttribute('href'), expected)
    if (path === 'py/stable/workspace/guides') {
      assert.equal(await switcher.locator('a').count(), workspaceCliPortCount)
      assert.equal(
        await switcher.locator('[aria-disabled="true"]').count(),
        PORTS.length - workspaceCliPortCount,
      )
    }
    if (path === 'ts/latest/workspace/internals/guides') {
      const unavailable = await switcher.locator('[aria-disabled="true"]').allTextContents()
      assert(unavailable.some((label) => /Python/.test(label)), 'Python internals guide stays unavailable')
    }
    if (path === 'dotnet/latest/mcp/tools/capture_pane') {
      assert.equal(await switcher.locator('a').count(), 8)
      assert.equal(await switcher.locator('a[aria-current="page"]').getAttribute('href'), `/en/${path}/`)
    }
    if (isReference) {
      assert.equal(
        await switcher.locator('a').count(),
        workspacePortCount,
        'Workspace construction has an equivalent in every published workspace product',
      )
      const target = await page.request.get(base.replace(/\/en$/, '') + expected)
      assert(target.ok(), `Equivalent target: HTTP ${target.status()}`)
    }
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })

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
