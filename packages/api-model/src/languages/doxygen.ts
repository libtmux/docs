import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { markText } from '../doc/markdown.ts'
import type { ApiSymbol, Modifier, Param, Signature, SymbolKind } from '../model.ts'
import { markOverload } from '../overloads.ts'
import { parseTypeParameters, withTypeParameterDocs } from '../type-params.ts'

/**
 * C and C++ from the same Doxygen XML extractor.
 *
 * The C++ grammar loses 0.34% of this project's headers, and what it loses is
 * the part a reference exists to show: `LIBTMUX_NAMESPACE_BEGIN` is a macro
 * that opens a namespace, so the unbalanced brace derails the file, and
 * `void f(std::string s = {})` yields a MISSING node that drops the default
 * argument. No parser without a preprocessor can do better.
 *
 * Doxygen has a preprocessor, already runs in this project's build (its XML is
 * what Breathe consumes), and emits a resolved model. This reads that model
 * into the same shape tree-sitter produces, so C++ renders through the same
 * components as everything else.
 *
 * A hand-written XML reader rather than a parser dependency: Doxygen's schema
 * is large but the slice needed here is small and regular, and the alternative
 * is an XML library in a package whose whole point is having few dependencies.
 */

/** Doxygen's `kind` attribute mapped onto the model's kinds. */
const COMPOUND_KIND: Record<string, SymbolKind> = {
  class: 'class',
  struct: 'struct',
  union: 'union',
  namespace: 'module',
  interface: 'interface',
}

const MEMBER_KIND: Record<string, SymbolKind> = {
  function: 'method',
  variable: 'attribute',
  enum: 'enum',
  typedef: 'typealias',
  define: 'constant',
}

/**
 * Strip Doxygen's inline markup, keeping the text a reader would see.
 *
 * Bold, emphasis and headings come back out as Markdown, the dialect every
 * other port's prose is read in. A section's `<title>` sits against the next
 * `<para>`, so it gets a blank line of its own; a `@par` title is a bold line.
 */
function textOf(xml: string): string {
  // A `\code` block is kept apart from the whitespace folding below: its
  // lines and indentation are the example.
  const listings: string[] = []
  const text = xml.replace(/<programlisting\b[^>]*>([\s\S]*?)<\/programlisting>/g, (_, listing: string) => {
    const lines = [...listing.matchAll(/<codeline\b[^>]*>([\s\S]*?)<\/codeline>/g)]
      .map((line) => decodeEntities(line[1].replace(/<sp\s*\/>/g, ' ').replace(/<[^>]+>/g, '')))
    listings.push(`\n\n\`\`\`cpp\n${lines.join('\n').replace(/\s+$/, '')}\n\`\`\`\n\n`)
    return `\uE000${listings.length - 1}\uE001`
  })
  return text
    .replace(/<ref[^>]*>/g, '')
    .replace(/<\/ref>/g, '')
    .replace(/<computeroutput>/g, '`')
    .replace(/<\/computeroutput>/g, '`')
    .replace(/<bold>([\s\S]*?)<\/bold>/g, (_, inner: string) => markText(inner, '**'))
    .replace(/<emphasis>([\s\S]*?)<\/emphasis>/g, (_, inner: string) => markText(inner, '*'))
    .replace(/<sect([1-4])\b[^>]*>\s*<title>([\s\S]*?)<\/title>/g, (_, level: string, title: string) =>
      `\n\n${'#'.repeat(Number(level))} ${title.replace(/\s+/g, ' ').trim()}\n\n`)
    .replace(/<title>([\s\S]*?)<\/title>/g, (_, title: string) => `\n\n${markText(title.replace(/\s+/g, ' ').trim(), '**')}\n\n`)
    .replace(/<para>/g, '\n')
    .replace(/<\/para>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\uE000(\d+)\uE001/g, (_, at: string) => listings[Number(at)])
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  const entities: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)))
    return entities[entity]
  })
}

/** Code XML keeps literal whitespace and decodes each entity exactly once. */
function codeOf(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, '')).trim()
}

const syntheticCName = (name: string): boolean => /\[(?:struct|union)\]|__unnamed\d+__|@[\da-f]+/i.test(name)

/** Doxygen names anonymous C records for identity; those names are not C syntax. */
function cDisplayName(name: string, kind?: string): string {
  const anonymous = syntheticCName(name)
  const clean = name.replace(/\[(?:struct|union)\]\.?|__unnamed\d+__|@[\da-f]+/gi, '')
    .replaceAll('::', '.').replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '')
  return anonymous && kind ? clean ? `${clean} (anonymous ${kind})` : `anonymous ${kind}` : clean
}

