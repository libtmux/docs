import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { directoryPattern, introBeforeCards, splitAtFirstHeading } from '../src/lib/section-index'
import { JAPANESE_SANS, sansFallbacks } from '../src/lib/sans-fallbacks'
import { buildLocale } from '../src/i18n/locales'
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
  it('puts the lead before the cards, so a page with headed sections still opens on its intro, and keeps a page that opens on a table or code below them', () => {
    expect(introBeforeCards('Use these guides to connect to tmux.\n', 6)).toBe(true)
    // Headed sections follow the cards; the lead above the first heading does not wait behind them.
    expect(introBeforeCards('Intro.\n\n## A section\n\nMore.', 6)).toBe(true)
    expect(introBeforeCards('## A section\n\nMore.', 6), 'no lead to put first').toBe(false)
    expect(introBeforeCards('Intro.\n\n| a | b |\n| - | - |\n', 6)).toBe(false)
    expect(introBeforeCards('Intro.\n\n```sh\ntmux\n```\n\n## A section', 6), 'a lead with code is a page of its own').toBe(false)
    expect(introBeforeCards('```sh\ntmux\n```', 6)).toBe(false)
    expect(introBeforeCards('', 6)).toBe(false)
    expect(introBeforeCards('Intro.', 0)).toBe(false)
  })

  it('splits the rendered body at its first heading and leaves an anchor with the heading it names', () => {
    expect(splitAtFirstHeading('<p>Lead.</p>\n<h2 id="a">A</h2><p>x</p>')).toEqual({ lead: '<p>Lead.</p>\n', rest: '<h2 id="a">A</h2><p>x</p>' })
    expect(splitAtFirstHeading('<p>Lead.</p>\n<a id="named"></a>\n<h2>A</h2>')).toEqual({ lead: '<p>Lead.</p>', rest: '\n<a id="named"></a>\n<h2>A</h2>' })
    expect(splitAtFirstHeading('<p>Lead.</p>')).toEqual({ lead: '<p>Lead.</p>', rest: '' })
    expect(splitAtFirstHeading('<h2>A</h2><p>x</p>')).toEqual({ lead: '', rest: '<h2>A</h2><p>x</p>' })
  })

  it('draws the lead, the cards, then the headed sections, in that order', async () => {
    const body = await loadAstroTemplate('components/docs/SectionBody.astro', { real: ['components/DocCard.astro'] })
    const cards = [{ label: 'First card', href: 'first/', body: 'One.' }, { label: 'Second card', href: 'second/', body: 'Two.' }]
    const order = async (html: string, introFirst: boolean) => {
      const out = await renderAstroTemplate(body, { props: { cards, directory: 'cards', introFirst }, slots: { default: html } })
      return ['Lead paragraph', 'First card', 'Headed section'].map((text) => out.indexOf(text))
    }
    const [lead, card, section] = await order('<p>Lead paragraph</p><h2>Headed section</h2><p>More.</p>', true)
    expect(lead).toBeGreaterThan(-1)
    expect(lead, 'the lead is above the cards').toBeLessThan(card!)
    expect(card, 'the headed section follows them').toBeLessThan(section!)
    // A body that opens on its heading keeps the cards above it.
    const [, cardsFirst, headed] = await order('<h2>Headed section</h2><p>Lead paragraph</p>', false)
    expect(cardsFirst).toBeLessThan(headed!)
  })
})

