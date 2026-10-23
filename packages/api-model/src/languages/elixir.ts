import { parseElixirDoc } from '../doc/elixir.ts'
import type { ApiModel, ApiSymbol, DocBlock, Modifier, Param, Signature, SymbolKind } from '../model.ts'

interface Source { file: string; line: number }
interface Spec {
  parameters: string[]
  returns: string
  constraints: { name: string; type: string }[]
  text: string
}
interface Member {
  id: string
  name: string
  arity: number
  kind: 'function' | 'macro' | 'callback' | 'macrocallback' | 'type'
  line: number
  doc: string | null
  since: string | null
  deprecated: string | null
  source: Source
  /** Callables. */
  head?: string | null
  parameters?: { name: string; default: string | null }[]
  specs?: Spec[]
  delegateTo?: string | null
  equiv?: string | null
  /** Types. */
  opaque?: boolean
  declaration?: string | null
}
interface Field { name: string; type: string; required: boolean; default: string | null }
interface Module {
  name: string
  kind: 'module' | 'struct' | 'exception' | 'behaviour' | 'protocol'
  doc: string | null
  since: string | null
  deprecated: string | null
  behaviours: string[]
  source: Source
  fields: Field[]
  members: Member[]
}
interface ElixirArtifact {
  schema: number
  port: string
  source: { repository: string; revision: string; files: { path: string; sha256: string }[] }
  exporter: Record<string, unknown> & { name: string; version: number; columns: number }
  package: { name: string; app: string; version: string; elixir: string | null }
  modules: Module[]
}

/** The columns the exporter's formatter laid declarations out in; the reference's API budget must match. */
export const ELIXIR_DECLARATION_COLUMNS = 60

function assertArtifact(input: unknown, revision?: string): ElixirArtifact {
  const artifact = input as ElixirArtifact
  if (artifact?.schema !== 1 || artifact.port !== 'elixir' || !Array.isArray(artifact.modules) ||
    !/^[a-f0-9]{40}$/.test(artifact.source?.revision ?? '')) {
    throw new Error('Elixir documentation artifact has an unsupported schema or source identity')
  }
  if (revision && artifact.source.revision !== revision) {
    throw new Error(`Elixir artifact source revision differs from the selected checkout: ${artifact.source.revision} is not ${revision}`)
  }
  if (artifact.exporter?.columns !== ELIXIR_DECLARATION_COLUMNS) {
    throw new Error(`Elixir declarations were formatted for ${artifact.exporter?.columns} columns, not ${ELIXIR_DECLARATION_COLUMNS}`)
  }
  const ids = new Set<string>()
  for (const module of artifact.modules) {
    for (const id of [module.name, ...module.members.map((member) => member.id), ...module.fields.map((field) => `${module.name}.${field.name}`)]) {
      if (ids.has(id)) throw new Error(`Elixir artifact repeats ${id}`)
      ids.add(id)
    }
    if (!module.source?.file || !module.source.line) throw new Error(`Elixir module lost its source: ${module.name}`)
    for (const member of module.members) {
      if (!member.source?.file || !member.source.line) throw new Error(`Elixir member lost its source: ${member.id}`)
      if (member.kind === 'type' ? !member.declaration && member.declaration !== null
        : !member.parameters || !member.specs) throw new Error(`Elixir member lost its declaration: ${member.id}`)
    }
  }
  return artifact
}

function documentation(text: string | null, since: string | null, deprecated: string | null): DocBlock | undefined {
  const parsed = text?.trim() ? parseElixirDoc(text).doc : undefined
  if (!parsed && !since && !deprecated) return undefined
  return { ...(parsed ?? { summary: '' }), ...(since ? { since } : {}), ...(deprecated ? { deprecated } : {}) }
}

const SIGNATURE_KIND: Record<Member['kind'], SymbolKind> = {
  function: 'function', macro: 'function', callback: 'method', macrocallback: 'method', type: 'typealias',
}

/** A callable's attribute is part of its declaration: `@spec`, `@callback`. */
function callableSignatures(member: Member): Signature[] {
  const head = member.head ?? member.name
  const parameters = member.parameters ?? []
  const specs = member.specs ?? []
  const callback = member.kind === 'callback' || member.kind === 'macrocallback'
  const params = (spec?: Spec): Param[] => parameters.map((parameter, index) => ({
    name: parameter.name,
    ...(spec?.parameters[index] ? { type: spec.parameters[index] } : {}),
    ...(parameter.default !== null ? { default: parameter.default } : {}),
  }))
  if (!specs.length) return [{ raw: head, params: params() }]
  return specs.map((spec) => ({
    // A callback is declared by its typespec alone; a function by its head and spec.
    raw: callback ? spec.text : `${head}\n${spec.text}`,
    params: params(spec),
    returns: spec.returns,
    ...(spec.constraints.length ? { typeParams: spec.constraints.map((constraint) => `${constraint.name}: ${constraint.type}`) } : {}),
  }))
}

