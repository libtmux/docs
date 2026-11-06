import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Julia's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-julia's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Julia expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (JuliaSyntax: every call to a function
 * the library exports) and take the value from the variable the statement
 * binds; the recorder would not change.
 */

/**
 * The file the marked copy loads before the program (`julia -L`). `docs_mark`
 * runs `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. It uses nothing but Base.
 */
const JULIA_HELPER = `# Docs recorder: tells the recorder that an API call has returned, and what it returned.
import LibTmux

# The program drops what these calls return. Each is shadowed in Main, before the program's \`using LibTmux\`, by a
# function that remembers the value and gives it back; the program's own text is unchanged.
const DOCS_RETURNED = Dict{String,Any}()
for name in (:rename_window, :send_keys, :wait_for_text, :select_pane, :select_window)
    @eval $name(args...; kwargs...) = (DOCS_RETURNED[$(String(name))] = LibTmux.$name(args...; kwargs...))
end

docs_json(::Nothing) = "null"
docs_json(value::Bool) = value ? "true" : "false"
docs_json(value::Integer) = string(value)
function docs_json(value::AbstractString)
    out = IOBuffer()
    write(out, '"')
    for c in value
        if c == '"' || c == '\\\\'
            write(out, '\\\\', c)
        elseif c == '\\n'
            write(out, "\\\\n")
        elseif c < ' '
            write(out, "\\\\u", string(Int(c); base=16, pad=4))
        else
            write(out, c)
        end
    end
    write(out, '"')
    String(take!(out))
end
docs_json(value::Symbol) = docs_json(String(value))
docs_json(value::AbstractVector) = string("[", join((docs_json(item) for item in value), ","), "]")
docs_json(value::AbstractDict) = string("{", join((string(docs_json(String(key)), ":", docs_json(item)) for (key, item) in value), ","), "}")

function docs_mark(step, value)
    status = try
        run(\`\$(ENV["LIBTMUX_DOCS_MARK"]) \$step \$(docs_json(value))\`)
        0
    catch error
        println(stderr, "docs mark: ", step, ": ", sprint(showerror, error))
        error isa ProcessFailedException ? error.procs[1].exitcode : 70
    end
    status == 0 || exit(status)
end
`

/** Insert a mark after each step's statement; a step may name the line to put it after (`afterAnchor`), for a call whose statement is a block. */
export function instrumentJulia(source, steps) {
  const lines = source.split('\n')
  const placed = steps.map((step) => {
    if (!step.afterAnchor) return step
    const at = lines.findIndex((line) => line.includes(step.afterAnchor))
    if (at < 0 || lines.some((line, index) => index > at && line.includes(step.afterAnchor))) throw new Error(`${step.id}: afterAnchor ${JSON.stringify(step.afterAnchor)} is not on exactly one line`)
    return { ...step, after: at + 1 }
  })
  return instrumentLines(source, placed, (step) => `docs_mark(${JSON.stringify(step.id)}, ${step.value}) # docs:mark`, '#')
}

/**
 * Stands in front of the recorder's `tmux` shim. libtmux-julia starts the daemon it owns as a foreground `tmux -D`
 * and stops it with a signal, and the shim would put a process between the library and that daemon: the signal would
 * not reach it and the server would outlive the program. A foreground server has no command to trace, so it runs
 * as it is; every other invocation goes through the shim.
 */
const TMUX_LAUNCHER = `#!/bin/sh
skip=
for word in "$@"; do
  if [ -n "$skip" ]; then skip=; continue; fi
  case $word in
    -c|-f|-L|-S|-T) skip=1 ;;
    -D) exec "$LIBTMUX_DOCS_REAL_TMUX" "$@" ;;
    -*) ;;
    *) break ;;
  esac
done
exec SHIM "$@"
`

/** The Julia the page names (1.13.0); `mise` is how it is installed here, and its shim has no version set. */
const julia = () => join(execFileSync('mise', ['where', 'julia@1.13.0'], { encoding: 'utf8' }).trim(), 'bin/julia')
const depot = () => process.env.LIBTMUX_DOCS_JULIA_DEPOT || join(homedir(), '.julia')

