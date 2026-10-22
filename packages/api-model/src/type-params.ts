import type { ApiSymbol, Signature, TypeParameter } from './model.ts'

/**
 * Type parameters read apart from their declaration text.
 *
 * Extraction keeps `typeParams` as written because signature layouts splice it
 * back into a header. A reader asks other questions of it: what is the name,
 * what must it satisfy, what does it default to. This parser answers them for
 * every language's spelling, so models extracted before the structured field
 * existed still render, and so extractors need no grammar of their own for it.
 */

const IDENT = String.raw`[A-Za-z_$][\w$]*`

/** Operators that look like brackets or separators but are neither. */
const COMPOUND = ['->', '=>', '<:', '>:', ':>', '<=', '>=', '==', '!=', '::']

/**
 * The first top-level occurrence of any needle: outside brackets, string
 * literals and compound operators. `Iterator<Item = u8>` holds an `=` that is
 * not a default, and `Fn(u8) -> u8` holds a `>` that closes nothing.
 */
export function findTopLevel(text: string, needles: readonly string[], from = 0): { index: number; needle: string } | undefined {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const char = text[i]!
    if (char === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
      continue
    }
    if (char === "'" && (text[i + 2] === "'" || (text[i + 1] === '\\' && text[i + 3] === "'"))) {
      i += text[i + 1] === '\\' ? 3 : 2
      continue
    }
    if (depth === 0) {
      const needle = needles.find((candidate) => text.startsWith(candidate, i) &&
        // A lone `=` must not be the start of `==`, `=>`, or the end of `<=`, `>=`, `!=`.
        (candidate !== '=' || (text[i + 1] !== '=' && text[i + 1] !== '>' && !(i > 0 && '<>!='.includes(text[i - 1]!)))))
      if (needle) return { index: i, needle }
    }
    const compound = COMPOUND.find((candidate) => text.startsWith(candidate, i))
    if (compound) { i += compound.length - 1; continue }
    if ('([{<'.includes(char)) depth++
    else if (')]}>'.includes(char)) depth = Math.max(0, depth - 1)
  }
  return undefined
}

/** Split at every top-level occurrence of one separator. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let hit = findTopLevel(text, [separator]); hit; hit = findTopLevel(text, [separator], start)) {
    parts.push(text.slice(start, hit.index))
    start = hit.index + separator.length
  }
  parts.push(text.slice(start))
  return parts.map((part) => part.trim()).filter(Boolean)
}

function make(parameter: TypeParameter): TypeParameter {
  const out: TypeParameter = { name: parameter.name }
  for (const key of ['modifier', 'kind', 'bound', 'default', 'doc'] as const) {
    const value = parameter[key]
    if (value) Object.assign(out, { [key]: typeof value === 'string' ? value.trim() : value })
  }
  return out
}

/**
 * `bound = default`, split on the one `=` that is not nested. The introducer
 * goes first: Ruby's `<` would otherwise open a bracket that swallows the `=`.
 */
function boundAndDefault(rest: string, introducer: RegExp): { bound?: string; default?: string } {
  const text = rest.trim()
  const introduced = introducer.test(text)
  const body = introduced ? text.replace(introducer, '') : text
  const equals = findTopLevel(body, ['='])
  return {
    bound: introduced ? (equals ? body.slice(0, equals.index) : body).trim() : undefined,
    default: equals ? body.slice(equals.index + 1).trim() : undefined,
  }
}

const ANNOTATIONS = /^(?:\s*(?:@[\w.]+(?:\([^)]*\))?|\[[^\]]*\]))+\s*/

type Parser = (text: string) => TypeParameter[]

const typescript: Parser = (text) => {
  const match = new RegExp(String.raw`^\s*((?:(?:const|in|out)\s+)*)(${IDENT})(?=\s*(?:extends\b|=|$))\s*([\s\S]*)$`).exec(text)
  if (!match) return []
  return [make({ name: match[2]!, modifier: match[1]!.trim(), ...boundAndDefault(match[3]!, /^extends\b/) })]
}

