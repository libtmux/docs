import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { statementLines, syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { splitCommandLine } from '../core-trace.mjs'
import { checkoutOf, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Common Lisp's quickstart is recorded: the calls to mark, what to run, and
 * what the library needs of the `tmux` it is given.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Lisp expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's forms (`read`: every call of a `libtmux:` function)
 * and take the value from the variable the binding names; the recorder would
 * not change.
 *
 * Marks are not lines between the program's forms: most calls sit in a `let*`
 * binding list, where a line of its own is not a binding. The marked copy
 * adds one line after `asdf:load-system`, which loads the helper below, and the
 * helper wraps the library functions the program calls (`sb-int:encapsulate`).
 * A wrapped function marks when a call the program makes returns; a call the
 * library makes inside another does not.
 */

/**
 * The helper the marked copy loads once the library is. `docs-mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. `wrap` marks the calls a function receives from the
 * program, in order: a function whose plan is used up is an error unless it
 * only reads a captured graph (`strict` is false), because a call that sends
 * tmux a command and is not marked would give its commands to the next step.
 */
const HELPER = String.raw`(defpackage #:libtmux-docs (:use #:cl))
(in-package #:libtmux-docs)

(sb-ext:defglobal **depth** 0)

(defun json-string (text stream)
  (write-char #\" stream)
  (loop for char across text
        do (case char
             (#\" (write-string "\\\"" stream))
             (#\\ (write-string "\\\\" stream))
             (#\Newline (write-string "\\n" stream))
             (#\Return (write-string "\\r" stream))
             (#\Tab (write-string "\\t" stream))
             (t (if (< (char-code char) 32)
                    (format stream "\\u~4,'0x" (char-code char))
                    (write-char char stream)))))
  (write-char #\" stream))

(defun encode (value stream)
  (cond ((stringp value) (json-string value stream))
        ((integerp value) (format stream "~D" value))
        ((eq value :true) (write-string "true" stream))
        ((eq value :null) (write-string "null" stream))
        ((and (consp value) (eq (car value) :object))
         (write-char #\{ stream)
         (loop for (key item) on (cdr value) by #'cddr
               for first = t then nil
               do (unless first (write-char #\, stream))
                  (json-string key stream)
                  (write-char #\: stream)
                  (encode item stream))
         (write-char #\} stream))
        ((and (vectorp value) (not (stringp value))) (encode (coerce value 'list) stream))
        ((listp value)
         (write-char #\[ stream)
         (loop for item in value
               for first = t then nil
               do (unless first (write-char #\, stream))
                  (encode item stream))
         (write-char #\] stream))
        (t (error "docs mark: cannot encode ~S" value))))

(defun docs-mark (step value)
  (let ((code (nth-value 2 (uiop:run-program
                            (list (uiop:getenv "LIBTMUX_DOCS_MARK") step
                                  (with-output-to-string (stream) (encode value stream)))
                            :output nil :ignore-error-status t))))
    (unless (eql code 0)
      (format *error-output* "docs mark: ~A failed~%" step)
      (sb-ext:exit :code code :abort t))))

(defun obj (&rest plist) (cons :object plist))
(defun status (outcome) (string-downcase (symbol-name (libtmux:outcome-status outcome))))
(defun ids (entities) (map 'list #'libtmux:id entities))
(defun entity (value) (obj "id" (libtmux:id value) "name" (libtmux:name value)))

(defun wrap (name strict plan)
  (let ((plan (copy-list plan)))
    (sb-int:encapsulate
     name 'docs-mark
     (lambda (function &rest args)
       (if (plusp **depth**)
           (apply function args)
           (let ((results (progn (incf **depth**)
                                 (unwind-protect (multiple-value-list (apply function args))
                                   (decf **depth**)))))
             (cond (plan
                    (destructuring-bind (step compute repeat) (first plan)
                      (unless (and repeat (null (rest plan))) (pop plan))
                      (incf **depth**)
                      (unwind-protect (docs-mark step (funcall compute (first results) results))
                        (decf **depth**))))
                   (strict (error "docs mark: an unplanned call of ~S" name)))
             (values-list results)))))))
`

/** A snapshot as a recording stores it: how many of each it holds. */
const COUNTS = '(obj "sessions" (length (libtmux:sessions result)) "windows" (length (libtmux:windows result)) "panes" (length (libtmux:panes result)))'
const OUTCOME = (field) => `(obj "status" (status result) ${field})`

/** What the library needs of the tmux it runs: a native executable, not a script. */
const WRAPPER = String.raw`#include <unistd.h>
int main(int argc, char **argv) {
    char *args[argc + 2];
    args[0] = "sh";
    args[1] = SHIM;
    for (int i = 1; i <= argc; i++) args[i + 1] = argv[i];
    execv("/bin/sh", args);
    return 127;
}
`

/** The tool versions the checkout pins; the program is run the way the page's commands run it, on those. */
const pinned = (checkout, tool) => new RegExp(`^http:${tool} (\\S+)$`, 'm').exec(readFileSync(join(checkout, '.tool-versions'), 'utf8'))?.[1]
const toolDir = (checkout, tool) => execFileSync('mise', ['where', `http:${tool}@${pinned(checkout, tool)}`], { encoding: 'utf8' }).trim()
const sbcl = (checkout) => join(toolDir(checkout, 'sbcl'), 'sbcl')
const asdf = (checkout) => join(toolDir(checkout, 'asdf-lisp'), 'asdf.lisp')

/** Where the library's compiled files go: beside the checkout, on disk, so the second run does not compile again. */
const cacheOf = (checkout) => join(dirname(checkout), 'lisp-core-player-cache')

/** The step map, in the order the calls run. `call` is the function the marked copy wraps to mark it. */
const STEPS = [
  { id: 'snapshot-before', label: 'libtmux:fetch-snapshot', anchor: '(before (libtmux:fetch-snapshot client))', type: 'snapshot', call: 'libtmux:fetch-snapshot', value: COUNTS },
  { id: 'sessions', label: 'libtmux:sessions', anchor: '(libtmux:sessions before)', type: '(vector session)', call: 'libtmux:sessions', pure: true, value: "(map 'list #'libtmux:name result)" },
  { id: 'window-links', label: 'libtmux:window-links', anchor: '(libtmux:window-links demo)', type: '(vector window-link)', call: 'libtmux:window-links', pure: true, value: "(map 'list #'libtmux:index result)" },
  { id: 'editor', label: 'libtmux:window', anchor: '(libtmux:window editor-link)', type: 'window', call: 'libtmux:window', pure: true, value: '(entity result)' },
  { id: 'editor-panes', label: 'libtmux:panes', anchor: '(libtmux:panes editor)', type: '(vector pane)', call: 'libtmux:panes', pure: true, value: '(ids result)' },
  { id: 'split', label: 'libtmux:split-pane', anchor: '(libtmux:split-pane', type: 'command-outcome', call: 'libtmux:split-pane', value: OUTCOME('"pane" (libtmux:id (libtmux:outcome-value result))') },
  { id: 'new-window', label: 'libtmux:new-window', anchor: '(libtmux:new-window', type: 'command-outcome', call: 'libtmux:new-window', value: OUTCOME('"window" (libtmux:id (libtmux:outcome-value result))') },
  { id: 'send-text', label: 'libtmux:send-text', anchor: '(libtmux:send-text', type: 'command-outcome', call: 'libtmux:send-text', value: OUTCOME('') },
  { id: 'capture', label: 'libtmux:capture-pane', anchor: '(libtmux:capture-pane', type: 'string', call: 'libtmux:capture-pane', value: '(obj "status" (status (second results)) "text" (string-right-trim \'(#\\Newline #\\Space) result))' },
  { id: 'snapshot', label: 'libtmux:fetch-snapshot', anchor: '(snapshot (libtmux:fetch-snapshot client))', type: 'snapshot', call: 'libtmux:fetch-snapshot', value: COUNTS },
  { id: 'panes', label: 'libtmux:panes', anchor: '(libtmux:panes snapshot)', type: '(vector pane)', call: 'libtmux:panes', pure: true, value: '(ids result)' },
  { id: 'pane-window', label: 'libtmux:window', anchor: '(libtmux:window pane)', type: 'window', call: 'libtmux:window', pure: true, value: '(entity result)' },
  { id: 'owner-links', label: 'libtmux:window-links', anchor: '(libtmux:window-links window)', type: '(vector window-link)', call: 'libtmux:window-links', pure: true, value: "(map 'list #'libtmux:index result)" },
  { id: 'owner', label: 'libtmux:session', anchor: '(libtmux:session owner-link)', type: 'session', call: 'libtmux:session', pure: true, value: '(entity result)' },
  { id: 'kill-server', label: 'libtmux:kill-server', anchor: '(libtmux:kill-server client)', type: 'command-outcome', call: 'libtmux:kill-server', value: OUTCOME('') },
]

/** The helper with its plan: for each function a step marks, the steps its calls make, in order. */
export function lispHelper(steps) {
  const calls = [...new Set(steps.map((step) => step.call))]
  const plans = calls.map((call) => {
    const own = steps.filter((step) => step.call === call)
    const entries = own.map((step) => `(list ${JSON.stringify(step.id)} (lambda (result results) (declare (ignorable result results)) ${step.value}) ${step.repeat ? 't' : 'nil'})`)
    return `(wrap '${call} ${own.every((step) => step.pure) ? 'nil' : 't'} (list ${entries.join(' ')}))`
  })
  return `${HELPER}\n${plans.join('\n')}\n`
}

/** Add the one line that loads the helper, after the program has loaded the library. */
export function instrumentLisp(source, steps) {
  for (const step of steps) {
    if (!statementLines(source, step.anchor, syntaxOf('lisp'), step.occurrence)) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
  }
  const lines = source.split('\n')
  const at = lines.indexOf('(asdf:load-system "libtmux")')
  if (at < 0) throw new Error('the program has no `(asdf:load-system "libtmux")` line to load the helper after')
  lines.splice(at + 1, 0, '(load (uiop:getenv "LIBTMUX_DOCS_HELPER")) ; docs:mark')
  return lines.join('\n')
}

/**
 * tmux's escapes for a quote, a dollar sign and a backslash (`\042`, `\044`, `\134`), which a guard's text uses for the
 * quotes of the command it holds. Escapes for control characters stay as written, as `splitCommandLine` leaves them.
 */
const printable = (text) => text.replace(/\\(042|044|134)/g, (_, digits) => String.fromCharCode(Number.parseInt(digits, 8)))

/**
 * The library sends each command inside a guard that fails if the daemon is not the one it checked: `if-shell -F <check>
 * '<then>' '<else>'`, where `then` holds the command, itself behind a guard for its target (`if-shell -F -t <target>
 * <check> '<command>' '<else>'`) when it names one, and each guard reports where it got to with a `list-commands` marker.
 * The words of the command inside, with its own markers, as one list of commands separated by `;`. The command's text is
 * escaped once for the guard around it and once for the guard around that, so it is read back once for each.
 */
const unwrap = (command) => {
  if (command[0] !== 'if-shell' || command[1] !== '-F') return undefined
  const targeted = command[2] === '-t'
  const words = splitCommandLine(targeted ? printable(command[5]) : command[3]).map((word) => (targeted ? printable(word) : word))
  const inside = words.reduce((commands, word) => { if (word === ';') commands.push([]); else commands.at(-1).push(word); return commands }, [[]]).filter((each) => each.length > 0)
  return inside.flatMap((each, index) => [...(index > 0 ? [';'] : []), ...(unwrap(each) ?? each)])
}

/** A command that only reports a marker, or the daemon's identity (`witness/1`): the library's own check, not its work. */
const fence = (command) => command[0] === 'list-commands' && command[1] === '-F' && (command[2].startsWith('witness/') || /^libtmux-[0-9A-F]{32}:/.test(command[2]))

/** The server's socket, in a directory under the sandbox's `tmp`, where the recorder reads tmux. */
const socketOf = (dir) => join(dir, '..', 'tmp', 'demo', 'tmux.sock')

/** The checkout the program was built against, which pins the tools it runs on. */
let built

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.lisp',
    stepMap: 'hand-written',
    source: (root) => quickstartSource(root, 'lisp', 'quickstart.lisp'),
    /**
     * What a pane runs once it has settled: the pane of the page's setup command runs `/bin/cat` through the shell, which
     * the sandbox pins to /bin/sh, and the panes the program makes run `cat` itself.
     */
    paneCommands: ['sh', 'cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [{ file: 'docs-mark.lisp', source: lispHelper(STEPS) }],
    steps: STEPS,
    fence,
    unwrap,
    /** What the library asks tmux about itself: its version when it opens the client, the daemon's identity and its command aliases before each command. */
    probe: ({ commands }) => commands.length === 0 || (commands.length === 1 && commands[0][0] === 'show-options' && commands[0].at(-1) === 'command-alias'),
    /** A probe is shown by its flags, which name the socket. */
    redact: (text) => text.replace(/-S \S+/, '-S <socket>'),
    /** The markers and identity rows the library's checks print, whose pid and start time differ on every run. */
    reply: (text) => text.split('\n').filter((line) => !/^(?:witness\/1\t|libtmux-[0-9A-F]{32}:)/.test(line)).join('\n'),
    instrument: instrumentLisp,
    /** The page's own setup commands: a server with the `demo` session, started before the program runs. */
    setup({ dir, env }) {
      const socket = socketOf(dir)
      rmSync(dirname(socket), { recursive: true, force: true })
      mkdirSync(dirname(socket), { recursive: true })
      execFileSync(env.LIBTMUX_DOCS_REAL_TMUX, ['-S', socket, '-f', '/dev/null', 'new-session', '-d', '-s', 'demo', '-n', 'editor', '-x', '80', '-y', '24', '--', '/bin/cat'], { cwd: dir, env: { ...env, TMUX: '', TMUX_PANE: '' }, stdio: 'ignore' })
    },
    command: (dir) => ['/bin/sh', join(dir, 'program')],
    toolchain: () => ({ sbcl: /SBCL (\S+)/.exec(execFileSync(sbcl(built), ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown', asdf: pinned(built, 'asdf-lisp') }),
    /**
     * Write the displayed and the marked copy beside a launcher that runs them as the page's commands do. The library
     * refuses a `tmux` that is not an ELF executable, so the shim the recorder wrote becomes `tmux.sh` and `tmux` is a
     * native program that runs it.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      built = checkout
      const shim = join(sandbox, 'bin/tmux')
      renameSync(shim, join(sandbox, 'bin/tmux.sh'))
      writeFileSync(join(sandbox, 'wrapper.c'), WRAPPER)
      execFileSync('cc', ['-O1', `-DSHIM=${JSON.stringify(join(sandbox, 'bin/tmux.sh'))}`, '-o', shim, join(sandbox, 'wrapper.c')])
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      mkdirSync(cacheOf(checkout), { recursive: true })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
        const helper = dir === 'marked' ? `LIBTMUX_DOCS_HELPER=${JSON.stringify(join(sandbox, dir, 'docs-mark.lisp'))}\nexport LIBTMUX_DOCS_HELPER\n` : ''
        writeFileSync(join(sandbox, dir, 'program'), `unset TMUX TMUX_PANE\nXDG_CACHE_HOME=${JSON.stringify(cacheOf(checkout))}\nLIBTMUX_SOURCE=${JSON.stringify(checkout)}\nLIBTMUX_PROGRAM=${JSON.stringify(shim)}\nLIBTMUX_EXAMPLE_SOCKET=${JSON.stringify(socketOf(join(sandbox, dir)))}\nexport XDG_CACHE_HOME LIBTMUX_SOURCE LIBTMUX_PROGRAM LIBTMUX_EXAMPLE_SOCKET\n${helper}exec ${JSON.stringify(sbcl(checkout))} --noinform --no-sysinit --no-userinit --load ${JSON.stringify(asdf(checkout))} --script ${JSON.stringify(join(sandbox, dir, this.file))}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
      for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
      // Compile the library now, so neither timed run does.
      if (!existsSync(join(cacheOf(checkout), 'common-lisp'))) {
        execFileSync(sbcl(checkout), ['--noinform', '--no-sysinit', '--no-userinit', '--load', asdf(checkout), '--eval', `(progn (asdf:load-asd ${JSON.stringify(join(checkout, 'libtmux.asd'))}) (asdf:load-system "libtmux"))`, '--quit'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, XDG_CACHE_HOME: cacheOf(checkout) } })
      }
    },
  },
}