/** What a shadowed call returned: a CommandResult's exit code. */
const RETURNED = (name) => `Dict("exitcode" => DOCS_RETURNED["${name}"].exitcode)`
const SERVER = 'Dict("socketPath" => something(server.socket_path, ""), "tmux" => server.tmux)'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.jl',
    stepMap: 'hand-written',
    source: (root) => quickstartSource(root, 'julia', 'quickstart.jl'),
    helpers: [{ file: 'docs_mark.jl', source: JULIA_HELPER }],
    // What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh.
    paneCommands: ['sh'],
    // In the order the calls run. The five calls whose result the program drops (a CommandResult, or the wait's) are
    // shadowed by the helper, which keeps what they returned. The last six read the snapshot and send tmux nothing;
    // the loops mark once per session and once per window.
    steps: [
      { id: 'with-server', label: 'with_server', anchor: 'with_server() do server', afterAnchor: 'with_server() do server', type: 'Server', value: SERVER },
      { id: 'new-session', label: 'new_session', anchor: 'demo = new_session(', type: 'SessionRef', value: 'Dict("id" => string(demo.id))' },
      { id: 'snapshot-window', label: 'snapshot', anchor: 'editor = only(windows(snapshot(server, demo))).ref', type: 'Snapshot', value: 'Dict("window" => string(editor.id))' },
      { id: 'rename-window', label: 'rename_window', anchor: 'rename_window(server, editor,', type: 'CommandResult', value: RETURNED('rename_window') },
      { id: 'snapshot-pane', label: 'snapshot', anchor: 'left = only(filter(', type: 'Snapshot', value: 'Dict("pane" => string(left.id))' },
      { id: 'split-window', label: 'split_window', anchor: 'right = split_window(', type: 'PaneRef', value: 'Dict("pane" => string(right.id))' },
      { id: 'new-window', label: 'new_window', anchor: 'logs = new_window(', type: 'WindowRef', value: 'Dict("window" => string(logs.id))' },
      { id: 'send-keys', label: 'send_keys', anchor: 'send_keys(server, right,', type: 'CommandResult', value: RETURNED('send_keys') },
      { id: 'wait-for-text', label: 'wait_for_text', anchor: 'wait_for_text(server, right,', type: 'ScreenWaitResult', value: 'Dict("source" => DOCS_RETURNED["wait_for_text"].source)' },
      { id: 'select-pane', label: 'select_pane', anchor: 'select_pane(server, right)', type: 'CommandResult', value: RETURNED('select_pane') },
      { id: 'select-window', label: 'select_window', anchor: 'select_window(server, WindowLinkRef(', type: 'CommandResult', value: RETURNED('select_window') },
      { id: 'snapshot', label: 'snapshot', anchor: 'snap = snapshot(server)', type: 'Snapshot', value: 'Dict("sessions" => length(sessions(snap)), "windows" => length(windows(snap)), "panes" => length(panes(snap)))' },
      { id: 'sessions', label: 'sessions', anchor: 'listed = sessions(snap)', type: 'Selection{SessionSnapshot}', value: 'Dict("sessions" => [string(each.id) for each in listed])' },
      { id: 'windowlinks', label: 'windowlinks', anchor: 'links = windowlinks(each)', type: 'Selection{WindowLink}', value: 'Dict("windows" => [string(link.window_id) for link in links])', repeat: true },
      { id: 'link-windows', label: 'window', anchor: 'wins = [window(link) for link in links]', type: 'Vector{WindowSnapshot}', value: 'Dict("windows" => [string(win.id) for win in wins])', repeat: true },
      { id: 'panes', label: 'panes', anchor: 'members = panes(win)', type: 'Selection{PaneSnapshot}', value: 'Dict("panes" => [string(member.id) for member in members])', repeat: true },
      { id: 'snapshot-pane-ref', label: 'Snapshot[PaneRef]', anchor: 'pane = snap[right]', type: 'PaneSnapshot', value: 'Dict("id" => string(pane.id))' },
      { id: 'pane-window', label: 'window', anchor: 'home = window(pane)', type: 'WindowSnapshot', value: 'Dict("id" => string(home.id), "name" => home.name)' },
      { id: 'window-session', label: 'session', anchor: 'owner = session(only(windowlinks(home)))', type: 'SessionSnapshot', value: 'Dict("id" => string(owner.id), "name" => owner.name)' },
    ],
    /** The owned daemon lives in a directory `mktempdir` names with six random characters under TMPDIR; the recording shows one fixed name, directly under `/tmp`. */
    socket: { pattern: 'tmp/libtmux-julia-[A-Za-z0-9]{6}', fixed: 'libtmux-julia-AbC123' },
    /**
     * What the library asks tmux about itself: `tmux -V` before it starts a daemon, the readiness probe it sends the daemon it has just started (`-N`,
     * `display-message -p #{pid}`), and, after each command, a `display-message` that reads the daemon's identity
     * (`pid`, `start_time`, `version`, `socket_path`) or round-trips the escape of a format value (`:version}`).
     */
    probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.some((word) => word === '#{pid}' || /:version\}/.test(word)))),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    instrument: instrumentJulia,
    command: (dir) => [join(dir, 'program')],
    toolchain: () => ({ julia: execFileSync(julia(), ['--version'], { encoding: 'utf8' }).trim().replace(/^julia version /, '') }),
    /** Write the displayed and the marked copy beside a launcher that runs them on the checkout's library, offline, after precompiling it once. */
    build({ sandbox, checkout, code, marked, helpers }) {
      const env = { ...process.env, JULIA_PKG_OFFLINE: 'true', JULIA_DEPOT_PATH: depot() }
      // The recorder reads the owned daemon's socket from a directory under the sandbox's own `tmp`.
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      mkdirSync(join(sandbox, 'jlbin'), { recursive: true })
      writeFileSync(join(sandbox, 'jlbin/tmux'), TMUX_LAUNCHER.replace('SHIM', JSON.stringify(join(sandbox, 'bin/tmux'))))
      chmodSync(join(sandbox, 'jlbin/tmux'), 0o755)
      // Precompile once here so the marks' timing is not dominated by compiling the library.
      execFileSync(julia(), ['--startup-file=no', `--project=${checkout}`, '-e', 'using LibTmux'], { env, stdio: 'inherit' })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
        const load = dir === 'marked' ? ` -L ${JSON.stringify(join(sandbox, dir, 'docs_mark.jl'))}` : ''
        writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nPATH=${JSON.stringify(join(sandbox, 'jlbin'))}:$PATH\nLIBTMUX_DOCS_WINDOW_NAMES=sh\nJULIA_PKG_OFFLINE=true\nJULIA_DEPOT_PATH=${JSON.stringify(depot())}\nexport TMPDIR PATH LIBTMUX_DOCS_WINDOW_NAMES JULIA_PKG_OFFLINE JULIA_DEPOT_PATH\nexec ${JSON.stringify(julia())} --startup-file=no --project=${JSON.stringify(checkout)}${load} ${JSON.stringify(join(sandbox, dir, this.file))}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
      for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
    },
  },
}
