import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-pane-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { navSidecar } from '../src/nav-sidecar'

describe('the native Haskell pane profile', () => {
  it('preserves receipt synonyms and their constructor-hidden target', () => {
    const model = extractHaskellArtifact(artifact)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    const receipt = 'LibTmux.Creation#t:CreatedEntities'
    expect(symbol(receipt).modifiers).toEqual(['opaque'])
    expect(symbol('LibTmux.Creation#v:CreatedEntities')).toBeUndefined()
    for (const name of ['CreatedSession', 'CreatedWindow', 'CreatedPane']) {
      expect(symbol(`LibTmux.Creation#t:${name}`)).toMatchObject({
        modifiers: [], signatures: [{ raw: `type ${name} = CreatedEntities`,
          nativeSpans: expect.arrayContaining([expect.objectContaining({ target: receipt })]) }],
      })
    }
    expect(symbol('LibTmux.Creation#v:CreatedEntities.session')).toMatchObject({
      parent: receipt, signatures: [{ raw: 'session :: SessionRef' }],
      source: { file: 'internal/LibTmux/Internal/Graph.hs' },
    })
  })

  it('keeps creation context and pane observations with their object', () => {
    const nav = navSidecar('haskell', extractHaskellArtifact(artifact))!
    expect(nav.diagnostics).toMatchObject({ unmatched: [], ambiguous: [], staleUnsettled: [] })
    expect(nav.placement['LibTmux.Creation#t:CreatedEntities']).toBe('server')
    expect(nav.placement['LibTmux.Server#v:createSession']).toBe('session')
    for (const id of ['LibTmux.Creation#t:WindowOptions', 'LibTmux.Creation#t:WindowPlacement',
      'LibTmux.Server#v:createWindow']) expect(nav.placement[id]).toBe('window')
    for (const id of ['LibTmux.Creation#t:SplitOptions', 'LibTmux.Server#v:splitPane',
      'LibTmux.Pane#t:PaneCaptureOptions', 'LibTmux.Server#t:PaneText',
      'LibTmux.Server#v:capturePane', 'LibTmux.Server#v:paneText']) expect(nav.placement[id]).toBe('pane')
  })

  it('requires a native synonym target and the pane source inventory', () => {
    const changed = structuredClone(artifact)
    const alias = changed.symbols.find((entry) => entry.id === 'LibTmux.Creation#t:CreatedWindow')!
    alias.signatures[0]!.nativeSpans = alias.signatures[0]!.nativeSpans.map((span) => {
      const plain = { ...span }
      delete plain.target
      delete plain.href
      return plain
    })
    expect(() => extractHaskellArtifact(changed)).toThrow(/native type synonym/)
    const missing = structuredClone(artifact)
    missing.nativeProvenance.files = missing.nativeProvenance.files.filter((file) => file.path !== 'src/LibTmux/Pane.hs')
    expect(() => extractHaskellArtifact(missing)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/6'
    downgraded.profile = 'programs/1'
    downgraded.nativeProvenance.exporter.version = 6
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/module profile/)
  })
})
