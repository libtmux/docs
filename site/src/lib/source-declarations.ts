/**
 * Where a declaration sits in its source file.
 *
 * The API models record the line a declaration starts on. A reader looking at
 * the source wants the whole declaration: the doc comment above it and the body
 * below it. This finds those lines from the text, with one scanner per layout
 * (braces, indentation, `end` keywords, parentheses, a closing full stop), so
 * the page and the pane highlight what the reference documents rather than a
 * single line.
 */
import type { ApiModel, ApiSymbol } from '@libtmux/api-model'
import { pinnedSource, requirePairedSources, sourceFilesFor } from './api-source-pages'
import { languageForFile } from './code-language'
import { nativeQualifiedName, nativeShortName } from './native-name'

/** The code-fence language of a file, from its name. */
export function sourceLanguage(file: string): string {
  return languageForFile(file) ?? 'text'
}

type Layout = 'brace' | 'indent' | 'end' | 'paren' | 'period' | 'line'

/** How a language ends a declaration. */
const LAYOUT: Record<string, Layout> = {
  python: 'indent', haskell: 'indent', ocaml: 'indent', fsharp: 'indent',
  ruby: 'end', lua: 'end', elixir: 'end', julia: 'end',
  lisp: 'paren', clojure: 'paren', erlang: 'period',
  json: 'line', yaml: 'line', toml: 'line', xml: 'line', text: 'line', bash: 'line', cmake: 'line',
}

