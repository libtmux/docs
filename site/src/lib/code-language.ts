/** Unsupported doc-comment labels retain a plain-text frame instead of failing builds. */
const EC_LANGS = new Set([
  'perl', 'python', 'ruby', 'lua', 'rust', 'ts', 'tsx', 'js', 'jsx', 'java', 'kotlin', 'scala', 'fsharp', 'swift',
  'csharp', 'cpp', 'c', 'go', 'bash', 'shell', 'console', 'json', 'yaml',
  'toml', 'xml', 'diff', 'text', 'tmux-usage', 'tmux-shell', 'tmux-config', 'powershell', 'julia', 'elixir', 'properties', 'ini',
  'cmake', 'ocaml', 'lisp', 'haskell', 'clojure',
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
  dune: 'lisp',
  ml: 'ocaml',
  ex: 'elixir',
  exs: 'elixir',
  sh: 'bash',
  zsh: 'bash',
  shellsession: 'console',
  tmux: 'tmux-config',
  plaintext: 'text',
  '': 'text',
}

export function codeLang(lang?: string): string {
  const name = (lang ?? '').trim().toLowerCase()
  const resolved = EC_ALIASES[name] ?? name
  return EC_LANGS.has(resolved) ? resolved : 'text'
}
