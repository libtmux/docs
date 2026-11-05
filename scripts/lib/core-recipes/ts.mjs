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

/** The last value a hooked method returned. */
export const docsReturned: Record<string, unknown> = {};

/** Keep what \`target.method()\` resolves to, for a call whose statement does not bind it. */
export function docsHook(target: object, method: string): void {
  const prototype = Object.getPrototypeOf(target);
  const original = prototype[method];
  if (original.docsHooked) return;
  const hooked = async function (this: unknown, ...args: unknown[]) {
    const value = await original.apply(this, args);
    docsReturned[method] = value;
    return value;
  };
  Object.defineProperty(hooked, "docsHooked", { value: true });
  prototype[method] = hooked;
}
`

/** A handle as a recording stores it: tmux's id, and its name where it has one. */
const handle = (name, extra = '') => `{ id: ${name}.id${extra} }`

/** Insert the marker lines, the import that provides them, and the hook for the one call whose result its statement drops. */
export function instrumentTs(source, steps) {
  const marked = instrumentLines(source, steps, (step) => [`docsMark(${JSON.stringify(step.id)}, ${step.value}); // docs:mark`, ...(step.hook ? [`docsHook(${step.hook.target}, ${JSON.stringify(step.hook.method)}); // docs:mark`] : [])].join('\n'))
  return `import { docsHook, docsMark, docsReturned } from "./docs_mark.ts"; // docs:mark\n${marked}`
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
    // The split's result is dropped by its statement, so a hook placed after the window is made keeps it.
    steps: [
      { id: 'new-server', label: 'Server', anchor: 'new Server(', type: 'Server', value: '{ socketPath: server.socketPath, configFile: server.configFile }' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Promise<Session>', value: '{ id: session.id, name: session.name }' },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'session.newWindow(', type: 'Promise<Window>', value: '{ id: editor.id, name: editor.name }', hook: { target: 'editor', method: 'split' } },
      { id: 'split', label: 'Window.split', anchor: 'editor.split(', type: 'Promise<Pane>', value: `{ id: (docsReturned.split as { id: string }).id }` },
      { id: 'send-keys', label: 'Pane.sendKeys', anchor: 'pane.sendKeys(', type: 'Promise<void>', value: 'null' },
      { id: 'capture', label: 'Pane.capture', anchor: 'pane.capture(', type: 'Promise<readonly string[]>', value: 'lines', repeat: true },
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
