import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { statementLines, syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, fastShim, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Haskell's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-haskell's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Haskell expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's typed syntax tree (the GHC API: every application
 * of a `LibTmux` function) and take the value from the variable the bind names;
 * the recorder would not change.
 */

/**
 * The module the marked copy compiles beside the program. `mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails; the other functions write the value of a step as JSON
 * text, from the values the program holds.
 */
const HASKELL_HELPER = `{-# LANGUAGE OverloadedRecordDot #-}

module DocsMark (mark, unit, text, counts, created, scope, session, window, pane) where

import Data.Char (ord)
import Data.List (intercalate)
import Data.Text qualified as Text
import LibTmux qualified as Tmux
import Numeric (showHex)
import System.Environment (getEnv)
import System.Exit (ExitCode (..), exitWith)
import System.IO (hPutStrLn, stderr)
import System.Process (rawSystem)

-- | Tell the recorder that an API call has returned, and what it returned.
mark :: String -> String -> IO ()
mark step value = do
  program <- getEnv "LIBTMUX_DOCS_MARK"
  status <- rawSystem program [step, value]
  case status of
    ExitSuccess -> pure ()
    ExitFailure code -> do
      hPutStrLn stderr ("docs mark: " <> step <> " failed")
      exitWith (ExitFailure code)

unit :: String
unit = "null"

count :: Int -> String
count = show

text :: String -> String
text value = "\\"" <> concatMap escape value <> "\\""
  where
    escape '"' = "\\\\\\""
    escape '\\\\' = "\\\\\\\\"
    escape '\\n' = "\\\\n"
    escape '\\r' = "\\\\r"
    escape '\\t' = "\\\\t"
    escape c
      | ord c < 32 = "\\\\u" <> replicate (4 - length hex) '0' <> hex
      | otherwise = [c]
      where
        hex = showHex (ord c) ""

object :: [(String, String)] -> String
object fields = "{" <> intercalate "," [text key <> ":" <> value | (key, value) <- fields] <> "}"

label :: Tmux.TmuxText -> String
label = either (const "?") Text.unpack . Tmux.labelText

-- | How many sessions, windows and panes a snapshot holds.
counts :: Tmux.Snapshot -> String
counts snapshot = object
  [ ("sessions", count (length (Tmux.sessions snapshot)))
  , ("windows", count (length (Tmux.windows snapshot)))
  , ("panes", count (length (Tmux.panes snapshot)))
  ]

created :: Tmux.CreatedSession -> String
created value = object
  [ ("session", text (Text.unpack (Tmux.renderSessionId (Tmux.sessionId value.session))))
  , ("window", text (Text.unpack (Tmux.renderWindowId (Tmux.windowId value.window))))
  , ("pane", text (Text.unpack (Tmux.renderPaneId (Tmux.paneId value.pane))))
  ]

scope :: Tmux.Snapshot -> Tmux.Snapshot -> String
scope before after = object [("before", counts before), ("after", counts after)]

session :: Tmux.Session -> String
session value = object [("name", text (Text.unpack value.name))]

window :: Tmux.Window -> String
window value = object [("name", text (label value.name))]

pane :: Tmux.Pane -> String
pane value = object [("title", text (Text.unpack value.title))]
`

/** The line the marked copy adds to the imports. */
const IMPORT = 'import DocsMark qualified as Mark -- docs:mark'

/**
 * In the order the calls run. The reads of a snapshot and the lookups in it send tmux nothing. A step whose anchor is
 * on the later line of a statement gives that statement's `indent`, so that its mark is not read as part of it.
 * `withOwnedServer` stops the server when its body ends, so the page marks it on the body's last statement.
 */
