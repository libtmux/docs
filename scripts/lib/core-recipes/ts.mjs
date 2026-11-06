import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { splitCommandLine } from '../core-trace.mjs'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How TypeScript's quickstart is recorded: the calls to mark, what to build,
 * and how libtmux-ts's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a TypeScript expression for the value each returned. It
 * is checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the syntax tree (the TypeScript compiler API: every call whose
 * receiver is a type of the library) and take the value from the binding of the
 * statement; the recorder would not change.
 */

/** The module the marked copy imports; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const TS_HELPER = `import { execFileSync } from "node:child_process";

/** Tell the recorder that an API call has returned, and what it returned. */
export function docsMark(step: string, value: unknown): void {
  execFileSync(process.env.LIBTMUX_DOCS_MARK as string, [step, JSON.stringify(value ?? null)], { stdio: ["ignore", "inherit", "inherit"] });
}
`

/** A handle as a recording stores it: tmux's id, and its name where it has one. */
const handle = (name, extra = '') => `{ id: ${name}.id${extra} }`

/** Insert the marker lines and the import that provides them. */
export function instrumentTs(source, steps) {
  const marked = instrumentLines(source, steps, (step) => `docsMark(${JSON.stringify(step.id)}, ${step.value}); // docs:mark`)
  return `import { docsMark } from "./docs_mark.ts"; // docs:mark\n${marked}`
}

/** The checkout's own source is what Bun loads (the package's \`bun\` export condition), so there is nothing to build; \`node_modules/libtmux\` is a link to the package in the checkout. */
export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.ts',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh'],
    source: (root) => quickstartSource(root, 'ts', 'quickstart.ts'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [{ file: 'docs_mark.ts', source: TS_HELPER }],
    // In the order the calls run. `activeWindow`, `activePane`, `window` and `session` are getters that read the handle's own snapshot and send tmux nothing; `window.panes.map(` runs once for each window of each session.
    steps: [
      { id: 'new-server', label: 'Server', anchor: 'new Server(', type: 'Server', value: '{ socketPath: server.socketPath, configFile: server.configFile }' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Promise<Session>', value: '{ id: session.id, name: session.name }' },
      { id: 'active-window', label: 'Session.activeWindow', anchor: 'session.activeWindow', type: 'Window | undefined', value: '{ id: editor?.id, index: editor?.index, name: editor?.name }' },
      { id: 'rename', label: 'Window.rename', anchor: 'editor.rename(', type: 'Promise<void>', value: 'null' },
      { id: 'active-pane', label: 'Window.activePane', anchor: 'editor.activePane', type: 'Pane | undefined', value: '{ id: left?.id }' },
      { id: 'split', label: 'Pane.split', anchor: 'left.split(', type: 'Promise<Pane>', value: '{ id: right.id }' },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'session.newWindow(', type: 'Promise<Window>', value: '{ id: logs.id, index: logs.index, name: logs.name }' },
      { id: 'send-keys', label: 'Pane.sendKeys', anchor: 'right.sendKeys(', type: 'Promise<void>', value: 'null' },
      { id: 'capture', label: 'Pane.capture', anchor: 'right.capture(', type: 'Promise<readonly string[]>', value: 'lines', repeat: true },
      { id: 'select-pane', label: 'Pane.select', anchor: 'right.select(', type: 'Promise<void>', value: 'null' },
      { id: 'select-window', label: 'Window.select', anchor: 'logs.select(', type: 'Promise<void>', value: 'null' },
      { id: 'snapshot', label: 'Server.snapshot', anchor: 'server.snapshot(', type: 'Promise<ServerSnapshot>', value: '{ sessions: snapshot.sessions.length, windows: snapshot.windows.length, panes: snapshot.panes.length }' },
      { id: 'window-panes', label: 'Window.panes', anchor: 'window.panes.map(', type: 'Selection<Pane>', value: '{ panes: ids }', repeat: true },
      { id: 'pane-by-id', label: 'Selection.one', anchor: 'snapshot.panes.one(', type: 'Pane', value: '{ id: pane.id }' },
      { id: 'pane-window', label: 'Pane.window', anchor: 'pane.window', type: 'Window | undefined', value: '{ id: home?.id, index: home?.index, name: home?.name }' },
      { id: 'pane-session', label: 'Pane.session', anchor: 'pane.session', type: 'Session | undefined', value: '{ id: owner?.id, name: owner?.name }' },
      { id: 'kill', label: 'Server.kill', anchor: 'server.kill(', type: 'Promise<void>', value: 'null' },
    ],
    /** The guard carries the command itself: `if-shell -F <the daemon is the one checked> '<command>' '<what to say if it was replaced>'`. */
    unwrap: (command) => (command[0] === 'if-shell' && command[1] === '-F' && command.length === 5 ? splitCommandLine(command[3]) : undefined),
    /** What the library asks tmux about itself before its first command: the version, the daemon's pid and start time. */
    probe: ({ commands }) => commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.some((word) => word.startsWith('#{version};'))),
    instrument: instrumentTs,
    // The program makes its socket directory under `os.tmpdir()`; the recorder reads sockets under the sandbox's `tmp`.
    command: (dir) => ['env', `TMPDIR=${join(dirname(dir), 'tmp')}`, 'bun', 'run', join(dir, 'quickstart.ts')],
    toolchain: () => ({ bun: execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim() }),
    /** Write the displayed and the marked copy as packages that link the checkout's package, and install nothing. */
    build({ sandbox, checkout, code, marked, helpers }) {
      const manifest = `${JSON.stringify({ type: 'module', private: true, dependencies: { libtmux: `file:${join(checkout, 'packages/libtmux')}` } })}\n`
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir, 'node_modules'), { recursive: true })
        writeFileSync(join(sandbox, dir, 'package.json'), manifest)
        writeFileSync(join(sandbox, dir, this.file), source)
        symlinkSync(join(checkout, 'packages/libtmux'), join(sandbox, dir, 'node_modules/libtmux'))
      }
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      for (const file of helpers) writeFileSync(join(sandbox, 'marked', file.file), file.source)
    },
  },
}
