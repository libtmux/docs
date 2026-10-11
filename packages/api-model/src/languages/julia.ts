import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import type { ApiModel, ApiProduct, ApiSymbol, DocBlock, Signature } from '../model.ts'

interface Source { file: string; line: number }
interface Documentation { signature: string; markdown: string; source: Source; fields: Record<string, string> }
interface Method {
  identity: string
  kind: 'function' | 'constructor' | 'call'
  signature: string
  sourceSignature: string | null
  parameters: { name: string | null; type: string | null; default: string | null; keyword: boolean; variadic: boolean }[]
  typeParameters: string[]
  receiver: { name: string; type: string } | null
  module: string
  source: Source
  documentation: Documentation[]
  requiresExtension: boolean
}
interface Binding {
  id: string
  name: string
  module: string
  package: string
  product: ApiProduct
  kind: 'module' | 'type' | 'function' | 'macro' | 'constant'
  exported: boolean
  supporting: boolean
  public: boolean
  qualifiedAccess: boolean
  aliasOf: string | null
  definition: string | null
  type: string
  typeArguments: string[]
  abstract: boolean
  mutable: boolean
  supertype: string | null
  fields: { name: string; type: string }[]
  methods: Method[]
  documentation: Documentation[]
  source: Source
}
interface JuliaArtifact {
  schema: number
  port: string
  source: { repository: string; revision: string; files: { path: string; sha256: string }[] }
  exporter: Record<string, unknown> & { name: string; version: number }
  packages: { name: string; version: string; file: string }[]
  modules: { module: string; package: string; product: ApiProduct; bindings: string[]; supportingBindings: string[] }[]
  symbols: Binding[]
  extensionMethods: { id: string; name: string; module: string; methods: Method[]; documentation: Documentation[] }[]
  extensions: string[]
}

function assertArtifact(input: unknown, revision?: string): JuliaArtifact {
  const artifact = input as JuliaArtifact
  if (artifact?.schema !== 1 || artifact.port !== 'julia' || !Array.isArray(artifact.symbols) ||
    !Array.isArray(artifact.modules) || !Array.isArray(artifact.extensionMethods) ||
    !/^[a-f0-9]{40}$/.test(artifact.source?.revision ?? '')) {
    throw new Error('Julia documentation artifact has an unsupported schema or source identity')
  }
  if (revision && artifact.source.revision !== revision) throw new Error('Julia artifact source revision differs from the selected checkout')
  const ids = new Set<string>()
  for (const symbol of artifact.symbols) {
    if (ids.has(symbol.id) || symbol.id !== `${symbol.module}.${symbol.name}`) throw new Error(`Julia binding has a duplicate or unknown identity: ${symbol.id}`)
    ids.add(symbol.id)
    if (!symbol.source?.file || !symbol.source.line) throw new Error(`Julia binding lost its source: ${symbol.id}`)
  }
  for (const entry of artifact.modules) {
    const expected = [...entry.bindings, ...entry.supportingBindings].sort()
    const actual = artifact.symbols.filter((symbol) => symbol.module === entry.module).map((symbol) => symbol.name).sort()
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`Julia module inventory differs: ${entry.module}`)
  }
  for (const symbol of [...artifact.symbols, ...artifact.extensionMethods]) {
    if (new Set(symbol.methods.map((method) => method.identity)).size !== symbol.methods.length) throw new Error(`Julia binding repeats a method: ${symbol.id}`)
    for (const method of symbol.methods) {
      if (!method.identity || !method.signature || !method.source?.file || !method.source.line || !method.kind) {
        throw new Error(`Julia method lost its signature or source: ${symbol.id}`)
      }
      if (method.requiresExtension && !artifact.extensions.includes(method.module)) throw new Error(`Julia method requires an unloaded extension: ${method.module}`)
    }
  }
  for (const symbol of artifact.symbols.filter((entry) => entry.kind === 'type' && entry.aliasOf)) {
    if (!symbol.definition || !symbol.typeArguments.length || !ids.has(symbol.aliasOf!)) throw new Error(`Julia alias lost its definition or target: ${symbol.id}`)
  }
  return artifact
}

