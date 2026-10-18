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
  type TypeParameter,
} from '../model.ts'
import { parserFor } from '../parser.ts'
import { parseTypeParameters, splitTopLevel } from '../type-params.ts'

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

/**
 * The entries of a PEP 695 list, `[T: int = str, *Ts, **P]`, as written.
 * The grammar splits a default from its parameter, so the list is read as text.
 */
function typeParameterTexts(node: Node): string[] {
  const list = node.childForFieldName('type_parameters')
  return list ? splitTopLevel(list.text.trim().replace(/^\[|\]$/g, ''), ',') : []
}

/** Strip the quotes of a forward reference: `bound="Foo"` bounds by `Foo`. */
const unquoted = (text: string) => text.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')

/**
 * Module-level `T = TypeVar("T", bound=Foo)` declarations, spelled the way
 * PEP 695 would declare them: `T: Foo`, `*Ts`, `**P`. A class or function that
 * uses the variable is generic in it, and this is where its bound is written.
 */
function typeVarsOf(root: Node): Map<string, string> {
  const found = new Map<string, string>()
  for (const statement of root.namedChildren) {
    const assignment = statement?.type === 'expression_statement' ? statement.namedChild(0) : undefined
    const name = assignment?.type === 'assignment' ? assignment.childForFieldName('left') : undefined
    const call = assignment?.childForFieldName('right')
    const kind = call?.type === 'call' ? /(?:^|\.)(TypeVar|ParamSpec|TypeVarTuple)$/.exec(call.childForFieldName('function')?.text ?? '')?.[1] : undefined
    if (name?.type !== 'identifier' || !kind) continue
    const keywords = new Map<string, string>()
    const constraints: string[] = []
    const args = call!.childForFieldName('arguments')?.namedChildren ?? []
    for (const [position, arg] of args.entries()) {
      if (arg?.type === 'keyword_argument') keywords.set(arg.childForFieldName('name')?.text ?? '', arg.childForFieldName('value')?.text ?? '')
      else if (arg && position > 0) constraints.push(unquoted(arg.text))
    }
    const bound = keywords.has('bound') ? unquoted(keywords.get('bound')!) : constraints.join(' | ')
    const fallback = keywords.get('default')
    found.set(name.text, `${kind === 'ParamSpec' ? '**' : kind === 'TypeVarTuple' ? '*' : ''}${name.text}${bound ? `: ${bound}` : ''}${fallback ? ` = ${unquoted(fallback)}` : ''}`)
  }
  return found
}

/** What a class is generic in: its PEP 695 list, or the variables its `Generic[...]` base or other bases name. */
function classTypeParameters(def: Node, bases: string[], typeVars: Map<string, string>): string[] {
  const own = typeParameterTexts(def)
  if (own.length) return own
  const declared = bases.map((base) => /^(?:[\w.]+\.)?(?:Generic|Protocol)\[([\s\S]+)\]$/.exec(base)?.[1]).find(Boolean)
  const names = declared ? splitTopLevel(declared, ',')
    : [...new Set(bases.join(' ').match(/[A-Za-z_]\w*/g)?.filter((word) => typeVars.has(word)))]
  return names.map((name) => typeVars.get(name.replace(/^\*+/, '')) ?? name)
}

const withTypeParameters = <T extends { typeParams?: string[]; typeParameters?: TypeParameter[] }>(target: T, texts: string[]): T => {
  if (!texts.length) return target
  return Object.assign(target, { typeParams: texts, typeParameters: parseTypeParameters('py', texts) })
}

