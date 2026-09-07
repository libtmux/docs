#!/usr/bin/env node
import assert from 'node:assert/strict'
import { globSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const base = process.argv.find((arg) => arg.startsWith('http')) ?? 'http://localhost:8080/en'
const content = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const paths = [
  ...globSync('**/*.{md,mdx}', { cwd: content })
    .filter((path) => !path.startsWith('ja/'))
    .map((path) => `/${path.replace(/\.(md|mdx)$/, '').replace(/\/index$/, '')}/`),
  '/mcp/tools/',
  '/parity/',
  '/translations/',
]
const browser = await chromium.launch({ channel: process.env.LIBTMUX_DOCS_BROWSER_CHANNEL })
let checked = 0
try {
  for (const width of [1440, 768, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    for (const path of paths) {
      const response = await page.goto(base + path)
      assert(response?.ok(), `${path}: HTTP ${response?.status()}`)
      await page.evaluate(() => document.fonts.ready)
      const result = await page.evaluate(() => ({
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
        tables: [...document.querySelectorAll('table')].map((table) => {
          const head = [...(table.tHead?.rows[0]?.cells ?? [])]
          const body = [...(table.tBodies[0]?.rows[0]?.cells ?? [])]
          const comparable = head.length === body.length &&
            [...head, ...body].every((cell) => cell.colSpan === 1)
          return {
            columns: comparable ? head.map((cell, i) =>
              Math.abs(cell.getBoundingClientRect().x - body[i].getBoundingClientRect().x),
            ) : [],
          }
        }),
      }))
      assert(result.pageOverflow <= 1, `${path} at ${width}px: page overflows by ${result.pageOverflow}px`)
      for (const table of result.tables) {
        assert(table.columns.every((offset) => offset <= 1),
          `${path} at ${width}px: header/body columns differ by ${table.columns.join(', ')}px`)
        checked++
      }
    }
    await page.close()
  }
  assert(checked > 0, 'No rendered tables checked')
  console.log(`Table layout: ${checked} tables checked at desktop, tablet and phone widths`)
} finally {
  await browser.close()
}