/** Reconstruct C declaration syntax from Doxygen's native declaration fields. */
function cDeclaration(block: string, nativeKind: string, name: string): string | undefined {
  const type = codeOf(tag(block, 'type') ?? '')
  const args = codeOf(tag(block, 'argsstring') ?? '')
  const initializer = codeOf(tag(block, 'initializer') ?? '')
  if (nativeKind !== 'enum' && (syntheticCName(name) || syntheticCName(type))) return undefined
  if (nativeKind === 'enum') {
    const values = [...block.matchAll(/<enumvalue([\s\S]*?)<\/enumvalue>/g)].map((match) =>
      `${codeOf(tag(match[1], 'name') ?? '')}${tag(match[1], 'initializer') ? ` ${codeOf(tag(match[1], 'initializer') ?? '')}` : ''}`)
    return `enum${name.startsWith('@') ? '' : ` ${name}`} { ${values.join(', ')} };`
  }
  if (nativeKind === 'define') {
    const parameters = [...block.matchAll(/<param>([\s\S]*?)<\/param>/g)].map((match) => codeOf(tag(match[1], 'defname') ?? ''))
    return `#define ${name}${parameters.length ? `(${parameters.join(', ')})` : ''}${initializer ? ` ${initializer}` : ''}`
  }
  const pointer = /\(\s*(\*+(?:\s*(?:const|volatile|restrict)\b)*)\s*\)/
  const declarator = pointer.test(type)
    ? `${type.replace(pointer, (_, stars: string) => `(${stars}${/\w$/.test(stars) ? ' ' : ''}${name})`)}${args}`
    : `${type} ${name}${args}`
  const bitfield = codeOf(tag(block, 'bitfield') ?? '')
  const storage = nativeKind === 'typedef' ? 'typedef ' : attr(block, 'static') === 'yes' ? 'static ' : ''
  return `${storage}${declarator}${bitfield ? ` : ${bitfield}` : ''}${initializer ? ` ${initializer.startsWith('=') ? initializer : `= ${initializer}`}` : ''};`.trim()
}

