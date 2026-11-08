import { parseMarkdownDocFull } from '../doc/markdown.ts'
import type { ApiModel, ApiSymbol, DocBlock, Modifier, Signature, TypeReference } from '../model.ts'

interface Source { file: string; line: number }
interface Spec {
  parameters: { name: string; type: string; references: TypeReference[] }[]
  returns: string
  returns_references: TypeReference[]
  text: string
  references: TypeReference[]
}
interface Member {
  name: string
  display_name: string
  kind: 'function' | 'callback' | 'type'
  arity: number
  doc: string | null
  since: string | null
  deprecated: string | null
  visibility: 'public' | 'opaque' | 'nominal'
  exported: boolean
  signatures: string[]
  declarations: string[]
  declaration_references: TypeReference[][]
  specs: Spec[]
  source: Source
}
interface Module {
  name: string
  display_name: string
  doc: string | null
  source: Source
  members: Member[]
  records: { name: string; display_name: string; declaration: string; references: TypeReference[]; source: Source }[]
}
interface Artifact {
  schema: number
  port: string
  source: { repository: string; revision: string; files: { path: string; sha256: string }[] }
  exporter: { name: string; version: number; columns: number; otp: string; source_sha256: string }
  package: { name: string; version: string }
  modules: Module[]
}

function assertArtifact(input: unknown, expectedRevision?: string): Artifact {
  const artifact = input as Artifact
  if (artifact?.schema !== 1 || artifact.port !== 'erlang' || artifact.exporter?.version !== 3 ||
    artifact.exporter.columns !== 60 || !/^[a-f0-9]{64}$/.test(artifact.exporter.source_sha256 ?? '') ||
    !Array.isArray(artifact.modules) || !artifact.modules.length ||
    !/^[a-f0-9]{40}$/.test(artifact.source?.revision ?? '') ||
    !Array.isArray(artifact.source?.files) || !artifact.source.files.length ||
    !artifact.source.repository || !artifact.package?.name || !artifact.package.version) {
    throw new Error('Erlang compiler artifact has an unsupported schema or source identity')
  }
  if (expectedRevision && artifact.source.revision !== expectedRevision) {
    throw new Error('Erlang artifact source revision differs from the selected checkout')
  }
  const files = new Set(artifact.source.files.map((file) => {
    if (!file.path || file.path.startsWith('/') || file.path.split('/').includes('..') ||
      !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Erlang artifact has invalid source inputs')
    return file.path
  }))
  if (files.size !== artifact.source.files.length) throw new Error('Erlang artifact repeats a source input')
  const location = (source: Source) => {
    if (!source || !files.has(source.file) || !Number.isInteger(source.line) || source.line < 1) {
      throw new Error('Erlang artifact lost a declaration source')
    }
  }
  const seen = new Set<string>()
  const unique = (id: string) => {
    if (seen.has(id)) throw new Error(`Erlang artifact repeats ${id}`)
    seen.add(id)
  }
  for (const module of artifact.modules) {
    if (!module.display_name || !Array.isArray(module.members) || !Array.isArray(module.records)) {
      throw new Error('Erlang artifact lost a module declaration')
    }
    unique(module.display_name)
    location(module.source)
    for (const member of module.members) {
      if (!['function', 'callback', 'type'].includes(member.kind) || !member.display_name ||
        !Number.isInteger(member.arity) || member.arity < 0 || member.arity > 255 ||
        !member.declarations?.length || !Array.isArray(member.specs) ||
        typeof member.exported !== 'boolean' || !['public', 'opaque', 'nominal'].includes(member.visibility)) {
        throw new Error('Erlang artifact lost a member declaration')
      }
      unique(memberId(module, member))
      location(member.source)
      if (member.visibility === 'opaque' && member.declarations.some(opaqueBody)) {
        throw new Error('Erlang artifact exposes an opaque type body')
      }
      if (!Array.isArray(member.declaration_references) ||
        member.declaration_references.length !== member.declarations.length ||
        member.visibility === 'opaque' && member.declaration_references.some((refs) => refs.length)) {
        throw new Error('Erlang artifact lost declaration references or exposes an opaque body')
      }
      member.declarations.forEach((text, index) => assertReferences(text, member.declaration_references[index]))
      if (member.kind !== 'type' && (!Array.isArray(member.signatures) ||
        !member.signatures.length || member.signatures.some((head) => typeof head !== 'string' || !head.trim()) ||
        !member.specs.length || member.specs.some((spec) => !spec ||
          !Array.isArray(spec.parameters) || spec.parameters.length !== member.arity ||
          spec.parameters.some((parameter) => !parameter ||
            typeof parameter.name !== 'string' || !parameter.name.trim() ||
            typeof parameter.type !== 'string' || !parameter.type.trim()) ||
          typeof spec.returns !== 'string' || !spec.returns.trim() ||
          typeof spec.text !== 'string' || !spec.text.trim()))) {
        throw new Error('Erlang artifact lost its native callable signature')
      }
      for (const spec of member.specs) {
        assertReferences(spec.text, spec.references)
        assertReferences(spec.returns, spec.returns_references)
        for (const parameter of spec.parameters) assertReferences(parameter.type, parameter.references)
      }
    }
    for (const record of module.records) {
      if (!record.display_name || !record.declaration) throw new Error('Erlang artifact lost a native record declaration')
      unique(recordId(module, record.display_name))
      location(record.source)
      assertReferences(record.declaration, record.references)
    }
  }
  return artifact
}

function assertReferences(text: string, references: TypeReference[] | undefined): void {
  if (!Array.isArray(references)) throw new Error('Erlang artifact lost its compiler references')
  let offset = 0
  const boundary = (at: number) => !(at > 0 && at < text.length &&
    /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!))
  for (const reference of references) {
    if (!reference || !Number.isInteger(reference.start) || !Number.isInteger(reference.end) ||
      reference.start < offset || reference.end <= reference.start || reference.end > text.length ||
      !boundary(reference.start) || !boundary(reference.end) ||
      typeof reference.target !== 'string' || !/^(?:t:.+\/\d+|#.+\{\})$/.test(reference.target)) {
      throw new Error('Erlang artifact has invalid compiler reference ranges')
    }
    if (reference.external) {
      let url: URL
      try { url = new URL(reference.external.href) }
      catch { throw new Error('Erlang artifact has an invalid OTP reference destination') }
      const target = /^t:([a-z][A-Za-z0-9_]*):(.+)\/(\d+)$/.exec(reference.target)
      if (!target || reference.external.project !== 'Erlang/OTP' ||
        url.origin !== 'https://www.erlang.org' || url.username || url.password || url.search ||
        !/^\/doc\/apps\/[a-z][a-z0-9_]*\/[a-z][A-Za-z0-9_]*\.html$/.test(url.pathname) ||
        !url.pathname.endsWith(`/${target[1]}.html`) ||
        decodeURIComponent(url.hash.slice(1)) !== `t:${target[2]}/${target[3]}`) {
        throw new Error('Erlang artifact has an invalid OTP reference destination')
      }
    }
    offset = reference.end
  }
}

/** A body delimiter inside a compiler-quoted atom is part of its name. */
function opaqueBody(text: string): boolean {
  let quoted = false
  for (let at = 0; at < text.length; at++) {
    const character = text[at]
    if (quoted && character === '\\') { at++; continue }
    if (character === "'") { quoted = !quoted; continue }
    if (!quoted && character === ':' && text[at + 1] === ':') return true
  }
  return quoted
}

const memberId = (module: Module, member: Member): string =>
  `${member.kind === 'type' ? 't:' : member.kind === 'callback' ? 'c:' : ''}${module.display_name}:${member.display_name}/${member.arity}`
const recordId = (module: Module, name: string): string => `#${module.display_name}:${name}{}`

function documentation(text: string | null, since?: string | null, deprecated?: string | null): DocBlock | undefined {
  const doc = text?.trim() ? parseMarkdownDocFull(text, 'erlang').doc : undefined
  return doc || since || deprecated
    ? { ...(doc ?? { summary: '' }), ...(since ? { since } : {}), ...(deprecated ? { deprecated } : {}) }
    : undefined
}

/** Map compiler declarations without guessing types or parsing Erlang source in JavaScript. */
export function extractErlang(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const source = (location: Source): ApiSymbol['source'] => ({
    ...location, repo: artifact.source.repository, revision: artifact.source.revision,
    extractedRevision: artifact.source.revision,
  })
  const common = { package: artifact.package.name,
    product: artifact.package.name === 'libtmux_erlang_workspace' ? 'workspace' as const : 'core' as const }
  const symbols: ApiSymbol[] = []
  for (const module of artifact.modules) {
    const owner = module.display_name
    symbols.push({ id: owner, publicId: owner, qualifiedName: owner, name: owner,
      kind: 'module', modifiers: [], signatures: [], apiScope: 'exported',
      ...common, doc: documentation(module.doc), source: source(module.source) })
    for (const member of module.members) {
      const type = member.kind === 'type'
      const modifiers: Modifier[] = [
        ...(member.visibility === 'opaque' ? ['opaque' as const] : []),
        ...(member.kind === 'callback' ? ['abstract' as const] : []),
        ...(member.deprecated ? ['deprecated' as const] : []),
        ...(member.specs.length > 1 ? ['overload' as const] : []),
      ]
      const signatures: Signature[] = type
        ? member.declarations.map((raw, index) => ({ raw, params: [], references: member.declaration_references[index] }))
        : member.specs.map((spec) => {
          const prefix = member.kind === 'callback' ? '' : `${member.signatures[0]}\n`
          return { raw: prefix + spec.text,
            references: spec.references.map((ref) => ({ ...ref, start: ref.start + prefix.length, end: ref.end + prefix.length })),
            params: spec.parameters.map((param) => ({ name: param.name, type: param.type, typeReferences: param.references })),
            returns: spec.returns, returnsReferences: spec.returns_references }
        })
      const id = memberId(module, member)
      symbols.push({ id, publicId: id, qualifiedName: `${owner}:${member.display_name}/${member.arity}`,
        name: `${member.display_name}/${member.arity}`, namespace: owner, parent: owner,
        kind: type ? 'typealias' : 'function', modifiers, signatures,
        ...common, apiScope: member.exported ? 'exported' : 'supporting',
        doc: documentation(member.doc, member.since, member.deprecated), source: source(member.source) })
    }
    for (const record of module.records) {
      const id = recordId(module, record.display_name)
      symbols.push({ id, publicId: id, qualifiedName: id, name: `#${record.display_name}{}`,
        namespace: owner, parent: owner, kind: 'struct', modifiers: [],
        signatures: [{ raw: record.declaration, params: [], references: record.references }], ...common,
        apiScope: 'exported', source: source(record.source) })
    }
  }
  return { port: 'erlang', repo: artifact.source.repository, revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version})`,
    nativeProvenance: { files: artifact.source.files, exporter: artifact.exporter },
    sources: [{ ...common, version: artifact.package.version, repo: artifact.source.repository,
      revision: artifact.source.revision, extractedRevision: artifact.source.revision }], symbols }
}
