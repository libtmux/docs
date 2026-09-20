import type { ApiModel, ApiProduct, ApiSymbol, DocBlock, Param, Signature, SymbolKind } from '../model.ts'

interface RubyPackage {
  name: string
  version: string
  product: ApiProduct
}

interface RubySource {
  path: string
  line: number
}

interface RubyNamespace {
  id: string
  name: string
  kind: 'class' | 'module'
  package: string
  product: ApiProduct
  documentation?: string
  extends?: string[]
  source: RubySource
}

interface RubyTag {
  tag: string
  name?: string
  types?: string[]
  text?: string
}

interface RubyMethod {
  id: string
  owner?: string
  namespace: string
  name: string
  method_kind: 'instance' | 'singleton'
  package: string
  product: ApiProduct
  visibility: string
  signatures: string[]
  documentation?: string
  tags?: RubyTag[]
  contract?: { id: string; title: string }
  source: RubySource
}

interface RubyAlias {
  id: string
  name: string
  package: string
  product: ApiProduct
  type: string
  source: RubySource
}

interface RubyArtifact {
  schema: number
  port: string
  source: { repository: string; revision: string }
  exporter: { name: string; version: number }
  packages: RubyPackage[]
  namespaces: RubyNamespace[]
  aliases?: RubyAlias[]
  symbols: RubyMethod[]
}

function assertArtifact(input: unknown, expectedRevision?: string): RubyArtifact {
  const artifact = input as RubyArtifact
  if (artifact?.schema !== 1 || artifact.port !== 'ruby' || !Array.isArray(artifact.symbols)) {
    throw new Error('Ruby documentation artifact has an unsupported schema')
  }
  if (expectedRevision && artifact.source?.revision !== expectedRevision) {
    throw new Error(`Ruby source revision mismatch: expected ${expectedRevision}, got ${artifact.source?.revision}`)
  }
  return artifact
}

function docBlock(text = '', contract?: { id: string; title: string }): DocBlock | undefined {
  const trimmed = text.trim()
  if (!trimmed && !contract) return undefined
  const [summary = '', ...body] = trimmed.split(/\n\s*\n/)
  return {
    summary: summary || `Behavior: ${contract?.title}.`,
    body: [body.join('\n\n'), contract ? `Behavior contract: ${contract.title}.` : ''].filter(Boolean).join('\n\n') || undefined,
  }
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  const last = value.slice(start).trim()
  if (last) parts.push(last)
  return parts
}

function topLevelArrow(value: string, start: number): number {
  let depth = 0
  for (let index = start; index < value.length - 1; index += 1) {
    const char = value[index]
    if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    else if (char === '-' && value[index + 1] === '>' && depth === 0) return index
  }
  return -1
}

function closingParen(value: string, open: number): number {
  let depth = 0
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')' && --depth === 0) return index
  }
  return -1
}

function rbsSignature(raw: string, tags: RubyTag[] = []): Signature {
  const open = raw.indexOf('(')
  const close = open < 0 ? -1 : closingParen(raw, open)
  const arrow = close < 0 ? -1 : topLevelArrow(raw, close + 1)
  const docs = new Map(tags.filter((tag) => tag.tag === 'param' && tag.name).map((tag) => [tag.name!, tag.text]))
  const params: Param[] = open < 0 || close < 0 ? [] : splitTopLevel(raw.slice(open + 1, close)).map((part, index) => {
    const keyword = /^(\??)([A-Za-z_]\w*[!?=]?):\s*(.+)$/.exec(part)
    if (keyword) {
      return {
        name: keyword[2], type: keyword[3],
        ...(keyword[1] ? { default: 'nil' } : {}),
        ...(docs.get(keyword[2]) ? { doc: docs.get(keyword[2]) } : {}),
      }
    }
    if (part.startsWith('**')) return { name: 'kwargs', type: part.slice(2), variadic: 'keyword' as const }
    if (part.startsWith('*')) return { name: 'args', type: part.slice(1), variadic: 'positional' as const }
    const optional = part.startsWith('?')
    return { name: `arg${index + 1}`, type: optional ? part.slice(1) : part, ...(optional ? { default: 'nil' } : {}) }
  })
  const typeParams = raw.startsWith('[') ? splitTopLevel(raw.slice(1, raw.indexOf(']'))) : undefined
  const raises = tags.filter((tag) => tag.tag === 'raise').map((tag) => ({
    type: tag.types?.join(' | ') || tag.name || 'StandardError', doc: tag.text,
  }))
  const returnsDoc = tags.find((tag) => tag.tag === 'return')?.text?.trim() || undefined
  return {
    raw,
    params,
    ...(arrow >= 0 ? { returns: raw.slice(arrow + 2).trim() } : {}),
    ...(returnsDoc ? { returnsDoc } : {}),
    ...(typeParams?.length ? { typeParams } : {}),
    ...(raises.length ? { raises } : {}),
  }
}

function source(source: RubySource, artifact: RubyArtifact) {
  return {
    file: source.path,
    line: source.line,
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractedRevision: artifact.source.revision,
  }
}

export function extractRuby(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const namespaceIds = new Set(artifact.namespaces.map((namespace) => namespace.id))
  const namespaces: ApiSymbol[] = artifact.namespaces.map((namespace) => {
    const parent = namespace.id.includes('::') ? namespace.id.slice(0, namespace.id.lastIndexOf('::')) : undefined
    return {
      id: namespace.id,
      publicId: namespace.id,
      name: namespace.name,
      kind: namespace.kind as SymbolKind,
      modifiers: [],
      parent: parent && namespaceIds.has(parent) ? parent : undefined,
      signatures: [],
      doc: docBlock(namespace.documentation),
      extends: namespace.extends,
      product: namespace.product,
      package: namespace.package,
      apiScope: 'exported',
      source: source(namespace.source, artifact),
    }
  })
  const methods: ApiSymbol[] = artifact.symbols.map((method) => ({
    id: method.id,
    publicId: method.id,
    name: method.name,
    kind: 'method',
    modifiers: method.method_kind === 'singleton' ? ['static'] : [],
    parent: method.namespace,
    signatures: method.signatures.map((signature) => rbsSignature(signature, method.tags)),
    doc: docBlock(method.documentation, method.contract),
    product: method.product,
    package: method.package,
    publicOwner: method.owner,
    apiScope: 'exported',
    source: source(method.source, artifact),
  }))
  const aliases: ApiSymbol[] = (artifact.aliases ?? []).map((entry) => ({
    id: entry.id,
    publicId: entry.id,
    name: entry.name,
    kind: 'typealias',
    modifiers: [],
    parent: entry.id.includes('::') ? entry.id.slice(0, entry.id.lastIndexOf('::')) : undefined,
    signatures: [],
    product: entry.product,
    package: entry.package,
    apiScope: 'supporting',
    type: entry.type,
    source: source(entry.source, artifact),
  }))
  return {
    port: 'ruby',
    repo: artifact.source.repository,
    revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version})`,
    sources: artifact.packages.map((entry) => ({
      product: entry.product,
      package: entry.name,
      version: entry.version,
      repo: artifact.source.repository,
      revision: artifact.source.revision,
      extractedRevision: artifact.source.revision,
    })),
    symbols: [...namespaces, ...aliases, ...methods],
  }
}
