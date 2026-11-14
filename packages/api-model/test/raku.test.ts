import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractRakuArtifact } from '../src/languages/raku.ts'
import { sourceUrl } from '../src/products.ts'
import type { ApiModel } from '../src/model.ts'
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
    expect(index.docSpans('`LibTmux::Pane`', method)).toContainEqual(expect.objectContaining({ kind: 'ref', label: 'LibTmux::Pane',
      link: expect.objectContaining({ href: '/reference/LibTmux::Pane/' }) }))
    expect(index.docSpans('``LibTmux::Pane``', method)).toEqual([{ kind: 'code', text: 'LibTmux::Pane' }])
    expect(model.generatedSources).toBeUndefined()
    expect(sourceUrl(model, method, '/reference/')).toBe(`https://github.com/libtmux/libtmux-raku/blob/${revision}/${file}#L2`)
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

const rakuModel = new URL('../../../site/src/data/api/raku.json', import.meta.url)

describe.runIf(existsSync(rakuModel))('code spans in Raku descriptions', () => {
  const { symbols } = JSON.parse(readFileSync(rakuModel, 'utf8')) as ApiModel
  const index = new SymbolIndex(symbols, (symbol) => `/reference/${symbol.id}/`, 'raku')
  const at = (id: string) => symbols.find((symbol) => symbol.id === id)!
  // Every link a rendered span carries, whole or inside its literal.
  const linked = (text: string, context: string) => index.docSpans(text, at(context)).flatMap((span) =>
    span.kind === 'ref' ? [span.link?.symbol?.id, ...(span.parts ?? []).map((part) => part.link?.symbol?.id)].flatMap((id) => id ? [id] : []) : [])

  it('link a method name, padded or not, to the member of the class being described', () => {
    // The exporter writes `C<start>` as a padded span, and CommonMark strips one space from each side of one.
    expect(linked('` start ` and `attach`', 'LibTmux::Server'))
      .toEqual(['LibTmux::Server.start', 'LibTmux::Server.attach'])
    for (const name of ['start', 'attach', 'run-batch', 'from-env', 'snapshot', 'capabilities', 'close', 'buffers']) {
      expect(linked(`\` ${name} \``, 'LibTmux::Server'), name).toEqual([`LibTmux::Server.${name}`])
    }
  })

  it('send a name several classes declare to the class being described first', () => {
    // `capabilities` is declared on Server, Snapshot and Observation.
    expect(linked('`capabilities`', 'LibTmux::Server')).toEqual(['LibTmux::Server.capabilities'])
    expect(linked('`capabilities`', 'LibTmux::Server.attach')).toEqual(['LibTmux::Server.capabilities'])
    expect(linked('`capabilities`', 'LibTmux::Model::Snapshot')).toEqual(['LibTmux::Model::Snapshot.capabilities'])
  })

  it('keep what names no member as plain code, and a doubled span as a literal', () => {
    for (const text of ['`TMUX`', '`:parse-only`', '`$snapshot.clients`', '`` start ``']) {
      expect(linked(text, 'LibTmux::Server'), text).toEqual([])
    }
  })

  it('link only a span whose whole text names a symbol, as an adverb or a trait names none', () => {
    // `deadline` and `operation` are also members of other classes; `:deadline(Instant)` and `is single-operation('async')`
    // name an argument and a trait, and the shared tokenizer would read their hyphen and colon as operators between names.
    for (const text of ["`:deadline(Instant)`", "`is single-operation('async')`", '`:hidden`']) {
      expect(linked(text, 'LibTmux::Batch'), text).toEqual([])
      expect(linked(text, 'LibTmux::Configuration'), text).toEqual([])
    }
    expect(linked('`LibTmux::Server`', 'LibTmux::Batch')).toEqual(['LibTmux::Server'])
  })
})
