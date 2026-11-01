import { readFileSync } from 'node:fs'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mcpShowcase } from '../src/lib/mcp-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * The showcase in a real browser, for the boxes its stylesheet makes.
 *
 * A tool's name links to its page, and the site draws a dotted preview line
 * under a link to a protocol object. A link that is a box of its own (a card)
 * shows its own summary and takes no such line, so `check-dev.mjs` fails a
 * dotted line on any link whose computed `display` is not an inline one. A
 * flex container makes each child of it a block, so the name has to sit
 * inside a child of the row and not be that child.
 *
 * The component's `<style>` is applied unscoped; the claims are about boxes,
 * not about the colours of the tokens it reads.
 */
const STYLES = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(new URL('../src/components/mcp/McpShowcase.astro', import.meta.url), 'utf8'))![1]!
const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre>${props.code}</pre>`)

let browser: Browser
let page: string

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
  const component = await loadAstroTemplate('components/mcp/McpShowcase.astro', { modules: { 'astro-expressive-code/components': { Code } } })
  page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>MCP</title><style>${STYLES}</style></head><body>${await renderAstroTemplate(component, { props: { showcase: (await mcpShowcase('go', 'latest'))! } })}</body></html>`
}, 60_000)
afterAll(async () => { await browser?.close() })

describe('the MCP showcase in Chromium', { timeout: 60_000 }, () => {
  it('draws each tool name as an inline link, the only kind that carries a preview line', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const tab = await context.newPage()
    await tab.setContent(page)
    const displays = await tab.evaluate(() => [...document.querySelectorAll('a.mcp-tool__name')].map((link) => getComputedStyle(link).display))
    expect(displays.length).toBeGreaterThan(10)
    expect(displays.filter((display) => !/^(inline|inline-flex|inline-block)$/.test(display))).toEqual([])
    await context.close()
  })
})
