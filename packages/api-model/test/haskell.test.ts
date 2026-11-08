import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractHaskellArtifact } from '../src/languages/haskell.ts'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { SymbolIndex } from '../src/link.ts'
import { navSidecar } from '../src/nav-sidecar.ts'
import { sourceUrl } from '../src/products.ts'

const artifact = JSON.parse(readFileSync(new URL('./fixtures/haskell-native/artifact.json', import.meta.url), 'utf8'))
const native = (input: typeof artifact) => input.symbols.find((symbol: { id: string }) => symbol.id === 'LibTmux.Id#t:SessionId')

describe('Haddock shared-model adapter', () => {
  it('retains independently identified library, producer and native inputs', () => {
    const model = extractHaskellArtifact(artifact, artifact.revision)
    expect(model).toMatchObject({ port: 'haskell', repo: artifact.repo, revision: artifact.revision })
    expect(model.nativeProvenance).toEqual(artifact.nativeProvenance)
    expect(model.nativeProvenance!.exporter.revision).not.toBe(model.revision)
    expect(model.sources).toEqual([{
      product: 'core', package: 'libtmux-haskell', version: '0.1.0.0', repo: artifact.repo,
      revision: artifact.revision, extractedRevision: artifact.revision,
    }])
    expect(model.symbols).toHaveLength(38)
    const pane = model.symbols.find((symbol) => symbol.id === 'LibTmux.Id#v:parsePaneId')!
    expect(sourceUrl(model, pane)).toBe(`https://github.com/${artifact.repo}/blob/${artifact.revision}/src/LibTmux/Id.hs#L79`)
    expect(sourceUrl(model, model.symbols[0])).toBe(`https://github.com/${artifact.repo}/blob/${artifact.revision}/src/LibTmux/Id.hs`)
  })

  it('preserves native signatures, opaque types, constructors and non-selector record labels', () => {
    const model = extractHaskellArtifact(artifact)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    for (const native of artifact.symbols) expect(symbol(native.id).signatures).toEqual(native.signatures)
    expect(symbol('LibTmux.Id#t:SessionId')).toMatchObject({ kind: 'typealias', modifiers: ['opaque'] })
    expect(symbol('LibTmux.Id#t:SessionId').signatures[0].raw).toBe('data SessionId')
    expect(symbol('LibTmux.Id#t:SessionId')).not.toHaveProperty('type')
    expect(symbol('LibTmux.Id#t:SessionId')).not.toHaveProperty('extends')
    expect(symbol('LibTmux.Id#v:InvalidId')).toMatchObject({
      parent: 'LibTmux.Id#t:IdError', signatures: [{ methodKind: 'constructor', raw: 'InvalidId', params: [] }],
    })
    expect(symbol('LibTmux.Id#v:expectedPrefix')).toMatchObject({
      kind: 'property', parent: 'LibTmux.Id#t:IdError', signatures: [{ raw: 'expectedPrefix :: !Char' }],
    })
    expect(model.symbols.filter((entry) => entry.name === 'expectedPrefix')).toHaveLength(1)
    expect(model.symbols.some((entry) => ['show', 'compare', 'rnf'].includes(entry.name))).toBe(false)
  })

  it('keeps authored interlinks and examples and adds instance heads with their exact source links', () => {
    const model = extractHaskellArtifact(artifact)
    const module = model.symbols.find((symbol) => symbol.id === 'LibTmux.Id')!
    expect(module.doc).toEqual(artifact.symbols.find((symbol: { id: string }) => symbol.id === module.id).doc)
    const session = model.symbols.find((symbol) => symbol.id === 'LibTmux.Id#t:SessionId')!
    expect(session.doc!.body).toContain('## Instances\n\n')
    expect(session.doc!.body).toContain('instance [Eq](https://hackage.haskell.org/package/base-4.22.0.0/docs/Data-Eq.html#t:Eq)')
    expect(session.doc!.body).toContain(':obj:`SessionId <LibTmux.Id#t:SessionId>`')
    expect(session.doc!.body).toContain(`[Source](https://github.com/${artifact.repo}/blob/${artifact.revision}/src/LibTmux/Id.hs#L46)`)
    expect(session.references).toContainEqual({ target: session.id, kind: 'type' })
    expect(model.symbols.find((symbol) => symbol.id === 'LibTmux.Id#v:parsePaneId')!.references).toEqual([
      { target: 'LibTmux.Id#t:IdError', kind: 'type' }, { target: 'LibTmux.Id#t:PaneId', kind: 'type' },
    ])
  })

  it('regenerates complete native navigation from the stored model alone', () => {
    const model = extractHaskellArtifact(artifact)
    expect(model.exportGroups).toEqual(artifact.modules.flatMap((module: { name: string; groups: object[] }) =>
      module.groups.map((group) => ({ owner: module.name, ...group }))))
    const sidecar = navSidecar('haskell', JSON.parse(JSON.stringify(model)))!
    expect(sidecar.buckets.map((bucket) => bucket.label)).toEqual(artifact.package.exposedModules)
    expect(Object.keys(sidecar.placement)).toHaveLength(31)
    expect(sidecar.diagnostics).toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
  })

  it('resolves the native public identities in normalized prose and keeps instance URLs', () => {
    const model = extractHaskellArtifact(artifact)
    const index = new SymbolIndex(model.symbols, (symbol) => `/${encodeURIComponent(symbol.publicId ?? symbol.id)}/`, 'haskell')
    const text = model.symbols.find((symbol) => symbol.id === 'LibTmux.Id')!.doc!.body!
    expect(tokenizeDoc(text, 'haskell')).toContainEqual({
      kind: 'ref', role: 'obj', target: 'LibTmux.Id#v:parseSessionId', label: 'parseSessionId',
    })
    const instances = tokenizeDoc(model.symbols.find((symbol) => symbol.id === 'LibTmux.Id#t:SessionId')!.doc!.body!, 'haskell')
    expect(instances).toContainEqual({ kind: 'link', text: 'Eq',
      href: 'https://hackage.haskell.org/package/base-4.22.0.0/docs/Data-Eq.html#t:Eq' })
    for (const symbol of model.symbols) {
      for (const prose of [symbol.doc?.summary, symbol.doc?.body].filter((text): text is string => !!text)) {
        for (const span of tokenizeDoc(prose, 'haskell')) {
          if (span.kind === 'ref') expect(index.resolve(span.target, span.role, symbol), span.target).toBeDefined()
        }
      }
    }
  })

  it.each([
    ['schema', (a: typeof artifact) => { a.schema = 'libtmux.haskell-api/2' }],
    ['compiler profile', (a: typeof artifact) => { a.compiler = '9.12.2' }],
    ['selected source revision', (a: typeof artifact) => { a.revision = 'f'.repeat(40) }],
    ['producer identity', (a: typeof artifact) => { a.nativeProvenance.exporter.revision = 'main' }],
    ['native input hash', (a: typeof artifact) => { a.nativeProvenance.exporter.nativeArtifacts[0].sha256 = 'bad' }],
    ['missing native input', (a: typeof artifact) => { a.nativeProvenance.exporter.nativeArtifacts.pop() }],
    ['missing source input', (a: typeof artifact) => { a.nativeProvenance.files.pop() }],
    ['duplicate symbol', (a: typeof artifact) => { a.symbols.push(a.symbols[0]) }],
    ['public namespace', (a: typeof artifact) => { native(a).namespace = 'LibTmux.Private' }],
    ['unsupported symbol kind', (a: typeof artifact) => { native(a).kind = 'class' }],
    ['private declaration', (a: typeof artifact) => { native(a).apiScope = 'internal' }],
    ['parent identity', (a: typeof artifact) => { native(a).parent = 'missing' }],
    ['source path', (a: typeof artifact) => { native(a).source.file = '../secret.hs' }],
    ['source revision', (a: typeof artifact) => { native(a).source.revision = 'e'.repeat(40) }],
    ['source line', (a: typeof artifact) => { native(a).source.line = 0 }],
    ['opaque representation', (a: typeof artifact) => { native(a).signatures[0].raw += ' = MkSessionId Word32' }],
    ['lost opaque status', (a: typeof artifact) => { native(a).modifiers = [] }],
    ['constructor role on a record label', (a: typeof artifact) => {
      a.symbols.find((symbol: { name: string }) => symbol.name === 'expectedPrefix').signatures[0].methodKind = 'constructor'
    }],
    ['missing native spans', (a: typeof artifact) => { delete native(a).signatures[0].nativeSpans }],
    ['mismatched native spans', (a: typeof artifact) => { native(a).signatures[0].nativeSpans[0].text = 'newtype' }],
    ['declaration marker', (a: typeof artifact) => { delete native(a).signatures[0].nativeSpans[2].declaration }],
    ['missing export group', (a: typeof artifact) => { a.modules[0].groups.pop() }],
    ['missing module', (a: typeof artifact) => { a.modules.pop() }],
    ['instance source', (a: typeof artifact) => { native(a).instances[0].source.revision = 'e'.repeat(40) }],
    ['missing instances metadata', (a: typeof artifact) => { delete native(a).instances }],
    ['another type\'s instances', (a: typeof artifact) => {
      native(a).instances = a.symbols.find((symbol: { id: string }) => symbol.id === 'LibTmux.Id#t:PaneId').instances
    }],
    ['instance Markdown', (a: typeof artifact) => { native(a).instances[0].markdown += ' wrong display' }],
    ['instance raw head', (a: typeof artifact) => { native(a).instances[0].raw = 'instance NFData PaneId' }],
  ])('rejects invalid %s instead of publishing a partial reference', (_name, mutate) => {
    const input = structuredClone(artifact)
    mutate(input)
    expect(() => extractHaskellArtifact(input, artifact.revision)).toThrow(/Haskell|export group/)
  })

  it('rejects a coherent but unqualified replacement module', () => {
    const input = JSON.parse(JSON.stringify(artifact)
      .replaceAll('LibTmux.Id', 'LibTmux.Other')
      .replaceAll('LibTmux-Id', 'LibTmux-Other')
      .replaceAll('LibTmux/Id.hs', 'LibTmux/Other.hs'))
    expect(() => extractHaskellArtifact(input)).toThrow(/Haskell.*module/)
  })

  it.each([
    ['unknown target', { target: 'LibTmux.Private#t:Secret', href: 'LibTmux-Private.html#t:Secret' }],
    ['wrong native anchor', { target: 'LibTmux.Id#t:IdError', href: 'LibTmux-Id.html#t:PaneId' }],
    ['unresolved relative link', { href: 'LibTmux-Id.html#t:IdError' }],
    ['unsafe external link', { href: 'javascript:alert(1)' }],
  ])('rejects a %s in a signature or an instance', (_name, destination) => {
    for (const context of ['signature', 'instance']) {
      const input = structuredClone(artifact)
      const reference = context === 'signature'
        ? input.symbols.find((symbol: { name: string }) => symbol.name === 'parsePaneId').signatures[0].nativeSpans[5]
        : native(input).instances[0].references[1]
      delete reference.target
      Object.assign(reference, destination)
      expect(() => extractHaskellArtifact(input)).toThrow(/Haskell/)
    }
  })
})
