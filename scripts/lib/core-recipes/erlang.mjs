import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Erlang's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-erlang's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to an Erlang expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's abstract forms (`epp_dodger`: every remote call of a
 * `tmux_*` module) and take the value from the variable the match binds; the
 * recorder would not change.
 */

/**
 * The module the marked copy compiles beside the program. `mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails.
 */
const ERLANG_HELPER = `-module(docs_mark).
-export([mark/2]).

mark(Step, Value) ->
    Json = iolist_to_binary(json:encode(Value)),
    Port = open_port({spawn_executable, os:getenv("LIBTMUX_DOCS_MARK")},
                     [exit_status, binary, stderr_to_stdout, {args, [Step, Json]}]),
    wait(Port, Step).

wait(Port, Step) ->
    receive
        {Port, {data, _}} -> wait(Port, Step);
        {Port, {exit_status, 0}} -> ok;
        {Port, {exit_status, Status}} ->
            io:format(standard_error, "docs mark: ~s failed~n", [Step]),
            erlang:halt(Status)
    end.
`

/** Add a mark after each step's statement; the mark ends in the trailer the displayed copy is stripped by. */
export function instrumentErlang(source, steps) {
  return instrumentLines(source, steps, (step) => `docs_mark:mark(<<${JSON.stringify(step.id)}>>, ${step.value}), % docs:mark`, syntaxOf('erlang'))
}

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = '#{sessions => length(tmux_snapshot:sessions(Snapshot)), windows => length(tmux_snapshot:windows(Snapshot)), panes => length(tmux_snapshot:panes(Snapshot))}'
/** A session, a window and a pane as a recording stores them, from the variable the match binds. */
const NAMED = (name) => `#{id => tmux_model:get(id, ${name}), name => tmux_model:get(name, ${name})}`
const ID = (name) => `#{id => tmux_model:get(id, ${name})}`
/** How many a selection holds. */
const SIZE = (name) => `#{count => tmux_select:size(${name})}`

/**
 * In the order the calls run. A match of `{ok, _}` drops what the call returned beside `ok`, so its value is `ok`. The
 * reads of a snapshot send tmux nothing. `with_owned` returns last, once it has stopped the server it started, by its
 * process id and not by a command, and its anchor is the line that closes the function it runs.
 */
const STEPS = [
  { id: 'session', label: 'tmux_session:create', anchor: 'tmux_session:create(', type: 'Session', value: NAMED('Session') },
  { id: 'worker', label: 'tmux_window:create', anchor: 'tmux_window:create(', type: 'Window', value: NAMED('Worker') },
  { id: 'split', label: 'tmux_pane:split', anchor: 'tmux_pane:split(', type: 'Pane', value: ID('Right') },
  { id: 'layout', label: 'tmux_window:select_layout', anchor: 'tmux_window:select_layout(', type: '{ok, _}', value: 'ok' },
  { id: 'resize', label: 'tmux_pane:resize', anchor: 'tmux_pane:resize(', type: '{ok, _}', value: 'ok' },
  { id: 'snapshot', label: 'tmux_server:snapshot', anchor: 'tmux_server:snapshot(', type: 'Snapshot', value: COUNTS },
  { id: 'windows', label: 'tmux_select:windows', anchor: 'tmux_select:windows(', type: 'Selection', value: SIZE('Windows') },
  { id: 'captured', label: 'tmux_select:one', anchor: 'tmux_select:one(Workers', type: 'Window', value: NAMED('Captured') },
  { id: 'children', label: 'tmux_snapshot:related', anchor: 'tmux_snapshot:related(', type: '[Pane]', value: '[Id || #pane{id = Id} <:- Children]' },
  { id: 'fetched', label: 'tmux_query:fetch', anchor: 'tmux_query:fetch(Query)', type: 'Selection', value: SIZE('Fetched') },
  { id: 'rename', label: 'tmux_window:rename', anchor: 'tmux_window:rename(', type: '{ok, _}', value: 'ok' },
  { id: 'fresh', label: 'tmux_query:fetch', anchor: 'tmux_query:fetch(tmux_query:where(', type: 'Selection', value: SIZE('Fresh') },
  { id: 'renamed', label: 'tmux_select:one', anchor: 'tmux_select:one(Fresh)', type: 'Window', value: NAMED('Renamed') },
  { id: 'retire', label: 'tmux_server:with_owned', anchor: 'end),', type: 'map', value: 'Result', stopsServer: true },
]

/** The other files the page shows, which the build writes beside the program. */
let files
let built

