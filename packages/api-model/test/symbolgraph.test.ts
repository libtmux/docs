import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractSymbolGraph } from '../src/languages/symbolgraph.ts'
import { SymbolIndex } from '../src/link.ts'
import { pageSlug } from '../src/prose.ts'
import { Resolver } from '../src/resolver.ts'

/**
 * Conformance targets, which the reference renders as `Bases:`.
 *
 * A target in another module's graph — every standard library protocol — is
 * absent from the graph being read. Resolving it through the symbol's own
 * `pathComponents` therefore fails, and falling back to `target` puts a
 * mangled USR on the page: `Bases: s:s8CopyableP, s:SH` instead of
 * `Copyable, Hashable`. `targetFallback` is the format's answer, and the graph
 * populates it on exactly the relationships that need it.
 */
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** A graph with one struct and the conformances given as [target, fallback]. */
function graph(conformances: [string, string?][]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'symbolgraph-'))
  dirs.push(dir)
  const file = join(dir, 'Thing.symbols.json')
  writeFileSync(
    file,
    JSON.stringify({
      symbols: [
        {
          identifier: { precise: 's:5Thing0A0V' },
          kind: { identifier: 'swift.struct' },
          pathComponents: ['Thing'],
          names: { title: 'Thing' },
          accessLevel: 'public',
        },
        {
          identifier: { precise: 's:5Thing8LocalOneP' },
          kind: { identifier: 'swift.protocol' },
          pathComponents: ['LocalOne'],
          names: { title: 'LocalOne' },
          accessLevel: 'public',
        },
      ],
      relationships: conformances.map(([target, targetFallback]) => ({
        kind: 'conformsTo',
        source: 's:5Thing0A0V',
        target,
        ...(targetFallback ? { targetFallback } : {}),
      })),
    }),
  )
  return [file]
}

const basesOf = (files: string[]) =>
  extractSymbolGraph(files).find((s) => s.id === 'Thing')?.extends

const compatibleSelectors = [
  ['LibTmux', 'Server.newSession(named:startDirectory:windowName:width:height:)',
    'Server.newSession(named:startDirectory:windowName:width:height:environment:shell:)'],
  ['LibTmux', 'Server.newWindow(in:named:startDirectory:)',
    'Server.newWindow(in:named:startDirectory:at:environment:shell:)'],
  ['LibTmux', 'Server.split(_:direction:size:startDirectory:)',
    'Server.split(_:direction:size:startDirectory:environment:shell:)'],
  ['LibTmux', 'Server.splitWindow(_:direction:size:startDirectory:)',
    'Server.splitWindow(_:direction:size:startDirectory:environment:shell:)'],
  ['TmuxWorkspace', 'PanePlan.init(shellCommands:startDirectory:)',
    'PanePlan.init(shellCommands:startDirectory:focus:environment:shell:sleepBefore:sleepAfter:)'],
  ['TmuxWorkspace', 'WindowPlan.init(windowName:startDirectory:layout:panes:)',
    'WindowPlan.init(windowName:startDirectory:layout:panes:windowIndex:focus:environment:windowShell:)'],
] as const

function selectorGraph(module: string, ids: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'symbolgraph-selector-'))
  dirs.push(dir)
  const file = join(dir, `${module}.symbols.json`)
  writeFileSync(file, JSON.stringify({
    module: { name: module },
    symbols: ids.map((id) => ({
      identifier: { precise: `s:${id}` },
      kind: { identifier: 'swift.method' },
      pathComponents: id.split('.'),
      names: { title: id.split('.').at(-1), subHeading: [{ kind: 'text', spelling: `func ${id}` }] },
      functionSignature: { parameters: [{ name: 'environment', declarationFragments: [
        { kind: 'text', spelling: 'environment: [String: String] = [:]' },
      ] }] },
      accessLevel: 'public',
    })),
  }))
  return extractSymbolGraph([file])
}

describe('compatible Swift selectors', () => {
  it.each(compatibleSelectors)('keeps %s %s links with the current declaration', (module, previous, current) => {
    const symbols = selectorGraph(module, [current])
    const [symbol] = symbols
    expect(symbol).toMatchObject({ id: current, publicId: previous, qualifiedName: current,
      name: current.split('.').at(-1), signatures: [{ params: [
        { name: 'environment', type: '[String: String] = [:]' },
      ] }] })
    const href = `/reference/${pageSlug(symbol.publicId!)}/#${symbol.publicId}`
    expect(href).toBe(`/reference/${pageSlug(previous)}/#${previous}`)
    const index = new SymbolIndex(symbols, () => href, 'swift')
    const resolver = new Resolver([{ port: 'swift', extractor: 'test', symbols }])
    for (const selector of [previous, current]) {
      expect(index.resolve(selector)).toMatchObject({ symbol: { id: current }, href })
      expect(resolver.resolve('swift', selector)).toMatchObject({ symbol: { id: current } })
    }
  })

  it('does not rename another module or an explicitly retained overload', () => {
    const [module, previous, current] = compatibleSelectors[0]
    expect(selectorGraph('OtherLibrary', [current])[0].publicId).toBe(current)
    const symbols = selectorGraph(module, [previous, current])
    expect(symbols.map((symbol) => symbol.publicId)).toEqual([previous, current])
    expect(selectorGraph(module, [previous])[0].publicId).toBe(previous)
  })
})

