import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { directoryPattern, introBeforeCards } from '../src/lib/section-index'
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

describe('guide directories', () => {
  it('uses cards for two to six peers and a compact list from seven', () => {
    expect([0, 2, 6, 7, 14].map(directoryPattern)).toEqual(['none', 'cards', 'cards', 'list', 'list'])
  })

  it('draws the compact list in two columns with a title and one line each', () => {
    const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')
    expect(page).toMatch(/\.doc-dirlist \{[^}]*columns: 2 16rem/)
    expect(page).toContain("directory === 'list'")
  })
})

describe('tables', () => {
  it('scrolls inside a bordered box with a fade at the clipped edge', () => {
    const table = rule('.prose :where(table)')
    expect(table['overflow-x']).toBe('auto')
    expect(table.border).toContain('1px solid')
    // Two covers that follow the content and two shadows that stay put.
    expect(table.background?.match(/\blocal\b/g)).toHaveLength(2)
    expect(table.background?.match(/\bscroll\b/g)).toHaveLength(2)
  })

  it('keeps mono cells at 13px or more and gives inline code body weight with a narrow chip', () => {
    expect(rule('.prose :where(td code, th code)')['font-size']).toBe('max(0.8125rem, 0.9em)')
    // Nested at-rules from the `dark:` variants keep this one out of the flat lookup above, so read the block's text.
    const start = css.indexOf('.prose code:not(pre code) {')
    expect(start).toBeGreaterThan(-1)
    const code = css.slice(start, css.indexOf('\n  }\n', start))
    expect(code).toMatch(/font-size: 0\.875em/)
    expect(code).toMatch(/padding: 0\.125rem 0\.1875rem/)
    expect(code).toMatch(/font-weight: var\(--font-weight-normal\)|font-weight: 400/)
    expect(code).not.toMatch(/font-weight: var\(--font-weight-medium\)/)
  })
})

describe('Japanese', () => {
  const ja = rule(':lang(ja)')
  const stack = ja['font-family']!.split(',').map((face) => face.trim().replace(/^'|'$/g, ''))

  it('names the reader\'s own Japanese sans faces before IBM Plex Sans and ships no web font', () => {
    expect(stack.slice(0, 7)).toEqual(['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP'])
    expect(stack[7]).toBe('var(--font-sans)')
    expect(css).not.toMatch(/@font-face[^}]*(Noto Sans JP|Plex Sans JP)/)
    // A Mincho face must never be named.
    expect(stack.join(' ')).not.toMatch(/Mincho|Serif/i)
  })

  it('drops Latin tracking and breaks at phrases', () => {
    expect(ja['letter-spacing']).toBe('0')
    expect(ja['word-break']).toBe('auto-phrase')
    expect(ja['line-break']).toBe('strict')
  })

  it('sets about 40 characters a line at 1.85 leading, and keeps code in the Latin mono face', () => {
    expect(rule(':lang(ja) .prose :where(p, ul, ol, dl, blockquote)')['max-width']).toBe('40em')
    expect(rule(':lang(ja) .prose :where(p, li, dd, blockquote)')['line-height']).toBe('1.85')
    expect(rule(':lang(ja) :where(code, kbd, pre, samp)')['font-family']).toBe('var(--font-mono)')
  })
})

describe('the Japanese page', () => {
  it('writes lang on the root, so :lang(ja) reaches every element on /ja/ pages', () => {
    const layout = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8')
    expect(layout).toMatch(/<html lang=\{locale\}/)
  })

  it('wraps the machine-translation notice so it keeps the Japanese measure', () => {
    const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')
    expect(page).toMatch(/class="locale-notice /)
    expect(css).toContain('.locale-notice')
  })
})

describe('the checks above can fail', () => {
  it('sees a stylesheet that loses its Japanese rule or its table cue', async () => {
    const without = await siteCss(['prose'], (source) => source.replace(':lang(ja) {', ':lang(xx) {').replace('no-repeat local', 'no-repeat scroll'))
    expect(without).not.toContain(':lang(ja) {\n    font-family')
    expect(without.match(/\blocal\b/g)?.length ?? 0).toBeLessThan(css.match(/\blocal\b/g)!.length)
  })
})
