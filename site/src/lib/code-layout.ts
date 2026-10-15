import { parameterId, type ApiSymbol, type Signature, type SymbolIndex } from '@libtmux/api-model'

/** Documentation surface budgets, independent of a port's source formatter. */
export const CODE_COLUMNS = { api: 60, example: 80 } as const
export type CodeSurface = keyof typeof CODE_COLUMNS
export interface CodeWidthFailure { line: number; columns: number; limit: number }
export type CodeSyntax = { start: number; end: number } & (
  { kind: 'name' | 'literal' } | { kind: 'parameter'; parameter: number }
)
export interface CodeLayout {
  text: string
  limit: number
  failures: CodeWidthFailure[]
  syntax?: CodeSyntax[]
}
export type SignatureSpan = ReturnType<SymbolIndex['linkType']>[number] & { declarationName?: true }

/** Resolve references at render time; cached layouts contain grammar, never URLs. */
export function signatureSpans(layout: CodeLayout, index: SymbolIndex, symbol: ApiSymbol, signature: Signature): SignatureSpan[] {
  const spans: SignatureSpan[] = []
  let offset = 0
  for (const range of layout.syntax ?? []) {
    spans.push(...index.linkType(layout.text.slice(offset, range.start), symbol, signature))
    const text = layout.text.slice(range.start, range.end)
    if (range.kind === 'name') spans.push({ text, declaration: true, declarationName: true })
    else if (range.kind === 'parameter') spans.push({ text, declaration: true, link: {
      href: `#${encodeURIComponent(parameterId(symbol, signature.params[range.parameter]!.name))}`, external: false,
    } })
    else spans.push({ text })
    offset = range.end
  }
  spans.push(...index.linkType(layout.text.slice(offset), symbol, signature))
  return spans
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

/** Prepare one layout per overload for both HTML and the Markdown twin. */
export async function apiSignatureLayouts(symbol: ApiSymbol, language?: string): Promise<Map<Signature, CodeLayout>> {
  if (supportsTypeScriptSignatures(symbol, language)) {
    return new Map(await Promise.all(symbol.signatures.map(async (signature) =>
      [signature, await typescriptSignatureLayout(symbol, signature)] as const)))
  }
  if ((language === 'scala' || language === 'kotlin') && ['method', 'function'].includes(symbol.kind)) {
    const { jvmSignatureLayout } = await import('./jvm-code-layout')
    return new Map(await Promise.all(symbol.signatures.filter((signature) => signature.raw).map(async (signature) =>
      [signature, await jvmSignatureLayout(signature, language)] as const)))
  }
  return new Map()
}
