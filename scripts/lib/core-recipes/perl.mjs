import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { statementLines, syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Perl's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-perl's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Perl expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (PPI: every method call on a handle the
 * library returned) and take the value from the variable the statement binds;
 * the recorder would not change.
 */

/**
 * The marker helper, a few lines of the marked copy after `use LibTmuxFixture`:
 * `docs_mark` runs `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and
 * stops the program if that fails.
 */
const PREAMBLE = [
  'use JSON::PP (); # docs:mark',
  'sub docs_mark ($step, $value) { system($ENV{LIBTMUX_DOCS_MARK}, $step, JSON::PP->new->canonical->allow_nonref->encode($value)) == 0 or exit(($? >> 8) || 70) } # docs:mark',
]

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = '{ sessions => $snapshot->sessions->count, windows => $snapshot->windows->count, panes => $snapshot->panes->count }'
/** A session, a window and a pane as a recording stores them, from the variable the statement binds. */
const NAMED = (name) => `{ id => ${name}->id, name => ${name}->name }`
const PANE = (name) => `{ id => ${name}->id }`

/**
 * In the order the calls run. A call of a handle the library returned reads
 * what was captured, and sends tmux nothing. A step with an `end` is a
 * statement that goes on past the call its anchor names, so its mark goes
 * after the line the `end` anchor names.
 */
const STEPS = [
  { id: 'new-session', label: 'Server::new_session', anchor: '$server->new_session(', type: 'Session', value: NAMED('$session') },
  { id: 'editor', label: 'WindowLink::window', anchor: '$session->window_links->one->window', type: 'Window', value: NAMED('$editor') },
  { id: 'rename', label: 'Server::rename_window', anchor: '$server->rename_window(', type: 'undef', value: 'undef' },
  { id: 'split', label: 'Server::split_pane', anchor: '$server->split_pane(', type: 'Pane', value: PANE('$right') },
  { id: 'new-window', label: 'Server::new_window', anchor: '$server->new_window(', type: 'Window', value: NAMED('$logs') },
  { id: 'select-pane', label: 'Server::select_pane', anchor: '$server->select_pane(', type: 'undef', value: 'undef' },
  { id: 'snapshot-before', label: 'Server::snapshot', anchor: 'my $snapshot = $server->snapshot;', type: 'Snapshot', value: COUNTS },
  { id: 'link', label: 'WindowLinkSelection::one', anchor: '$snapshot->window_links->one(', type: 'WindowLink', value: '{ index => $link->index, window => $link->window->id }' },
  { id: 'select-window', label: 'Server::select_window', anchor: '$server->select_window(', type: 'undef', value: 'undef' },
  { id: 'snapshot', label: 'Server::snapshot', anchor: '$snapshot = $server->snapshot;', occurrence: 2, type: 'Snapshot', value: COUNTS },
  { id: 'panes', label: 'PaneSelection::grep', anchor: '$snapshot->windows->one(', end: '->grep(sub ($pane)', type: 'PaneSelection', value: '[ map { $_->id } $panes->@* ]' },
  { id: 'selected', label: 'PaneSelection::one', anchor: '$panes->one(', type: 'Pane', value: PANE('$selected') },
  { id: 'pane-window', label: 'Window::name', anchor: 'my $name = $selected->window->name;', type: 'string', value: '$name' },
  { id: 'kill-session', label: 'Server::kill_session', anchor: '$server->kill_session(', type: 'undef', value: 'undef' },
  // The fixture stops the daemon and waits for its children after the program's last call, as `run` returns.
  { id: 'fixture', label: 'LibTmuxFixture::run', anchor: 'LibTmuxFixture->run(', type: 'undef', value: 'undef' },
]

/** Add the helper after the program's imports and a mark after each call's statement. */
export function instrumentPerl(source, steps) {
  const syntax = syntaxOf('perl')
  const placed = steps.map((step) => {
    if (!step.end) return step
    const range = statementLines(source, step.end, syntax)
    if (!range) throw new Error(`${step.id}: the end anchor ${JSON.stringify(step.end)} is not on exactly one line of the program`)
    return { ...step, after: range[1] }
  })
  const marked = instrumentLines(source, placed, (step) => `docs_mark(${JSON.stringify(step.id)}, ${step.value}); # docs:mark`, syntax)
  const lines = marked.split('\n')
  const at = lines.indexOf('use LibTmuxFixture;')
  if (at < 0) throw new Error('the program has no `use LibTmuxFixture;` line to put the marker helper after')
  lines.splice(at + 1, 0, ...PREAMBLE)
  return lines.join('\n')
}

/** The perl the checkout pins: the sandbox's home has no version manager configuration, so the shim would pick the system's. */
const perl = (checkout) => execFileSync('mise', ['exec', `perl@${/^perl (\S+)$/m.exec(readFileSync(join(checkout, '.tool-versions'), 'utf8'))?.[1]}`, '--', 'sh', '-c', 'command -v perl'], { encoding: 'utf8' }).trim()

/** The file the page shows beside the program, which the program loads, and the checkout the program was built against. */
let fixture
let built

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'examples/quickstart.pl',
    stepMap: 'hand-written',
    source: (root) => {
      const home = quickstartSource(root, 'perl', 'examples/quickstart.pl')
      fixture = quickstartSource(root, 'perl', 'scripts/lib/LibTmuxFixture.pm').code
      return home
    },
    /**
     * What a pane runs once it has settled: a one-word command is started through `perl -e 'exec ...'`, which becomes
     * the command. A window made with such a command keeps the name `perl`, which tmux does not change until the
     * pane writes (the program's `LIBTMUX_DOCS_WINDOW_NAMES`).
     */
    paneCommands: ['cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The fixture makes its socket directory under TMPDIR as `libtmux-perl-fixture-<four characters>`. */
    socket: { pattern: 'libtmux-perl-fixture-[A-Za-z0-9_]{4}', fixed: 'libtmux-perl-fixture-AbC1' },
    helpers: [],
    steps: STEPS,
    fence: () => false,
    /** What the library asks tmux about itself: its version when it connects, and the daemon's identity before it sends a command. */
    probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.some((word) => word.includes('pid')))),
    /** The library starts a one-word command with the interpreter that runs it, named by its path on the machine that recorded. */
    redact: (text) => text.replace(/\S+\/bin\/perl(?=\s)/g, '/usr/bin/perl'),
    instrument: instrumentPerl,
    command: (dir) => ['/bin/sh', join(dir, 'program')],
    toolchain: () => ({ perl: /\(v([\d.]+)\)/.exec(execFileSync(perl(built), ['-v'], { encoding: 'utf8' }))?.[1] ?? 'unknown' }),
    /** Write the displayed files, and the marked copy of the program beside them, with a launcher that puts the checkout's modules on the path. */
    build({ sandbox, checkout, code, marked }) {
      built = checkout
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir, 'examples'), { recursive: true })
        mkdirSync(join(sandbox, dir, 'scripts/lib'), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
        writeFileSync(join(sandbox, dir, 'scripts/lib/LibTmuxFixture.pm'), fixture)
        // A run stopped at a mark leaves the fixture's socket directory behind, and a second socket would make the sandbox ambiguous.
        writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nPERL5LIB=${JSON.stringify(join(checkout, 'packages/core/lib'))}\nLIBTMUX_DOCS_WINDOW_NAMES=perl\nexport TMPDIR PERL5LIB LIBTMUX_DOCS_WINDOW_NAMES\nunset PERL5OPT\nrm -rf ${JSON.stringify(join(sandbox, 'tmp'))}/libtmux-perl-fixture-*\nexec ${JSON.stringify(perl(checkout))} ${JSON.stringify(this.file)}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
    },
  },
}
