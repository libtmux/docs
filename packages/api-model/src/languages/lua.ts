import type { ApiModel, ApiSymbol, DocBlock, Param, Signature } from '../model.ts'

interface LuaNode {
  name?: string
  file?: string
  start?: [number, number]
  type?: string
  view?: string
  desc?: string
  rawdesc?: string
  args?: LuaNode[]
  returns?: LuaNode[]
  extends?: LuaNode
}

interface LuaDeclaration extends LuaNode {
  name: string
  defines: (LuaNode & { extends?: LuaNode | LuaNode[] })[]
  fields: LuaNode[]
}

interface LuaArtifact {
  schema: number
  port: string
  source: { repository: string; revision: string }
  exporter: { name: string; version: number; luals: string }
  package: { name: string; version: string; source_tag: string }
  declarations: LuaDeclaration[]
}

function assertArtifact(input: unknown, expectedRevision?: string): LuaArtifact {
  const artifact = input as LuaArtifact
  if (artifact?.schema !== 1 || artifact.port !== 'lua' || !Array.isArray(artifact.declarations)) {
    throw new Error('Lua documentation artifact has an unsupported schema')
  }
  if (expectedRevision && artifact.source?.revision !== expectedRevision) {
    throw new Error(`Lua source revision mismatch: expected ${expectedRevision}, got ${artifact.source?.revision}`)
  }
  return artifact
}

const MODULES = new Set(['libtmux.query', 'libtmux.runtime.luv', 'libtmux.runtime.nvim'])

function doc(text?: string): DocBlock | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  const [summary, ...body] = trimmed.split(/\n\s*\n/)
  return { summary, body: body.join('\n\n') || undefined }
}

function source(node: LuaNode, artifact: LuaArtifact) {
  return {
    file: node.file ?? '',
    line: node.start?.[0],
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractedRevision: artifact.source.revision,
  }
}

function signature(field: LuaNode, receiver: boolean): Signature {
  const args = field.extends?.args ?? []
  const params: Param[] = args.slice(receiver && args[0]?.name === 'self' ? 1 : 0).map((argument, index) => ({
    name: argument.name ?? `arg${index + 1}`,
    type: argument.view,
    ...(argument.view?.endsWith('?') ? { default: 'nil' } : {}),
    ...(argument.rawdesc || argument.desc ? { doc: argument.rawdesc ?? argument.desc } : {}),
  }))
  const returns = field.extends?.returns?.map((entry) => entry.view).filter(Boolean).join(', ')
  return {
    raw: field.view ?? field.extends?.view,
    params,
    ...(returns ? { returns } : {}),
  }
}

/** `libtmux.Configurable<libtmux.SnapshotPane>` names `libtmux.Configurable`. */
const parentsOf = (declaration: LuaDeclaration): string[] =>
  declaration.defines
    .flatMap((d) => (Array.isArray(d.extends) ? d.extends : []))
    .map((e) => e.view?.replace(/<.*$/, '') ?? '')
    .filter(Boolean)

/**
 * The class a field was declared on, when that is not this one.
 *
 * LuaLS copies every inherited field into the subclass, with the base's own
 * file and line and its generic parameters substituted. The location is what
 * survives the copy, so a field is inherited when a parent carries one at the
 * same place, and it came from the furthest ancestor that does:
 * `Session.snapshot` reaches Session through Configurable from Entity.
 */
function originOf(
  declaration: LuaDeclaration,
  field: LuaNode,
  byName: Map<string, LuaDeclaration>,
  seen = new Set<string>([declaration.name]),
): string | undefined {
  for (const name of parentsOf(declaration)) {
    const parent = byName.get(name)
    if (!parent || seen.has(name)) continue
    const same = parent.fields.some(
      (f) => f.name === field.name && f.file === field.file && f.start?.[0] === field.start?.[0],
    )
    if (same) return originOf(parent, field, byName, new Set(seen).add(name)) ?? name
  }
  return undefined
}

export function extractLua(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const symbols: ApiSymbol[] = []
  const byName = new Map(artifact.declarations.map((d) => [d.name, d]))
  for (const declaration of artifact.declarations) {
    const ownerSource = declaration.defines[0] ?? declaration.fields[0] ?? {}
    const module = MODULES.has(declaration.name)
    symbols.push({
      id: declaration.name,
      publicId: declaration.name,
      name: declaration.name.split('.').at(-1)!,
      kind: module ? 'module' : declaration.fields.length ? 'class' : 'typealias',
      modifiers: [],
      signatures: [],
      product: 'core',
      apiScope: 'exported',
      type: declaration.fields.length ? undefined : declaration.view,
      source: source(ownerSource, artifact),
    })
    for (const field of declaration.fields) {
      if (!field.name) continue
      const callable = Boolean(field.extends?.args || field.extends?.returns || field.view?.startsWith('fun(') || field.view === 'function')
      const receiver = Boolean(
        !module && (field.extends?.args?.[0]?.name === 'self' || field.view?.includes('self:')),
      )
      const separator = receiver ? ':' : '.'
      const inheritedFrom = module ? undefined : originOf(declaration, field, byName)
      symbols.push({
        id: `${declaration.name}${separator}${field.name}`,
        publicId: `${declaration.name}${separator}${field.name}`,
        name: field.name,
        kind: callable ? (module ? 'function' : 'method') : 'attribute',
        modifiers: [],
        parent: declaration.name,
        signatures: callable ? [signature(field, receiver)] : [],
        doc: doc(field.rawdesc ?? field.desc),
        product: 'core',
        apiScope: 'exported',
        type: callable ? undefined : field.view,
        source: source(field, artifact),
        ...(inheritedFrom ? { inheritedFrom } : {}),
      })
    }
  }
  return {
    port: 'lua',
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version}; LuaLS ${artifact.exporter.luals})`,
    sources: [{
      product: 'core',
      package: artifact.package.name,
      version: artifact.package.version,
      repo: artifact.source.repository,
      revision: artifact.source.revision,
      extractedRevision: artifact.source.revision,
    }],
    symbols,
  }
}
