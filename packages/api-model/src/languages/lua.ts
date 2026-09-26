import type { ApiModel, ApiSymbol, DocBlock, Param, Signature } from '../model.ts'

interface LuaNode {
  name?: string
  file?: string
  start?: [number, number]
  type?: string
  view?: string
  desc?: string
  rawdesc?: string
  args?: LuaArg[]
  returns?: LuaNode[]
  extends?: LuaNode
  types?: LuaNode[]
}

/** An argument. In a `fun(...)` type LuaLS records its name as a node. */
interface LuaArg extends Omit<LuaNode, 'name'> {
  name?: string | { view?: string }
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

const argName = (argument?: LuaArg) =>
  typeof argument?.name === 'string' ? argument.name : argument?.name?.view

/** LuaLS prints an optional class as `(libtmux.PaneOptions)?`; the reference writes `libtmux.PaneOptions?`. */
const typeView = (view?: string) => view?.replace(/\(([^()]*)\)\?/g, '$1?')

/**
 * The function shapes a field's type holds.
 *
 * A module function carries its arguments on `extends` itself. A
 * `---@field name fun(...)` carries them one level down, in `extends.types`,
 * with one entry per member of a union: `Server:handle` is typed as one
 * overload per snapshot record. Reading only the first shape gave every
 * method in the reference an empty argument list and no return type.
 */
const functionsOf = (field: LuaNode): LuaNode[] => {
  const type = field.extends
  if (!type) return []
  if (type.args || type.returns) return [type]
  // A parenthesised union member is a `doc.type` of its own around the function.
  const walk = (node: LuaNode): LuaNode[] =>
    node.type === 'doc.type.function' ? [node] : (node.types ?? []).flatMap(walk)
  return walk(type)
}

function signature(fn: LuaNode, receiver: boolean, raw: string | undefined): Signature {
  const args = fn.args ?? []
  const params: Param[] = args.slice(receiver && argName(args[0]) === 'self' ? 1 : 0).map((argument, index) => {
    const type = typeView(argument.view)
    return {
      name: argName(argument) ?? `arg${index + 1}`,
      type,
      ...(type?.endsWith('?') ? { default: 'nil' } : {}),
      ...(argument.rawdesc || argument.desc ? { doc: argument.rawdesc ?? argument.desc } : {}),
    }
  })
  const returns = fn.returns?.map((entry) => typeView(entry.view)).filter(Boolean).join(', ')
  const written = `fun(${args.map((a) => `${argName(a)}: ${a.view}`).join(', ')})${returns ? `:${returns}` : ''}`
  return {
    raw: typeView(raw ?? fn.view ?? written),
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
      const functions = functionsOf(field)
      const callable = Boolean(functions.length || field.view?.startsWith('fun(') || field.view === 'function')
      const receiver = Boolean(
        !module && (argName(functions[0]?.args?.[0]) === 'self' || field.view?.includes('self:')),
      )
      const overloaded = functions.length > 1
      const separator = receiver ? ':' : '.'
      const inheritedFrom = module ? undefined : originOf(declaration, field, byName)
      symbols.push({
        id: `${declaration.name}${separator}${field.name}`,
        publicId: `${declaration.name}${separator}${field.name}`,
        name: field.name,
        kind: callable ? (module ? 'function' : 'method') : 'attribute',
        modifiers: overloaded ? ['overload'] : [],
        parent: declaration.name,
        signatures: !callable
          ? []
          : functions.length
            ? functions.map((fn) => signature(fn, receiver, overloaded ? undefined : field.view))
            : [signature({}, receiver, field.view)],
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
