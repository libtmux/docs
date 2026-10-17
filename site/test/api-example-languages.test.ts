import { createRenderer } from 'astro-expressive-code'
import { select, toHtml } from 'astro-expressive-code/hast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { describe, expect, it } from 'vitest'
import config from '../ec.config.mjs'
import { API_MODELS } from '../src/lib/api-models'
import { parseApiProse } from '../src/lib/api-prose'
import { codeLang } from '../src/lib/highlight'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

/** Every label a doc comment puts on a code block: example blocks and prose fences. */
function blockLanguages(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/^ {0,3}(`{3,}|~{3,})/m.test(value)) {
      for (const block of parseApiProse(value)) if (block.kind === 'code') found.add(block.lang)
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) blockLanguages(entry, found)
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'examples' && Array.isArray(entry)) {
        for (const example of entry) {
          if (example && typeof example === 'object' && 'code' in example) found.add(String((example as { lang?: string }).lang ?? ''))
        }
      }
      blockLanguages(entry, found)
    }
  }
  return found
}

/** Labels that render as plain text without the author having asked for `text`. */
const fallbackLanguages = (symbols: unknown) =>
  [...blockLanguages(symbols)].filter((lang) => codeLang(lang) === 'text' && lang.toLowerCase() !== 'text' && lang !== '')

/** Token colours per theme variable, read from the rendered `<code>` spans. */
function tokenColors(html: string) {
  const code = html.slice(html.indexOf('<code>'), html.indexOf('</code>'))
  const spans = [...code.matchAll(/<span style="--0:([^;"]+);--1:([^"]+)">([^<]*)<\/span>/g)]
  return {
    dark: new Set(spans.map((span) => span[1].toLowerCase())),
    light: new Set(spans.map((span) => span[2].toLowerCase())),
    texts: spans.map((span) => span[3]),
  }
}

const cxx = API_MODELS.cxx
const symbol = cxx.symbols.find((entry) => entry.doc?.examples?.some((block) => block.lang === 'cmake'))!
const block = symbol.doc!.examples!.find((entry) => entry.lang === 'cmake')!
const copyText = (code: string) => code.trimEnd().replaceAll('\n', '\x7f')

describe('API example languages', () => {
  it('keeps the C++ CMake consumer project as a cmake example', () => {
    expect(symbol).toBeDefined()
    expect(block.code).toContain('cmake_minimum_required(')
  })

  it('maps CMake labels to the cmake grammar and unknown labels to text', () => {
    expect(codeLang('cmake')).toBe('cmake')
    expect(codeLang('CMake')).toBe('cmake')
    expect(codeLang('unknown-build-format')).toBe('text')
  })

  it('highlights a cmake API example with the grammar guide fences use', async () => {
    const renderer = await createRenderer(config)
    const api = await renderer.ec.render({ code: block.code, language: codeLang(block.lang) })
    const fence = await renderer.ec.render({ code: block.code, language: 'cmake' })
    expect(select('pre', api.renderedGroupAst)?.properties.dataLanguage).toBe('cmake')
    expect(toHtml(api.renderedGroupAst)).toBe(toHtml(fence.renderedGroupAst))
    const tokens = tokenColors(toHtml(api.renderedGroupAst))
    expect(tokens.texts).toContain('cmake_minimum_required')
    expect(tokens.dark.size).toBeGreaterThan(1)
    expect(tokens.light.size).toBeGreaterThan(1)
  })

  it('keeps the displayed and copied cmake text exact', async () => {
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: block.code, language: codeLang(block.lang) })
    const html = toHtml(result.renderedGroupAst)
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(copyText(block.code))
    expect(html).toContain('class="copy"')
    // Expressive Code draws a blank source line as a lone newline.
    const lines = [...html.matchAll(/<div class="ec-line"><div class="code">([\s\S]*?)<\/div><\/div>/g)]
      .map((line) => line[1].replace(/<[^>]+>/g, '').replace(/^\n$/, ''))
    expect(lines.join('\n')).toBe(block.code.trimEnd())
  })

  it('exports the cmake example under the same label', () => {
    const fences = fromMarkdown(symbolMarkdown({ model: cxx, symbol })).children.filter((node) => node.type === 'code')
    expect(fences).toContainEqual(expect.objectContaining({ lang: 'cmake', value: block.code.trimEnd() }))
  })

  it('renders an unknown language as plain text with the same Copy text', async () => {
    const renderer = await createRenderer(config)
    const result = await renderer.ec.render({ code: block.code, language: codeLang('unknown-build-format') })
    const tokens = tokenColors(toHtml(result.renderedGroupAst))
    expect(select('pre', result.renderedGroupAst)?.properties.dataLanguage).toBe('text')
    expect(select('[data-code]', result.renderedGroupAst)?.properties.dataCode).toBe(copyText(block.code))
    expect(tokens.dark.size).toBe(1)
    expect(tokens.light.size).toBe(1)
  })

  it('reports an unknown label in the audit', () => {
    const symbols = [{ doc: { examples: [{ lang: 'made-up-format', code: 'x' }], body: '```other-format\nx\n```' } }]
    expect(fallbackLanguages(symbols).sort()).toEqual(['made-up-format', 'other-format'])
    expect(fallbackLanguages([{ doc: { examples: [{ lang: 'text', code: 'x' }, { lang: 'cmake', code: 'x' }] } }])).toEqual([])
  })

  it.each(Object.entries(API_MODELS))('highlights every labelled %s example and prose fence', (_port, model) => {
    expect(fallbackLanguages(model.symbols)).toEqual([])
  })
})