function signatureOf(fn: Node, ctx: Ctx, parent?: string): Signature {
  const signature: Signature = {
    params: paramsOf(fn.childForFieldName('parameters') ?? fn),
    returns: fn.childForFieldName('return_type')?.text.replace(/\s+/g, ' '),
    typeParams: fn
      .childForFieldName('type_parameters')
      ?.namedChildren.map((n) => n?.text ?? '')
      .filter(Boolean),
  }
  const own = typeParameterTexts(fn)
  // A variable in a signature that no enclosing class binds is bound by the function itself.
  const bound = new Set(ctx.generics.get(parent ?? '') ?? [])
  const used = new Set([...signature.params.map((param) => param.type ?? ''), signature.returns ?? ''].join(' ').match(/[A-Za-z_]\w*/g))
  const implicit = [...ctx.typeVars].filter(([name]) => used.has(name) && !bound.has(name) && !own.some((text) => text.replace(/^\*+/, '').startsWith(name)))
  return withTypeParameters(signature, [...own, ...implicit.map(([, text]) => text)])
}

/** `class` unless it inherits from something whose name ends in `Error`/`Exception`. */
function classKind(bases: string[]): SymbolKind {
  return bases.some((b) => /(Error|Exception)$/.test(b)) ? 'exception' : 'class'
}

interface Ctx {
  file: string
  module: string
  symbols: ApiSymbol[]
  /** Explicit typing bindings in this source scope, never a guessed alias. */
  imports: Record<string, string>
  /** Symbols already emitted, so overloads merge instead of duplicating. */
  byId: Map<string, ApiSymbol>
  /** The file's `TypeVar` declarations, as PEP 695 would write them. */
  typeVars: Map<string, string>
  /** Type variable names each class binds for its members, by class id. */
  generics: Map<string, string[]>
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
  if (Object.keys(ctx.imports).length) sym.imports = { ...ctx.imports }
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

/** Follow explicit typing imports and invalidate an alias when another import binds it. */
function importBindings(node: Node, imports: Record<string, string>): boolean {
  if (!['import_statement', 'import_from_statement'].includes(node.type)) return false
  const from = node.childForFieldName('module_name')?.text
  for (const entry of node.childrenForFieldName('name')) {
    if (!entry) continue
    const name = entry.childForFieldName('name')?.text ?? entry.text
    const alias = entry.childForFieldName('alias')?.text
    const local = alias ?? (from ? name : name.split('.')[0])
    const target = from ? `${from}.${name}` : name
    delete imports[local]
    if (target === 'typing' || target.startsWith('typing.')) imports[local] = target
  }
  return true
}

function walk(node: Node, ctx: Ctx, parent: string | undefined): void {
  for (const child of node.namedChildren) {
    if (!child) continue
    if (importBindings(child, ctx.imports)) continue

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
      const generics = classTypeParameters(def, bases, ctx.typeVars)
      const symbol: ApiSymbol = {
        id,
        name,
        kind: classKind(bases),
        modifiers,
        parent,
        signatures: [],
        doc: parsed?.doc,
        extends: bases.length ? bases : undefined,
        source: { file: ctx.file, line: def.startPosition.row + 1 },
      }
      withTypeParameters(symbol, generics)
      ctx.generics.set(id, [...ctx.generics.get(parent ?? '') ?? [], ...symbol.typeParameters?.map((parameter) => parameter.name) ?? []])
      emit(ctx, symbol)
      walk(def.childForFieldName('body') ?? def, { ...ctx, imports: { ...ctx.imports } }, id)
      delete ctx.imports[name]
      continue
    }

    if (def.type === 'function_definition') {
      const name = def.childForFieldName('name')?.text ?? '?'
      if (!isVisible(name, ctx.options)) continue
      const id = parent ? `${parent}.${name}` : `${ctx.module}.${name}`
      const raw = docstringOf(def.childForFieldName('body'))
      const parsed = raw ? parsePythonDoc(raw) : undefined
      const sig = parsed ? applyDoc(signatureOf(def, ctx, parent), parsed) : signatureOf(def, ctx, parent)
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
      delete ctx.imports[name]
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
        if (target?.type === 'identifier') delete ctx.imports[name]
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
    imports: {},
    byId: new Map(),
    typeVars: typeVarsOf(tree.rootNode),
    generics: new Map(),
    options: { ...DEFAULT_EXTRACT_OPTIONS, ...options },
  }
  walk(tree.rootNode, ctx, undefined)
  return ctx.symbols
}