const rust: Parser = (text) => {
  const lifetime = /^('[A-Za-z_]\w*)\s*(?::\s*([\s\S]*))?$/.exec(text)
  if (lifetime) return [make({ name: lifetime[1]!, kind: 'lifetime', bound: lifetime[2] })]
  const constant = /^const\s+((?:r#)?[A-Za-z_]\w*)\s*:\s*([\s\S]*)$/.exec(text)
  if (constant) {
    const { bound, default: value } = boundAndDefault(`: ${constant[2]}`, /^:/)
    return [make({ name: constant[1]!, modifier: 'const', kind: 'const', bound, default: value })]
  }
  const type = /^((?:r#)?[A-Za-z_]\w*)\s*([\s\S]*)$/.exec(text)
  return type ? [make({ name: type[1]!, ...boundAndDefault(type[2]!, /^:/) })] : []
}

const go: Parser = (text) => {
  const match = /^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+([\s\S]+)$/.exec(text)
  if (!match) return /^[A-Za-z_]\w*$/.test(text) ? [make({ name: text })] : []
  return match[1]!.split(',').map((name) => make({ name: name.trim(), bound: match[2] }))
}

const java: Parser = (text) => {
  const match = new RegExp(String.raw`^(${IDENT})\s*(?:extends\s+([\s\S]+))?$`).exec(text.replace(ANNOTATIONS, ''))
  return match ? [make({ name: match[1]!, bound: match[2] })] : []
}

const csharp: Parser = (text) => {
  const match = /^(?:(in|out)\s+)?([A-Za-z_]\w*)$/.exec(text.replace(ANNOTATIONS, '').trim())
  return match ? [make({ name: match[2]!, modifier: match[1] })] : []
}

const kotlin: Parser = (text) => {
  const match = /^((?:(?:reified|in|out|vararg)\s+)*)([A-Za-z_]\w*)\s*(?::\s*([\s\S]+))?$/.exec(text.replace(ANNOTATIONS, '').trim())
  return match ? [make({ name: match[2]!, modifier: match[1]!.trim(), bound: match[3] })] : []
}

const scala: Parser = (text) => {
  const match = /^([+-]?)\s*([A-Za-z_]\w*)\s*(?:\[[\s\S]*?\])?\s*([\s\S]*)$/.exec(text.trim())
  if (!match) return []
  const rest = match[3]!.trim()
  return [make({ name: match[2]!, modifier: match[1], bound: rest.replace(/^<:\s*/, '') })]
}

const swift: Parser = (text) => {
  const match = /^((?:each\s+)?)([A-Za-z_]\w*)\s*(?::\s*([\s\S]+))?$/.exec(text.trim())
  return match ? [make({ name: match[2]!, modifier: match[1]!.trim(), bound: match[3] })] : []
}

/** Types a C++ non-type template parameter can have; anything else before the name is a concept. */
const CXX_VALUE_TYPE = /^(?:const\s+)?(?:auto|bool|char\d*_t|wchar_t|(?:unsigned|signed|short|long|int|char|float|double)(?:\s+(?:unsigned|signed|short|long|int|char))*|(?:std::)?(?:size_t|ptrdiff_t|u?intptr_t|u?int(?:_least|_fast)?\d+_t)|decltype\([\s\S]*\))$/

const cxx: Parser = (text) => {
  const equals = findTopLevel(text, ['='])
  const head = (equals ? text.slice(0, equals.index) : text).trim()
  const value = equals ? text.slice(equals.index + 1).trim() : undefined
  const template = /^template\s*<[\s\S]*>\s*(?:class|typename)\s*(\.\.\.)?\s*([A-Za-z_]\w*)?$/.exec(head)
  if (template) return template[2] ? [make({ name: template[2], modifier: template[1], default: value })] : []
  const plain = /^(?:typename|class)\s*(\.\.\.)?\s*([A-Za-z_]\w*)?$/.exec(head)
  if (plain) return plain[2] ? [make({ name: plain[2], modifier: plain[1], default: value })] : []
  const other = /^([\s\S]+?)\s*(\.\.\.)?\s*([A-Za-z_]\w*)$/.exec(head)
  if (!other) return []
  const nonType = CXX_VALUE_TYPE.test(other[1]!.trim())
  return [make({ name: other[3]!, modifier: other[2], kind: nonType ? 'const' : undefined, bound: other[1], default: value })]
}

const julia: Parser = (text) => {
  const match = /^([A-Za-z_][\w!]*)\s*(?:(<:|>:)\s*([\s\S]+))?$/.exec(text.trim())
  if (!match) return []
  return [make({ name: match[1]!, bound: match[3] ? `${match[2] === '>:' ? '>: ' : ''}${match[3]}` : undefined })]
}

/** `when item: Bound` of a spec, or the bare variable of `t(item)`. */
const elixir: Parser = (text) => {
  const match = /^([a-z_]\w*)\s*(?::\s*([\s\S]+))?$/.exec(text.trim())
  return match ? [make({ name: match[1]!, bound: match[2] })] : []
}

const ruby: Parser = (text) => {
  const match = /^(?:unchecked\s+)?(?:(in|out)\s+)?([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(text.trim())
  return match ? [make({ name: match[2]!, modifier: match[1], ...boundAndDefault(match[3]!, /^</) })] : []
}

const python: Parser = (text) => {
  const match = /^(\*{0,2})([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(text.trim())
  return match ? [make({ name: match[2]!, modifier: match[1], ...boundAndDefault(match[3]!, /^:/) })] : []
}

const fallback: Parser = (text) => {
  const match = new RegExp(String.raw`^'?(${IDENT})\s*([\s\S]*)$`).exec(text.trim())
  return match ? [make({ name: text.trim().startsWith("'") ? `'${match[1]}` : match[1]!, ...boundAndDefault(match[2]!, /^(?::|extends\b|<:)/) })] : []
}

const PARSERS: Record<string, Parser> = {
  ts: typescript, rs: rust, go, java, csharp, kotlin, scala, swift, cxx, julia, elixir, ruby, py: python,
}

/** One declaration entry as the language's grammar reads it; a Go entry can declare several names. */
export function parseTypeParameter(lang: string | undefined, text: string): TypeParameter[] {
  const trimmed = text.trim()
  // Older models wrapped the whole list in its brackets.
  const inner = /^<([\s\S]*)>$/.test(trimmed) && !trimmed.slice(1, -1).includes('<') ? trimmed.slice(1, -1) : trimmed
  return (PARSERS[lang ?? ''] ?? fallback)(inner)
}

/** A declaration's whole parameter list, once per name. */
export function parseTypeParameters(lang: string | undefined, texts: readonly string[]): TypeParameter[] {
  const seen = new Set<string>()
  return texts.flatMap((text) => parseTypeParameter(lang, text)).filter((parameter) => {
    if (seen.has(parameter.name)) return false
    seen.add(parameter.name)
    return true
  })
}

type Declares = Pick<ApiSymbol | Signature, 'typeParameters' | 'typeParams' | 'typeParamNames'> & { kind?: string }
const derived = new WeakMap<object, Map<string, TypeParameter[]>>()

/**
 * The type parameters an extracted declaration owns: the stored list when the
 * extractor wrote one, otherwise its declaration text read apart. A model
 * that recorded names only still yields names.
 */
export function typeParametersOf(entity: Declares, lang?: string): TypeParameter[] {
  // A Julia alias records the arguments it applies, `Ref{ID}`, not parameters it declares.
  if (lang === 'julia' && entity.kind === 'typealias') return []
  if (entity.typeParameters) return entity.typeParameters
  if (!entity.typeParams?.length && !entity.typeParamNames?.length) return []
  const cache = derived.get(entity) ?? new Map<string, TypeParameter[]>()
  derived.set(entity, cache)
  const key = lang ?? ''
  let parsed = cache.get(key)
  if (!parsed) {
    parsed = parseTypeParameters(lang, entity.typeParams ?? [])
    if (!parsed.length) parsed = (entity.typeParamNames ?? []).map((name) => ({ name }))
    cache.set(key, parsed)
  }
  return parsed
}

/** `<A, B>` in the brackets the language writes generic lists in. */
export function typeParameterList(lang: string | undefined, parameters: readonly TypeParameter[]): string {
  if (!parameters.length) return ''
  const [open, close] = lang === 'go' || lang === 'scala' ? ['[', ']'] : lang === 'julia' ? ['{', '}'] : lang === 'elixir' ? ['(', ')'] : ['<', '>']
  return `${open}${parameters.map((parameter) => parameter.name).join(', ')}${close}`
}

/** What the language calls the restriction on a parameter. */
export function boundLabel(lang: string | undefined, parameter?: TypeParameter): string {
  if (parameter?.kind === 'const') return 'Type'
  return ['go', 'csharp', 'cxx', 'swift'].includes(lang ?? '') ? 'Constraint' : 'Bound'
}

/** Doc comments name a parameter by `T` or `<T>`; both land on the declared name. */
export function withTypeParameterDocs(parameters: readonly TypeParameter[], docs: ReadonlyMap<string, string>): TypeParameter[] {
  return parameters.map((parameter) => {
    const doc = docs.get(parameter.name) ?? docs.get(`<${parameter.name}>`)
    return doc ? { ...parameter, doc } : parameter
  })
}
