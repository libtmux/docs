/**
 * The panels' stylesheet: padding on every surface of a panel, header names that fit the room they have, and the touch,
 * focus and motion rules. It reads `panels.css` itself, because a browser test cannot run in the unit loop.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRules, type Rule } from './css-rules'

describe('the workspace\'s stylesheet', () => {
  const css = readFileSync(new URL('../src/styles/panels.css', import.meta.url), 'utf8')
  const rules = parseRules(css)

  /** A length in px: whole px, rem at 16px, and the space tokens the design system names. */
  const SPACE: Record<string, number> = { '--space-1': 4, '--space-2': 8, '--space-3': 12, '--space-4': 16 }
  const px = (value: string): number => {
    const token = /^var\((--space-\d+)\)$/.exec(value)
    if (token) return SPACE[token[1]!]!
    const n = /^(-?[\d.]+)(px|rem)?$/.exec(value)
    if (!n) throw new Error(`cannot read ${value}`)
    return Number(n[1]) * (n[2] === 'rem' ? 16 : 1)
  }
  /** A padding value's sides, in px. */
  const sides = (value: string): number[] => value.split(/\s+(?![^(]*\))/).map(px)

  /** The surfaces of a panel: its header, its body, the cards, sheets and popovers that hold a document, and the workspace. */
  const SURFACES = ['.pw--mode', '.pw__head', '.pw__body', '.pw__top', '.pw__toolbody', '.pw__tooloverlay', '.pw__cardhead', '.pw__cardbody',
    '.pw__sheet', '.pw__sheetbar', '.pw__popbar', '.pw__floatbar', '.pw__pop .pw__doc', '.pw__popfoot', '.pw__notes li', '.pw__cmd li']

  /** Every padding a rule gives a surface, with the side that exceeds the cap. */
  const overCap = (list: Rule[], cap = 8): string[] => list.flatMap((rule) => rule.selectors.filter((s) => SURFACES.includes(s)).flatMap((selector) => {
    const found: string[] = []
    for (const [name, value] of Object.entries(rule.declarations)) {
      if (!/^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(name)) continue
      if (sides(value).some((side) => side > cap)) found.push(`${selector} { ${name}: ${value} }`)
    }
    return found
  }))

  it('keeps every surface of a panel to 8px of padding on every side', () => {
    expect(overCap(rules)).toEqual([])
    // The surfaces really are in the file: a rename would otherwise pass the cap by matching nothing.
    for (const surface of ['.pw--mode', '.pw__head', '.pw__body', '.pw__cardbody', '.pw__sheet']) {
      expect(rules.some((r) => r.selectors.includes(surface) && 'padding' in r.declarations), surface).toBe(true)
    }
  })

  it('catches a surface that grows past the cap', () => {
    expect(overCap(parseRules(css.replace('.pw__body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-2);', '.pw__body { flex: 1; min-height: 0; overflow: auto; padding: 1rem 1.25rem 2rem;'))))
      .toEqual(['.pw__body { padding: 1rem 1.25rem 2rem }'])
  })

  it('takes the padding a page\'s own columns gave it off the article lifted into a panel, so the panel\'s 8px is the only padding', () => {
    const lifted = rules.filter((r) => r.selectors.some((s) => /^\.pw__body (main#content|:is\(\.api-reference-layout.*\) > \.api-reference-content)$/.test(s)))
    expect(lifted.length).toBe(2)
    for (const rule of lifted) expect(rule.declarations.padding, rule.selectors.join()).toBe('0')
  })

  it('lets a header\'s title and readout take the room their text needs, and cut it only when the header is out of room', () => {
    const own = (selector: string) => rules.filter((r) => r.selectors.includes(selector))
    // No grow, a basis of its own text, and a floor of nothing, so truncation is the last resort and not the default.
    expect(own('.pw__title').map((r) => r.declarations.flex).find(Boolean)).toBe('0 0 auto')
    expect(own('.pw__loc').map((r) => r.declarations.flex).find(Boolean)).toBe('0 1 auto')
    for (const selector of ['.pw__title', '.pw__loc']) expect(own(selector).some((r) => r.declarations['min-width'] === '0'), selector).toBe(true)
    // A cap below the whole header cuts a name while the header has room. The title may stop short of the close button, and no more.
    for (const rule of rules.filter((r) => r.selectors.some((s) => s.endsWith('.pw__loc')))) {
      expect(['none', '100%', undefined], `${rule.selectors.join()} max-width`).toContain(rule.declarations['max-width'])
    }
    for (const rule of rules.filter((r) => r.selectors.some((s) => s.endsWith('.pw__title')))) {
      expect(rule.declarations['max-width'] ?? 'none', `${rule.selectors.join()} max-width`).toMatch(/^(none|100%|calc\(100% - [\d.]+rem\))$/)
    }
    expect(rules.find((r) => r.selectors.includes('.pw__spacer'))!.declarations.flex).toBe('1')
  })

  it('catches a readout capped below its header', () => {
    const capped = parseRules(css.replace('.pw__stage--route .pw__loc { cursor: default; }', '.pw__stage--route .pw__loc { max-width: 40%; cursor: default; }'))
    const bad = capped.filter((r) => r.selectors.some((s) => s.endsWith('.pw__loc')) && !['none', '100%', undefined].includes(r.declarations['max-width']))
    expect(bad.length).toBe(1)
  })

  it('keeps a header, its controls and a splitter to a touch target on a coarse pointer, and the focus ring and motion to the site\'s', () => {
    const coarse = rules.filter((r) => r.media.some((m) => m.includes('(pointer: coarse)')))
    expect(coarse.find((r) => r.selectors.includes('.pw__head'))!.declarations.height).toBe('var(--touch-target)')
    expect(coarse.some((r) => r.selectors.some((s) => s.includes('.pw__btn')) && /--touch-target/.test(r.declarations.inset ?? ''))).toBe(true)
    expect(coarse.some((r) => r.selectors.some((s) => s.includes('.pw__splitter::before')))).toBe(true)
    expect(css).not.toMatch(/outline:\s*[^;]*(1px|3px)/)
    expect(rules.filter((r) => r.media.some((m) => m.includes('prefers-reduced-motion'))).some((r) => r.declarations.transition === 'none')).toBe(true)
  })

  it('names no colour of its own in the rules the mode adds: site tokens only', () => {
    const start = css.indexOf('Panel mode (`lib/panels/mode.ts`)')
    const added = css.slice(start)
    expect(added.length).toBeGreaterThan(500)
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
  })
})
