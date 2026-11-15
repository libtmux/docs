import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeWindows, css } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)

/**
 * The measure and the type scale of an API page (15-typesetting) and its capability directory (ApiDirectory).
 */
describe('the type scale and measure (15-typesetting)', () => {
  const rule = (selector: string) => css.match(new RegExp(`${selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? ''

  it('sets the page title 32/38 at 600', () => {
    const title = rule('.api-reference-title')
    expect(title).toMatch(/font-size: 2rem/)
    expect(title).toMatch(/line-height: 2\.375rem/)
    expect(title).toMatch(/font-weight: 600/)
  })

  it('sets the summary 16/28 and caps an entry at the reference measure, with its fallback named', () => {
    const summary = rule('.api-reference-summary')
    expect(summary).toMatch(/font-size: 1rem/)
    expect(summary).toMatch(/line-height: 1\.75rem/)
    expect(css).toMatch(/max-width: var\(--measure-reference, 100ch\)/)
  })

  it('sets a collection heading 24/32 and a subsection 18/26, both at 600', () => {
    expect(css).toMatch(/\.api-reference-content > section > h2\.api-section-heading \{[^}]*font-size: 1\.5rem;[^}]*line-height: 2rem;[^}]*font-weight: 600/)
    expect(css).toMatch(/\.api-reference-content \.prose h3,\s*\.api-source-path h3 \{[^}]*font-size: 1\.125rem;[^}]*line-height: 1\.625rem;[^}]*font-weight: 600/)
  })
})


describe('the capability directory (ApiDirectory)', () => {
  it('stacks below 52rem and holds two columns from it, as the README says', () => {
    expect(css).toMatch(/@container \(width < 52rem\) \{\s*\.api-directory__row \{[^}]*grid-template-areas: 'title' 'guidance' 'members'/)
  })
})
