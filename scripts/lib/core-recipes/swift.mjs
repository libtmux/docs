import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'
import { readFileSync } from 'node:fs'
import { splitCommandLine } from '../core-trace.mjs'

export { withoutMarks }

/**
 * How Swift's programs are recorded, one recipe per program: the calls to
 * mark, what to build, and how libtmux-swift's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of one program to
 * their anchors and to a Swift expression for the value each returned (a
 * `String` of JSON, built with the helpers below). It is checked against the
 * program (every anchor must be found once and in the order the marks arrive),
 * not derived from it. A generated map would read the calls from the program's
 * syntax tree (swift-syntax: every call on a type of the library) and take the
 * value from the binding the statement makes; the recorder would not change.
 */

/** A file of the marked copy: the helpers that run `docs-mark` and stop the program if that fails. */
const SWIFT_HELPER = `import Foundation

/// Tells the recorder that an API call has returned, and what it returned.
func docsMark(_ step: String, _ value: String) {
    guard let mark = ProcessInfo.processInfo.environment["LIBTMUX_DOCS_MARK"] else {
        FileHandle.standardError.write(Data("docs mark: LIBTMUX_DOCS_MARK is not set\\n".utf8))
        exit(70)
    }
    let process = Process()
    process.executableURL = URL(fileURLWithPath: mark)
    process.arguments = [step, value]
    do {
        try process.run()
    } catch {
        FileHandle.standardError.write(Data("docs mark: \\(step): \\(error)\\n".utf8))
        exit(70)
    }
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        FileHandle.standardError.write(Data("docs mark: \\(step) exited \\(process.terminationStatus)\\n".utf8))
        exit(process.terminationStatus)
    }
}

/// A string as a JSON string literal.
func docsString(_ text: String) -> String {
    var out = "\\""
    for scalar in text.unicodeScalars {
        switch scalar {
        case "\\"": out += "\\\\\\""
        case "\\\\": out += "\\\\\\\\"
        case "\\n": out += "\\\\n"
        case "\\r": out += "\\\\r"
        case "\\t": out += "\\\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    return out + "\\""
}

/// An object from key and JSON-value pairs, in order.
func docsObject(_ fields: [(String, String)]) -> String {
    "{" + fields.map { docsString($0.0) + ":" + $0.1 }.joined(separator: ",") + "}"
}

/// An array of JSON values.
func docsArray(_ items: [String]) -> String {
    "[" + items.joined(separator: ",") + "]"
}

/// An endpoint as the recording stores it: which kind of address it is, and the address.
func docsEndpoint(_ endpoint: Endpoint) -> String {
    switch endpoint {
    case .socketName(let name): docsObject([("socketName", docsString(name))])
    case .socketPath(let path): docsObject([("socketPath", docsString(path))])
    }
}
`

/** Put the helper's import of the library in front of it: the helper file names `Endpoint`. */
const HELPER = SWIFT_HELPER.replace('import Foundation\n', 'import Foundation\nimport LibTmux\n')

const ID = (value) => `docsString(${value}.id.rawValue)`

/** SwiftPM's scratch directories, on disk (`/tmp` is memory); the packages are written here so the build is incremental from one run to the next. */
const BUILD = '/home/d/tmp-wave/swift-core-player'
/** The toolchain links `libxml2.so.2`, which this host has only as `.so.16`: a symlink named for the old one, here. */
const LIBS = join(BUILD, 'libs')

/** The socket name the program draws: `libtmux-home-` and an upper-case UUID. */
const SOCKET = /libtmux-home-[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}/g
const FIXED_SOCKET = 'libtmux-home-00000000-0000-0000-0000-000000000000'

/**
 * The words of the commands inside libtmux-swift's guards. Every command is sent as
 * `if-shell -F <the daemon is the one read> '<inner>' <restarted>`, and the inner text is
 * itself guarded (`if-shell -F -t <target> <the target is the one read> '<next>' <stale>`,
 * then `if-shell -F 1 '<command> ; list-commands -F ..._true display-message' ''`), each layer quoted
 * inside the one before. Peeling the layers leaves the commands themselves, still followed by
 * the `list-commands` markers that `fence` drops.
 */
function peel(words) {
  const rest = words.slice(1)
  const positional = []
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '-t') index++
    else if (!rest[index].startsWith('-') || positional.length > 0) positional.push(rest[index])
  }
  const inner = splitCommandLine(positional[1] ?? '')
  const commands = inner.reduce((all, word) => { if (word === ';') all.push([]); else all.at(-1).push(word); return all }, [[]]).filter((command) => command.length > 0)
  return commands.flatMap((command, index) => [...(index > 0 ? [';'] : []), ...(command[0] === 'if-shell' ? peel(command) : command)])
}

/**
 * libtmux-swift's own tmux preamble. The guard is described at `peel`; the `list-commands -F __libtmux_request_*` commands
 * around a command carry the guard's answer (`_true`, `_stale`, `_restarted`, `_fence`) and are the fence. The program names
 * its socket `libtmux-home-<UUID>`, which differs on every run.
 */