const STEPS = [
  { id: 'create-session', label: 'createSession', anchor: 'created <- Tmux.createSession server Creation.defaultSessionOptions', completes: 'Creation.process = Creation.ShellCommand', offset: 1, indent: 6, type: 'CreatedSession', value: 'Mark.created created' },
  { id: 'capture-before', label: 'capture', anchor: 'before <- Tmux.capture server', type: 'Snapshot', value: 'Mark.counts before' },
  { id: 'rename-session', label: 'renameSession', anchor: 'Tmux.renameSession server created.session "workspace"', type: '()', value: 'Mark.unit' },
  { id: 'rename-window', label: 'renameWindow', anchor: 'Tmux.renameWindow server created.window "api #{pid};"', type: '()', value: 'Mark.unit' },
  { id: 'set-pane-title', label: 'setPaneTitle', anchor: 'Tmux.setPaneTitle server created.pane "editor-ready"', type: '()', value: 'Mark.unit' },
  { id: 'capture-after', label: 'capture', anchor: 'after <- Tmux.capture server', type: 'Snapshot', value: 'Mark.counts after' },
  { id: 'retire-server', label: 'withOwnedServer', anchor: 'Tmux.withOwnedServer Tmux.defaultOwnedServerConfig', completes: 'pure (created, before, after)', indent: 2, stopsServer: true, scopeExit: true, marker: 'pure (created, before, after)', type: '(CreatedSession, Snapshot, Snapshot)', value: 'Mark.scope before after' },
  { id: 'previous-session', label: 'lookupSession', anchor: 'Tmux.lookupSession before created.session', indent: 2, type: 'Session', value: 'Mark.session previous' },
  { id: 'current-session', label: 'lookupSession', anchor: 'Tmux.lookupSession after created.session', indent: 2, type: 'Session', value: 'Mark.session current' },
  { id: 'window', label: 'lookupWindow', anchor: 'Tmux.lookupWindow after created.window', type: 'Window', value: 'Mark.window window' },
  { id: 'pane', label: 'lookupPane', anchor: 'Tmux.lookupPane after created.pane', type: 'Pane', value: 'Mark.pane pane' },
  { id: 'window-label', label: 'labelText', anchor: 'Tmux.labelText window.name', type: 'Text', value: 'Mark.text (Text.unpack label)' },
]

/** Add a mark after each step's statement, and the import of the helper after the program's last import. */
export function instrumentHaskell(source, steps) {
  const syntax = syntaxOf('haskell')
  const positioned = steps.map((step) => {
    if (!step.completes) return step
    const end = statementLines(source, step.completes, syntax)?.[1]
    if (!end) throw new Error(`${step.id}: no unique end of statement`)
    return { ...step, after: end + (step.offset ?? 0) }
  })
  const marked = instrumentLines(source, positioned, (step) => `Mark.mark ${JSON.stringify(step.id)} (${step.value}) -- docs:mark`, syntax)
  const lines = marked.split('\n')
  const at = lines.findLastIndex((line) => line.startsWith('import '))
  if (at < 0) throw new Error('the program has no imports to place the marker helper after')
  lines.splice(at + 1, 0, IMPORT)
  return lines.join('\n')
}

const probeFormat = /^([0-9a-f]{64}):#\{(?:version|pid)\}:\1$/