/** What a line above a declaration may be and still belong to it: a comment, a decorator or an attribute. */
const ADJOINING = /^\s*(?:\/\/|\/\*|\*|#|--|;|%|\(\*|@|\[<|\[[A-Za-z]|\{-)/

const indentOf = (text: string) => text.length - text.trimStart().length

/** The first line of the comment and attributes directly above `line`, 1-based. */
export function declarationStart(lines: readonly string[], line: number): number {
  let start = line
  while (start > 1) {
    const above = lines[start - 2] ?? ''
    if (/^\s*(?:"""|''')\s*$/.test(above)) {
      // A heredoc doc string: skip back to its opening quotes.
      let open = start - 3
      while (open >= 0 && !/(?:"""|''')\s*$/.test(lines[open] ?? '')) open--
      if (open < 0) break
      start = open + 1
    } else if (ADJOINING.test(above)) start--
    else break
  }
  return start
}

/**
 * Read one line of code with strings and comments blanked, so brackets inside
 * them do not count. A block comment or a raw string can span lines, which
 * `state` carries.
 */
function stripLine(text: string, language: string, state: { block: boolean; raw: string }): string {
  let out = ''
  const hash = /^(?:python|ruby|perl|raku|elixir|powershell|bash|yaml|toml)$/.test(language)
  const lineComment = hash ? '#' : /^(?:lua|haskell)$/.test(language) ? '--' : /^(?:lisp|clojure)$/.test(language) ? ';' : language === 'erlang' ? '%' : '//'
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (state.block) {
      if (text.startsWith('*/', i)) { state.block = false; i++ }
      continue
    }
    if (state.raw) {
      if (text.startsWith(state.raw, i)) { i += state.raw.length - 1; state.raw = '' }
      continue
    }
    if (text.startsWith(lineComment, i)) break
    if (!hash && language !== 'lisp' && language !== 'clojure' && language !== 'erlang' && text.startsWith('/*', i)) { state.block = true; i++; continue }
    if (c === '`' || (c === '"' && /^(?:python|elixir|ruby)$/.test(language) && text.startsWith('"""', i))) {
      state.raw = c === '`' ? '`' : '"""'
      i += state.raw.length - 1
      continue
    }
    if (c === '"') {
      i++
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
      continue
    }
    if (c === "'" && /^'(?:[^'\\]|\\.[^']*)'/.test(text.slice(i))) {
      i += /^'(?:[^'\\]|\\.[^']*)'/.exec(text.slice(i))![0].length - 1
      continue
    }
    out += c
  }
  return out
}

const depthOf = (code: string) => {
  let depth = 0
  for (const c of code) depth += '([{'.includes(c) ? 1 : ')]}'.includes(c) ? -1 : 0
  return depth
}

/** A line that cannot be the last of its declaration because it expects more. */
const CONTINUES = /(?:[=,+\-*/&|:.\\]|=>|->|\bwhere|\bextends|\bimplements)\s*$/

const BLOCK_OPENER = /^\s*(?:(?:private|protected|public|local|export|async|static|abstract|mutable)\s+)*(?:def|defp|defmacro|defmacrop|defmodule|defprotocol|defimpl|defstruct|defguard|class|module|function|struct|macro|begin|if|unless|case)\b/

const MAX_SPAN = 600

/** The last line of the declaration that starts on `line`, 1-based. */
export function declarationEnd(lines: readonly string[], line: number, language: string): number {
  const layout = LAYOUT[language] ?? 'brace'
  const first = lines[line - 1] ?? ''
  const state = { block: false, raw: '' }
  if (layout === 'line') return line

  if (layout === 'indent') {
    const base = indentOf(first)
    let last = line
    let signature = true
    for (let i = line + 1; i <= lines.length && i - line < MAX_SPAN; i++) {
      const text = lines[i - 1] ?? ''
      if (text.trim() === '') continue
      if (indentOf(text) > base) { last = i; signature = false } else if (signature && /^\s*[)\]}]/.test(text)) last = i
      else break
    }
    return last
  }

  if (layout === 'end') {
    const base = indentOf(first)
    const code = stripLine(first, language, state)
    const opens = /\bdo\s*$/.test(code) ? true : BLOCK_OPENER.test(code) && !/\bend\b/.test(code) && !/,\s*do:/.test(code)
    let depth = depthOf(code)
    let expects = CONTINUES.test(code.trimEnd())
    if (!opens && depth <= 0 && !expects) return line
    for (let i = line + 1; i <= lines.length && i - line < MAX_SPAN; i++) {
      const text = lines[i - 1] ?? ''
      const next = stripLine(text, language, state)
      depth += depthOf(next)
      if (opens && depth <= 0 && indentOf(text) === base && /^\s*end\b/.test(text)) return i
      if (!opens && next.trim() !== '') {
        expects = CONTINUES.test(next.trimEnd())
        if (depth <= 0 && !expects) return i
      }
    }
    return line
  }

  if (layout === 'period') {
    for (let i = line; i <= lines.length && i - line < MAX_SPAN; i++) {
      if (/\.\s*$/.test(stripLine(lines[i - 1] ?? '', language, state))) return i
    }
    return line
  }

  // Braces and parentheses: end where the nesting that began on the first line closes.
  let depth = 0
  let sawBody = false
  for (let i = line; i <= lines.length && i - line < MAX_SPAN; i++) {
    const code = stripLine(lines[i - 1] ?? '', language, state)
    const before = depth
    depth += depthOf(code)
    if (depth > before || /[{(]/.test(code)) sawBody = true
    if (depth > 0) continue
    const trimmed = code.trimEnd()
    if (layout === 'brace' && !sawBody && CONTINUES.test(trimmed)) continue
    if (layout === 'brace' && !trimmed.endsWith(';') && !trimmed.endsWith('}')) {
      const next = lines.slice(i).find((text) => text.trim() !== '')
      if (next !== undefined && /^\s*\{/.test(next) && i < lines.length) continue
    }
    return i
  }
  return line
}

/** The 1-based lines a declaration covers: its comment and attributes, its signature and its body. */
export function declarationRange(content: string | readonly string[], line: number, language: string): [from: number, to: number] {
  const lines = typeof content === 'string' ? content.split('\n') : content
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return [line, line]
  const to = declarationEnd(lines, line, language)
  return [declarationStart(lines, line), to > line + MAX_SPAN ? line : to]
}

/** A declaration the file holds, for the page's list and gutter. */
export interface SourceDeclaration {
  id: string
  name: string
  /** The name the reference page's heading uses, such as `Pane.Capture`. */
  title: string
  kind: string
  slug: string
  line: number
  from: number
  to: number
}

/** Every declaration of the model that cites `file`, in file order. */
export function declarationsIn(
  model: Pick<ApiModel, 'symbols'>, file: string, content: string, titleOf: (symbol: ApiSymbol) => string = (symbol) => symbol.name,
): SourceDeclaration[] {
  const lines = content.split('\n')
  const language = sourceLanguage(file)
  const seen = new Set<string>()
  const found: SourceDeclaration[] = []
  const take = (symbol: ApiSymbol, source: { file?: string; line?: number } | undefined) => {
    if (!source || source.file !== file || !source.line) return
    const key = `${symbol.id}:${source.line}`
    if (seen.has(key)) return
    seen.add(key)
    const [from, to] = declarationRange(lines, source.line, language)
    found.push({ id: symbol.publicId ?? symbol.id, name: symbol.name, title: titleOf(symbol), kind: symbol.kind, slug: symbol.slug ?? '', line: source.line, from, to })
  }
  for (const symbol of model.symbols) {
    take(symbol, symbol.source)
    for (const signature of symbol.signatures ?? []) take(symbol, signature.source)
  }
  return found.sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))
}

/** The heading a symbol's reference page carries: the owner and the member, in the port's own spelling. */
export function declarationTitle(model: Pick<ApiModel, 'port' | 'symbols'>, symbol: ApiSymbol): string {
  if (model.port === 'haskell' || model.port === 'erlang') return nativeShortName(model, symbol)
  if (model.port === 'clojure' || model.port === 'lisp') return nativeQualifiedName(model, symbol)
  const parent = symbol.parent ? model.symbols.find((entry) => entry.id === symbol.parent) : undefined
  return parent ? `${parent.name}.${symbol.name}` : symbol.name
}

/** What one source page shows: the file at its revision and the model's declarations in it. */
export interface SourcePageProps {
  port: string
  file: string
  content: string
  /** Absent for a file the model embeds, which has no repository to link. */
  origin?: { repo: string; revision: string }
  declarations: SourceDeclaration[]
}

/** The static routes of a port's source pages: one per pinned file and one per embedded file. */
export function sourceRoutes(port: string, model: Pick<ApiModel, 'port' | 'repo' | 'revision' | 'symbols' | 'generatedSources'>): { params: { path: string }; props: SourcePageProps }[] {
  requirePairedSources(port, model)
  const byFile = new Map<string, ApiSymbol[]>()
  for (const symbol of model.symbols) {
    for (const file of new Set([symbol.source?.file, ...(symbol.signatures ?? []).map((signature) => signature.source?.file)])) {
      if (!file) continue
      const symbols = byFile.get(file) ?? []
      symbols.push(symbol)
      byFile.set(file, symbols)
    }
  }
  const titleOf = (symbol: ApiSymbol) => declarationTitle(model, symbol)
  return sourceFilesFor(port).flatMap((file) => {
    const pinned = pinnedSource(port, file)
    const content = pinned?.content ?? model.generatedSources?.[file]
    if (content === undefined) return []
    return [{
      params: { path: file },
      props: {
        port, file, content,
        ...(pinned ? { origin: { repo: pinned.repo, revision: pinned.revision } } : {}),
        declarations: declarationsIn({ symbols: byFile.get(file) ?? [] }, file, content, titleOf),
      },
    }]
  })
}

/** `[file, line, from, to, title, kind]`: where a symbol's source is and how the pane names it. */
export type SourceIndexEntry = [file: string, line: number, from: number, to: number, title: string, kind: string]

/**
 * The symbols of a port that have a source page, by reference slug, so the
 * pane can show a declaration it was not opened from (a reload, a related type).
 */
export function sourceIndex(port: string, model: Pick<ApiModel, 'port' | 'repo' | 'revision' | 'symbols' | 'generatedSources'>, routes = sourceRoutes(port, model)): Record<string, SourceIndexEntry> {
  const declared = new Map<string, SourceDeclaration>()
  for (const { props } of routes) for (const declaration of props.declarations) declared.set(`${props.file}:${declaration.slug}:${declaration.line}`, declaration)
  const index: Record<string, SourceIndexEntry> = {}
  for (const symbol of model.symbols) {
    const { file, line } = symbol.source ?? {}
    const found = symbol.slug && file && line ? declared.get(`${file}:${symbol.slug}:${line}`) : undefined
    if (symbol.slug && file && found) index[symbol.slug] = [file, found.line, found.from, found.to, found.title, found.kind]
  }
  return index
}

/** The page's Markdown twin: the file in a fenced block, long enough to hold any backticks the file has. */
export function sourceMarkdown({ file, content, origin }: Pick<SourcePageProps, 'file' | 'content' | 'origin'>): string {
  const language = sourceLanguage(file)
  const fence = '`'.repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)))
  const provenance = origin ? `${origin.repo}@${origin.revision.slice(0, 12)}\n\n` : ''
  return `# ${file}\n\n${provenance}${fence}${language === 'text' ? '' : language}\n${content.replace(/\n$/, '')}\n${fence}\n`
}
