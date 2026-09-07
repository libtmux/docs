import { readFileSync } from 'node:fs'
import type { ApiSymbol, Modifier, Param, Signature, SymbolKind } from '../model.ts'
import { parseMarkdownDocFull } from '../doc/markdown.ts'

/**
 * Swift from its compiler's own symbol graph, not from tree-sitter.
 *
 * `swift build -Xswiftc -emit-symbol-graph` produces a resolved model that the
 * grammar cannot: the Swift tree-sitter grammar mis-parses 50 of this port's
 * 91 files (2.84% of bytes), and the two constructs it loses are the two this
 * codebase leans on — typed throws, `func f() async throws(TmuxError) -> R`,
 * and `switch try await g()`, which parse individually and fail together.
 *
 * The graph also arrives with cross-references already resolved. Every
 * `typeIdentifier` fragment carries a `preciseIdentifier` — the USR of the
 * type it names — so linking a return type to its own page needs no name
 * matching and cannot be ambiguous. That is strictly better than what the
 * tree-sitter ports get, and it is why the model keeps `publicId` separate
 * from `id`: the USR is the key, the path is the anchor.
 */

const KIND: Record<string, SymbolKind> = {
  'swift.class': 'class',
  'swift.struct': 'struct',
  'swift.enum': 'enum',
  'swift.protocol': 'interface',
  'swift.method': 'method',
  'swift.type.method': 'method',
  'swift.init': 'method',
  'swift.property': 'property',
  'swift.type.property': 'property',
  'swift.typealias': 'typealias',
  'swift.enum.case': 'constant',
  'swift.func': 'function',
  'swift.func.op': 'function',
  'swift.var': 'constant',
}

interface Fragment {
  kind: string
  spelling: string
  preciseIdentifier?: string
}

interface RawSymbol {
  identifier: { precise: string }
  kind: { identifier: string }
  names: { title: string; subHeading?: Fragment[] }
  pathComponents: string[]
  docComment?: { lines: { text: string }[] }
  accessLevel?: string
  location?: { uri?: string; position?: { line?: number } }
  functionSignature?: {
    parameters?: { name: string; internalName?: string; declarationFragments?: Fragment[] }[]
    returns?: Fragment[]
  }
  swiftExtension?: { extendedModule?: string }
  declarationFragments?: Fragment[]
}

const fragmentText = (fragments: Fragment[] | undefined): string | undefined =>
  fragments?.map((f) => f.spelling).join('').replace(/\s+/g, ' ').trim() || undefined

function modifiersOf(raw: RawSymbol): Modifier[] {
  const out: Modifier[] = []
  const sub = raw.names.subHeading ?? []
  const keywords = new Set(sub.filter((f) => f.kind === 'keyword').map((f) => f.spelling))
  if (keywords.has('async')) out.push('async')
  if (keywords.has('static') || keywords.has('class')) out.push('static')
  if (raw.kind.identifier.startsWith('swift.type.')) out.push('static')
  if (raw.accessLevel && raw.accessLevel !== 'public' && raw.accessLevel !== 'open') {
    out.push('private')
  }
  return [...new Set(out)]
}

function signatureOf(raw: RawSymbol): Signature | undefined {
  const fn = raw.functionSignature
  if (!fn) return undefined
  const params: Param[] = (fn.parameters ?? []).map((p) => ({
    name: p.name,
    type: fragmentText(p.declarationFragments)?.replace(/^[^:]*:\s*/, ''),
  }))
  return {
    params,
    returns: fragmentText(fn.returns),
    // Typed throws lives in the subHeading rather than in functionSignature —
    // `throws(TmuxError)` — and it is the construct tree-sitter loses, so it
    // is lifted out deliberately rather than left in the signature text.
    raises: (() => {
      const sub = raw.names.subHeading ?? []
      const i = sub.findIndex((f) => f.kind === 'keyword' && f.spelling === 'throws')
      if (i === -1) return undefined
      const thrown = sub.slice(i + 1).find((f) => f.kind === 'typeIdentifier')
      return thrown ? [{ type: thrown.spelling }] : undefined
    })(),
  }
}

/**
 * Read one or more `*.symbols.json` files into the model.
 *
 * `memberOf` relationships carry the hierarchy, but `pathComponents` says the
 * same thing and is already per-symbol, so ownership is derived from the path
 * and the relationships are used only for what the path cannot express —
 * protocol conformance.
 */
/** Conformance display names for one symbol, deduped, in the graph's order. */
function conformedNames(
  conformances: Map<string, Map<string, string>>,
  usr: string,
): string[] | undefined {
  const found = conformances.get(usr)
  return found?.size ? [...found.values()] : undefined
}

