import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import type { ApiSymbol } from '../src/model.ts'

/**
 * Bare names that more than one symbol answers to.
 *
 * `pick` filters by kind, then by declaration, then by rank, and declines when
 * candidates are still tied — a link to a guess being worse than no link. That
 * left the two most important types in the Go reference unlinked: `Pane` and
 * `Window` each name a struct in `tmux` and another in `workspace`, so every
 * `(Pane, error)` return rendered plain.
 *
 * The referring symbol settles it. A name written in package `tmux` means the
 * one in `tmux`, which is the rule the compiler applies. What must not happen
 * is that rule turning into "pick any candidate": a name whose candidates are
 * all somewhere else stays unlinked.
 */
const sym = (id: string, kind = 'struct'): ApiSymbol =>
  ({
    id,
    publicId: id,
    name: id.split('.').at(-1) ?? id,
    kind,
    modifiers: [],
    signatures: [],
    source: { file: 'x', line: 1 },
  }) as ApiSymbol

const index = (symbols: ApiSymbol[]) => new SymbolIndex(symbols, (s) => `/${s.id}/`, 'go')

/** The text/link pairs `linkType` produced, for the identifier asked about. */
const linkFor = (idx: SymbolIndex, annotation: string, name: string, context?: ApiSymbol) =>
  idx.linkType(annotation, context).find((s) => s.text === name)?.link

it('resolves an explicit source import before a same-named local declaration', () => {
  const idx = new SymbolIndex([sym('example.Server'), sym('other.Server')], (s) => `/${s.id}/`, 'kotlin')
  const from = { ...sym('example.connect', 'function'), imports: { Server: 'other.Server', JavaServer: 'java.Server' } }
  idx.addInventory(
    'https://example.org/',
    [{ name: 'java.Server', type: 'std:label', priority: 1, uri: 'server', dispname: '-' }],
    ['kotlin'],
  )
  expect(linkFor(idx, 'Server', 'Server', from)?.href).toBe('/other.Server/')
  expect(linkFor(idx, 'JavaServer', 'JavaServer', from)?.href).toBe('https://example.org/server')
})

it('links F# types around apostrophe-prefixed generic parameters', () => {
  const idx = new SymbolIndex([sym('Filter'), sym('Field')], (s) => `/${s.id}/`, 'fsharp')
  expect(
    idx
      .linkType("Filter<'T> -> Field<'T, 'Value>")
      .filter((span) => span.link)
      .map((span) => span.text),
  ).toEqual(['Filter', 'Field'])
})

describe('a bare name with more than one candidate', () => {
  const symbols = [
    sym('tmux.Pane'),
    sym('workspace.Pane'),
    sym('tmux.Window'),
    sym('workspace.Window'),
    sym('tmux.Window.NewPane', 'method'),
    sym('error.Error', 'enum'),
    sym('error.refusal.Error'),
    sym('error.classification.Error'),
    sym('session.Session.rename', 'method'),
  ]
  const idx = index(symbols)

  it('stays plain with no referring symbol', () => {
    expect(linkFor(idx, '(Pane, error)', 'Pane')).toBeUndefined()
  })

  it('resolves to the candidate in the referrer’s package', () => {
    const link = linkFor(idx, '(Pane, error)', 'Pane', sym('tmux.Window.NewPane', 'method'))
    expect(link?.href).toBe('/tmux.Pane/')
  })

  it('does not reach across packages for it', () => {
    const link = linkFor(idx, '(Pane, error)', 'Pane', sym('workspace.Plan.Apply', 'method'))
    expect(link?.href).toBe('/workspace.Pane/')
  })

  it('stays plain when no candidate is near the referrer', () => {
    // Rust's `Error` names three types under `error.`, none of them related to
    // the `session.` page asking. Guessing one would be worse than the plain
    // text, so this test passing means the rule declined, not that it failed.
    expect(linkFor(idx, 'Result<Self, Error>', 'Error', sym('session.Session.rename', 'method'))).toBeUndefined()
  })

  it('prefers the nearest candidate, not merely a sharing one', () => {
    // Java's nine `Builder`s all share `io.github.libtmux`; only one shares the
    // enclosing spec, and that is the one a bare `Builder` means.
    const java = new SymbolIndex(
      [
        sym('io.github.libtmux.SplitSpec.SplitSpec.Builder'),
        sym('io.github.libtmux.WindowSpec.WindowSpec.Builder'),
        sym('io.github.libtmux.Server.Server.Builder'),
      ],
      (s) => `/${s.id}/`,
      'java',
    )
    const from = sym('io.github.libtmux.SplitSpec.SplitSpec.Builder.percent', 'method')
    expect(linkFor(java, 'Builder', 'Builder', from)?.href).toBe('/io.github.libtmux.SplitSpec.SplitSpec.Builder/')
  })

  it('stays plain when two candidates are equally near', () => {
    const tied = index([sym('a.b.Thing'), sym('a.c.Thing'), sym('a.d.Caller', 'method')])
    expect(linkFor(tied, 'Thing', 'Thing', sym('a.d.Caller', 'method'))).toBeUndefined()
  })
})

