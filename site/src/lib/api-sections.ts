import { createHash } from 'node:crypto'
import { commandFacts, memberTier, parameterBindingFacts, parameterBindingText, typeParametersOf, type ApiSymbol, type MemberSignals, type Param, type Signature, type SymbolIndex } from '@libtmux/api-model'
import { apiGlossaryHref } from './api-glossary'
import { csharpParameters, supportsCSharpSignatures, supportsElixirSignatures, supportsGoSignatures, supportsJavaSignatures, supportsLuaSignatures, supportsRubySignatures, supportsRustSignatures, supportsTypeScriptSignatures, swiftBaseName } from './code-layout'

export interface ApiSection {
  id: string
  label: string
  nested?: boolean
  count?: number
}

/** Scalar properties of a native constant object use a value table. */
export function hasScalarMembers(owner: ApiSymbol, members: ApiSymbol[]): boolean {
  return Boolean(owner.declarations?.some((declaration) => declaration.kind === 'constant')) &&
    members.length > 0 && members.every((member) => member.kind === 'property' &&
      member.modifiers.includes('readonly') && member.value !== undefined)
}

/** Match the rendered declaration in HTML and Markdown, including long lists. */
export function signatureParameterText(param: Param, port?: string): string {
  const variadic = param.variadic === 'keyword' ? '**' : param.variadic ? (port === 'ts' ? '...' : '*') : ''
  return `${variadic}${param.name}${param.optional ? '?' : ''}${param.type ? `: ${param.type}` : ''}${param.default !== undefined ? ` = ${param.default}` : ''}`
}

export function signatureMultiline(symbol: ApiSymbol, signature: Signature, port?: string): boolean {
  const params = signature.params.map((param) => signatureParameterText(param, port)).join(', ')
  return params.includes('\n') || (params.length > 0 && symbol.name.length + params.length + (signature.returns?.length ?? 0) + 6 > 88)
}

/** Keep native declaration syntax consistent in HTML and copied Markdown. */
export function usesNativeSignatures(symbol: ApiSymbol, port?: string): boolean {
  return (port === 'rs' && Boolean(symbol.variant)) || supportsRustSignatures(symbol, port) || supportsTypeScriptSignatures(symbol, port) || supportsGoSignatures(symbol, port) || supportsJavaSignatures(symbol, port) || supportsCSharpSignatures(symbol, port) || supportsRubySignatures(symbol, port) || supportsLuaSignatures(symbol, port) || supportsElixirSignatures(symbol, port) || ['kotlin', 'scala', 'fsharp', 'c', 'powershell', 'julia'].includes(port ?? '') ||
    (port === 'cxx' && symbol.signatures.length > 0 && symbol.signatures.every((signature) => Boolean(signature.raw)))
}

