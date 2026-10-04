#!/usr/bin/env node
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dev } from 'astro'
import { chromium, firefox, webkit } from 'playwright'
import { API_MODEL_PORTS, PORTS, productAvailable } from '../src/lib/ports.ts'
import { checkClipboard, checkCompleteApiExamples } from './check-clipboard.mjs'
import { checkApiExampleOwnership, checkApiNavigation, checkDocumentationNavigation, checkNavigation } from './check-navigation.mjs'
import { checkNativeLayout } from './check-native-layout.mjs'
import { checkReferencePreferences, checkGlobalHeader } from './check-reference-preferences.mjs'
import { checkHomeLauncher } from './check-home-launcher.mjs'

const apiNavigationOnly = process.argv.includes('--api-navigation')
const apiSignaturesOnly = process.argv.includes('--api-signatures')
const referenceLayoutOnly = process.argv.includes('--reference-layout')
const keywordHelpOnly = process.argv.includes('--keyword-help')
const signaturePorts = apiSignaturesOnly ? API_MODEL_PORTS
  : API_MODEL_PORTS.filter((port) => ['py', 'ts'].includes(port.slug))
const referencePreferencesOnly = process.argv.includes('--reference-preferences')
const globalHeaderOnly = process.argv.includes('--global-header')
const homeLauncherOnly = process.argv.includes('--home-launcher')
const documentationNavigationOnly = process.argv.includes('--documentation-navigation')
const workspacePortCount = PORTS.filter((port) => productAvailable(port, 'workspace')).length

