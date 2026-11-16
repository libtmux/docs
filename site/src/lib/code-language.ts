/** Unsupported doc-comment labels retain a plain-text frame instead of failing builds. */
const EC_LANGS = new Set([
  'perl', 'python', 'ruby', 'lua', 'rust', 'ts', 'tsx', 'js', 'jsx', 'java', 'kotlin', 'scala', 'fsharp', 'swift',
  'csharp', 'cpp', 'c', 'go', 'bash', 'shell', 'console', 'json', 'yaml',
  'toml', 'xml', 'diff', 'text', 'tmux-usage', 'tmux-shell', 'tmux-config', 'powershell', 'julia', 'elixir', 'properties', 'ini',
  'cmake', 'ocaml', 'lisp', 'haskell', 'clojure', 'erlang',
  'raku', 'groovy', 'make', 'just', 'dockerfile', 'markdown', 'rst',
  // The site's own grammars for file formats Shiki does not bundle (`lib/grammars`).
  'cabal', 'dune', 'gemfile-lock', 'gomod', 'opam',
])

const EC_ALIASES: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  'c++': 'cpp',
  cxx: 'cpp',
  py: 'python',
  rs: 'rust',
  'c#': 'csharp',
  cs: 'csharp',
  sbt: 'scala',
  ml: 'ocaml',
  ex: 'elixir',
  exs: 'elixir',
  sh: 'bash',
  zsh: 'bash',
  shellsession: 'console',
  tmux: 'tmux-config',
  plaintext: 'text',
  '': 'text',
  'cabal.project': 'cabal',
  'cabal-project': 'cabal',
  'dune-project': 'dune',
  'dune-workspace': 'dune',
  'gemfile.lock': 'gemfile-lock',
  'go.mod': 'gomod',
  'go-mod': 'gomod',
  'go.work': 'gomod',
}

export function codeLang(lang?: string): string {
  const name = (lang ?? '').trim().toLowerCase()
  const resolved = EC_ALIASES[name] ?? name
  return EC_LANGS.has(resolved) ? resolved : 'text'
}

/** Languages by file extension, longest suffix first. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  go: 'go', rs: 'rust', ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'js', mjs: 'js', cjs: 'js', jsx: 'jsx',
  py: 'python', pyi: 'python', rb: 'ruby', rbs: 'ruby', gemspec: 'ruby', rake: 'ruby', lua: 'lua', rockspec: 'lua',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', sc: 'scala', sbt: 'scala', gradle: 'groovy',
  cs: 'csharp', fs: 'fsharp', fsi: 'fsharp', fsx: 'fsharp', swift: 'swift',
  c: 'c', h: 'cpp', hpp: 'cpp', hh: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp',
  pl: 'perl', pm: 'perl', t: 'perl', raku: 'raku', rakumod: 'raku', rakudoc: 'raku', p6: 'raku', pm6: 'raku',
  erl: 'erlang', hrl: 'erlang', 'app.src': 'erlang', ex: 'elixir', exs: 'elixir', hs: 'haskell', cabal: 'cabal',
  ml: 'ocaml', mli: 'ocaml', opam: 'opam',
  lisp: 'lisp', lsp: 'lisp', cl: 'lisp', asd: 'lisp', clj: 'clojure', cljc: 'clojure', cljs: 'clojure', edn: 'clojure',
  jl: 'julia', ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', cmake: 'cmake', sh: 'bash',
  csproj: 'xml', fsproj: 'xml', vbproj: 'xml', props: 'xml', targets: 'xml', nuspec: 'xml',
  properties: 'properties', md: 'markdown', rst: 'rst', mk: 'make',
}

/** Files that take their language from the whole name. */
const FILENAMES: Readonly<Record<string, string>> = {
  'cabal.project': 'cabal', 'cabal.project.local': 'cabal', 'cabal.project.freeze': 'cabal',
  'go.mod': 'gomod', 'go.work': 'gomod',
  Gemfile: 'ruby', Rakefile: 'ruby', 'Gemfile.lock': 'gemfile-lock',
  cpanfile: 'perl', 'rebar.config': 'erlang', 'rebar.config.script': 'erlang', 'rebar.lock': 'erlang',
  dune: 'dune', 'dune-project': 'dune', 'dune-workspace': 'dune',
  'CMakeLists.txt': 'cmake', Makefile: 'make', justfile: 'just', Justfile: 'just', Dockerfile: 'dockerfile',
  'Cargo.lock': 'toml', 'project.clj': 'clojure',
}

/**
 * The language a file's contents are written in, from its name, or undefined
 * when the name says nothing. A name such as `Gemfile` or `dune` has no
 * extension; the rest read from the extension.
 */
export function languageForFile(file: string): string | undefined {
  const name = file.split('/').at(-1) ?? file
  const whole = FILENAMES[name]
  if (whole) return whole
  const parts = name.toLowerCase().split('.')
  for (let from = 1; from < parts.length; from++) {
    const language = EXTENSIONS[parts.slice(from).join('.')]
    if (language) return language
  }
  return undefined
}
