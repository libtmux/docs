import { readFileSync } from 'node:fs'
import type { Node } from 'web-tree-sitter'
import { applyDoc, parsePythonDoc } from '../doc/python.ts'
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ApiSymbol,
  type ExtractOptions,
  type Modifier,
  type Param,
  type Signature,
  type SymbolKind,
} from '../model.ts'
import { parserFor } from '../parser.ts'

/**
 * Python extraction.
 *
 * The first port, and the reference one: its output is diffed against what
 * gp-sphinx already publishes for libtmux-python, so "does the model carry
 * enough to render the house style" has a real answer rather than an opinion.
 *
 * Two things here are not obvious from the grammar:
 *
 * **Overloads.** `@t.overload` produces two or three `function_definition`
 * nodes with the same name, `...` bodies and no docstring, followed by the
 * real implementation which carries the docs. A reference that renders the
 * first of those is wrong and looks right — `capture_pane` in libtmux-python
 * is exactly this shape. They are grouped onto one symbol with several
 * signatures, which is what autodoc does.
 *
 * **Decorators are the only source of modifiers.** tree-sitter reports the
 * decorator text, not its meaning, so `@property`, `@staticmethod` and
 * `@t.overload` are matched by name — including the dotted form, since a
 * module alias (`import typing as t`) is by far the common case here.
 */

const DECORATOR_MODIFIER: Record<string, Modifier> = {
  staticmethod: 'static',
  classmethod: 'classmethod',
  abstractmethod: 'abstract',
  overload: 'overload',
  deprecated: 'deprecated',
}

/** Last dotted segment of a decorator: `@t.overload` -> `overload`. */
function decoratorName(node: Node): string {
  const inner = node.namedChild(0)
  const text = (inner ?? node).text.replace(/^@/, '')
  return text.split('(')[0].split('.').pop()?.trim() ?? ''
}

/** The docstring node of a function/class body, when it opens with one. */
function docstringOf(body: Node | null): string | undefined {
  const first = body?.namedChild(0)
  if (first?.type !== 'expression_statement') return undefined
  const str = first.namedChild(0)
  return str?.type === 'string' ? str.text : undefined
}

function paramsOf(node: Node): Param[] {
  const out: Param[] = []
  let keywordOnly = false
  for (const p of node.namedChildren) {
    if (!p) continue
    // A bare `*` opens the keyword-only section; `*args` both opens it and is
    // itself a parameter.
    if (p.type === 'list_splat_pattern' && !p.namedChild(0)) {
      keywordOnly = true
      continue
    }
    if (p.text === '*') {
      keywordOnly = true
      continue
    }
    const variadic =
      p.type === 'list_splat_pattern' ? 'positional'
      : p.type === 'dictionary_splat_pattern' ? 'keyword'
      : undefined
    if (variadic === 'positional') keywordOnly = true

    const name = p.childForFieldName('name') ?? p.namedChild(0) ?? p
    const type = p.childForFieldName('type')
    const value = p.childForFieldName('value')
    const label = (name.text || p.text).replace(/^\*+/, '')
    if (!label || label === '/') continue
    out.push({
      name: label,
      type: type?.text.replace(/\s+/g, ' '),
      default: value?.text,
      variadic,
      keywordOnly: keywordOnly && !variadic ? true : undefined,
    })
  }
  return out
}

function signatureOf(fn: Node): Signature {
  return {
    params: paramsOf(fn.childForFieldName('parameters') ?? fn),
    returns: fn.childForFieldName('return_type')?.text.replace(/\s+/g, ' '),
    typeParams: fn
      .childForFieldName('type_parameters')
      ?.namedChildren.map((n) => n?.text ?? '')
      .filter(Boolean),
  }
}

/** `class` unless it inherits from something whose name ends in `Error`/`Exception`. */
function classKind(bases: string[]): SymbolKind {
  return bases.some((b) => /(Error|Exception)$/.test(b)) ? 'exception' : 'class'
}

interface Ctx {
  file: string
  module: string
  symbols: ApiSymbol[]
  /** Symbols already emitted, so overloads merge instead of duplicating. */
  byId: Map<string, ApiSymbol>
  options: Required<ExtractOptions>
}

/**
 * autodoc's visibility rules, which are three separate flags rather than one.
 *
 * `_name` is private, `__name__` is special, and `__name` is neither — it is
 * name-mangled and autodoc never shows it. Collapsing the first two into "has
 * an underscore" is what made the first pass miss 195 members and hide five
 * dunders the reference should carry.
 */
function isVisible(name: string, options: Required<ExtractOptions>): boolean {
  if (/^__\w+__$/.test(name)) return options.specialMembers
  if (name.startsWith('__')) return false
  if (name.startsWith('_')) return options.privateMembers
  return true
}