describe('symbol graph conformances', () => {
  it('names a standard library protocol rather than its USR', () => {
    // The long mangling form: module `s`, length-prefixed name, `P` for
    // protocol. `Copyable` is the same shape but is dropped as implicit.
    expect(
      basesOf(graph([['s:s12IdentifiableP', 'Swift.Identifiable']])),
    ).toEqual(['Identifiable'])
  })

  it('names one mangled with a standard substitution', () => {
    // `s:SH` and `s:SQ` are single-letter substitutions, not the long form.
    // Both arrive here the same way, which is the point of using the fallback.
    expect(
      basesOf(
        graph([
          ['s:SH', 'Swift.Hashable'],
          ['s:SQ', 'Swift.Equatable'],
        ]),
      ),
    ).toEqual(['Equatable', 'Hashable'])
  })

  it('drops the module so the name matches a local symbol’s', () => {
    // `titleOf` yields `pathComponents`, which carry no module. A builtin
    // lookup keyed on `Actor` must not be handed `_Concurrency.Actor`.
    expect(basesOf(graph([['s:sc5ActorP', '_Concurrency.Actor']]))).toEqual(['Actor'])
  })

  it('resolves a local conformance through the graph, without a fallback', () => {
    // The four local conformances in libtmux-swift carry no `targetFallback`.
    expect(basesOf(graph([['s:5Thing8LocalOneP', undefined]]))).toEqual(['LocalOne'])
  })

  it('lists repeated conformances once in stable name order', () => {
    // The real graph emits Sendable and SendableMetatype twice on every type.
    const conformances: [string, string][] = [
      ['s:s8SendableP', 'Swift.Sendable'],
      ['s:SH', 'Swift.Hashable'],
      ['s:s8SendableP', 'Swift.Sendable'],
      ['s:SQ', 'Swift.Equatable'],
    ]
    const expected = ['Equatable', 'Hashable', 'Sendable']
    expect(basesOf(graph(conformances))).toEqual(expected)
    expect(basesOf(graph(conformances.toReversed()))).toEqual(expected)
  })

  it('keeps a conformance that every type carries', () => {
    // Apple lists these. DocC's own page for `Swift.Int` names twenty-eight
    // protocols, `Copyable`, `BitwiseCopyable`, `Sendable` and
    // `SendableMetatype` among them, so hiding them here would be this site
    // disagreeing with the one reference a Swift reader already knows.
    expect(
      basesOf(
        graph([
          ['s:s8CopyableP', 'Swift.Copyable'],
          ['s:s16SendableMetatypeP', 'Swift.SendableMetatype'],
          ['s:s8SendableP', 'Swift.Sendable'],
          ['s:SH', 'Swift.Hashable'],
        ]),
      ),
    ).toEqual(['Copyable', 'Hashable', 'Sendable', 'SendableMetatype'])
  })

  it('keeps the USR when the graph offers nothing better', () => {
    // Not a silent drop: an unresolvable target stays visible, so the check
    // that greps for `s:`-prefixed types can still catch it.
    expect(basesOf(graph([['s:s7UnknownP', undefined]]))).toEqual(['s:s7UnknownP'])
  })
})

describe('symbol graph source locations', () => {
  function sourceGraph(locatedFirst: boolean) {
    const dir = mkdtempSync(join(tmpdir(), 'symbolgraph-source-'))
    dirs.push(dir)
    const file = join(dir, 'Thing.symbols.json')
    const entry = {
      identifier: { precise: 'generated-init' }, kind: { identifier: 'swift.init' },
      pathComponents: ['Thing', 'init(from:)'], names: { title: 'init(from:)' }, accessLevel: 'public',
    }
    const located = { ...entry, identifier: { precise: 'declared-init' }, location: { uri: 'file:///Sources/Thing.swift', position: { line: 12 } } }
    writeFileSync(file, JSON.stringify({
      symbols: locatedFirst ? [located, entry] : [entry, located],
      relationships: [{ kind: 'memberOf', source: 'generated-init', target: 'Thing', sourceOrigin: { identifier: 'Decodable-init', displayName: 'Decodable.init(from:)' } }],
    }))
    return file
  }

  it.each([false, true])('retains a concrete source when merging overloads, located first: %s', (locatedFirst) => {
    const symbols = extractSymbolGraph([sourceGraph(locatedFirst)])
    expect(symbols).toHaveLength(1)
    expect(symbols[0].source).toEqual({ file: '/Sources/Thing.swift', line: 13 })
  })

  it('records an inherited origin without fabricating a source location', () => {
    const file = sourceGraph(false)
    const content = JSON.parse(readFileSync(file, 'utf8'))
    content.symbols.pop()
    writeFileSync(file, JSON.stringify(content))
    const symbol = extractSymbolGraph([file])[0]
    expect(symbol.source).toEqual({ file: '' })
    expect(symbol.inheritedFrom).toBe('Decodable.init(from:)')
  })
})

