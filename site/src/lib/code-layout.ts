import { parameterId, qualifiedNameOf, type ApiSymbol, type Signature, type SymbolIndex } from '@libtmux/api-model'

/** Documentation surface budgets, independent of a port's source formatter. */
export const CODE_COLUMNS = { api: 60, example: 80 } as const
export type CodeSurface = keyof typeof CODE_COLUMNS
export interface CodeWidthFailure { line: number; columns: number; limit: number }
export type CodeSyntax = { start: number; end: number } & (
  { kind: 'name' | 'literal' | 'keyword' } | { kind: 'parameter'; parameter: number }
)
export interface CodeLayout {
  text: string
  limit: number
  failures: CodeWidthFailure[]
  syntax?: CodeSyntax[]
  /** The leading native owner fragment, when it distinguishes callable scope. */
  contextEnd?: number
}
export type SignatureSpan = ReturnType<SymbolIndex['linkType']>[number] & { declarationName?: true; nonReference?: true; enclosingContext?: true }

/** Resolve references at render time; cached layouts contain grammar, never URLs. */
export function signatureSpans(layout: CodeLayout, index: SymbolIndex, symbol: ApiSymbol, signature: Signature): SignatureSpan[] {
  const spans: SignatureSpan[] = []
  // The callable's own bindings do not exist in its enclosing declaration.
  const ownerScope: Signature = { params: [], enclosingTypeParamNames: signature.enclosingTypeParamNames }
  const linkText = (start: number, end: number): SignatureSpan[] => {
    if (layout.contextEnd === undefined || start >= layout.contextEnd) return index.linkType(layout.text.slice(start, end), symbol, signature)
    const boundary = Math.min(end, layout.contextEnd)
    return [...index.linkType(layout.text.slice(start, boundary), symbol, ownerScope),
      ...(end > boundary ? index.linkType(layout.text.slice(boundary, end), symbol, signature) : [])]
  }
  let offset = 0
  for (const range of layout.syntax ?? []) {
    spans.push(...linkText(offset, range.start))
    const text = layout.text.slice(range.start, range.end)
    if (range.kind === 'name') spans.push({ text, declaration: true, declarationName: true })
    else if (range.kind === 'parameter') spans.push({ text, declaration: true, link: {
      href: `#${encodeURIComponent(parameterId(symbol, signature.params[range.parameter]!.name))}`, external: false,
    } })
    else if (range.kind === 'keyword') spans.push({ text, keyword: true, nonReference: true })
    else spans.push({ text, nonReference: true })
    offset = range.end
  }
  spans.push(...linkText(offset, layout.text.length))
  if (layout.contextEnd === undefined) return spans
  let position = 0
  return spans.flatMap((span) => {
    const end = Math.max(0, Math.min(span.text.length, layout.contextEnd! - position))
    position += span.text.length
    return end === 0 ? [span] : end === span.text.length ? [{ ...span, enclosingContext: true as const }]
      : [{ ...span, text: span.text.slice(0, end), enclosingContext: true as const }, { ...span, text: span.text.slice(end) }]
  })
}

/** Measure printed columns after tab expansion; font and viewport checks are separate. */
export async function codeWidthFailures(text: string, surface: CodeSurface, tabWidth = 8): Promise<CodeWidthFailure[]> {
  const { util } = await import('prettier')
  const limit = CODE_COLUMNS[surface]
  return text.split(/\r?\n/).flatMap((line, index) => {
    let columns = 0
    for (const [i, segment] of line.split('\t').entries()) {
      if (i) columns += tabWidth - columns % tabWidth
      columns += util.getStringWidth(segment)
    }
    return columns > limit ? [{ line: index + 1, columns, limit }] : []
  })
}

/** Callable headers are source projections; no body or inferred modifier is displayed. */
function typescriptHeader(symbol: ApiSymbol, signature: Signature): string {
  const modifiers = (['private', 'static', 'async'] as const).filter((modifier) => symbol.modifiers.includes(modifier))
  const generator = symbol.modifiers.includes('generator') ? '*' : ''
  const name = symbol.kind === 'function' ? `function${generator} ${symbol.name}` : `${generator}${symbol.name}`
  const parameters = signature.params.map((param) => `${param.variadic ? '...' : ''}${param.name}${param.optional && param.default === undefined ? '?' : ''}${param.type ? `: ${param.type}` : ''}${param.default !== undefined ? ` = ${param.default}` : ''}`).join(', ')
  const generics = signature.typeParams?.length ? `<${signature.typeParams.join(', ')}>` : ''
  return `${modifiers.length ? modifiers.join(' ') + ' ' : ''}${name}${generics}(${parameters})${signature.returns ? `: ${signature.returns}` : ''}`
}

