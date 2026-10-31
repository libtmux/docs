import type { ApiSymbol } from '@libtmux/api-model'

/**
 * How each language's own documentation writes a symbol in prose.
 *
 * A reader brings the habits of rustdoc, pkg.go.dev, rubydoc, Javadoc, Microsoft Learn, cppreference or DocC. A
 * symbol written the way that tool writes it reads at a glance, and one rule for every language reads as translated.
 * `writtenForm` takes the label an author gave a link to a declaration and returns the visible text. The accessible
 * name is that same text.
 *
 * - A type is its name, with the language's qualifier between the parts of its path: `::` in Rust, C++ and Ruby, `.`
 *   elsewhere. It is never a call.
 * - A method or function is a call in Python, Java, C#, C++, TypeScript, Rust and Lua (`kill()`), and a bare name in
 *   Ruby, Go, Kotlin, Scala, F# and Julia. Swift writes the DocC full name, which carries its argument labels. A
 *   Ruby instance method is `Server#list_sessions` and a class method `Server.find`; a Lua method is
 *   `server:list_sessions()` and a module function `libtmux.new()`.
 * - A property or field is never a call. A Java record accessor or getter is a method, so it keeps its parentheses.
 * - An enum member is written the way the language writes one: `Direction::Up`, `Direction.UP`, `Direction.Up`,
 *   `.up` on its owner's page in Swift and `Direction.up` elsewhere, `tmux.DirectionUp` in Go, `:up` in Ruby and
 *   Elixir, `"up"` in Lua and the instance `Up` in Julia.
 * - An environment variable is a bare literal: `LIBTMUX_SOCKET`. A shell's `$` before an upper-case name is dropped, and
 *   the sigils of other shells (`$env:`, `%X%`) belong to examples.
 * - A command is never a call: `new-session`, `monitor-activity`, `tmuxp load`. So is an MCP tool, which a client names
 *   on the wire and does not call by that name: `snapshot_pane`.
 *
 * Elixir writes `name/arity` and PowerShell invokes a cmdlet by name, so both are left as written.
 */
export type FormKind = 'type' | 'method' | 'function' | 'property' | 'enum-member' | 'environment' | 'command'

const TYPES: ReadonlySet<string> = new Set(['class', 'interface', 'struct', 'union', 'enum', 'trait', 'typealias', 'exception', 'module'])

interface Language {
  /** Between the parts of a type's path, and before a member that no rule of its own names. */
  qualifier: '.' | '::'
  /** A method or function reads as a call: `kill()`. */
  call: boolean
}

/** Every port. A language missing here is a failure of this table, and the test requires one entry per port. */
export const FORMS: Record<string, Language | 'as-written'> = {
  py: { qualifier: '.', call: true },
  ts: { qualifier: '.', call: true },
  rs: { qualifier: '::', call: true },
  go: { qualifier: '.', call: false },
  java: { qualifier: '.', call: true },
  csharp: { qualifier: '.', call: true },
  cxx: { qualifier: '::', call: true },
  swift: { qualifier: '.', call: false },
  kotlin: { qualifier: '.', call: false },
  scala: { qualifier: '.', call: false },
  fsharp: { qualifier: '.', call: false },
  julia: { qualifier: '.', call: false },
  ruby: { qualifier: '::', call: false },
  lua: { qualifier: '.', call: true },
  elixir: 'as-written',
  powershell: 'as-written',
}

/** The facts about a declaration that decide its form. */
export type FormSymbol = Pick<ApiSymbol, 'id' | 'kind' | 'name'>

/** What a declaration is, for the rules above. A Go enumeration is a package constant, so every Go constant is one. */
export function formKind(lang: string | undefined, symbol: Pick<ApiSymbol, 'kind'>, owner?: Pick<ApiSymbol, 'kind'>): FormKind {
  if (TYPES.has(symbol.kind)) return 'type'
  if (symbol.kind === 'method') return 'method'
  if (symbol.kind === 'function') return 'function'
  return symbol.kind === 'constant' && (owner?.kind === 'enum' || lang === 'go') ? 'enum-member' : 'property'
}

export interface FormInput {
  lang: string | undefined
  kind: FormKind
  /** The declaration the label links to; none for an environment variable or a command. */
  symbol?: FormSymbol
  /** The type that declares it, for an enum member's qualifier. */
  owner?: Pick<ApiSymbol, 'name'>
  /** The label as the author wrote it, with a chip's owner already dropped. */
  label: string
  /** The page being read is the owner's, or lies within it. */
  onOwnerPage?: boolean
  /** A name in a directory: it stands among its owner's members and takes no qualifier of its own. */
  chip?: boolean
}

/** Languages whose documentation writes a member with a join of its own, which an author's choice keeps. */
const AUTHORED: ReadonlySet<string> = new Set(['java', 'scala'])

