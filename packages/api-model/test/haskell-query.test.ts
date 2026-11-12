import { describe, expect, it } from 'vitest'
import artifact from './fixtures/haskell-query-native/artifact.json'
import { extractHaskellArtifact } from '../src/languages/haskell'
import { SymbolIndex, tokenizeDoc } from '../src/reference'
import { exportGroupsNav, navSidecarFor } from '../src/nav-sidecar'

describe('the native Haskell query profile', () => {
  it('preserves every native signature, type parameter and defining source', () => {
    const model = extractHaskellArtifact(artifact, artifact.revision)
    expect(model.symbols.map((entry) => entry.id)).toEqual(artifact.symbols.map((entry) => entry.id))
    for (const native of artifact.symbols) {
      const actual = model.symbols.find((entry) => entry.id === native.id)!
      expect(actual.signatures).toEqual(native.signatures)
      expect(actual.source).toMatchObject(native.source)
    }
    for (const [name, parameters] of [['Field', 'row value'], ['Expr', 'row'], ['Query', 'row'],
      ['Order', 'row'], ['ToMany', 'parent child'], ['ToOne', 'parent child'], ['ToOptional', 'parent child']]) {
      const type = model.symbols.find((entry) => entry.id === `LibTmux.Query#t:${name}`)!
      expect(type.modifiers).toEqual(['opaque'])
      expect(type.signatures[0].raw).toBe(`data ${name} ${parameters}`)
    }
    expect(model.symbols.find((entry) => entry.id === 'LibTmux.Query#t:Order')!.source).not.toHaveProperty('line')
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
  })

  it('keeps query field tokens distinct from observed record labels', () => {
    const model = extractHaskellArtifact(artifact)
    const token = model.symbols.find((entry) => entry.id === 'LibTmux.Query.Pane#v:width')!
    const observed = model.symbols.find((entry) => entry.id === 'LibTmux.Snapshot#v:Pane.width')!
    expect(token.kind).toBe('function')
    expect(token.signatures[0].raw).toBe('width :: Field Pane Dimension')
    expect(observed.kind).toBe('property')
    expect(observed.parent).toBe('LibTmux.Snapshot#t:Pane')
    const nav = navSidecarFor('haskell', structuredClone(model), exportGroupsNav(model))
    expect(nav.buckets.map((bucket) => bucket.label)).toEqual(artifact.package.exposedModules)
    expect(nav.diagnostics).toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
  })

  it('resolves authored query links through the public reference', () => {
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

  it('rejects unqualified module and declaration forms', () => {
    const module = structuredClone(artifact)
    module.package.exposedModules.push('LibTmux.Query.Private')
    expect(() => extractHaskellArtifact(module)).toThrow(/module profile/)
    const alias = structuredClone(artifact)
    const field = alias.symbols.find((entry) => entry.id === 'LibTmux.Query#t:Field')!
    field.signatures[0].raw = 'type Field row value'
    expect(() => extractHaskellArtifact(alias)).toThrow(/unsupported type representation/)
  })
})
