#!/usr/bin/env node
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from 'astro'
import { chromium, firefox, webkit } from 'playwright'
import { PORTS, productAvailable } from '../src/lib/ports.ts'
import { checkClipboard, checkCompleteApiExamples } from './check-clipboard.mjs'
import { checkApiExampleOwnership, checkApiNavigation, checkNavigation } from './check-navigation.mjs'
import { checkNativeLayout } from './check-native-layout.mjs'

const apiNavigationOnly = process.argv.includes('--api-navigation')
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
writeFileSync(join(root, 'src/content/docs/sidebar-free-layout.md'), `---
title: Empty table of contents
description: A reading page without section headings.
---

This article has no sections, so its content should fill the available column.
`)
for (const file of ['astro.config.ts', 'ec.config.mjs', 'package.json', 'tsconfig.json']) cpSync(join(source, file), join(root, file))
for (const file of ['public', 'node_modules']) symlinkSync(join(source, file), join(root, file), 'dir')
for (const file of ['scripts', 'packages', 'node_modules']) symlinkSync(join(source, '..', file), join(mirror, file), 'dir')
// Exercise the production reference page in the root server. Its model and
// owner are the same props its port route supplies, without another Vite boot.
writeFileSync(join(root, 'src/pages/api-example-probe.astro'), `---
import Reference from './reference/[...slug].astro'
import { API_MODELS } from '../lib/api-models'
const model = API_MODELS.ts
const owner = model.symbols.find((symbol) => symbol.id === 'pane.Pane.capture')
---
<Reference model={model} owner={owner} />
`)
for (const port of ['py', 'kotlin', 'scala', 'lua', 'go']) {
  const directory = join(root, `src/pages/${port}/latest/reference`)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '[...slug].astro'), `---
import Reference from '../../../reference/[...slug].astro'
import { API_MODELS } from '../../../../lib/api-models'
export function getStaticPaths() {
  const model = API_MODELS.${port}
  return [{ params: { slug: undefined }, props: { model } },
    ...model.symbols.map((owner) => ({ params: { slug: owner.slug }, props: { model, owner } }))]
}
const { model, owner } = Astro.props
---
<Reference model={model} owner={owner} />
`)
  writeFileSync(join(directory, 'tree.json.ts'), `
import { referenceTree } from '../../../../lib/api-tree'
export const GET = () => new Response(JSON.stringify(referenceTree('${port}')), {
  headers: { 'Content-Type': 'application/json' },
})
`)
}
writeFileSync(join(root, 'src/pages/lua/latest/index.astro'), `---
import Home from '../../index.astro'
---
<Home port="lua" />
`)
let server, browser
const terminate = async () => {
  await browser?.close()
  await server?.stop()
  process.exit(1)
}
process.on('SIGTERM', terminate)
process.on('SIGINT', terminate)
const startServer = () => dev({ root, cacheDir: join(mirror, 'cache'),
  vite: { cacheDir: join(mirror, 'vite') }, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 } })
server = await startServer()
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