const typescriptLayouts = new Map<string, Promise<CodeLayout>>()

/** Format native TypeScript grammar, then check the result against the hard surface cap. */
export function typescriptSignatureLayout(symbol: ApiSymbol, signature: Signature): Promise<CodeLayout> {
  const header = typescriptHeader(symbol, signature)
  const method = symbol.kind !== 'function'
  const key = JSON.stringify([header, method, CODE_COLUMNS.api])
  let pending = typescriptLayouts.get(key)
  if (!pending) {
    pending = formatTypeScriptHeader(header, method)
    typescriptLayouts.set(key, pending)
  }
  return pending
}

async function formatTypeScriptHeader(header: string, method: boolean): Promise<CodeLayout> {
  const [{ format }, typescript, estree, ts] = await Promise.all([
    import('prettier'), import('prettier/plugins/typescript'),
    import('prettier/plugins/estree'), import('typescript'),
  ])
  // The synthetic body lets actual async methods, defaults and constructors
  // use native grammar. AST positions remove only that body and its wrapper.
  const input = method ? `class __Documentation { ${header} {} }` : `${header} {}`
  const source = await format(input, { parser: 'typescript', plugins: [typescript, estree],
    printWidth: CODE_COLUMNS.api + (method ? 2 : 0), tabWidth: 2, useTabs: false,
    trailingComma: 'all', endOfLine: 'lf' })
  const tree = ts.createSourceFile('signature.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = tree.statements[0]
  const declaration = method && statement && ts.isClassDeclaration(statement) ? statement.members[0] : statement
  if (!declaration || (!ts.isMethodDeclaration(declaration) && !ts.isConstructorDeclaration(declaration) && !ts.isFunctionDeclaration(declaration)) || !declaration.body) {
    throw new Error(`Cannot format TypeScript API header: ${header}`)
  }
  const name = ts.isConstructorDeclaration(declaration)
    ? declaration.getChildren(tree).find((node) => node.kind === ts.SyntaxKind.ConstructorKeyword) : declaration.name
  const syntax: CodeSyntax[] = [
    ...(name ? [{ start: name.getStart(tree), end: name.end, kind: 'name' as const }] : []),
    ...declaration.parameters.map((parameter, i) => ({ start: parameter.name.getStart(tree), end: parameter.name.end, kind: 'parameter' as const, parameter: i })),
  ]
  const literals: { start: number; end: number }[] = []
  const collectLiterals = (node: import('typescript').Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isRegularExpressionLiteral(node)) {
      const range = { start: node.getStart(tree), end: node.end }
      literals.push(range)
      if (!syntax.some((outer) => outer.start <= range.start && outer.end >= range.end)) syntax.push({ ...range, kind: 'literal' })
    }
    ts.forEachChild(node, collectLiterals)
  }
  collectLiterals(declaration)
  const start = declaration.getStart(tree)
  let offset = start
  const removed: number[] = []
  const text = source.slice(start, declaration.body.getStart(tree)).trimEnd()
    .split('\n').map((line, index) => {
      // A wrapper never owns indentation inside a multiline string literal.
      const literal = literals.some((range) => offset > range.start && offset < range.end)
      const dedent = method && index && !literal && line.startsWith('  ')
      if (dedent) removed.push(offset)
      offset += line.length + 1
      return dedent ? line.slice(2) : line
    }).join('\n')
  const position = (sourceOffset: number) => sourceOffset - start - removed.reduce((total, at) => total + Math.min(2, Math.max(0, sourceOffset - at)), 0)
  return { text, limit: CODE_COLUMNS.api, failures: await codeWidthFailures(text, 'api'),
    syntax: syntax.sort((a, b) => a.start - b.start).map((range) => ({ ...range, start: position(range.start), end: position(range.end) })),
  }
}

export function supportsTypeScriptSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'ts' && ['method', 'function'].includes(symbol.kind) && symbol.signatures.length > 0
}

export function supportsGoSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'go' && ['method', 'function'].includes(symbol.kind) && symbol.signatures.length > 0 &&
    symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
}

export function supportsJavaSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'java' && (symbol.kind === 'method' || (symbol.kind === 'interface' && symbol.modifiers.includes('annotation'))) && symbol.signatures.length > 0 &&
    symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
}

export function supportsRustSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'rs' && ['method', 'function'].includes(symbol.kind) && symbol.signatures.length > 0 &&
    symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
}

/** F# `val` and `member` signatures; union cases, fields and type headers keep their native one-line text. */
export function supportsFSharpSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'fsharp' && ['function', 'method', 'constant'].includes(symbol.kind) && symbol.signatures.length > 0 &&
    symbol.signatures.every((signature) => /^(?:val|member)\s/.test(signature.raw ?? ''))
}

