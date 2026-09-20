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
  defines: LuaNode[]
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

export function extractLua(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const symbols: ApiSymbol[] = []
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
      const receiver = !module && (field.extends?.args?.[0]?.name === 'self' || field.view?.includes('self:'))
      const separator = receiver ? ':' : '.'
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