/** Fix the wire tokens and process fields that change on each recording. */
const scrub = (text) => text
  .replace(/\bg[0-9a-f]{64}\b/g, 'g0000')
  .replace(/\b([0-9a-f]{64}):(#\{(?:version|pid)\}):\1\b/g, '0000:$2:0000')
  .replace(/\b([0-9a-f]{64}):(#\{pid\} #\{session_id\} #\{window_id\} #\{pane_id\} #\{window_index\}):\1\b/g, '0000:$2:0000')
  .replace(/\b([0-9a-f]{64}):\d+ (\$\d+ @\d+ %\d+ \d+):\1\b/g, '0000:12345 $2:0000')
  .replace(/(server\.pid:)\d+/g, (_, name) => `${name}12345`)
  .replace(/(server\.startedAt:)\d+/g, (_, name) => `${name}1700000000`)
  .replace(/libtmux-haskell-(?:[a-zA-Z0-9]|\\147){6}(?=\/s\b)/g, 'libtmux-haskell-demo')

/** Where cabal keeps its packages and store: the environment's own, as a reader's cabal finds it. The sandbox's home is not the reader's, so the launcher names it. */
const cabalDir = () => process.env.CABAL_DIR ?? join(process.env.HOME ?? '', '.cabal')

/** The other files the page shows beside the program. */
let files

const launches = new Map()
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`

/** Bubblewrap gives the library's private /tmp a socket directory the recorder can see. */
function sandboxCommand({ sandbox, project, executable, runtime, realTmux }) {
  const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)))
  const sources = ['/usr', '/etc', '/run', '/bin', '/lib', '/lib64', root, process.execPath, runtime, realTmux]
  const mounts = [...new Set(sources)].filter(existsSync).flatMap((path) => ['--ro-bind', path, path])
  return [
    'bwrap', '--unshare-user', '--die-with-parent', '--proc', '/proc', '--dev', '/dev',
    ...mounts, '--bind', join(sandbox, 'tmp'), '/tmp', '--bind', sandbox, sandbox,
    '--chdir', project, '--setenv', 'PATH', [project, join(sandbox, 'bin'), process.env.PATH].join(delimiter),
    executable,
  ]
}

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'Main.hs',
    stepMap: 'hand-written',
    source: (root) => {
      const home = quickstartSource(root, 'haskell', 'Main.hs')
      files = { 'libtmux-mutate-graph.cabal': quickstartSource(root, 'haskell', 'libtmux-mutate-graph.cabal').code, 'cabal.project': quickstartSource(root, 'haskell', 'cabal.project').code }
      return home
    },
    paneCommands: ['cat'],
    socket: { pattern: 'libtmux-haskell-demo', fixed: 'libtmux-haskell-demo' },
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [{ file: 'DocsMark.hs', source: HASKELL_HELPER }],
    steps: STEPS,
    fence: () => false,
    probe: ({ flags, commands }) => {
      if (commands.length === 0) return flags.includes('-V')
      const [command] = commands
      if (commands.length !== 1 || !probeFormat.test(command.at(-1))) return false
      return (command.length === 3 && command[0] === 'run-shell' && command[1] === '-C')
        || (command.length === 4 && command[0] === 'display-message' && command[1] === '-p' && command[2] === '-F')
    },
    /** What differs on every run in what a capture sends and reads back: the token that frames its reply, and the daemon's process id and start time. */
    redact: scrub,
    reply: scrub,
    /**
     * Native record fields encode g as an octal escape. Rewrite only the known sandbox prefix.
     * @param {string} sandbox
     * @returns {[string, string][]}
     */
    sanitizePaths: (sandbox) => [[sandbox.replaceAll('g', '\\147'), '/tmp']],
    instrument: instrumentHaskell,
    command: (dir) => launches.get(dir),
    toolchain: () => ({ ghc: execFileSync('ghc', ['--numeric-version'], { encoding: 'utf8' }).trim(), cabal: execFileSync('cabal', ['--numeric-version'], { encoding: 'utf8' }).trim() }),
    /**
     * Write the displayed project and the marked one, which also holds the helper (listed in its package and given
     * the `process` package it runs the mark with), and build each. The page's `cabal.project` names the library
     * by its repository and revision; the build names the checkout instead, at the same revision.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      execFileSync('bwrap', ['--version'], { stdio: 'ignore' })
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      const runtime = fastShim(sandbox)
      const shim = join(sandbox, 'bin/tmux')
      const realTmux = execFileSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).trim()
      const env = { ...process.env, CABAL_DIR: cabalDir() }
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        const project = join(sandbox, dir)
        mkdirSync(project, { recursive: true })
        writeFileSync(join(project, this.file), source)
        let cabal = files['libtmux-mutate-graph.cabal']
        if (dir === 'marked') {
          cabal = cabal.replace('  main-is: Main.hs\n', '  main-is: Main.hs\n  other-modules: DocsMark\n').replace('    base >=4.22 && <4.23,\n', '    base >=4.22 && <4.23,\n    process >=1.6 && <1.7,\n')
          if (!cabal.includes('other-modules: DocsMark') || !cabal.includes('process >=1.6')) throw new Error('the displayed cabal file has no `main-is: Main.hs` or no `base` bound to add the helper to')
          for (const helper of helpers) writeFileSync(join(project, helper.file), helper.source)
        }
        writeFileSync(join(project, 'libtmux-mutate-graph.cabal'), cabal)
        const project_ = files['cabal.project'].replace('https://github.com/libtmux/libtmux-haskell', checkout)
        if (project_ === files['cabal.project']) throw new Error('the displayed cabal.project does not name the library repository')
        writeFileSync(join(project, 'cabal.project'), project_)
        execFileSync('cabal', ['build', '--verbose=0', 'mutate-graph'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'], env })
        const executable = execFileSync('cabal', ['list-bin', '--offline', 'mutate-graph'], { cwd: project, encoding: 'utf8', env }).trim()
        // Keep the foreground launch on its original PID. The other commands
        // enter the trace shim with the recorder environment restored.
        writeFileSync(join(project, 'tmux'), `#!/bin/sh\nif [ "$1" = -D ]; then exec ${quote(realTmux)} "$@"; fi\nexport LIBTMUX_DOCS_TRACE=${quote(join(sandbox, `${dir}.trace`))} LIBTMUX_DOCS_REAL_TMUX=${quote(realTmux)} LIBTMUX_DOCS_SANDBOX=${quote(realpathSync(sandbox))} LIBTMUX_DOCS_PANE_COMMANDS=${quote(this.paneCommands.join(','))} LIBTMUX_DOCS_PORT=haskell\nexec /bin/sh ${quote(shim)} "$@"\n`)
        chmodSync(join(project, 'tmux'), 0o755)
        launches.set(project, sandboxCommand({ sandbox, project, executable, runtime, realTmux }))
      }
    },
  },
}
