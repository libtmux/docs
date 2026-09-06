import { readFileSync } from 'node:fs'
import type { Node } from 'web-tree-sitter'
import { parseMarkdownDocFull } from '../doc/markdown.ts'
import { parseXmlDoc } from '../doc/csharp.ts'
import { parseJavadoc } from '../doc/javadoc.ts'
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ApiSymbol,
  type ExtractOptions,
  type Modifier,
  type Param,
  type DocBlock,
  type Signature,
  type SymbolKind,
} from '../model.ts'
import { type GrammarName, parserFor } from '../parser.ts'

/**
 * One extractor, five languages, driven by a per-language spec.
 *
 * TypeScript, Rust, Go, Java and C# differ in node names and almost nothing
 * else that matters here: each has a container declaration with a name and a
 * body, member declarations with a name and optionally parameters and a return
 * type, and a doc comment immediately above. Writing five walkers would mean
 * five places for the overload rule, the visibility rule and the id scheme to
 * drift apart — and they are the parts that were hard to get right in Python.
 *
 * Python keeps its own extractor. Its docstring is *inside* the body rather
 * than above the declaration, its visibility rules are three flags rather than
 * a keyword, and `@t.overload` has no equivalent here — abstracting over that
 * would produce a spec with a Python-shaped hole in it.
 */

export interface LanguageSpec {
  grammar: GrammarName
  /**
   * The dialect this language's doc comments are written in.
   *
   * Markdown when unset, which is what Rust, TypeScript and Go write. C# is
   * documentation XML and Java is HTML; both printed their markup into the
   * reference until it was read in the dialect it was written in.
   */
  docDialect?: 'xml' | 'javadoc'
  /**
   * The container kind this language reserves for extension blocks.
   *
   * Rust's `impl Window { … }` declares nothing; it attaches members to a
   * type declared elsewhere, often in another file. The project pass folds
   * such a block onto that type, so naming the kind here is what tells it
   * which containers are blocks rather than declarations.
   */
  extensionKind?: SymbolKind
  /** Declarations that own members: classes, structs, traits, interfaces. */
  containers: Record<string, SymbolKind>
  /** Declarations that are members: methods, fields, properties. */
  members: Record<string, SymbolKind>
  /** Node types whose children should be walked but which own nothing. */
  transparent?: string[]
  /** Comment node types that can carry documentation. */
  commentTypes: string[]
  /**
   * A container the walk should not descend into at all.
   *
   * Rust puts its unit tests in a `#[cfg(test)] mod tests` beside the code, so
   * a walk that treats every module as transparent publishes the test
   * doubles: `RefusingExecutor` and `ComposedSessionExecutor` had pages in the
   * reference and exist only inside `server.rs`'s test module.
   */
  skipNode?: (node: Node) => boolean
  /**
   * Node types that sit between a doc comment and what it documents.
   *
   * Rust writes `#[derive(Clone)]` and `#[must_use = "…"]` under the doc
   * comment and above the item, and the walk up from the declaration stopped
   * at the first sibling that was not a comment. That hid the prose on 488
   * Rust symbols and 188 of its examples: `pub struct Command` documents
   * itself with a runnable example and rendered blank.
   *
   * Only Rust needs this so far. C# writes `[Obsolete]` in the same position
   * but its grammar keeps the attribute inside the declaration, so the walk
   * never sees it.
   */
  attributeTypes?: string[]
  /** Strip a doc comment's markers. Returning undefined rejects the comment. */
  stripDoc: (raw: string) => string | undefined
  /** Keywords or attributes that map to model modifiers. */
  modifiers?: Record<string, Modifier>
  /** True when a declaration is part of the public API. */
  isExported?: (node: Node) => boolean
  /** Fields to read a signature from, when they differ from the defaults. */
  fields?: { name?: string; params?: string; returns?: string; body?: string }
  /**
   * Node types whose name lives in a different field.
   *
   * Rust's `impl Pane { … }` has no `name` — the type it extends is in `type`.
   * Without this the whole block is skipped and every method on every struct
   * disappears, which is exactly what happened: 638 symbols extracted, 96
   * rendered, and no error anywhere.
   */
  nameFields?: Record<string, string>
  /**
   * Normalise a name the grammar reports with syntax attached.
   *
   * Rust's `impl` header parses as a type node, so the name arrived as
   * `&'values SparseValues` — a lifetime and a borrow glued to the type. An
   * inventory record is whitespace-delimited, so a name with a space in it is
   * unrepresentable and the writer rejects it outright.
   */
  cleanName?: (raw: string) => string
  /**
   * The type a member is declared on, when the grammar puts it outside the
   * type's own body.
   *
   * Go writes `func (w *Window) Panes()` at package scope, so without this
   * every method is a free function and no type has members.
   */
  receiverType?: (node: Node) => string | undefined
}