describe('guide directories', () => {
  it('uses cards for two to six peers and a compact list from seven', () => {
    expect([0, 2, 6, 7, 14].map(directoryPattern)).toEqual(['none', 'cards', 'cards', 'list', 'list'])
  })

  it('draws the compact list in two columns with a title and one line each', () => {
    const page = readFileSync(new URL('../src/components/docs/SectionBody.astro', import.meta.url), 'utf8')
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

  it('names the hashed Plex family alone, then the reader\'s own Japanese sans faces, ahead of any generic fallback, and ships no web font (record 0052)', () => {
    // Plex has no Japanese glyphs, so every kana and kanji falls through to the next named face. The site's Plex is
    // registered under a hashed family name, and the Fonts API's `--font-ibm-plex-sans` is that family followed by the
    // build's `fallbacks`. The Japanese build's fallbacks open with the Japanese sans faces, so `--font-sans` is the stack:
    // the hashed family, then these, then system-ui and sans-serif. The generic faces the English build lists first
    // (ui-sans-serif, system-ui) must not come up ahead of them.
    expect(css).toMatch(/--font-sans: var\(--font-ibm-plex-sans\)/)
    expect(stack).toEqual(['var(--font-sans)'])
    const fallbacks = sansFallbacks('ja')
    expect(fallbacks.slice(0, 9)).toEqual(['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP', 'system-ui', 'sans-serif'])
    expect(fallbacks.indexOf('ui-sans-serif'), 'no generic face ahead of the Japanese ones').toBe(-1)
    expect(sansFallbacks('en').slice(0, 3)).toEqual(['ui-sans-serif', 'system-ui', 'sans-serif'])
    const config = readFileSync(new URL('../astro.config.ts', import.meta.url), 'utf8')
    expect(config).toMatch(/cssVariable: '--font-ibm-plex-sans',[^}]*fallbacks: sansFallbacks\(buildLocale\(\)\)/)
    expect(css).not.toMatch(/@font-face[^}]*(Noto Sans JP|Plex Sans JP)/)
    // A Mincho face must never be named.
    expect(fallbacks.join(' ')).not.toMatch(/Mincho|(?<!sans-)serif/i)
  })

  it('names the same Japanese faces for Japanese text on a page in another language, where --font-sans lists the generic ones first', () => {
    // The language menu's "日本語" is marked lang="ja" on every build; only the Japanese build's --font-sans names the faces.
    const other = rule('html:not(:lang(ja)) :lang(ja)')['font-family']!.split(',').map((face) => face.trim().replace(/^"|"$/g, ''))
    expect(other[0]).toBe('var(--font-sans)')
    expect(other.slice(1), 'the list sans-fallbacks.ts holds').toEqual(JAPANESE_SANS)
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

  it('puts the build\'s language on a page that names none, such as /ja/search/ and /ja/meta/parity/', async () => {
    const layout = await loadAstroTemplate('layouts/BaseLayout.astro', { modules: { '../i18n/resolve': { buildLocale } } })
    const lang = async (locale: string) => {
      vi.stubEnv('LIBTMUX_DOCS_PORT', '')
      vi.stubEnv('LIBTMUX_DOCS_LOCALE', locale)
      vi.stubEnv('LIBTMUX_DOCS_BASE', `/${locale}/`)
      try {
        const html = await renderAstroTemplate(layout, {
          url: `https://libtmux.org/${locale}/search/`,
          props: { title: 'Search', pageSource: { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/search.astro' } },
          slots: { default: '<main>Page content</main>' },
        })
        return /<html lang="([^"]*)"/.exec(html)?.[1]
      } finally {
        vi.unstubAllEnvs()
      }
    }
    expect(await lang('ja')).toBe('ja')
    expect(await lang('en')).toBe('en')
  })

  it('drops the tracking of a meta page\'s headings, which are not in the layer that drops it elsewhere', () => {
    const meta = readFileSync(new URL('../src/styles/meta.css', import.meta.url), 'utf8')
    expect(meta).toMatch(/:lang\(ja\) \.meta-page :is\(h1, h2\) \{[^}]*letter-spacing: 0;/)
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
    expect(without).not.toMatch(/(?:^|\n)\s*:lang\(ja\) \{\s*font-family/)
    expect(css).toMatch(/(?:^|\n)\s*:lang\(ja\) \{\s*font-family/)
    expect(without.match(/\blocal\b/g)?.length ?? 0).toBeLessThan(css.match(/\blocal\b/g)!.length)
  })
})
