/**
 * What the frame of an API page's example says about its code.
 *
 * An example that carries a `sourceUrl` is a whole file of the port's tested
 * sources, and its intro tells the reader what to save it as ("Save this
 * complete example as `example_test.go`"). The frame names that file, and
 * calls it a complete program when it is a program: a build or manifest file
 * beside it (`Example.csproj`, `deps.edn`) is a whole file but is not run. A
 * fragment has no file name and no role, so its frame draws no header.
 */

export interface ExampleSource {
  lang: string
  intro?: string
  /** Where the port keeps the whole file, when the example is one. */
  sourceUrl?: string
}

export interface ExampleFrame {
  /** The file the reader saves the example as. */
  title?: string
  /** Whether the whole file is a program rather than a build or manifest file. */
  program: boolean
}

/** Languages whose files are configuration, not a program to run. */
const SETUP_LANGS = new Set(['xml', 'properties', 'cmake', 'toml', 'json', 'yaml', 'ini', 'text'])
const SETUP_FILE = /(?:^|\/)(?:CMakeLists\.txt|Gemfile|Package\.swift|[^/]+\.(?:csproj|fsproj|edn|properties|toml|json|ya?ml|xml))$/i
/** "save this complete program as `Sources/Example.swift`" or "Replace `src/main.rs` with this program". */
const NAMED_FILE = /(?:\bas|\bReplace)\s+`([^`\s]+\.[A-Za-z][A-Za-z0-9]*)`/i

export function exampleFrame(example: ExampleSource): ExampleFrame {
  if (!example.sourceUrl) return { program: false }
  const source = example.sourceUrl.split(/[?#]/)[0]!.split('/').pop() ?? ''
  // A documentation page is not a file the reader saves: PowerShell's one-line examples point at their cmdlet's help.
  if (/\.md$/i.test(source)) return { program: false }
  const title = NAMED_FILE.exec(example.intro ?? '')?.[1] ?? (source || undefined)
  return { title, program: Boolean(title) && !SETUP_LANGS.has(example.lang) && !SETUP_FILE.test(title!) }
}
