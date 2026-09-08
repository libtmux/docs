import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractSymbolGraph } from '../src/languages/symbolgraph.ts'

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
    ).toEqual(['Hashable', 'Equatable'])
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

  it('lists a repeated conformance once, in the order the graph gave it', () => {
    // The real graph emits Sendable and SendableMetatype twice on every type.
    expect(
      basesOf(
        graph([
          ['s:s8SendableP', 'Swift.Sendable'],
          ['s:SH', 'Swift.Hashable'],
          ['s:s8SendableP', 'Swift.Sendable'],
        ]),
      ),
    ).toEqual(['Sendable', 'Hashable'])
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
    ).toEqual(['Copyable', 'SendableMetatype', 'Sendable', 'Hashable'])
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
