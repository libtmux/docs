import type { ApiModel, ApiProduct, ApiSymbol, DocBlock, Modifier, Param, Signature, SymbolKind } from '../model.ts'

interface NativeDocumentation { summary: string; body?: string; seeAlso?: string[] }
interface NativeSource { file: string; line: number }
interface NativeMethod { signature: string; qualifiers: string[]; specializers: string[] }
interface NativeSymbol {
  id: string
  name: string
  kind: 'function' | 'class' | 'exception'
  signature?: string
  modifiers: string[]
  generic?: boolean
  methods?: NativeMethod[]
  supertypes?: string[]
  documentation: NativeDocumentation
  source: NativeSource
}
interface NativePackage {
  name: string
  system: string
  product: ApiProduct
  documentation: NativeDocumentation
  source: NativeSource
  symbols: NativeSymbol[]
}
interface CommonLispArtifact {
  schema: string
  port: string
  library: { version: string }
  runtime: { implementation: string; implementationVersion: string; asdfVersion: string }
  source: {
    repository: string
    revision: string
    dirty: boolean
    files: { path: string; sha256: string }[]
  }
  exporter: { name: string; version: number; revision: string; dirty: boolean }
  packages: NativePackage[]
}

const SHA1 = /^[0-9a-f]{40}$/
const SHA256 = /^[0-9a-f]{64}$/
const PACKAGE_CONTRACT = [
  ['libtmux', 'libtmux', 'core'],
  ['libtmux.control', 'libtmux/control', 'core'],
  ['libtmux.json', 'libtmux/json', 'core'],
  ['libtmux.query', 'libtmux/query', 'core'],
  ['libtmux.workspace', 'libtmux/workspace', 'workspace'],
  ['libtmux.workspace.cli', 'libtmux/workspace/cli', 'workspace'],
] as const