const toolVersions = (checkout) => Object.fromEntries(readFileSync(join(checkout, '.tool-versions'), 'utf8').split('\n').filter(Boolean).map((line) => line.split(' ')))
/** Where mise keeps a pinned tool's program, for the sandbox, whose home has no version manager configuration. */
const toolProgram = (checkout, tool, program) => execFileSync('mise', ['exec', `${tool}@${toolVersions(checkout)[tool]}`, '--', 'sh', '-c', `command -v ${program}`], { encoding: 'utf8' }).trim()

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'src/readme_demo.erl',
    stepMap: 'hand-written',
    source: (root) => {
      const home = quickstartSource(root, 'erlang', 'src/readme_demo.erl')
      files = { 'rebar.config': quickstartSource(root, 'erlang', 'rebar.config').code, 'src/tmux_example.app.src': quickstartSource(root, 'erlang', 'src/tmux_example.app.src').code }
      return home
    },
    paneCommands: ['cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    socket: { pattern: 'ltm-owned-[0-9a-f]{24}', fixed: 'ltm-owned-0123456789abcdef01234567' },
    helpers: [{ file: 'src/docs_mark.erl', source: ERLANG_HELPER }],
    steps: STEPS,
    fence: () => false,
    /** What the library asks tmux about itself: the daemon's pid and version, before each command. */
    probe: ({ commands }) => commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.includes('#{pid}\t#{version}')),
    instrument: instrumentErlang,
    command: (dir) => ['unshare', '--user', '--map-current-user', '--keep-caps', '--mount', 'sh', '-c', 'S=$1 && mkdir -p "$S/tmp/${S##*/}" && mount --bind "$S" "$S/tmp/${S##*/}" && mount --rbind "$S/tmp" /tmp && exec "$2"', 'sh', dirname(dir), join(dir, 'program')],
    toolchain: () => ({ erlang: toolVersions(built).erlang, otp: execFileSync(toolProgram(built, 'erlang', 'erl'), ['-noshell', '-eval', 'io:format("~s", [erlang:system_info(otp_release)]), halt().'], { encoding: 'utf8' }), rebar: toolVersions(built).rebar }),
    /**
     * Write the displayed project and the marked one, each building the checkout as `_checkouts/libtmux_erlang`, where
     * rebar3 takes a dependency from a directory instead of fetching it. The daemon's own bootstrap invocation blocks
     * until the program stops it and prints the daemon's pid on the way, so the recorder's tmux shim, which returns
     * what a command printed once it has exited, would hold it back: that invocation runs as tmux itself.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      built = checkout
      const erl = toolProgram(checkout, 'erlang', 'erl')
      const rebar3 = toolProgram(checkout, 'rebar', 'rebar3')
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      const script = join(sandbox, 'bin/tmux')
      // One operation makes about ten tmux invocations and has 2.5 s; node's start-up alone took most of that on a loaded host, bun's is a tenth.
      const runtime = execFileSync('sh', ['-c', 'command -v bun || command -v node'], { encoding: 'utf8' }).trim()
      writeFileSync(join(sandbox, 'bin/tmux-shim.sh'), readFileSync(script, 'utf8').replace(/^NODE=.*$/m, `NODE=${JSON.stringify(runtime)}`))
      writeFileSync(script, `#!/bin/sh\nfor word in "$@"; do\n  if [ "$word" = owned-lifetime ]; then exec "$LIBTMUX_DOCS_REAL_TMUX" "$@"; fi\ndone\nexec /bin/sh ${JSON.stringify(join(sandbox, 'bin/tmux-shim.sh'))} "$@"\n`)
      chmodSync(script, 0o755)
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        const project = join(sandbox, dir)
        mkdirSync(join(project, 'src'), { recursive: true })
        writeFileSync(join(project, this.file), source)
        for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text)
        mkdirSync(join(project, '_checkouts'), { recursive: true })
        cpSync(join(checkout, 'apps/libtmux_erlang'), join(project, '_checkouts/libtmux_erlang'), { recursive: true })
        if (dir === 'marked') for (const helper of helpers) writeFileSync(join(project, helper.file), helper.source)
        execFileSync(rebar3, ['compile'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PATH: `${dirname(erl)}:${dirname(rebar3)}:${process.env.PATH}`, HOME: join(sandbox, 'home'), REBAR_CACHE_DIR: join(sandbox, 'rebar-cache') } })
        const eval_ = '{ok, _} = application:ensure_all_started(libtmux_erlang), Tmux = unicode:characters_to_binary(os:find_executable("tmux")), Stats = readme_demo:run(Tmux), io:format("~B session, ~B windows, ~B panes; ~B matches~n", [maps:get(sessions, Stats), maps:get(windows, Stats), maps:get(panes, Stats), maps:get(matched_panes, Stats)]), halt().'
        writeFileSync(join(project, 'program'), `#!/bin/sh\nrm -rf ${JSON.stringify(join(sandbox, 'tmp'))}/ltm-owned-*\nPATH=${JSON.stringify(dirname(erl))}:$PATH\nexport PATH\nexec env -u TMUX -u TMUX_PANE erl -noshell -pa _build/default/lib/tmux_example/ebin -pa _build/default/checkouts/libtmux_erlang/ebin -eval ${JSON.stringify(eval_)}\n`)
        chmodSync(join(project, 'program'), 0o755)
      }
    },
  },
}