async function checkReferenceAndHeroes(browser, base) {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  try {
    await checkApiExampleOwnership(page, base, 'api-example-probe/')
    for (const path of ['ts/latest/workspace/', 'ruby/latest/mcp/', 'cxx/latest/workspace/', 'cxx/latest/mcp/']) {
      await page.goto(`${base}/${path}`, { waitUntil: 'load' })
      const hero = page.locator('.port-hero, .product-hero').first()
      assert(!(await hero.locator('h1').textContent()).includes('(in development)'), `${path}: development stays in the callout`)
      const source = hero.getByRole('link', { name: 'GitHub', exact: true })
      assert.equal(await source.count(), 1, `${path}: source button belongs to the heading`)
      if (path.startsWith('cxx/')) {
        const product = path.includes('/mcp/') ? 'mcp' : 'workspace'
        assert.equal(await source.getAttribute('href'), `https://github.com/libtmux/libtmux-cxx/tree/master/apps/${product}`)
        assert.equal(await hero.locator('.port-link').count(), 1, 'C++ source applications do not advertise a registry package')
      } else {
        assert.equal(await hero.locator('.port-link').count(), 2, `${path}: source and registry buttons`)
      }
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
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server-livestate/`)
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Kotlin parameter and exception fields fit at ${width}px`)
      const namespace = await page.locator('.api-qualified-namespace').boundingBox()
      const copy = await page.getByRole('button', { name: 'Copy fully qualified name' }).boundingBox()
      const row = await page.locator('.api-qualified-name').boundingBox()
      const title = await page.locator('.api-reference-heading h1').boundingBox()
      assert(Math.abs(namespace.y + namespace.height / 2 - copy.y - copy.height / 2) < 2,
        `Package and copy control share a center line at ${width}px`)
      assert(row.height <= 32 && row.y - title.y - title.height <= 8,
        `Package stays in one compact row beneath the heading at ${width}px`)
    }
    for (const name of ['config', 'defaultTimeout', 'toKotlinDuration', 'Duration', 'CoroutineScope', 'StateFlow']) {
      assert(await page.locator('main a').filter({ hasText: new RegExp(`^${name}$`) }).count() > 0,
        `Kotlin liveState links ${name}`)
    }
    console.log('Native API: Kotlin call-chain links and parameter layout pass at 1440/768/390px')
    const qualified = page.locator('.api-qualified-name')
    const fullName = 'io.github.libtmux.kotlin.Server.liveState'
    assert.equal((await qualified.locator('.api-qualified-namespace').textContent()).trim(), 'io.github.libtmux.kotlin')
    for (const reject of [false, true]) {
      await page.evaluate((reject) => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          writeText: async (text) => {
            window.__copiedQualifiedName = text
            if (reject) throw new Error('Clipboard denied')
          },
        } })
      }, reject)
      await qualified.getByRole('button', { name: 'Copy fully qualified name' }).click()
      await page.waitForFunction((reject) => document.querySelector('.api-copy-status').textContent
        .startsWith(reject ? 'Copy failed' : 'Name copied'), reject)
      assert.equal(await page.evaluate(() => window.__copiedQualifiedName), fullName)
    }
    const anchors = await page.locator('[id]').evaluateAll((elements) => elements.map((element) => element.id))
    assert.equal(anchors.filter((id) => id === fullName).length, 1, 'Page title and declaration have distinct anchors')
    console.log('Qualified names: compact package row, exact copied identity and clipboard refusal pass')
    await page.setViewportSize({ width: 1440, height: 900 })
    const contents = page.getByRole('navigation', { name: 'On this page', exact: true })
    assert(await contents.isVisible(), 'Wide reference pages show section navigation')
    assert.deepEqual(await page.locator('[data-api-section-link]').evaluateAll((links) => links
      .map((link) => decodeURIComponent(link.hash.slice(1)))
      .filter((id) => [...document.querySelectorAll('[id]')].filter((element) => element.id === id).length !== 1)), [],
    'Every reference section link has exactly one target')
    await contents.getByRole('link', { name: 'Parameters', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('api-page-contents a[aria-current="location"]')?.textContent === 'Parameters')
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server/`)
    const memberNames = await page.locator('.api-member-link').allTextContents()
    assert.deepEqual(memberNames.slice(0, 3), ['sessions', 'windows', 'panes'])
    assert.equal(new Set(memberNames).size, memberNames.length, 'Grouped members appear once')
    assert(await page.getByRole('navigation', { name: 'Related APIs' }).getByRole('link', { name: 'io.github.libtmux.kotlin.Session', exact: true }).count())
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.locator('api-page-contents').isVisible(), width >= 1360)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Reference columns fit at ${width}px`)
    }
    console.log('Reference contents: section targets, active links, related declarations and grouped member order pass')
    await page.goto(`${base}/scala/latest/reference/io-github-libtmux-scaladsl-server-windows/`)
    const signature = page.locator('dt.api-native-header').first()
    const links = await signature.locator('.api-native-signature a').evaluateAll((elements) =>
      elements.map((element) => ({ name: element.textContent, href: element.getAttribute('href') })))
    for (const name of ['def', 'extension', 'self', 'windows', 'id', 'expression']) {
      assert(!links.some((link) => link.name === name), `${name} is a declaration token, not an API link`)
    }
    for (const name of ['Server', 'Window', 'io.github.libtmux.WindowId']) {
      assert(links.some((link) => link.name === name), `Scala signature links ${name}`)
    }
    assert(links.filter((link) => link.name === 'Vector').every((link) =>
      link.href === 'https://www.scala-lang.org/api/3.x/scala/collection/immutable/Vector.html'),
    'Scala Vector links to its own collection type')
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const header = await signature.boundingBox()
      const code = await signature.locator('.gp-sphinx-api-layout-left:visible, .gp-sphinx-api-layout-bottom:visible').boundingBox()
      assert(code.width >= header.width - 36, `Scala overloads use the signature width at ${width}px`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Scala overloads fit at ${width}px`)
    }
    console.log('Scala overloads: only API symbols link, Vector resolves to Scala, and badges leave the full code width')
  } finally {
    await page.close()
  }
}

try {
  // Compile the first page during setup; navigation assertions measure
  // the running app. The outer loop still budgets this initial compilation.
  const firstPage = apiNavigationOnly ? '/lua/latest/reference/libtmux-server/' : '/concepts/server-session-window-pane/'
  const ready = fetch(`${base}${firstPage}`).then(async (response) => {
    assert(response.ok, `Browser setup: HTTP ${response.status} at ${firstPage}`)
    await response.text()
  })
  const engine = process.env.LIBTMUX_DOCS_BROWSER ?? 'chromium'
  const driver = { chromium, firefox, webkit }[engine]
  if (!driver) throw new Error(`Unknown browser: ${engine}`)
  browser = await driver.launch(engine === 'chromium' ? { channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL } : {})
  await ready
  if (apiNavigationOnly) {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    page.setDefaultTimeout(10000)
    await retryReload(() => checkApiNavigation(page, base))
  } else {
    const nativeLayout = checkNativeLayout(browser).then(() => null, (error) => error)
    const apiExamples = checkCompleteApiExamples(browser, base).then(() => null, (error) => error)
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    page.setDefaultTimeout(10000)
    const manifest = await page.request.get(`${base}/page-links.json`)
    assert(manifest.ok(), `Native navigation manifest: HTTP ${manifest.status()}`)
    assert.equal((await manifest.json()).schema, 1)
    const clipboardPage = await browser.newPage()
    clipboardPage.setDefaultTimeout(10000)
    const clipboard = checkClipboard(clipboardPage, base).then(() => null, (error) => error)
    const navigationPage = await browser.newPage({ reducedMotion: 'reduce' })
    navigationPage.setDefaultTimeout(10000)
    const navigation = retryReload(() => checkNavigation(navigationPage, base)).then(() => null, (error) => error)
    const reference = checkReferenceAndHeroes(browser, base).then(() => null, (error) => error)
    const apiNavigationPage = await browser.newPage({ reducedMotion: 'reduce' })
    apiNavigationPage.setDefaultTimeout(10000)
    const apiNavigation = retryReload(() => checkApiNavigation(apiNavigationPage, base)).then(() => null, (error) => error)
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
        if (hasSwitcher) {
          const selector = await switcher.locator('summary').boundingBox()
          const action = await page.locator('[data-page-actions] > summary').boundingBox()
          const icon = await page.locator('[data-page-actions] > summary > svg').boundingBox()
          assert(Math.abs(action.height - selector.height) < 0.1, `${path}: page controls have equal height at ${width}px`)
          assert(Math.abs(action.y - selector.y) < 0.1, `${path}: page controls align at ${width}px`)
          assert(Math.abs(icon.x + icon.width / 2 - action.x - action.width / 2) < 0.1, `${path}: action icon centered horizontally`)
          assert(Math.abs(icon.y + icon.height / 2 - action.y - action.height / 2) < 0.1, `${path}: action icon centered vertically`)
        }
      }

      if (hasSwitcher) {
        assert.equal(await switcher.count(), 1, `${path}: one page port switcher`)
        await switcher.locator('summary').click()
        const menu = await switcher.locator('ul').boundingBox()
        assert(menu && menu.x >= 0 && menu.x + menu.width <= 390, `${path}: dropdown leaves phone viewport`)
      }
    })
    for (const path of [
      'py/latest/reference/libtmux-server',
      'py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder',
      'java/latest/workspace/reference/io-github-libtmux-workspace-workspacebuilder-workspacebuilder',
    ]) await retryReload(async () => {
      const response = await page.goto(`${base}/${path}/`, { waitUntil: 'load' })
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.evaluate(() => document.fonts.ready)
      await page.locator('.api-elsewhere').evaluateAll((entries) => entries.forEach((entry) => { entry.open = true }))
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
        assert(overflow <= 1, `${path} at ${width}px: declaration page overflow ${overflow}px`)
      }
    })
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`${base}/sidebar-free-layout/`, { waitUntil: 'load' })
      const reading = await page.evaluate(() => {
        const main = document.querySelector('main')
        const article = main.querySelector('article')
        return {
          unused: main.getBoundingClientRect().width - article.getBoundingClientRect().width,
          rightSidebar: main.nextElementSibling?.tagName === 'ASIDE',
          toc: document.querySelector('starlight-toc') !== null,
        }
      })
      assert(reading.unused < 1 && !reading.rightSidebar && !reading.toc,
        `Empty table of contents at ${width}px must leave no unused article column: ${JSON.stringify(reading)}`)
      await page.goto(`${base}/reference/`, { waitUntil: 'load' })
      const reference = await page.evaluate(() => {
        const main = document.querySelector('main')
        return { children: main.children.length,
          unused: main.getBoundingClientRect().width - main.lastElementChild.getBoundingClientRect().width }
      })
      assert(reference.children === 1 && reference.unused < 1,
        `Reference index at ${width}px must not reserve an empty navigation column: ${JSON.stringify(reference)}`)
    }
    console.log('Empty sidebars: article and reference index use their available width')
    const clipboardError = await clipboard
    if (clipboardError) throw clipboardError
    const nativeLayoutError = await nativeLayout
    if (nativeLayoutError) throw nativeLayoutError
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
      await page.setViewportSize({ width: 390, height: 844 })
      await page.emulateMedia({ colorScheme })
      await page.goto(`${base}/concepts/server-session-window-pane/`, { waitUntil: 'load' })
      const toolbar = await page.evaluate(() => {
        delete document.documentElement.dataset.themeMode
        const style = (selector) => getComputedStyle(document.querySelector(selector))
        return { background: style('.mobile-toolbar').backgroundColor, page: style('body').backgroundColor,
          icon: style('.toolbar-button').color, text: style('body').color }
      })
      assert.equal(toolbar.background, toolbar.page, `${colorScheme}: toolbar uses the page surface before theme initialization`)
      assert.equal(toolbar.icon, toolbar.text, `${colorScheme}: toolbar icons use the page text color`)
      const context = await browser.newContext({ javaScriptEnabled: false, colorScheme, viewport: { width: 390, height: 844 } })
      const noScript = await context.newPage()
      await noScript.goto(`${base}/concepts/server-session-window-pane/`, { waitUntil: 'load' })
      const checkContrast = async (scheme, selectors = ['h1', '.prose h2', '.prose p']) => {
        const samples = await noScript.evaluate((selectors) => {
          const context = document.createElement('canvas').getContext('2d')
          const luminance = (color) => {
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
              .map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
          }
          return selectors.map((selector) => {
            const element = document.querySelector(selector)
            let parent = element
            while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement
            const values = [getComputedStyle(element).color, getComputedStyle(parent).backgroundColor]
              .map(luminance).sort((a, b) => b - a)
            return { selector, contrast: (values[0] + .05) / (values[1] + .05), opacity: getComputedStyle(element).opacity }
          })
        }, selectors)
        for (const sample of samples) {
          assert(sample.contrast >= 4.5, `No-JS ${scheme} ${sample.selector} contrast: ${sample.contrast}`)
          assert.equal(sample.opacity, '1', `${scheme} ${sample.selector} remains fully legible`)
        }
      }
      await checkContrast(colorScheme)
      assert.equal(await noScript.locator('.mobile-toolbar').isVisible(), false, 'No-JS hides inactive drawer buttons')
      assert.equal(await noScript.locator('.mobile-fallback').isVisible(), true, 'No-JS has usable mobile navigation')
      await checkContrast(colorScheme, ['.mobile-fallback summary'])
      const browse = noScript.locator('.mobile-fallback > details').first()
      await browse.locator('summary').first().focus()
      await noScript.keyboard.press('Enter')
      assert.equal(await browse.getAttribute('open'), '', 'Keyboard opens the native navigation disclosure')
      assert.equal(await browse.locator('a:visible').count() > 0, true, 'The navigation disclosure exposes links')
      await browse.locator('summary').first().click()
      const contents = noScript.locator('.mobile-fallback > details').nth(1)
      await contents.locator('summary').click()
      const destination = await contents.locator('a').first().getAttribute('href')
      await contents.locator('a').first().click()
      assert.equal(new URL(noScript.url()).hash, destination, 'No-JS contents reaches its section')
      const override = colorScheme === 'dark' ? 'light' : 'dark'
      await noScript.evaluate((mode) => { document.documentElement.dataset.themeMode = mode }, override)
      await checkContrast(`${colorScheme} with ${override} override`)
      await noScript.goto(`${base}/scala/latest/reference/io-github-libtmux-scaladsl-server-windows/`)
      await checkContrast(colorScheme, ['.api-native-signature .api-type-label', '.api-native-signature .api-punct'])
      await context.close()
    }
    console.log('Fresh Astro + browser: prose, workspace, MCP tools, API equivalents, 390–1600px header and dark hue PASS')
    const navigationError = await navigation
    const apiExamplesError = await apiExamples
    if (apiExamplesError) throw apiExamplesError
    if (navigationError) throw navigationError
    await navigationPage.close()
    const referenceError = await reference
    if (referenceError) throw referenceError
    const apiNavigationError = await apiNavigation
    if (apiNavigationError) throw apiNavigationError
    await apiNavigationPage.close()
    await clipboardPage.close()
  }
} finally {
  await browser?.close()
  await server.stop()
}