function emit(ctx: Ctx, sym: ApiSymbol): void {
  const existing = ctx.byId.get(sym.id)
  if (!existing) {
    ctx.byId.set(sym.id, sym)
    ctx.symbols.push(sym)
    return
  }
  // Same name again: an overload set. Keep every signature, and let the
  // documented one win for prose — the implementation carries the docstring
  // and the stubs do not.
  existing.signatures.push(...sym.signatures)
  if (sym.doc && !existing.doc) existing.doc = sym.doc
  if (!sym.modifiers.includes('overload')) {
    existing.modifiers = existing.modifiers.filter((m) => m !== 'overload')
    existing.source = sym.source
  }
}

function walk(node: Node, ctx: Ctx, parent: string | undefined): void {
  for (const child of node.namedChildren) {
    if (!child) continue

    const decorated = child.type === 'decorated_definition'
    const def = decorated ? child.childForFieldName('definition') : child
    if (!def) continue

    const decorators = decorated
      ? child.namedChildren.filter((n) => n?.type === 'decorator').map((n) => decoratorName(n!))
      : []
    const modifiers = decorators
      .map((d) => DECORATOR_MODIFIER[d])
      .filter((m): m is Modifier => Boolean(m))

    if (def.type === 'class_definition') {
      const name = def.childForFieldName('name')?.text ?? '?'
      const id = parent ? `${parent}.${name}` : `${ctx.module}.${name}`
      const bases =
        def
          .childForFieldName('superclasses')
          ?.namedChildren.map((n) => n?.text ?? '')
          .filter(Boolean) ?? []
      const raw = docstringOf(def.childForFieldName('body'))
      const parsed = raw ? parsePythonDoc(raw) : undefined
      emit(ctx, {
        id,
        name,
        kind: classKind(bases),
        modifiers,
        parent,
        signatures: [],
        doc: parsed?.doc,
        extends: bases.length ? bases : undefined,
        source: { file: ctx.file, line: def.startPosition.row + 1 },
      })
      walk(def.childForFieldName('body') ?? def, ctx, id)
      continue
    }

    if (def.type === 'function_definition') {
      const name = def.childForFieldName('name')?.text ?? '?'
      if (!isVisible(name, ctx.options)) continue
      const id = parent ? `${parent}.${name}` : `${ctx.module}.${name}`
      const raw = docstringOf(def.childForFieldName('body'))
      const parsed = raw ? parsePythonDoc(raw) : undefined
      const sig = parsed ? applyDoc(signatureOf(def), parsed) : signatureOf(def)
      const kind: SymbolKind =
        decorators.includes('property') ? 'property' : parent ? 'method' : 'function'
      const isAsync = def.children.some((c) => c?.type === 'async' || c?.text === 'async')
      emit(ctx, {
        id,
        name,
        kind,
        modifiers: isAsync ? [...modifiers, 'async'] : modifiers,
        parent,
        signatures: [sig],
        doc: parsed?.doc,
        source: { file: ctx.file, line: def.startPosition.row + 1 },
      })
      continue
    }

    // `name: type = value` at class or module level. This is where a
    // dataclass's fields live, and `Obj` in libtmux/neo.py has 198 of them —
    // the bulk of what `:inherited-members:` puts on every Pane page.
    if (child.type === 'expression_statement') {
      const assign = child.namedChild(0)
      if (assign?.type === 'assignment') {
        // PEP 258: a bare string literal on the line after an assignment
        // documents it. Sphinx reads these and we did not, so every such
        // attribute reached the reference as a name with an empty body —
        // `child_id_attribute` renders "Unique child ID used by
        // TmuxRelationalObject" upstream and rendered nothing here.
        const kids = node.namedChildren
        const next = kids[kids.indexOf(child) + 1]
        const attrDoc =
          next?.type === 'expression_statement' && next.namedChild(0)?.type === 'string'
            ? next.namedChild(0)?.text
            : undefined
        const target = assign.childForFieldName('left')
        const type = assign.childForFieldName('type')
        const value = assign.childForFieldName('right')
        const name = target?.text ?? ''
        if (target?.type === 'identifier' && isVisible(name, ctx.options)) {
          const id = parent ? `${parent}.${name}` : `${ctx.module}.${name}`
          emit(ctx, {
            id,
            name,
            kind: parent ? 'attribute' : 'constant',
            modifiers: [],
            parent,
            signatures: [],
            type: type?.text.replace(/\s+/g, ' '),
            value: value?.text,
            doc: attrDoc ? parsePythonDoc(attrDoc).doc : undefined,
            source: { file: ctx.file, line: child.startPosition.row + 1 },
          })
        }
      }
      continue
    }

    if (child.type === 'block') walk(child, ctx, parent)
  }
}

/** Extract one Python file. `module` is its dotted name, e.g. `libtmux.pane`. */
export async function extractPython(
  file: string,
  module: string,
  options: ExtractOptions = {},
): Promise<ApiSymbol[]> {
  const parser = await parserFor('python')
  const tree = parser.parse(readFileSync(file, 'utf8'))
  if (!tree) return []
  const ctx: Ctx = {
    file,
    module,
    symbols: [],
    byId: new Map(),
    options: { ...DEFAULT_EXTRACT_OPTIONS, ...options },
  }
  walk(tree.rootNode, ctx, undefined)
  return ctx.symbols
}
