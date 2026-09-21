#!/usr/bin/env node
/** Browser coverage for the Ruby and Lua documentation surfaces. */
import { chromium } from 'playwright'

const BASE = (process.argv[2] ?? 'http://localhost:8080/en').replace(/\/$/, '')
const VIEWPORTS = [
  ['desktop', 1440, 1000],
  ['tablet', 768, 1000],
  ['phone', 390, 900],
]
const PAGES = [
  ['Ruby core guide', '/ruby/latest/guides/core/', /LibTmux|Ruby/i],
  ['Lua core guide', '/lua/latest/guides/overview/', /libtmux|Lua/i],
  ['Ruby Async guide', '/ruby/latest/guides/async/', /Async|libtmux-async/i],
  ['Lua runtime integrations', '/lua/latest/guides/runtime/', /luv|Neovim/i],
  ['Lua core API', '/lua/latest/reference/libtmux-server/', /libtmux\.Server/i],
  ['Ruby core API', '/ruby/latest/reference/libtmux-server/', /libtmux/i],
  ['Ruby Async API', '/ruby/latest/reference/libtmux-async-server/', /libtmux-async/i],
  ['Ruby MCP', '/ruby/latest/mcp/', /libtmux-mcp/i],
  ['Ruby MCP tool', '/ruby/latest/mcp/tools/tmux_capabilities/', /tmux_capabilities/i],
  ['Ruby workspace', '/ruby/latest/workspace/', /validate[\s\S]*plan[\s\S]*load/i],
  ['Lua MCP availability', '/lua/latest/mcp/', /not published|no published/i],
  ['Lua workspace availability', '/lua/latest/workspace/', /not published|no published/i],
]

const browser = await chromium.launch()
const failures = []
let checks = 0
const check = (condition, message) => {
  checks++
  if (!condition) failures.push(message)
}

for (const scheme of ['light', 'dark']) {
  for (const [viewport, width, height] of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
    })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(BASE).origin,
    })
    const page = await context.newPage()

    for (const [name, path, expected] of PAGES) {
      const response = await page.goto(BASE + path, { waitUntil: 'networkidle' })
      check(response?.ok(), `${scheme}/${viewport}: ${name} returned ${response?.status() ?? 'no response'}`)
      if (!response?.ok()) continue
      await page.evaluate(() => document.fonts.ready)
      const result = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent?.trim() ?? '',
        text: document.querySelector('main')?.textContent ?? '',
        mode: document.documentElement.getAttribute('data-theme-mode'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      }))
      check(Boolean(result.heading), `${scheme}/${viewport}: ${name} has no h1`)
      check(expected.test(result.text), `${scheme}/${viewport}: ${name} lacks its required content`)
      check(result.mode === scheme, `${scheme}/${viewport}: ${name} rendered in ${result.mode ?? 'no'} theme`)
      check(result.overflow <= 1, `${scheme}/${viewport}: ${name} overflows horizontally by ${result.overflow}px`)
      if (path === '/lua/latest/reference/libtmux-server/') {
        const firstPublicObject = await page.evaluate(() => {
          const current = document.querySelector('#api-nav a[aria-current="page"]')
          let node = current?.closest('[role="treeitem"]')
          let top = node
          while (node) {
            top = node
            node = node.parentElement?.closest('[role="treeitem"]') ?? null
          }
          return top?.querySelector(':scope > [role="group"] > li:first-child a')?.textContent?.trim()
        })
        check(firstPublicObject === 'libtmux.Server', `${scheme}/${viewport}: Lua Server is not the first public Server object`)
      }
    }

    for (const [name, path, label, target] of [
      ['Ruby domains', '/ruby/latest/', 'Async', '/ruby/latest/guides/async/'],
      ['Lua domains', '/lua/latest/', 'luv and Neovim', '/lua/latest/guides/runtime/'],
    ]) {
      const response = await page.goto(BASE + path, { waitUntil: 'networkidle' })
      check(response?.ok(), `${scheme}/${viewport}: ${name} landing returned ${response?.status() ?? 'no response'}`)
      if (!response?.ok()) continue
      const targetPath = new URL(`${BASE}${target}`).pathname
      const count = await page.locator('main a[href]').evaluateAll((links, expected) =>
        links.filter((link) => new URL(link.href).pathname === expected.target && (link.textContent ?? '').includes(expected.label)).length,
      { target: targetPath, label })
      check(count === 1, `${scheme}/${viewport}: ${name} landing has ${label}`)
    }
    const luaResponse = await page.goto(`${BASE}/lua/latest/`, { waitUntil: 'networkidle' })
    check(luaResponse?.ok(), `${scheme}/${viewport}: Lua availability landing returned ${luaResponse?.status() ?? 'no response'}`)
    if (luaResponse?.ok()) {
      const text = await page.locator('main').textContent()
      check(/MCP \(not available\)/.test(text ?? ''), `${scheme}/${viewport}: Lua MCP status label is missing`)
      check(/Workspace Manager \(not available\)/.test(text ?? ''), `${scheme}/${viewport}: Lua workspace status label is missing`)
    }

    const response = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    check(response?.ok(), `${scheme}/${viewport}: home returned ${response?.status() ?? 'no response'}`)
    if (response?.ok()) {
      const picker = page.locator('.lm-pkg-install:has([data-tab-value="ruby"])').first()
      const ruby = picker.locator('[data-tab-value="ruby"]')
      const lua = picker.locator('[data-tab-value="lua"]')
      await ruby.click()
      check(await ruby.getAttribute('aria-selected') === 'true', `${scheme}/${viewport}: Ruby install tab did not select`)
      check(await picker.locator('[data-port="ruby"] code').first().textContent().then((text) => /gem install/.test(text ?? '')),
        `${scheme}/${viewport}: Ruby install command is missing`)
      await ruby.press('ArrowRight')
      check(await lua.getAttribute('aria-selected') === 'true', `${scheme}/${viewport}: ArrowRight did not select Lua`)
      check(await picker.locator('[data-port="lua"] code').first().textContent().then((text) => /luarocks\s+(?:--local\s+)?install/.test(text ?? '')),
        `${scheme}/${viewport}: Lua install command is missing`)
      await ruby.click()
      const copy = picker.locator('[data-port="ruby"] .lm-pkg-install__copy').first()
      await copy.click()
      await copy.filter({ hasText: /copied/i }).waitFor({ timeout: 1000 }).catch(() => {})
      check(await copy.textContent().then((text) => /copied/i.test(text ?? '')),
        `${scheme}/${viewport}: Ruby copy control did not confirm the copy`)
      check(await page.evaluate(() => navigator.clipboard.readText()).then((text) => /gem install/.test(text)),
        `${scheme}/${viewport}: Ruby copy control wrote the wrong command`)

      await page.keyboard.press('Control+k')
      const search = page.locator('#search-modal input[type="search"]')
      await search.fill('Ruby Async')
      const result = page.locator('#search-modal .search-panel__results a[href*="/ruby/latest/"]').first()
      await result.waitFor({ timeout: 5000 }).catch(() => {})
      check(await result.count() > 0, `${scheme}/${viewport}: search returned no Ruby result`)
    }
    await context.close()
  }
}

await browser.close()
console.log(`check-ruby-lua: ${checks - failures.length}/${checks} checks passed`)
if (failures.length) {
  console.error(`\ncheck-ruby-lua: ${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
