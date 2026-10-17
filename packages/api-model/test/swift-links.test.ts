import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol, SymbolKind } from '../src/model.ts'

const symbol = (id: string, kind: SymbolKind, parent?: string, params: string[] = []): ApiSymbol => ({
  id, publicId: id, name: id.slice(parent ? parent.length + 1 : 0), kind, modifiers: [], parent,
  signatures: params.length ? [{ params: params.map((name) => ({ name, type: 'String' })) }] : [],
  source: { file: 'Sources/LibTmux/Server.swift', line: 1 },
})

// Swift ids keep their argument labels, and a property and a method may share a base name.
const SYMBOLS = [
  symbol('Server', 'struct'),
  symbol('Server.mode', 'property', 'Server'),
  symbol('Server.isRunning()', 'method', 'Server'),
  symbol('Server.using(_:_:)', 'method', 'Server'),
  symbol('Server.kill(_:)', 'method', 'Server'),
  symbol('Server.environment(_:)', 'method', 'Server'),
  symbol('Server.newWindow(environment:)', 'method', 'Server', ['environment']),
  symbol('Server.sessions()', 'method', 'Server'),
  symbol('Server.sessions(where:)', 'method', 'Server'),
  symbol('Snapshot', 'struct'),
  symbol('Snapshot.sessions', 'property', 'Snapshot'),
  symbol('Snapshot.sessions(of:)', 'method', 'Snapshot'),
  symbol('TmuxMode', 'enum'),
  symbol('TmuxMode.direct', 'constant', 'TmuxMode'),
  symbol('TmuxError', 'enum'),
  symbol('TmuxError.limit(perStream:)', 'constant', 'TmuxError'),
]
const index = new SymbolIndex(SYMBOLS, (entry) => `/${entry.id}/`, 'swift')
const owner = (id: string) => SYMBOLS.find((entry) => entry.id === id)!

/** What each reference in `text` resolves to, from inside `context`. */
const resolved = (text: string, context: string) =>
  index.linkText(text, owner(context)).filter((span) => span.kind === 'ref').map((span) => span.link?.symbol?.id)

describe('Swift DocC links resolve to the declaration they name', () => {
  it('follows argument labels and zero-argument methods', () => {
    expect(resolved('``using(_:_:)``, ``isRunning()``, ``sessions()`` and ``sessions(where:)``', 'Server')).toEqual([
      'Server.using(_:_:)', 'Server.isRunning()', 'Server.sessions()', 'Server.sessions(where:)',
    ])
    expect(resolved('See ``kill(_:)`` and ``isRunning()``.', 'Server.using(_:_:)')).toEqual([
      'Server.kill(_:)', 'Server.isRunning()',
    ])
  })

  it('follows a Type/member path, with or without labels', () => {
    expect(resolved('``TmuxMode/direct``, ``Server/isRunning()`` and ``TmuxError/limit(perStream:)``', 'Snapshot')).toEqual([
      'TmuxMode.direct', 'Server.isRunning()', 'TmuxError.limit(perStream:)',
    ])
  })

  it('takes a bare name to its method in scope, not to a property elsewhere', () => {
    // `Snapshot.sessions` is the only declaration called plain `sessions`, and
    // a global match used to pick it for a name Server's methods own.
    expect(resolved('``kill`` stops the server.', 'Server')).toEqual(['Server.kill(_:)'])
    expect(resolved('``sessions`` lists them.', 'Server')).toEqual([undefined])
    expect(resolved('``sessions`` lists them.', 'Server.using(_:_:)')).toEqual([undefined])
  })

  it('leaves a parameter of the declaration, and the declaration itself, unlinked', () => {
    expect(resolved('Pass ``environment`` to the window.', 'Server.newWindow(environment:)')).toEqual([undefined])
    expect(resolved('Pass ``environment`` to the window.', 'Server')).toEqual(['Server.environment(_:)'])
    expect(resolved('``kill`` stops the server.', 'Server.kill(_:)')).toEqual([undefined])
  })

  it('still links a bare name that is exact in scope', () => {
    expect(resolved('``mode`` says how.', 'Server')).toEqual(['Server.mode'])
    expect(resolved('``sessions`` lists them.', 'Snapshot')).toEqual(['Snapshot.sessions'])
    expect(resolved('The ``Server`` and ``TmuxMode``.', 'Snapshot')).toEqual(['Server', 'TmuxMode'])
  })

  it('does not invent a link for a name or label that is not declared', () => {
    expect(resolved('``missing``, ``missing()``, ``kill()`` and ``Server/missing``.', 'Server')).toEqual([
      undefined, undefined, undefined, undefined,
    ])
  })
})

const MODEL = new URL('../../../site/src/data/api/swift.json', import.meta.url)
describe.runIf(existsSync(MODEL))('Swift DocC links in the committed model', () => {
  const { symbols } = JSON.parse(readFileSync(MODEL, 'utf8')) as ApiModel
  const real = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'swift')
  const publicId = (entry?: ApiSymbol) => entry && (entry.publicId ?? entry.id)
  const ids = new Set(symbols.map(publicId))
  const refs = symbols.flatMap((owning) => [owning.doc?.summary, owning.doc?.body].flatMap((text) =>
    real.linkText(text ?? '', owning).flatMap((span) => span.kind === 'ref' ? [{ owning, span }] : [])))

  it('resolves a Type/member path to the declaration whose id it spells', () => {
    const paths = refs.filter(({ span }) => span.label.includes('/') && ids.has(span.label.replaceAll('/', '.')))
    expect(paths.length).toBeGreaterThan(0)
    for (const { span } of paths) expect(publicId(span.link?.symbol)).toBe(span.label.replaceAll('/', '.'))
  })

  it('resolves a labelled call to the sibling that has exactly that id', () => {
    const calls = refs.filter(({ owning, span }) => span.label.includes('(') && !span.label.includes('/') &&
      owning.parent && ids.has(`${owning.parent}.${span.label}`))
    expect(calls.length).toBeGreaterThan(0)
    for (const { owning, span } of calls) expect(publicId(span.link?.symbol)).toBe(`${owning.parent}.${span.label}`)
  })
})