/** A name written as a path, with any language's joins. `args` is a call's parentheses, or a Swift full name's labels. */
const PATH = /^([.#]?)([\w$]+(?:(?:::|\.|#|:|\/)[\w$]+)*[!?=]?)(\(.*\))?$/s
const JOIN = /(::|\.|#|:|\/)/

/** An environment variable written with the shell's sigil: `$TMUX_PANE`. */
export const ENVIRONMENT_VARIABLE = /^\$[A-Z][A-Z0-9_]*$/

/** The visible text of a link to a declaration. */
export function writtenForm({ lang, kind, symbol, owner, label, onOwnerPage = false, chip = false }: FormInput): string {
  const forms = lang ? FORMS[lang] : undefined
  if (!lang || !forms) return label
  if (kind === 'command') return label.replace(/\(\)$/, '')
  if (kind === 'environment') return ENVIRONMENT_VARIABLE.test(label) ? label.slice(1) : label
  // Elixir writes `name/arity` and PowerShell a cmdlet by name; only an Elixir atom is spelled by this table.
  if (forms === 'as-written' && !(lang === 'elixir' && kind === 'enum-member')) return label
  const parsed = PATH.exec(label)
  if (!parsed) return label
  const [, lead, body, args = ''] = parsed as unknown as [string, string, string, string | undefined]
  const pieces = body.split(JOIN)
  const names = pieces.filter((_, i) => i % 2 === 0)
  const joins = pieces.filter((_, i) => i % 2 === 1)
  // Scala's `unary_!` is an operator, and a call with arguments says how it is invoked already.
  if (/^unary_/.test(names.at(-1)!) || (args !== '' && args !== '()' && lang !== 'swift')) return label
  if (kind === 'enum-member') return enumMember({ lang, forms, names, args, symbol, owner, onOwnerPage, chip })
  if (forms === 'as-written') return label

  // Javadoc writes `Pane#capture()` and Scaladoc `Window#layout`, so those keep the join their author chose. Ruby's type paths are `::`.
  const path = joins.slice(0, -1).map((join) => AUTHORED.has(lang) ? join : lang === 'ruby' ? '::' : forms.qualifier)
  const final = member(lang, kind, symbol, joins.at(-1), forms)
  let name = names.at(-1)!
  if (kind === 'method' || kind === 'function') {
    // DocC names a declaration with its argument labels: `newSession(name:)`, and `clients()` when it takes none.
    if (lang === 'swift') name = !args && symbol && symbol.name.replace(/\(.*$/s, '') === name ? symbol.name : `${name}${args}`
    else if (forms.call) name = `${name}${args || '()'}`
  }
  const last = names.length - 1
  const shown = names.map((part, i) => `${i === 0 ? '' : i === last ? final : path[i - 1]}${i === last ? name : part}`).join('')
  // A bare name keeps the sigil its author wrote, which Ruby spells by the kind of method.
  const sigil = last === 0 && lead && lang === 'ruby' ? (final === '#' ? '#' : '.') : lead
  return `${sigil}${shown}`
}

/** The join before a member's name: where the language has a rule of its own, and the author's choice where it has none. */
function member(lang: string, kind: FormKind, symbol: FormSymbol | undefined, written: string | undefined, forms: Language): string {
  if (AUTHORED.has(lang)) return written ?? forms.qualifier
  if (lang === 'ruby') return kind === 'type' ? '::' : kind === 'property' || symbol?.id.includes('#') ? '#' : '.'
  if (lang === 'lua') return kind === 'method' && symbol?.id.includes(':') ? ':' : '.'
  return forms.qualifier
}

interface EnumContext extends Pick<FormInput, 'symbol' | 'owner' | 'onOwnerPage' | 'chip'> {
  lang: string
  forms: Language | 'as-written'
  names: string[]
  args: string
}

function enumMember({ lang, forms, names, args, symbol, owner, onOwnerPage, chip }: EnumContext): string {
  const name = names.at(-1)!
  switch (lang) {
    case 'ruby': case 'elixir': return `:${name}`
    case 'lua': return `"${name}"`
    case 'julia': return name
    case 'swift': {
      const full = symbol && symbol.name.replace(/\(.*$/s, '') === name ? symbol.name : `${name}${args}`
      // The owner is the type that declares the case: from the model, else from the path the label or the id spells.
      const holder = owner?.name ?? (names.length > 1 ? names.at(-2) : symbol && symbol.id.includes('.') ? symbol.id.slice(0, symbol.id.lastIndexOf('.')).split('.').at(-1) : undefined)
      return onOwnerPage || !holder ? `.${full}` : `${holder}.${full}`
    }
    case 'go': {
      // A Go constant is a member of its package, which names it from outside.
      const pkg = symbol && /^[a-z]\w*(?=\.)/.exec(symbol.id)?.[0]
      return names.length > 1 || !pkg ? names.join('.') : `${pkg}.${name}`
    }
    default: {
      // A bare name takes its owner, as `Direction.Up` does, unless the page already says whose it is.
      const parts = names.length === 1 && owner && !(chip && onOwnerPage) ? [owner.name, name] : names
      return parts.join(forms === 'as-written' ? '.' : forms.qualifier)
    }
  }
}

/** Whether `context` is `owner` or lies within it, walking outward by `parentOf`. */
export function isWithin(
  context: Pick<ApiSymbol, 'id' | 'parent'> | undefined,
  owner: Pick<ApiSymbol, 'id'> | undefined,
  parentOf: (symbol: Pick<ApiSymbol, 'id' | 'parent'>) => Pick<ApiSymbol, 'id' | 'parent'> | undefined,
): boolean {
  const seen = new Set<string>()
  for (let scope = context; owner && scope && !seen.has(scope.id); scope = parentOf(scope)) {
    if (scope.id === owner.id) return true
    seen.add(scope.id)
  }
  return false
}
