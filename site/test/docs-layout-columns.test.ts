import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const layout = readFileSync(new URL('../src/layouts/DocsLayout.astro', import.meta.url), 'utf8')
/** The layout's scoped stylesheet, without comments. */
const css = layout.slice(layout.lastIndexOf('<style>')).replace(/\/\*[\s\S]*?\*\//g, '')

it('puts the contents rail after the article in source, so the article is read and tabbed first', () => {
  const main = layout.indexOf('<main class="min-w-0 flex-1">')
  const end = layout.indexOf('</main>')
  const rail = layout.indexOf('<aside class="hidden w-56 shrink-0 xl:block" data-toc-rail>')
  expect(main).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(main)
  expect(rail).toBeGreaterThan(end)
  expect(layout.match(/<aside[^>]*data-toc-rail/g)).toHaveLength(1)
  expect(layout).not.toMatch(/order-last/)
})

it('reserves the rail column on the wrapper, which precedes the article, only for a page that has a rail', () => {
  const wrapper = layout.indexOf("<div class:list={['mx-auto flex max-w-[100rem]")
  expect(wrapper).toBeGreaterThan(0)
  expect(wrapper).toBeLessThan(layout.indexOf('<main class="min-w-0 flex-1">'))
  expect(layout).toContain("tocItems.length > 0 && 'docs-has-toc'")
  // 14rem of rail, the 1.25rem gap and the wrapper's own 1.25rem edge.
  expect(css).toMatch(/@media \(min-width: 80rem\)[\s\S]*\.docs-has-toc:not\(\.docs-reference-navigation\)\s*\{\s*position: relative;\s*padding-inline-end: 16\.5rem;\s*min-height: calc\(100vh - 3rem\);/)
  expect(css).toMatch(/\.docs-has-toc:not\(\.docs-reference-navigation\) > \[data-toc-rail\]\s*\{[^}]*position: absolute;/)
  expect(css).toMatch(/\.docs-reference-navigation\.docs-has-toc\s*\{\s*grid-template-columns: 16rem minmax\(0, 1fr\) 14rem;/)
})

it('reserves nothing below the width where the rail shows, and no longer waits for the rail to parse', () => {
  const reserving = css.match(/padding-inline-end: 16\.5rem/g) ?? []
  expect(reserving).toHaveLength(1)
  // The reservation sits inside the min-width: 80rem block, never at the base.
  expect(css.indexOf('padding-inline-end: 16.5rem')).toBeGreaterThan(css.indexOf('@media (min-width: 80rem)'))
  // The reference grid is no longer widened by finding the rail with :has(), which waited for it.
  expect(css).not.toMatch(/:has\(> aside\)/)
  expect(layout).toMatch(/<aside class="hidden w-56 shrink-0 xl:block" data-toc-rail>/)
})
