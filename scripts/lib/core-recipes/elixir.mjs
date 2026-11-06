import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Elixir's quickstart is recorded: the calls to mark, what to run, and
 * how libtmux-elixir's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to an Elixir expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (`Code.string_to_quoted`: every call
 * of an alias the program names) and take the value from the variable the
 * statement binds; the recorder would not change.
 */

/** Where Mix.install builds the checkout, on disk and apart from the sandbox, so the second run does not compile again. */
const INSTALL_DIR = '/home/d/tmp-wave/elixir-core-player-install'

/**
 * The module the marked copy loads before the program (`elixir -r`). `mark`
 * runs `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. `returned` is the value the last `System.cmd/3` or
 * `Server.run/3` gave back, for a call whose result the program matches and
 * drops: the call is traced and nothing else about it changes. The trace is
 * installed by the first mark, because the library is loaded by then.
 */
const ELIXIR_HELPER = `defmodule DocsMark do
  @traced [{System, :cmd, 3}, {LibTmux.Server, :run, 3}]

  def mark(step, value) do
    watch()
    {_, status} = System.cmd(System.fetch_env!("LIBTMUX_DOCS_MARK"), [step, JSON.encode!(value)])

    if status != 0 do
      IO.puts(:stderr, "docs mark: #{step} failed")
      System.halt(status)
    end
  end

  # The last value each traced function returned. A trace message and a later request from the same process arrive in order.
  def returned(name) do
    send(:docs_mark_tracer, {:get, self(), name})
    receive do: ({:docs_mark, value} -> value)
  end

  defp watch do
    if Process.whereis(:docs_mark_tracer) == nil do
      tracer = spawn(fn -> loop(%{}) end)
      Process.register(tracer, :docs_mark_tracer)
      :erlang.trace(self(), true, [:call, {:tracer, tracer}])

      for {module, function, arity} <- @traced do
        Code.ensure_loaded!(module)
        :erlang.trace_pattern({module, function, arity}, [{:_, [], [{:return_trace}]}], [:local])
      end
    end
  end

  defp loop(state) do
    receive do
      {:trace, _, :return_from, {module, function, _}, value} ->
        loop(Map.put(state, {module, function}, value))

      {:get, from, name} ->
        send(from, {:docs_mark, Map.fetch!(state, name)})
        loop(state)

      _ ->
        loop(state)
    end
  end
end
`

/** Insert a mark after each step's statement; the mark ends in the trailer the displayed copy is stripped by. */
export function instrumentElixir(source, steps) {
  return instrumentLines(source, steps, (step) => `DocsMark.mark(${JSON.stringify(step.id)}, ${step.value}) # docs:mark`, '#')
}

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = '%{sessions: map_size(snapshot.sessions), windows: map_size(snapshot.windows), panes: map_size(snapshot.panes)}'
/** A window, a pane and a reference as a recording stores them, from the variable the statement binds. */
const WINDOW = (name) => `%{id: ${name}.id, name: ${name}.name}`
const PANE = (name) => `%{id: ${name}.id}`
const REF = (name) => `%{entity: ${name}.entity, id: ${name}.id}`

