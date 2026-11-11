import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-mutations-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { SymbolIndex, tokenizeDoc } from '../src/reference'
import { navSidecar } from '../src/nav-sidecar'

describe('the native Haskell mutation profile', () => {
  it('preserves checked commands, options and opaque recovery ownership', () => {
    const model = extractHaskellArtifact(artifact, artifact.revision)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === `LibTmux.Server#${id}`)!
    expect(symbol('v:renameSession').signatures[0].raw).toBe('renameSession :: Server -> SessionRef -> Text -> IO ()')
    expect(symbol('v:renameWindow').signatures[0].raw).toBe('renameWindow :: Server -> WindowRef -> TmuxText -> IO ()')
    expect(symbol('v:setPaneTitle').signatures[0].raw).toBe('setPaneTitle :: Server -> PaneRef -> Text -> IO ()')
    expect(symbol('v:renameSessionWith').signatures[0].raw)
      .toBe('renameSessionWith :: MutationOptions -> Server -> SessionRef -> Text -> IO ()')
    expect(symbol('t:MutationRecovery').modifiers).toEqual(['opaque'])
    expect(symbol('t:MutationRecovery').source?.file).toBe('internal/LibTmux/Internal/Mutation.hs')
    expect(symbol('t:MutationOptions').modifiers).toEqual([])
    expect(symbol('v:MutationOptions.timeout')).toMatchObject({
      kind: 'property', parent: 'LibTmux.Server#t:MutationOptions',
    })
    expect(symbol('v:MutationAppliedWithErrors').parent).toBe('LibTmux.Server#t:TmuxException')
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
    expect(navSidecar('haskell', structuredClone(model))!.diagnostics)
      .toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
  })

  it('resolves recovery and command links through the public reference', () => {
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

  it('rejects a missing defining origin and a downgraded profile', () => {
    const missing = structuredClone(artifact)
    missing.nativeProvenance.files = missing.nativeProvenance.files.filter((input) => !input.path.endsWith('/Mutation.hs'))
    expect(() => extractHaskellArtifact(missing)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/3'
    downgraded.profile = 'queries/1'
    downgraded.nativeProvenance.exporter.version = 3
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/source inputs/)
  })
})