/** Julia documents arguments as Markdown bullets, not @param block tags. */
function documentation(records: Documentation[], names: Set<string> = new Set()) {
  const params = new Map<string, string>()
  const raw = [...new Set(records.map((record) => record.markdown.trim()).filter(Boolean))].join('\n\n')
  const tree = fromMarkdown(raw)
  let argumentsDepth = 0
  for (const node of tree.children) {
    if (node.type === 'heading') {
      if (node.depth <= argumentsDepth) argumentsDepth = 0
      const title = node.children.map((part) => 'value' in part ? part.value : '').join('')
      if (/^(?:(?:Keyword|Positional)\s+)?Arguments$/i.test(title)) argumentsDepth = node.depth
    }
    if (!argumentsDepth || node.type !== 'list') continue
    node.children = node.children.filter((item) => {
      const first = item.children[0]
      if (first?.type !== 'paragraph') return true
      const [label, separator, ...rest] = first.children
      if (label?.type !== 'inlineCode' || separator?.type !== 'text' || !/^\s*[:–-]\s*/.test(separator.value)) return true
      const name = label.value.split(/::|=|\.\.\./)[0]!.trim()
      if (!names.has(name)) return true
      const description = toMarkdown({ type: 'root', children: [
        { ...first, children: [{ ...separator, value: separator.value.replace(/^\s*[:–-]\s*/, '') }, ...rest] },
        ...item.children.slice(1),
      ] }).trim()
      if (!description) return true
      const previous = params.get(name)
      params.set(name, previous && previous !== description ? `${previous}\n\n${description}` : description)
      return false
    })
  }
  tree.children = tree.children.filter((node) => node.type !== 'list' || node.children.length > 0)
  // Once its list moved to Parameters, an empty Arguments heading adds no information.
  tree.children = tree.children.filter((node, i, nodes) => !(node.type === 'heading' &&
    /^(?:(?:Keyword|Positional)\s+)?Arguments$/i.test(node.children.map((part) => 'value' in part ? part.value : '').join('')) &&
    (!nodes[i + 1] || (nodes[i + 1]!.type === 'heading' && (nodes[i + 1] as typeof node).depth <= node.depth))))
  const text = params.size ? toMarkdown(tree).trim() : raw
  if (!text) return { params, doc: undefined }
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?```\s*/, '')
  const summary = prose.split(/\n\s*\n/)[0] ?? ''
  const start = text.indexOf(summary)
  const body = (text.slice(0, start) + text.slice(start + summary.length)).trim()
  return { params, doc: { summary, body: body || undefined } as DocBlock }
}

/** Preserve native dispatch identities, method docs, aliases and optional extensions. */
export function extractJulia(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = assertArtifact(input, expectedRevision)
  const source = (location: Source): ApiSymbol['source'] => ({
    file: location.file, line: location.line, repo: artifact.source.repository,
    revision: artifact.source.revision, extractedRevision: artifact.source.revision,
  })
  const methodSignature = (method: Method): Signature => {
    const parsed = documentation(method.documentation, new Set(method.parameters.flatMap((parameter) => parameter.name ? [parameter.name] : [])))
    return {
    identity: method.identity, methodKind: method.kind, raw: method.signature,
    params: method.parameters.map((parameter, index) => ({
      name: parameter.name && !parameter.name.startsWith('#') ? parameter.name : `argument${index + 1}`,
      type: parameter.type ?? undefined, default: parameter.default ?? undefined,
      keywordOnly: parameter.keyword,
      variadic: parameter.variadic ? (parameter.keyword ? 'keyword' : 'positional') : undefined,
      doc: parameter.name ? parsed.params.get(parameter.name) : undefined,
    })),
    typeParams: method.typeParameters,
    receiver: method.receiver ?? undefined,
    doc: parsed.doc, source: source(method.source),
    extension: method.requiresExtension ? method.module : undefined,
    }
  }
  const symbols: ApiSymbol[] = []
  for (const entry of artifact.symbols) {
    const binding: ApiSymbol = {
      id: entry.id, publicId: entry.id, name: entry.name, namespace: entry.module,
      package: entry.package, product: entry.product,
      kind: entry.kind === 'type' ? (entry.aliasOf ? 'typealias' : entry.abstract ? 'class' : 'struct') : entry.kind === 'macro' ? 'function' : entry.kind,
      modifiers: [...(entry.abstract ? ['abstract' as const] : []), ...(entry.kind === 'macro' ? ['macro' as const] : [])],
      apiScope: entry.supporting ? 'supporting' : 'exported',
      signatures: entry.methods.map(methodSignature),
      doc: documentation(entry.documentation.filter((record) => record.signature === 'Union{}')).doc,
      type: entry.kind === 'type' ? entry.definition ?? entry.type : entry.kind === 'constant' ? entry.type : undefined,
      typeParams: entry.kind === 'type' ? entry.typeArguments : undefined,
      value: entry.kind === 'constant' ? entry.definition ?? undefined : undefined,
      extends: entry.supertype && entry.supertype !== 'Any' && !entry.aliasOf ? [entry.supertype] : undefined,
      imports: entry.aliasOf ? { [entry.name]: entry.aliasOf } : undefined,
      source: source(entry.kind === 'function' && entry.methods.length === 1 ? entry.methods[0]!.source : entry.source),
    }
    symbols.push(binding)
    // Aliases link to the underlying type; fields remain owned by that type.
    if (entry.aliasOf) continue
    for (const field of entry.fields) {
      const fieldDoc = entry.documentation.map((record) => record.fields[field.name]).filter(Boolean).join('\n\n')
      symbols.push({
        id: `${entry.id}.${field.name}`, publicId: `${entry.id}.${field.name}`,
        name: field.name, namespace: entry.module, parent: entry.id, kind: 'property',
        modifiers: entry.mutable ? [] : ['readonly'], type: field.type, signatures: [],
        package: entry.package, product: entry.product, apiScope: binding.apiScope,
        doc: fieldDoc ? { summary: fieldDoc } : undefined,
        // Reflection gives field types but no field line; link to the containing source file.
        source: { ...source(entry.source), line: undefined },
      })
    }
  }
  for (const entry of artifact.modules) {
    if (symbols.some((symbol) => symbol.id === entry.module)) continue
    const pkg = artifact.packages.find((candidate) => candidate.name === entry.package)!
    symbols.push({
      id: entry.module, publicId: entry.module, name: entry.module, kind: 'module',
      modifiers: [], signatures: [], package: entry.package, product: entry.product,
      apiScope: 'exported', source: source({ file: pkg.file, line: 1 }),
    })
  }
  for (const entry of artifact.extensionMethods) {
    const byPackage = new Map<string, Method[]>()
    for (const method of entry.methods) {
      const packageName = method.source.file.startsWith('packages/') ? method.source.file.split('/')[1]! : 'LibTmux'
      byPackage.set(packageName, [...(byPackage.get(packageName) ?? []), method])
    }
    for (const [packageName, methods] of byPackage) {
      const owner = artifact.modules.find((candidate) => candidate.package === packageName)
      if (!owner) throw new Error(`Julia external method has an unknown package: ${packageName}`)
      symbols.push({
        id: `${packageName}.${entry.id}`, publicId: `${packageName}.${entry.id}`,
        qualifiedName: entry.id, name: entry.id, namespace: owner.module,
        kind: 'function', modifiers: [], signatures: methods.map(methodSignature),
        package: packageName, product: owner.product, apiScope: 'exported',
        doc: documentation(entry.documentation.filter((record) => record.signature === 'Union{}')).doc,
        source: source(methods[0]!.source),
      })
    }
  }
  return {
    port: 'julia', repo: artifact.source.repository, revision: artifact.source.revision,
    extractor: `@libtmux/api-model@0.0.1 (${artifact.exporter.name} v${artifact.exporter.version})`,
    nativeProvenance: { files: artifact.source.files, exporter: artifact.exporter },
    sources: artifact.packages.map((pkg) => ({
      package: pkg.name, product: artifact.modules.find((entry) => entry.package === pkg.name)!.product,
      version: pkg.version, repo: artifact.source.repository, revision: artifact.source.revision,
      extractedRevision: artifact.source.revision,
    })),
    symbols,
  }
}
