import { describe, expect, it } from 'vitest'
import { readInventory, sourceUrl, writeInventory } from '@libtmux/api-model'
import {
  tmuxCommandSources,
  tmuxReferenceContext,
  tmuxReferenceIndex,
  tmuxReferencePaths,
  tmuxReferenceTree,
  tmuxReferenceUrl,
  tmuxReferenceVersionUrl,
  tmuxSourceCommands,
  tmuxSourceModel,
} from '../src/lib/tmux-reference'
import { tmuxManual, tmuxManualUrl } from '../src/lib/tmux-manual-data'
import { referenceIndexSectionsFor } from '../src/lib/api-tree'
import { searchApi } from '../src/lib/api-search'
import { symbolMarkdown } from '../src/lib/symbol-markdown'
import { relatedApiTypes } from '../src/lib/api-sections'
import { PORTS } from '../src/lib/ports'

describe.each(['3.7c', '3.2a'])('tmux %s through the shared API system', (version) => {
  const model = tmuxSourceModel(version)
  const byId = new Map(model.symbols.map((symbol) => [symbol.id, symbol]))

  it('preserves one addressable declaration per ID and native ownership', () => {
    expect(new Set(model.symbols.map((symbol) => symbol.id)).size).toBe(model.symbols.length)
    expect(new Set(model.symbols.map((symbol) => symbol.slug)).size).toBe(model.symbols.length)
    expect(model.symbols.filter((symbol) => !symbol.slug || (symbol.parent && !byId.has(symbol.parent)))).toEqual([])
    expect(
      model.symbols.flatMap((symbol) => symbol.references ?? []).filter((reference) => !byId.has(reference.target)),
    ).toEqual([])
    expect(model).not.toHaveProperty('port')
    expect(PORTS.some((port) => (port.slug as string) === 'tmux' || (port.slug as string) === 'c')).toBe(false)
  })

  it('uses the shared bucket index and searchable tree without losing declarations', () => {
    const context = tmuxReferenceContext(version)
    const sections = referenceIndexSectionsFor(model, context.tree)
    const indexed = sections.flatMap((section) => [...section.types, ...section.free]).map((symbol) => symbol.id)
    expect(indexed.toSorted()).toEqual(
      model.symbols
        .filter((symbol) => !symbol.parent)
        .map((symbol) => symbol.id)
        .toSorted(),
    )
    const tree = tmuxReferenceTree(version)
    expect(
      searchApi(tree, '')
        .map((entry) => entry.id)
        .toSorted(),
    ).toEqual(model.symbols.map((symbol) => symbol.id).toSorted())
    expect(searchApi(tree, 'window_pane')[0].id).toBe('c:struct:window_pane')
    expect(context.nav.placement['c:struct:window_pane']).toBe('pane')
    expect(context.tree.find((bucket) => bucket.id === 'pane')?.entries[0].id).toBe('c:struct:window_pane')
    expect(context.tree.slice(0, 5).map((bucket) => bucket.id)).toEqual([
      'server',
      'session',
      'window',
      'pane',
      'client',
    ])
    expect(
      context.tree
        .find((bucket) => bucket.id === 'session')
        ?.entries.slice(0, 4)
        .map((entry) => entry.name),
    ).toEqual(['session', 'session_create', 'session_find', 'session_find_by_id'])
    expect(
      context.tree.find((bucket) => bucket.id === 'session')?.children[0].entries.map((entry) => entry.name),
    ).toContain('session_cmp')
    expect(sections.find((section) => section.id === 'session-support')?.collapsed).toBe(true)
    expect(context.nav.diagnostics).toMatchObject({ unmatched: [], ambiguous: [], deadBuckets: [] })
    expect(tree.relationships?.['c:function:server_start']?.some((edge) => edge.kind === 'call')).toBe(true)
  })

  it('exposes genuine code paths without promoting callback references into calls', () => {
    const paths = tmuxReferencePaths(version)
    expect(paths).toHaveLength(3)
    expect(paths[0].edges.every((kind) => kind === 'call')).toBe(true)
    expect(paths[2].edges.every((kind) => kind === 'call')).toBe(true)
    // This guarded expression is outside the conservative call projection.
    // The native relationship stays a reference instead of being guessed.
    expect(paths[1].edges).toEqual(['reference', 'call', 'call'])
    const text = symbolMarkdown({
      model,
      symbol: byId.get('c:function:spawn_pane')!,
      index: tmuxReferenceIndex(version),
      hrefFor: (symbol) => tmuxReferenceUrl(version, symbol),
      paths,
    })
    expect(text).toContain('## Called by')
    expect(text).toContain('## Calls')
    expect(text).toContain('## Paths through the source')
    expect(text).toContain(tmuxReferenceUrl(version, byId.get('c:function:window_add_pane')))
  })

  it('links command registrations and callbacks to the matching manual version', () => {
    expect(model.commands.map((command) => command.name).toSorted()).toEqual(
      tmuxManual(version)
        .commands.map((command) => command.name)
        .toSorted(),
    )
    const capture = model.commands.find((command) => command.name === 'capture-pane')!
    const clear = model.commands.find((command) => command.name === 'clear-history')!
    expect(capture.callback).toBe(clear.callback)
    expect(
      tmuxReferenceContext(version, byId.get(capture.callback)).pagePorts.some((port) => port.links.length > 0),
    ).toBe(true)
    expect(tmuxCommandSources(version, 'capture-pane').map((entry) => entry.href)).toEqual([
      tmuxReferenceUrl(version, byId.get(capture.entry)),
      tmuxReferenceUrl(version, byId.get(capture.callback)),
    ])
    expect(tmuxSourceCommands(version, byId.get(capture.callback)!)).toContainEqual({
      name: 'capture-pane',
      href: tmuxManualUrl(version, 'capture-pane'),
    })
  })

  it('copies native C syntax and links types in the selected version', () => {
    const symbol = byId.get('c:function:server_start')!
    const index = tmuxReferenceIndex(version)
    expect(index.linkType('struct tmuxproc *', symbol).find((span) => span.link)?.link?.symbol?.id).toBe(
      'c:struct:tmuxproc',
    )
    const text = symbolMarkdown({
      model,
      symbol,
      index,
      version,
      source: sourceUrl(model, symbol),
      hrefFor: (entry) => tmuxReferenceUrl(version, entry),
    })
    expect(text).toContain('```c\nint server_start(')
    expect(text).not.toContain('client: struct tmuxproc')
    expect(text).toContain(`/blob/${model.revision}/server.c#L`)
    expect(relatedApiTypes(symbol, [], index, undefined, { includeInternal: true }).map((entry) => entry.id)).toContain(
      'c:struct:tmuxproc',
    )
  })

  it('uses the same compressed inventory writer with the C domain and symbol pages', () => {
    const buffer = writeInventory(model, { project: 'tmux', version, uriFor: (symbol) => `${symbol.slug}/` })
    const inventory = readInventory(buffer)
    expect(inventory.entries).toHaveLength(model.symbols.length)
    expect(inventory.entries.find((entry) => entry.name === 'window_pane')).toMatchObject({
      type: 'c:struct',
      uri: 'c-struct-window_pane/',
    })
    expect(inventory.entries.find((entry) => entry.name === 'server_start')?.type).toBe('c:function')
    const nestedUnion = model.symbols.find((symbol) => symbol.kind === 'union' && symbol.parent)!
    expect(inventory.entries.find((entry) => entry.uri === `${nestedUnion.slug}/`)?.type).toBe('c:union')
    expect(inventory.entries.find((entry) => entry.name === 'session.name')?.type).toBe('c:member')
    const enumerator = model.symbols.find(
      (symbol) => symbol.kind === 'constant' && byId.get(symbol.parent ?? '')?.kind === 'enum',
    )!
    expect(inventory.entries.find((entry) => entry.uri === `${enumerator.slug}/`)?.type).toBe('c:enumerator')
    expect(new Set(inventory.entries.map((entry) => `${entry.type}:${entry.name}`)).size).toBe(inventory.entries.length)
  })
})