const DEFAULT_FIELDS = { name: 'name', params: 'parameters', returns: 'return_type', body: 'body' }

/**
 * The doc comment attached to a declaration.
 *
 * "Immediately above" is load-bearing: a comment separated by a blank line is
 * a section marker, not documentation, and treating it as documentation
 * attaches a file header to whatever happens to be declared first. tree-sitter
 * gives positions, so the gap is measurable rather than guessed.
 */
function docCommentFor(node: Node, spec: LanguageSpec): string | undefined {
  const lines: string[] = []
  // `export class X {}` puts the declaration inside an `export_statement`, so
  // the doc comment is a sibling of the *wrapper*, not of the class. Walking
  // up through transparent wrappers is the difference between 16% and 80% of
  // TypeScript's symbols being documented — and nothing failed at 16%.
  let anchor: Node = node
  while (
    !anchor.previousNamedSibling &&
    anchor.parent &&
    spec.transparent?.includes(anchor.parent.type)
  ) {
    anchor = anchor.parent
  }
  let cursor: Node | null = anchor.previousNamedSibling
  let expectedRow = anchor.startPosition.row
  // Attributes are part of the declaration, not a break in it, so the doc
  // comment above them still documents it. Adjacency is still required: a
  // comment separated from the attributes by a blank line is a section marker.
  while (cursor && spec.attributeTypes?.includes(cursor.type)) {
    if (cursor.endPosition.row < expectedRow - 1) break
    expectedRow = cursor.startPosition.row
    cursor = cursor.previousNamedSibling
  }
  while (cursor && spec.commentTypes.includes(cursor.type)) {
    if (cursor.endPosition.row < expectedRow - 1) break
    const stripped = spec.stripDoc(cursor.text)
    if (stripped === undefined) {
      // A comment the language does not count as documentation, sitting
      // between a declaration and its doc comment. libtmux-ts writes
      // `// eslint-disable-next-line` there, and the directive has to stay on
      // the line above the class for the suppression to apply — so the doc
      // comment cannot move down past it, and `Pane` had no summary.
      //
      // Only before any documentation has been collected. A plain comment
      // *above* a doc block belongs to whatever is above it, not to this.
      if (lines.length) break
      expectedRow = cursor.startPosition.row
      cursor = cursor.previousNamedSibling
      continue
    }
    lines.unshift(stripped)
    expectedRow = cursor.startPosition.row
    cursor = cursor.previousNamedSibling
  }
  const text = lines.join('\n').trim()
  return text || undefined
}

/** Modifier keywords sitting as unnamed children of a declaration. */
function modifiersFor(node: Node, spec: LanguageSpec): Modifier[] {
  if (!spec.modifiers) return []
  const found = new Set<Modifier>()
  for (const child of node.children) {
    if (!child) continue
    // `modifiers` in Java/C#, bare keywords elsewhere, attributes in Rust.
    const text = child.type === 'modifiers' || child.type === 'modifier' ? child.text : child.type
    for (const [keyword, modifier] of Object.entries(spec.modifiers)) {
      if (text === keyword || text.includes(keyword)) found.add(modifier)
    }
  }
  return [...found]
}

