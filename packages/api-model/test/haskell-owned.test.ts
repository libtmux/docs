import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-owned-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'

describe('the native Haskell private daemon interface', () => {
  it('preserves scoped startup, explicit retirement and configuration declarations', () => {
    const model = extractHaskellArtifact(artifact, 'd43a4302fac4c6be30131fe0ca0d7cf563b50ab1')
    const declaration = (name: string) => model.symbols.find((entry) => entry.id === `LibTmux.Server#${name}`)!
    expect(declaration('v:withOwnedServer').signatures[0]!.raw)
      .toBe('withOwnedServer :: OwnedServerConfig -> (Server -> IO a) -> IO a')
    expect(declaration('v:killServer').signatures[0]!.raw).toBe('killServer :: Server -> IO ()')
    expect(declaration('v:defaultOwnedServerConfig').signatures[0]!.raw)
      .toBe('defaultOwnedServerConfig :: OwnedServerConfig')
    expect(declaration('t:OwnedServerConfig').source?.file).toBe('src/LibTmux/Server.hs')
    expect(declaration('v:OwnedServerConfig.tmuxExecutable').signatures[0]!.raw)
      .toBe('tmuxExecutable :: !PosixPath')
    expect(declaration('v:OwnedServerConfig.operationTimeout').signatures[0]!.raw)
      .toBe('operationTimeout :: !NominalDiffTime')
    expect(declaration('v:OwnedOperationTimeout').source?.file).toBe('internal/LibTmux/Internal/Scope.hs')
    expect(declaration('v:withOwnedServer').doc?.summary).toContain('peer pidfds')
    expect(declaration('v:killServer').doc?.summary).toContain('ServerClosed')
  })
})
