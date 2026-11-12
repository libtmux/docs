import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { syntaxOf } from '../../../site/src/lib/core-statement.ts'
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

module DocsMark (mark, unit, text, count, counts, session, window, pane) where

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

session :: Tmux.Session -> String
session value = object
  [ ("id", text (Text.unpack (Tmux.renderSessionId (Tmux.sessionId value.ref))))
  , ("name", text (Text.unpack value.name))
  ]

window :: Tmux.Window -> String
window value = object
  [ ("id", text (Text.unpack (Tmux.renderWindowId (Tmux.windowId value.ref))))
  , ("name", text (label value.name))
  ]

pane :: Tmux.Pane -> String
pane value = object
  [ ("id", text (Text.unpack (Tmux.renderPaneId (Tmux.paneId value.ref))))
  , ("title", text (Text.unpack value.title))
  ]
`

/** The line the marked copy adds to the imports. */
const IMPORT = 'import DocsMark qualified as Mark -- docs:mark'

/**
 * In the order the calls run. The reads of a snapshot and the lookups in it send tmux nothing. A step whose anchor is
 * on the later line of a statement gives that statement's `indent`, so that its mark is not read as part of it.
 */
const STEPS = [
  { id: 'capture-before', label: 'capture', anchor: 'before <- Tmux.capture server', type: 'Snapshot', value: 'Mark.counts before' },
  { id: 'session', label: 'exactlyOne', anchor: 'Q.exactlyOne (Tmux.sessions before)', indent: 6, type: 'Session', value: 'Mark.session session' },
  { id: 'matches', label: 'runQuery', anchor: 'Q.runQuery before selected', type: '[Pane]', value: 'Mark.count (length matches)' },
  { id: 'pane', label: 'exactlyOne', anchor: 'Q.exactlyOne matches', type: 'Pane', value: 'Mark.pane pane' },
  { id: 'window', label: 'lookupWindow', anchor: 'Tmux.lookupWindow before pane.window', type: 'Window', value: 'Mark.window window' },
  { id: 'rename-session', label: 'renameSession', anchor: 'Tmux.renameSession server session.ref "workspace"', type: '()', value: 'Mark.unit' },
  { id: 'rename-window', label: 'renameWindow', anchor: 'Tmux.renameWindow server window.ref "api #{pid};"', type: '()', value: 'Mark.unit' },
  { id: 'set-pane-title', label: 'setPaneTitle', anchor: 'Tmux.setPaneTitle server pane.ref "editor-ready"', type: '()', value: 'Mark.unit' },
  { id: 'capture-after', label: 'capture', anchor: 'after <- Tmux.capture server', type: 'Snapshot', value: 'Mark.counts after' },
  { id: 'changed-session', label: 'lookupSession', anchor: 'Tmux.lookupSession after session.ref', indent: 8, type: 'Session', value: 'Mark.session changedSession' },
  { id: 'changed-window', label: 'lookupWindow', anchor: 'Tmux.lookupWindow after window.ref', indent: 8, type: 'Window', value: 'Mark.window changedWindow' },
  { id: 'changed-pane', label: 'lookupPane', anchor: 'Tmux.lookupPane after pane.ref', type: 'Pane', value: 'Mark.pane changedPane' },
  { id: 'old-window', label: 'lookupWindow', anchor: 'Tmux.lookupWindow before window.ref', type: 'Window', value: 'Mark.window oldWindow' },
  { id: 'old-name', label: 'labelText', anchor: 'Tmux.labelText oldWindow.name', type: 'Text', value: 'Mark.text (Text.unpack oldName)' },
  { id: 'new-name', label: 'labelText', anchor: 'Tmux.labelText changedWindow.name', indent: 8, type: 'Text', value: 'Mark.text (Text.unpack newName)' },
]

/** Add a mark after each step's statement, and the import of the helper after the program's last import. */
export function instrumentHaskell(source, steps) {
  const marked = instrumentLines(source, steps, (step) => `Mark.mark ${JSON.stringify(step.id)} (${step.value}) -- docs:mark`, syntaxOf('haskell'))
  const lines = marked.split('\n')
  const at = lines.indexOf('import System.OsPath.Posix qualified as Path')
  if (at < 0) throw new Error('the program has no `import System.OsPath.Posix qualified as Path` line to put the helper import after')
  lines.splice(at + 1, 0, IMPORT)
  return lines.join('\n')
}

/** A capture is one `display-message` whose format frames each line with a random token (`g` and 64 hex digits), and which reports the daemon's pid and start time. */
const scrub = (text) => text.replace(/\bg[0-9a-f]{64}\b/g, 'g0000').replace(/(server\.pid:)\d+/g, (_, name) => `${name}12345`).replace(/(server\.startedAt:)\d+/g, (_, name) => `${name}1700000000`)

/** Where cabal keeps its packages and store: the environment's own, as a reader's cabal finds it. The sandbox's home is not the reader's, so the launcher names it. */
const cabalDir = () => process.env.CABAL_DIR ?? join(process.env.HOME ?? '', '.cabal')

/** The other files the page shows beside the program. */
let files

/** The socket the page's setup commands start a server on, in a directory under the sandbox's `tmp`, where the recorder reads tmux. */
const socketOf = (dir) => join(dir, '..', 'tmp', 'libtmux-haskell-demo.AbC123', 's')

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
    /** The pane of the page's setup command runs `cat`. */
    paneCommands: ['cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [{ file: 'DocsMark.hs', source: HASKELL_HELPER }],
    steps: STEPS,
    fence: () => false,
    probe: ({ flags, commands }) => commands.length === 0 && flags.includes('-V'),
    /** What differs on every run in what a capture sends and reads back: the token that frames its reply, and the daemon's process id and start time. */
    redact: scrub,
    reply: scrub,
    instrument: instrumentHaskell,
    /** The page's own setup commands: a server with the `demo` session, started before the program runs. */
    setup({ dir, env }) {
      const socket = socketOf(dir)
      rmSync(dirname(dirname(socket)), { recursive: true, force: true })
      mkdirSync(dirname(socket), { recursive: true })
      const tmux = (...args) => execFileSync(env.LIBTMUX_DOCS_REAL_TMUX, ['-S', socket, ...args], { cwd: dir, env: { ...env, TMUX: '', TMUX_PANE: '' }, stdio: 'ignore' })
      tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'demo', '-n', 'editor', '-x', '120', '-y', '40', '/bin/cat', '-')
      tmux('-N', 'link-window', '-s', 'demo:0', '-t', 'demo:4')
    },
    command: (dir) => ['/bin/sh', join(dir, 'program')],
    toolchain: () => ({ ghc: execFileSync('ghc', ['--numeric-version'], { encoding: 'utf8' }).trim(), cabal: execFileSync('cabal', ['--numeric-version'], { encoding: 'utf8' }).trim() }),
    /**
     * Write the displayed project and the marked one, which also holds the helper (listed in its package and given
     * the `process` package it runs the mark with), and build each. The page's `cabal.project` names the library
     * by its repository and revision; the build names the checkout instead, at the same revision.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      fastShim(sandbox)
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
        // The library starts tmux with `LANG` alone in its environment, so the shim cannot read where to log from it:
        // a `tmux` in the project carries that environment and is what the program is given, where the page gives it `command -v tmux`.
        writeFileSync(join(project, 'tmux'), `#!/bin/sh\nexport LIBTMUX_DOCS_TRACE=${JSON.stringify(join(sandbox, `${dir}.trace`))} LIBTMUX_DOCS_REAL_TMUX=${JSON.stringify(realTmux)} LIBTMUX_DOCS_SANDBOX=${JSON.stringify(realpathSync(sandbox))} LIBTMUX_DOCS_PANE_COMMANDS=${JSON.stringify(this.paneCommands.join(','))} LIBTMUX_DOCS_PORT=haskell\nexec /bin/sh ${JSON.stringify(shim)} "$@"\n`)
        chmodSync(join(project, 'tmux'), 0o755)
        writeFileSync(join(project, 'program'), `#!/bin/sh\nCABAL_DIR=${JSON.stringify(cabalDir())}\nexport CABAL_DIR\nunset TMUX TMUX_PANE\nexec cabal run --offline --verbose=0 mutate-graph -- ${JSON.stringify(socketOf(project))} ${JSON.stringify(join(project, 'tmux'))}\n`)
        chmodSync(join(project, 'program'), 0o755)
      }
    },
  },
}
