import { describe, expect, it } from 'vitest'
import {
  firstEntry,
  navTree,
  referenceNavigation,
  referenceTree,
  validateNavigationDependency,
} from '../src/lib/api-tree'
import { apiTreeHref, searchApi } from '../src/lib/api-search'
import { API_MODELS, API_NAV, referenceHref } from '../src/lib/api-models'
import { PORT_BY_SLUG } from '../src/lib/ports'

const selection = PORT_BY_SLUG.powershell.apiDependencyNavigation![0]

describe('PowerShell returned objects in the reference tree', () => {
  it.each(['Server', 'Session', 'Window', 'Pane', 'Client'])(
    'exposes the native %s type beside its cmdlets',
    (name) => {
      const tree = referenceTree('powershell')
      const bucket = tree.buckets.find((entry) => entry.id === name.toLowerCase())!
      expect(bucket.types.map((entry) => entry.id)).toContain(`LibTmux.${name}`)
      expect(bucket.types.some((entry) => entry.id.startsWith('LibTmux\\'))).toBe(true)
    },
  )

  it('finds a captured relationship as a property in member search', () => {
    const results = searchApi(referenceTree('powershell'), 'Server.Sessions', 'members')
    expect(results.map((entry) => entry.id)).toContain('LibTmux.Server.Sessions')
    expect(results.find((entry) => entry.id === 'LibTmux.Server.Sessions')?.kind).toBe('property')
  })

  it('keeps all native commands and adds only the selected dependency types and their actual members', () => {
    const native = API_MODELS.powershell
    const dependency = API_MODELS.csharp
    const original = structuredClone(native)
    const originalNav = structuredClone(API_NAV.powershell)
    const expectedTypes = Object.values(selection.sections).flat()
    const expectedMembers = dependency.symbols.filter((symbol) => expectedTypes.includes(symbol.parent ?? ''))
    const tree = referenceTree('powershell')
    const results = searchApi(tree, '')
    const expectedNative = native.symbols.filter((symbol) => symbol.product === 'core')
    expect(results.map((entry) => entry.id).sort()).toEqual(
      [
        ...expectedNative.map((symbol) => symbol.id),
        ...expectedTypes,
        ...expectedMembers.map((symbol) => symbol.id),
      ].sort(),
    )
    expect(results.filter((entry) => entry.id.startsWith('LibTmux\\'))).toHaveLength(55)
    expect(results.some((entry) => entry.id.includes('QuerySet'))).toBe(false)
    expect(results.some((entry) => entry.id.startsWith('LibTmux.Testing.'))).toBe(false)
    expect(API_MODELS.powershell).toEqual(original)
    expect(API_NAV.powershell).toEqual(originalNav)
  })

  it('preserves native category destinations while labeling returned types as .NET', () => {
    const native = navTree('powershell')
    const navigation = referenceNavigation('powershell')!
    const flatten = (buckets: typeof native): typeof native =>
      buckets.flatMap((bucket) => [bucket, ...flatten(bucket.children)])
    for (const bucket of flatten(navigation.tree)) {
      expect(firstEntry(bucket)?.id, bucket.id).toBe(
        firstEntry(flatten(native).find((entry) => entry.id === bucket.id)!)?.id,
      )
    }
    for (const [id, names] of Object.entries(selection.sections)) {
      const bucket = flatten(navigation.tree).find((entry) => entry.id === id)!
      for (const name of names) expect(bucket.entries.find((entry) => entry.id === name)?.name).toMatch(/ \(\.NET\)$/)
    }
  })

  it('links every dependency type and member to a real canonical C# page', () => {
    const tree = referenceTree('powershell')
    for (const entry of searchApi(tree, '').filter((entry) => tree.hrefs?.[entry.id])) {
      expect(apiTreeHref('/en/powershell/latest/reference/', entry, tree.hrefs), entry.id).toBe(
        referenceHref('csharp', entry.id),
      )
      expect(tree.hrefs![entry.id]).toContain('/csharp/')
    }
    const member = searchApi(tree, 'Server.Sessions', 'members')[0]
    expect(apiTreeHref('/en/powershell/latest/reference/', member, tree.hrefs)).toContain(
      '/csharp/latest/reference/libtmux-server-sessions/',
    )
    const command = searchApi(tree, 'Get-TmuxPane', 'members').find((entry) => entry.symbolName === 'Get-TmuxPane')!
    expect(apiTreeHref('/en/powershell/latest/reference/', command, tree.hrefs)).toBe(
      '/en/powershell/latest/reference/libtmux-get-tmuxpane/',
    )
  })

  it('keeps type and member filters accurate and includes only existing canonical members', () => {
    const tree = referenceTree('powershell')
    expect(searchApi(tree, 'Server', 'types').some((entry) => entry.id === 'LibTmux.Server')).toBe(true)
    expect(searchApi(tree, 'Server.Sessions', 'types')).toEqual([])
    expect(searchApi(tree, 'Client.Server', 'members').some((entry) => entry.id === 'LibTmux.Client.Server')).toBe(true)
    for (const name of ['Session', 'Window', 'Pane']) {
      const id = `LibTmux.ClientAttachment.${name}`
      expect(searchApi(tree, id, 'members').some((entry) => entry.id === id)).toBe(true)
      expect(tree.hrefs?.[id]).toBe(referenceHref('csharp', id))
    }
    for (const id of ['LibTmux.ClientAttachment.MissingRelationship', 'LibTmux.Query.QuerySet']) {
      expect(tree.hrefs?.[id]).toBeUndefined()
      expect(searchApi(tree, id)).toEqual([])
    }
  })

  it('accepts only the reviewed package version, source revision and consumer dependency declaration', () => {
    expect(() => validateNavigationDependency(API_MODELS.powershell, API_MODELS.csharp, selection)).not.toThrow()
    const changedVersion = structuredClone(API_MODELS.csharp)
    changedVersion.sources!.find((source) => source.product === 'core')!.version = '0.0.0-alpha.21'
    expect(() => validateNavigationDependency(API_MODELS.powershell, changedVersion, selection)).toThrow(
      'requires LibTmux 0.0.0-alpha.20',
    )
    const changedRevision = { ...API_MODELS.csharp, revision: '0'.repeat(40) }
    expect(() => validateNavigationDependency(API_MODELS.powershell, changedRevision, selection)).toThrow(
      'requires LibTmux',
    )
    const changedPackageSource = structuredClone(API_MODELS.csharp)
    changedPackageSource.sources!.find((source) => source.product === 'core')!.extractedRevision = '0'.repeat(40)
    expect(() => validateNavigationDependency(API_MODELS.powershell, changedPackageSource, selection)).toThrow(
      'requires LibTmux',
    )
    const changedDeclaration = structuredClone(API_MODELS.powershell)
    changedDeclaration.nativeProvenance!.files.find((file) => file.path === selection.declaration.path)!.sha256 =
      '0'.repeat(64)
    expect(() => validateNavigationDependency(changedDeclaration, API_MODELS.csharp, selection)).toThrow(
      'changed Directory.Packages.props',
    )
  })

  it('leaves ports without dependency navigation on their existing catalogs', () => {
    for (const port of Object.keys(API_MODELS).filter((name) => name !== 'powershell')) {
      const navigation = referenceNavigation(port)!
      expect(navigation.model, port).toBe(API_MODELS[port])
      expect(navigation.tree, port).toEqual(navTree(port))
      expect(navigation.hrefs, port).toEqual({})
    }
  })
})