/** Remove Doxygen's template padding without rewriting expressions or literals. */
export function normalizeCppTemplateSpacing(declaration: string): string {
  // Keep strings (including raw strings), comments and compound operators whole.
  const tokens = [...declaration.matchAll(/(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\([\s\S]*?\)\1"|(?:u8|u|U|L)?(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[A-Za-z_]\w*|\d[\w'.]*|<=>|<<=?|>>=|->\*?|>=|<=|[^\s]/g)]
  const templates: { token: number; group: number }[] = []
  const remove = new Set<number>()
  let group = 0
  const padding = (start: number, end: number) => {
    if (/[\r\n]/.test(declaration.slice(start, end))) return
    for (let i = start; i < end; i++) if (/[ \t]/.test(declaration[i])) remove.add(i)
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const text = token[0]
    if (/^[([{]$/.test(text)) group++
    else if (/^[)\]}]$/.test(text)) {
      group--
      while (templates.length && templates.at(-1)!.group > group) templates.pop()
    } else if (text === '<') {
      const previous = tokens[i - 1]
      if (previous && /^[A-Za-z_]\w*$/.test(previous[0]) && previous[0] !== 'operator' &&
          (previous.index! + previous[0].length === token.index || previous[0] === 'template')) {
        templates.push({ token: i, group })
      }
    } else if (text === '>' && templates.at(-1)?.group === group) {
      const opening = templates.pop()!.token
      padding(tokens[opening].index! + 1, tokens[opening + 1].index!)
      padding(tokens[i - 1].index! + tokens[i - 1][0].length, token.index!)
    }
  }
  return declaration.split('').filter((_, i) => !remove.has(i)).join('')
}

/**
 * Doxygen's spelling of a template specialisation, normalised to C++'s.
 *
 * `std::hash< libtmux::Pane >` is how Doxygen writes it; the padding inside
 * the angle brackets is its formatting, not part of the name. Left as-is it
 * is four names containing spaces, which `objects.inv` cannot represent —
 * whitespace-delimited records mis-split and the entry is lost.
 */
function normalizeCppName(name: string): string {
  return name
    .replace(/<\s+/g, '<')
    .replace(/\s+>/g, '>')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, '')
}

/**
 * The last segment of a qualified C++ name, not counting `::` inside template
 * arguments.
 *
 * `std::hash<libtmux::Client>` names `hash<libtmux::Client>` in `std`.
 * Splitting at every `::` named it `Client>`, and the module the reference
 * derives from what is left became `std::hash<libtmux`.
 */
export function cppUnqualifiedName(qualified: string): string {
  let depth = 0
  for (let i = qualified.length - 1; i > 0; i--) {
    const c = qualified[i]
    if (c === '>') depth++
    else if (c === '<') depth--
    else if (depth === 0 && c === ':' && qualified[i - 1] === ':') return qualified.slice(i + 1)
  }
  return qualified
}

const tag = (xml: string, name: string): string | undefined => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? m[1] : undefined
}

/**
 * The descriptions belonging to the compound itself, not to its first member.
 *
 * Doxygen writes a type's own `briefdescription` and `detaileddescription`
 * last, between the final `</sectiondef>` and `<location>`.
 */
const ownDescriptions = (xml: string): { brief: string; detail: string } => {
  const end = xml.lastIndexOf('<location ')
  const scope = end === -1 ? xml : xml.slice(0, end)
  const start = scope.lastIndexOf('</sectiondef>')
  const tail = start === -1 ? scope : scope.slice(start)
  return { brief: tag(tail, 'briefdescription') ?? '', detail: tag(tail, 'detaileddescription') ?? '' }
}

/** The part of an enum's `<memberdef>` that describes the enum, not its values. */
const afterEnumValues = (block: string): string => {
  const last = block.lastIndexOf('</enumvalue>')
  return last === -1 ? block : block.slice(last)
}

const attr = (xml: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1]

/** C source locations distinguish a declaration from a same-file definition.
 * Doxygen 1.18 sometimes keeps a preceding callback's `line` for function
 * pointer typedefs and fields; its positive `bodystart` identifies the actual
 * declaration. A cross-file body belongs to a different member record, and
 * repeated extern declarations are not definitions.
 */
function cLocation(location: string, fallback: string, externDeclaration = false): {
  source: { file: string; line: number }; isDefinition: boolean
} {
  const field = (name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(location)?.[1]
  const file = field('file') ?? fallback
  const declaredLine = Number(field('line') ?? 1)
  const bodyLine = Number(field('bodystart'))
  const isDefinition = !externDeclaration && field('bodyfile') === file
    && Number.isInteger(bodyLine) && bodyLine > 0
  return { source: { file, line: isDefinition ? bodyLine : declaredLine }, isDefinition }
}

/** Programlisting is native linked source, not a runtime or complete call graph. */
function cCalls(
  documents: { xml: string }[], nativeIds: Map<string, string>, seen: Map<string, ApiSymbol>,
  onDiagnostic?: (message: string) => void,
): void {
  const plain = (xml: string) => codeOf(`_${xml.replace(/<sp\s*\/>/g, ' ')}_`).slice(1, -1)
  for (const { xml } of documents) {
    if (!/<compounddef\b[^>]*kind="file"/.test(xml)) continue
    const file = textOf(tag(xml, 'compoundname') ?? '')
    const listing = tag(xml, 'programlisting')
    if (!listing) continue
    const lines = [...listing.matchAll(/<codeline\b([^>]*)>([\s\S]*?)<\/codeline>/g)].map((match) => {
      // Comments and literal contents cannot contain callable source tokens.
      const codeXml = match[2].replace(/<highlight class="(?:comment|stringliteral|charliteral)">([\s\S]*?)<\/highlight>/g,
        (part) => ' '.repeat(plain(part).length))
      const refs = [...codeXml.matchAll(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/g)].map((ref) => ({
        id: nativeIds.get(attr(ref[1], 'refid') ?? ''), name: plain(ref[2]),
        start: plain(codeXml.slice(0, ref.index)).length,
        end: plain(codeXml.slice(0, ref.index + ref[0].length)).length,
      }))
      return { line: Number(attr(match[1], 'lineno')), code: plain(codeXml), refs,
        preprocessor: /<highlight class="preprocessor">/.test(codeXml) }
    })
    const bodies = [...xml.matchAll(/<memberdef([\s\S]*?)<\/memberdef>/g)].flatMap((member) => {
      if (attr(member[1], 'kind') !== 'function') return []
      const symbol = seen.get(nativeIds.get(attr(member[1], 'id') ?? '') ?? '')
      const location = /<location\b([^>]*)\/>/.exec(member[1])?.[1] ?? ''
      const start = Number(attr(location, 'bodystart')), end = Number(attr(location, 'bodyend'))
      return symbol && attr(location, 'bodyfile') === file && start > 0 && end >= start
        ? [{ symbol, start, end }] : []
    })
    for (const { symbol, start, end } of bodies) {
      // Native body spans have line precision only. Two definitions can share
      // a line, so its first brace is not necessarily this function's body.
      const conflicts = bodies.filter((body) => body.symbol.id !== symbol.id
        && body.start <= end && start <= body.end)
      if (conflicts.length) {
        onDiagnostic?.(`Omitted ambiguous function body ${symbol.id} at ${file}:${start}-${end}; overlaps ${conflicts.map((body) => body.symbol.id).sort().join(', ')}`)
        continue
      }
      let opened = false, parentheses = 0, brackets = 0, braces = 1, continuation = false
      for (const row of lines) {
        if (row.line < start || row.line > end) continue
        if (row.preprocessor || continuation) {
          continuation = row.code.trimEnd().endsWith('\\')
          continue
        }
        let offset = 0
        if (!opened) {
          // bodystart is the function name line. It is not a recursive call.
          const brace = row.code.indexOf('{')
          if (brace === -1) continue
          opened = true
          offset = brace + 1
        }
        let limit = row.code.length
        for (let i = offset; i < row.code.length; i++) {
          if (row.code[i] === '{') braces++
          else if (row.code[i] === '}' && --braces === 0) { limit = i; break }
        }
        const macro = row.refs.some((ref) => ref.id && seen.get(ref.id)?.modifiers.includes('macro'))
        for (const ref of row.refs) {
          const target = ref.id ? seen.get(ref.id) : undefined
          if (macro || parentheses !== 0 || brackets !== 0 || ref.start < offset
            || ref.end > limit || target?.kind !== 'function' || target.name !== ref.name
            || (target.modifiers.includes('static') && target.source.file !== file)
            || !/^\s*\(/.test(row.code.slice(ref.end))) continue
          const prefix = row.code.slice(offset, ref.start)
          // Deliberately bounded: a direct statement, return, first condition,
          // or assignment RHS. Nested/continued expressions and macro arguments
          // remain references; no guessed calls from names or address-taking.
          const expression = /^\s*(?:return\s*\(*\s*|(?:if|while|switch)\s*\(\s*!?\s*)?$/.test(prefix)
          const assignment = !/[();{}]/.test(prefix) && /(?<![=!<>])=(?!=)\s*$/.test(prefix)
          if (!expression && !assignment) continue
          const references = symbol.references ??= []
          let edge = references.find((entry) => entry.kind === 'call' && entry.target === target.id)
          if (!edge) { edge = { target: target.id, kind: 'call', sites: [] }; references.push(edge) }
          if (!edge.sites!.some((site) => site.file === file && site.line === row.line)) edge.sites!.push({ file, line: row.line })
        }
        for (const char of row.code.slice(offset, limit)) {
          if (char === '(') parentheses++
          else if (char === ')') parentheses--
          else if (char === '[') brackets++
          else if (char === ']') brackets--
        }
        if (braces === 0) break
      }
    }
  }
  for (const symbol of seen.values()) {
    symbol.references?.sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))
    for (const edge of symbol.references ?? []) edge.sites?.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  }
}

/** `<param>` entries, with the `\param` docs Doxygen keeps separately. */
function paramsOf(block: string, docs: Map<string, string>, c = false): Param[] {
  const out: Param[] = []
  // Template parameters are declaration metadata, never runtime arguments.
  const runtime = block.replace(/<templateparamlist>[\s\S]*?<\/templateparamlist>/g, '')
  for (const m of runtime.matchAll(/<param>([\s\S]*?)<\/param>/g)) {
    const name = textOf(tag(m[1], 'declname') ?? (c ? tag(m[1], 'defname') : undefined) ?? '')
    const type = c ? textOf(tag(m[1], 'type') ?? '') : normalizeCppTemplateSpacing(codeOf(tag(m[1], 'type') ?? ''))
    const def = tag(m[1], 'defval')
    if (!name && (!type || (c && type === 'void'))) continue
    out.push({
      name: c ? name : name || type,
      type: c || name ? type : undefined,
      // The default argument, which is exactly what tree-sitter dropped.
      default: def ? c ? textOf(def) : normalizeCppTemplateSpacing(codeOf(def)) : undefined,
      doc: docs.get(name),
    })
  }
  return out
}

/** `\param name description` entries, which live apart from `<param>`. */
function paramDocs(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/<parameteritem>([\s\S]*?)<\/parameteritem>/g)) {
    const name = textOf(tag(m[1], 'parametername') ?? '')
    const desc = textOf(tag(m[1], 'parameterdescription') ?? '')
    if (name) out.set(name, desc)
  }
  return out
}

function modifiersOf(block: string): Modifier[] {
  const out: Modifier[] = []
  if (attr(block, 'static') === 'yes') out.push('static')
  if (attr(block, 'virt') === 'pure-virtual') out.push('abstract')
  if (attr(block, 'const') === 'yes') out.push('readonly')
  if (/<detaileddescription>[\s\S]*deprecated/i.test(block)) out.push('deprecated')
  return out
}

export interface DoxygenOptions {
  /** C tag namespaces and file-local linkage differ from C++ namespaces. */
  language?: 'c' | 'cpp'
  /** Producer relationships omitted rather than repaired by name. */
  onDiagnostic?: (message: string) => void
}

/** Native template parameter spelling, shared by declarations and metadata. */
function cppTemplateParameters(block: string): string[] {
  const template = tag(block, 'templateparamlist') ?? ''
  return [...template.matchAll(/<param>([\s\S]*?)<\/param>/g)].map((match) => {
    const type = codeOf(tag(match[1], 'type') ?? '')
    const name = codeOf(tag(match[1], 'declname') ?? '')
    const value = tag(match[1], 'defval')
    return normalizeCppTemplateSpacing(`${type}${name ? ` ${name}` : ''}${value ? ` = ${codeOf(value)}` : ''}`)
  })
}

/** `\tparam T description`, which Doxygen keeps in its own parameter list beside `\param`. */
function templateParameterDocs(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const list of xml.matchAll(/<parameterlist kind="templateparam">([\s\S]*?)<\/parameterlist>/g)) {
    for (const item of list[1].matchAll(/<parameteritem>([\s\S]*?)<\/parameteritem>/g)) {
      const name = textOf(tag(item[1], 'parametername') ?? '')
      const doc = textOf(tag(item[1], 'parameterdescription') ?? '')
      if (name && doc) out.set(name, doc)
    }
  }
  return out
}

