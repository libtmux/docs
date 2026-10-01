import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseXmlDoc } from '../doc/csharp.ts'
import type { ApiModel, ApiSymbol, Signature, SymbolKind } from '../model.ts'

interface Declaration {
  id: string
  name: string
  kind: SymbolKind
  parent: string
  file: string
  line: number
  signature: string
  parameters: { name: string; type: string; optional: boolean }[]
  returns: string
  documentation: string
  namespaces: string[]
}

interface FSharpArtifact {
  schema: number
  port: string
  compiler: string
  declarations: Declaration[]
}

/** Convert the native compiler's public signature tree to the shared reference model. */
export function extractFSharpArtifact(input: unknown, revision?: string): ApiModel {
  const artifact = input as FSharpArtifact
  if (artifact?.schema !== 1 || artifact.port !== 'fsharp' ||
      typeof artifact.compiler !== 'string' || !Array.isArray(artifact.declarations) ||
      !artifact.declarations.length) {
    throw new Error('F# compiler artifact has an unsupported schema or no declarations')
  }
  const ids = new Set(artifact.declarations.map((item) => item.id))
  const symbols: ApiSymbol[] = artifact.declarations.map((item) => {
    if (!item.id || !item.name || !item.signature || !item.file || !Number.isInteger(item.line) || item.line < 1) {
      throw new Error(`Incomplete F# declaration: ${item.id}`)
    }
    const parsed = parseXmlDoc(item.documentation)
    const signature: Signature = {
      raw: item.signature,
      params: item.parameters.map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
        ...(parameter.optional ? { default: 'None' } : {}),
        ...(parsed.params.has(parameter.name) ? { doc: parsed.params.get(parameter.name) } : {}),
      })),
      ...(item.returns ? { returns: item.returns } : {}),
      ...(parsed.returnsDoc ? { returnsDoc: parsed.returnsDoc } : {}),
      ...(parsed.raises.length ? { raises: parsed.raises } : {}),
    }
    if (parsed.doc.examples) {
      parsed.doc.examples = parsed.doc.examples.map((example) => ({ ...example, lang: 'fsharp' }))
    }
    return {
      id: item.id,
      name: item.name,
      kind: item.kind,
      parent: ids.has(item.parent) ? item.parent : undefined,
      modifiers: [],
      signatures: [signature],
      namespaceImports: item.namespaces,
      doc: parsed.doc,
      source: { file: item.file, line: item.line },
    }
  })
  const merged = new Map<string, ApiSymbol>()
  for (const symbol of symbols) {
    const previous = merged.get(symbol.id)
    if (!previous) { merged.set(symbol.id, symbol); continue }
    // F# permits a type and its companion module to share a public name.
    if (previous.kind !== 'module' && symbol.kind !== 'module') {
      throw new Error(`Duplicate F# public declaration: ${symbol.id}`)
    }
    if (previous.kind === 'module') previous.kind = symbol.kind
    previous.signatures.push(...symbol.signatures)
    previous.doc ??= symbol.doc
  }
  return {
    port: 'fsharp', revision,
    extractor: `FSharp.Compiler.Service ${artifact.compiler} (public .fsi syntax)`,
    symbols: [...merged.values()],
  }
}

/** Parse .fsi files using the source checkout's SDK and reject compiler errors. */
export function extractFSharp(root: string, revision?: string): ApiModel {
  const projects = readdirSync(root).filter((file) => file.endsWith('.fsproj'))
  if (projects.length !== 1) throw new Error(`Expected one F# project in ${root}`)
  const script = fileURLToPath(new URL('../../scripts/extract-fsharp.fsx', import.meta.url))
  const output = execFileSync('dotnet', ['fsi', '--warnaserror', '--exec', script, join(root, projects[0])], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return extractFSharpArtifact(JSON.parse(output), revision)
}
