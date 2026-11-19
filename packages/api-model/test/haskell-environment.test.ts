import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-environment-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { navSidecar } from '../src/nav-sidecar'

describe('the native Haskell environment profile', () => {
  it('retains named environment values and private layout provenance', () => {
    const model = extractHaskellArtifact(artifact)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    expect(symbol('LibTmux.Server#v:getEnvironment').signatures[0]!.raw)
      .toBe('getEnvironment :: Server -> EnvironmentScope -> ByteString -> IO (Maybe EnvironmentEntry)')
    expect(symbol('LibTmux.Server#t:NamedLayout').source?.file).toBe('internal/LibTmux/Internal/Command.hs')
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
    const nav = navSidecar('haskell', model)!
    expect(nav.diagnostics).toMatchObject({ unmatched: [], ambiguous: [], staleUnsettled: [] })
    for (const id of ['LibTmux.Environment', 'LibTmux.Environment#t:EnvironmentEntry',
      'LibTmux.Server#v:getEnvironment', 'LibTmux.Server#v:markEnvironmentRemoved']) expect(nav.placement[id]).toBe('environment')
    expect(nav.placement['LibTmux.Server#t:PaneWaitOptions']).toBe('pane')
    expect(nav.placement['LibTmux.Server#v:waitForText']).toBe('pane')
    expect(nav.placement['LibTmux.Server#v:linkWindow']).toBe('window')
    expect(nav.placement['LibTmux.Server#v:selectExactPane']).toBe('pane')
    expect(nav.placement['LibTmux.Server#t:NamedLayout']).toBe('layout')
  })

  it('requires the private defining source and the expanded module profile', () => {
    const missing = structuredClone(artifact)
    missing.nativeProvenance.files = missing.nativeProvenance.files.filter((file) => file.path !== 'internal/LibTmux/Internal/Command.hs')
    expect(() => extractHaskellArtifact(missing)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/7'
    downgraded.profile = 'pane-text/1'
    downgraded.nativeProvenance.exporter.version = 7
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/module profile/)
  })
})
