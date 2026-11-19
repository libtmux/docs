import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-options-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { navSidecar } from '../src/nav-sidecar'

describe('the native Haskell options profile', () => {
  it('keeps exact stores, binary transfer, geometry and native object directories', () => {
    const model = extractHaskellArtifact(artifact)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    expect(symbol('LibTmux.Server#v:readBuffer').signatures[0]!.raw)
      .toBe('readBuffer :: Server -> ByteString -> IO ByteString')
    expect(symbol('LibTmux.Options#t:OptionScope').source?.file)
      .toBe('internal/LibTmux/Internal/OptionTable.hs')
    expect(symbol('LibTmux.Options#v:ServerOptions')).toMatchObject({
      parent: 'LibTmux.Options#t:OptionTarget',
      signatures: [{ raw: 'ServerOptions', methodKind: 'constructor' }],
    })
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
    for (const name of ['Session', 'Window', 'Pane']) {
      expect(symbol(`LibTmux.Snapshot#t:${name}`).doc?.body).toContain('### What is on here')
    }
    const nav = navSidecar('haskell', model)!
    expect(nav.diagnostics).toMatchObject({ unmatched: [], ambiguous: [], staleUnsettled: [] })
    expect(nav.placement['LibTmux.Options']).toBe('options')
    expect(nav.placement['LibTmux.Server#v:readOption']).toBe('options-functions')
    expect(nav.placement['LibTmux.Server#v:setHook']).toBe('hooks')
    expect(nav.placement['LibTmux.Server#v:pasteBuffer']).toBe('buffers')
    expect(nav.placement['LibTmux.Server#v:resizePane']).toBe('pane')
    expect(nav.placement['LibTmux.Server#v:resizeWindow']).toBe('window')
  })

  it('requires the private catalogue origin and its expanded public profile', () => {
    const missing = structuredClone(artifact)
    missing.nativeProvenance.files = missing.nativeProvenance.files.filter((file) => file.path !== 'internal/LibTmux/Internal/OptionTable.hs')
    expect(() => extractHaskellArtifact(missing)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/8'
    downgraded.profile = 'environment/1'
    downgraded.nativeProvenance.exporter.version = 8
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/module profile/)
  })
})
