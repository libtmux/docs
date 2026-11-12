import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-creations-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { navSidecar } from '../src/nav-sidecar'
import { SymbolIndex, tokenizeDoc } from '../src/reference'

describe('the native Haskell creation profile', () => {
  it('retains typed fields on the constructor-hidden creation receipt', () => {
    const model = extractHaskellArtifact(artifact, artifact.revision)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    const owner = 'LibTmux.Creation#t:CreatedSession'
    expect(symbol(owner).modifiers).toEqual(['opaque'])
    expect(symbol('LibTmux.Creation#v:CreatedSession')).toBeUndefined()
    for (const [name, type] of [['session', 'SessionRef'], ['window', 'WindowRef'],
      ['pane', 'PaneRef'], ['windowIndex', 'WindowIndex'], ['serverPid', 'Integer']]) {
      expect(symbol(`LibTmux.Creation#v:CreatedSession.${name}`)).toMatchObject({
        kind: 'property', parent: owner,
        signatures: [{ raw: `${name} :: ${type}` }],
        source: { file: 'internal/LibTmux/Internal/Graph.hs' },
      })
    }
    expect(symbol('LibTmux.Server#v:createSession').signatures[0].raw)
      .toBe('createSession :: Server -> SessionOptions -> IO CreatedSession')
    expect(symbol('LibTmux.Server#t:CreationRecovery')).toMatchObject({
      modifiers: ['opaque'], source: { file: 'internal/LibTmux/Internal/Creation.hs' },
    })
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
    expect(navSidecar('haskell', structuredClone(model))!.diagnostics)
      .toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
  })

  it('resolves every native declaration and authored reference', () => {
    const model = extractHaskellArtifact(artifact)
    const index = new SymbolIndex(model.symbols, (entry) => `/${encodeURIComponent(entry.id)}/`, 'haskell')
    for (const entry of model.symbols) {
      for (const reference of entry.references ?? []) expect(index.resolve(reference.target, 'obj', entry)).toBeDefined()
      for (const text of [entry.doc?.summary, entry.doc?.body].filter((value): value is string => !!value)) {
        for (const span of tokenizeDoc(text, 'haskell')) {
          if (span.kind === 'ref') expect(index.resolve(span.target, span.role, entry), `${entry.id}: ${span.target}`).toBeDefined()
        }
      }
    }
  })

  it('requires the creation profile and its recovery source', () => {
    const missing = structuredClone(artifact)
    missing.nativeProvenance.files = missing.nativeProvenance.files.filter((input) => !input.path.endsWith('/Creation.hs'))
    expect(() => extractHaskellArtifact(missing)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/4'
    downgraded.profile = 'mutations/1'
    downgraded.nativeProvenance.exporter.version = 4
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/module profile/)
  })

  it('keeps constructors hidden when their record fields are exported', () => {
    const changed = structuredClone(artifact)
    const constructor = structuredClone(changed.symbols.find((entry) => entry.id === 'LibTmux.Creation#v:SessionOptions')!)
    Object.assign(constructor, {
      id: 'LibTmux.Creation#v:CreatedSession', publicId: 'LibTmux.Creation#v:CreatedSession',
      qualifiedName: 'LibTmux.Creation.CreatedSession', name: 'CreatedSession',
      parent: 'LibTmux.Creation#t:CreatedSession', definingModule: 'LibTmux.Internal.Graph',
      nativeLocation: { module: 'LibTmux.Creation', anchor: 'v:CreatedSession' },
      source: { file: 'internal/LibTmux/Internal/Graph.hs', revision: artifact.revision },
    })
    changed.symbols.push(constructor)
    expect(() => extractHaskellArtifact(changed)).toThrow(/invalid public parent|opaque status/)
  })
})