/** Break only the outer argument list; Julia types and defaults can contain commas. */
function juliaSignatureText(raw: string): string {
  if (raw.length <= 88 && !raw.includes('\n')) return raw
  const stack: { delimiter: string; interpolate?: boolean }[] = []
  let open = -1
  let start = -1
  let parts: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!
    const frame = stack.at(-1)
    if (frame?.interpolate !== undefined) {
      if (char === '\\') i++
      else if (raw.startsWith(frame.delimiter, i)) { stack.pop(); i += frame.delimiter.length - 1 }
      // Interpolation may contain nested strings, calls and punctuation.
      else if (frame.interpolate && raw.startsWith('$(', i)) { stack.push({ delimiter: ')' }); i++ }
      continue
    }
    if (raw.startsWith('#=', i)) {
      let depth = 1
      for (i += 2; i < raw.length && depth; i++) {
        if (raw.startsWith('#=', i)) { depth++; i++ }
        else if (raw.startsWith('=#', i)) { depth--; i++ }
      }
      i--
      continue
    }
    if (char === '#') {
      const end = raw.indexOf('\n', i)
      if (end < 0) return raw
      i = end
      continue
    }
    if (char === '"' || char === '`') {
      const quote = raw.startsWith('"""', i) ? '"""' : char
      stack.push({ delimiter: quote, interpolate: !/[\p{L}\p{N}_!]$/u.test(raw.slice(0, i)) })
      i += quote.length - 1
      continue
    }
    // A character literal is distinct from the postfix adjoint operator.
    if (char === "'") {
      const prefix = raw.slice(0, i)
      const word = /[\p{L}\p{N}\p{M}\p{Pc}!]+$/u.exec(prefix)?.[0]
      // Julia permits adjacent literals after prefix keywords, e.g. return')'.
      const keyword = word && /^(?:baremodule|begin|break|const|continue|do|export|for|function|global|if|import|let|local|macro|module|quote|return|struct|try|using|while|catch|finally|else|elseif)$/.test(word)
      if ((word && !keyword) || /[)\]}'"`.]$/.test(prefix)) continue
      const literal = /^'(?:\\(?:[0-7]{1,3}|[xuU][0-9a-fA-F]+|.)|[^'\\])'/u.exec(raw.slice(i))
      if (literal) { i += literal[0].length - 1; continue }
    }
    if (char === '(' || char === '[' || char === '{') {
      if (!stack.length && char === '(') { open = i; start = i + 1; parts = [] }
      stack.push({ delimiter: char === '(' ? ')' : char === '[' ? ']' : '}' })
    } else if (char === ')' || char === ']' || char === '}') {
      if (frame?.delimiter !== char) return raw
      stack.pop()
      if (!stack.length && open >= 0) {
        // Callable receivers and quoted operator names precede the argument list.
        if (/^\s*\(/.test(raw.slice(i + 1))) { open = -1; continue }
        const last = raw.slice(start, i).trim()
        if (last) parts.push(last)
        if (!parts.length) return raw
        const keywordOnly = parts[0] === ';' ? parts.shift() : ''
        return `${raw.slice(0, open + 1)}${keywordOnly}\n    ${parts.join('\n    ')}\n${raw.slice(i)}`
      }
    } else if (open >= 0 && stack.length === 1 && (char === ',' || char === ';')) {
      parts.push(raw.slice(start, i + 1).trim())
      start = i + 1
    }
  }
  return raw
}

