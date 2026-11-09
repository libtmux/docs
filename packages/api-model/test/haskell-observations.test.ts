import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractHaskellArtifact } from '../src/languages/haskell.ts'
import { navSidecar } from '../src/nav-sidecar.ts'
import { sourceUrl } from '../src/products.ts'
import { SymbolIndex } from '../src/link.ts'
import { tokenizeDoc } from '../src/doc/roles.ts'

const artifact = JSON.parse(readFileSync(new URL('./fixtures/haskell-observations-native/artifact.json', import.meta.url), 'utf8'))
const scalar = JSON.parse(readFileSync(new URL('./fixtures/haskell-native/artifact.json', import.meta.url), 'utf8'))
const recordField = (input: typeof artifact, owner = 'Pane') => input.symbols.find(
  (entry: { id: string }) => entry.id === `LibTmux.Snapshot#v:${owner}.ref`,
)

describe('native Haskell observation profile', () => {
  it('preserves every declaration, native signature and actual defining source', () => {
    const original = structuredClone(artifact)
    const model = extractHaskellArtifact(artifact, artifact.revision)
    expect(model.symbols).toHaveLength(232)
    expect(model.symbols.map((entry) => entry.id)).toEqual(artifact.symbols.map((entry: { id: string }) => entry.id))
    for (const native of artifact.symbols) {
      const actual = model.symbols.find((entry) => entry.id === native.id)!
      expect(actual.signatures).toEqual(native.signatures)
      expect(actual.source).toMatchObject(native.source)
    }
    expect(model.nativeProvenance).toEqual(artifact.nativeProvenance)
    expect(model.nativeProvenance!.exporter.revision).not.toBe(model.revision)
    expect(model.symbols.some((entry) => entry.id.includes('Internal'))).toBe(false)
    for (const name of ['Snapshot', 'Generation', 'SessionRef', 'WindowRef', 'PaneRef']) {
      expect(model.symbols.find((entry) => entry.id === `LibTmux.Snapshot#t:${name}`)!.modifiers).toEqual(['opaque'])
    }
    expect(artifact).toEqual(original)
  })

  it('retains reexports as ordered module links with a self-only root navigation bucket', () => {
    const model = extractHaskellArtifact(artifact)
    const root = model.symbols.find((entry) => entry.id === 'LibTmux')!
    const targets = artifact.modules[0].reexports.map((entry: { module: string }) => entry.module)
    expect(root.doc!.body!.split('## Reexports\n\n')[1]).toBe(
      targets.map((target: string) => `- :obj:\`${target} <${target}>\``).join('\n'),
    )
    expect(root.references!.map((entry) => entry.target).filter((target) => targets.includes(target))).toEqual(targets)
    expect(model.symbols.filter((entry) => entry.parent === root.id)).toEqual([])
    const nav = navSidecar('haskell', structuredClone(model))!
    expect(nav.buckets.map((bucket) => bucket.label)).toEqual(artifact.package.exposedModules)
    expect(nav.assignments[nav.buckets[0].id].map((entry) => entry.id)).toEqual(['LibTmux'])
    expect(nav.diagnostics).toEqual({ unmatched: [], deadBuckets: [], ambiguous: [], staleUnsettled: [] })
  })

  it('keeps duplicated field labels in their records without fabricating selectors or source lines', () => {
    const model = extractHaskellArtifact(artifact)
    const summaries = new Set<string>()
    for (const owner of ['Session', 'Window', 'Pane']) {
      const native = recordField(artifact, owner)
      const field = model.symbols.find((entry) => entry.id === native.id)!
      expect(field).toMatchObject({ name: 'ref', kind: 'property', qualifiedName: 'LibTmux.Snapshot.ref',
        parent: `LibTmux.Snapshot#t:${owner}` })
      expect(field.signatures[0].raw).toBe(`ref :: !${owner}Ref`)
      expect(field.signatures[0].params).toEqual([])
      expect(field.source).not.toHaveProperty('line')
      expect(sourceUrl(model, field)).toBe(`https://github.com/${artifact.repo}/blob/${artifact.revision}/internal/LibTmux/Internal/Graph.hs`)
      expect(field.doc).toEqual(native.doc)
      summaries.add(field.doc!.summary)
    }
    expect(summaries.size).toBe(3)
    expect(model.symbols.some((entry) => entry.kind === 'function' && ['ref', 'width'].includes(entry.name))).toBe(false)
  })

  it('resolves all authored native interlinks and instance references in the normalized model', () => {
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

  it('rejects a field link whose native anchor cannot identify one record owner', () => {
    const input = structuredClone(artifact)
    const capture = input.symbols.find((entry: { id: string }) => entry.id === 'LibTmux.Server#v:capture')
    const link = capture.signatures[0].nativeSpans.find((span: { target?: string }) => span.target === 'LibTmux.Server#t:Server')
    link.target = recordField(input).id
    link.href = 'LibTmux-Snapshot.html#v:ref'
    expect(() => extractHaskellArtifact(input)).toThrow(/ambiguous/)
  })

  it.each([
    ['scalar', scalar, 'LibTmux.Version'],
    ['observations', artifact, 'LibTmux.Snapshot.Fixture'],
  ])('rejects an incomplete %s module', (_profile, original, module) => {
    const input = structuredClone(original)
    input.symbols = input.symbols.filter((entry: { id: string }) => !entry.id.startsWith(`${module}#`))
    input.modules.find((entry: { name: string }) => entry.name === module).groups = []
    expect(() => extractHaskellArtifact(input)).toThrow(/export group/i)
  })

  it.each([
    ['profile', (a: typeof artifact) => { a.profile = 'observations/2' }],
    ['module public identity', (a: typeof artifact) => { a.symbols[0].publicId = 'LibTmux.Private' }],
    ['module qualified identity', (a: typeof artifact) => { a.symbols[0].qualifiedName = 'LibTmux.Internal.Runtime' }],
    ['module namespace identity', (a: typeof artifact) => { a.symbols[0].namespace = 'LibTmux.Internal.Runtime' }],
    ['producer version', (a: typeof artifact) => { a.nativeProvenance.exporter.version = 1 }],
    ['unqualified module', (a: typeof artifact) => { a.package.exposedModules.push('LibTmux.Extra') }],
    ['missing defining input', (a: typeof artifact) => {
      a.nativeProvenance.files = a.nativeProvenance.files.filter((entry: { path: string }) => entry.path !== recordField(a).source.file)
    }],
    ['field identity', (a: typeof artifact) => { recordField(a).id = 'LibTmux.Snapshot#v:ref' }],
    ['field parent', (a: typeof artifact) => { recordField(a).parent = 'LibTmux.Snapshot#t:Window' }],
    ['native field namespace', (a: typeof artifact) => { recordField(a).nativeLocation.anchor = 't:ref' }],
    ['native field page', (a: typeof artifact) => { recordField(a).nativeLocation.module = 'LibTmux' }],
    ['defining module', (a: typeof artifact) => { recordField(a).definingModule = 'LibTmux.Internal.Unknown' }],
    ['defining file', (a: typeof artifact) => { recordField(a).source.file = 'src/LibTmux/Snapshot.hs' }],
    ['duplicate reexport', (a: typeof artifact) => { a.modules[0].reexports.push(a.modules[0].reexports[0]) }],
    ['hidden reexport', (a: typeof artifact) => { a.modules[0].reexports[0].module = 'LibTmux.Internal.Graph' }],
    ['self reexport', (a: typeof artifact) => { a.modules[0].reexports[0].module = 'LibTmux' }],
    ['missing reexport metadata', (a: typeof artifact) => { delete a.modules[0].reexports }],
  ])('rejects invalid %s before publishing the observation reference', (_description, mutate) => {
    const input = structuredClone(artifact)
    mutate(input)
    expect(() => extractHaskellArtifact(input)).toThrow(/Haskell|export group/)
  })
})