const PREAMBLE = {
  redact: (text) => text.replace(SOCKET, FIXED_SOCKET),
  socket: { pattern: SOCKET.source, fixed: FIXED_SOCKET },
  /** The guard's answers are lines of their own after what the command printed. */
  reply: (stdout) => stdout.replace(/^__libtmux_request_[0-9a-f]+_\w+\n/gm, ''),
  unwrap: (command) => (command[0] === 'if-shell' ? peel(command) : undefined),
  fence: (command) => command[0] === 'list-commands' && command.some((word) => word.startsWith('__libtmux_request_')),
  probe: ({ flags, commands }) => commands.length === 0 && flags.includes('-V'),
  /** A wait polls the pane's position with a `display-message` and reads it with a `capture-pane`. */
  polls: ['display-message', 'capture-pane'],
}

/** A mark goes after the statement its anchor starts. */
const instrumentSwift = (source, steps) => instrumentLines(source, steps, (step) => `docsMark(${JSON.stringify(step.id)}, ${step.value}) // docs:mark`)

const swiftVersion = () => /Swift version (\S+)/.exec(execFileSync('swift', ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown'

/** What every Swift recipe shares: the toolchain and the build against the checkout. */
const SWIFT = {
  root: join(import.meta.dirname, '../../..'),
  stepMap: 'hand-written',
  /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh, and the program names its shell. */
  paneCommands: ['sh'],
  ...PREAMBLE,
  checkout: (port, env, expand) => checkoutOf(port, env, expand),
  instrument: instrumentSwift,
  command: (dir) => [join(dir, 'program')],
  toolchain: () => ({ swift: swiftVersion() }),
  /**
   * Write the displayed and the marked copy as packages whose `libtmux-source` is the checkout
   * (the displayed `Package.swift` names that path, so it is shown untouched), and build both offline:
   * the checkout's `Package.resolved` pins the dependencies, and SwiftPM's cache holds them.
   */
  build({ sandbox, checkout, code, marked }) {
    const manifest = JSON.parse(readFileSync(join(this.root, 'site/src/data/home-examples.json'), 'utf8')).swift.files.find((entry) => entry.name === 'Package.swift').code
    for (const [dir, source] of [['exact', code], ['marked', marked]]) {
      const root = join(BUILD, dir)
      rmSync(join(root, 'Sources'), { recursive: true, force: true })
      rmSync(join(root, 'libtmux-source'), { recursive: true, force: true })
      mkdirSync(join(root, 'Sources'), { recursive: true })
      symlinkSync(checkout, join(root, 'libtmux-source'))
      copyFileSync(join(checkout, 'Package.resolved'), join(root, 'Package.resolved'))
      writeFileSync(join(root, 'Package.swift'), manifest)
      writeFileSync(join(root, this.file), source)
      if (dir === 'marked') writeFileSync(join(root, 'Sources/DocsMark.swift'), HELPER)
      execFileSync('swift', ['build', '--jobs', '2', '--product', 'ApiExample', '--disable-automatic-resolution', '--only-use-versions-from-resolved-file'], { cwd: root, stdio: 'inherit', env: { ...process.env, LD_LIBRARY_PATH: LIBS } })
      mkdirSync(join(sandbox, dir), { recursive: true })
      copyFileSync(join(root, '.build/debug/ApiExample'), join(sandbox, dir, 'program'))
    }
  },
}

const SERVER = 'docsEndpoint(server.endpoint)'
const SESSION = `docsObject([("id", ${ID('session')}), ("name", docsString(session.name))])`
const WINDOW = `docsObject([("id", ${ID('logs')}), ("name", docsString(logs.name))])`
const PANE = `docsObject([("id", ${ID('pane')})])`
const WAIT = 'docsObject([("outcome", docsString(result.outcome.rawValue)), ("matched", docsString(result.matched ?? "")), ("tail", docsArray(result.tail.map(docsString)))])'

/** One recipe per program of the landing page that Swift plays. */
export const RECIPES = {
  'typed-graph': {
    ...SWIFT,
    capability: 'typed-graph',
    file: 'Sources/Main.swift',
    source: (root) => quickstartSource(root, 'swift', 'Sources/Main.swift'),
    steps: [
      { id: 'server', label: 'Server.init', anchor: 'let server = try Server(', type: 'Server', value: SERVER },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Session', value: SESSION },
      { id: 'new-window', label: 'Server.newWindow', anchor: 'server.newWindow(', type: 'WindowAppearance', value: WINDOW },
      { id: 'split', label: 'Server.splitWindow', anchor: 'server.splitWindow(', type: 'Pane', value: PANE },
      { id: 'run', label: 'Server.run', anchor: 'server.run(', type: 'Void', value: '"null"' },
      { id: 'regex', label: 'RegexPattern.init', anchor: 'RegexPattern(', type: 'RegexPattern', value: 'docsObject([("source", docsString(ready.source))])' },
      { id: 'wait', label: 'Server.waitForOutput', anchor: 'server.waitForOutput(', type: 'OutputWait', value: WAIT },
      { id: 'kill', label: 'Server.killServer', anchor: 'try await server.killServer()', occurrence: 2, type: 'Void', value: '"null"' },
    ],
  },
}
