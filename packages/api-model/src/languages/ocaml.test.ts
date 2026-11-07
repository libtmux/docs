import { describe, expect, it } from 'vitest'
import { extractOcamlArtifact } from './ocaml.ts'
import { SymbolIndex } from '../link.ts'
import type { ApiSymbol } from '../model.ts'

const revision = 'a'.repeat(40)
const exporter = 'b'.repeat(40)
const artifact = () => ({
  schema: 'libtmux.ocaml-api/1', port: 'ocaml', compiler: '5.5.2', revision,
  repo: 'https://github.com/libtmux/libtmux-ocaml', extractor: 'native cmti',
  nativeProvenance: { files: [{ path: 'lib/libtmux.mli', sha256: 'c'.repeat(64) }], exporter: { revision: exporter } },
  sources: [{ package: 'libtmux', product: 'core', repo: 'https://github.com/libtmux/libtmux-ocaml', revision }],
  symbols: [
    { id: 'Libtmux', name: 'Libtmux', qualifiedName: 'Libtmux', publicId: 'Libtmux', publicOwner: 'Libtmux',
      apiScope: 'exported', package: 'libtmux', product: 'core', kind: 'module', modifiers: [], signatures: [],
      source: { file: 'lib/libtmux.mli', line: 1, revision } },
    { id: 'Libtmux.t', name: 't', qualifiedName: 'Libtmux.t', publicId: 'Libtmux.t', parent: 'Libtmux', publicOwner: 'Libtmux',
      apiScope: 'exported', package: 'libtmux', product: 'core', kind: 'typealias', modifiers: ['opaque'],
      signatures: [{ raw: 'type t', params: [] }], source: { file: 'lib/libtmux.mli', line: 2, revision } },
  ],
})

describe('OCaml compiled public interfaces', () => {
  it('keeps typed odoc links, custom labels, guide URLs and literal code distinct', () => {
    const symbols = artifact().symbols as ApiSymbol[]
    const common = { ...symbols[1]!, name: 'state', qualifiedName: 'Libtmux.state', modifiers: [] }
    symbols.push({ ...common, id: 'Libtmux.state', publicId: 'Libtmux.state', kind: 'function' },
      { ...common, id: 'Libtmux.state:type', publicId: 'Libtmux.state:type', kind: 'enum' },
      { ...common, id: 'Libtmux.state:type.Ready', publicId: 'Libtmux.state:type.Ready', parent: 'Libtmux.state:type', name: 'Ready', qualifiedName: 'Libtmux.Ready', kind: 'constant', variant: 'unit' })
    const index = new SymbolIndex(symbols, (symbol) => `/${symbol.id}`, 'ocaml')
    const spans = index.docSpans('{!type-state} {!val-state} {{!type-state}the state type} `state` [Guide](https://ocaml.org/manual/5.5/typedecl.html)', symbols[0])
    const references = spans.filter((span) => span.kind === 'ref')
    expect(references.map((span) => span.link?.symbol?.id)).toEqual(['Libtmux.state:type', 'Libtmux.state', 'Libtmux.state:type'])
    expect(references[2]).toMatchObject({ label: 'the state type', code: false })
    expect(spans).toContainEqual({ kind: 'code', text: 'state' })
    expect(spans).toContainEqual({ kind: 'link', text: 'Guide', href: 'https://ocaml.org/manual/5.5/typedecl.html' })
    expect(index.docSpans('{!type-missing}', symbols[0])[0]).toMatchObject({ target: 'missing', link: undefined })
    expect(index.docSpans('{!module-Libtmux.type-state}', symbols[1])[0]).toMatchObject({ link: { symbol: { id: 'Libtmux.state:type' } } })
    expect(index.docSpans('{!type:Libtmux.state}', symbols[1])[0]).toMatchObject({ link: { symbol: { id: 'Libtmux.state:type' } } })
    expect(index.docSpans('{!module-state}', symbols[0])[0]).toMatchObject({ link: undefined })
    expect(index.docSpans('{!Libtmux.Ready}', symbols[0])[0]).toMatchObject({ link: { symbol: { id: 'Libtmux.state:type.Ready' } } })
    expect(index.docSpans('{!type-state.constructor-Ready}', symbols[0])[0]).toMatchObject({ link: { symbol: { id: 'Libtmux.state:type.Ready' } } })
    expect(index.docSpans('{!val-Ready}', symbols[0])[0]).toMatchObject({ link: undefined })
    const signature = { raw: 'val state : t -> state', params: [] }
    const typeSpans = index.linkType(signature.raw, symbols[2], signature)
    expect(typeSpans.filter((span) => span.text === 'state')).toMatchObject([
      { declaration: true }, { link: { symbol: { id: 'Libtmux.state:type' } } },
    ])
    expect(index.linkType("('state, 'other) state", symbols[2]).filter((span) => span.link)
      .map((span) => span.link?.symbol?.id)).toEqual(['Libtmux.state:type'])
    expect(index.resolve('Iarray')?.href).toBe('https://ocaml.org/manual/5.5/api/Iarray.html')
    expect(index.linkType('state Seq.t', symbols[2]).find((span) => span.text === 'Seq.t')?.link)
      .toMatchObject({ href: 'https://ocaml.org/manual/5.5/api/Seq.html#TYPEt', external: true })
  })

  it('retains opaque types, native signatures and independent source/tool identities', () => {
    const model = extractOcamlArtifact(artifact(), revision)
    expect(model.port).toBe('ocaml')
    expect(model.symbols[1]?.signatures[0]?.raw).toBe('type t')
    expect(model.symbols[1]?.modifiers).toEqual(['opaque'])
    expect(model.revision).toBe(revision)
    expect(model.nativeProvenance?.exporter.revision).toBe(exporter)
  })

  it('rejects stale revisions, private paths, unknown products and unresolved aliases', () => {
    expect(() => extractOcamlArtifact(artifact(), exporter)).toThrow(/revision/)
    const privateSymbol = artifact()
    privateSymbol.symbols[1]!.id = 'Libtmux__Graph.t'
    expect(() => extractOcamlArtifact(privateSymbol)).toThrow(/public/)
    const mcp = artifact()
    mcp.symbols[1]!.product = 'mcp'
    expect(() => extractOcamlArtifact(mcp)).toThrow(/product/)
    const missing = artifact()
    Object.assign(missing.symbols[1]!, { exportedFrom: 'Libtmux.Private' })
    expect(() => extractOcamlArtifact(missing)).toThrow(/alias/)
  })
})
