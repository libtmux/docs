import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sansFallbacks } from '../src/lib/sans-fallbacks'
import { parseRules } from './css-rules'
import { PREVIEW_PREFIX, SITE_BUILT, publishedPath } from './site-root'

/**
 * The font stack a built Japanese page applies to Japanese text (record 0052), read from the page's own CSS.
 * `typesetting.test.ts` checks the source; this checks what the build wrote. The Fonts API puts the hashed Plex family
 * and the build's fallbacks into `--font-ibm-plex-sans` in an inline `<style>`, `global.css` points `--font-sans` at it
 * and `:lang(ja)` uses `var(--font-sans)`, so the order only shows once those variables are followed through the page.
 */

const JAPANESE_SANS = ['Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', 'Yu Gothic', 'Meiryo', 'Noto Sans CJK JP', 'Noto Sans JP']
const AHEAD = 'no generic face ahead of the Japanese ones'
const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '')

/** The CSS a page loads, in document order: each inline `<style>` and each linked stylesheet, read through `read`. */
function pageCss(html: string, read: (href: string) => string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>|<link\b[^>]*>/g)].map((match) => {
    if (match[1] !== undefined) return match[1]
    const tag = match[0]
    return /\brel="stylesheet"/.test(tag) ? read(/\bhref="([^"]+)"/.exec(tag)![1]!) : ''
  }).join('\n')
}

/**
 * The families `:lang(ja)` resolves to, in order, and the families the page declares with `@font-face`. Each `var()` is
 * followed through the custom properties the page sets on the root, as the browser does.
 */
function japaneseStack(css: string): { stack: string[]; declared: string[] } {
  const rules = parseRules(css).filter((rule) => rule.media.length === 0)
  const root: Record<string, string> = {}
  for (const rule of rules.filter((rule) => rule.selectors.some((selector) => [':root', ':host', 'html'].includes(selector)))) {
    for (const [name, value] of Object.entries(rule.declarations)) if (name.startsWith('--')) root[name] = value
  }
  let value = rules.filter((rule) => rule.selectors.includes(':lang(ja)')).map((rule) => rule.declarations['font-family']).filter(Boolean).at(-1)
  expect(value, 'the page sets a font-family on :lang(ja)').toBeDefined()
  for (let depth = 0; /var\(/.test(value!); depth++) {
    expect(depth, 'var() chain ends').toBeLessThan(8)
    value = value!.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
      expect(root[name], `${name} is set on the root`).toBeDefined()
      return root[name]!
    })
  }
  return {
    stack: value!.split(',').map(unquote),
    declared: rules.filter((rule) => rule.selectors.includes('@font-face')).map((rule) => unquote(rule.declarations['font-family'] ?? '')),
  }
}

/** The page's own Plex face, the Japanese sans faces, then the generic ones, with nothing generic ahead of the Japanese faces. */
function expectJapaneseOrder({ stack, declared }: { stack: string[]; declared: string[] }) {
  const [plex, ...fallbacks] = stack
  expect(plex, 'the hashed Plex family comes first').toMatch(/^IBM Plex Sans-[0-9a-f]+$/)
  expect(declared, 'and the page declares it').toContain(plex)
  expect(fallbacks.slice(0, JAPANESE_SANS.length), AHEAD).toEqual(JAPANESE_SANS)
  expect(fallbacks.slice(JAPANESE_SANS.length)).toEqual(['system-ui', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji'])
}

const families = (list: string[]) => list.map((family) => (/^[\w-]+$/.test(family) ? family : `"${family}"`)).join(',')

/** A page shaped like the build's output: the Fonts API's inline style, a linked stylesheet with the theme and the rule. */
function builtShape(fallbacks: string[]) {
  const plex = 'IBM Plex Sans-ffefb95c319e144f'
  const html = '<!DOCTYPE html><html lang="ja"><head>'
    + `<style>@font-face{font-family:"${plex}";src:url("/ja/_astro/fonts/a.woff2") format("woff2");font-weight:400;}:root{--font-ibm-plex-sans:"${plex}",${families(fallbacks)}}</style>`
    + '<link rel="stylesheet" href="/ja/_astro/BaseLayout.abc.css"></head><body></body></html>'
  const sheet = '@layer theme{:root,:host{--font-sans:var(--font-ibm-plex-sans);--font-mono:monospace}}'
    + '@layer components{:lang(ja){font-family:var(--font-sans);letter-spacing:0}}'
  return pageCss(html, () => sheet)
}

describe('Japanese font stack, read from the CSS a page loads', () => {
  it('accepts the Japanese build\'s stack and rejects the English one and the old order, so the check can fail', () => {
    expectJapaneseOrder(japaneseStack(builtShape(sansFallbacks('ja'))))
    // The English build lists ui-sans-serif and system-ui first, which come up for kana before any Japanese face.
    expect(() => expectJapaneseOrder(japaneseStack(builtShape(sansFallbacks('en'))))).toThrow(AHEAD)
    // Generic faces ahead of the Japanese ones, as `var(--font-sans)` first used to expand.
    expect(() => expectJapaneseOrder(japaneseStack(builtShape(['ui-sans-serif', 'system-ui', 'sans-serif', ...JAPANESE_SANS, 'Apple Color Emoji', 'Segoe UI Emoji'])))).toThrow(AHEAD)
  })

  describe.skipIf(!SITE_BUILT)('assembled /ja/ home page', () => {
    const file = publishedPath(PREVIEW_PREFIX, 'ja', 'index.html')
    const read = (href: string) => readFileSync(publishedPath(new URL(href, 'https://libtmux.org').pathname), 'utf8')
    const html = () => {
      expect(existsSync(file), 'built /ja/ home page').toBe(true)
      return readFileSync(file, 'utf8')
    }

    it('lists the hashed Plex family, then the Japanese sans faces, then system-ui and sans-serif (record 0052)', () => {
      expect(html()).toMatch(/<html[^>]*\slang="ja"/)
      expectJapaneseOrder(japaneseStack(pageCss(html(), read)))
    })

    it('fails the same check once the English fallbacks replace the Japanese ones in that page', () => {
      const english = html().replace(/(--font-ibm-plex-sans:"IBM Plex Sans-[0-9a-f]+"),[^;}]*/, `$1,${families(sansFallbacks('en'))}`)
      expect(english, 'the declaration was rewritten').not.toBe(html())
      expect(() => expectJapaneseOrder(japaneseStack(pageCss(english, read)))).toThrow(AHEAD)
    })
  })
})
