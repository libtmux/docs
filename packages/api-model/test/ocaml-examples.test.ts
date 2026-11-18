import { describe, expect, it } from 'vitest'
import { attachCompleteOcamlExamples } from '../src/languages/ocaml-examples.ts'
import type { ApiSymbol } from '../src/model.ts'

const revision = 'a'.repeat(40)
const SHOWCASES: Record<string, { file: string; title: string }> = {
  bootstrap: { file: 'showcase_bootstrap', title: 'Start a private server' },
  graph: { file: 'showcase_graph', title: 'Navigate the typed object graph' },
  watch: { file: 'showcase_watch', title: 'Observe future output' },
  'send-keys': { file: 'showcase_send_keys', title: 'Split a pane and send keys' },
  'rename-window': { file: 'showcase_rename_window', title: 'Rename a window' },
  'create-window': { file: 'showcase_create_window', title: 'Create a window' },
  'move-window': { file: 'showcase_move_window', title: 'Move a window' },
  layout: { file: 'showcase_layout', title: 'Apply a layout' },
  options: { file: 'showcase_options', title: 'Change options, hooks and environment' },
  panes: { file: 'showcase_panes', title: 'Rearrange panes' },
  clients: { file: 'showcase_clients', title: 'Steer another client' },
}
const IDS = [
  'Libtmux_unix.Workspace.submit_bootstrap', 'Libtmux_unix.Workspace.await', 'Libtmux_unix.Workspace.client',
  'Libtmux.Snapshot.sessions', 'Libtmux.Session.window_links', 'Libtmux.Window.panes', 'Libtmux_unix.Client.capture',
  'Libtmux_eio.Client.subscribe', 'Libtmux_eio.Subscription.wait_for_bytes',
  'Libtmux_unix.Client.send_text', 'Libtmux_unix.Client.send_keys', 'Libtmux_unix.Client.rename_window',
  'Libtmux_unix.Client.create_window', 'Libtmux_unix.Client.move_window_at', 'Libtmux_unix.Client.select_layout',
  'Libtmux_unix.Client.set_option', 'Libtmux_unix.Client.set_environment', 'Libtmux_unix.Client.set_hook',
  'Libtmux_unix.Client.swap_panes', 'Libtmux_unix.Client.move_pane', 'Libtmux_unix.Client.break_pane',
  'Libtmux_unix.Client.respawn_pane', 'Libtmux_unix.Client.switch_client_at',
  'Libtmux_unix.Client.resize_control_client_at', 'Libtmux_unix.Client.request_detach_client_at',
]

function fixture(edit: (example: Record<string, unknown>) => void = () => {}) {
  const examples = Object.entries(SHOWCASES).map(([capability, { file, title }]) => ({
    capability, title, file: `examples/${file}.ml`, whole_file: true, success_exit_code: 0,
    command: ['opam', 'exec', '--', 'dune', 'exec', `examples/${file}.exe`, '--', 'tmux'],
    expected_stdout_line: `${capability}: done`,
  }))
  examples.forEach(edit)
  const manifest = {
    schema: 'libtmux.showcase/1', tmux_floor: '3.3a',
    ci: { workflow: '.github/workflows/ocaml.yml', job: 'native', runner: 'test/showcase_test.py' }, examples,
  }
  const read = (path: string) => path === 'examples/showcase.json' ? JSON.stringify(manifest)
    : `(* docs:begin region *)\nlet () = print_endline "${path}"\n(* docs:end region *)\n`
  const symbols = IDS.map((id) => ({ id, name: id.split('.').pop()!, kind: 'function', modifiers: [], signatures: [], source: { file: 'lib.mli' } }) as ApiSymbol)
  return { read, symbols }
}

const programs = (symbols: ApiSymbol[], id: string) => symbols.find((symbol) => symbol.id === id)!.doc!.examples!.filter((example) => example.lang === 'ocaml')

describe('complete OCaml showcase programs', () => {
  it.each([
    ['options', ['Libtmux_unix.Client.set_option', 'Libtmux_unix.Client.set_environment', 'Libtmux_unix.Client.set_hook']],
    ['panes', ['Libtmux_unix.Client.swap_panes', 'Libtmux_unix.Client.move_pane', 'Libtmux_unix.Client.break_pane', 'Libtmux_unix.Client.respawn_pane']],
    ['clients', ['Libtmux_unix.Client.switch_client_at', 'Libtmux_unix.Client.resize_control_client_at', 'Libtmux_unix.Client.request_detach_client_at']],
  ])('attaches the %s program to the operations it demonstrates', (capability, targets) => {
    const { read, symbols } = fixture()
    attachCompleteOcamlExamples(symbols, read, revision)
    for (const id of targets) {
      const attached = programs(symbols, id)
      expect(attached.map((example) => example.sourceUrl), id).toEqual([expect.stringContaining(`${SHOWCASES[capability]!.file}.ml`)])
      expect(attached[0]!.code, id).not.toMatch(/\(\*\s*docs:/)
    }
  })

  it('refuses a capability it has no symbols for', () => {
    const { read, symbols } = fixture((example) => { if (example.capability === 'clients') example.capability = 'unmapped' })
    expect(() => attachCompleteOcamlExamples(symbols, read, revision)).toThrow('Invalid OCaml whole program')
  })
})