export function extractSymbolGraph(files: string[]): ApiSymbol[] {
  const symbols: ApiSymbol[] = []
  // Ids must be unique within a port — anchors, permalinks and any projection
  // keyed on them depend on it. Swift ids come from the graph's title path,
  // which omits parameter types, so every overload of a name collapses onto
  // one id: `FilterOperator.equals(_:)` appeared six times. The USR in
  // `identifier.precise` distinguishes them, but disambiguating the id would
  // produce six entries for what is one method. Merging is what the reference
  // should show, and it is what the other seven ports already do.
  const byId = new Map<string, ApiSymbol>()
  /* Keyed on the target USR so a repeated conformance collapses; the value
   * is the display name. Insertion order is the graph's order. */
  const conformances = new Map<string, Map<string, string>>()

  for (const file of files) {
    const graph = JSON.parse(readFileSync(file, 'utf8')) as {
      symbols: RawSymbol[]
      relationships?: {
        kind: string
        source: string
        target: string
        targetFallback?: string
        sourceOrigin?: { identifier: string; displayName: string }
      }[]
    }

    const titleOf = new Map(graph.symbols.map((s) => [s.identifier.precise, s.pathComponents]))
    const origins = new Map((graph.relationships ?? [])
      .filter((relationship) => relationship.kind === 'memberOf' && relationship.sourceOrigin)
      .map((relationship) => [relationship.source, relationship.sourceOrigin!.displayName]))
    for (const rel of graph.relationships ?? []) {
      if (rel.kind !== 'conformsTo') continue
      // A target outside this graph — every standard library protocol — is
      // absent from `titleOf`, so this used to fall back to `target`, which is
      // a mangled USR: `Bases:` rendered `s:s8CopyableP` and `s:SH` instead of
      // `Copyable` and `Hashable`, and nothing could link them. The format
      // answers this itself. `targetFallback` spells the qualified name, and
      // the graph populates it on exactly the relationships `titleOf` cannot
      // resolve. Drop its module so the result matches what `titleOf` yields
      // for a local symbol — the form `BUILTINS.swift` and the symbol index
      // are both keyed on.
      const name =
        titleOf.get(rel.target)?.join('.') ??
        rel.targetFallback?.replace(/^[A-Za-z_][A-Za-z0-9_]*\./, '') ??
        rel.target
      // The graph lists some conformances twice — `Sendable` and
      // `SendableMetatype` arrive once directly and once through another
      // protocol. Two distinct USRs never share a name, so the USR is the
      // right key to collapse on.
      const list = conformances.get(rel.source) ?? new Map<string, string>()
      if (!list.has(rel.target)) list.set(rel.target, name)
      conformances.set(rel.source, list)
    }

    for (const raw of graph.symbols) {
      const kind = KIND[raw.kind.identifier]
      if (!kind) continue
      // `internal` and `private` are not API. The graph reports them when the
      // build emits them, and a public reference must not.
      if (raw.accessLevel && !['public', 'open'].includes(raw.accessLevel)) continue

      const path = raw.pathComponents
      const id = path.join('.')
      const doc = raw.docComment?.lines.map((l) => l.text).join('\n').trim()
      const signature = signatureOf(raw)
      // Swift doc comments are Markdown, and this used to split on the first
      // blank line and keep the rest as one string — the same thing the spec
      // extractor did before `parseMarkdownDocFull`, and with the same result:
      // 76 fenced blocks never became examples and four reached the page as
      // literal ``` fences inside a paragraph.
      const parsed = doc ? parseMarkdownDocFull(doc, 'swift') : undefined
      const source: ApiSymbol['source'] = {
        file: (raw.location?.uri ?? '').replace(/^file:\/\//, ''),
        ...(raw.location?.uri && raw.location.position?.line !== undefined
          ? { line: raw.location.position.line + 1 } : {}),
      }
      const inheritedFrom = source.file ? undefined : origins.get(raw.identifier.precise)

      const existing = byId.get(id)
      if (existing) {
        // An overload set. Keep every signature, and let the documented one
        // supply the prose — Swift's generated `==`/`!=` pairs carry none.
        if (signature) existing.signatures.push(signature)
        if (parsed && !existing.doc) existing.doc = parsed.doc
        if (!existing.source.file && source.file) {
          existing.source = source
          delete existing.inheritedFrom
        } else if (!existing.source.file && inheritedFrom) {
          existing.inheritedFrom ??= inheritedFrom
        }
        if (existing.signatures.length > 1 && !existing.modifiers.includes('overload')) {
          existing.modifiers.push('overload')
        }
        continue
      }

      const sym: ApiSymbol = {
        id,
        publicId: id,
        name: path.at(-1) ?? raw.names.title,
        kind,
        modifiers: modifiersOf(raw),
        parent: path.length > 1 ? path.slice(0, -1).join('.') : undefined,
        signatures: signature ? [signature] : [],
        type: signature ? undefined : fragmentText(raw.names.subHeading),
        doc: parsed?.doc,
        extends: conformedNames(conformances, raw.identifier.precise),
        source,
        inheritedFrom,
      }
      byId.set(id, sym)
      symbols.push(sym)
    }
  }

  return symbols
}
