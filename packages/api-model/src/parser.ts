import { createRequire } from 'node:module'
import { Language, Parser } from 'web-tree-sitter'

/**
 * Grammar loading, and the version pin that makes it work.
 *
 * `web-tree-sitter` must match the era its grammars were compiled in. The
 * prebuilt WASM in `tree-sitter-wasms` is ABI 13-14; runtime 0.26 and 0.27
 * both reject it, and 0.27 does so by throwing a bare `Error` with no message
 * from inside `getDylinkMetadata` — which reads like a corrupt file rather
 * than a version mismatch. 0.25.10 loads all eight. The dependency is pinned
 * exactly, not caret-ranged, for that reason.
 *
 * Prebuilt WASM rather than building grammars here: `tree-sitter build --wasm`
 * needs emscripten or docker, which would make this package unusable on a
 * machine that just wants to render docs. `tree-sitter-wasms` is Unlicense.
 */
const require = createRequire(import.meta.url)

/** Grammar file per language, by the name tree-sitter-wasms uses. */
const GRAMMAR = {
  python: 'python',
  typescript: 'typescript',
  rust: 'rust',
  go: 'go',
  java: 'java',
  csharp: 'c_sharp',
  cpp: 'cpp',
  swift: 'swift',
} as const

export type GrammarName = keyof typeof GRAMMAR

let ready: Promise<void> | undefined
const cache = new Map<GrammarName, Language>()

/** Load a grammar once per process. Parser.init() is idempotent but not free. */
export async function loadLanguage(name: GrammarName): Promise<Language> {
  ready ??= Parser.init()
  await ready
  const hit = cache.get(name)
  if (hit) return hit
  const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${GRAMMAR[name]}.wasm`)
  const lang = await Language.load(wasm)
  cache.set(name, lang)
  return lang
}

/**
 * A parser bound to one grammar. Parsers are cheap; grammars are not.
 *
 * The language is awaited *before* the constructor runs, not inside the
 * argument list: `new Parser()` throws "cannot construct a Parser before
 * calling `init()`", and in `new Parser(await load(...))` the constructor is
 * evaluated first, so the await that would have satisfied it comes too late.
 */
export async function parserFor(name: GrammarName): Promise<Parser> {
  const language = await loadLanguage(name)
  const parser = new Parser()
  parser.setLanguage(language)
  return parser
}