function paramsOf(node: Node | null): Param[] {
  if (!node) return []
  const out: Param[] = []
  for (const child of node.namedChildren) {
    if (!child) continue
    if (child.type === 'comment') continue
    const name = child.childForFieldName('name') ?? child.childForFieldName('pattern')
    const type = child.childForFieldName('type')
    const value = child.childForFieldName('value') ?? child.childForFieldName('default_value')
    // Go groups parameters — `a, b string` is one node with two names — and a
    // receiver has no name at all. Falling back to the node's own text keeps
    // both readable instead of emitting an empty row.
    const label = name?.text ?? child.text.split(/[\s:]/)[0]
    if (!label) continue
    out.push({
      name: label.replace(/^[&*]+/, ''),
      type: type?.text.replace(/\s+/g, ' '),
      default: value?.text,
    })
  }
  return out
}

function signatureOf(node: Node, spec: LanguageSpec): Signature {
  const f = { ...DEFAULT_FIELDS, ...spec.fields }
  const returns =
    node.childForFieldName(f.returns) ??
    node.childForFieldName('result') ??
    node.childForFieldName('type')
  return {
    params: paramsOf(node.childForFieldName(f.params)),
    // A grammar's return-type node often includes the syntax that introduces
    // it: TypeScript's `type_annotation` is `: string`, and all 240 of its
    // signatures rendered as `foo() → : string`. The arrow or colon is the
    // renderer's to draw.
    returns: returns?.text.replace(/\s+/g, ' ').replace(/^\s*(?:->|:)\s*/, ''),
    typeParams: node
      .childForFieldName('type_parameters')
      ?.namedChildren.map((n) => n?.text ?? '')
      .filter(Boolean),
  }
}

interface Ctx {
  file: string
  module: string
  symbols: ApiSymbol[]
  byId: Map<string, ApiSymbol>
  spec: LanguageSpec
  options: Required<ExtractOptions>
}

function emit(ctx: Ctx, sym: ApiSymbol): void {
  const existing = ctx.byId.get(sym.id)
  if (!existing) {
    ctx.byId.set(sym.id, sym)
    ctx.symbols.push(sym)
    return
  }
  // Same name twice in one scope is an overload set — Java, C# and C++ all
  // spell it this way, and rendering only the first is wrong invisibly.
  existing.signatures.push(...sym.signatures)
  if (sym.doc && !existing.doc) existing.doc = sym.doc
  if (!existing.modifiers.includes('overload')) existing.modifiers.push('overload')
}