/** A declaration's template parameters as the model stores them: as written, and read apart. */
function cppTypeParameters(declaration: string, documentation: string): Pick<Signature, 'typeParams' | 'typeParameters'> {
  const typeParams = cppTemplateParameters(declaration)
  if (!typeParams.length) return {}
  const typeParameters = withTypeParameterDocs(parseTypeParameters('cxx', typeParams), templateParameterDocs(documentation))
  return { typeParams, ...(typeParameters.length ? { typeParameters } : {}) }
}

/** Preserve C++ declaration syntax and specifiers that typed parameter rows cannot express. */
function cppSignature(block: string): string | undefined {
  const definition = codeOf(tag(block, 'definition') ?? '')
  const args = codeOf(tag(block, 'argsstring') ?? '')
  if (!definition || !args) return undefined
  const name = codeOf(tag(block, 'name') ?? '')
  const qualified = codeOf(tag(block, 'qualifiedname') ?? '')
  // Inside an owner's panel, use the in-class spelling from the declaration.
  let declaration = qualified && definition.endsWith(qualified)
    ? `${definition.slice(0, -qualified.length)}${name}${args}` : `${definition}${args}`
  for (const keyword of ['explicit', 'static', 'constexpr', 'consteval']) {
    if (attr(block, keyword) === 'yes' && !new RegExp(`\\b${keyword}\\b`).test(definition)) declaration = `${keyword} ${declaration}`
  }
  if (attr(block, 'nodiscard') === 'yes' && !definition.includes('[[nodiscard')) declaration = `[[nodiscard]] ${declaration}`
  const template = cppTemplateParameters(block)
  const constraint = codeOf(tag(block, 'requiresclause') ?? '')
  if (constraint && !/\brequires\b/.test(args)) {
    declaration = template.length ? `requires ${constraint}\n${declaration}`
      : declaration.replace(/(\s*=\s*(?:default|delete|0))?$/, (_, ending = '') => ` requires ${constraint}${ending}`)
  }
  if (template.length) declaration = `template <${template.join(', ')}>\n${declaration}`
  return normalizeCppTemplateSpacing(`${declaration};`)
}

