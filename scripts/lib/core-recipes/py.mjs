import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Python's quickstart is recorded: the calls to mark, what to build, and
 * how libtmux's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Python expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's `ast` (every call or attribute read whose receiver
 * is a libtmux type) and take the value from the name the statement binds.
 */

/**
 * The preamble of the marked copy, every line a marker line. `docs_mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. `Pane.capture_pane` is wrapped so that its mark is
 * sent when each call returns: the program calls it in a `while` condition,
 * where no statement of the program is after the call and holds its value.
 */
const PREAMBLE = `import json as _docs_json, os as _docs_os, subprocess as _docs_subprocess, sys as _docs_sys  # docs:mark
def docs_mark(step, value):  # docs:mark
    mark = _docs_subprocess.run([_docs_os.environ["LIBTMUX_DOCS_MARK"], step, _docs_json.dumps(value)])  # docs:mark
    if mark.returncode != 0:  # docs:mark
        _docs_sys.exit(mark.returncode)  # docs:mark
def _docs_wrap_capture(method):  # docs:mark
    def capture_pane(self, *args, **kwargs):  # docs:mark
        lines = method(self, *args, **kwargs)  # docs:mark
        docs_mark("capture", lines)  # docs:mark
        return lines  # docs:mark
    return capture_pane  # docs:mark
libtmux.Pane.capture_pane = _docs_wrap_capture(libtmux.Pane.capture_pane)  # docs:mark`

/** Insert the preamble after `import libtmux` and a mark after each statement that binds a value. */
export function instrumentPython(source, steps) {
  const marked = instrumentLines(source, steps.filter((step) => !step.wrapped), (step) => `docs_mark(${JSON.stringify(step.id)}, ${step.value})  # docs:mark`, '#')
  const lines = marked.split('\n')
  const at = lines.indexOf('import libtmux')
  if (at < 0) throw new Error('the program has no `import libtmux` line to put the marker helper after')
  lines.splice(at + 1, 0, ...PREAMBLE.split('\n'))
  return lines.join('\n')
}

const interpreter = () => execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim()
let library

const SERVER = '{"socketPath": str(server.socket_path), "configFile": server.config_file}'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.py',
    stepMap: 'hand-written',
    source: (root) => quickstartSource(root, 'py', 'quickstart.py'),
    // What a pane runs once it has settled: the program starts it with shell="sh".
    paneCommands: ['sh'],
    // libtmux sends no guard before its commands.
    fence: () => false,
    /** What the library asks tmux about itself: `tmux -V`, from its version checks. */
    probe: ({ flags, commands }) => commands.length === 0 && flags.includes('-V'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    instrument: instrumentPython,
    command: (dir) => ['env', `TMPDIR=${join(dir, '..', 'tmp')}`, `PYTHONPATH=${join(library, 'src')}`, 'PYTHONDONTWRITEBYTECODE=1', interpreter(), join(dir, 'quickstart.py')],
    toolchain: () => ({ python: execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim().split(' ')[1] }),
    helpers: [],
    // In the order the calls run. `session.active_window` is a property and still asks tmux.
    steps: [
      { id: 'new-server', label: 'Server', anchor: 'libtmux.Server(', type: 'Server', value: SERVER },
      { id: 'new-session', label: 'Server.new_session', anchor: 'server.new_session(', type: 'Session', value: '{"id": session.session_id, "name": session.session_name}' },
      { id: 'active-window', label: 'Session.active_window', anchor: 'session.active_window', type: 'Window', value: '{"id": window.window_id, "name": window.window_name}' },
      { id: 'split', label: 'Window.split', anchor: 'window.split(', type: 'Pane', value: '{"id": pane.pane_id}' },
      { id: 'send-keys', label: 'Pane.send_keys', anchor: 'pane.send_keys(', type: 'None', value: 'None' },
      { id: 'capture', label: 'Pane.capture_pane', anchor: 'pane.capture_pane()', type: 'list[str]', value: 'None', repeat: true, wrapped: true },
      { id: 'kill', label: 'Server.kill', anchor: 'server.kill()', type: 'None', value: 'None' },
    ],
    build({ sandbox, checkout, code, marked }) {
      library = checkout
      // The program makes its socket directory with `tempfile.mkdtemp`: under here, where the recorder reads tmux.
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
      }
      // Fail here, not in the recording, if the checkout's source is not what the program imports.
      execFileSync(interpreter(), ['-c', 'import libtmux, sys; sys.exit(0 if libtmux.__file__.startswith(sys.argv[1]) else 1)', join(checkout, 'src')], { env: { PATH: process.env.PATH, PYTHONPATH: join(checkout, 'src'), PYTHONDONTWRITEBYTECODE: '1' } })
    },
  },
}
