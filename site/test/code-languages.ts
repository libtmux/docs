import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { languageForFile } from '../src/lib/code-language'
import { PORTS } from '../src/lib/ports'
import { sourceLanguage } from '../src/lib/source-declarations'

/** One place the site hands code to a highlighter. */
export interface CodeUse {
  /** The file or object that declares the use, relative to `site/`. */
  from: string
  /** The property path inside `from`, for a use that sits in data. */
  trail?: string
  lang: string
  /** The file the code belongs to, when the fence or data entry names one. */
  file?: string
  /** The first lines of the code, when the use carries it. */
  head?: string
  /** A fence in a Markdown page, which only Expressive Code reads; every other use can also reach the shared highlighter. */
  markdown?: boolean
}

const site = fileURLToPath(new URL('..', import.meta.url))

function* files(dir: string, keep: (name: string) => boolean): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* files(path, keep)
    else if (keep(entry)) yield path
  }
}

const FILE_KEYS = ['file', 'filename', 'name', 'path', 'target', 'title', 'configFile'] as const
const CODE_KEYS = ['code', 'body', 'content', 'excerpt', 'signature'] as const

/** The first lines of a fence body, enough to recognise what kind of file it is. */
const head = (code: string) => code.split('\n').slice(0, 4).join('\n')

/** The fence language and the file named by `title`, `file` or `excerpt` on each fence of a Markdown document. */
export function fencesIn(markdown: string, from: string, trail?: string): CodeUse[] {
  const uses: CodeUse[] = []
  let open: { marker: string; length: number; use: CodeUse; body: string[] } | undefined
  for (const line of markdown.split('\n')) {
    const match = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/.exec(line)
    if (open && !(match && match[1][0] === open.marker && match[1].length >= open.length && !match[2] && !match[3])) {
      open.body.push(line)
      continue
    }
    if (open) {
      open.use.head = head(open.body.join('\n'))
      open = undefined
      continue
    }
    if (!match) continue
    const named = /\b(?:title|file|excerpt)="([^"]+)"/.exec(match[3])
    const use: CodeUse = { from, trail, lang: match[2], file: named?.[1], markdown: trail === undefined }
    uses.push(use)
    open = { marker: match[1][0], length: match[1].length, use, body: [] }
  }
  return uses
}

/** Every `lang` an object graph hands to a code block, and every Markdown fence in its strings. */
export function languagesIn(value: unknown, from: string): CodeUse[] {
  const uses: CodeUse[] = []
  const seen = new Set<unknown>()
  const walk = (node: unknown, trail: string): void => {
    if (typeof node === 'string') {
      if (node.includes('```') || node.includes('~~~')) uses.push(...fencesIn(node, from, trail))
      return
    }
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { node.forEach((entry, index) => walk(entry, `${trail}[${index}]`)); return }
    const record = node as Record<string, unknown>
    const code = CODE_KEYS.map((key) => record[key]).find((entry): entry is string => typeof entry === 'string')
    const lang = typeof record.lang === 'string' ? record.lang
      : code !== undefined && typeof record.language === 'string' ? record.language : undefined
    if (lang !== undefined) {
      const file = FILE_KEYS.map((key) => record[key]).find((entry): entry is string => typeof entry === 'string' && /\S/.test(entry))
      uses.push({ from, trail, lang, file, head: code === undefined ? undefined : head(code) })
    }
    for (const [key, entry] of Object.entries(record)) walk(entry, trail ? `${trail}.${key}` : key)
  }
  walk(value, '')
  return uses
}

/** Fences in every Markdown and MDX page, handwritten or staged from a port. */
export function fenceLanguages(): CodeUse[] {
  const dir = join(site, 'src/content')
  return [...files(dir, (name) => /\.mdx?$/.test(name))].flatMap((path) =>
    fencesIn(readFileSync(path, 'utf8'), relative(site, path)))
}

/** `lang` fields and embedded fences in the data files the pages are built from, but not the source files the reference shows. */
export function dataLanguages(): CodeUse[] {
  const dir = join(site, 'src/data')
  return [...files(dir, (name) => name.endsWith('.json'))].filter((path) => !relative(dir, path).startsWith('api-sources')).flatMap((path) => {
    const uses = languagesIn(JSON.parse(readFileSync(path, 'utf8')), relative(site, path))
    // Staged guides cache whole Markdown pages, which Expressive Code reads as it reads their `.md` twins.
    return relative(dir, path).startsWith('port-guides') ? uses.map((use) => ({ ...use, markdown: true })) : uses
  })
}

/** Install forms, build-file panels and every other code body a port declares. */
export function portLanguages(): CodeUse[] {
  return languagesIn(PORTS, 'src/lib/ports.ts')
}

/** Files the reference shows as source, which take their language from the file name. */
export function sourceFileLanguages(): CodeUse[] {
  const dir = join(site, 'src/data/api-sources')
  return [...files(dir, (name) => name.endsWith('.json'))].flatMap((path) => {
    const { files: listed } = JSON.parse(readFileSync(path, 'utf8')) as { files: Record<string, unknown> }
    return Object.keys(listed).map((file) => ({ from: relative(site, path), lang: sourceLanguage(file), file }))
  })
}

/** Literal labels in components and pages (`<Code lang="x">`, `{ lang: 'x', code }`) and in the MCP install panels. */
export function literalLanguages(): CodeUse[] {
  const dir = join(site, 'src')
  const read = (path: string, patterns: RegExp[]) => patterns.flatMap((pattern) =>
    [...readFileSync(path, 'utf8').matchAll(pattern)].map((match) => ({ from: relative(site, path), lang: match[1] })))
  return [
    ...[...files(dir, (name) => /\.(?:astro|mdx)$/.test(name))].flatMap((path) =>
      read(path, [/<Code\b[^>]*?\blang="([^"{}]+)"/g, /\blang: '([\w.+-]+)'/g])),
    ...read(join(dir, 'lib/install-matrix.ts'), [/\blanguage: '([\w.+-]+)'/g]),
  ]
}

export function allCodeUses(): CodeUse[] {
  return [...fenceLanguages(), ...dataLanguages(), ...portLanguages(), ...sourceFileLanguages(), ...literalLanguages()]
}

/** Labels that mean "no grammar", which is right for output and diagrams and wrong for a file. */
export const PLAIN = new Set(['', 'text', 'txt', 'plain', 'plaintext'])
export const isPlain = (lang: string) => PLAIN.has(lang.trim().toLowerCase())

/** Plain blocks that are not file contents: a prose instruction an install form shows in place of a command. */
const INSTRUCTIONS = /\.initProject$/

/** Content that is a known file format, whatever label its fence carries. */
const SNIFF: readonly { format: string; test: RegExp }[] = [
  { format: 'go.mod', test: /^module\s+\S+\s*\n(?:\s*\n)*go\s+\d/ },
  { format: 'cabal', test: /^(?:cabal-version:|packages:|source-repository-package\b)/m },
  { format: 'Gemfile.lock', test: /^GEM\n\s+remote:/ },
]

/** Why a plain block should have a grammar, or undefined when plain is right for it. */
export function plainProblem(use: CodeUse): string | undefined {
  if (!isPlain(use.lang)) return undefined
  if (use.trail && INSTRUCTIONS.test(use.trail)) return undefined
  if (use.file && /^[^\s()]+$/.test(use.file) && (/\.\w+$/.test(use.file) || languageForFile(use.file))) return `names the file ${use.file}`
  const format = SNIFF.find(({ test }) => use.head && test.test(use.head))?.format
  return format ? `holds ${format}` : undefined
}
