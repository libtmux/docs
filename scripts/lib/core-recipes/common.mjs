import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { statementLines } from '../../../site/src/lib/core-statement.ts'
import { resolveCheckout } from '../port-checkout.mjs'

/**
 * What every port's recipes share: where a program comes from, how marker
 * lines go into a copy of it, and the check that the marks arrived as the step
 * map says. A recipe (`core-recipes/<port>.mjs`) is one program of one port:
 *
 * - `capability`, `file`, `stepMap`, `paneCommands`, `fence`, `probe` describe it;
 * - `source(root)` gives `{ code, file, revision, repository, expectedOutput }`;
 * - `checkout(port, env)` names the library checkout the program is built against;
 * - `build({ sandbox, checkout, code, marked })` writes and builds the displayed
 *   and the marked copy under `sandbox/exact` and `sandbox/marked`;
 * - `command(dir)` is the argv that runs one built copy, and `normalizeOutput`,
 *   when given, reads what it printed the way the port's own test does;
 * - `inPlace`, when given, lists the flags that end an invocation the shim runs as tmux itself, untraced (a
 *   foreground daemon the library owns by process id);
 * - `setup({ dir, env })`, when given, does what the page's setup commands do
 *   before the program runs (start the server it connects to). It runs without
 *   the tmux shim, so no step is credited with it, and tmux is read after it
 *   for the state before the first call;
 * - `toolchain()` names the compiler for the recording's provenance;
 * - `instrument(code, steps)` is the marked copy;
 * - `steps` is the hand-written step map, in the order the calls run. A step
 *   with `repeat: true` marks once per iteration of a loop and may arrive one or
 *   more times; one with `occurrence: n` is the n-th line that holds its anchor.
 */

const json = (root, name) => JSON.parse(readFileSync(join(root, 'site/src/data', name), 'utf8'))

/** The program a port's landing page leads with, from `home-examples.json`. */
export function quickstartSource(root, port, file) {
  const home = json(root, 'home-examples.json')[port]
  const program = home.files.find((entry) => entry.name === file)
  return { code: program.code, file, revision: home.sourceRevision, repository: home.sourceRepository, expectedOutput: home.expectedOutput }
}

/** A capability's program and its recorded output, from the example cache (`example-sources.json`, key `<port>:<file>`). */
export function capabilitySource(root, port, file) {
  const cache = json(root, 'example-sources.json')
  const program = cache[`${port}:${file}`]
  const output = cache[`${port}:${file.replace(/[^/]*$/, 'output.txt')}`]
  if (!program || !output) throw new Error(`${port}: ${file} and its output.txt are not in the example cache`)
  return { code: program.content.replace(/\n$/, ''), file: file.split('/').at(-1), revision: program.revision, repository: program.repository, expectedOutput: output.content }
}

/**
 * Run the sandbox's `tmux` shim under bun instead of node when bun is installed. A library that gives each operation
 * a deadline of a second or two (libtmux-ocaml's `deadline exceeded`) makes several tmux invocations in it, and
 * node's start-up alone took most of that on a loaded host; bun starts in a tenth of the time.
 */
export function fastShim(sandbox) {
  const script = join(sandbox, 'bin/tmux')
  const runtime = execFileSync('sh', ['-c', 'command -v bun || command -v node'], { encoding: 'utf8' }).trim()
  writeFileSync(script, readFileSync(script, 'utf8').replace(/^NODE=.*$/m, `NODE=${JSON.stringify(runtime)}`))
}

/** Where a port's checkout lives: its environment variable, or the port's own worktree. */
export const checkoutOf = (port, env) => resolveCheckout(port, { env, order: ['worktree'] })

/**
 * Insert a marker line after each step's statement. `mark(step)` is the line
 * in the port's language and ends in `docs:mark`, so a copy without those
 * lines is the displayed program. A step may set `after`, the line to insert
 * after, when its statement is not where its value is in scope, and `indent`,
 * the columns of the new line, when its anchor is on a later line of a
 * statement that continues over several (a layout language reads the indent
 * as the statement it belongs to). `syntax` says
 * how the language's comments and quotes are read (`statementLines`): the text
 * that starts a comment, or `syntaxOf(port)`.
 */
export function instrumentLines(source, steps, mark, syntax = '//') {
  const lines = source.split('\n')
  const inserts = steps.map((step) => {
    const range = statementLines(source, step.anchor, syntax, step.occurrence)
    if (!range) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
    const indent = step.indent === undefined ? /^\s*/.exec(lines[range[0] - 1])[0] : ' '.repeat(step.indent)
    return { after: step.after ?? range[1], text: `${indent}${mark(step)}` }
  })
  for (const { after, text } of inserts.toSorted((a, b) => b.after - a.after)) lines.splice(after, 0, text)
  return lines.join('\n')
}

/**
 * A line the recorder added: it ends in `docs:mark`, closed by `*)` in a language whose only comment is `(* *)`
 * (OCaml).
 */
const isMark = (line) => line.endsWith('docs:mark') || line.endsWith('docs:mark *)')

/** The program as displayed, from an instrumented copy of it. */
export const withoutMarks = (source) => source.split('\n').filter((line) => !isMark(line)).join('\n')

/**
 * The marks a run sent against the step map. A step that repeats may arrive
 * once or more, in a row; every other step arrives once. Returns each mark with
 * its step and which arrival of it that is (one-based), or throws.
 *
 * @param {string[]} marks step ids in the order they arrived
 * @param {{ id: string, repeat?: boolean }[]} steps
 */
export function matchMarks(marks, steps) {
  const arrivals = []
  let position = 0
  for (const step of steps) {
    let count = 0
    while (marks[position] === step.id && (step.repeat || count === 0)) { count++; position++; arrivals.push({ step, iteration: count }) }
    if (count === 0) throw new Error(`the calls returned in the order ${marks.join(', ')}; the step map expects ${steps.map((entry) => entry.id + (entry.repeat ? '+' : '')).join(', ')}, and ${step.id} did not arrive after ${position === 0 ? 'the start' : marks[position - 1]}`)
  }
  if (position < marks.length) throw new Error(`the calls returned in the order ${marks.join(', ')}; the step map expects ${steps.map((entry) => entry.id + (entry.repeat ? '+' : '')).join(', ')}, and ${marks[position]} was not expected there`)
  return arrivals
}
