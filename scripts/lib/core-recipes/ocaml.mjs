import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { statementLines, syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, fastShim, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How OCaml's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-ocaml's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to an OCaml expression for the value each returned. It is
 * checked against the program (every anchor must be found, once or at its
 * `occurrence`, and in the order the marks arrive), not derived from it. A
 * generated map would read the calls from the program's typed tree
 * (`ocaml-compiler-libs`: every application of a `Client` or `Workspace`
 * function) and take the value from the result's type; the recorder would not
 * change.
 *
 * Marks are not lines between the program's statements: a `let ... in` binding
 * takes a line of its own only as another binding, and the last call of a
 * function has nothing after it. The marked copy adds one line after the
 * program opens `Libtmux`, which opens the helper below, and the helper
 * shadows `Libtmux_unix` with a module that holds `Client`, `Workspace` and
 * `with_private_daemon` as modules and functions that call the library's own
 * and mark when a call the program makes returns. The program's aliases of
 * `Libtmux_unix.Client` and `Libtmux_unix.Workspace` then name the marked ones
 * wherever they sit, including below the functions that use them.
 */

/**
 * The functions the marked copy wraps and what they take. The labels and the
 * optional arguments are the library's own (`libtmux_unix.mli`); a call's
 * arguments are passed on as they came.
 */
const WRAPPED = {
  'Client.capture': { params: '?cancel connection', pass: '?cancel connection' },
  'Client.wait_for_text': { params: '?cancel ?timeout ?scratch_dir connection pane ~text', pass: '?cancel ?timeout ?scratch_dir connection pane ~text' },
  'Client.create_session': { params: '?cancel ?window_name ?width ?height ?spawn connection ~name ()', pass: '?cancel ?window_name ?width ?height ?spawn connection ~name ()' },
  'Client.link_window': { params: '?cancel connection window ~session ~index', pass: '?cancel connection window ~session ~index' },
  'Workspace.submit_bootstrap': { params: '?binary ?timeout plan', pass: '?binary ?timeout plan' },
  'Workspace.await': { params: '?cancel ?compensate_on_failure operation', pass: '?cancel ?compensate_on_failure operation' },
  'Workspace.close': { params: 'operation', pass: 'operation' },
  'Libtmux_unix.with_private_daemon': { params: '?cleanup ?binary ?config_file ?root ?session ?timeout use', pass: '?cleanup ?binary ?config_file ?root ?session ?timeout use' },
}

/** The head of the helper: JSON as text, and the mark that runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const HELPER_HEAD = String.raw`let json_string text =
  let buffer = Buffer.create (String.length text + 2) in
  Buffer.add_char buffer '"';
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "\\\""
      | '\\' -> Buffer.add_string buffer "\\\\"
      | '\n' -> Buffer.add_string buffer "\\n"
      | '\r' -> Buffer.add_string buffer "\\r"
      | '\t' -> Buffer.add_string buffer "\\t"
      | c when Char.code c < 32 ->
          Buffer.add_string buffer (Printf.sprintf "\\u%04x" (Char.code c))
      | c -> Buffer.add_char buffer c)
    text;
  Buffer.add_char buffer '"';
  Buffer.contents buffer

let obj fields =
  "{"
  ^ String.concat ","
      (List.map (fun (key, value) -> json_string key ^ ":" ^ value) fields)
  ^ "}"

let int = string_of_int

let mark step value =
  match
    Sys.command
      (Filename.quote_command (Sys.getenv "LIBTMUX_DOCS_MARK") [ step; value ])
  with
  | 0 -> ()
  | status ->
      prerr_endline ("docs mark: " ^ step ^ " failed");
      exit status

let unplanned name =
  prerr_endline ("docs mark: an unplanned call of " ^ name);
  exit 70

let id_of_session value =
  Libtmux.Session.Id.to_string (Libtmux.Session.Target.id value)

let id_of_window value =
  Libtmux.Window.Id.to_string (Libtmux.Window.Target.id value)

let id_of_pane value =
  Libtmux.Pane.Id.to_string (Libtmux.Pane.Target.id value)
`

/** The wrapper of one function: its calls are the steps that name it, in the order the program makes them. */
function wrapper(call, steps) {
  const name = call.split('.')[1]
  const { params, pass } = WRAPPED[call]
  const arms = steps.map((step, index) => `    | ${index}, Ok ${/\bvalue\b/.test(step.value) ? 'value' : '_'} -> mark ${JSON.stringify(step.id)} (${step.value})`)
  return `  let ${name}_calls = ref 0

  let ${name} ${params} =
    let result = ${name} ${pass} in
    (match (!${name}_calls, result) with
    | _, Error _ -> ()
${arms.join('\n')}
    | _ -> unplanned ${JSON.stringify(call)});
    incr ${name}_calls;
    result
`
}

/**
 * The helper with its plan: for each module, the functions its steps mark. `Libtmux_unix` is shadowed last, by a module
 * that holds the marked `Client` and `Workspace` beside its own marked functions, so that every line of the program
 * that names `Libtmux_unix.Client` or `Libtmux_unix.Workspace` (an alias, wherever it sits) names the marked one.
 */
export function ocamlHelper(steps) {
  const modules = [...new Set(steps.map((step) => step.call.split('.')[0]))].filter((module) => module !== 'Libtmux_unix')
  const callsOf = (module) => [...new Set(steps.filter((step) => step.call.startsWith(`${module}.`)).map((step) => step.call))]
  const wrapped = (module, calls) => calls.map((call) => wrapper(call, steps.filter((step) => step.call === call))).join('\n')
  const bodies = modules.map((module) => `module ${module} = struct
  include Libtmux_unix.${module}

${wrapped(module, callsOf(module))}end

module Marked_${module.toLowerCase()} = ${module}
`)
  const library = `module Libtmux_unix = struct
  include Libtmux_unix

${modules.map((module) => `  module ${module} = Marked_${module.toLowerCase()}\n`).join('\n')}
${wrapped('Libtmux_unix', callsOf('Libtmux_unix'))}end
`
  return `${HELPER_HEAD}\n${bodies.join('\n')}\n${library}`
}

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = 'obj [ ("sessions", int (Iarray.length (Libtmux.Snapshot.sessions value))); ("windows", int (Iarray.length (Libtmux.Snapshot.windows value))); ("links", int (Iarray.length (Libtmux.Snapshot.window_links value))); ("panes", int (Iarray.length (Libtmux.Snapshot.panes value))) ]'
/** What a creation reports: the session, the window and the pane it made. */
const CREATED = 'obj [ ("session", json_string (id_of_session value.Libtmux.Created.session)); ("window", json_string (id_of_window value.Libtmux.Created.window)); ("pane", json_string (id_of_pane value.Libtmux.Created.pane)) ]'
/** What a wait found: the pane and the text it waited for. */
const WAITED = 'obj [ ("pane", json_string (Libtmux.Pane.Id.to_string value.Libtmux.Captured_text.pane)); ("text", json_string text) ]'
/** What applying the plan came to. */
const RECEIPT = 'obj [ ("status", json_string (if value.Libtmux_workspace.Execution.status = Libtmux_workspace.Execution.Succeeded then "succeeded" else "failed")); ("steps", int (Iarray.length value.Libtmux_workspace.Execution.steps)) ]'

/**
 * In the order the calls run, which is not the order of the lines: `with_demo` starts a private daemon with
 * `with_private_daemon`, submits a workspace plan to it and reads the result, then runs `capture_graph`, which comes
 * first in the file. It makes a second session, links the first window into it, and captures the graph. The workspace
 * handle is closed inside the daemon's scope, and `with_private_daemon` returns last, once it has stopped the daemon
 * by its process id and removed its directory, with no tmux command of its own. The `occurrence` of a call is the
 * n-th line that holds its anchor.
 */
const STEPS = [
  { id: 'submit', label: 'Workspace.submit_bootstrap', anchor: 'Workspace.submit_bootstrap', type: 'Workspace.t', call: 'Workspace.submit_bootstrap', value: '"null"' },
  { id: 'await', label: 'Workspace.await', anchor: 'Workspace.await operation', type: 'Execution.receipt', call: 'Workspace.await', value: RECEIPT },
  { id: 'capture-initial', label: 'Client.capture', anchor: 'get (Client.capture client)', occurrence: 3, type: 'Snapshot.t', call: 'Client.capture', value: COUNTS },
  { id: 'wait-initial', label: 'Client.wait_for_text', anchor: 'Client.wait_for_text ~timeout:0.5 client pane', occurrence: 2, type: 'Captured_text.t', call: 'Client.wait_for_text', value: WAITED },
  { id: 'create-session', label: 'Client.create_session', anchor: 'Client.create_session', type: 'Created.t', call: 'Client.create_session', value: CREATED },
  { id: 'capture-linked', label: 'Client.capture', anchor: 'get (Client.capture client)', occurrence: 1, type: 'Snapshot.t', call: 'Client.capture', value: COUNTS },
  { id: 'wait-linked', label: 'Client.wait_for_text', anchor: 'Client.wait_for_text ~timeout:0.5 client pane', occurrence: 1, type: 'Captured_text.t', call: 'Client.wait_for_text', value: WAITED },
  { id: 'link-window', label: 'Client.link_window', anchor: 'Client.link_window', type: 'unit', call: 'Client.link_window', value: '"null"' },
  { id: 'capture-graph', label: 'Client.capture', anchor: 'get (Client.capture client)', occurrence: 2, type: 'Snapshot.t', call: 'Client.capture', value: COUNTS },
  { id: 'close', label: 'Workspace.close', anchor: 'Workspace.close operation', type: 'unit', call: 'Workspace.close', value: '"null"' },
  { id: 'retire', label: 'Libtmux_unix.with_private_daemon', anchor: 'Libtmux_unix.with_private_daemon ~binary', type: 'Snapshot.t', call: 'Libtmux_unix.with_private_daemon', value: COUNTS, stopsServer: true },
]

/** The line the marked copy adds: it opens the helper right after the program opens the library, before any alias of `Libtmux_unix`. */
const OPEN = 'open Docs_mark (* docs:mark *)'

/** Add the one line that opens the helper, after the program opens `Libtmux`. */
export function instrumentOcaml(source, steps) {
  for (const step of steps) {
    if (!statementLines(source, step.anchor, syntaxOf('ocaml'), step.occurrence)) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
    if (!(step.call in WRAPPED)) throw new Error(`${step.id}: ${step.call} is not a function the helper wraps`)
  }
  const lines = source.split('\n')
  const at = lines.indexOf('open Libtmux')
  if (at < 0) throw new Error('the program has no `open Libtmux` line to open the helper after')
  lines.splice(at + 1, 0, OPEN)
  return lines.join('\n')
}

/** The buffer names (`libtmux-ocaml-<hex>`) and client names (`client-<pid>`) that differ on every run. */
const scrub = (text) => text.replace(/libtmux-ocaml-[0-9a-f]{32,}/g, 'libtmux-ocaml-0000').replace(/client-\d+/g, 'client-0')

/** The tool versions the checkout pins, and the opam they name. */
const pinned = (checkout, tool) => new RegExp(`^${tool} (\\S+)$`, 'm').exec(readFileSync(join(checkout, '.tool-versions'), 'utf8'))?.[1]
const opamProgram = (checkout) => execFileSync('mise', ['exec', `opam@${pinned(checkout, 'opam')}`, '--', 'sh', '-c', 'command -v opam'], { encoding: 'utf8' }).trim()

/**
 * Where opam keeps the switch the program is built in: the environment's own, as a reader's opam finds it. The
 * sandbox's home is not the reader's, so the launcher names it.
 */
const opamEnv = () => ({ OPAMROOT: process.env.OPAMROOT ?? join(homedir(), '.opam'), ...(process.env.OPAMSWITCH ? { OPAMSWITCH: process.env.OPAMSWITCH } : {}), OPAMYES: '1', OPAMCOLOR: 'never', OPAMNOENVNOTICE: '1' })

/** The checkout the program was built against, and the other files the page shows beside it. */
let built
let files

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'examples/showcase_graph.ml',
    stepMap: 'hand-written',
    source: (root) => {
      const home = quickstartSource(root, 'ocaml', 'examples/showcase_graph.ml')
      files = { 'dune-project': quickstartSource(root, 'ocaml', 'dune-project').code, 'examples/dune': quickstartSource(root, 'ocaml', 'examples/dune').code }
      return home
    },
    /** Each pane runs `sh -c 'echo ...; exec cat -u'`, which `exec` turns into `cat`. */
    paneCommands: ['cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** `with_private_daemon` makes its socket directory under TMPDIR as `libtmux-ocaml-<six hex digits>`; the buffer names and end-of-reply markers that share the prefix hold more digits. */
    socket: { pattern: 'libtmux-ocaml-[0-9a-f]{6}(?![0-9a-f])', fixed: 'libtmux-ocaml-0a1b2c' },
    /** The library starts its daemon as `tmux -D -S <socket> -f /dev/null` and stops it by that process id, so the shim becomes tmux for it, which a wrapper process in between would prevent. */
    inPlace: ['/dev/null'],
    helpers: [{ file: 'examples/docs_mark.ml', source: ocamlHelper(STEPS) }],
    steps: STEPS,
    /**
     * What the library sends for its own bookkeeping, which a recording does not show: the marker it asks tmux to print
     * to end each command's reply (`display-message -p libtmux-ocaml-<64 hex digits>`), and the pause it writes for each
     * pane a closing control client observed (`refresh-client -A %<n>:pause`), which tmux runs before the exit that
     * follows and whose reply nobody reads.
     */
    fence: (command) => (command[0] === 'display-message' && command[1] === '-p' && /^libtmux-ocaml-[0-9a-f]{64}$/.test(command[2] ?? ''))
      || (command[0] === 'refresh-client' && command[1] === '-A' && /^%\d+:pause$/.test(command[2] ?? '') && command.length === 3),
    /** What the library asks tmux about itself: its version before it starts a server, and the daemon's process id and version before a command. */
    probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command[1] === '-p' && command.length === 3 && (command[2].startsWith('#{q:pid}') || command[2].endsWith('probe')))),
    /** What differs on every run: the names the library gives its buffers, the control client's name (it holds a process id), and that id. */
    redact: scrub,
    reply: (text) => scrub(text).replace(/^(client-0\|[^|]*)\|\d+\|/gm, '$1|0|'),
    /** The program prints a line for each link and its socket before the line the page shows. */
    normalizeOutput: (text) => text.split('\n').filter((line) => line.startsWith('graph: ')).map((line) => `${line}\n`).join(''),
    instrument: instrumentOcaml,
    command: (dir) => ['/bin/sh', join(dir, 'program')],
    toolchain: () => {
      const opam = opamProgram(built)
      const run = (...args) => execFileSync(opam, ['exec', '--', ...args], { encoding: 'utf8', env: { ...process.env, ...opamEnv() } }).trim()
      return { ocaml: run('ocamlc', '-version'), dune: run('dune', '--version'), opam: execFileSync(opam, ['--version'], { encoding: 'utf8' }).trim() }
    },
    /**
     * Write the displayed project and the marked one, which also holds the helper, and build each in the opam switch
     * that has the library installed. The launcher runs the built program as the page's command does, with a
     * `TMPDIR` of its own under the sandbox's `tmp`, where the recorder looks for the daemon's socket.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      built = checkout
      const opam = opamProgram(checkout)
      const env = { ...process.env, ...opamEnv(), HOME: process.env.HOME }
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      fastShim(sandbox)
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        const project = join(sandbox, dir)
        mkdirSync(join(project, 'examples'), { recursive: true })
        writeFileSync(join(project, this.file), source)
        for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text)
        if (dir === 'marked') for (const helper of helpers) writeFileSync(join(project, helper.file), helper.source)
        execFileSync(opam, ['exec', '--', 'dune', 'build', '--root', '.', './examples/showcase_graph.exe'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'], env })
        const exports = Object.entries(opamEnv()).map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        writeFileSync(join(project, 'program'), `#!/bin/sh\n${exports.join('\n')}\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nexport ${Object.keys(opamEnv()).join(' ')} TMPDIR\nunset TMUX TMUX_PANE\n# A run stopped at a mark leaves the program's socket directory behind, and a second socket would make the sandbox ambiguous.\nrm -rf ${JSON.stringify(join(sandbox, 'tmp'))}/libtmux-ocaml-*\nexec ${JSON.stringify(opam)} exec -- dune exec --root . --no-build examples/showcase_graph.exe\n`)
        chmodSync(join(project, 'program'), 0o755)
      }
    },
  },
}