it('resolves C++ core and workspace types through their enclosing namespaces', () => {
  const cpp = (id: string) => ({ ...sym(id), name: id.split('::').at(-1)! })
  const symbols = ['libtmux::Pane', 'libtmux::workspace::Pane'].map(cpp)
  const idx = new SymbolIndex(symbols, (symbol) => `/${symbol.id}/`, 'cxx')
  expect(linkFor(idx, 'Pane', 'Pane', cpp('libtmux::Window::split'))?.href).toBe('/libtmux::Pane/')
  expect(linkFor(idx, 'Pane', 'Pane', cpp('libtmux::workspace::Window::panes'))?.href).toBe(
    '/libtmux::workspace::Pane/',
  )
  expect(linkFor(idx, 'Pane', 'Pane', cpp('other::Window::split'))).toBeUndefined()
})

it('preserves comments in inline types without interpreting their prose as references', () => {
  const idx = new SymbolIndex([sym('Server')], (symbol) => `/${symbol.id}/`, 'ts')
  const annotation = "{ /** Server's startup environment. */ server: Server; // Server host\n}"
  const spans = idx.linkType(annotation)
  expect(spans.map((span) => span.text).join('')).toBe(annotation)
  expect(spans.filter((span) => span.link).map((span) => span.text)).toEqual(['Server'])
})

it('distinguishes TypeScript declaration labels from the types they annotate', () => {
  const idx = new SymbolIndex([sym('Server')], (symbol) => `/${symbol.id}/`, 'ts')
  for (const annotation of [
    '{ readonly Server: Server; signal?: MissingType }',
    '(Server: Server, ...signal: MissingType[]) => void',
    '[Server: Server, signal?: MissingType]',
    '{ /** Server selection. */ Server: Server; // Cancellation\n signal?: MissingType }',
  ]) {
    const spans = idx.linkType(annotation)
    expect(spans.map((span) => span.text).join('')).toBe(annotation)
    expect(spans.filter((span) => span.declaration).map((span) => span.text)).toEqual(['Server', 'signal'])
    expect(spans.filter((span) => span.text === 'Server' && span.link)).toHaveLength(1)
    expect(spans.find((span) => span.text === 'MissingType')).toEqual({ text: 'MissingType', link: undefined })
  }
})

it('keeps conditional TypeScript branches and other languages as type references', () => {
  const idx = new SymbolIndex([sym('Server')], (symbol) => `/${symbol.id}/`, 'ts')
  const spans = idx.linkType('T extends object ? Server : MissingType')
  expect(spans.some((span) => span.declaration)).toBe(false)
  expect(spans.find((span) => span.text === 'Server')?.link?.href).toBe('/Server/')
  const scala = new SymbolIndex([sym('Server')], (symbol) => `/${symbol.id}/`, 'scala')
  expect(scala.linkType('Server: Context')[0].link?.href).toBe('/Server/')
})
