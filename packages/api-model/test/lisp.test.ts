import { describe, expect, it } from 'vitest'
import { extractCommonLisp } from '../src/languages/lisp.ts'

const revision = '1'.repeat(40)
const source = (file: string, line: number) => ({ file, line })
const documentation = (summary: string, seeAlso: string[] = []) => ({ summary, seeAlso })
const functionSymbol = (id: string, name: string, file: string, seeAlso: string[] = []) => ({
  id, name, kind: 'function', signature: `(${name} value)`, modifiers: [], generic: false,
  documentation: documentation(`Call ${name.toUpperCase()}.`, seeAlso), source: source(file, 10),
})

const fixture = {
  schema: 'libtmux.lisp.api/1', port: 'lisp',
  library: { version: '0.1.0' },
  runtime: { implementation: 'SBCL', implementationVersion: '2.6.10', asdfVersion: '3.3.7' },
  source: {
    repository: 'libtmux/libtmux-lisp', revision, dirty: false,
    files: [
      { path: 'src/json.lisp', sha256: 'a'.repeat(64) },
      { path: 'src/model.lisp', sha256: 'b'.repeat(64) },
      { path: 'src/package.lisp', sha256: 'c'.repeat(64) },
      { path: 'src/query.lisp', sha256: 'd'.repeat(64) },
      { path: 'src/workspace-cli.lisp', sha256: 'e'.repeat(64) },
      { path: 'src/workspace.lisp', sha256: 'f'.repeat(64) },
      { path: 'tools/documentation.lisp', sha256: '0'.repeat(64) },
    ],
  },
  exporter: { name: 'libtmux.documentation', version: 1, revision, dirty: false },
  packages: [
    {
      name: 'libtmux', system: 'libtmux', product: 'core',
      documentation: documentation('Native tmux observations.'), source: source('src/package.lisp', 1),
      symbols: [
        functionSymbol('libtmux:session/function', 'session', 'src/model.lisp'),
        { id: 'libtmux:session/type', name: 'session', kind: 'class', modifiers: ['opaque'],
          supertypes: ['libtmux:entity'], documentation: documentation('A captured session.'), source: source('src/model.lisp', 25) },
      ],
    },
    { name: 'libtmux.json', system: 'libtmux/json', product: 'core', documentation: documentation('Bounded JSON.'),
      source: source('src/json.lisp', 1), symbols: [functionSymbol('libtmux.json:read-filter', 'read-filter', 'src/json.lisp')] },
    { name: 'libtmux.query', system: 'libtmux/query', product: 'core', documentation: documentation('Native queries.'),
      source: source('src/query.lisp', 1), symbols: [functionSymbol('libtmux.query:compile-filter', 'compile-filter', 'src/query.lisp')] },
    { name: 'libtmux.workspace', system: 'libtmux/workspace', product: 'workspace', documentation: documentation('Owned workspaces.'),
      source: source('src/workspace.lisp', 1), symbols: [functionSymbol('libtmux.workspace:apply-workspace', 'apply-workspace', 'src/workspace.lisp', ['libtmux.workspace:result-outcomes']),
        functionSymbol('libtmux.workspace:result-outcomes', 'result-outcomes', 'src/workspace.lisp')] },
    { name: 'libtmux.workspace.cli', system: 'libtmux/workspace/cli', product: 'workspace', documentation: documentation('Workspace command adapter.'),
      source: source('src/workspace-cli.lisp', 1), symbols: [functionSymbol('libtmux.workspace.cli:main', 'main', 'src/workspace-cli.lisp')] },
  ],
}

describe('Common Lisp native API adapter', () => {
  it('retains native packages, separate namespaces and authored links', () => {
    const model = extractCommonLisp(fixture, revision)
    expect(model).toMatchObject({ port: 'lisp', repo: fixture.source.repository, revision })
    expect(model.sources).toHaveLength(5)
    expect(model.nativeProvenance?.exporter).toMatchObject({ name: 'libtmux.documentation', revision })
    expect(model.symbols.find((entry) => entry.id === 'libtmux:session/function')).toMatchObject({
      name: 'session', kind: 'function', qualifiedName: 'libtmux:session', parent: 'libtmux',
      signatures: [{ raw: '(session value)', params: [{ name: 'value' }] }],
    })
    expect(model.symbols.find((entry) => entry.id === 'libtmux:session/type')).toMatchObject({
      name: 'session', kind: 'class', qualifiedName: 'libtmux:session', modifiers: ['opaque'],
    })
    expect(model.symbols.find((entry) => entry.id === 'libtmux.workspace:apply-workspace')?.doc?.seeAlso)
      .toEqual(['libtmux.workspace:result-outcomes'])
  })

  it('reads Common Lisp lambda-list roles without evaluating defaults', () => {
    const input = structuredClone(fixture)
    input.packages[0]!.symbols[0]!.signature = '(session required &optional (limit 10) &rest values &key ((:raw raw-p) nil))'
    const signature = extractCommonLisp(input, revision).symbols
      .find((entry) => entry.id === 'libtmux:session/function')!.signatures[0]!
    expect(signature.params).toEqual([
      { name: 'required' },
      { name: 'limit', default: '10', optional: true },
      { name: 'values', variadic: 'positional' },
      { name: 'raw-p', default: 'nil', optional: true, keywordOnly: true },
    ])
  })

  it('preserves required macro destructuring without inventing defaults', () => {
    const input = structuredClone(fixture)
    const declaration = input.packages[0]!.symbols[0]!
    declaration.signature = '(with-client (name &rest options) &body body)'
    const params = () => extractCommonLisp(input, revision).symbols
      .find((entry) => entry.id === declaration.id)!.signatures[0]!.params
    expect(params()).toEqual([
      { name: '(name &rest options)' },
      { name: 'body', variadic: 'positional' },
    ])
  })

  it('retains printed string defaults, including empty strings and escapes', () => {
    const input = structuredClone(fixture)
    const declaration = input.packages[0]!.symbols[0]!
    declaration.signature = '(open-client &key (program "tmux") (label "") (name "a\\\"b"))'
    const params = extractCommonLisp(input, revision).symbols
      .find((entry) => entry.id === declaration.id)!.signatures[0]!.params
    expect(params).toEqual([
      { name: 'program', default: '"tmux"', optional: true, keywordOnly: true },
      { name: 'label', default: '""', optional: true, keywordOnly: true },
      { name: 'name', default: '"a\\\"b"', optional: true, keywordOnly: true },
    ])
  })

  it.each([
    ['a dirty source', (input: typeof fixture) => { input.source.dirty = true }],
    ['a dirty exporter', (input: typeof fixture) => { input.exporter.dirty = true }],
    ['an unsupported schema', (input: typeof fixture) => { input.schema = 'libtmux.lisp.api/2' }],
    ['a duplicate declaration', (input: typeof fixture) => { input.packages[0]!.symbols.push(input.packages[0]!.symbols[0]!) }],
    ['a missing source line', (input: typeof fixture) => { input.packages[0]!.symbols[0]!.source.line = 0 }],
    ['an unresolved cross-reference', (input: typeof fixture) => { input.packages[3]!.symbols[0]!.documentation.seeAlso = ['libtmux.workspace:missing'] }],
  ])('rejects %s', (_name, mutate) => {
    const input = structuredClone(fixture)
    mutate(input)
    expect(() => extractCommonLisp(input, revision)).toThrow()
  })

  it('rejects an artifact exported from another checkout', () => {
    expect(() => extractCommonLisp(fixture, '2'.repeat(40))).toThrow('selected checkout')
  })
})
