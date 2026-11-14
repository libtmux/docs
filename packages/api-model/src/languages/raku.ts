import { createHash } from 'node:crypto'
import type { ApiModel, ApiSymbol, DocBlock } from '../model.ts'

interface RakuArtifact extends ApiModel {
  schema: string
  workingTree: boolean
  compiler: string
  language: string
  aliases: Record<string, string>
  missingDocumentation: Record<string, { file: string; line: number }>
}

const SHA = /^[a-f0-9]{40}$/
const HASH = /^[a-f0-9]{64}$/
const relative = (path: string) => Boolean(path) && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..')
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid Raku documentation artifact: ${message}`)
}

/** Adapt compiler declarations and native RakuDoc; never parse Raku source in JavaScript. */
export function extractRakuArtifact(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = structuredClone(input) as RakuArtifact
  check(artifact?.schema === 'libtmux.raku-api/v1' && artifact.port === 'raku' &&
    artifact.repo === 'libtmux/libtmux-raku' && SHA.test(artifact.revision ?? ''), 'schema or library identity')
  check(!expectedRevision || artifact.revision === expectedRevision, 'library revision mismatch')
  check(typeof artifact.workingTree === 'boolean' && /^v?\d{4}\.\d{2}$/.test(artifact.compiler) && artifact.language === '6.d', 'native compiler profile')
  const producer = artifact.nativeProvenance?.exporter
  const library = artifact.nativeProvenance?.library
  check(library?.repository === artifact.repo && library.revision === artifact.revision &&
    library.workingTree === artifact.workingTree, 'library provenance differs')
  check(producer?.name === 'RakuAST and RakuDoc export' && producer.version === 1 &&
    producer.repository === artifact.repo && typeof producer.revision === 'string' && SHA.test(producer.revision) &&
    producer.path === 'tools/export-docs.raku' && typeof producer.sha256 === 'string' && HASH.test(producer.sha256) &&
    typeof producer.workingTree === 'boolean', 'exporter identity')
  check(!artifact.workingTree && !producer.workingTree, 'uncommitted inputs cannot be published')
  producer.compiler = artifact.compiler.replace(/^v/, '')
  check(Array.isArray(artifact.nativeProvenance?.files) && artifact.nativeProvenance.files.length > 0 &&
    artifact.generatedSources && typeof artifact.generatedSources === 'object', 'source inventory')
  const files = new Map<string, string>()
  for (const file of artifact.nativeProvenance.files) {
    check(relative(file.path) && HASH.test(file.sha256) && !files.has(file.path), 'invalid or repeated source path')
    files.set(file.path, file.sha256)
  }
  for (const [path, text] of Object.entries(artifact.generatedSources)) {
    check(relative(path) && files.has(path) && typeof text === 'string' && digest(text) === files.get(path), `source digest differs: ${path}`)
  }
  check(Array.isArray(artifact.symbols) && artifact.symbols.length > 0, 'empty public API')
  const ids = new Map(artifact.symbols.map((symbol) => [symbol.id, symbol]))
  check(ids.size === artifact.symbols.length, 'repeated public identity')
  const aliases = artifact.aliases ?? {}
  const resolve = (name: string, owner: ApiSymbol): string => {
    if (ids.has(name)) return name
    if (aliases[name] && ids.has(aliases[name])) return aliases[name]
    const scoped = `${owner.parent ?? owner.id}::${name}`
    if (ids.has(scoped)) return scoped
    if (aliases[scoped] && ids.has(aliases[scoped])) return aliases[scoped]
    const candidates = artifact.symbols.filter((symbol) => symbol.name === name)
    check(candidates.length === 1, `unresolved or ambiguous RakuDoc target ${name} in ${owner.id}`)
    return candidates[0]!.id
  }
  const prose = (text: string, owner: ApiSymbol): string => text.replace(/\[([^\]]+)\]\(rakudoc:([^)]+)\)/g,
    (_match, label: string, encoded: string) => {
      let target: string
      try { target = decodeURIComponent(encoded) } catch { throw new Error('Invalid RakuDoc target encoding') }
      return `:obj:\`${label.replaceAll('`', '')} <${resolve(target, owner)}>\``
    })
  const docs = (value: DocBlock | undefined, owner: ApiSymbol): DocBlock | undefined => value ? {
    ...value, summary: prose(value.summary ?? '', owner), ...(value.body ? { body: prose(value.body, owner) } : {}),
  } : undefined
  for (const symbol of artifact.symbols) {
    check(symbol.apiScope === 'exported' && symbol.product === 'core' && symbol.package === 'LibTmux' &&
      /^(?:LibTmux|X::LibTmux)(?:::|\.|$)/.test(symbol.id) && symbol.publicId === symbol.id &&
      (!symbol.parent || ids.has(symbol.parent)), `invalid public declaration ${symbol.id}`)
    check(relative(symbol.source?.file) && files.has(symbol.source.file) &&
      artifact.generatedSources[symbol.source.file] !== undefined &&
      Number.isInteger(symbol.source.line) && symbol.source.line! > 0 &&
      symbol.source.line! <= artifact.generatedSources[symbol.source.file]!.split('\n').length &&
      symbol.source.revision === artifact.revision, `source identity differs: ${symbol.id}`)
    check(Array.isArray(symbol.signatures), `missing signatures: ${symbol.id}`)
    for (const signature of symbol.signatures) {
      check(typeof signature.raw === 'string' && signature.raw.length > 0 && Array.isArray(signature.params), `invalid native signature: ${symbol.id}`)
      let previous = -1
      for (const reference of signature.references ?? []) {
        check(Number.isInteger(reference.start) && Number.isInteger(reference.end) && reference.start >= 0 &&
          reference.end > reference.start && reference.end <= signature.raw.length && reference.start >= previous &&
          ids.has(reference.target), `invalid native type reference in ${symbol.id}: ${reference.target}`)
        previous = reference.end
      }
      const start = signature.raw.indexOf(`${symbol.name}(`)
      check(start >= 0, `missing native declaration name: ${symbol.id}`)
      signature.nativeSyntax = [{ start, end: start + symbol.name.length, kind: 'name' }]
      const ranges = [
        { start, end: start + symbol.name.length, declaration: true },
        ...(signature.references ?? []).map((reference) => ({ ...reference, declaration: false })),
      ].sort((a, b) => a.start - b.start)
      signature.nativeSpans = []
      let offset = 0
      for (const range of ranges) {
        check(range.start >= offset, `overlapping native spans: ${symbol.id}`)
        if (range.start > offset) signature.nativeSpans.push({ text: signature.raw.slice(offset, range.start) })
        signature.nativeSpans.push({ text: signature.raw.slice(range.start, range.end),
          ...('target' in range ? { target: range.target } : { declaration: true }) })
        offset = range.end
      }
      if (offset < signature.raw.length) signature.nativeSpans.push({ text: signature.raw.slice(offset) })
      signature.doc = docs(signature.doc, symbol)
    }
    symbol.doc = docs(symbol.doc, symbol)
  }
  return {
    port: 'raku', repo: artifact.repo, revision: artifact.revision,
    extractor: artifact.extractor, symbols: artifact.symbols,
    exportGroups: artifact.exportGroups,
    generatedSources: artifact.generatedSources, nativeProvenance: artifact.nativeProvenance,
  }
}
