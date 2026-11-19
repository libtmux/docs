import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-fields-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'

describe('the native consolidated Haskell field profile', () => {
  it('preserves row prefixes, relationship targets and captured metadata', () => {
    const model = extractHaskellArtifact(artifact)
    const signature = (name: string) => model.symbols.find((entry) => entry.id === `LibTmux.Query.Fields#v:${name}`)!.signatures[0]!.raw
    expect(signature('paneActive')).toBe('paneActive :: Field Pane Bool')
    expect(signature('sessionWindowLinks')).toBe('sessionWindowLinks :: ToMany Session WindowLink')
    expect(signature('serverInfoVersion')).toBe('serverInfoVersion :: Field ServerInfo TmuxVersion')
    expect(model.symbols.some((entry) => entry.id === 'LibTmux.Snapshot#t:CaptureInterval')).toBe(true)
    const modules = model.symbols.filter((entry) => entry.kind === 'module').map((entry) => entry.id)
    expect(modules).toContain('LibTmux.Query.Fields')
    expect(modules.filter((name) => name.startsWith('LibTmux.Query.'))).toEqual(['LibTmux.Query.Fields'])
  })

  it('rejects the previous public module layout', () => {
    const changed = structuredClone(artifact)
    changed.schema = 'libtmux.haskell-api/10'
    changed.profile = 'control/1'
    changed.nativeProvenance.exporter.version = 10
    expect(() => extractHaskellArtifact(changed)).toThrow(/module profile/)
  })
})
