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

  it('resolves module-alias members in odoc and signatures without crossing namespaces', () => {
    const root = artifact().symbols[0]! as ApiSymbol
    const symbol = (id: string, kind: ApiSymbol['kind'], parent: string, extra = {}): ApiSymbol => ({
      ...root, id, publicId: id, qualifiedName: id.replace(/:type$/, ''),
      name: id.split('.').at(-1)!.replace(/:type$/, ''), kind, parent, ...extra,
    })
    const owner = symbol('Libtmux.Client', 'module', 'Libtmux')
    const values = [root, owner,
      symbol('Libtmux.Report', 'module', 'Libtmux'),
      symbol('Libtmux.Report.state', 'function', 'Libtmux.Report'),
      symbol('Libtmux.Report.state:type', 'typealias', 'Libtmux.Report'),
      symbol('Libtmux.Cleanup', 'module', 'Libtmux', { exportedFrom: 'Libtmux.Report' }),
      symbol('Libtmux.Client.Local', 'module', owner.id, { exportedFrom: 'Libtmux.Cleanup' }),
      symbol('Libtmux.Cycle', 'module', 'Libtmux', { exportedFrom: 'Libtmux.Cycle' }),
    ]
    const index = new SymbolIndex(values, (value) => `/${value.id}`, 'ocaml')
    expect(index.resolve('Cleanup.state', 'odoc:val', owner)?.symbol?.id).toBe('Libtmux.Report.state')
    expect(index.resolve('module-Local.type-state', 'odoc:type', owner)?.symbol?.id).toBe('Libtmux.Report.state:type')
    expect(index.linkType('Local.state', owner)[0]?.link?.symbol?.id).toBe('Libtmux.Report.state:type')
    expect(index.resolve('Cleanup.state', 'odoc:module', owner)).toBeUndefined()
    expect(index.resolve('type-Cleanup.val-state', 'odoc:val', owner)).toBeUndefined()
    expect(index.resolve('Cleanup.missing', 'odoc:val', owner)).toBeUndefined()
    expect(index.resolve('Cycle.state', 'odoc:val', owner)).toBeUndefined()
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
