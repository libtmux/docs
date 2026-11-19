import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { directoryPattern, introBeforeCards } from '../src/lib/section-index'
import { loadAstroTemplate, renderAstroTemplate, withoutScope } from './astro-templates'
import { siteCss } from './site-css'

vi.mock('astro:content', () => ({ getCollection: vi.fn(async () => []) }))

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

  it('gives an API declaration inside prose the reference measure, not the prose one', () => {
    // README "Space, size and density": reference entries read at measure-reference (100ch).
    expect(rule('.prose dl.gp-sphinx-api-container')['max-width']).toBe('var(--measure-reference, 100ch)')
  })
})

/** Pages that set their own headings rather than through `.prose` use the named steps, so none drifts from the scale. */
describe('headings set outside prose', () => {
  it('names the page title 32/38 and the section 24/32, both at 600', () => {
    const [title, section] = [rule('.page-title'), rule('.section-heading')]
    expect([title['font-size'], title['line-height'], title['font-weight']]).toEqual(['2rem', '2.375rem', '600'])
    expect([section['font-size'], section['line-height'], section['font-weight']]).toEqual(['1.5rem', '2rem', '600'])
  })

  it('sets the cross-port MCP tool surface with those steps, not a size of its own', async () => {
    const tools = await loadAstroTemplate('components/mcp/Tools.astro')
    const html = withoutScope(await renderAstroTemplate(tools, { url: 'https://libtmux.org/mcp/tools/' }))
    const classes = (tag: string) => [...html.matchAll(new RegExp(`<${tag} class="([^"]*)"`, 'g'))].map((match) => match[1]!.split(' '))
    expect(classes('h1')).toHaveLength(1)
    for (const heading of classes('h1')) expect(heading).toContain('page-title')
    expect(classes('h2').length).toBeGreaterThan(0)
    for (const heading of classes('h2')) expect(heading).toContain('section-heading')
    expect(html).not.toMatch(/<h[12] class="[^"]*\btext-(?:xl|2xl|3xl)\b/)
  })

  // The sections of an MCP object page (Arguments, Result, Annotations, Types, Protocol data) sit in the entry's body, which a
  // scoped rule styles; they are the page's H2s and take the section step, as `.api-section-heading` does on an API page.
  it('sets the section headings of an MCP object page 24/32 at 600', () => {
    const protocol = readFileSync(new URL('../src/components/mcp/ProtocolReference.astro', import.meta.url), 'utf8')
    const body = /\.api-overview h2 \{([^}]*)\}/.exec(protocol)?.[1] ?? ''
    expect(body).toMatch(/font-size: 1\.5rem;/)
    expect(body).toMatch(/line-height: 2rem;/)
    expect(body).toMatch(/font-weight: 600;/)
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

  it('keeps Latin in IBM Plex Sans, names the reader\'s own Japanese sans faces behind it and ships no web font (record 0052)', () => {
    // Plex has no Japanese glyphs, so every kana and kanji falls through to the next named face. The site's Plex is
    // registered under a hashed family name, so `--font-sans` (which resolves to it) stands for "IBM Plex Sans" here.
    expect(css).toMatch(/--font-sans: var\(--font-ibm-plex-sans\)/)
    expect(stack).toEqual(['var(--font-sans)', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP', 'system-ui', 'sans-serif'])
    expect(css).not.toMatch(/@font-face[^}]*(Noto Sans JP|Plex Sans JP)/)
    // A Mincho face must never be named.
    expect(stack.join(' ')).not.toMatch(/Mincho|(?<!sans-)serif/i)
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
