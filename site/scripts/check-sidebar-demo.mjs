#!/usr/bin/env node
// Outer loop: real browser interactions across sidebar modes, themes, and viewports.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export async function checkSidebarDemo(browser, url, options = {}) {
  const values = { url, screenshots: options.screenshots, 'negative-control': options.negativeControl }
  const started = performance.now()
  const context = await browser.newContext({ viewport: { width: 1600, height: 1150 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.setDefaultTimeout(1000)
  const navigationTimeout = process.env.CI ? 20000 : 10000
  page.setDefaultNavigationTimeout(navigationTimeout)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const select = (name, value) => page.locator(`select[name="${name}"]`).selectOption(value)
  const frame = () => page.frames().find((item) => /\/demo\/sidebar\/preview\//.test(item.url()))
  const ready = async () => {
    const language = await page.locator('select[name="language"]').inputValue()
    await page.frameLocator('[data-sidebar-frame]').locator(`[data-sidebar-preview][data-language="${language}"][data-ready="true"]`).waitFor({ timeout: navigationTimeout })
    return frame()
  }
  const current = (f) => f.locator('.api-nav__tree [aria-current="page"]')
  const action = async (f, name) => {
    await f.locator('[data-api-actions] summary').click()
    await f.locator(`[data-api-${name}]`).click()
  }
  const open = async (f) => {
    // The iframe width changes before its media-query listener updates the drawer.
    await f.waitForFunction(() => (document.querySelector('.api-nav')?.getAttribute('role') === 'dialog') === matchMedia('(width < 56rem)').matches)
    if (await f.locator('.api-nav').evaluate((nav) => nav.inert)) await f.locator('[data-api-nav-toggle]').click()
  }
  const waitSelection = (f, symbol) => f.waitForFunction((id) => document.querySelector('.api-nav')?.dataset.symbol === id && document.querySelector('h1[data-preview-title]')?.textContent === id, symbol)
  // Guide lines, heading weight and the glossary row, measured on the rendered tree. Each negative control breaks one of them on purpose.
  const checkTreeDecoration = async (f, variant, where, collapsed = false) => {
    const control = values['negative-control']
    const tree = f.locator('.api-nav__tree')
    if (control === 'guide') await f.addStyleTag({ content: '.api-nav__label::before { border-inline-start: 0 solid !important; }' })
    if (control === 'weight') await f.addStyleTag({ content: '.api-nav__item > .api-nav__row > .api-nav__label { font-weight: 400 !important; }' })
    if (control === 'glossary-first') await tree.evaluate((node) => { const last = node.querySelector(':scope > li:last-child'); if (last?.querySelector('a[href$="/glossary/"]')) node.prepend(last) })
    if (control === 'glossary-twice') await tree.evaluate((node) => { const last = node.querySelector(':scope > li:last-child'); if (last?.querySelector('a[href$="/glossary/"]')) node.append(last.cloneNode(true)) })
    if (control === 'guide-top') await f.addStyleTag({ content: '[aria-level="1"] > .api-nav__row > .api-nav__label::before, a[aria-level="1"] > .api-nav__label::before { content: "" !important; position: absolute; top: 0; bottom: 0; border-inline-start: 1px solid red !important; }' })
    const rows = await tree.evaluate((node) => [...node.querySelectorAll('[role="treeitem"]')].filter((row) => row.getClientRects().length).map((row) => {
      const label = row.matches('a') ? row.querySelector('.api-nav__label') : row.querySelector(':scope > .api-nav__row > .api-nav__label')
      const level = Number(row.getAttribute('aria-level'))
      return { text: label?.textContent.trim(), href: row.getAttribute('href'), leaf: row.classList.contains('api-nav__leaf'), level,
        subgroup: row.matches("[data-lazy^='group:']"), line: label ? getComputedStyle(label, '::before').borderInlineStartWidth : '0px',
        weight: Number(label ? getComputedStyle(label).fontWeight : 0), heading: row.matches('.api-nav__item') && level === 1 }
    }))
    // Every nested row carries the guide line, kind subgroups included, in each layout that nests.
    const nested = rows.filter((row) => row.level > 1)
    if (variant !== 'focus' && !collapsed) assert(nested.length > 0, `${where}: the layout shows nested rows`)
    if (variant === 'grouped' && !collapsed) assert(nested.some((row) => /^Methods?\b/.test(row.text) && row.subgroup), `${where}: the Grouped kind subgroup is a nested row`)
    for (const row of nested) assert.equal(row.line, '1px', `${where}: nested row ${row.text} shows its guide line`)
    // Clean control: a top-level row and the glossary never draw one.
    for (const row of rows.filter((row) => row.level === 1)) assert.equal(row.line, '0px', `${where}: top-level row ${row.text} has no guide line`)
    // Bucket headings read as headings in the layouts that group.
    if (variant !== 'focus') {
      const headings = rows.filter((row) => row.heading)
      assert(headings.length > 0, `${where}: bucket headings are present`)
      for (const row of headings) assert(row.weight >= 600, `${where}: heading ${row.text} is bold`)
    }
    // The glossary is one ordinary row and the tree's last, reached after every declaration.
    const glossary = rows.filter((row) => /\/glossary\/$/.test(row.href ?? ''))
    assert.equal(glossary.length, 1, `${where}: the glossary appears exactly once`)
    assert.equal(rows.at(-1), glossary[0], `${where}: no row after the glossary, and none before it links to it`)
    assert.deepEqual({ text: glossary[0].text, leaf: glossary[0].leaf, level: glossary[0].level }, { text: 'API glossary', leaf: true, level: 1 }, `${where}: the glossary is an ordinary row`)
  }
  const screenshot = async (name) => {
    if (!values.screenshots) return
    await mkdir(values.screenshots, { recursive: true })
    const f = frame()
    const toolbar = await f.addStyleTag({ content: 'astro-dev-toolbar { visibility: hidden; }' })
    if (name === 'grouped-desktop-light') {
      await f.locator('[data-lazy="group:LibTmux.Server:method"] > .api-nav__row').click()
      await f.locator('.api-nav__tree').evaluate((tree) => { tree.scrollTop = 0 })
    }
    await page.locator('[data-sidebar-frame]').screenshot({ path: resolve(values.screenshots, `${name}.png`) })
    await toolbar.evaluate((node) => node.remove())
  }

  try {
    await page.goto(values.url, { waitUntil: 'load' })
    let f = await ready()
    const probes = {
      references: async () => {
        const ports = await page.locator('select[name="language"] option').evaluateAll((options) => options.map((option) => option.value))
        assert(ports.includes('tmux') && ports.includes('py') && ports.includes('swift'), 'The gallery includes the full library range and tmux CLI')
        for (const port of ports) {
          await select('language', port)
          f = await ready()
          const selected = await f.locator('.api-nav').getAttribute('data-symbol')
          assert(selected, `${port}: a current declaration is selected`)
          if (values['negative-control'] === 'layout') await f.locator('[data-api-presentation="grouped"]').evaluate((button) => { button.dataset.apiPresentation = 'outline' })
          for (const mode of ['grouped', 'focus', 'outline']) {
            await f.locator('[data-api-actions] summary').click()
            await f.getByRole('radio', { name: mode[0].toUpperCase() + mode.slice(1), exact: true }).click()
            await f.waitForFunction((mode) => document.querySelector('.api-nav')?.dataset.presentation === mode, mode)
            await page.waitForFunction((mode) => document.querySelector('select[name="variant"]').value === mode && new URL(location.href).searchParams.get('variant') === mode, mode)
            assert.equal(await f.locator('.api-nav').getAttribute('data-symbol'), selected, `${port}/${mode}: preserve selection`)
            assert.equal(await current(f).count(), 1, `${port}/${mode}: one current declaration`)
            assert.equal(await f.locator('[data-api-actions]').evaluate((menu) => menu.open), false, 'Choosing a layout closes its menu')
          }
          assert.equal(await f.locator('.api-nav__tree [aria-description] > .api-nav__row, .api-nav__leaf[aria-description]').evaluateAll((rows) => rows.every((row) => row.querySelector('.api-nav__kind'))), true, `${port}: Outline marks every declaration`)
          const full = await f.locator('[data-preview-full]').getAttribute('href')
          const destination = await f.evaluate(async (selected) => {
            const nav = document.querySelector('.api-nav')
            const inventory = await (await fetch(nav.dataset.src)).json()
            return { base: nav.dataset.base, override: inventory.hrefs?.[selected] }
          }, selected)
          assert(destination.override ? full === destination.override : full.startsWith(destination.base), `${port}: documentation uses its canonical reference`)
          console.log(`PASS: ${port} menu layouts, selected declaration and destination`)
        }
        assert.equal(errors.length, 0, errors.join('\n'))
      },
      owner: async () => {
        await select('variant', 'focus')
        const picker = f.locator('[data-api-owner]')
        const search = f.getByRole('combobox', { name: 'Filter types' })
        const popup = f.locator('[data-api-owner-popup]')
        await picker.click()
        assert.equal(await search.evaluate((node) => document.activeElement === node), true, 'Opening the picker focuses its search field')
        await search.fill('Window')
        const options = popup.locator('[role="option"]:visible')
        assert(await options.count() > 0)
        assert.equal(await options.evaluateAll((rows) => rows.every((row) => row.querySelector('.api-nav__kind') && row.querySelector('.api-kind-word'))), true, 'Every type option has a mark and trailing kind')
        await popup.locator('[data-owner-id="LibTmux.Window"]').click()
        await waitSelection(f, 'LibTmux.Window')
        assert.equal(await popup.isVisible(), false, 'Selecting a type closes the picker')
        await picker.click()
        await search.fill('no-type-749201')
        await f.locator('[data-api-owner-empty]').waitFor({ state: 'visible' })
        await search.press('Escape')
        assert.equal(await popup.isVisible(), false, 'Escape dismisses the picker')
        assert.equal(await picker.evaluate((node) => document.activeElement === node), true, 'Escape returns focus to the picker button')
        await picker.click()
        await search.press('Tab')
        assert.equal(await popup.isVisible(), false, 'Tab leaves the picker')
        await picker.click()
        await f.locator('h1[data-preview-title]').click()
        assert.equal(await popup.isVisible(), false, 'Outside click dismisses the picker')
        await action(f, 'owner-all')
        await f.waitForFunction(() => document.querySelector('.api-nav').dataset.ownerOverview === 'true')
        assert.equal(await f.locator('[data-api-actions]').evaluate((menu) => menu.open), false, 'All types closes its menu')
        assert.equal(await f.locator('[data-api-actions] summary').evaluate((summary) => document.activeElement === summary), true, 'All types returns focus to the menu button')
        await f.locator('.api-nav__tree .api-nav__label').filter({ hasText: /^LibTmux.Session$/ }).click()
        await waitSelection(f, 'LibTmux.Session')
        assert.equal(await f.locator('.api-nav').getAttribute('data-owner-overview'), null, 'Choosing from All types returns to the member list')
      },
      rapid: async () => {
        await page.waitForFunction(() => document.querySelector('select[name="symbol"]').options.length >= 4)
        const result = await page.evaluate(async () => {
          const select = document.querySelector('select[name="symbol"]')
          const original = select.value
          const first = select.options[1].value
          const target = select.options[2].value
          for (const index of [1, 2]) {
            select.selectedIndex = index
            select.dispatchEvent(new Event('change', { bubbles: true }))
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          return { original, first, target }
        })
        await waitSelection(f, result.target)
        await page.goBack()
        await waitSelection(f, result.first)
        await page.goBack()
        await waitSelection(f, result.original)
      },
      appearance: async () => {
        await select('variant', 'outline')
        await action(f, 'collapse')
        await select('theme', 'light')
        await f.waitForFunction(() => document.documentElement.dataset.themeMode === 'light')
        assert.equal(await f.locator('.api-nav__tree [aria-expanded="true"]').count(), 0, 'Theme changes preserve collapsed branches')
      },
      article: async () => {
        const article = f.locator('.sidebar-preview__article')
        const last = f.locator('[data-preview-members] a').last()
        await last.scrollIntoViewIfNeeded()
        assert(await article.evaluate((node) => node.scrollTop) > 0)
        await last.click()
        await f.waitForFunction(() => document.querySelector('h1[data-preview-title]').textContent !== 'LibTmux.Server.Windows')
        assert.equal(await article.evaluate((node) => node.scrollTop), 0, 'A new declaration starts at its heading')
      },
    }
    if (options.probe) {
      assert(probes[options.probe], 'Known sidebar probe')
      await probes[options.probe]()
      return
    }
    for (const probe of values['negative-control'] ? [] : Object.values(probes)) {
      await probe()
      await page.goto(values.url, { waitUntil: 'load' })
      f = await ready()
    }
    const inventory = await f.evaluate(async () => (await fetch(document.querySelector('.api-nav').dataset.src)).json())
    const serverCount = inventory.members['LibTmux.Server'].length
    for (const variant of ['outline', 'focus', 'grouped']) {
      for (const viewport of ['desktop', 'tablet', 'phone']) {
        for (const theme of ['dark', 'light']) {
          await page.locator('select[name="variant"]').focus()
          await select('variant', variant)
          await f.waitForFunction((mode) => document.querySelector('.api-nav')?.dataset.presentation === mode, variant)
          assert.equal(await page.locator('select[name="variant"]').evaluate((node) => document.activeElement === node), true, 'Changing mode keeps focus on its control')
          await select('viewport', viewport)
          await select('theme', theme)
          await f.waitForFunction(({ variant, theme, viewport }) => document.querySelector('.api-nav')?.dataset.presentation === variant && document.documentElement.dataset.themeMode === theme && innerWidth === viewport,
            { variant, theme, viewport: { desktop: 1180, tablet: 820, phone: 390 }[viewport] })
          await open(f)
          if (values['negative-control'] === 'selection') await current(f).evaluate((node) => node.removeAttribute('aria-current'))
          assert.equal(await current(f).count(), 1, 'Exactly one selected navigation declaration')
          assert.match(await current(f).textContent(), /Windows/)
          assert.equal(await f.locator('.api-nav__tree [tabindex="0"]').count(), 1, 'One tree Tab stop')
          const ownerCount = f.locator('.api-nav__tree .api-nav__row:has(> .api-nav__kind)').filter({ has: f.locator('.api-nav__label').filter({ hasText: /^Server$/ }) }).first().locator('.api-nav__count')
          if (values['negative-control'] === 'count') await ownerCount.evaluate((node) => { node.textContent = '0' })
          assert.equal(await ownerCount.textContent(), String(serverCount))
          await checkTreeDecoration(f, variant, `${variant}/${viewport}/${theme}`)
          const geometry = await f.locator('.api-nav').evaluate((nav) => ({ width: nav.clientWidth, overflow: nav.scrollWidth > nav.clientWidth, role: nav.getAttribute('role') }))
          assert.equal(geometry.overflow, false, `${variant}/${viewport}/${theme}: no sidebar overflow`)
          if (viewport === 'desktop') assert.equal(geometry.role, null)
          else {
            assert.equal(geometry.role, 'dialog')
            await f.locator('[data-api-nav-close]').focus()
            await f.locator('[data-api-nav-close]').press('Shift+Tab')
            assert.equal(await f.locator('.api-nav').evaluate((nav) => nav.contains(document.activeElement)), true, 'Drawer retains keyboard focus')
            await f.locator('.api-nav').press('Escape')
            assert.equal(await f.locator('.api-nav').evaluate((nav) => nav.inert), true)
            assert.equal(await f.locator('[data-api-nav-toggle]').evaluate((node) => node === document.activeElement), true)
            await open(f)
          }
          if (viewport === 'desktop' && variant === 'outline' && theme === 'dark') await screenshot('outline-desktop-dark')
          if (viewport === 'desktop' && variant === 'grouped' && theme === 'light') await screenshot('grouped-desktop-light')
          if (viewport !== 'desktop') await f.locator('[data-api-nav-close]').click()
        }
      }
    }
    console.log('PASS: 18 mode / viewport / theme combinations')

    // The same row rules hold with every bucket folded, and again with the first one opened.
    await select('viewport', 'desktop')
    for (const variant of ['outline', 'grouped']) {
      await select('variant', variant)
      await f.waitForFunction((mode) => document.querySelector('.api-nav')?.dataset.presentation === mode, variant)
      await action(f, 'collapse')
      await checkTreeDecoration(f, variant, `${variant}/collapsed`, true)
      const first = f.locator('.api-nav__tree > .api-nav__item > .api-nav__row').first()
      await first.click()
      await f.waitForFunction(() => document.querySelector('.api-nav__tree > .api-nav__item[aria-expanded="true"] > [role="group"] [role="treeitem"]'))
      await checkTreeDecoration(f, variant, `${variant}/bucket opened`)
    }
    console.log('PASS: glossary last, guide lines and heading weight with folded and opened buckets')
    // The tree is hidden while searching, so the glossary is the last result.
    await f.locator('#api-symbol-search').fill('Window')
    await f.locator('[data-api-search-results] a[data-api-glossary]').waitFor()
    assert.equal(await f.locator('[data-api-search-results] li:last-child > a').getAttribute('data-api-glossary'), '', 'Search results end with the glossary')
    await f.locator('#api-symbol-search').fill('')

    await select('viewport', 'desktop')
    await select('variant', 'outline')
    await action(f, 'collapse')
    assert.equal(await f.locator('.api-nav__tree [aria-expanded="true"]').count(), 0)
    await action(f, 'reveal')
    await current(f).waitFor({ state: 'visible' })
    assert.equal(await current(f).evaluate((node) => node.closest('[role="treeitem"]') === document.activeElement), true)
    const tree = f.locator('.api-nav__tree')
    await tree.locator('[tabindex="0"]').press('End')
    const end = await tree.locator('[tabindex="0"]').textContent()
    await tree.locator('[tabindex="0"]').press('Home')
    assert.notEqual(await tree.locator('[tabindex="0"]').textContent(), end)
    assert.equal(await tree.locator('[tabindex="0"]').evaluate((node) => getComputedStyle(node.matches('a') ? node : node.firstElementChild).outlineStyle !== 'none'), true, 'Keyboard focus is visible')

    const input = f.locator('#api-symbol-search')
    await input.fill('no-such-symbol-749201')
    await f.locator('[data-api-search-status]').filter({ hasText: /^0 results$/ }).waitFor()
    await input.press('Escape')
    await input.fill('Windows')
    await f.locator('[data-api-search-results] a').first().waitFor()
    const links = await f.locator('[data-api-search-results] a').evaluateAll((items) => items.map((item) => item.getAttribute('href')))
    assert(links.length > 1 && new Set(links).size === links.length, 'Repeated names retain distinct destinations')
    await input.fill('Server')
    await f.locator('[data-api-search-kind="types"]').click()
    await f.locator('[data-api-search-results] a').first().waitFor()
    assert.equal(await f.locator('[data-api-search-kind="types"]').getAttribute('aria-pressed'), 'true')
    await f.locator('[data-api-search-kind="members"]').click()
    await f.locator('[data-api-search-results] a').first().waitFor()
    await input.press('Escape')

    const examples = await page.locator('select[name="symbol"] option').evaluateAll((options) => options.map((option) => ({ id: option.value, text: option.textContent })))
    const empty = examples.find((example) => example.text.startsWith('No members:'))
    const long = examples.find((example) => example.text.startsWith('Long name:'))
    assert(empty && long, 'Current-model empty and long-name examples exist')
    await select('variant', 'focus')
    await select('symbol', empty.id)
    await waitSelection(f, empty.id)
    assert.equal(await tree.locator('.api-nav__count').textContent(), '0')
    assert.equal(await tree.locator('[role="treeitem"]:not([href$="/glossary/"])').count(), 1)
    await select('symbol', long.id)
    await waitSelection(f, long.id)
    assert.equal(await current(f).evaluate((node) => node.scrollWidth <= node.clientWidth), true, 'Long symbol wraps')

    await select('language', 'kotlin')
    f = await ready()
    await waitSelection(f, 'io.github.libtmux.kotlin.Session.Companion')
    assert.equal(await f.locator('[data-api-owner]').getAttribute('data-symbol'), 'io.github.libtmux.kotlin.Session.Companion')
    await action(f, 'owner-back')
    await waitSelection(f, 'io.github.libtmux.kotlin.Session')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('symbol') === 'io.github.libtmux.kotlin.Session')
    await page.goBack()
    f = await ready()
    await waitSelection(f, 'io.github.libtmux.kotlin.Session.Companion')
    await select('language', 'csharp')
    f = await ready()
    await waitSelection(f, long.id)
    await page.goBack()
    f = await ready()
    assert.equal(await page.locator('select[name="language"]').inputValue(), 'kotlin', 'Back restores the previous language in one step')
    await waitSelection(f, 'io.github.libtmux.kotlin.Session.Companion')
    await select('viewport', 'phone')
    await f.waitForFunction(() => innerWidth === 390)
    await open(f)
    await screenshot('focus-kotlin-phone')
    await f.locator('[data-api-nav-close]').click()
    const shared = page.url()
    await page.reload({ waitUntil: 'load' })
    f = await ready()
    assert.equal(page.url(), shared, 'Reload preserves the complete configuration')
    await waitSelection(f, 'io.github.libtmux.kotlin.Session.Companion')
    const destination = await f.locator('[data-preview-full]').getAttribute('href')
    const prefix = new URL(values.url).pathname.split('/demo/sidebar/')[0]
    // API pages live in the default locale; the gallery may live in another locale.
    const previewPrefix = prefix.match(/^\/pr-[^/]+/)?.[0] ?? ''
    assert(destination.startsWith(`${previewPrefix}/`), 'Documentation destination retains preview prefix')
    assert(new URL(page.url()).pathname === new URL(values.url).pathname, 'Gallery locale and preview path survive controls')
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log('PASS: search, filters, keyboard, nested owners, examples, history, reload, URLs')
  } catch (error) {
    console.error({ url: page.url(), frames: page.frames().map((item) => item.url()) })
    throw error
  } finally {
    await context.close()
    console.log(`Sidebar browser check: ${((performance.now() - started) / 1000).toFixed(2)}s`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://localhost:4382/demo/sidebar/' }, screenshots: { type: 'string' }, 'negative-control': { type: 'string' }, probe: { type: 'string' } } })
  const browser = await chromium.launch({ headless: true })
  try {
    await checkSidebarDemo(browser, values.url, { screenshots: values.screenshots, negativeControl: values['negative-control'], probe: values.probe })
  } finally { await browser.close() }
}