const RUN = '(fn {:ok, result} -> %{exit_status: result.exit_status, stdout: result.stdout, stderr: result.stderr} end).(DocsMark.returned({LibTmux.Server, :run}))'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.exs',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh'],
    source: (root) => quickstartSource(root, 'elixir', 'quickstart.exs'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The program makes its socket directory under TMPDIR as `libtmux-<sixteen hex digits>`. */
    socket: { pattern: 'libtmux-[0-9a-f]{16}', fixed: 'libtmux-0123456789abcdef' },
    helpers: [{ file: 'docs_mark.exs', source: ELIXIR_HELPER }],
    // In the order the calls run. The program starts its own daemon first (`System.cmd`, matched to status 0, before any mark can trace it), and kills it last.
    // The reads of a snapshot send tmux nothing. The lookup of a window by its id is not marked: it falls between two reads that repeat.
    steps: [
      { id: 'daemon', label: 'System.cmd', anchor: '{_, 0} = System.cmd(', type: 'exit status', value: '%{status: 0}' },
      { id: 'server', label: 'Server.new', anchor: 'server = Server.new(', type: 'Server', value: '%{executable: server.executable, socket: server.socket}' },
      { id: 'snapshot-layout', label: 'Server.snapshot!', anchor: 'Server.snapshot!(server)', occurrence: 1, type: 'Snapshot', value: COUNTS },
      { id: 'session', label: 'Selection.one!', anchor: 'Snapshot.sessions() |> Selection.one!()', type: 'Session', value: '%{id: session.id, name: session.name}' },
      { id: 'active-window', label: 'Session.active_window', anchor: 'Session.active_window(', type: 'Window', value: WINDOW('editor') },
      { id: 'ref-session', label: 'Ref.from_observation', anchor: 'Ref.from_observation(session)', type: 'Ref', value: REF('session_ref') },
      { id: 'ref-editor', label: 'Ref.from_observation', anchor: 'Ref.from_observation(editor)', type: 'Ref', value: REF('editor_ref') },
      { id: 'rename', label: 'Window.rename!', anchor: 'Window.rename!(', type: ':ok', value: ':ok' },
      { id: 'active-pane', label: 'Selection.one!', anchor: 'Selection.one!(window_id: editor.id', type: 'Pane', value: PANE('left') },
      { id: 'ref-left', label: 'Ref.from_observation', anchor: 'Ref.from_observation(left)', type: 'Ref', value: REF('left_ref') },
      { id: 'split', label: 'Pane.split!', anchor: 'Pane.split!(', type: 'map', value: '%{id: right_id}' },
      { id: 'new-window', label: 'Session.new_window!', anchor: 'Session.new_window!(', type: 'map', value: '%{id: logs_id}' },
      { id: 'ref-right', label: 'Ref.new', anchor: 'Ref.new(:pane', type: 'Ref', value: REF('right') },
      { id: 'send-text', label: 'Pane.send_text!', anchor: 'Pane.send_text!(', type: ':ok', value: ':ok' },
      { id: 'send-keys', label: 'Pane.send_keys!', anchor: 'Pane.send_keys!(', type: ':ok', value: ':ok' },
      { id: 'capture', label: 'Pane.capture!', anchor: 'Pane.capture!(', type: 'binary', value: 'screen', repeat: true },
      { id: 'command-select-pane', label: 'Command.new', anchor: 'select_pane = Command.new(', type: 'Command', value: '%{name: select_pane.name, args: select_pane.args}' },
      { id: 'command-select-window', label: 'Command.new', anchor: 'select_window = Command.new(', type: 'Command', value: '%{name: select_window.name, args: select_window.args}' },
      { id: 'select-pane', label: 'Server.run', anchor: 'Server.run(server, select_pane)', type: 'Result', value: RUN },
      { id: 'select-window', label: 'Server.run', anchor: 'Server.run(server, select_window)', type: 'Result', value: RUN },
      { id: 'snapshot', label: 'Server.snapshot!', anchor: 'Server.snapshot!(server)', occurrence: 2, type: 'Snapshot', value: COUNTS },
      { id: 'sessions', label: 'Snapshot.sessions', anchor: 'sessions = Snapshot.sessions(snapshot)', type: 'Selection', value: 'Enum.map(sessions, &%{id: &1.id, name: &1.name})' },
      { id: 'links', label: 'Snapshot.related', anchor: 'Snapshot.related(snapshot, :session, each.id', type: '[WindowLink]', value: 'Enum.map(links, &%{index: &1.index, window: &1.window_id})', repeat: true },
      { id: 'panes', label: 'Window.panes', anchor: 'Window.panes(snapshot, window)', type: 'Selection', value: 'Enum.map(panes, & &1.id)', repeat: true },
      { id: 'pane', label: 'Selection.one!', anchor: 'Selection.one!(id: right_id)', type: 'Pane', value: PANE('pane') },
      { id: 'pane-window', label: 'Snapshot.related', anchor: 'Snapshot.related(snapshot, :pane', type: 'Window', value: WINDOW('window') },
      { id: 'window-session', label: 'Snapshot.related', anchor: 'Snapshot.related(snapshot, :window, window.id', type: '[Session]', value: '%{id: owner.id, name: owner.name}' },
      { id: 'kill-server', label: 'System.cmd', anchor: '"kill-server"', type: 'exit status', value: '%{status: elem(DocsMark.returned({System, :cmd}), 1)}' },
    ],
    // The library has no guard command of its own to hide.
    fence: () => false,
    /** A capture asks the daemon for its pid before and after it reads the graph, to know it was one server throughout. */
    probe: ({ commands }) => commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.includes('#{pid}')),
    instrument: instrumentElixir,
    command: (dir) => [join(dir, 'program')],
    toolchain: () => ({ elixir: /Elixir (\S+)/.exec(execFileSync('elixir', ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown', otp: execFileSync('erl', ['-noshell', '-eval', 'io:format("~s", [erlang:system_info(otp_release)]), halt().'], { encoding: 'utf8' }) }),
    /** Write the displayed and the marked copy, each installing the checkout itself where the program names the registry, and build it once. */
    build({ sandbox, checkout, code, marked, helpers }) {
      const dependency = '{:libtmux, "0.1.1"}'
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      mkdirSync(INSTALL_DIR, { recursive: true })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        if (!source.includes(dependency)) throw new Error(`the program no longer installs ${dependency}`)
        writeFileSync(join(sandbox, dir, this.file), source.replace(dependency, `{:libtmux, path: ${JSON.stringify(checkout)}}`))
        const preload = dir === 'marked' ? ` -r ${JSON.stringify(join(sandbox, dir, 'docs_mark.exs'))}` : ''
        writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nMIX_INSTALL_DIR=${JSON.stringify(INSTALL_DIR)}\nMIX_ENV=prod\nHEX_OFFLINE=1\nMIX_HOME=${JSON.stringify(join(INSTALL_DIR, 'home'))}\nexport TMPDIR MIX_INSTALL_DIR MIX_ENV HEX_OFFLINE MIX_HOME\nrm -rf "${join(sandbox, 'tmp')}"/libtmux-*\nexec elixir${preload} ${JSON.stringify(join(sandbox, dir, this.file))}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
      for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
      // Compile the checkout now, so neither timed run does.
      writeFileSync(join(sandbox, 'warm.exs'), `Mix.install([{:libtmux, path: ${JSON.stringify(checkout)}}])\n`)
      execFileSync('elixir', [join(sandbox, 'warm.exs')], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, MIX_INSTALL_DIR: INSTALL_DIR, MIX_ENV: 'prod', HEX_OFFLINE: '1', MIX_HOME: join(INSTALL_DIR, 'home') } })
    },
  },
}
