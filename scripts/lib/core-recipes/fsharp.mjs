import { PORTS } from '../../../site/src/lib/ports.ts'
import { quickstartSource, withoutMarks } from './common.mjs'
import { buildDotnet, dotnetFence, dotnetProbe, projectFiles, runCommand, toolchain } from './dotnet.mjs'

export { withoutMarks }

/**
 * How F#'s quickstart is recorded: the calls to mark, what to build, and how
 * libtmux-dotnet's own tmux preamble is recognised. F# runs on the C# library,
 * so the build, the guards and the probes are `dotnet.mjs`'s.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to an F# expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the typed syntax tree (FSharp.Compiler.Service: every application
 * of a function or member of the library) and take the value from the name the
 * `let!` binds; the recorder would not change.
 *
 * A query is built by `Session.windows`, `Query.where` and `Filter.eq`, which
 * send nothing, and read by `Query.list`; the step is the call that reads, and
 * the builders it ends are on its lines.
 */

/** The module the marked copy compiles before the program; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const FS_HELPER = `module DocsMark

open System
open System.Diagnostics
open System.Text.Json

/// Tell the recorder that an API call has returned, and what it returned.
let mark (step: string) (value: obj) : unit =
    let start = ProcessStartInfo(Environment.GetEnvironmentVariable "LIBTMUX_DOCS_MARK", UseShellExecute = false)
    start.ArgumentList.Add step
    start.ArgumentList.Add(JsonSerializer.Serialize(value, (if isNull value then typeof<obj> else value.GetType())))
    use child = Process.Start start
    child.WaitForExit()

    if child.ExitCode <> 0 then
        eprintfn "docs mark: %s failed" step
        exit child.ExitCode
`

/** A session, a window or a pane as a recording stores it, from the variable the statement binds. */
const SESSION = (name) => `{| id = ${name}.Id.ToString(); name = ${name}.Name |}`
const WINDOW = (name) => `{| id = ${name}.Id.ToString(); index = ${name}.Index; name = ${name}.Name |}`
const PANE = (name) => `{| id = ${name}.Id.ToString() |}`

const mark = (step) => `DocsMark.mark ${JSON.stringify(step.id)} (box ${step.value}) // docs:mark`

const indentOf = (line) => /^\s*/.exec(line)[0].length

/**
 * Where a mark goes: after the `let!` or `use!` binding that holds the call,
 * at the binding's own indentation. A call is on a line in the middle of its
 * binding (`let! build =` then the pipeline below it), and the value is not in
 * scope until the binding ends: the last line before the next one at the
 * binding's indentation or less. A step with `bare: true` is a statement, not
 * a binding, and goes after its own line.
 */
