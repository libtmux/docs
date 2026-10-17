import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import type { ApiModel, ApiSymbol, SymbolKind } from '../src/model.ts'

const symbol = (id: string, kind: SymbolKind, parent?: string): ApiSymbol => ({
  id, publicId: id, name: id.slice((parent ?? '').length + (parent ? 1 : 0)), kind, modifiers: [], parent, signatures: [],
  source: { file: 'gems/libtmux/lib/libtmux/server.rb', line: 1 },
})

// Ruby ids join a namespace with `::`, an instance method with `#` and a singleton method with `.`.
const SYMBOLS = [
  symbol('LibTmux::Server', 'class'),
  symbol('LibTmux::Server#run', 'method', 'LibTmux::Server'),
  symbol('LibTmux::Server#list_sessions', 'method', 'LibTmux::Server'),
  symbol('LibTmux::Server.open', 'method', 'LibTmux::Server'),
  symbol('LibTmux::Server.new', 'method', 'LibTmux::Server'),
  symbol('LibTmux::Session', 'class'),
  symbol('LibTmux::Session#run', 'method', 'LibTmux::Session'),
  symbol('LibTmux::Selection', 'class'),
  symbol('LibTmux::Selection#one', 'method', 'LibTmux::Selection'),
  symbol('LibTmux::Selection#empty?', 'method', 'LibTmux::Selection'),
  symbol('LibTmux::Async::Gate', 'class'),
  symbol('LibTmux::Async::Gate#wait', 'method', 'LibTmux::Async::Gate'),
  symbol('LibTmux::Async::Server', 'class'),
]
const index = new SymbolIndex(SYMBOLS, (entry) => `/${entry.id}/`, 'ruby')
const owner = (id: string) => SYMBOLS.find((entry) => entry.id === id)

/** What each reference in `text` resolves to, from inside `context` (or nowhere). */
const resolved = (text: string, context?: string) =>
  index.linkText(text, context ? owner(context) : undefined).filter((span) => span.kind === 'ref')
    .map((span) => span.link?.symbol?.id)

describe('YARD links resolve to the declaration they name', () => {
  it('reads #initialize as the .new constructor Ruby callers use', () => {
    expect(resolved('{#initialize} and {Server#initialize Server.new}', 'LibTmux::Server')).toEqual([
      'LibTmux::Server.new', 'LibTmux::Server.new',
    ])
  })

  it('reads #m as a method of the class being documented', () => {
    expect(resolved('{#list_sessions} and {#run}', 'LibTmux::Server')).toEqual([
      'LibTmux::Server#list_sessions', 'LibTmux::Server#run',
    ])
    expect(resolved('{#run}', 'LibTmux::Session')).toEqual(['LibTmux::Session#run'])
    // From a method, the class is its owner.
    expect(resolved('{#run}', 'LibTmux::Session#run')).toEqual(['LibTmux::Session#run'])
    expect(resolved('{#list_sessions}', 'LibTmux::Server#run')).toEqual(['LibTmux::Server#list_sessions'])
  })

  it('expands a name through the namespaces around the documented class', () => {
    expect(resolved('{Selection#one}, {Selection#empty?} and {Selection}', 'LibTmux::Server#run')).toEqual([
      'LibTmux::Selection#one', 'LibTmux::Selection#empty?', 'LibTmux::Selection',
    ])
    expect(resolved('{Server.open} and {Session#run}', 'LibTmux::Selection')).toEqual([
      'LibTmux::Server.open', 'LibTmux::Session#run',
    ])
    // A partial path, from a class that sits in a sibling namespace.
    expect(resolved('{Async::Gate#wait}', 'LibTmux::Server')).toEqual(['LibTmux::Async::Gate#wait'])
    expect(resolved('{Selection#one}', 'LibTmux::Async::Gate#wait')).toEqual(['LibTmux::Selection#one'])
  })

  it('prefers the nearest namespace, as Ruby does', () => {
    expect(resolved('{Server}', 'LibTmux::Async::Gate#wait')).toEqual(['LibTmux::Async::Server'])
    expect(resolved('{Server}', 'LibTmux::Session')).toEqual(['LibTmux::Server'])
    // Once the nearest class is found, a missing member does not send the lookup outward.
    expect(resolved('{Server#run}', 'LibTmux::Async::Gate')).toEqual([undefined])
    expect(resolved('{LibTmux::Server#run}', 'LibTmux::Async::Gate')).toEqual(['LibTmux::Server#run'])
  })

  it('takes a qualified name as written, and falls back to the root without a context', () => {
    expect(resolved('{LibTmux::Server#run} and {::LibTmux::Server.open}', 'LibTmux::Session')).toEqual([
      'LibTmux::Server#run', 'LibTmux::Server.open',
    ])
    expect(resolved('{Server#run} and {Server}')).toEqual(['LibTmux::Server#run', 'LibTmux::Server'])
  })

  it('uses the label only to display, never to resolve', () => {
    expect(resolved('{Server#run the run method}', 'LibTmux::Session')).toEqual(['LibTmux::Server#run'])
  })

  it('does not bridge # and ., or reach another class, or invent a name', () => {
    expect(resolved('{Server#open} and {Server.run} and {#open}', 'LibTmux::Server')).toEqual([
      undefined, undefined, undefined,
    ])
    expect(resolved('{#one} and {Server#one}', 'LibTmux::Server')).toEqual([undefined, undefined])
    expect(resolved('{Missing} and {#missing} and {Server#missing} and {::Server}', 'LibTmux::Server')).toEqual([
      undefined, undefined, undefined, undefined,
    ])
  })

  it('still resolves the qualified id in backticks that worked before', () => {
    expect(resolved('`LibTmux::Server#list_sessions` and `LibTmux::Server.open`', 'LibTmux::Session')).toEqual([
      'LibTmux::Server#list_sessions', 'LibTmux::Server.open',
    ])
  })
})

const MODEL = new URL('../../../site/src/data/api/ruby.json', import.meta.url)
describe.runIf(existsSync(MODEL))('YARD links in the committed Ruby model', () => {
  const { symbols } = JSON.parse(readFileSync(MODEL, 'utf8')) as ApiModel
  const real = new SymbolIndex(symbols, (entry) => `/${entry.id}/`, 'ruby')
  const named = symbols.filter((entry) => entry.kind === 'method' && entry.parent &&
    /^[A-Z][\w:]*[#.][A-Za-z_]\w*[?!=]?$/.test(entry.publicId ?? entry.id))
  const refs = (text: string, context: ApiSymbol) =>
    real.linkText(text, context).flatMap((span) => span.kind === 'ref' ? [span.link?.symbol?.id] : [])

  it('resolves the qualified spelling of every method it declares to that method', () => {
    expect(named.length).toBeGreaterThan(0)
    for (const method of named) expect(refs(`{${method.publicId ?? method.id}}`, method)).toEqual([method.id])
  })

  it('resolves #name inside a class to the instance method of that name', () => {
    const instance = named.filter((entry) => (entry.publicId ?? entry.id).includes('#'))
    expect(instance.length).toBeGreaterThan(0)
    for (const method of instance) expect(refs(`{#${method.name.replace(/^#/, '')}}`, method)).toEqual([method.id])
  })
})
