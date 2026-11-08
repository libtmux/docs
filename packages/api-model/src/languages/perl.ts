import type { ApiModel, ApiSymbol, DocBlock } from '../model.ts'
import { docSectionTitles } from '../doc/prose-blocks.ts'

interface PerlArtifact extends ApiModel {
  schema: string
  examples?: { owner: string; path: string; code: string }[]
}

const PACKAGES = new Set(['LibTmux', 'LibTmux-Async', 'LibTmux-Workspace'])
const SHA = /^[a-f0-9]{40}$/
const publicId = /^LibTmux(?:::[A-Za-z][A-Za-z0-9_]*)*$/

/** Adapt PPI signatures and Pod::Simple links; never parse Perl as TypeScript. */
export function extractPerlArtifact(input: unknown, revision?: string): ApiModel {
  const artifact = input as PerlArtifact
  if (artifact?.schema !== 'libtmux.perl-api/v1' || artifact.port !== 'perl' ||
      !SHA.test(artifact.revision ?? '') || revision !== undefined && revision !== artifact.revision) {
    throw new Error('Perl native artifact schema or library revision mismatch')
  }
  const exporter = artifact.nativeProvenance?.exporter
  if (!exporter || (typeof exporter.revision !== 'string' || !SHA.test(exporter.revision)) || exporter.working_tree !== false ||
      !artifact.nativeProvenance?.files.length || !Array.isArray(artifact.symbols) || !artifact.symbols.length) {
    throw new Error('Perl artifact requires committed exporter and public input provenance')
  }
  const ids = new Set(artifact.symbols.map((symbol) => symbol.id))
  if (ids.size !== artifact.symbols.length) throw new Error('Duplicate Perl public identity')
  const files = new Set(artifact.nativeProvenance.files.map((file) => file.path))
  for (const file of artifact.nativeProvenance.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || file.path.startsWith('/') || file.path.split('/').includes('..')) {
      throw new Error('Invalid Perl native input provenance')
    }
  }
  for (const symbol of artifact.symbols) {
    if (!publicId.test(symbol.id) || symbol.name.startsWith('_') || symbol.name === 'DESTROY' ||
        /^LibTmux::(?:Codec|Platform)(?:::|$)/.test(symbol.id) || symbol.apiScope !== 'exported' ||
        !PACKAGES.has(symbol.package ?? '') || !['core', 'workspace'].includes(symbol.product ?? '') ||
        symbol.parent && !ids.has(symbol.parent) || symbol.publicId !== symbol.id) {
      throw new Error(`Invalid Perl public declaration: ${symbol.id}`)
    }
    if (!/^packages\/(?:core|async|workspace)\/lib\/LibTmux(?:\/[^/]+)*\.pm$/.test(symbol.source.file) ||
        !files.has(symbol.source.file) || !Number.isInteger(symbol.source.line) || (symbol.source.line ?? 0) < 1 ||
        symbol.source.revision !== artifact.revision || !Array.isArray(symbol.signatures) ||
        symbol.signatures.some((signature) => !signature.raw || !Array.isArray(signature.params))) {
      throw new Error(`Invalid Perl native signature or source identity: ${symbol.id}`)
    }
  }
  const resolvePod = (text: string): string => text.replace(/\[([^\]]+)\]\(pod:([^\n)]+)\)/g, (_all, label: string, target: string) => {
    const separator = target.indexOf('/')
    const module = separator < 0 ? target : target.slice(0, separator)
    const rawSection = separator < 0 ? undefined : target.slice(separator + 1)
    let section: string | undefined
    try {
      // Earlier native artifacts wrote section titles containing spaces literally.
      section = rawSection === undefined ? undefined : /\s/u.test(rawSection) ? rawSection : decodeURIComponent(rawSection)
    } catch { throw new Error(`Malformed authored Perl POD target: ${target}`) }
    if (!module.startsWith('LibTmux')) {
      const href = module === 'JSON::PP' ? 'https://perldoc.perl.org/5.44.0/JSON::PP'
        : `https://metacpan.org/pod/${module}`
      return `[${label}](${href}${section ? `#${encodeURIComponent(section)}` : ''})`
    }
    let id = module === 'LibTmux::Transport' && section === 'RESULTS' ? 'LibTmux::CommandResult'
      : section ? `${module}::${section}` : module
    if (!ids.has(id) && section) {
      // One POD file can document several declared packages, including error subclasses.
      const owner = artifact.symbols.find((symbol) => symbol.id === module)
      const methods = owner ? artifact.symbols.filter((symbol) => symbol.kind === 'method'
        && !symbol.inheritedFrom && symbol.name === section && symbol.source.file === owner.source.file) : []
      if (methods.length > 1) throw new Error(`Ambiguous authored Perl POD target: ${target}`)
      if (methods.length === 1) id = methods[0].id
      else if (owner) {
        const headings = docSectionTitles(owner).filter((title) => title === section)
        if (headings.length > 1) throw new Error(`Ambiguous authored Perl POD target: ${target}`)
        if (headings.length === 1) return `:obj:\`${label.replace(/`/g, '')} <${owner.id}#${encodeURIComponent(section)}>\``
      }
    }
    if (!ids.has(id)) throw new Error(`Unresolved authored Perl POD target: ${target}`)
    return `:obj:\`${label.replace(/`/g, '')} <${id}>\``
  })
  const doc = (value?: DocBlock): DocBlock | undefined => value ? {
    ...value, summary: resolvePod(value.summary), ...(value.body ? { body: resolvePod(value.body) } : {}),
    ...(value.examples ? { examples: value.examples.map((example) => ({ ...example, ...(example.intro ? { intro: resolvePod(example.intro) } : {}) })) } : {}),
  } : undefined
  const symbols: ApiSymbol[] = artifact.symbols.map((symbol) => ({
    ...symbol, signatures: symbol.signatures.map((signature) => ({ ...signature, params: signature.params.map((param) => ({ ...param })) })), doc: doc(symbol.doc),
  }))
  for (const example of artifact.examples ?? []) {
    const owner = symbols.find((symbol) => symbol.id === example.owner)
    if (!owner || !/^examples\/[a-z-]+\.pl$/.test(example.path) || !files.has(example.path) || !example.code) {
      throw new Error('Invalid complete Perl example provenance')
    }
    owner.doc ??= { summary: '' }
    owner.doc.examples = [...owner.doc.examples ?? [], { lang: 'perl', code: example.code,
      intro: 'Complete installed-package program with an owned tmux fixture and result/cleanup assertions.',
      sourceUrl: `https://github.com/libtmux/libtmux-perl/blob/${artifact.revision}/${example.path}` }]
  }
  return { port: 'perl', repo: artifact.repo, revision: artifact.revision, sources: artifact.sources,
    extractor: artifact.extractor, nativeProvenance: artifact.nativeProvenance, symbols }
}