function documentation(value: NativeDocumentation): DocBlock {
  const body = [value.body, value.seeAlso?.length
    ? `See also: ${value.seeAlso.map((target) => `\`${target}\``).join(', ')}.` : undefined]
    .filter(Boolean).join('\n\n')
  return {
    summary: value.summary,
    ...(body ? { body } : {}),
    ...(value.seeAlso?.length ? { seeAlso: [...value.seeAlso] } : {}),
  }
}

/** A CLOS method specializes required arguments; optional/key bindings keep their ordinary roles. */
function methodSignature(id: string, method: NativeMethod, names: Map<string, string>): Signature {
  const [name, ...argumentsAndQualifiers] = listItems(method.signature)
  const args = argumentsAndQualifiers.slice(method.qualifiers.length)
  const plain = args.map((argument, index) => index < method.specializers.length
    ? listItems(argument)[0]! : argument)
  const params = parameters(`(${name} ${plain.join(' ')})`).map((param, index) => ({
    ...param, ...(index < method.specializers.length
      ? { type: names.get(method.specializers[index]!) ?? method.specializers[index]! } : {}),
  }))
  return {
    identity: JSON.stringify([id, method.qualifiers, method.specializers]),
    methodKind: 'function', raw: method.signature, params,
    label: `${method.qualifiers.join(' ') || 'Primary'} method: ${method.specializers.map((type) => names.get(type) ?? type).join(', ')}`,
  }
}

/** Split one printed Lisp list without evaluating or interning its contents. */
function listItems(value: string): string[] {
  const text = value.trim()
  if (!text.startsWith('(') || !text.endsWith(')')) return []
  const items: string[] = []
  let depth = 0
  let start = -1
  let string = false
  let escaped = false
  let escapedSymbol = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\' && (string || escapedSymbol)) { escaped = true; continue }
    if (char === '"' && !escapedSymbol) {
      if (depth === 1 && start < 0) start = index
      string = !string
      continue
    }
    if (char === '|' && !string) {
      if (depth === 1 && start < 0) start = index
      escapedSymbol = !escapedSymbol
      continue
    }
    if (string || escapedSymbol) continue
    if (char === '(') {
      depth++
      if (depth === 2 && start < 0) start = index
      continue
    }
    if (char === ')') {
      if (depth === 1 && start >= 0) { items.push(text.slice(start, index)); start = -1 }
      if (depth === 2 && start >= 0) {
        depth--
        if (depth === 1) { items.push(text.slice(start, index + 1)); start = -1 }
        continue
      }
      depth--
      continue
    }
    if (depth !== 1) continue
    if (/\s/.test(char)) {
      if (start >= 0) { items.push(text.slice(start, index)); start = -1 }
    } else if (start < 0) start = index
  }
  return items
}

/** Read caller-visible names from a printed Common Lisp lambda list. */
function parameters(signature: string): Param[] {
  const [, ...lambdaList] = listItems(signature)
  const params: Param[] = []
  let mode: 'required' | 'optional' | 'rest' | 'key' = 'required'
  let skipNext = false
  for (const item of lambdaList) {
    const marker = item.toLowerCase()
    if (marker === '&optional') { mode = 'optional'; continue }
    if (marker === '&rest' || marker === '&body') { mode = 'rest'; continue }
    if (marker === '&key') { mode = 'key'; continue }
    if (marker === '&allow-other-keys') continue
    if (marker === '&aux') break
    if (marker === '&whole' || marker === '&environment') { skipNext = true; continue }
    if (skipNext) { skipNext = false; continue }
    const parts = item.startsWith('(') ? listItems(item) : []
    const binding = parts[0] ?? item
    const name = mode === 'required' ? item
      : mode === 'key' && binding.startsWith('(') ? listItems(binding)[1] ?? binding : binding
    const defaultValue = mode === 'optional' || mode === 'key' ? parts[1] : undefined
    params.push({
      name,
      ...(defaultValue ? { default: defaultValue } : {}),
      ...(mode === 'optional' || mode === 'key' ? { optional: true } : {}),
      ...(mode === 'key' ? { keywordOnly: true } : {}),
      ...(mode === 'rest' ? { variadic: 'positional' as const } : {}),
    })
  }
  return params
}

function assertArtifact(input: unknown, revision?: string): CommonLispArtifact {
  const artifact = input as CommonLispArtifact
  if (artifact?.schema !== 'libtmux.lisp.api/1' || artifact.port !== 'lisp' ||
      artifact.source?.repository !== 'libtmux/libtmux-lisp' || !SHA1.test(artifact.source?.revision ?? '') ||
      artifact.source?.dirty !== false || revision !== undefined && artifact.source.revision !== revision) {
    throw new Error('Common Lisp artifact schema, source identity or selected checkout differs')
  }
  if (artifact.exporter?.name !== 'libtmux.documentation' || artifact.exporter.version !== 1 ||
      !SHA1.test(artifact.exporter.revision ?? '') || artifact.exporter.dirty !== false ||
      artifact.runtime?.implementation !== 'SBCL' || !artifact.runtime.implementationVersion ||
      !artifact.runtime.asdfVersion || !/^\d+\.\d+\.\d+$/.test(artifact.library?.version ?? '')) {
    throw new Error('Common Lisp artifact producer identity is unsupported or dirty')
  }
  const filePaths = artifact.source.files?.map((file) => file.path) ?? []
  if (!filePaths.length || new Set(filePaths).size !== filePaths.length ||
      artifact.source.files.some((file) => !file.path || !SHA256.test(file.sha256)) ||
      !filePaths.includes('tools/documentation.lisp')) {
    throw new Error('Common Lisp artifact source provenance is incomplete')
  }
  const hasControl = Array.isArray(artifact.packages) && artifact.packages.some((pkg) => pkg.name === 'libtmux.control')
  const packageContract = PACKAGE_CONTRACT.filter(([name]) => name !== 'libtmux.control' || hasControl)
  if (!Array.isArray(artifact.packages) || artifact.packages.length !== packageContract.length ||
      artifact.packages.some((pkg, index) => {
        const expected = packageContract[index]!
        return pkg.name !== expected[0] || pkg.system !== expected[1] || pkg.product !== expected[2]
      })) {
    throw new Error('Common Lisp public package inventory differs')
  }
  const ids = new Set<string>()
  for (const pkg of artifact.packages) {
    if (!pkg.documentation?.summary || !filePaths.includes(pkg.source?.file) || !Number.isInteger(pkg.source?.line) || pkg.source.line < 1 ||
        !Array.isArray(pkg.symbols) || !pkg.symbols.length) {
      throw new Error(`Common Lisp package metadata is incomplete: ${pkg.name}`)
    }
    for (const symbol of pkg.symbols) {
      if (!symbol.id?.startsWith(`${pkg.name}:`) || ids.has(symbol.id) || !symbol.name ||
          !['function', 'class', 'exception'].includes(symbol.kind) || !symbol.documentation?.summary ||
          !filePaths.includes(symbol.source?.file) || !Number.isInteger(symbol.source?.line) || symbol.source.line < 1 ||
          symbol.kind === 'function' && !symbol.signature ||
          symbol.modifiers.some((modifier) => !['macro', 'opaque'].includes(modifier))) {
        throw new Error(`Invalid Common Lisp public declaration: ${symbol.id}`)
      }
      ids.add(symbol.id)
    }
  }
  for (const pkg of artifact.packages) {
    for (const symbol of pkg.symbols) {
      for (const target of symbol.documentation.seeAlso ?? []) {
        if (!ids.has(target)) throw new Error(`Unresolved Common Lisp cross-reference: ${target}`)
      }
      if (symbol.generic && (!Array.isArray(symbol.methods) || !symbol.methods.length)) {
        throw new Error(`Missing Common Lisp method applicability: ${symbol.id}`)
      }
      for (const method of symbol.methods ?? []) {
        if (!symbol.generic || !method.signature || !Array.isArray(method.qualifiers) ||
            method.qualifiers.some((qualifier) => typeof qualifier !== 'string') ||
            !Array.isArray(method.specializers) || !method.specializers.length ||
            method.specializers.some((target) => target !== 'common-lisp:t' &&
              !artifact.packages.some((owner) => owner.symbols.some((entry) => entry.id === target && entry.kind !== 'function')))) {
          throw new Error(`Invalid Common Lisp method applicability: ${symbol.id}`)
        }
      }
    }
  }
  return artifact
}

/** Adapt an SBCL-native public-package artifact without parsing Common Lisp source. */
export function extractCommonLisp(input: unknown, revision?: string): ApiModel {
  const artifact = assertArtifact(input, revision)
  const source = (location: NativeSource): ApiSymbol['source'] => ({
    ...location, repo: artifact.source.repository, revision: artifact.source.revision,
    extractedRevision: artifact.exporter.revision,
  })
  const symbols: ApiSymbol[] = []
  const names = new Map(artifact.packages.flatMap((pkg) => pkg.symbols
    .map((symbol) => [symbol.id, `${pkg.name}:${symbol.name}`] as const)))
  for (const pkg of artifact.packages) {
    symbols.push({
      id: pkg.name, publicId: pkg.name, qualifiedName: pkg.name, namespace: '', name: pkg.name,
      kind: 'module', modifiers: [], signatures: [], product: pkg.product, package: pkg.system,
      publicOwner: pkg.name, apiScope: 'exported', doc: documentation(pkg.documentation), source: source(pkg.source),
    })
    for (const symbol of pkg.symbols) {
      symbols.push({
        id: symbol.id, publicId: symbol.id, qualifiedName: `${pkg.name}:${symbol.name}`,
        namespace: pkg.name, name: symbol.name, kind: symbol.kind as SymbolKind,
        modifiers: symbol.modifiers as Modifier[], parent: pkg.name,
        signatures: [
          ...(symbol.signature ? [{ raw: symbol.signature, params: parameters(symbol.signature) }] : []),
          ...(symbol.methods ?? []).map((method) => methodSignature(symbol.id, method, names)),
        ],
        product: pkg.product, package: pkg.system, publicOwner: pkg.name, apiScope: 'exported',
        doc: documentation(symbol.documentation), source: source(symbol.source),
        ...(symbol.supertypes?.length ? { extends: [...symbol.supertypes] } : {}),
      })
    }
  }
  return {
    port: 'lisp', repo: artifact.source.repository, revision: artifact.source.revision,
    extractor: `${artifact.exporter.name}/${artifact.exporter.version}`,
    nativeProvenance: {
      files: artifact.source.files.map((file) => ({ ...file })),
      exporter: { ...artifact.exporter, runtime: { ...artifact.runtime }, library: { ...artifact.library } },
    },
    sources: artifact.packages.map((pkg) => ({
      product: pkg.product, package: pkg.system, repo: artifact.source.repository,
      revision: artifact.source.revision, extractedRevision: artifact.exporter.revision,
      version: artifact.library.version,
    })),
    symbols,
  }
}
