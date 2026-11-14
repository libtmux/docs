import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { splitCommandLine } from '../core-trace.mjs'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How libtmux-raku's quickstart is recorded: the calls to mark, what to run,
 * and how the library's guards are read.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Raku expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. Every expression reads what a
 * snapshot or handle already holds, so a mark sends tmux nothing.
 */

/**
 * The marker helper, which goes after `use LibTmux;`: `docs-mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails.
 */
const PREAMBLE = [
  'use JSON::Fast; # docs:mark',
  'sub docs-mark(Str:D $step, $value) { my $proc = run(%*ENV<LIBTMUX_DOCS_MARK>, $step, to-json($value, :!pretty, :sorted-keys)); exit($proc.exitcode || 70) unless $proc.exitcode == 0 } # docs:mark',
]

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = (name) => `%( sessions => ${name}.sessions.elems, windows => ${name}.windows.elems, panes => ${name}.panes.elems )`

/**
 * In the order the calls run. A call on a snapshot or a captured pane reads what
 * was captured and sends tmux nothing. The last step is the displayed `LEAVE`
 * phaser: its mark is a phaser of its own, declared before the program's, so it
 * runs after `Server.close` has stopped the daemon.
 */
const STEPS = [
  { id: 'start', label: 'Server.start', anchor: 'Server.start(', type: 'Server', value: '%( socket => $server.endpoint.socket-path.IO.parent.basename )' },
  { id: 'snapshot-before', label: 'Server.snapshot', anchor: 'my $before = $server.snapshot;', type: 'Snapshot', value: COUNTS('$before') },
  { id: 'pane', label: 'PaneSelection.single', anchor: 'my $left = $before.panes.single.ref;', type: 'PaneRef', value: '%( id => $left.id )' },
  { id: 'split', label: 'PaneRef.split', anchor: '$left.split(', type: 'PaneRef', value: '%( id => $right.id )' },
  { id: 'title-editor', label: 'PaneRef.set-title', anchor: "$left.set-title('editor');", type: 'void', value: 'Nil' },
  { id: 'title-logs', label: 'PaneRef.set-title', anchor: "$right.set-title('logs');", type: 'void', value: 'Nil' },
  { id: 'snapshot', label: 'Server.snapshot', anchor: 'my $after = $server.snapshot;', type: 'Snapshot', value: COUNTS('$after') },
  { id: 'selected', label: 'PaneSelection.single', anchor: 'my $editor = $after.panes.filter(', type: 'Pane', value: '%( id => $editor.id, title => $editor.title )' },
  { id: 'close', label: 'Server.close', anchor: 'LEAVE $server.close', type: 'void', value: 'Nil', leave: true, stopsServer: true },
]

/** Add the helper after the program's import, a mark after each call's statement, and the close mark as a phaser before the program's own. */
export function instrumentRaku(source, steps) {
  const syntax = syntaxOf('raku')
  const marked = instrumentLines(source, steps.filter((step) => !step.leave), (step) => `docs-mark(${JSON.stringify(step.id)}, ${step.value}); # docs:mark`, syntax)
  const lines = marked.split('\n')
  for (const step of steps.filter((entry) => entry.leave)) {
    const at = lines.findIndex((line) => line.includes(step.anchor))
    if (at < 0 || lines.filter((line) => line.includes(step.anchor)).length !== 1) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
    lines.splice(at, 0, `LEAVE docs-mark(${JSON.stringify(step.id)}, ${step.value}); # docs:mark`)
  }
  const import_ = lines.indexOf('use LibTmux;')
  if (import_ < 0) throw new Error('the program has no `use LibTmux;` line to put the marker helper after')
  lines.splice(import_ + 1, 0, ...PREAMBLE)
  return lines.join('\n')
}

/**
 * Each command is sent inside a guard that fails unless the daemon is the one the library checked:
 * `if-shell -F <check> '<command words>' libtmux-stale-<token>`. The words of the command inside.
 */
const unwrap = (command) => (command[0] === 'if-shell' && command[1] === '-F' && /^libtmux-stale-[0-9a-f]{32}/.test(command.at(-1) ?? '') ? splitCommandLine(command[3]) : undefined)

/** The compiler the checkout pins: the sandbox's home has no version manager configuration, so the shim would pick the system's. */
const raku = (checkout) => execFileSync('mise', ['exec', `raku@${/^raku (\S+)$/m.exec(readFileSync(join(checkout, '.tool-versions'), 'utf8'))?.[1]}`, '--', 'sh', '-c', 'command -v raku'], { encoding: 'utf8' }).trim()

/** The checkout the program was built against, which pins the compiler. */
let built

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.raku',
    stepMap: 'hand-written',
    source: (root) => quickstartSource(root, 'raku', 'quickstart.raku'),
    /** What a pane runs once it has settled: both panes run `exec cat`, which replaces their shell. */
    paneCommands: ['cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The library makes its owned socket directory under TMPDIR as `libtmux-owned-<six characters>`. */
    socket: { pattern: 'libtmux-owned-[A-Za-z0-9]{6}', fixed: 'libtmux-owned-AbC123' },
    helpers: [],
    steps: STEPS,
    fence: () => false,
    /** The library starts its daemon as `tmux -D` and binds to that process, so the shim becomes tmux for it instead of wrapping it. */
    inPlace: ['-D'],
    unwrap,
    /**
     * What the library asks tmux about itself: its version before it starts or uses a daemon, the daemon it starts in the
     * foreground, and the identity probe it sends before each command.
     */
    probe: ({ commands }) => commands.length === 0
      || commands.every((command) => command[0] === 'run-shell' && command.includes('-C') && command.some((word) => word.startsWith('libtmux-probe-'))),
    /** The probe's channel and the guard's failure token are random on every run. */
    redact: (text) => text.replace(/(libtmux-(?:probe|stale))-[0-9a-f]{32}/g, '$1-00000000000000000000000000000000'),
    instrument: instrumentRaku,
    command: (dir) => ['/bin/sh', join(dir, 'program')],
    toolchain: () => ({ raku: /v(\d{4}\.\d{2}(?:\.\d+)?)/.exec(execFileSync(raku(built), ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown' }),
    /** Write the displayed program, and the marked copy beside it, with a launcher that puts the checkout's modules on the path. */
    build({ sandbox, checkout, code, marked }) {
      built = checkout
      const compiler = raku(checkout)
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      // Precompile the library once, so that no run spends its first seconds on it.
      execFileSync(compiler, ['-I', checkout, '-e', 'use LibTmux'], { encoding: 'utf8', timeout: 600000 })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        writeFileSync(join(sandbox, dir, this.file), source)
        // A run stopped at a mark leaves its socket directory behind, and a second socket would make the sandbox ambiguous.
        // A window made with `exec cat` keeps the name `sh`, which tmux does not change until the pane writes.
        writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nrm -rf "$TMPDIR"/libtmux-owned-*\nLIBTMUX_DOCS_WINDOW_NAMES=sh\nexport TMPDIR LIBTMUX_DOCS_WINDOW_NAMES\nexec ${JSON.stringify(compiler)} -I ${JSON.stringify(checkout)} ${this.file}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
    },
  },
}