/**
 * @param sourceRoot accepted and unused, so callers need not change.
 *
 * It used to point a scraper at the headers, because libtmux-cxx documented
 * itself with `//` and Doxygen reads only `///` and block comments — every
 * `briefdescription` in the XML was empty, so the prose had to come from
 * somewhere. That conversion has since landed upstream and Doxygen emits 261
 * briefs where it emitted none.
 *
 * The scraper is gone rather than kept as a fallback, and the measurement is
 * why. It documented 56 symbols the briefs do not, and 42 of those shared
 * their summary with another symbol: it took the comment above one
 * declaration and attributed it to the next as well, so `Buffer::name`,
 * `Buffer::size` and `Buffer::created` all claimed "Named by the caller, or
 * by tmux as `buffer0`". `size()` has no comment at all.
 *
 * 224 correctly attributed beats 280 of which 42 are wrong. A reader cannot
 * tell a borrowed sentence from a written one, which makes the borrowed kind
 * worse than an empty description.
 */
export function extractDoxygen(xmlDir: string, sourceRoot = '', options: DoxygenOptions = {}): ApiSymbol[] {
  void sourceRoot
  const symbols: ApiSymbol[] = []
  const seen = new Map<string, ApiSymbol>()
  const c = options.language === 'c'
  const nativeIds = new Map<string, string>()
  const compoundParents = new Map<string, string>()
  const pendingReferences = new Map<string, { nativeId: string; name: string; kind: 'type' | 'call' | 'reference' }[]>()
  const definitionIds = new Set<string>()
  const pendingTypes = new Map<string, string[]>()

  const files = readdirSync(xmlDir).filter(
    (f) => f.endsWith('.xml') && f !== 'index.xml' && f !== 'Doxyfile.xml',
  )

  const documents = files.sort().map((file) => ({ file, xml: readFileSync(join(xmlDir, file), 'utf8') }))
  if (c) {
    for (const { xml } of documents) {
      const head = /<compounddef\b([^>]*)>/.exec(xml)?.[1] ?? ''
      const nativeId = attr(head, 'id')
      const kind = COMPOUND_KIND[attr(head, 'kind') ?? '']
      const name = textOf(tag(xml, 'compoundname') ?? '')
      if (!nativeId || !kind || !name) continue
      const id = `c:${kind}:${name}`
      nativeIds.set(nativeId, id)
      for (const child of xml.matchAll(/<innerclass\b([^>]*)>/g)) {
        const childId = attr(child[1], 'refid')
        if (childId) compoundParents.set(childId, id)
      }
    }
  }

  for (const { file, xml } of documents) {
    const compound = /<compounddef[^>]*kind="(\w+)"[^>]*>/.exec(xml)
    if (!compound) continue
    const kind = COMPOUND_KIND[compound[1]]
    const compoundId = attr(compound[0], 'id') ?? ''
    // `file` compounds hold free functions; their members are emitted at
    // namespace scope rather than under a type, which is where they belong.
    const owner = normalizeCppName(textOf(tag(xml, 'compoundname') ?? ''))
    if (!owner) continue

    const ownerId = c ? nativeIds.get(compoundId) ?? owner : owner
    if (kind && compound[1] !== 'namespace') {
      // A compound's own descriptions sit at the end of `<compounddef>`, after
      // every `<sectiondef>` and immediately before `<location>`. Taking the
      // first ones in the file took a *member's* instead, so `AttachCommand`
      // was documented with "Exec-order arguments; empty after this value is
      // moved from." — and where the first member had none, which is usual,
      // the type was reported as undocumented while its prose sat in the file.
      const own = ownDescriptions(xml)
      const brief = textOf(own.brief)
      const detail = textOf(own.detail)
      const location = /<location file="([^"]*)"[^>]*line="(\d+)"/.exec(xml)
      // The compound's location follows its sections; earlier locations
      // belong to members and must not become the type's source link.
      const ownLocation = [...xml.matchAll(/<location\b([^>]*)\/>/g)].at(-1)?.[1] ?? ''
      // Private and protected inheritance does not expose a public base type.
      // Public members remain independently eligible below.
      const bases = [...xml.matchAll(/<basecompoundref([^>]*)>([\s\S]*?)<\/basecompoundref>/g)]
        .filter((m) => attr(m[1], 'prot') === 'public')
        .map((m) => c ? textOf(m[2]) : normalizeCppTemplateSpacing(codeOf(m[2])))
      if (!seen.has(ownerId)) {
        const sym: ApiSymbol = {
          id: ownerId,
          publicId: ownerId,
          ...(c ? { qualifiedName: cDisplayName(owner, kind), namespace: '', parent: compoundParents.get(compoundId) } : {}),
          name: c ? cDisplayName(cppUnqualifiedName(owner), kind) : cppUnqualifiedName(owner),
          kind,
          modifiers: [],
          signatures: c && !owner.includes('::') && !syntheticCName(owner) ? [{ raw: `${kind} ${owner};`, params: [] }] : [],
          // The compound's own list precedes its members', whose lists are their own.
          ...(c ? {} : cppTypeParameters(xml.split(/<sectiondef|<memberdef/)[0], own.detail)),
          doc:
            brief || detail
              ? { summary: brief, body: detail || undefined }
              : undefined,
          extends: bases.length ? bases : undefined,
          source: c ? cLocation(ownLocation, file).source : { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
        }
        seen.set(ownerId, sym)
        symbols.push(sym)
      }
    }

    for (const m of xml.matchAll(/<memberdef([\s\S]*?)<\/memberdef>/g)) {
      const block = m[1]
      // Doxygen records protected and private members too; a public reference
      // shows neither.
      if (attr(block, 'prot') !== 'public') continue
      const memberKind = MEMBER_KIND[attr(block, 'kind') ?? '']
      if (!memberKind) continue
      const name = normalizeCppName(textOf(tag(block, 'name') ?? ''))
      if (!name || name.startsWith('operator')) continue

      const parent = kind && compound[1] !== 'namespace' ? ownerId : undefined
      const nativeKind = attr(block, 'kind') ?? ''
      // C has a separate tag namespace. External declarations across .h/.c
      // share one identity; static declarations remain local to their file.
      const local = attr(block, 'static') === 'yes' || nativeKind === 'define' || name.startsWith('@')
      const id = c
        ? parent ? `${parent}::${name}` : `c:${nativeKind}:${local ? `${owner}:` : ''}${name}`
        : `${parent ?? owner}::${name}`
      const nativeId = attr(block, 'id')
      if (c && nativeId) nativeIds.set(nativeId, id)
      const nativeLocation = /<location\b([^>]*)\/>/.exec(block)?.[1] ?? ''
      const { source: nativeSource, isDefinition } = cLocation(nativeLocation, file,
        attr(block, 'extern') === 'yes' && !tag(block, 'initializer'))
      const sourceFile = nativeSource.file
      if (c) {
        pendingTypes.set(id, [...(pendingTypes.get(id) ?? []), codeOf(tag(block, 'type') ?? ''), codeOf(tag(block, 'argsstring') ?? '')])
        const refs = pendingReferences.get(id) ?? []
        for (const typeBlock of block.matchAll(/<type>([\s\S]*?)<\/type>/g)) {
          for (const ref of typeBlock[1].matchAll(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/g)) {
            const target = attr(ref[1], 'refid')
            if (target) refs.push({ nativeId: target, name: textOf(ref[2]), kind: 'type' })
          }
        }
        for (const ref of block.matchAll(/<references\b([^>]*)>([\s\S]*?)<\/references>/g)) {
          const target = attr(ref[1], 'refid')
          if (target) refs.push({ nativeId: target, name: textOf(ref[2]), kind: 'reference' })
        }
        for (const ref of (tag(block, 'initializer') ?? '').matchAll(/<ref\b([^>]*)>([\s\S]*?)<\/ref>/g)) {
          const target = attr(ref[1], 'refid')
          if (target) refs.push({ nativeId: target, name: textOf(ref[2]), kind: 'reference' })
        }
        pendingReferences.set(id, refs)
      }
      // An enum's own descriptions come after its values', the same way a
      // compound's come after its members'. Reading the first ones documented
      // `StringOp` as "iequals" — the brief of its second enumerator.
      const scope = attr(block, 'kind') === 'enum' ? afterEnumValues(block) : block
      const brief = textOf(tag(scope, 'briefdescription') ?? '')
      const detail = textOf(tag(scope, 'detaileddescription') ?? '')
      // A template's first <type> and a parameter's <type> cannot stand in for
      // the member's own (possibly empty, for constructors) return type.
      const memberType = block.replace(/<(templateparamlist|param)>[\s\S]*?<\/\1>/g, '')
      const returnType = c ? textOf(tag(memberType, 'type') ?? '') : normalizeCppTemplateSpacing(codeOf(tag(memberType, 'type') ?? ''))
      const returnDoc = textOf(tag(block, 'simplesect') ?? '')
      const templateParameters = c ? {} : cppTypeParameters(block, tag(scope, 'detaileddescription') ?? '')

      const signature: Signature | undefined =
        attr(block, 'kind') === 'function'
          ? {
              params: paramsOf(block, paramDocs(block), c),
              ...templateParameters,
              ...(c ? { raw: `${codeOf(tag(block, 'definition') ?? '')}${codeOf(tag(block, 'argsstring') ?? '')}` }
                : cppSignature(block) ? { raw: cppSignature(block) } : {}),
              returns: returnType || undefined,
              returnsDoc: returnDoc || undefined,
            }
          : undefined

      const existing = seen.get(id)
      if (c && existing) {
        // C has no overload sets. Prefer a definition over its declaration,
        // including Doxygen's definition-only parameter names.
        if (isDefinition && !definitionIds.has(id)) {
          if (signature) existing.signatures = [signature]
          existing.source = nativeSource
          existing.doc = brief || detail ? { summary: brief, body: detail || undefined } : existing.doc
          const initializer = tag(block, 'initializer')
          if (initializer) existing.value = codeOf(initializer).replace(/^=\s*/, '')
          if (!signature) existing.signatures = [{ raw: cDeclaration(block, nativeKind, name), params: [] }]
          definitionIds.add(id)
        }
        continue
      }
      if (existing && signature) {
        // C++ overload sets: same name, different parameters, one entry.
        existing.signatures.push(signature)
        markOverload(existing)
        continue
      }
      if (existing) continue

      const location = /<location file="([^"]*)"[^>]*line="(\d+)"/.exec(block)
      const sym: ApiSymbol = {
        id,
        publicId: id,
        ...(c ? { qualifiedName: parent ? cDisplayName(`${owner}::${name}`, syntheticCName(name) ? nativeKind : undefined) : cDisplayName(name, nativeKind), namespace: '' } : {}),
        name: c ? cDisplayName(name, /^(struct|union|enum)\b/.exec(returnType)?.[1] ?? nativeKind) : name,
        kind: memberKind === 'method' && !parent ? 'function' : memberKind,
        modifiers: c && nativeKind === 'define' ? [...modifiersOf(block), 'macro'] : modifiersOf(block),
        parent,
        signatures: signature ? [signature] : c ? [{ raw: cDeclaration(block, nativeKind, name), params: [] }] : [],
        type: signature ? undefined : returnType || undefined,
        ...(c && tag(block, 'initializer') ? { value: codeOf(tag(block, 'initializer') ?? '').replace(/^=\s*/, '') } : {}),
        doc:
          brief || detail
            ? { summary: brief, body: detail || undefined }
            : undefined,
        source: c ? nativeSource : { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
      }
      if (c && isDefinition) definitionIds.add(id)
      seen.set(id, sym)
      symbols.push(sym)

      // An enum's values are its API, and Doxygen nests them inside the
      // enum's own <memberdef> rather than emitting one each. Without this
      // every C++ enum reached the reference as a name with nothing under it:
      // 21 enums, 0 members. Each value carries its own descriptions, so they
      // are read here rather than inherited from the enum.
      if (attr(block, 'kind') === 'enum') {
        for (const v of block.matchAll(/<enumvalue([\s\S]*?)<\/enumvalue>/g)) {
          const value = v[1]
          if (attr(value, 'prot') !== 'public') continue
          const valueName = textOf(tag(value, 'name') ?? '')
          if (!valueName) continue
          const valueId = `${id}::${valueName}`
          if (seen.has(valueId)) continue
          const valueBrief = textOf(tag(value, 'briefdescription') ?? '')
          const valueDetail = textOf(tag(value, 'detaileddescription') ?? '')
          const valueSym: ApiSymbol = {
            id: valueId,
            publicId: valueId,
            ...(c ? { qualifiedName: valueName, namespace: '', value: codeOf(tag(value, 'initializer') ?? '').replace(/^=\s*/, '') || undefined } : {}),
            name: valueName,
            // No `variant` kind exists, and a named member of an enum is
            // what a constant is — the same choice the tree-sitter specs make.
            kind: 'constant',
            modifiers: [],
            parent: id,
            signatures: c ? [{ raw: `${valueName}${tag(value, 'initializer') ? ` ${codeOf(tag(value, 'initializer') ?? '')}` : ''}`, params: [] }] : [],
            doc:
              valueBrief || valueDetail
                ? { summary: valueBrief, body: valueDetail || undefined }
                : undefined,
            source: c ? { file: sourceFile } : { file: location?.[1] ?? file, line: Number(location?.[2] ?? 1) },
          }
          if (c && attr(value, 'id')) nativeIds.set(attr(value, 'id')!, valueId)
          seen.set(valueId, valueSym)
          symbols.push(valueSym)
        }
      }
    }
  }

  if (c) {
    for (const symbol of symbols) {
      const refs = pendingReferences.get(symbol.id) ?? []
      const unique = new Map<string, NonNullable<ApiSymbol['references']>[number]>()
      for (const ref of refs) {
        const target = nativeIds.get(ref.nativeId)
        if (!target || !seen.has(target) || target === symbol.id) continue
        // Doxygen references do not distinguish calls from address-taking.
        // Preserve that uncertainty instead of claiming a compiler call edge.
        const kind = ref.kind
        const related = seen.get(target)!
        if (kind === 'reference' && related.kind === 'function'
          && related.modifiers.includes('static') && related.source.file !== symbol.source.file) {
          options.onDiagnostic?.(`Omitted cross-file static reference ${symbol.id} -> ${target} (${ref.nativeId}); ${symbol.source.file} -> ${related.source.file}`)
          continue
        }
        unique.set(`${kind}:${target}`, { target, kind })
        if (kind === 'type') (symbol.imports ??= {})[ref.name] = target
      }
      // Doxygen omits a ref when a C tag and a function share the name.
      // An explicit tag keyword resolves in C's tag namespace, never to the
      // same-named ordinary function or typedef.
      const types = [...(pendingTypes.get(symbol.id) ?? []), symbol.type, ...symbol.signatures.flatMap((signature) => [signature.returns, ...signature.params.map((param) => param.type)])]
      for (const type of types) for (const match of (type ?? '').matchAll(/\b(struct|union|enum)\s+([A-Za-z_]\w*)/g)) {
        const target = `c:${match[1]}:${match[2]}`
        if (!seen.has(target) || target === symbol.id) continue
        unique.set(`type:${target}`, { target, kind: 'type' })
        ;(symbol.imports ??= {})[match[2]] = target
      }
      if (unique.size) symbol.references = [...unique.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target))
      const displayType = (type: string | undefined) => type && syntheticCName(type)
        ? `anonymous ${/\b(struct|union|enum)\b/.exec(type)?.[1] ?? 'type'}` : type
      if (symbol.type) symbol.type = displayType(symbol.type)
      for (const signature of symbol.signatures) {
        if (syntheticCName(signature.returns ?? '') || signature.params.some((param) => syntheticCName(param.type ?? ''))) delete signature.raw
        if (signature.returns) signature.returns = displayType(signature.returns)
        for (const param of signature.params) if (param.type) param.type = displayType(param.type)
      }
    }
  }
  if (c) cCalls(documents, nativeIds, seen, options.onDiagnostic)
  return symbols
}