describe('symbol graph throwing contracts', () => {
  const keyword = (spelling: string) => ({ kind: 'keyword', spelling })
  const text = (spelling: string) => ({ kind: 'text', spelling })
  const type = (spelling: string) => ({ kind: 'typeIdentifier', spelling })
  const head = [keyword('func'), text(' '), { kind: 'identifier', spelling: 'next' }, text('() '), keyword('async'), text(' ')]
  const returns = [type('Self'), text('.'), type('Element'), text('?')]
  const returned = [text(' -> '), ...returns]

  function signature(fragments: { kind: string; spelling: string }[]) {
    const dir = mkdtempSync(join(tmpdir(), 'symbolgraph-throws-'))
    dirs.push(dir)
    const file = join(dir, 'Iterator.symbols.json')
    writeFileSync(file, JSON.stringify({ symbols: [{
      identifier: { precise: 'iterator-next' }, kind: { identifier: 'swift.method' },
      pathComponents: ['Iterator', 'next()'], accessLevel: 'public',
      names: { title: 'next()', subHeading: fragments },
      functionSignature: { parameters: [], returns },
    }] }))
    return extractSymbolGraph([file])[0].signatures[0]
  }

  it('records untyped throws without treating the returned type as an error', () => {
    expect(signature([...head, keyword('throws'), ...returned])).toEqual({
      params: [], returns: 'Self.Element?', raises: [{ type: 'any Error' }],
    })
    expect(signature([...head, keyword('throws')]).raises).toEqual([{ type: 'any Error' }])
    expect(signature([...head, ...returned]).raises).toBeUndefined()
  })

  it.each([
    ['TmuxError', [type('TmuxError')]],
    ['Self.Failure', [type('Self'), text('.'), type('Failure')]],
    ['any Error', [keyword('any'), text(' '), type('Error')]],
    ['Failures.Box<(Int, String)>', [type('Failures'), text('.'), type('Box'), text('<('), type('Int'), text(', '), type('String'), text(')>')]],
  ] as const)('preserves the complete balanced error type %s', (expected, fragments) => {
    expect(signature([...head, keyword('throws'), text('('), ...fragments, text(')'), ...returned]).raises)
      .toEqual([{ type: expected }])
  })

  it('does not attribute a throwing callback or returned function to its enclosing function', () => {
    const callback = [keyword('func'), text(' map(('), type('Element'), text(') '), keyword('throws'), text(' -> '), type('Value'), text(') ')]
    expect(signature([...callback, ...returned]).raises).toBeUndefined()
    expect(signature([...callback, keyword('throws'), text('('), type('TmuxError'), text(')'), ...returned]).raises)
      .toEqual([{ type: 'TmuxError' }])
    expect(signature([...head, text(' -> () '), keyword('throws'), ...returned]).raises).toBeUndefined()
    expect(signature([...callback, keyword('rethrows'), ...returned]).raises)
      .toEqual([{ type: 'any Error', doc: 'Conditionally propagates errors (rethrows).' }])
  })

  it('does not invent a throwing contract from empty, incomplete or Never clauses', () => {
    for (const fragments of [[text('()')], [text('('), type('Failure')], [text('('), type('Never'), text(')')]]) {
      expect(signature([...head, keyword('throws'), ...fragments, ...returned]).raises).toBeUndefined()
    }
  })

  it('keeps the integrated iterator and callback wrapper error contracts separate', () => {
    const model = JSON.parse(readFileSync(new URL('../../../site/src/data/api/swift.json', import.meta.url), 'utf8'))
    const iterator = model.symbols.find((symbol: { id: string }) => symbol.id === 'ControlNotificationStream.Iterator.next()')
    expect(iterator.signatures.map((signature: { raises: { type: string }[] }) => signature.raises))
      .toEqual([[{ type: 'Self.Failure' }], [{ type: 'TmuxError' }]])
    const wrapper = model.symbols.find((symbol: { id: string }) => symbol.id === 'withTmuxError(_:)')
    expect(wrapper.signatures[0].raises).toEqual([{ type: 'TmuxError' }])
  })
})