Object.assign(process.env, {
  LIBTMUX_DOCS_SITE: 'https://libtmux.org',
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
writeFileSync(join(root, 'src/pages/sidebar-free-layout.astro'), `---
import DocsLayout from '../layouts/DocsLayout.astro'
---
<DocsLayout title="Empty table of contents" description="A reading page without section headings." pagePath="sidebar-free-layout">
  <p>This article has no sections, so its content should fill the available column.</p>
</DocsLayout>
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
writeFileSync(join(root, 'src/pages/api-signature-probe.astro'), `---
import ApiEntry from '../components/api/ApiEntry.astro'
import DocsLayout from '../layouts/DocsLayout.astro'
import { API_MODELS, indexFor } from '../lib/api-models'
import { API_MODEL_PORTS, referenceUrl } from '../lib/ports'
import '../styles/api.css'
import '../styles/vendor/gp-sphinx-api.css'
const entries = API_MODEL_PORTS.filter(({ slug }) => ${JSON.stringify(signaturePorts.map((port) => port.slug))}.includes(slug))
  .flatMap(({ slug: port }) => {
  const model = API_MODELS[port]
  const callable = model.symbols.filter((symbol) => symbol.signatures.some((signature) =>
    signature.params.length > 0 && signature.returns))
  const symbol = callable.find((symbol) => /capture/i.test(symbol.name)) ?? callable[0]
  const scalar = model.symbols.find((symbol) => symbol.signatures.length === 0 && symbol.type && symbol.value)
  return [symbol, scalar].filter(Boolean).map((symbol) => ({ port, model, symbol }))
})
---
<DocsLayout title="API signature layout" tableOfContents={false}>
  {entries.map(({ port, model, symbol }) => (
    <section data-signature-port={port} data-signature-model={JSON.stringify(symbol)}>
      <ApiEntry symbol={{ ...symbol, doc: undefined }} index={indexFor(model, (entry) => referenceUrl(port, entry.slug))} port={port} />
    </section>
  ))}
</DocsLayout>
`)
for (const { slug: port } of PORTS) {
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
  writeFileSync(join(root, `src/pages/${port}/latest/index.astro`), `---
import Home from '../../index.astro'
---
<Home port="${port}" />
`)
}
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

async function checkSignatureLayouts(browser, base) {
  const page = await browser.newPage({ javaScriptEnabled: false })
  try {
    await page.goto(`${base}/api-signature-probe/`, { waitUntil: 'load' })
    const entries = page.locator('[data-signature-port]')
    assert.equal(new Set(await entries.evaluateAll((elements) => elements.map((entry) =>
      entry.dataset.signaturePort))).size, signaturePorts.length)
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const entry of await entries.all()) {
        const port = await entry.getAttribute('data-signature-port')
        const model = JSON.parse(await entry.getAttribute('data-signature-model'))
        const signature = entry.locator('.gp-sphinx-api-signature:visible')
        assert.equal(await signature.count(), 1, `${port}: one visible signature at ${width}px`)
        const clean = (text) => text.replace(/\s+/g, ' ').trim()
        assert.equal(await entry.locator('.gp-sphinx-api-signature').count(), 1,
          `${port}: one declaration serves every layout`)
        for (const fold of await signature.locator('details').all()) {
          if (await fold.getAttribute('open') === null) {
            await fold.locator('summary').focus()
            await page.keyboard.press('Enter')
          }
        }
        const visibleText = clean(await signature.innerText())
        if (await signature.locator('.api-native-signature').count()) {
          for (const declaration of model.signatures) assert(visibleText.includes(clean(declaration.raw)),
            `${port}: native declaration survives at ${width}px`)
        } else {
          assert.deepEqual(await signature.locator('.sig-param > .n').allTextContents(),
            model.signatures.flatMap((declaration) => declaration.params.map((param) => param.name)),
            `${port}: all parameters survive at ${width}px`)
          assert.deepEqual((await signature.locator('.sig-return-typehint').allTextContents()).map(clean),
            model.signatures.flatMap((declaration) => declaration.returns ? [clean(declaration.returns)] : []),
            `${port}: all return types survive at ${width}px`)
          for (const declaration of model.signatures) {
            for (const param of declaration.params) {
              if (param.default) assert(visibleText.includes(param.default), `${port}: default remains visible`)
            }
          }
          if (model.signatures.length === 0) {
            assert(visibleText.includes(clean(model.type)), `${port}: attribute type survives`)
            assert(visibleText.includes(model.value), `${port}: attribute value survives`)
          }
        }
        assert(await signature.evaluate((element) => element.getBoundingClientRect().right <= innerWidth + 1),
          `${port}: declaration fits at ${width}px`)
      }
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `API signatures fit at ${width}px`)
    }
    console.log(`API signatures: ${signaturePorts.length} ports retain declarations without JavaScript at 1440/768/390px`)
    await page.goto(`${base}/fsharp/latest/reference/libtmux-fsharp-server/`, { waitUntil: 'load' })
    const module = page.locator('dt[data-symbol-id="LibTmux.FSharp.Server"]')
    for (const colorScheme of apiSignaturesOnly ? ['light', 'dark'] : ['light']) {
      await page.emulateMedia({ colorScheme })
      for (const width of [1440, 803, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const code = await module.locator('.gp-sphinx-api-layout-left').boundingBox()
        const toolbar = await module.locator('.gp-sphinx-api-layout-right').boundingBox()
        assert(Math.abs(code.y + code.height / 2 - toolbar.y - toolbar.height / 2) < 2,
          `${colorScheme}/${width}px: module declaration and toolbar share a row`)
        assert(code.x + code.width <= toolbar.x, `${colorScheme}/${width}px: declaration does not overlap controls`)
        assert((await module.boundingBox()).height < 50, `${colorScheme}/${width}px: short module header stays compact`)
      }
    }
    await page.goto(`${base}/fsharp/latest/reference/libtmux-fsharp-server-tryfindclient/`, { waitUntil: 'load' })
    const declaration = page.locator('dt[data-symbol-id="LibTmux.FSharp.Server.tryFindClient"]')
    for (const colorScheme of apiSignaturesOnly ? ['light', 'dark'] : ['light']) {
      await page.emulateMedia({ colorScheme })
      for (const width of [1440, 803, 390]) {
        await page.setViewportSize({ width, height: 900 })
        const keyword = declaration.locator('.api-keyword', { hasText: 'val' })
        const name = declaration.locator('.api-declaration-name')
        assert.equal(await name.innerText(), 'tryFindClient')
        const colors = await Promise.all([keyword, name, declaration.locator('.api-parameter-name').first()]
          .map((token) => token.evaluate((element) => getComputedStyle(element).color)))
        assert.equal(new Set(colors).size, 3, `${colorScheme}/${width}px: keyword, function and parameters are distinct`)
        for (const arrow of await declaration.locator('.api-operator').all()) {
          assert.equal(await arrow.evaluate((element) => element.getClientRects().length), 1,
            `${colorScheme}/${width}px: arrows remain intact`)
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${colorScheme}/${width}px: F# signature fits`)
        if (width === 803) {
          const first = await keyword.boundingBox()
          const parameter = await declaration.locator('.api-parameter-name').first().boundingBox()
          assert(Math.abs(first.y + first.height / 2 - parameter.y - parameter.height / 2) < 2,
            'F# source indentation does not force an empty signature row')
        }
      }
    }
    assert.equal(await page.locator('.gp-sphinx-api-parameters a', { hasText: 'System.ArgumentException' })
      .getAttribute('href'), 'https://learn.microsoft.com/dotnet/api/system.argumentexception')
    await page.goto(`${base}/kotlin/latest/reference/`, { waitUntil: 'load' })
    const helper = page.locator('.api-index-card[id="io.github.libtmux.kotlin.withServer"]')
    assert.equal(await helper.count(), 1, 'Kotlin withServer has one index card')
    assert.equal(await page.locator('.api-index-section .gp-sphinx-api-container').count(), 0,
      'Browse pages link to declarations instead of expanding them inline')
    await helper.locator('.api-index-card__link').click()
    assert.match(page.url(), /\/reference\/io-github-libtmux-kotlin-withserver\/$/,
      'The function card opens its individual reference page')
    assert.equal(await page.locator('dt[data-symbol-id="io.github.libtmux.kotlin.withServer"]').count(), 1,
      'The individual page retains the complete declaration')
    const kotlin = page.locator('dt[data-symbol-id="io.github.libtmux.kotlin.withServer"]')
    for (const colorScheme of apiSignaturesOnly ? ['light', 'dark'] : ['light']) {
      await page.emulateMedia({ colorScheme })
      for (const width of apiSignaturesOnly ? [1920, 1440, 803, 768, 390, 320] : [803, 390]) {
        await page.setViewportSize({ width, height: 1000 })
        const code = await kotlin.locator('.gp-sphinx-api-layout-left').boundingBox()
        const toolbar = await kotlin.locator('.gp-sphinx-api-layout-right').boundingBox()
        if (width === 803 || width === 1920) {
          assert(Math.abs(code.y - toolbar.y) < 2,
            `${colorScheme}/${width}px: toolbar shares the declaration's first row when it fits`)
          assert(code.x + code.width <= toolbar.x,
            `${colorScheme}/${width}px: declaration leaves room for its toolbar`)
        }
        if (width <= 390) {
          assert(toolbar.y >= code.y + code.height,
            `${colorScheme}/${width}px: toolbar follows the full-width signature`)
        }
        assert(toolbar.height < 30, `${colorScheme}/${width}px: badges and links stay in one compact row`)
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          `${colorScheme}/${width}px: declaration and toolbar fit without clipping`)
      }
    }
    console.log('Native browse layout: compact F# modules and linked Kotlin function cards work without JavaScript')
  } finally {
    await page.close()
  }
}

