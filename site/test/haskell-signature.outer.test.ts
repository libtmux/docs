// Outer: compiles production Astro markup and loads the generated multi-port catalog.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { SymbolIndex, type ApiModel } from '@libtmux/api-model'
import { apiEntrySections, apiMethodDetails, usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, signatureSpans } from '../src/lib/code-layout'
import { parseApiProse } from '@libtmux/api-model/reference'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, renderSignatures } from './signature-fragment'

const model = JSON.parse(readFileSync(new URL('../src/data/api/haskell.json', import.meta.url), 'utf8')) as ApiModel
const index = new SymbolIndex(model.symbols, (symbol) => `/en/haskell/latest/reference/${symbol.slug}/`, 'haskell')
const declarations = model.symbols.filter((symbol) => symbol.signatures.length)
const tokens = (text: string) => text.replace(/\s+/g, ' ').trim()

describe('native Haddock signatures', () => {
  it('keeps signatureless module declarations on the ordinary named-header path', async () => {
    const modules = model.symbols.filter((symbol) => symbol.kind === 'module')
    expect(modules).toHaveLength(7)
    for (const symbol of modules) {
      expect(symbol.signatures).toEqual([])
      expect(usesNativeSignatures(symbol, 'haskell')).toBe(false)
      const markdown = await symbolMarkdownWithLayout({ model, index, symbol })
      expect(markdown.startsWith(`# ${symbol.name}\n`)).toBe(true)
      expect(markdown).not.toContain('Anonymous module')
    }
  })

  it('uses the native text and explicit destinations for every public header and Markdown twin', async () => {
    expect(declarations).toHaveLength(225)
    let links = 0
    for (const symbol of declarations) {
      expect(usesNativeSignatures(symbol, 'haskell'), symbol.id).toBe(true)
      const layouts = await apiSignatureLayouts(symbol, 'haskell')
      const signature = symbol.signatures[0]!
      const layout = layouts.get(signature)!
      expect(layout, symbol.id).toBeDefined()
      expect(tokens(layout.text)).toBe(tokens(signature.raw!))
      expect(layout.failures, symbol.id).toEqual([])
      const spans = signatureSpans(layout, index, symbol, signature)
      expect(spans.map((span) => span.text).join('')).toBe(layout.text)
      const expected = signature.nativeSpans!.filter((span) => span.href).map((span) => [span.text,
        span.target ? index.resolve(span.target, 'any', symbol)!.href : span.href])
      expect(spans.filter((span) => span.link).map((span) => [span.text, span.link!.href])).toEqual(expected)
      links += expected.length
      const markdown = await symbolMarkdownWithLayout({ model, index, symbol })
      const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')!
      expect(code).toMatchObject({ lang: 'haskell', value: layout.text })
      for (const [, href] of expected) expect(markdown).toContain(`](${href})`)
      expect(markdown).not.toContain('## Methods')
    }
    expect(links).toBe(299)
  })

  it('renders each real production header with native links and its own declaration anchor', async () => {
    for (const symbol of declarations) {
      const nameHref = index.resolve(symbol.id)!.href
      const rendered = await renderSignatures(symbol, 'haskell', index, nameHref)
      try {
        const element = rendered.signatures[0]!
        expect(displayedSignature(element), symbol.id).toBe(rendered.layouts.get(symbol.signatures[0]!)!.text)
        expect(element.getAttribute('data-code-width-status'), symbol.id).toBe('fits')
        const name = element.querySelector('a.api-declaration-name')!
        expect(name?.textContent).toBe(symbol.name)
        expect(name?.getAttribute('href')).toBe(nameHref)
        const expected = symbol.signatures[0]!.nativeSpans!.filter((span) => span.href).map((span) => [span.text,
          span.target ? index.resolve(span.target, 'any', symbol)!.href : span.href])
        expect([...element.querySelectorAll('a.api-type-link')].map((link) => [link.textContent, link.getAttribute('href')])).toEqual(expected)
        expect(element.querySelector('a a')).toBeNull()
        expect(element.querySelector('.api-parameter-name')).toBeNull()
      } finally { await rendered.window.happyDOM.abort() }
    }
  })

  it('keeps data constructors out of dispatch-method sections', () => {
    const constructors = declarations.filter((symbol) => symbol.signatures[0]?.methodKind === 'constructor')
    expect(constructors).toHaveLength(44)
    for (const symbol of constructors) {
      expect(apiMethodDetails(symbol, 'haskell')).toEqual([])
      expect(apiEntrySections(symbol, 'haskell').map((section) => section.label)).not.toContain('Methods')
    }
    const julia = JSON.parse(readFileSync(new URL('../src/data/api/julia.json', import.meta.url), 'utf8')) as ApiModel
    const dispatch = julia.symbols.find((symbol) => symbol.signatures.some((signature) => signature.methodKind === 'constructor'))!
    expect(apiMethodDetails(dispatch, 'julia').length).toBeGreaterThan(0)
    expect(apiEntrySections(dispatch, 'julia').map((section) => section.label)).toContain('Methods')
  })

  it('resolves authored prose and instance-owner links while preserving native sources and literals', async () => {
    const symbol = model.symbols.find((entry) => entry.id === 'LibTmux.Id#t:SessionId')!
    const markdown = await symbolMarkdownWithLayout({ model, index, symbol })
    expect(markdown).toContain('[`parseSessionId`](' + index.resolve('LibTmux.Id#v:parseSessionId')!.href + ')')
    expect(markdown).toContain('[`SessionId`](' + index.resolve(symbol.id)!.href + ')')
    expect(markdown).not.toContain(':obj:')
    expect(parseApiProse(symbol.doc!.body!)).toContainEqual({ kind: 'rubric', text: 'Instances' })
    expect(fromMarkdown(markdown).children.some((node) => node.type === 'heading' && node.depth === 2 &&
      node.children.some((child) => child.type === 'text' && child.value === 'Instances'))).toBe(true)
    for (const link of symbol.doc!.body!.matchAll(/\[Source\]\(([^)]+)\)/g)) expect(markdown).toContain(link[0])
    expect(markdown).toContain('[NFData](https://hackage.haskell.org/package/deepseq-1.5.1.0/docs/Control-DeepSeq.html#t:NFData)')

    const literal = ':obj:`parseSessionId <LibTmux.Id#v:parseSessionId>`'
    const authored = `[${literal}](https://example.org/authored)`
    const fence = `\u0060\u0060\u0060text\n${literal}\n\u0060\u0060\u0060`
    const body = `${authored}\n\n${fence}\n\nPlain \u0060parseSessionId\u0060 stays literal.`
    const exported = await symbolMarkdownWithLayout({ model, index, symbol: { ...symbol, doc: { summary: '', body } } })
    expect(exported).toContain(body)
  })

  it('rejects missing or inconsistent native spans instead of reconstructing a header', async () => {
    const symbol = declarations[0]!
    const signature = symbol.signatures[0]!
    await expect(apiSignatureLayouts({ ...symbol, signatures: [{ ...signature, nativeSpans: undefined }] }, 'haskell'))
      .rejects.toThrow('native Haskell header')
    await expect(apiSignatureLayouts({ ...symbol, signatures: [{ ...signature, nativeSpans: [{ text: 'other' }] }] }, 'haskell'))
      .rejects.toThrow('native Haskell header')
  })

  it('rejects a missing public native target rather than guessing from its text', async () => {
    const symbol = declarations.find((entry) => entry.signatures[0]!.nativeSpans!.some((span) => span.target))!
    const signature = symbol.signatures[0]!
    const layouts = await apiSignatureLayouts(symbol, 'haskell')
    const empty = new SymbolIndex([], () => '/missing/', 'haskell')
    expect(() => signatureSpans(layouts.get(signature)!, empty, symbol, signature)).toThrow('native signature target')
  })
})
