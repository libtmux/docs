import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const layout = readFileSync(new URL('../src/layouts/DocsLayout.astro', import.meta.url), 'utf8')

it('parses the contents rail before the article and draws it after, so the column is final at first paint', () => {
  const rail = layout.indexOf('data-toc-rail')
  const main = layout.indexOf('<main class="min-w-0 flex-1">')
  expect(rail).toBeGreaterThan(0)
  expect(rail).toBeLessThan(main)
  expect(layout).toMatch(/<aside class="order-last hidden w-56 shrink-0 xl:block" data-toc-rail>/)
})

it('reserves nothing where the rail is hidden or absent', () => {
  // `hidden` below xl takes no room; a page with no headings renders no rail at all.
  expect(layout).toMatch(/tocItems\.length > 0 && \(\s*<aside class="order-last hidden /)
  expect(layout.match(/data-toc-rail/g)).toHaveLength(1)
  expect(layout).not.toMatch(/<\/main>\s*\{\s*tocItems/)
})
