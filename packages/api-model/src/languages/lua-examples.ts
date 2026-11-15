import type { ApiSymbol, DocBlock } from '../model.ts'

export interface LuaExampleManifest {
  schema: number
  setup: { lua: string; luv: string }
  examples: { id: string; symbols: string[]; file: string; description: string; stdout: string }[]
}

/** Preserve complete source files exported by Lua's native documentation tool. */
export function attachCompleteLuaExamples(
  symbols: ApiSymbol[],
  manifest: LuaExampleManifest | undefined,
  files: { path: string; content: string }[] | undefined,
  source: { repository: string; revision: string },
): void {
  if (manifest === undefined) return
  const require = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Invalid complete Lua examples: ${message}`)
  }
  require(source.repository === 'libtmux/libtmux-lua' && /^[a-f0-9]{40}$/.test(source.revision),
    'source must name the Lua repository and a full revision')
  require(manifest?.schema === 1 && Array.isArray(manifest.examples) && manifest.examples.length,
    'unsupported or empty manifest')
  require(/^5\.[1-5]\.\d+$/.test(manifest.setup?.lua ?? '') &&
    /^\d+\.\d+\.\d+-\d+$/.test(manifest.setup?.luv ?? ''), 'runtime versions must be pinned')
  // Programs behind a launcher expect it to own the daemon and fail as `lua <name>.lua`: refuse, don't drop it.
  require(!('launcher' in manifest.setup), 'setup.launcher is unsupported; examples must start their own server')
  const read = (path: string): string => {
    const matches = files?.filter((file) => file.path === path) ?? []
    require(matches.length === 1, `source file must resolve once: ${path}`)
    const code = matches[0].content
    require(typeof code === 'string' && code.trim() && code.endsWith('\n') && !code.includes('\r'),
      `source file must retain complete LF bytes: ${path}`)
    return code
  }
  const url = (path: string) => `https://github.com/${source.repository}/blob/${source.revision}/${path}`
  const seen = new Set<string>()
  const ids = new Set<string>()
  for (const example of manifest.examples) {
    require(/^[a-z][a-z_]*$/.test(example.id) && !ids.has(example.id), 'invalid or duplicate example id')
    ids.add(example.id)
    require(example.file === `examples/api/${example.id}.lua`, 'unexpected program path')
    require(typeof example.description === 'string' && example.description.trim(), 'task description is missing')
    require(typeof example.stdout === 'string' && example.stdout.trim() && example.stdout.endsWith('\n'),
      'expected output is missing')
    require(Array.isArray(example.symbols) && example.symbols.length, 'API targets are missing')
    const code = read(example.file)
    const name = `${example.id}.lua`
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${example.description} Use Lua 5.1 or newer with LuaRocks, tmux 3.3a or newer, and a C compiler and CMake for luv on Linux. In a new directory, install the library and its standalone runtime dependency from LuaRocks:`,
        code: '$ luarocks --tree ./rocks install luv &&\n' +
          '  luarocks --tree ./rocks install libtmux &&\n' +
          '  eval "$(luarocks --tree ./rocks path)"\n',
      },
      {
        lang: 'lua',
        intro: `Save the complete program as \`${name}\`. It starts its own private tmux server and stops it before exiting, including after a failure.`,
        sourceUrl: url(example.file),
        code,
      },
      {
        lang: 'console',
        intro: 'Run the saved program. It uses `/usr/bin/tmux` unless `TMUX_BIN` names another absolute path. Assertions and operation errors produce a failing exit status:',
        code: `$ eval "$(luarocks --tree ./rocks path)" &&\n  lua ${name}\n`,
      },
    ]
    for (const id of example.symbols) {
      require(!seen.has(id), `duplicate API target: ${id}`)
      const matches = symbols.filter((symbol) => symbol.id === id)
      require(matches.length === 1, `API target must resolve once: ${id}`)
      seen.add(id)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
