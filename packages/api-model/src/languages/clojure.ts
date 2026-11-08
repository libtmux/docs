import { parseMarkdownDocFull } from '../doc/markdown.ts'
import { tokenizeDoc } from '../doc/roles.ts'
import type { ApiModel, ApiSource, ApiSymbol } from '../model.ts'

interface ClojureArtifact {
  schema: string
  port: string
  repo: string
  revision: string
  compiler: string
  extractor: string
  sources: ApiSource[]
  nativeProvenance: NonNullable<ApiModel['nativeProvenance']>
  symbols: (ApiSymbol & { docstring: string })[]
}

/** Preserve compiled public Clojure vars, native arities, hints and authored links. */
export function extractClojure(input: unknown, expectedRevision?: string): ApiModel {
  const artifact = input as ClojureArtifact
  if (artifact?.schema !== 'libtmux.clojure-api/1' || artifact.port !== 'clojure' ||
      !/^[a-f0-9]{40}$/.test(artifact.revision ?? '') ||
      expectedRevision !== undefined && expectedRevision !== artifact.revision) {
    throw new Error('Clojure artifact schema or selected source revision mismatch')
  }
  const sourceFiles = artifact.nativeProvenance?.files
  const exporter = artifact.nativeProvenance?.exporter
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[.-][\w.-]+)?$/.test(artifact.compiler ?? '') ||
      artifact.repo !== 'libtmux/libtmux-java' || !artifact.extractor ||
      !Array.isArray(sourceFiles) || !sourceFiles.length ||
      sourceFiles.some((file) => !file.path || !/^[a-f0-9]{64}$/.test(file.sha256)) ||
      new Set(sourceFiles.map((file) => file.path)).size !== sourceFiles.length ||
      exporter?.name !== 'clojure-public-var-metadata' ||
      typeof exporter.revision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(exporter.revision) ||
      !Array.isArray(exporter.files) || !exporter.files.length ||
      exporter.files.some((file) => !file?.path || !/^[a-f0-9]{64}$/.test(file.sha256))) {
    throw new Error('Clojure artifact requires compiler, source and exporter provenance')
  }
  const packages = new Map<string, string>()
  for (const source of artifact.sources ?? []) {
    const module = /^io\.github\.libtmux:(libtmux-clojure(?:-core-async)?)$/.exec(source.package)?.[1]
    if (!module || source.repo !== artifact.repo || source.revision !== artifact.revision ||
        !source.version || source.product !== 'core' || packages.has(source.package)) {
      throw new Error('Clojure package source identity is invalid')
    }
    packages.set(source.package, module)
  }
  if (!packages.size || !Array.isArray(artifact.symbols) || !artifact.symbols.length) {
    throw new Error('Clojure artifact documents no public packages or declarations')
  }
  const ids = new Set(artifact.symbols.map((symbol) => symbol.id))
  const namespaces = new Set(artifact.symbols.filter((symbol) => symbol.kind === 'module').map((symbol) => symbol.id))
  if (ids.size !== artifact.symbols.length) throw new Error('Clojure public identity is duplicated')
  for (const symbol of artifact.symbols) {
    const namespace = symbol.namespace
    const module = packages.get(symbol.package ?? '')
    if (!namespace || !/^libtmux\.[\w.-]+$/.test(namespace) || !module ||
        !['module', 'function'].includes(symbol.kind) || symbol.apiScope !== 'exported' ||
        symbol.modifiers.includes('private') || symbol.publicOwner !== namespace ||
        symbol.publicId !== symbol.id || symbol.qualifiedName !== symbol.id ||
        symbol.id !== (symbol.kind === 'module' ? namespace : `${namespace}/${symbol.name}`) ||
        symbol.kind === 'function' && (symbol.parent !== namespace || !namespaces.has(namespace))) {
      throw new Error(`Clojure public declaration is invalid: ${symbol.id}`)
    }
    const file = `${module}/src/main/clojure/${namespace.replaceAll('.', '/').replaceAll('-', '_')}.clj`
    if (symbol.source?.file !== file || !sourceFiles.some((entry) => entry.path === file) ||
        !Number.isSafeInteger(symbol.source.line) || (symbol.source.line ?? 0) < 1 ||
        symbol.source.repo !== artifact.repo || symbol.source.revision !== artifact.revision) {
      throw new Error(`Clojure source identity is invalid: ${symbol.id}`)
    }
    if (!symbol.docstring?.trim() || !Array.isArray(symbol.signatures) || !symbol.signatures.length ||
        symbol.signatures.some((signature) => !signature.raw?.endsWith(')') ||
          !(signature.raw.startsWith(`(${symbol.kind === 'module' ? 'ns' : symbol.name} `) || signature.raw === `(${symbol.name})`) ||
          !Array.isArray(signature.params) || signature.params.some((parameter) => !parameter.name))) {
      throw new Error(`Clojure native signature or docstring is absent: ${symbol.id}`)
    }
    for (const reference of tokenizeDoc(symbol.docstring, 'clojure')) {
      if (reference.kind !== 'ref' || !reference.explicit) continue
      if (!ids.has(reference.target) && !ids.has(`${namespace}/${reference.target}`)) {
        throw new Error(`Clojure docstring has an unresolved public reference: ${reference.target}`)
      }
    }
  }
  return {
    port: 'clojure', repo: artifact.repo, revision: artifact.revision,
    extractor: artifact.extractor, sources: artifact.sources, nativeProvenance: artifact.nativeProvenance,
    symbols: artifact.symbols.map(({ docstring, ...symbol }) => {
      const [summary, ...body] = docstring.split('\n')
      return { ...symbol, doc: parseMarkdownDocFull([summary, '', ...body].join('\n'), 'clojure').doc }
    }),
  }
}
