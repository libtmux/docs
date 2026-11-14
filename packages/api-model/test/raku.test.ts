import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { extractRakuArtifact } from '../src/languages/raku.ts'
import { sourceUrl } from '../src/products.ts'
import { SymbolIndex } from '../src/reference.ts'

const revision = 'a'.repeat(40)
const source = 'unit module LibTmux;\nclass Pane { method inspect(--> Pane:D) {} }\n'
const file = 'lib/LibTmux.rakumod'
const hash = createHash('sha256').update(source).digest('hex')

function artifact() {
  const common = { apiScope: 'exported', product: 'core', package: 'LibTmux', modifiers: [],
    source: { file, line: 2, revision } }
  return {
    schema: 'libtmux.raku-api/v1', port: 'raku', repo: 'libtmux/libtmux-raku', revision,
    workingTree: false, compiler: 'v2026.09', language: '6.d', extractor: 'Rakudo RakuAST and RakuDoc/v1',
    aliases: { Pane: 'LibTmux::Pane' }, missingDocumentation: {},
    generatedSources: { [file]: source },
    nativeProvenance: { files: [{ path: file, sha256: hash }],
      library: { repository: 'libtmux/libtmux-raku', revision, workingTree: false }, exporter: {
      name: 'RakuAST and RakuDoc export', version: 1, repository: 'libtmux/libtmux-raku',
      revision: 'b'.repeat(40), path: 'tools/export-docs.raku', sha256: 'c'.repeat(64), workingTree: false,
    } },
    symbols: [
      { ...common, id: 'LibTmux', publicId: 'LibTmux', name: 'LibTmux', kind: 'module', signatures: [] },
      { ...common, id: 'LibTmux::Pane', publicId: 'LibTmux::Pane', name: 'Pane', kind: 'class', parent: 'LibTmux', signatures: [] },
      { ...common, id: 'LibTmux::Pane.inspect', publicId: 'LibTmux::Pane.inspect', name: 'inspect', kind: 'method', parent: 'LibTmux::Pane',
        doc: { summary: 'Acquire a [pane](rakudoc:Pane).' },
        signatures: [{ raw: 'method inspect(--> Pane:D)', params: [], references: [{ start: 19, end: 25, target: 'LibTmux::Pane' }] }] },
    ],
  }
}

describe('native Raku documentation', () => {
  it('retains compiler signatures, links and exact source provenance', () => {
    const input = artifact()
    const model = extractRakuArtifact(input, revision)
    const method = model.symbols[2]!
    expect(method.signatures[0]!.raw).toBe('method inspect(--> Pane:D)')
    expect(method.signatures[0]!.nativeSyntax).toEqual([{ start: 7, end: 14, kind: 'name' }])
    expect(method.signatures[0]!.nativeSpans!.map((span) => span.text).join('')).toBe(method.signatures[0]!.raw)
    expect(method.signatures[0]!.nativeSpans!.filter((span) => span.target).map((span) => span.target)).toEqual(['LibTmux::Pane'])
    expect(method.doc?.summary).toBe('Acquire a :obj:`pane <LibTmux::Pane>`.')
    const index = new SymbolIndex(model.symbols, (symbol) => `/reference/${symbol.id}/`, 'raku')
    const prose = index.docSpans(method.doc!.summary!, method)
    expect(prose.map((span) => 'text' in span ? span.text : 'label' in span ? span.label : '').join(''))
      .toBe('Acquire a pane.')
    expect(prose).toContainEqual(expect.objectContaining({ kind: 'ref', label: 'pane',
      link: expect.objectContaining({ href: '/reference/LibTmux::Pane/' }) }))
    expect(index.docSpans('`LibTmux::Pane`', method)).toEqual([{ kind: 'code', text: 'LibTmux::Pane' }])
    expect(sourceUrl(model, method, '/reference/')).toBe(`/reference/sources/${file}`)
    expect(model.nativeProvenance?.exporter.revision).not.toBe(model.revision)
    expect(model.nativeProvenance?.exporter.compiler).toBe('2026.09')
    expect(input.symbols[2]!.doc?.summary).toContain('rakudoc:')
  })

  it('refuses uncommitted inputs, altered sources and unresolved native links', () => {
    const dirty = artifact(); dirty.workingTree = true; dirty.nativeProvenance.library.workingTree = true
    expect(() => extractRakuArtifact(dirty, revision)).toThrow(/uncommitted/)
    const exporter = artifact(); exporter.nativeProvenance.exporter.workingTree = true
    expect(() => extractRakuArtifact(exporter, revision)).toThrow(/uncommitted/)
    expect(() => extractRakuArtifact(artifact(), 'd'.repeat(40))).toThrow(/revision mismatch/)
    const altered = artifact(); altered.generatedSources[file] += '# changed\n'
    expect(() => extractRakuArtifact(altered, revision)).toThrow(/digest/)
    const escaped = artifact(); escaped.nativeProvenance.files[0]!.path = '../outside'
    expect(() => extractRakuArtifact(escaped, revision)).toThrow(/source path/)
    const missing = artifact(); missing.symbols[2]!.doc!.summary = '[bad](rakudoc:Missing)'
    expect(() => extractRakuArtifact(missing, revision)).toThrow(/unresolved/)
    const invalid = artifact(); invalid.symbols[2]!.signatures[0]!.references[0]!.end = 999
    expect(() => extractRakuArtifact(invalid, revision)).toThrow(/type reference/)
  })
})
