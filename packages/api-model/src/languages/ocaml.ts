import type { ApiModel, ApiSymbol } from '../model.ts'

interface OcamlArtifact extends ApiModel {
  schema: string
  compiler: string
}

const roots: Readonly<Record<string, string>> = {
  Libtmux: 'libtmux', Libtmux_workspace: 'libtmux-workspace', Libtmux_json: 'libtmux-json',
  Libtmux_unix: 'libtmux-unix', Libtmux_eio: 'libtmux-eio',
}

/** Adapt the native public .cmti export without parsing OCaml as another language. */
export function extractOcamlArtifact(input: unknown, revision?: string): ApiModel {
  const artifact = input as OcamlArtifact
  if (artifact?.schema !== 'libtmux.ocaml-api/1' || artifact.port !== 'ocaml' ||
      artifact.compiler !== '5.5.2' || !/^[a-f0-9]{40}$/.test(artifact.revision ?? '') ||
      revision !== undefined && revision !== artifact.revision) {
    throw new Error('OCaml artifact schema, compiler or library revision mismatch')
  }
  const exporterRevision = artifact.nativeProvenance?.exporter.revision
  if (typeof exporterRevision !== 'string' || !/^[a-f0-9]{40}$/.test(exporterRevision) ||
      !artifact.nativeProvenance?.files.length || !Array.isArray(artifact.symbols) || !artifact.symbols.length) {
    throw new Error('OCaml artifact requires committed exporter and public input provenance')
  }
  const ids = new Set(artifact.symbols.map((symbol) => symbol.id))
  if (ids.size !== artifact.symbols.length) throw new Error('Duplicate OCaml public identity')
  for (const symbol of artifact.symbols) {
    const root = symbol.id.split('.')[0]!
    if (!roots[root] || symbol.id.includes('__') || symbol.package !== roots[root] ||
        symbol.apiScope !== 'exported' || symbol.publicOwner !== root || symbol.publicId !== symbol.id ||
        !symbol.qualifiedName || !symbol.name || symbol.parent && !ids.has(symbol.parent)) {
      throw new Error(`Invalid OCaml public declaration: ${symbol.id}`)
    }
    if (!['core', 'workspace'].includes(symbol.product ?? '')) throw new Error('Unsupported OCaml product')
    if (!/^(lib|unix|eio|json|workspace)\/\w+\.mli$/.test(symbol.source.file) ||
        !Number.isInteger(symbol.source.line) || (symbol.source.line ?? 0) < 1 ||
        symbol.source.revision !== artifact.revision) {
      throw new Error(`Invalid OCaml source identity: ${symbol.id}`)
    }
    if (symbol.exportedFrom && !ids.has(symbol.exportedFrom)) throw new Error('Unresolved OCaml public alias')
    if (!Array.isArray(symbol.signatures) || symbol.signatures.some((signature) =>
      !signature.raw || signature.params.some((param) => param.default !== undefined))) {
      throw new Error(`Invalid OCaml native signature: ${symbol.id}`)
    }
  }
  return {
    port: 'ocaml', revision: artifact.revision, repo: artifact.repo, sources: artifact.sources,
    extractor: artifact.extractor, nativeProvenance: artifact.nativeProvenance,
    symbols: artifact.symbols.map((symbol): ApiSymbol => ({ ...symbol })),
  }
}
