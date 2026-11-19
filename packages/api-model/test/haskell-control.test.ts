import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-control-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'

describe('the native Haskell control profile', () => {
  it('preserves STM event reads and an opaque attached-client owner', () => {
    const model = extractHaskellArtifact(artifact)
    const symbol = (id: string) => model.symbols.find((entry) => entry.id === id)!
    expect(symbol('LibTmux.Control#v:readControlEvent').signatures[0]!.raw)
      .toBe('readControlEvent :: Control -> STM (Either ControlEnd ControlEvent)')
    expect(symbol('LibTmux.Control#v:pollControlEvent').signatures[0]!.raw)
      .toBe('pollControlEvent :: Control -> STM (Maybe (Either ControlEnd ControlEvent))')
    expect(symbol('LibTmux.Control#t:Control')).toMatchObject({
      modifiers: ['opaque'], source: { file: 'internal/LibTmux/Internal/Control.hs' },
    })
    expect(model.symbols.some((entry) => entry.id === 'LibTmux.Control#v:Control')).toBe(false)
    expect(symbol('LibTmux.Server#v:withControl').signatures[0]!.raw)
      .toBe('withControl :: Server -> SessionRef -> ControlOptions -> (Control -> IO a) -> IO a')
  })

  it('keeps Recovery Program imports as references to canonical Program declarations', () => {
    const model = extractHaskellArtifact(artifact)
    const recovery = artifact.modules.find((entry) => entry.name === 'LibTmux.Recovery')!
    const imported = recovery.reexports[0]!
    expect(imported.module).toBe('LibTmux.Program')
    expect(imported.members).toContain('LibTmux.Program#t:ProgramRecovery')
    for (const id of imported.members!) {
      expect(model.symbols.filter((entry) => entry.id === id)).toHaveLength(1)
      expect(model.symbols.some((entry) => entry.id === id.replace('LibTmux.Program#', 'LibTmux.Recovery#'))).toBe(false)
    }
    expect(model.symbols.find((entry) => entry.id === 'LibTmux.Recovery')!.doc?.body)
      .toContain(':obj:`LibTmux.Program <LibTmux.Program>` (selected exports)')
  })

  it('rejects a changed canonical reexport owner or an older module profile', () => {
    const changed = structuredClone(artifact)
    changed.modules.find((entry) => entry.name === 'LibTmux.Recovery')!.reexports[0]!.module = 'LibTmux.Server'
    expect(() => extractHaskellArtifact(changed)).toThrow(/module reexports/)
    const old = structuredClone(artifact)
    old.schema = 'libtmux.haskell-api/9'
    old.profile = 'options/1'
    old.nativeProvenance.exporter.version = 9
    expect(() => extractHaskellArtifact(old)).toThrow(/module profile/)
  })
})
