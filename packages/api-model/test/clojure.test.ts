import { describe, expect, it } from 'vitest'
import { extractClojure } from '../src/languages/clojure.ts'
import { SymbolIndex } from '../src/link.ts'

const revision = '1'.repeat(40)
const repo = 'libtmux/libtmux-java'
const coordinate = 'io.github.libtmux:libtmux-clojure'
const location = (namespace: string) => ({
  file: `libtmux-clojure/src/main/clojure/${namespace.replaceAll('.', '/')}.clj`,
  line: 1, revision, repo,
})
const namespace = (name: string) => ({
  id: name, publicId: name, qualifiedName: name, name, namespace: name, publicOwner: name,
  kind: 'module', modifiers: [], signatures: [{ raw: `(ns ${name})`, params: [] }],
  package: coordinate, product: 'core', apiScope: 'exported', docstring: 'Captured operations.', source: location(name),
})
const callable = (owner: string, name: string, arities: string[][], docstring = 'Owns a resource.') => ({
  ...namespace(owner), id: `${owner}/${name}`, publicId: `${owner}/${name}`, qualifiedName: `${owner}/${name}`,
  parent: owner, name, kind: 'function', docstring,
  modifiers: arities.length > 1 ? ['overload'] : [],
  signatures: arities.map((params) => ({ raw: `(${name} ${params.join(' ')})`, params: params.map((name) => ({ name })) })),
})
function artifact() {
  return {
    schema: 'libtmux.clojure-api/1', port: 'clojure', repo, revision, compiler: '1.12.6',
    extractor: 'clojure-public-var-metadata/1',
    sources: [{ product: 'core', package: coordinate, repo, revision, extractedRevision: revision, version: '0.1.2-SNAPSHOT' }],
    nativeProvenance: {
      files: ['core', 'control', 'data'].map((name) => ({ path: location(`libtmux.${name}`).file, sha256: 'a'.repeat(64) })),
      exporter: { name: 'clojure-public-var-metadata', revision: `sha256:${'b'.repeat(64)}`,
        files: [{ path: 'packages/api-model/scripts/export-clojure.clj', sha256: 'c'.repeat(64) }] },
    },
    symbols: [
      namespace('libtmux.core'), namespace('libtmux.control'), namespace('libtmux.data'),
      callable('libtmux.core', 'close!', [['server']]),
      callable('libtmux.control', 'close!', [['resource']], 'Closes the subscription.\nSee [[close!]] and [[libtmux.core/close!]]. `:signalled` is a value.'),
      callable('libtmux.data', 'matching', [['expression'], ['expression', 'entries']]),
    ],
  }
}

describe('compiled Clojure artifact', () => {
  it('keeps every arity, native call spelling, package, source and docstring link', () => {
    const model = extractClojure(artifact(), revision)
    expect(model.symbols.find((symbol) => symbol.name === 'matching')?.signatures.map((signature) => signature.raw))
      .toEqual(['(matching expression)', '(matching expression entries)'])
    const close = model.symbols.find((symbol) => symbol.id === 'libtmux.control/close!')!
    expect(close.package).toBe(coordinate)
    expect(close.source.revision).toBe(revision)
    expect(close.doc?.body).toContain('[[libtmux.core/close!]]')
    expect(close).not.toHaveProperty('docstring')
    const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.id}/`, 'clojure')
    const references = index.docSpans(close.doc!.body!, close)
      .filter((span) => span.kind === 'ref' && span.explicit)
    expect(references.map((span) => span.kind === 'ref' ? span.link?.symbol?.id : undefined))
      .toEqual(['libtmux.control/close!', 'libtmux.core/close!'])
  })

  it.each(['private', 'source', 'reference', 'provenance'] as const)('rejects a broken %s boundary', (boundary) => {
    const input = artifact()
    if (boundary === 'private') input.symbols[3]!.modifiers.push('private')
    if (boundary === 'source') input.symbols[3]!.source.file = '../private.clj'
    if (boundary === 'reference') input.symbols[4]!.docstring = 'See [[missing-var]].'
    if (boundary === 'provenance') input.nativeProvenance.files[0]!.sha256 = 'stale'
    expect(() => extractClojure(input, revision)).toThrow(/Clojure/)
  })
})