function placeOf(lines, step) {
  const hits = lines.flatMap((line, index) => (line.includes(step.anchor) ? [index] : []))
  const at = hits[(step.occurrence ?? 1) - 1]
  if (at === undefined) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not in the program`)
  if (step.bare) return { after: at + 1, indent: indentOf(lines[at]) }
  let start = at
  while (start >= 0 && !/^\s*(let|use)!?\s/.test(lines[start])) start--
  if (start < 0) throw new Error(`${step.id}: no binding holds the anchor ${JSON.stringify(step.anchor)}`)
  let end = start
  for (let index = start + 1; index < lines.length && (lines[index].trim() === '' || indentOf(lines[index]) > indentOf(lines[start])); index++) if (lines[index].trim() !== '') end = index
  return { after: end + 1, indent: indentOf(lines[start]) }
}

/** Insert a mark after each binding that holds a call. */
export function instrumentFsharp(source, steps) {
  const lines = source.split('\n')
  const inserts = steps.map((step) => ({ ...placeOf(lines, step), text: mark(step) }))
  for (const { after, indent, text } of inserts.toSorted((a, b) => b.after - a.after)) lines.splice(after, 0, `${' '.repeat(indent)}${text}`)
  return lines.join('\n')
}

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'Program.fs',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the program starts it with `/bin/sh`. */
    paneCommands: ['sh'],
    source: (root) => quickstartSource(root, 'fsharp', 'app/Program.fs'),
    /** F# is built on the C# library: its checkout is libtmux-dotnet's. */
    checkout: (port, env, expand) => expand(env.LIBTMUX_DOCS_CHECKOUT_FSHARP || env.LIBTMUX_DOCS_CHECKOUT_CSHARP || PORTS.find((entry) => entry.slug === 'csharp').worktree),
    helpers: [],
    // In the order the calls run. The snapshot's sessions, windows, panes and the lookups after them are read from what it captured and send tmux nothing. The owned server is stopped when the task ends; the mark that follows `GetResult()` comes after that.
    steps: [
      { id: 'create-owned', label: 'Server.CreateOwnedAsync', anchor: 'LibTmux.Server.CreateOwnedAsync(', type: 'Task<OwnedServerScope>', value: '{| socketName = options.SocketName; configFile = options.ConfigurationFile |}' },
      { id: 'create-session', label: 'Server.CreateSessionAsync', anchor: 'owned.Value.CreateSessionAsync(', type: 'Task<Session>', value: SESSION('session') },
      { id: 'list-active', label: 'Query.list', anchor: '|> Session.windows', type: 'Task<IReadOnlyList<Window>>', value: '{| ids = [ for window in active -> window.Id.ToString() ] |}' },
      { id: 'rename', label: 'Window.rename', anchor: 'Window.rename token', type: 'Task<Window>', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Window.activePane', anchor: 'Window.activePane token', type: 'Task<Pane>', value: PANE('left') },
      { id: 'split', label: 'Pane.split', anchor: 'Pane.split', type: 'Task<Pane>', value: PANE('right') },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'Session.newWindow', type: 'Task<Window>', value: WINDOW('logs') },
      { id: 'send-and-wait', label: 'Pane.sendAndWait', anchor: 'Pane.sendAndWait', type: 'Task<PaneWaitResult>', value: '{| found = waited.Found |}' },
      { id: 'select-pane', label: 'Pane.select', anchor: 'Pane.select token', type: 'Task<Pane>', value: PANE('selected') },
      { id: 'select-window', label: 'Window.select', anchor: 'Window.select token', type: 'Task<Window>', value: WINDOW('current') },
      { id: 'connect', label: 'Server.ConnectAsync', anchor: 'LibTmux.Server.ConnectAsync(', type: 'Task<Server>', value: '{| socketName = server.ConnectionOptions.SocketName |}' },
      { id: 'capture', label: 'Server.capture', anchor: 'Server.capture token', type: 'Task<Server>', value: '{| sessions = snapshot.Sessions.Count; windows = snapshot.Windows.Count; panes = snapshot.Panes.Count |}' },
      { id: 'sessions', label: 'Server.Sessions', anchor: 'snapshot.Sessions', type: 'CapturedRelation<Session>', value: '{| ids = [ for session in sessions -> session.Id.ToString() ] |}' },
      { id: 'windows', label: 'Session.Windows', anchor: 'session.Windows', type: 'CapturedRelation<Window>', value: '{| ids = [ for window in windows -> window.Id.ToString() ] |}', repeat: true },
      { id: 'panes', label: 'Window.Panes', anchor: 'window.Panes', type: 'CapturedRelation<Pane>', value: '{| ids = [ for pane in panes -> pane.Id.ToString() ] |}', repeat: true },
      { id: 'pane-by-id', label: 'Seq.find', anchor: 'snapshot.Panes', type: 'Pane', value: PANE('pane') },
      { id: 'pane-window', label: 'Pane.Window', anchor: 'pane.Window', type: 'Window', value: WINDOW('window') },
      { id: 'window-session', label: 'Window.Session', anchor: 'window.Session', type: 'Session', value: SESSION('owner') },
      { id: 'kill', label: 'OwnedServerScope.DisposeAsync', anchor: 'runAsync().GetAwaiter()', type: 'ValueTask', value: 'null', bare: true },
    ],
    /** A wait polls the pane with a `display-message` and reads it with a `capture-pane`; `Pane.run` checks the status option before and after it waits for the signal, in whichever order the shell finishes. */
    polls: ['display-message', 'capture-pane', 'show-options', 'wait-for'],
    fence: dotnetFence,
    probe: dotnetProbe,
    /** The program names its socket `fsharp-<guid>`. */
    socket: { pattern: 'fsharp-[0-9a-f]{32}', fixed: 'fsharp-0123456789abcdef0123456789abcdef' },
    instrument: instrumentFsharp,
    command: (dir) => runCommand(dir, 'Example'),
    toolchain,
    build({ sandbox, checkout, code, marked }) {
      const project = projectFiles('fsharp', ['Example.fsproj', 'global.json'])
      const markedProject = { ...project, 'Example.fsproj': project['Example.fsproj'].replace('<Compile Include="Program.fs" />', '<Compile Include="DocsMark.fs" />\n    <Compile Include="Program.fs" />') }
      buildDotnet({
        sandbox, checkout, projects: ['LibTmux', 'LibTmux.FSharp'],
        copies: { exact: { ...project, 'Program.fs': code }, marked: { ...markedProject, 'Program.fs': marked, 'DocsMark.fs': FS_HELPER } },
      })
    },
  },
}
