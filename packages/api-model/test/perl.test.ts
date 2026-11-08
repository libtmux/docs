import { describe, expect, it } from 'vitest'
import { SymbolIndex } from '../src/link.ts'
import { extractPerlArtifact } from '../src/languages/perl.ts'

const revision = 'a'.repeat(40)
const source = { file: 'packages/core/lib/LibTmux/Selection.pm', line: 1, revision, repo: 'libtmux/libtmux-perl' }
const artifact = () => ({
  schema: 'libtmux.perl-api/v1', port: 'perl', repo: 'libtmux/libtmux-perl', revision,
  nativeProvenance: { files: [{ path: source.file, sha256: 'b'.repeat(64) }], exporter: { repository: 'libtmux/libtmux-perl', revision: 'c'.repeat(40), working_tree: false } },
  sources: [{ package: 'LibTmux', product: 'core', revision, version: '0.001_001' }],
  symbols: [
    { id: 'LibTmux::Selection', publicId: 'LibTmux::Selection', name: 'Selection', kind: 'class', modifiers: [], signatures: [], package: 'LibTmux', product: 'core', apiScope: 'exported', source },
    { id: 'LibTmux::Selection::grep', publicId: 'LibTmux::Selection::grep', name: 'grep', parent: 'LibTmux::Selection', kind: 'method', modifiers: [], signatures: [{ raw: 'sub grep($self, $callback)', receiver: { name: 'self' }, params: [{ name: 'callback' }] }], doc: { summary: 'See [Selection](pod:LibTmux::Selection).' }, package: 'LibTmux', product: 'core', apiScope: 'exported', source },
  ],
})
describe('native Perl POD and signatures', () => {
  it('preserves declared signatures and resolves authored links to exact owners', () => {
    const model = extractPerlArtifact(artifact(), revision)
    expect(model.symbols[1].signatures[0].raw).toBe('sub grep($self, $callback)')
    expect(model.symbols[1].doc?.summary).toContain(':obj:`Selection <LibTmux::Selection>`')
    expect(model.nativeProvenance?.exporter.revision).toBe('c'.repeat(40))
  })
  it('renders normalized POD links in its declared Perl dialect', () => {
    const input = artifact()
    input.symbols[1].doc = { summary: '`new(config => $hashref)` copies a `libtmux.workspace/v1` record. Use [Selection](pod:LibTmux::Selection) with [Future](pod:Future).' }
    const model = extractPerlArtifact(input, revision)
    const index = new SymbolIndex(model.symbols, (symbol) => `/${symbol.id}/`, 'perl')
    const spans = index.docSpans(model.symbols[1].doc!.summary, model.symbols[1])
    expect(spans).toContainEqual({ kind: 'code', text: 'new(config => $hashref)' })
    expect(spans).toContainEqual({ kind: 'code', text: 'libtmux.workspace/v1' })
    expect(spans).toContainEqual(expect.objectContaining({ kind: 'link', text: 'Future', href: 'https://metacpan.org/pod/Future' }))
    expect(spans).toContainEqual(expect.objectContaining({ kind: 'ref', link: expect.objectContaining({ href: '/LibTmux::Selection/' }) }))
  })
  it('resolves a shared POD section to its unique declared method owner', () => {
    const input = artifact()
    const owner = { ...input.symbols[0], id: 'LibTmux::Selection::Child', publicId: 'LibTmux::Selection::Child', name: 'Child' }
    const method = { ...input.symbols[1], id: `${owner.id}::cause`, publicId: `${owner.id}::cause`, name: 'cause', parent: owner.id }
    input.symbols.push(owner, method)
    input.symbols[1].doc = { summary: 'Retain the [cause](pod:LibTmux::Selection/cause).' }
    expect(extractPerlArtifact(input).symbols[1].doc?.summary).toContain(`:obj:\`cause <${method.id}>\``)

    const secondOwner = { ...owner, id: 'LibTmux::Selection::Second', publicId: 'LibTmux::Selection::Second', name: 'Second' }
    input.symbols.push(secondOwner, { ...method, id: `${secondOwner.id}::cause`, publicId: `${secondOwner.id}::cause`, parent: secondOwner.id })
    expect(() => extractPerlArtifact(input)).toThrow(/Ambiguous authored Perl POD target/)
    input.symbols.pop()
    input.symbols.pop()
    method.source = { ...source, file: 'packages/core/lib/LibTmux/Other.pm' }
    input.nativeProvenance.files.push({ path: method.source.file, sha256: 'd'.repeat(64) })
    expect(() => extractPerlArtifact(input)).toThrow(/Unresolved authored Perl POD target/)
  })
  it('keeps public codec exceptions while excluding the private codec module', () => {
    const input = artifact()
    input.symbols.push({ ...input.symbols[0], id: 'LibTmux::X::Codec', publicId: 'LibTmux::X::Codec', name: 'Codec', kind: 'exception' })
    expect(extractPerlArtifact(input, revision).symbols.some(({ id }) => id === 'LibTmux::X::Codec')).toBe(true)
    input.symbols.push({ ...input.symbols[0], id: 'LibTmux::Codec', publicId: 'LibTmux::Codec', name: 'Codec' })
    expect(() => extractPerlArtifact(input, revision)).toThrow(/public/)
  })
  it('rejects stale/dirty identities and private or unresolved public targets', () => {
    expect(() => extractPerlArtifact(artifact(), 'd'.repeat(40))).toThrow(/revision/)
    const dirty = artifact(); dirty.nativeProvenance.exporter.working_tree = true
    expect(() => extractPerlArtifact(dirty, revision)).toThrow(/committed/)
    const broken = artifact(); broken.symbols[1].doc = { summary: '[Missing](pod:LibTmux::Missing)' }
    expect(() => extractPerlArtifact(broken, revision)).toThrow(/Unresolved/)
    const privateApi = artifact(); privateApi.symbols[1].name = '_read'
    expect(() => extractPerlArtifact(privateApi, revision)).toThrow(/public/)
  })
})