function walk(node: Node, ctx: Ctx, parent: string | undefined): void {
  for (const child of node.namedChildren) {
    if (!child) continue
    const { spec } = ctx
    const f = { ...DEFAULT_FIELDS, ...spec.fields }

    if (spec.transparent?.includes(child.type)) {
      if (spec.skipNode?.(child)) continue
      walk(child, ctx, parent)
      continue
    }

    const containerKind = spec.containers[child.type]
    const memberKind = spec.members[child.type]
    if (!containerKind && !memberKind) {
      // Namespaces, blocks and export wrappers own no symbols but contain them.
      if (child.namedChildCount > 0 && !spec.commentTypes.includes(child.type)) {
        walk(child, ctx, parent)
      }
      continue
    }

    const nameField = spec.nameFields?.[child.type] ?? f.name
    let nameNode = child.childForFieldName(nameField) ?? child.childForFieldName('declarator')
    // A declarator is `NAME = initialiser`, not a name. Taking its whole text
    // produced symbols called
    // `ControlProtocol.DEFAULT_MAX_REPLY_BYTES = 16 * 1024 * 1024` — which is
    // wrong on its own, and additionally unrepresentable in `objects.inv`,
    // whose records are whitespace-delimited. Two Java symbols vanished from
    // the inventory that way, and the inventory is how it was noticed.
    if (nameNode && nameNode.type.endsWith('declarator')) {
      nameNode = nameNode.childForFieldName('name') ?? nameNode
    }
    const rawName = nameNode?.text?.replace(/[<(].*$/, '').trim()
    const name = rawName ? (spec.cleanName?.(rawName) ?? rawName) : rawName
    if (!name) continue
    if (!ctx.options.privateMembers && spec.isExported && !spec.isExported(child)) continue

    const id = parent ? `${parent}.${name}` : `${ctx.module}.${name}`
    const raw = docCommentFor(child, spec)
    const modifiers = modifiersFor(child, spec)

    if (containerKind) {
      emit(ctx, {
        id,
        name,
        kind: containerKind,
        modifiers,
        parent,
        signatures: [],
        doc: docFor(raw, spec, []),
        source: { file: ctx.file, line: child.startPosition.row + 1 },
      })
      const body = child.childForFieldName(f.body) ?? child
      walk(body, ctx, id)
      continue
    }

    const hasParams = Boolean(child.childForFieldName(f.params))
    // A receiver re-homes the member onto its type, which lives in the same
    // module — Go's package — even when it is declared in another file.
    const receiver = spec.receiverType?.(child)
    const owner = receiver ? `${ctx.module}.${receiver}` : parent
    const memberId = receiver ? `${owner}.${name}` : id
    // A "method" with no owner is a free function. Rust spells both
    // `function_item`, so the spec cannot tell them apart — only the presence
    // of an enclosing `impl` or `trait` can, and that is known here. 85 Rust
    // functions in `mod` blocks were reported as ownerless methods.
    const resolvedKind: SymbolKind =
      memberKind === 'method' && !owner ? 'function' : memberKind
    // Built before the doc so C#'s `<param>` and `<exception>` can be lifted
    // onto it: the comment carries them, and nothing else does.
    const memberSignatures = hasParams ? [signatureOf(child, spec)] : []
    emit(ctx, {
      id: memberId,
      name,
      kind: resolvedKind,
      modifiers,
      parent: owner,
      signatures: memberSignatures,
      type: hasParams ? undefined : child.childForFieldName('type')?.text.replace(/\s+/g, ' '),
      value: hasParams
        ? undefined
        : child.childForFieldName('declarator')?.childForFieldName('value')?.text.replace(/\s+/g, ' '),
      doc: docFor(raw, spec, memberSignatures),
      source: { file: ctx.file, line: child.startPosition.row + 1 },
    })
  }
}

/**
 * A doc comment to a doc block, in the spelling this language uses.
 *
 * C# is XML and Java is HTML, and treating either as prose printed every tag.
 * C# is also the only one here whose comment carries parameter and exception
 * documentation inline, so those are lifted onto the signature the way
 * Python's NumPy sections already are.
 *
 * The dialect is declared on the spec rather than tested for by grammar name,
 * so adding a port that documents in markup is a field rather than a branch.
 */
function docFor(
  raw: string | undefined,
  spec: LanguageSpec,
  signatures: Signature[],
): DocBlock | undefined {
  if (!raw) return undefined
  const parse =
    spec.docDialect === 'xml'
      ? parseXmlDoc
      : spec.docDialect === 'javadoc'
        ? parseJavadoc
        : (text: string) => parseMarkdownDocFull(text, spec.grammar)
  const { doc, params, returnsDoc, raises } = parse(raw)

  const sig = signatures[0]
  if (sig) {
    for (const param of sig.params) {
      const text = params.get(param.name)
      if (text) param.doc = text
    }
    if (returnsDoc) sig.returnsDoc = returnsDoc
    if (raises.length) sig.raises = raises
  }
  return doc
}

/** Extract one file using a language spec. */
export async function extractWithSpec(
  spec: LanguageSpec,
  file: string,
  module: string,
  options: ExtractOptions = {},
): Promise<ApiSymbol[]> {
  const parser = await parserFor(spec.grammar)
  const tree = parser.parse(readFileSync(file, 'utf8'))
  if (!tree) return []
  const ctx: Ctx = {
    file,
    module,
    symbols: [],
    byId: new Map(),
    spec,
    options: { ...DEFAULT_EXTRACT_OPTIONS, ...options },
  }
  walk(tree.rootNode, ctx, undefined)
  return ctx.symbols
}