async function checkKeywordHelp(browser, base) {
  const fullMatrix = apiSignaturesOnly || keywordHelpOnly
  for (const javaScriptEnabled of [false, true]) {
    const page = await browser.newPage({ javaScriptEnabled })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(5000)
    try {
      for (const colorScheme of fullMatrix ? ['light', 'dark'] : ['light']) {
        await page.emulateMedia({ colorScheme })
        for (const width of fullMatrix ? [803, 390] : [390]) {
          await page.setViewportSize({ width, height: 900 })
          await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-withserver/`)
          await page.evaluate(() => document.fonts.ready)
          const trigger = page.locator('dt.api-native-header .api-keyword-trigger').first()
          const id = await trigger.getAttribute('popovertarget')
          const panel = page.locator(`[id="${id}"]`)
          const declaration = page.locator('dt.api-native-header').first()
          await trigger.scrollIntoViewIfNeeded()
          const before = await declaration.boundingBox()
          await trigger.focus()
          if (!javaScriptEnabled) await page.keyboard.press('Enter')
          await panel.waitFor({ state: 'visible' })
          if (javaScriptEnabled) await page.evaluate(() => new Promise(requestAnimationFrame))
          const box = await panel.boundingBox()
          assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 901,
            `${colorScheme}/${width}px/JS=${javaScriptEnabled}: keyword help stays inside the viewport`)
          if (!javaScriptEnabled) {
            assert(Math.abs(box.x + box.width / 2 - width / 2) < 1 && Math.abs(box.y + box.height / 2 - 450) < 1,
              'Native keyword help stays centered without JavaScript')
          }
          const after = await declaration.boundingBox()
          assert.equal(after.height, before.height, 'Keyword help does not change the signature height')
          const docs = panel.getByRole('link', { name: 'Language documentation' })
          assert.equal(await docs.getAttribute('href'), 'https://kotlinlang.org/docs/coroutines-basics.html#suspending-functions')
          await page.keyboard.press('Tab')
          assert(await docs.evaluate((element) => element === document.activeElement), 'Tab reaches the documentation link')
          await page.keyboard.press('Escape')
          await panel.waitFor({ state: 'hidden' })
          await page.setViewportSize({ width, height: 360 })
          await page.keyboard.press('Enter')
          await panel.waitFor({ state: 'visible' })
          if (javaScriptEnabled) await page.evaluate(() => new Promise(requestAnimationFrame))
          const reopened = await panel.boundingBox()
          assert(reopened.y >= 0 && reopened.y + reopened.height <= 361,
            'Keyboard reopening after a resize uses the current viewport')
          await page.keyboard.press('Escape')
          await panel.waitFor({ state: 'hidden' })
          await page.setViewportSize({ width, height: 900 })
          await trigger.click()
          await panel.waitFor({ state: 'visible' })
          await panel.getByRole('button', { name: 'Close', exact: true }).click()
          await panel.waitFor({ state: 'hidden' })
          if (javaScriptEnabled) {
            await page.mouse.move(0, 0)
            await trigger.evaluate((element) => element.blur())
            await trigger.hover()
            await panel.waitFor({ state: 'visible' })
            await docs.hover()
            assert(await panel.isVisible(), 'Hover help stays open while reaching its link')
            await docs.focus()
            await page.setViewportSize({ width, height: 360 })
            await page.evaluate(async () => {
              window.scrollTo(0, 0)
              await new Promise(requestAnimationFrame)
            })
            const resized = await panel.boundingBox()
            assert(resized.y >= 0 && resized.y + resized.height <= 361,
              'Open help remains in view after scrolling its keyword offscreen')
            await page.keyboard.press('Escape')
          }
        }
      }
      assert.deepEqual(errors, [], 'Keyword help does not raise JavaScript errors')
    } finally {
      await page.close()
    }
  }
  console.log('Keyword help: official docs, hover, keyboard, dismissal and viewport bounds pass with and without JavaScript')
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
    const namespace = qualified.locator('.api-qualified-namespace')
    assert.equal(await namespace.innerText(), 'i.g.l.kotlin')
    assert.equal(await namespace.getAttribute('title'), 'io.github.libtmux.kotlin')
    const expand = qualified.getByRole('button', { name: 'Show full name', exact: true })
    await expand.focus()
    await page.keyboard.press('Enter')
    assert.equal(await namespace.innerText(), 'io.github.libtmux.kotlin')
    assert.equal(await qualified.locator('[data-api-expand-name]').getAttribute('aria-expanded'), 'true')
    await page.keyboard.press('Enter')
    assert.equal(await namespace.innerText(), 'i.g.l.kotlin')
    assert.equal(await expand.getAttribute('aria-expanded'), 'false')
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
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server-session/`)
    const errors = page.locator('[id="io.github.libtmux.kotlin.Server.session.errors"] + dd')
    assert.match(await errors.innerText(), /NoMatch/)
    assert.match(await errors.innerText(), /MultipleMatches/)
    assert.match(await errors.innerText(), /session\(expression\)/, 'Errors identify the expression overload')
    const fieldIds = await page.locator('.gp-sphinx-api-parameters [id]').evaluateAll((elements) => elements.map((element) => element.id))
    assert.equal(fieldIds.length, new Set(fieldIds).size, 'Overload parameters retain unique anchors')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Overload field labels fit on a phone')
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-options-get/`)
    assert(await page.locator('[id="io.github.libtmux.kotlin.Options.get.returns"] + dd').innerText(),
      'The earlier get overload retains its return documentation')
    console.log('Overload contracts: earlier errors and returns render with their owning calls and unique anchors')
    for (const [slug, qualifiedName] of [
      ['server-server', 'io.github.libtmux.Server'],
      ['server-server-builder-dv7l', 'io.github.libtmux.Server.Builder'],
      ['server-server-sessions', 'io.github.libtmux.Server.sessions'],
    ]) {
      await page.goto(`${base}/java/latest/reference/io-github-libtmux-${slug}/`)
      assert.equal(await page.title(), `${qualifiedName} | libtmux-java`)
      assert.equal(await page.locator('.api-qualified-namespace').innerText(), 'i.g.libtmux')
      await page.getByRole('button', { name: 'Show full name', exact: true }).click()
      assert.equal(await page.locator('.api-qualified-namespace').innerText(), 'io.github.libtmux')
      assert.equal(await page.locator('[data-api-copy-name]').getAttribute('data-api-copy-name'), qualifiedName)
      assert.equal(await page.locator('main h1').getAttribute('id'), qualifiedName.replace('libtmux.Server', 'libtmux.Server.Server'))
      assert(await page.locator('.api-qualified-name').textContent().then((text) => text.includes(qualifiedName)),
        `${qualifiedName}: complete source name remains in accessible HTML`)
      if (!qualifiedName.endsWith('.sessions')) {
        const legacyId = qualifiedName.replace('libtmux.Server', 'libtmux.Server.Server')
        const declaration = page.locator(`dt[data-symbol-id="${legacyId}"]`)
        assert.equal(await declaration.getAttribute('id'), `${legacyId}.declaration`)
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 })
          const signature = declaration.locator('.gp-sphinx-api-signature:visible')
          assert.equal((await signature.locator(':scope > .sig-prename, :scope > .sig-name').allTextContents()).join(''), qualifiedName,
            `${width}px ${qualifiedName}: visible declaration uses its source-qualified name`)
        }
      }
    }
    await page.goto(`${base}/java/latest/mcp/reference/io-github-libtmux-mcp-main-main/`)
    const productDeclaration = page.locator('dt[data-symbol-id="io.github.libtmux.mcp.Main.Main"]')
    assert.equal(await productDeclaration.getAttribute('id'), 'io.github.libtmux.mcp.Main.Main')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      const signature = productDeclaration.locator('.gp-sphinx-api-signature:visible')
      assert.equal((await signature.locator(':scope > .sig-prename, :scope > .sig-name').allTextContents()).join(''), 'io.github.libtmux.mcp.Main',
        `${width}px Java product declaration uses its source-qualified name`)
    }
    const manifest = await page.request.get(`${base}/docs.json`).then((response) => response.json())
    const javaReference = manifest.pages.find((entry) => new URL(entry.url).pathname.endsWith('/java/latest/reference/'))
    assert.equal(javaReference.title, 'API reference')
    assert.deepEqual(javaReference.symbols.find((entry) => entry.id === 'io.github.libtmux.Server.Server'), {
      id: 'io.github.libtmux.Server.Server', name: 'Server', kind: 'class',
      url: 'https://libtmux.org/en/java/latest/reference/io-github-libtmux-server-server/',
      qualifiedName: 'io.github.libtmux.Server', namespace: 'io.github.libtmux',
    }, 'Java manifest records source identity alongside its stable declaration URL')
    await page.goto(`${base}/kotlin/latest/reference/io-github-libtmux-kotlin-server/`)
    const javaEquivalent = page.locator('.api-elsewhere a[href$="/java/latest/reference/io-github-libtmux-server-server/"]')
    assert.equal(await javaEquivalent.textContent().then((text) => text.trim()), 'io.github.libtmux.Server',
      'Equivalent Java API labels use the target source identity while retaining its stable URL')
    console.log('Java names: source package and exact qualified names render without changing declaration anchors')
  } finally {
    await page.close()
  }
}

try {
  // Compile the first page during setup; navigation assertions measure
  // the running app. The outer loop still budgets this initial compilation.
  const firstPage = keywordHelpOnly ? '/kotlin/latest/reference/io-github-libtmux-kotlin-withserver/'
    : documentationNavigationOnly ? '/py/latest/' : apiSignaturesOnly ? '/api-signature-probe/'
    : apiNavigationOnly ? '/lua/latest/reference/libtmux-server/' : '/tmux/concepts/server-session-window-pane/'
  const ready = fetch(`${base}${firstPage}`).then(async (response) => {
    assert(response.ok, `Browser setup: HTTP ${response.status} at ${firstPage}`)
    await response.text()
  })
  const engine = process.env.LIBTMUX_DOCS_BROWSER ?? 'chromium'
  const driver = { chromium, firefox, webkit }[engine]
  if (!driver) throw new Error(`Unknown browser: ${engine}`)
  browser = await driver.launch(engine === 'chromium' ? { channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL } : {})
  await ready
  if (homeLauncherOnly) {
    await checkHomeLauncher(browser, base)
  } else if (keywordHelpOnly) {
    await retryReload(() => checkKeywordHelp(browser, base))
  } else if (apiSignaturesOnly) {
    await checkSignatureLayouts(browser, base)
    await retryReload(() => checkKeywordHelp(browser, base))
  } else if (referenceLayoutOnly) {
    await retryReload(() => checkReferenceAndHeroes(browser, base))
    await checkSignatureLayouts(browser, base)
    await retryReload(() => checkKeywordHelp(browser, base))
  } else if (globalHeaderOnly) {
    await retryReload(() => checkGlobalHeader(browser, base))
  } else if (referencePreferencesOnly) {
    await retryReload(() => checkReferencePreferences(browser, base))
    await retryReload(() => checkGlobalHeader(browser, base))
  } else if (documentationNavigationOnly) {
    await retryReload(() => checkDocumentationNavigation(browser, base, true))
  } else if (apiNavigationOnly) {
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
    const reference = checkReferenceAndHeroes(browser, base).then(() => checkSignatureLayouts(browser, base))
      .then(() => retryReload(() => checkKeywordHelp(browser, base)))
      .then(() => null, (error) => error)
    const preferences = checkReferencePreferences(browser, base).then(() => null, (error) => error)
    const globalHeader = checkGlobalHeader(browser, base).then(() => null, (error) => error)
    const homeLauncher = checkHomeLauncher(browser, base).then(() => null, (error) => error)
    const documentationNavigation = retryReload(() => checkDocumentationNavigation(browser, base)).then(() => null, (error) => error)
    const apiNavigationPage = await browser.newPage({ reducedMotion: 'reduce' })
    apiNavigationPage.setDefaultTimeout(10000)
    const apiNavigation = retryReload(() => checkApiNavigation(apiNavigationPage, base)).then(() => null, (error) => error)
    const paths = ['tmux/concepts/server-session-window-pane', 'tmux/examples/attach-and-send-keys', 'mcp/tools', 'ts/latest/workspace/reference/builder-applyworkspace',
      'ts/latest/workspace/internals/guides', 'py/stable/workspace/guides',
      'ts/latest/mcp/tools', 'dotnet/latest/mcp/tools/capture_pane']
    for (const path of paths) await retryReload(async () => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      const response = await page.goto(`${base}/${path}/`, { waitUntil: 'load' })
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.locator('header nav[aria-label="Documentation destinations"]').count(), 0)
      const switcher = page.locator('[data-page-port-switcher]')
      const portLinks = switcher.locator('a[data-port]')
      const hasSwitcher = path !== 'mcp/tools'
      assert.equal(await switcher.count(), hasSwitcher ? 1 : 0, `${path}: one page language switcher when available`)
      const isReference = path.includes('/reference/')
      if (hasSwitcher) {
        assert.equal(await page.locator('[data-page-toolbar] nav[aria-label="Breadcrumb"]').count(), 1, `${path}: breadcrumbs above the heading`)
        const geometry = await page.evaluate(() => {
          const toolbar = document.querySelector('[data-page-toolbar]').getBoundingClientRect()
          const breadcrumb = document.querySelector('[data-page-toolbar] nav').getBoundingClientRect()
          const picker = document.querySelector('[data-page-port-switcher]').getBoundingClientRect()
          const title = document.querySelector('h1').getBoundingClientRect()
          const context = document.querySelector('[data-documentation-context]')?.getBoundingClientRect()
          return { above: toolbar.bottom <= title.top, contextAbove: context ? context.bottom <= breadcrumb.top : picker.top < breadcrumb.bottom && breadcrumb.top < picker.bottom }
        })
        assert(geometry.above && geometry.contextAbove, `${path}: context controls precede the breadcrumb and heading`)
      }
      const expected = isReference ? '/en/py/stable/workspace/reference/tmuxp-workspace-builder-classicworkspacebuilder-build/' : path.includes('workspace/') ? `/en/${path}/`
        : path === 'dotnet/latest/mcp/tools/capture_pane' ? '/en/py/stable/mcp/tools/capture_pane/' : `/en/py/stable/${path.replace(/^(?:ts\/latest\/|tmux\/)/, '')}/`
      if (hasSwitcher) {
        assert.equal(await portLinks.first().getAttribute('href'), expected)
        assert.equal(await switcher.locator('.tmux-area a').getAttribute('href'), '/en/tmux/')
      }
      if (path === 'py/stable/workspace/guides') {
        assert.equal(await portLinks.count(), workspacePortCount)
        assert.equal(
          await switcher.locator('[aria-disabled="true"]').count(),
          PORTS.length - workspacePortCount,
        )
      }
      if (path === 'ts/latest/workspace/internals/guides') {
        const unavailable = await switcher.locator('[aria-disabled="true"]').allTextContents()
        assert(unavailable.some((label) => /Python/.test(label)), 'Python internals guide stays unavailable')
      }
      if (path === 'dotnet/latest/mcp/tools/capture_pane') {
        assert.equal(await portLinks.count(), 8)
        assert.equal(await switcher.locator('a[aria-current="page"]').getAttribute('href'), `/en/${path}/`)
      }
      if (isReference) {
        assert.equal(
          await portLinks.count(),
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
          schemeLabelWidth: document.querySelector('.scheme-switch__label').getBoundingClientRect().width,
          headerControls: ['.site-header__search', '.scheme-switch', '.site-header__menu-button'].map((selector) => {
            const { top, height } = document.querySelector(selector).getBoundingClientRect()
            return { top, height }
          }),
          redundantHeaderLinks: document.querySelectorAll('.site-header__wide-link').length,
          columns: [...document.querySelectorAll('table')].flatMap((table) => {
            const head = [...(table.tHead?.rows[0]?.cells ?? [])]
            const body = [...(table.tBodies[0]?.rows[0]?.cells ?? [])]
            return head.length === body.length && [...head, ...body].every((cell) => cell.colSpan === 1)
              ? head.map((cell, i) => Math.abs(cell.getBoundingClientRect().x - body[i].getBoundingClientRect().x)) : []
          }),
        }))
        assert(result.headerHeight <= 49, `${path} at ${width}px: header grew`)
        assert.equal(result.redundantHeaderLinks, 0, 'Surface destinations are absent from the header bar')
        assert(result.headerControls.every((control) => Math.abs(control.height - result.headerControls[0].height) < 0.1
          && Math.abs(control.top - result.headerControls[0].top) < 0.1), `${path} at ${width}px: header controls align at equal heights`)
        assert.equal(result.badgeForeground, 'rgb(255, 255, 255)', 'Filled badge uses white foreground')
        if (width < 1536) assert(result.schemeLabelWidth <= 1, 'Compact color-scheme controls hide their text visually')
        assert(result.overflow <= 1, `${path} at ${width}px: page overflow ${result.overflow}px`)
        assert(result.columns.every((delta) => delta <= 1), `${path} at ${width}px: table columns misaligned`)
        if (hasSwitcher) {
          const selector = await switcher.locator('summary').boundingBox()
          const action = await page.locator('[data-page-actions] > summary').boundingBox()
          const icon = await page.locator('[data-page-actions] > summary > svg').boundingBox()
          if (await page.locator('[data-documentation-context]').count() === 0) {
            assert(Math.abs(action.height - selector.height) < 0.1, `${path}: page controls have equal height at ${width}px`)
            assert(Math.abs(action.y - selector.y) < 0.1, `${path}: page controls align at ${width}px`)
          }
          assert(Math.abs(icon.x + icon.width / 2 - action.x - action.width / 2) < 0.1, `${path}: action icon centered horizontally`)
          assert(Math.abs(icon.y + icon.height / 2 - action.y - action.height / 2) < 0.1, `${path}: action icon centered vertically`)
        }
      }

      if (hasSwitcher) {
        assert.equal(await switcher.count(), 1, `${path}: one page port switcher`)
        await switcher.locator('summary').click()
        await switcher.locator('[data-picker-panel]').waitFor({ state: 'visible' })
        const menu = await switcher.locator('[data-picker-panel]').boundingBox()
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
      await page.goto(`${base}/sidebar-free-layout/`, { waitUntil: 'load' })
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
      await noScript.goto(`${base}/tmux/concepts/server-session-window-pane/`, { waitUntil: 'load' })
      const checkContrast = async (scheme, selectors = ['h1', '.prose h2', '.prose p']) => {
        const samples = await noScript.evaluate((selectors) => {
          const context = document.createElement('canvas').getContext('2d')
          const luminance = () => {
            const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
              .map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
          }
          return selectors.map((selector) => {
            const element = document.querySelector(selector)
            const backgrounds = []
            for (let parent = element; parent; parent = parent.parentElement) {
              backgrounds.unshift(getComputedStyle(parent).backgroundColor)
            }
            // Translucent anchor highlights composite over the page surface.
            context.fillStyle = '#fff'
            context.fillRect(0, 0, 1, 1)
            for (const color of backgrounds) {
              context.fillStyle = color
              context.fillRect(0, 0, 1, 1)
            }
            const background = luminance()
            context.fillStyle = getComputedStyle(element).color
            context.fillRect(0, 0, 1, 1)
            const values = [luminance(), background].sort((a, b) => b - a)
            return { selector, contrast: (values[0] + .05) / (values[1] + .05), opacity: getComputedStyle(element).opacity }
          })
        }, selectors)
        for (const sample of samples) {
          assert(sample.contrast >= 4.5, `No-JS ${scheme} ${sample.selector} contrast: ${sample.contrast}`)
          assert.equal(sample.opacity, '1', `${scheme} ${sample.selector} remains fully legible`)
        }
      }
      await checkContrast(colorScheme)
      assert.equal(await noScript.locator('.documentation-context-navigation').isVisible(), false, 'No-JS hides inactive context drawer buttons')
      assert.equal(await noScript.locator('.mobile-fallback').isVisible(), true, 'No-JS has usable mobile navigation')
      await checkContrast(colorScheme, ['.mobile-fallback summary', '.documentation-context .surface-current strong', '.documentation-context [data-page-port-switcher] > summary'])
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
    const failures = (await Promise.all([
      navigation, apiExamples, reference, preferences, globalHeader, apiNavigation,
      clipboard, nativeLayout, documentationNavigation, homeLauncher,
    ])).filter(Boolean)
    if (failures.length) throw new AggregateError(failures, 'Browser checks failed')
    await navigationPage.close()
    await apiNavigationPage.close()
    await clipboardPage.close()
  }
} finally {
  await browser?.close()
  await server.stop()
}
