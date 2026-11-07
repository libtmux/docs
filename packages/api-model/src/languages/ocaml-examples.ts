import type { ApiSymbol } from '../model.ts'

interface Showcase {
  capability: string
  title: string
  file: string
  whole_file: boolean
  command: string[]
  expected_stdout_line: string
  success_exit_code: number
}

const targets: Readonly<Record<string, readonly string[]>> = {
  graph: ['Libtmux.Snapshot.sessions', 'Libtmux.Session.window_links', 'Libtmux.Window.panes', 'Libtmux_unix.Client.capture'],
  watch: ['Libtmux_eio.Client.subscribe', 'Libtmux_eio.Subscription.wait_for_bytes'],
  'send-keys': ['Libtmux_unix.Client.send_text', 'Libtmux_unix.Client.send_keys'],
  'rename-window': ['Libtmux_unix.Client.rename_window'],
  'create-window': ['Libtmux_unix.Client.create_window'],
  'move-window': ['Libtmux_unix.Client.move_window_at'],
  layout: ['Libtmux_unix.Client.select_layout'],
}

/** Read whole, CI-executed programs at the same commit as the public interface. */
export function attachCompleteOcamlExamples(symbols: ApiSymbol[], read: (path: string) => string, revision: string): void {
  const manifest = JSON.parse(read('examples/showcase.json')) as {
    schema: string; tmux_floor: string; ci: { workflow: string; job: string; runner: string }; examples: Showcase[]
  }
  if (manifest.schema !== 'libtmux.showcase/1' || manifest.tmux_floor !== '3.3' ||
      manifest.ci.workflow !== '.github/workflows/ocaml.yml' || manifest.ci.job !== 'native' ||
      manifest.ci.runner !== 'test/showcase_test.py' || !Array.isArray(manifest.examples)) {
    throw new Error('Invalid OCaml CI showcase manifest')
  }
  const found = new Set<string>()
  for (const example of manifest.examples) {
    if (!targets[example.capability] || found.has(example.capability) || !example.whole_file ||
        !/^examples\/showcase_[a-z_]+\.ml$/.test(example.file) || example.success_exit_code !== 0 ||
        JSON.stringify(example.command) !== JSON.stringify(['opam', 'exec', '--', 'dune', 'exec',
          example.file.replace(/\.ml$/, '.exe'), '--', 'tmux'])) throw new Error('Invalid OCaml whole program')
    found.add(example.capability)
    const code = read(example.file)
    if (!code.includes('let () =') || code.split('\n').length > 151) throw new Error('Incomplete OCaml entry point')
    const sourceUrl = `https://github.com/libtmux/libtmux-ocaml/blob/${revision}/${example.file}`
    for (const target of targets[example.capability]!) {
      const matches = symbols.filter((symbol) => symbol.id === target)
      if (matches.length !== 1) throw new Error(`OCaml showcase target must resolve once: ${target}`)
      const symbol = matches[0]!
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []),
        { lang: 'ocaml', code, sourceUrl,
          intro: `${example.title}. This complete program creates a private daemon, checks its result and closes its clients. Use OCaml 5.5.2 on Linux with tmux 3.3 or newer. Run it from the source checkout after following the installation guide.` },
        { lang: 'console', code: `$ ${example.command.join(' ')}\n`, intro: 'Run the recorded entry point:' },
        { lang: 'text', code: example.expected_stdout_line + '\n', intro: 'Expected outcome line, after the temporary socket path:' },
      ] }
    }
  }
  if (found.size !== Object.keys(targets).length) throw new Error('Missing OCaml capability showcase')
}
