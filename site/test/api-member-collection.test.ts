import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeWindows, css, go, page, symbolOf } from './api-page-fixtures'

vi.mock('astro:content', () => ({ getCollection: async () => [] }))
afterEach(closeWindows)

/**
 * A type's member list against the design system (MemberCollection, record 0034).
 */
describe('the member list (MemberCollection, record 0034)', () => {
  it('keeps a long list in the page inside its own scroll box, with the count as muted text', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane'))
    const box = document.querySelector('.api-members .api-member-budget')!
    expect(box, 'Pane has 175 methods').not.toBeNull()
    expect(box.getAttribute('tabindex')).toBe('0')
    expect(box.getAttribute('role')).toBe('region')
    expect(box.getAttribute('aria-label')).toMatch(/^Members of /)
    expect(box.querySelectorAll('li').length).toBeGreaterThan(14)
    expect(document.querySelector('.api-members > h2 .api-section-count')?.textContent).toMatch(/^\d+ members$/)
    // The heading and its count stay outside the box, so they are always in view.
    expect(box.querySelector('h2')).toBeNull()
  }, 60_000)

  it('names a member by its own text colour and shows the kind word only where kinds are mixed', async () => {
    const document = await page(symbolOf(go, 'tmux.Pane'))
    expect(document.querySelector('.api-member-list .api-kind-word'), 'every Pane member is a method, so the mark says it').toBeNull()
    expect(css).toMatch(/\.api-member-link \{[^}]*color: var\(--text-color/)
    expect(css).toMatch(/\.api-member-link:is\(:hover, :focus-visible\) \{[^}]*color: var\(--color-link\)/)
  }, 60_000)

  it('sizes the box by the list budget token, with its fallback named', () => {
    expect(css).toMatch(/\.api-member-budget \{[^}]*max-block-size: var\(--list-budget, 28rem\)[^}]*overflow: auto/)
  })

  it('leaves a short list flat', async () => {
    const small = go.symbols.find((symbol) => symbol.kind === 'struct' && !symbol.parent &&
      go.symbols.filter((member) => member.parent === symbol.id && member.kind === 'method').length >= 2 &&
      go.symbols.filter((member) => member.parent === symbol.id && member.kind === 'method').length <= 8)!
    const document = await page(small)
    expect(document.querySelectorAll('.api-member-list li').length).toBeGreaterThan(0)
    expect(document.querySelector('.api-member-budget')).toBeNull()
  }, 60_000)
})