export interface CSharpParameter { name: string; /** Position in `Signature.params`, which anchors link to. */ index: number; text: string }

/**
 * The parameters of an extracted C# callable as declared. Extraction splits
 * `params T[] name` into a typeless name that follows the array type, which
 * becomes a name of its own; this shape is rejoined and nothing else is guessed.
 */
export function csharpParameters(signature: Signature): CSharpParameter[] | undefined {
  const identifier = /^[A-Za-z_]\w*$/
  const parameters: CSharpParameter[] = []
  for (let at = 0; at < signature.params.length; at++) {
    const param = signature.params[at]!
    const next = signature.params[at + 1]
    if (param.type && identifier.test(param.name)) {
      parameters.push({ name: param.name, index: at, text: `${param.type} ${param.name}${param.default !== undefined ? ` = ${param.default}` : ''}` })
    } else if (param.name.endsWith('[]') && param.default === undefined && next && !next.type && next.default === undefined && identifier.test(next.name)) {
      parameters.push({ name: next.name, index: at + 1, text: `params ${param.name} ${next.name}` })
      at++
    } else return undefined
  }
  return parameters
}

/** Members are projected from the extracted callable; records keep their source header. */
export function supportsCSharpSignatures(symbol: ApiSymbol, language?: string): boolean {
  if (language !== 'csharp' || !symbol.signatures.length) return false
  if (['class', 'struct'].includes(symbol.kind)) return symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
  return symbol.kind === 'method' && symbol.signatures.every((signature) => Boolean(signature.raw?.trim()) ||
    (csharpParameters(signature) !== undefined && (signature.typeParams ?? []).every((param) => /^(?:(?:in|out)\s+)?[A-Za-z_]\w*$/.test(param))))
}

/** Help syntax is source text for the command; it has no formatter of its own. */
export function supportsPowerShellSignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'powershell' && symbol.signatures.length > 0 && symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
}

export function supportsRubySignatures(symbol: ApiSymbol, language?: string): boolean {
  return language === 'ruby' && symbol.kind === 'method' && symbol.signatures.length > 0 &&
    symbol.signatures.every((signature) => Boolean(signature.raw?.trim()))
}

/** Prepare one layout per overload for both HTML and the Markdown twin. */
export async function apiSignatureLayouts(symbol: ApiSymbol, language?: string): Promise<Map<Signature, CodeLayout>> {
  if (language === 'rs' && ['method', 'function'].includes(symbol.kind) && symbol.signatures.length && !supportsRustSignatures(symbol, language)) {
    throw new Error(`Unavailable native Rust callable header: ${symbol.id}`)
  }
  if (supportsRustSignatures(symbol, language)) {
    const { rustSignatureLayout } = await import('./rust-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await rustSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsTypeScriptSignatures(symbol, language)) {
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await typescriptSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsGoSignatures(symbol, language)) {
    const { goSignatureLayout } = await import('./go-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await goSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsJavaSignatures(symbol, language)) {
    const { javaSignatureLayout } = await import('./java-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await javaSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsFSharpSignatures(symbol, language)) {
    const { fsharpSignatureLayout } = await import('./fsharp-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await fsharpSignatureLayout(signature)] as const)))
  }
  if (supportsCSharpSignatures(symbol, language)) {
    const { csharpSignatureLayout } = await import('./csharp-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await csharpSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsPowerShellSignatures(symbol, language)) {
    const { powershellSignatureLayout } = await import('./powershell-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await powershellSignatureLayout(symbol, signature)] as const)))
  }
  if (language === 'py' && symbol.signatures.length) {
    // The export prints the qualified name, so the layout reserves its columns.
    const { pythonSignatureLayout } = await import('./python-code-layout')
    const name = qualifiedNameOf(symbol)
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await pythonSignatureLayout(signature, { name })] as const)))
  }
  if (language === 'julia' && symbol.signatures.some((signature) => signature.raw?.trim())) {
    const { juliaSignatureLayout } = await import('./julia-code-layout')
    return new Map(await Promise.all(symbol.signatures.filter((signature) => signature.raw?.trim()).map(async (signature) =>
      [signature, await juliaSignatureLayout(symbol, signature)] as const)))
  }
  if (supportsRubySignatures(symbol, language)) {
    const { rubySignatureLayout } = await import('./ruby-code-layout')
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await rubySignatureLayout(symbol, signature)] as const)))
  }
  if ((language === 'scala' || language === 'kotlin') && ['method', 'function'].includes(symbol.kind)) {
    const { jvmSignatureLayout } = await import('./jvm-code-layout')
    return new Map(await Promise.all(symbol.signatures.filter((signature) => signature.raw).map(async (signature) =>
      [signature, await jvmSignatureLayout(signature, language)] as const)))
  }
  return new Map()
}
