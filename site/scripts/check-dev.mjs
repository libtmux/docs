#!/usr/bin/env node
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from 'astro'
import { chromium, firefox, webkit } from 'playwright'
import { PORTS, productAvailable } from '../src/lib/ports.ts'
import { checkClipboard } from './check-clipboard.mjs'
import { checkNavigation } from './check-navigation.mjs'

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
// Astro resolves external component styles against the nearest shared path.
// Keep the isolated root beside its dependencies, rather than under /tmp.
const cache = join(source, '../node_modules/.cache')
mkdirSync(cache, { recursive: true })
const mirror = mkdtempSync(join(cache, 'libtmux-docs-browser-'))
process.on('exit', () => rmSync(mirror, { recursive: true, force: true }))
const root = join(mirror, 'site')
mkdirSync(root)
cpSync(join(source, 'src'), join(root, 'src'), { recursive: true })
for (const file of ['astro.config.ts', 'ec.config.mjs', 'package.json', 'tsconfig.json']) cpSync(join(source, file), join(root, file))
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
  const engine = process.env.LIBTMUX_DOCS_BROWSER ?? 'chromium'
  const driver = { chromium, firefox, webkit }[engine]
  if (!driver) throw new Error(`Unknown browser: ${engine}`)
  browser = await driver.launch(engine === 'chromium' ? { channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL } : {})
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  const manifest = await page.request.get(`${base}/page-links.json`)
  assert(manifest.ok(), `Native navigation manifest: HTTP ${manifest.status()}`)
  assert.equal((await manifest.json()).schema, 1)
  const clipboardPage = await browser.newPage()
  clipboardPage.setDefaultTimeout(10000)
  const clipboard = checkClipboard(clipboardPage, base).then(() => null, (error) => error)
  const paths = ['concepts/server-session-window-pane', 'examples/attach-and-send-keys', 'mcp/tools', 'ts/latest/workspace/reference/builder-applyworkspace',
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
    if (hasSwitcher) {
      assert.equal(await page.locator('[data-page-toolbar] nav[aria-label="Breadcrumb"]').count(), 1, `${path}: breadcrumbs above the heading`)
      const geometry = await page.evaluate(() => {
        const toolbar = document.querySelector('[data-page-toolbar]').getBoundingClientRect()
        const breadcrumb = document.querySelector('[data-page-toolbar] nav').getBoundingClientRect()
        const picker = document.querySelector('[data-page-port-switcher]').getBoundingClientRect()
        const title = document.querySelector('h1').getBoundingClientRect()
        return { above: toolbar.bottom <= title.top, sameRow: picker.top < breadcrumb.bottom && breadcrumb.top < picker.bottom }
      })
      assert(geometry.above && geometry.sameRow, `${path}: breadcrumb and port picker share the row above H1`)
    }
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
    for (const width of [1600, 1440, 1024, 832, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })

      const result = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        headerHeight: document.querySelector('.site-header__bar').getBoundingClientRect().height,
        badgeForeground: getComputedStyle(document.querySelector('.prerelease-notice__badge')).color,
        portVisibility: getComputedStyle(document.querySelector('.site-header__ports')).display,
        shortLabel: getComputedStyle(document.querySelector('.site-header__ports .port-abbreviation')).display,
        languageEnd: document.querySelector('.site-header__ports nav a:last-child').getBoundingClientRect().right,
        controlsStart: document.querySelector('.site-header__always').getBoundingClientRect().left,
        schemeLabelWidth: document.querySelector('.scheme-switch__label').getBoundingClientRect().width,
        columns: [...document.querySelectorAll('table')].flatMap((table) => {
          const head = [...(table.tHead?.rows[0]?.cells ?? [])]
          const body = [...(table.tBodies[0]?.rows[0]?.cells ?? [])]
          return head.length === body.length && [...head, ...body].every((cell) => cell.colSpan === 1)
            ? head.map((cell, i) => Math.abs(cell.getBoundingClientRect().x - body[i].getBoundingClientRect().x)) : []
        }),
      }))
      assert(result.headerHeight <= 49, `${path} at ${width}px: header grew`)
      assert.equal(result.badgeForeground, 'rgb(255, 255, 255)', 'Filled badge uses white foreground')
      if (width === 768) {
        assert.notEqual(result.portVisibility, 'none', 'Language links remain visible on tablets')
        assert.notEqual(result.shortLabel, 'none', 'Tablet navigation uses abbreviated language names')
      }
      if (width >= 1024) assert.equal(result.shortLabel, 'none', 'Full language names fit with compact scheme controls')
      if (width >= 768) assert(result.languageEnd <= result.controlsStart, 'Language links do not overlap controls')
      if (width < 1536) assert(result.schemeLabelWidth <= 1, 'Compact color-scheme controls hide their text visually')
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
  await page.goto(`${base}/`, { waitUntil: 'load' })
  await page.locator('.scheme-switch input[value="dark"]').check({ force: true })
  const chipPixel = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.fillStyle = getComputedStyle(document.querySelector('.topnav-chip')).backgroundColor
    context.fillRect(0, 0, 1, 1)
    return [...context.getImageData(0, 0, 1, 1).data]
  })
  assert(chipPixel[2] > chipPixel[1] && chipPixel[1] > chipPixel[0],
    `Python dark chip must retain its blue-gray hue: ${chipPixel}`)
  const darkSurface = () => page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    foreground: getComputedStyle(document.body).color,
    navigation: getComputedStyle(document.querySelector('.topnav-chip:not([aria-current])')).color,
    notice: getComputedStyle(document.querySelector('.prerelease-notice')).backgroundColor,
  }))
  const pythonSurface = await darkSurface()
  await page.goto(`${base}/cxx/latest/mcp/`, { waitUntil: 'load' })
  assert.deepEqual(await darkSurface(), pythonSurface, 'C++ keeps the shared neutral dark surfaces')
  for (const mode of ['light', 'dark']) {
    await page.locator(`.scheme-switch input[value="${mode}"]`).check({ force: true })
    let reference
    for (const port of ['py/stable', 'swift/latest', 'go/latest', 'cxx/latest']) {
      await page.goto(`${base}/${port}/workspace/`, { waitUntil: 'load' })
      const reading = await page.evaluate(() => {
        const tokens = getComputedStyle(document.documentElement)
        const style = (selector) => getComputedStyle(document.querySelector(selector))
        return {
          text: style('.prose > p').color, heading: style('.prose h1').color,
          muted: tokens.getPropertyValue('--color-foreground-muted').trim(),
          background: style('body').backgroundColor,
          surface: tokens.getPropertyValue('--color-background-secondary').trim(),
          border: tokens.getPropertyValue('--color-background-border').trim(),
          nativeText: tokens.getPropertyValue('--lt-color-fg').trim(),
          nativeSurface: tokens.getPropertyValue('--lt-color-bg-secondary').trim(),
        }
      })
      reference ??= reading
      assert.deepEqual(reading, reference, `${port}: neutral ${mode} reading colors`)
    }
  }
  console.log('Reading colors: Python, Swift, Go and C++ share neutral light/dark text and surfaces')
  for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme })
    const noScript = await context.newPage()
    await noScript.goto(`${base}/concepts/server-session-window-pane/`, { waitUntil: 'load' })
    const checkContrast = async (scheme) => {
      const samples = await noScript.evaluate(() => {
        const context = document.createElement('canvas').getContext('2d')
        const luminance = (color) => {
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
            .map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
        }
        return ['h1', '.prose h2', '.prose p'].map((selector) => {
          const element = document.querySelector(selector)
          let parent = element
          while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement
          const values = [getComputedStyle(element).color, getComputedStyle(parent).backgroundColor]
            .map(luminance).sort((a, b) => b - a)
          return { selector, contrast: (values[0] + .05) / (values[1] + .05) }
        })
      })
      for (const sample of samples) assert(sample.contrast >= 4.5,
        `No-JS ${scheme} ${sample.selector} contrast: ${sample.contrast}`)
    }
    await checkContrast(colorScheme)
    const override = colorScheme === 'dark' ? 'light' : 'dark'
    await noScript.evaluate((mode) => { document.documentElement.dataset.themeMode = mode }, override)
    await checkContrast(`${colorScheme} with ${override} override`)
    await context.close()
  }
  console.log('Fresh Astro + browser: prose, workspace, MCP tools, API equivalents, 390–1600px header and dark hue PASS')
  await checkNavigation(page, base)
  for (const path of ['ts/latest/workspace/', 'ruby/latest/mcp/']) {
    await page.goto(`${base}/${path}`, { waitUntil: 'load' })
    const hero = page.locator('.port-hero, .product-hero').first()
    for (const width of [1440, 600, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      const logo = await hero.locator('img').first().boundingBox()
      const title = await hero.locator('h1').boundingBox()
      assert(Math.abs(logo.width - 88) < 0.01, `${path}: ${width}px logo width`)
      assert(Math.abs(logo.height - 88) < 0.01, `${path}: ${width}px logo height`)
      if (width >= 480) {
        assert(logo.x + logo.width <= title.x, `${path}: mark beside title`)
        assert(title.y < logo.y + logo.height, `${path}: title shares the logo row`)
      } else {
        assert(title.y >= logo.y + logo.height, `${path}: phone title follows mark`)
      }
      assert(title.x + title.width <= width, `${path}: heading fits the viewport`)
    }
  }
  console.log('Heroes: 88px marks share the title row and stack at phone widths')
} finally {
  await browser?.close()
  await server.stop()
}