/** Keep native declaration layout identical in HTML and copied Markdown. */
export function nativeSignatureText(symbol: ApiSymbol, signature: Signature, language?: string): string {
  const raw = signature.raw ?? symbol.name
  if (language === 'powershell') return raw.replace(/\s+(?=\[*-|\[<CommonParameters>\])/g, '\n    ')
  return language === 'julia' ? juliaSignatureText(raw) : raw
}

function signatureLabels(symbol: ApiSymbol, port?: string): string[] {
  const name = port === 'swift' ? swiftBaseName(symbol.name) : symbol.name
  const labels = symbol.signatures.map((signature) =>
    signature.label ?? `${name}(${signature.params.map((param) => param.name).join(', ')})`)
  return labels.map((label, i) => labels.filter((entry) => entry === label).length > 1
    ? `${label} [overload ${i + 1}]` : label)
}

/** The fields shown by ApiEntry, shared with its section navigation. */
export function apiEntryFields(symbol: ApiSymbol, port?: string) {
  // Every parameter the declaration has is listed with its type, documented or not.
  const labels = signatureLabels(symbol, port)
  // Python's extractor merges @overload stubs followed by their implementation.
  // The implementation docstring documents the complete callable, not one stub.
  const familyDocumentation = port === 'py' && !symbol.modifiers.includes('overload')
    ? symbol.signatures.length - 1 : -1
  const collect = <T>(read: (signature: Signature, index: number) => T[]) => {
    const fields = new Map<string, { value: T; signatures: Set<number> }>()
    symbol.signatures.forEach((signature, i) => {
      for (const value of read(signature, i)) {
        const key = JSON.stringify(value)
        const field = fields.get(key) ?? { value, signatures: new Set<number>() }
        field.signatures.add(i)
        fields.set(key, field)
      }
    })
    return [...fields.values()].map(({ value, signatures }) => ({
      ...value,
      overloads: signatures.size < symbol.signatures.length && !signatures.has(familyDocumentation)
        ? [...signatures].map((i) => labels[i]) : [],
    }))
  }
  // A type's own parameters apply to every signature; a callable's belong to the overload that declares them.
  const own = typeParametersOf(symbol, port).map((parameter) => ({ ...parameter, overloads: [] as string[] }))
  const declared = new Set(own.map((parameter) => JSON.stringify([parameter.name, parameter.bound, parameter.default])))
  return {
    typeParameters: [...own, ...collect((signature) => typeParametersOf(signature, port)
      .filter((parameter) => !declared.has(JSON.stringify([parameter.name, parameter.bound, parameter.default]))))],
    params: collect((signature, i) => {
      // The implementation is the complete callable; its @overload stubs repeat narrower parameters.
      if (familyDocumentation > 0 && i !== familyDocumentation) return []
      // A C# params array is extracted as two entries; only the declared name is a parameter.
      const declared = port === 'csharp' ? csharpParameters(signature) : undefined
      // Python, Rust and Lua spell the receiver as a first parameter; the call never passes it.
      // A C function's `self` is an argument like any other.
      const receiver = (param: Param, position: number) => port !== 'c' && position === 0 && !param.doc &&
        (param.name === 'self' || (port === 'py' && param.name === 'cls'))
      return signature.params.filter((param, position) => !receiver(param, position) &&
        (!declared || declared.some((entry) => entry.index === position)))
    }),
    returns: collect((signature) => signature.returnsDoc ? [{ doc: signature.returnsDoc }] : []),
    raises: collect((signature) => signature.raises ?? []),
  }
}

/** The parameters of enclosing declarations that the symbol's own types mention. */
export function apiInheritedTypeParameters(symbol: ApiSymbol, index?: SymbolIndex) {
  return index?.inheritedTypeParameters(symbol) ?? []
}

/** Only sections that the declaration actually renders, in reading order. */
export function apiEntrySections(symbol: ApiSymbol, port?: string, index?: SymbolIndex): ApiSection[] {
  const anchor = symbol.publicId ?? symbol.id
  const fields = apiEntryFields(symbol, port)
  const sections: ApiSection[] = []
  if (symbol.doc?.body) sections.push({ id: `${anchor}.description`, label: 'Description' })
  if (symbol.command) sections.push({ id: `${anchor}.command`, label: 'Command details' })
  if (apiMethodDetails(symbol).length) sections.push({ id: `${anchor}.methods`, label: 'Methods' })
  if (symbol.doc?.examples?.length) sections.push({ id: `${anchor}.examples`, label: 'Examples' })
  if (symbol.doc?.references?.length) sections.push({ id: `${anchor}.references`, label: 'References' })
  if (fields.typeParameters.length || apiInheritedTypeParameters(symbol, index).length) {
    sections.push({ id: `${anchor}.type-parameters`, label: 'Type parameters' })
  }
  if (fields.params.length) sections.push({ id: `${anchor}.parameters`, label: 'Parameters' })
  if (fields.returns.length) sections.push({ id: `${anchor}.returns`, label: 'Returns' })
  if (fields.raises.length) sections.push({ id: `${anchor}.errors`, label: 'Errors' })
  return sections
}

/** Dispatch methods retain their own documentation and stable fragment identities. */
export function apiMethodDetails(symbol: ApiSymbol) {
  const labels = signatureLabels(symbol)
  return symbol.signatures.flatMap((signature, i) => signature.methodKind ? [{
    signature,
    id: `${symbol.publicId ?? symbol.id}.method-${createHash('sha256').update(signature.identity!).digest('hex').slice(0, 16)}`,
    label: signature.raw ?? signature.label ?? symbol.name,
    overloadLabel: labels[i],
  }] : [])
}

/** The same native command facts appear in HTML and copied Markdown. */
export function apiCommandFacts(symbol: ApiSymbol, contextPath?: string): { label: string; value: string }[] {
  const command = symbol.command
  return command ? commandFacts(command, apiGlossaryHref(command.kind, contextPath)) : []
}

/** Native help links prefer the same generated declaration in this reference. */
export function apiCommandRelatedLinks(symbol: ApiSymbol, index?: SymbolIndex) {
  const links = (symbol.command?.relatedLinks ?? []).flatMap((link) => {
    if (!link.href) return []
    const native = /^https:\/\/github\.com\/libtmux\/libtmux-powershell\/blob\/[^/]+\/docs\/reference\/([^/]+)\/([^/]+)\.md$/.exec(link.href)
    const target = native ? index?.resolve(`${native[1]}\\${native[2]}`, 'any', symbol) : undefined
    if (target?.symbol?.id === symbol.id) return []
    return [{ text: target?.symbol?.name ?? link.text ?? link.href,
      href: target?.symbol ? target.href : link.href, symbol: target?.symbol }]
  })
  return links.filter((link, i) => links.findIndex((entry) => entry.href === link.href) === i)
}

export { parameterBindingFacts, parameterBindingText }

/** The page that documents PowerShell's common parameters, with the words that link to it; the link verifier reads the pair from here. */
const COMMON_PARAMETERS = { title: 'common parameter behavior', url: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_commonparameters?view=powershell-7.4' }
export const POWER_SHELL_COMMON_HELP = COMMON_PARAMETERS.url
export const POWER_SHELL_COMMON_HELP_TITLE = COMMON_PARAMETERS.title

/** Group the existing semantic order without sorting or omitting members. */
export function apiMemberGroups(members: ApiSymbol[], signals: MemberSignals) {
  const groups = [
    { id: 'api-parent-objects', label: 'Parent objects', members: [] as ApiSymbol[] },
    { id: 'api-collections', label: 'Collections and queries', members: [] as ApiSymbol[] },
    { id: 'api-operations', label: 'Common operations', members: [] as ApiSymbol[] },
    { id: 'api-other-members', label: 'Other members', members: [] as ApiSymbol[] },
  ]
  for (const member of members) {
    const tier = memberTier(member, signals)
    const group = tier === 'parent' ? 0 : tier === 'listing' || tier === 'query' ? 1 : tier === 'concept' || tier === 'discussed' ? 2 : 3
    groups[group].members.push(member)
  }
  return groups.filter((group) => group.members.length > 0)
}

/** Related declarations come from ownership, inheritance and return types. */
export function relatedApiTypes(owner: ApiSymbol, members: ApiSymbol[], index: SymbolIndex, parent?: ApiSymbol, options: { includeInternal?: boolean } = {}) {
  const types = new Map<string, ApiSymbol>()
  const add = (symbol?: ApiSymbol) => {
    if (!symbol || symbol.id === owner.id || (!options.includeInternal && symbol.apiScope === 'internal') ||
        !['class', 'struct', 'union', 'interface', 'trait', 'enum', 'typealias'].includes(symbol.kind)) return
    types.set(symbol.publicId ?? symbol.id, symbol)
  }
  add(parent)
  for (const type of owner.extends ?? []) {
    for (const span of index.linkType(type, owner)) add(span.link?.symbol)
  }
  for (const symbol of [owner, ...members]) {
    if (options.includeInternal && symbol.type) {
      for (const span of index.linkType(symbol.type, symbol)) add(span.link?.symbol)
    }
    for (const signature of symbol.signatures) {
      for (const type of [signature.returns, ...(options.includeInternal ? signature.params.map((param) => param.type) : [])]) {
        if (type) for (const span of index.linkType(type, symbol)) add(span.link?.symbol)
      }
    }
  }
  return [...types.values()].slice(0, 6)
}

/** Describe unnamed native types without inventing a compilable declaration. */
export function anonymousDeclarationLabel(symbol: ApiSymbol): string {
  return symbol.type ? `${symbol.name}: ${symbol.type}` : `Anonymous ${symbol.kind}`
}
