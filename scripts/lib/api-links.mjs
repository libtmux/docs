/**
 * What the site's hand-written links are reviewed against.
 *
 * A link a person wrote (a Markdown link in a page, a glossary term, a link in a doc comment,
 * the title a keyword's help carries) is a fact: this text points at this address, where the
 * page's heading is that. Five rounds of matching a link's words against its page's words with
 * rules (plurals, stems, site words, the language's name) kept finding the next pair that the
 * rules let through, so for these links the rules are gone. A person reads each pair once and
 * writes it down in `site/src/data/api-link-review.json`: the exact text, the exact address
 * including its fragment, and the heading the page has there. The verifier then checks two
 * things, and nothing fuzzy.
 *
 * - Every pair the source generates is a row of the table, and every row is a pair the source
 *   generates. A text planted at any other address, a narrower page, a page of another language
 *   or a heading that only shares a word with the text is not a row, and so it fails.
 * - The page's heading at the address is the row's heading, so a page that is rewritten or moved
 *   under the link is found when the live run reads it.
 *
 * A link whose text is the name of the symbol its page declares (`Files` at `Files.html`) needs no
 * row: the name is compared exactly (`judgeLabel`). Everything else does.
 *
 * Language is read from the address, never from the words: a link written for one port that
 * reaches another language's documentation fails, except where the port legitimately goes there.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeHeading } from './api-html.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where the reviewed rows are kept, relative to a checkout. */
export const REVIEW_FILE = join('site', 'src', 'data', 'api-link-review.json')

/** The key of one pair: the exact text and the exact address. */
export const pairKey = (label, url) => `${label}\u0000${url}`

/**
 * The reviewed rows of a checkout, as `{ label, url, heading }`, and by pair.
 *
 * @returns {{ rows: { label: string, url: string, heading: string }[], byPair: Map<string, { label: string, url: string, heading: string }> }}
 */
export function loadReviewedLinks(root = ROOT) {
  let rows = []
  try {
    rows = JSON.parse(readFileSync(join(root, REVIEW_FILE), 'utf8')).links ?? []
  } catch { /* a checkout with no table has no reviewed links */ }
  return { rows, byPair: new Map(rows.map((row) => [pairKey(row.label, row.url), row])) }
}

/** The rows as text, one to a line, so a review reads as the rows that changed. */
export function serializeReviewedLinks(rows) {
  const sorted = [...rows].sort((a, b) => a.url.localeCompare(b.url) || a.label.localeCompare(b.label))
  return `{\n  "links": [\n${sorted.map((row) => `    ${JSON.stringify({ label: row.label, url: row.url, heading: row.heading })}`).join(',\n')}\n  ]\n}\n`
}

/**
 * The language an address documents, from its host and path. `dotnet` is the platform C#, F# and
 * PowerShell share; `any` is a page that is for every port.
 */
export function languageOfUrl(url) {
  let parsed
  try { parsed = new URL(url) } catch { return undefined }
  const { hostname } = parsed
  const path = parsed.pathname.toLowerCase()
  const byHost = {
    'docs.python.org': 'python', 'gofastmcp.com': 'python',
    'doc.rust-lang.org': 'rust', 'docs.rs': 'rust',
    'pkg.go.dev': 'go', 'go.dev': 'go',
    'developer.mozilla.org': 'typescript', 'www.typescriptlang.org': 'typescript',
    'docs.junit.org': 'java', 'javadoc.io': 'java',
    'kotlinlang.org': 'kotlin',
    'www.scala-lang.org': 'scala', 'docs.scala-lang.org': 'scala', 'typelevel.org': 'scala',
    'fsharp.github.io': 'fsharp', 'csharp.sdk.modelcontextprotocol.io': 'csharp',
    'en.cppreference.com': 'cpp', 'eel.is': 'cpp', 'cmake.org': 'cpp',
    'developer.apple.com': 'swift', 'docs.swift.org': 'swift',
    'docs.ruby-lang.org': 'ruby', 'ruby-doc.org': 'ruby',
    'www.lua.org': 'lua', 'luals.github.io': 'lua',
    'docs.julialang.org': 'julia',
    'www.erlang.org': 'erlang',
    'modelcontextprotocol.io': 'any',
  }
  if (byHost[hostname]) return byHost[hostname]
  if (hostname === 'hexdocs.pm' || hostname.endsWith('.hexdocs.pm')) return 'elixir'
  if (hostname === 'docs.oracle.com') return 'java'
  if (hostname === 'learn.microsoft.com') {
    if (/\/powershell\//.test(path)) return 'powershell'
    if (/\/dotnet\/csharp\//.test(path)) return 'csharp'
    if (/\/dotnet\/fsharp\//.test(path)) return 'fsharp'
    return 'dotnet'
  }
  return undefined
}

/** The languages each port's documentation legitimately reaches: its own, and what its platform shares. */
export const PORT_LANGUAGES = {
  py: ['python'], rs: ['rust'], go: ['go'], ts: ['typescript'], java: ['java'],
  kotlin: ['kotlin', 'java'], scala: ['scala', 'java'],
  csharp: ['csharp', 'dotnet'], fsharp: ['fsharp', 'dotnet'], powershell: ['powershell', 'dotnet'],
  cxx: ['cpp'], swift: ['swift'], julia: ['julia'], lua: ['lua'], elixir: ['elixir', 'erlang'], ruby: ['ruby'],
}

/** Whether a link written for a port reaches the documentation of a language it has no business in. */
export function languageProblem(port, url) {
  const allowed = PORT_LANGUAGES[port]
  const language = languageOfUrl(url)
  if (!allowed || !language || language === 'any' || allowed.includes(language)) return undefined
  return { failure: 'language', detail: `a ${port} link reaches ${language} documentation at ${url.split('#')[0]}` }
}

/** The heading a DocC document gives an anchor, or the document's title for the page itself. */
export function doccHeading(data, fragment) {
  const title = normalizeHeading(data?.metadata?.title ?? '')
  if (!fragment) return title
  const found = []
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      if (value.anchor === fragment && typeof value.text === 'string') found.push(value.text)
      Object.values(value).forEach(walk)
    }
  }
  walk(data)
  return normalizeHeading(found[0] ?? `#${fragment}`)
}