/** `t(item)` declares `item`. */
const typeVariables = (head: string | null | undefined): string[] | undefined => {
  const inside = /^[^(]*\((.*)\)$/s.exec(head ?? '')?.[1]?.trim()
  return inside ? inside.split(',').map((name) => name.trim()) : undefined
}

/** Preserve ExDoc's view of a compiled application: modules, their documented members and typespecs. */
export function extractElixir(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const source = (location: Source): ApiSymbol['source'] => ({
    file: location.file, line: location.line, repo: artifact.source.repository,
    revision: artifact.source.revision, extractedRevision: artifact.source.revision,
  })
  const common = { package: artifact.package.name, product: 'core' as const, apiScope: 'exported' as const }
  const symbols: ApiSymbol[] = []
  for (const module of artifact.modules) {
    const segments = module.name.split('.')
    const kind: SymbolKind = module.kind === 'struct' ? 'struct' : module.kind === 'exception' ? 'exception'
      : module.kind === 'behaviour' || module.kind === 'protocol' ? 'interface' : 'module'
    symbols.push({
      id: module.name, publicId: module.name, name: segments.at(-1)!,
      ...(segments.length > 1 ? { namespace: segments.slice(0, -1).join('.') } : {}),
      kind, modifiers: module.deprecated ? ['deprecated'] : [], signatures: [],
      ...common, doc: documentation(module.doc, module.since, module.deprecated),
      ...(module.behaviours.length ? { extends: module.behaviours } : {}),
      source: source(module.source),
    })
    for (const field of module.fields) {
      symbols.push({
        id: `${module.name}.${field.name}`, publicId: `${module.name}.${field.name}`, name: field.name,
        namespace: module.name, parent: module.name, kind: 'property', modifiers: [], signatures: [],
        ...common, type: field.type, ...(field.default !== null ? { value: field.default } : {}),
        doc: field.required ? { summary: 'Required: building the struct without this key is an error.' } : undefined,
        // Struct fields have no line of their own; the owner's declaration is the nearest source.
        source: { ...source(module.source), line: undefined },
      })
    }
    for (const member of module.members) {
      const type = member.kind === 'type'
      const modifiers: Modifier[] = [
        ...(member.kind === 'macro' || member.kind === 'macrocallback' ? ['macro' as const] : []),
        ...(member.kind === 'callback' || member.kind === 'macrocallback' ? ['abstract' as const] : []),
        ...(type && member.opaque ? ['opaque' as const] : []),
        ...(member.deprecated ? ['deprecated' as const] : []),
      ]
      const signatures: Signature[] = type
        ? (member.declaration ? [{ raw: member.declaration, params: [] }] : [])
        : callableSignatures(member)
      if (signatures.length > 1 && !type) modifiers.push('overload')
      const doc = documentation(member.doc, member.since, member.deprecated)
      // ExDoc points an undocumented delegate at its target and states an `equiv:` the author gave.
      const pointer = member.delegateTo ? `See \`${member.delegateTo}\`.` : member.equiv ? `Equivalent to \`${member.equiv}\`.` : undefined
      symbols.push({
        id: member.id, publicId: member.id, name: `${member.name}/${member.arity}`,
        namespace: module.name, parent: module.name,
        kind: SIGNATURE_KIND[member.kind], modifiers, signatures, ...common,
        ...(type ? { typeParams: typeVariables(member.head) } : {}),
        ...(type && member.declaration && !member.opaque ? { type: member.declaration.replace(/^@type\s+/, '') } : {}),
        doc: !pointer ? doc : doc?.summary ? { ...doc, body: doc.body ?? pointer } : { ...doc, summary: pointer },
        source: source(member.source),
      })
    }
  }
  return {
    port: 'elixir', repo: artifact.source.repository, revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version})`,
    nativeProvenance: { files: artifact.source.files, exporter: artifact.exporter },
    sources: [{
      product: 'core', package: artifact.package.name, version: artifact.package.version,
      repo: artifact.source.repository, revision: artifact.source.revision, extractedRevision: artifact.source.revision,
    }],
    symbols,
  }
}