it('separates version indexes and preserves only existing symbol counterparts', () => {
  const current = tmuxSourceModel('latest')
  const old = tmuxSourceModel('3.2a')
  const session = current.symbols.find((symbol) => symbol.id === 'c:struct:session')!
  expect(tmuxReferenceVersionUrl('3.2a', 'latest', session.slug)).toBe(
    tmuxReferenceUrl(
      '3.2a',
      old.symbols.find((symbol) => symbol.id === session.id),
    ),
  )
  const absent = current.symbols.find((symbol) => !old.symbols.some((entry) => entry.id === symbol.id))!
  expect(tmuxReferenceVersionUrl('3.2a', 'latest', absent.slug)).toBe(tmuxReferenceUrl('3.2a'))
  expect(tmuxReferenceIndex('latest')).not.toBe(tmuxReferenceIndex('3.7c'))
  expect(tmuxReferenceIndex('latest').resolve('c:struct:session')?.href).toBe(tmuxReferenceUrl('latest', session))
  expect(tmuxReferenceIndex('3.7c').resolve('c:struct:session')?.href).toBe(tmuxReferenceUrl('3.7c', session))
})

it('describes an anonymous C value without converting it to a function signature', () => {
  const model = tmuxSourceModel('latest')
  const symbol = model.symbols.find((entry) => entry.name === 'window_copy_cmd_table' && entry.kind === 'attribute')!
  const text = symbolMarkdown({ model, symbol, index: tmuxReferenceIndex() })
  expect(text).toContain('window_copy_cmd_table: anonymous struct.')
  expect(text).not.toContain('window_copy_cmd_table()')
})
