import { describe, expect, it } from 'vitest'
import { introBeforeCards } from '../src/lib/section-index'
import { siteCss } from './site-css'

/**
 * One type scale and measure for every page family (15-typesetting.md), the
 * glossary's heading order, section-index intro placement, scroll boxes for
 * wide tables, and the Japanese stack. The cascade is the one a reader gets:
 * `global.css` compiled with Tailwind, not restated here.
 */
const css = await siteCss(['prose', 'dark:prose-invert'])

/** A selector list split at its top-level commas: `:where(a, b)` stays whole. */
function selectorList(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (char === ',' && depth === 0) {
      out.push(current.trim())
      current = ''
    } else current += char
  }
  return [...out, current.trim()]
}

/** Declarations of the first rule whose selector list contains `selector` exactly. */
function rule(selector: string): Record<string, string> {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = selectorList(match[1]!)
    if (!selectors.includes(selector)) continue
    return Object.fromEntries(match[2]!.split(';').map((d) => d.split(/:(.*)/s).map((p) => p?.trim())).filter(([k, v]) => k && v) as [string, string][])
  }
  throw new Error(`no rule for ${selector}`)
}

const rem = (value: string | undefined) => Number.parseFloat(value ?? '')

describe('heading scale', () => {
  it('sets H1, H2 and H3 at 32/38, 24/32 and 18/26, all 600', () => {
    const [h1, h2, h3] = [rule('.prose h1'), rule('.prose h2'), rule('.prose h3')]
    expect([h1['font-size'], h1['line-height'], h1['font-weight']]).toEqual(['2rem', '2.375rem', '600'])
    expect([h2['font-size'], h2['line-height'], h2['font-weight']]).toEqual(['1.5rem', '2rem', '600'])
    expect([h3['font-size'], h3['line-height'], h3['font-weight']]).toEqual(['1.125rem', '1.625rem', '600'])
  })

  it('makes the glossary headings descend from the page title', () => {
    const title = rule('.api-reference-layout--glossary .api-reference-content > header h1')
    const section = rule('.prose h2')
    const term = rule('.prose h3')
    const termChip = rule('.api-glossary-body h3 code')
    expect(rem(title['font-size'])).toBeGreaterThan(rem(section['font-size']))
    expect(rem(section['font-size'])).toBeGreaterThan(rem(term['font-size']))
    // The term is a label: its chip is the body size, not another heading.
    expect(rem(termChip['font-size'])).toBeLessThanOrEqual(rem(term['font-size']))
    // Each level is no heavier than the one above it.
    expect(Number(title['font-weight'])).toBeGreaterThanOrEqual(Number(section['font-weight']))
  })

  it('caps prose blocks at the prose measure and leaves tables and code frames alone', () => {
    expect(rule('.prose :where(p, ul, ol, dl, blockquote)')['max-width']).toBe('var(--measure-prose, 72ch)')
    expect(rule('.prose :where(table)')['max-width']).toBe('100%')
  })
})

describe('section index', () => {
  it('puts a plain intro before the cards and leaves a page with headings, tables or code below them', () => {
    expect(introBeforeCards('Use these guides to connect to tmux.\n', 6)).toBe(true)
    expect(introBeforeCards('Intro.\n\n## A section\n\nMore.', 6)).toBe(false)
    expect(introBeforeCards('Intro.\n\n| a | b |\n| - | - |\n', 6)).toBe(false)
    expect(introBeforeCards('```sh\ntmux\n```', 6)).toBe(false)
    expect(introBeforeCards('', 6)).toBe(false)
    expect(introBeforeCards('Intro.', 0)).toBe(false)
  })
})
