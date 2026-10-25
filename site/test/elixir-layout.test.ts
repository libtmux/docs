import { describe, expect, it } from 'vitest'
import { fromMarkdown } from 'mdast-util-from-markdown'
import type { ApiSymbol } from '@libtmux/api-model'
import { ELIXIR_DECLARATION_COLUMNS } from '@libtmux/api-model'
import { API_MODELS } from '../src/lib/api-models'
import { usesNativeSignatures } from '../src/lib/api-sections'
import { apiSignatureLayouts, CODE_COLUMNS, codeWidthFailures, signatureSpans, supportsElixirSignatures } from '../src/lib/code-layout'
import { productApiIndex } from '../src/lib/product-api'
import { symbolMarkdownWithLayout } from '../src/lib/symbol-markdown'
import { displayedSignature, renderSignatures } from './signature-fragment'

const model = API_MODELS.elixir
const index = productApiIndex(model, 'latest')
const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
const declared = model.symbols.filter((entry) => supportsElixirSignatures(entry, 'elixir'))

describe('Elixir declarations', () => {
  it('are laid out by the language formatter at the width the reference allows', () => {
    expect(CODE_COLUMNS.api).toBe(ELIXIR_DECLARATION_COLUMNS)
    expect(model.nativeProvenance?.exporter.columns).toBe(CODE_COLUMNS.api)
    expect(declared.length).toBeGreaterThan(100)
    // Every callable, callback and type has a native declaration; a module or a field has none.
    expect(model.symbols.filter((entry) => ['function', 'method', 'typealias'].includes(entry.kind))).toEqual(declared)
    expect(model.symbols.filter((entry) => entry.signatures.length === 0).every((entry) => !usesNativeSignatures(entry, 'elixir'))).toBe(true)
  })

  it('keep the formatter\'s text and fit in the budget without being re-flowed', async () => {
    for (const entry of declared) {
      const layouts = await apiSignatureLayouts(entry, 'elixir')
      expect(layouts.size, entry.id).toBe(entry.signatures.length)
      for (const signature of entry.signatures) {
        const layout = layouts.get(signature)!
        expect(layout.text, entry.id).toBe(signature.raw!.trim())
        expect(layout.failures, entry.id).toEqual(await codeWidthFailures(layout.text, 'api'))
        expect(layout.failures, `${entry.id} exceeds ${layout.limit} columns`).toEqual([])
      }
    }
  })

  it('mark the name, the parameters of the head, the attribute and the atoms', async () => {
    const snapshot = symbol('LibTmux.Server.snapshot/2')
    const layout = (await apiSignatureLayouts(snapshot, 'elixir')).get(snapshot.signatures[0]!)!
    const marked = layout.syntax!.map((range) => [layout.text.slice(range.start, range.end), range.kind, 'parameter' in range ? range.parameter : undefined])
    expect(marked).toEqual(expect.arrayContaining([
      ['snapshot', 'name', undefined], ['server', 'parameter', 0], ['options', 'parameter', 1],
      ['@spec', 'keyword', undefined], [':ok', 'literal', undefined], [':error', 'literal', undefined],
    ]))
    // Only the head names parameters; the spec repeats types, not names.
    expect(marked.filter(([, kind]) => kind === 'parameter')).toHaveLength(2)
    expect(marked.filter(([, kind]) => kind === 'name')).toHaveLength(2)
  })

  it('link a type to its declaration, a standard-library type to its manual, and an atom to nothing', async () => {
    const entry = symbol('LibTmux.Server.snapshot/2')
    const layout = (await apiSignatureLayouts(entry, 'elixir')).get(entry.signatures[0]!)!
    const spans = signatureSpans(layout, index, entry, entry.signatures[0])
    const hrefs = Object.fromEntries(spans.filter((span) => span.link).map((span) => [span.text, span.link!.href]))
    expect(hrefs['LibTmux.Snapshot.t']).toMatch(/\/reference\/libtmux-snapshot-t-0\/$/)
    expect(hrefs['LibTmux.Error.t']).toMatch(/\/reference\/libtmux-error-t-0\/$/)
    expect(hrefs.t).toMatch(/\/reference\/libtmux-server-t-0\/$/)
    expect(hrefs.server).toContain('#LibTmux.Server.snapshot%2F2.parameter.server')
    expect(spans.filter((span) => span.text === ':ok' || span.text === ':error').every((span) => !span.link)).toBe(true)
    const server = symbol('LibTmux.Server.t/0')
    const field = index.linkType(server.signatures[0]!.raw!, server, server.signatures[0])
    expect(field.find((span) => span.text === 'String.t')?.link).toMatchObject({ external: true, href: 'https://elixir.hexdocs.pm/String.html#t:t/0' })
  })

  it('render as one preformatted declaration with working links and no nested anchors', async () => {
    const entry = symbol('LibTmux.Control.submit/3')
    const nameHref = `/en/elixir/latest/reference/${entry.slug}/`
    const { window, signatures, layouts } = await renderSignatures(entry, 'elixir', index, nameHref)
    try {
      expect(signatures).toHaveLength(entry.signatures.length)
      const [rendered] = signatures
      expect(rendered!.classList.contains('api-native-signature--formatted')).toBe(true)
      expect(rendered!.getAttribute('data-code-columns')).toBe(String(CODE_COLUMNS.api))
      expect(rendered!.getAttribute('data-code-width-status')).toBe('fits')
      expect(displayedSignature(rendered!)).toBe(layouts.get(entry.signatures[0]!)!.text)
      expect(rendered!.querySelector('.api-signature-name-link')?.getAttribute('href')).toBe(nameHref)
      expect([...rendered!.querySelectorAll('a.api-parameter-name')].map((link) => link.textContent)).toEqual(['control', 'request', 'options'])
      expect(rendered!.querySelector('a a')).toBeNull()
    } finally { await window.happyDOM.abort() }
  })

  it('give each spec clause of an overloaded function its own declaration', async () => {
    const entry = symbol('LibTmux.Selection.new/2')
    expect(entry.signatures.length).toBeGreaterThan(1)
    const { window, signatures } = await renderSignatures(entry, 'elixir', index)
    try {
      expect(signatures).toHaveLength(entry.signatures.length)
      expect(new Set(signatures.map((element) => displayedSignature(element))).size).toBe(entry.signatures.length)
    } finally { await window.happyDOM.abort() }
  })

  it('reach the Markdown twin as an Elixir code block', async () => {
    const entry = symbol('LibTmux.Server.snapshot/2')
    const markdown = await symbolMarkdownWithLayout({ model, symbol: entry, index })
    const code = fromMarkdown(markdown).children.find((node) => node.type === 'code')
    expect(code).toMatchObject({ value: entry.signatures[0]!.raw })
  })

  it('leave no type name in the committed model unresolved except those a language or a hidden module owns', () => {
    const unresolved = new Map<string, number>()
    for (const entry of model.symbols) {
      for (const signature of entry.signatures) {
        for (const span of index.linkType(signature.raw!, entry, signature)) {
          if (!span.link && !span.declaration && !span.keyword && /^[A-Z][A-Za-z0-9_.]*$/.test(span.text)) {
            unresolved.set(span.text, (unresolved.get(span.text) ?? 0) + 1)
          }
        }
      }
    }
    // A module that ExDoc hides has no page here either; naming it stays plain text.
    const hidden = ['Macro', 'LibTmux.Control.Admission', 'LibTmux.Control.Lifetime', 'LibTmux.Operation.Lifecycle']
    expect([...unresolved.keys()].filter((name) => !hidden.some((prefix) => name.startsWith(prefix)))).toEqual([])
  })
})

describe('Elixir reference model', () => {
  it('links each cross-reference its documentation writes in ExDoc syntax', () => {
    const entry = symbol('LibTmux.Capture.fetch/2')
    expect(index.resolve('t:option/0', 'any', entry)?.href).toMatch(/libtmux-capture-option-0\/$/)
    expect(index.resolve('LibTmux.Transport.OneShot.run/3', 'any', entry)?.href).toMatch(/libtmux-transport-oneshot-run-3\/$/)
    expect(index.resolve('LibTmux.Control.Admission.acquire/2', 'any', entry)).toBeUndefined()
    expect(index.resolve('Server.snapshot/2', 'any', entry)?.href).toMatch(/libtmux-server-snapshot-2\/$/)
  })

  it('gives a bang function a readable page of its own', () => {
    expect(symbol('LibTmux.Control.submit!/3').slug).toBe('libtmux-control-submit-bang-3')
    expect(symbol('LibTmux.Control.submit/3').slug).toBe('libtmux-control-submit-3')
    const slugs = model.symbols.map((entry: ApiSymbol) => entry.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
