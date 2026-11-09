import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractHaskellArtifact, type ApiSymbol } from '@libtmux/api-model'
import { apiSignatureLayouts } from '../src/lib/code-layout'

const model = extractHaskellArtifact(JSON.parse(readFileSync(new URL(
  '../../packages/api-model/test/fixtures/haskell-observations-native/artifact.json', import.meta.url,
), 'utf8')))

describe('native Haskell type continuation layout', () => {
  it.each([
    ['LibTmux.Server#v:tryTmux', 'tryTmux\n  :: IO a\n  -> IO (Either (ExceptionWithContext TmuxException) a)'],
    ['LibTmux.Snapshot#v:linksForSession', 'linksForSession\n  :: Snapshot\n  -> SessionRef\n  -> Either LookupError [WindowLink]'],
    ['LibTmux.Snapshot.Fixture#v:validateFixture', 'validateFixture\n  :: FixtureOrigin\n  -> Fixture\n  -> Either FixtureError Snapshot'],
  ])('fits %s without changing native declarations or linked tokens', async (id, expected) => {
    const symbol = model.symbols.find((entry) => entry.id === id)!
    const before = structuredClone(symbol)
    const signature = symbol.signatures[0]
    const layout = (await apiSignatureLayouts(symbol, 'haskell')).get(signature)!
    expect(layout.text).toBe(expected)
    expect(layout.failures).toEqual([])
    expect(layout.text.replace(/\s+/g, ' ')).toBe(signature.raw)
    const linked = (span: NonNullable<typeof signature.nativeSpans>[number]) => span.href || span.target || span.declaration
    expect(layout.nativeSpans!.filter(linked)).toEqual(signature.nativeSpans!.filter(linked))
    expect(symbol).toEqual(before)
  })

  it('keeps callback arrows nested while continuing outer function arguments', async () => {
    const tail = ' :: Config -> (Handle -> IO Value) -> IO (Either (ExceptionWithContext TmuxException) Value)'
    const symbol: ApiSymbol = { id: 'fixture', name: 'withRecovery', kind: 'function', modifiers: [], source: { file: 'fixture.hs' },
      signatures: [{ raw: `withRecovery${tail}`, params: [], nativeSpans: [
        { text: 'withRecovery', declaration: true }, { text: tail },
      ] }] }
    const layout = (await apiSignatureLayouts(symbol, 'haskell')).get(symbol.signatures[0])!
    expect(layout.failures).toEqual([])
    expect(layout.text).toBe('withRecovery\n  :: Config\n  -> (Handle -> IO Value)\n  -> IO (Either (ExceptionWithContext TmuxException) Value)')
  })

  it('preserves character and escaped string literals while continuing real arrows', async () => {
    const tail = String.raw` :: Proxy '(' -> Proxy "left \" -> \" right" -> IO (Either (ExceptionWithContext TmuxException) Value)`
    const symbol: ApiSymbol = { id: 'fixture', name: 'withLiteral', kind: 'function', modifiers: [], source: { file: 'fixture.hs' },
      signatures: [{ raw: `withLiteral${tail}`, params: [], nativeSpans: [
        { text: 'withLiteral', declaration: true }, { text: tail },
      ] }] }
    const layout = (await apiSignatureLayouts(symbol, 'haskell')).get(symbol.signatures[0])!
    expect(layout.failures).toEqual([])
    expect(layout.text).toContain(String.raw`Proxy "left \" -> \" right"`)
    expect(layout.text).toContain("Proxy '('\n  -> Proxy")
    expect(layout.text.replace(/\s+/g, ' ')).toBe(symbol.signatures[0].raw)
  })

  it('keeps a constructor literal exact when it contains a type-separator spelling', async () => {
    const tail = ' !(Proxy "this constructor literal contains :: and must remain byte for byte")'
    const symbol: ApiSymbol = { id: 'fixture', name: 'Literal', kind: 'function', modifiers: [], source: { file: 'fixture.hs' },
      signatures: [{ raw: `Literal${tail}`, params: [], methodKind: 'constructor', nativeSpans: [
        { text: 'Literal', declaration: true }, { text: tail },
      ] }] }
    const layout = (await apiSignatureLayouts(symbol, 'haskell')).get(symbol.signatures[0])!
    expect(layout.text).toBe(symbol.signatures[0].raw)
    expect(layout.failures.length).toBeGreaterThan(0)
  })
})
