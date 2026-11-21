import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-programs-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { navSidecar } from '../src/nav-sidecar'

describe('the native Haskell Program profile', () => {
  it('keeps canonical Program declarations and the umbrella import visibility', () => {
    const model = extractHaskellArtifact(artifact)
    expect(model.symbols.filter((symbol) => symbol.namespace === 'LibTmux')).toEqual([])
    const root = artifact.modules.find((module) => module.name === 'LibTmux')!
    const partial = root.reexports!.find((item) => item.module === 'LibTmux.Program')!
    expect(partial.members).toContain('LibTmux.Program#t:ProgramOptions')
    expect(partial.members).not.toContain('LibTmux.Program#v:ProgramOptions')
    expect(partial.members!.some((id) => id.startsWith('LibTmux.Program#v:ProgramOptions.'))).toBe(false)
    expect(model.symbols.find((symbol) => symbol.id === 'LibTmux.Program#v:ProgramOptions.arguments'))
      .toMatchObject({ parent: 'LibTmux.Program#t:ProgramOptions', signatures: [{ raw: 'arguments :: ![PosixString]' }],
        source: { file: 'internal/LibTmux/Internal/Program.hs' } })
    for (const id of ['LibTmux.Server#v:withProgram', 'LibTmux.Server#v:sendKeys',
      'LibTmux.Server#v:killPane', 'LibTmux.Capabilities#v:capabilityRegistry']) {
      expect(model.symbols.some((symbol) => symbol.id === id), id).toBe(true)
    }
  })

  it('rejects an alias that belongs to another module', () => {
    const changed = structuredClone(artifact)
    const partial = changed.modules.find((module) => module.name === 'LibTmux')!.reexports!
      .find((item) => item.module === 'LibTmux.Program')!
    partial.members!.push('LibTmux.Server#v:withServer')
    expect(() => extractHaskellArtifact(changed)).toThrow(/partial reexport/)
  })

  it('keeps owned Program state together and places target operations by object', () => {
    const nav = navSidecar('haskell', extractHaskellArtifact(artifact))!
    expect(nav.diagnostics).toMatchObject({ unmatched: [], ambiguous: [], staleUnsettled: [] })
    for (const name of ['Program', 'ProgramOptions', 'ProgramScreen', 'ProgramResult', 'ProgramRecovery']) {
      expect(nav.placement[`LibTmux.Program#t:${name}`]).toBe('server')
    }
    for (const name of ['withProgram', 'runProgram']) expect(nav.placement[`LibTmux.Server#v:${name}`]).toBe('server')
    expect(nav.placement['LibTmux.Server#v:killSession']).toBe('session')
    expect(nav.placement['LibTmux.Server#v:killWindow']).toBe('window')
    expect(nav.placement['LibTmux.Server#v:killPane']).toBe('pane')
    expect(nav.placement['LibTmux.Server#v:sendKeys']).toBe('pane')
    expect(nav.placement['LibTmux.Server#t:PaneInput']).toBe('pane')
  })

  it('requires the private defining source and the Program profile', () => {
    const changed = structuredClone(artifact)
    changed.nativeProvenance.files = changed.nativeProvenance.files.filter((file) => !file.path.endsWith('/Internal/Program.hs'))
    expect(() => extractHaskellArtifact(changed)).toThrow(/source inputs/)
    const downgraded = structuredClone(artifact)
    downgraded.schema = 'libtmux.haskell-api/5'
    downgraded.profile = 'creations/1'
    downgraded.nativeProvenance.exporter.version = 5
    expect(() => extractHaskellArtifact(downgraded)).toThrow(/module profile/)
  })
})
