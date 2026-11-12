import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { statementLines, syntaxOf } from '../../../site/src/lib/core-statement.ts'
import { PREAMBLE } from './jvm.mjs'
import { checkoutOf, fastShim, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Clojure's quickstart is recorded: the calls to mark, what to run, and
 * what the library needs of the paths it is given. libtmux-clojure is a layer
 * over libtmux-java, so its tmux preamble is the one the JVM recipes share
 * (`jvm.mjs`).
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Clojure expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's forms (`read`: every call of a `libtmux.core`
 * function) and take the value from the binding that holds it; the recorder
 * would not change.
 *
 * Marks are not lines between the program's forms: most calls sit in a `let`
 * binding vector, and one is an argument of `assert`. The marked copy adds one
 * line after the program's `require`, which loads the helper below, and the
 * helper wraps the library functions the program calls (`alter-var-root`). A
 * wrapped function marks when a call the program makes returns; a call the
 * library makes inside another does not.
 */

/**
 * The namespace the marked copy loads once the library is: `mark` runs
 * `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. `wrap` marks the calls a function receives from the
 * program, in order, and refuses a call that is not planned, because a call
 * that sends tmux a command and is not marked would give its commands to the
 * next step.
 */
const HELPER = String.raw`(ns docs-mark
  (:require [clojure.java.shell :as shell]
            [clojure.string :as string]
            [libtmux.core]))

(defn- encode [value]
  (cond
    (nil? value) "null"
    (true? value) "true"
    (false? value) "false"
    (number? value) (str value)
    (keyword? value) (encode (name value))
    (string? value) (str \" (string/escape value {\" "\\\"" \\ "\\\\" \newline "\\n" \return "\\r" \tab "\\t"}) \")
    (map? value) (str "{" (string/join "," (map (fn [[k v]] (str (encode (if (keyword? k) (name k) (str k))) ":" (encode v))) value)) "}")
    (sequential? value) (str "[" (string/join "," (map encode value)) "]")
    :else (throw (ex-info "docs mark: cannot encode" {:value (str value)}))))

(defn mark [step value]
  (let [{:keys [exit]} (shell/sh (System/getenv "LIBTMUX_DOCS_MARK") step (encode value))]
    (when-not (zero? exit)
      (binding [*out* *err*] (println (str "docs mark: " step " failed")))
      (System/exit exit))))

(def ^:private depth (atom 0))

(defn- wrap [var plan]
  (let [plan (atom plan)]
    (alter-var-root
     var
     (fn [function]
       (fn [& args]
         (if (pos? @depth)
           (apply function args)
           (let [result (try (swap! depth inc) (apply function args) (finally (swap! depth dec)))
                 [[step compute] & more] @plan]
             (if step
               (do (reset! plan more)
                   (try (swap! depth inc) (mark step (compute result args)) (finally (swap! depth dec))))
               (do (binding [*out* *err*] (println (str "docs mark: an unplanned call of " var)))
                   (System/exit 70)))
             result)))))))
`

/** The functions the marked copy wraps, with the steps their calls make in the order the program makes them. */
export function clojureHelper(steps) {
  const calls = [...new Set(steps.map((step) => step.call))]
  const plans = calls.map((call) => {
    const own = steps.filter((step) => step.call === call)
    return `(wrap #'${call} [${own.map((step) => `[${JSON.stringify(step.id)} (fn [result _args] ${step.value})]`).join(' ')}])`
  })
  return `${HELPER}\n${plans.join('\n')}\n`
}

/** A session, a window and a pane as a recording stores them, from the map the call returned. */
const SESSION = '{:id (:session/id result) :name (:session/name result)}'
const WINDOW = '{:id (:window/id result) :name (:window/name result)}'
const PANE = '{:id (:pane/id result)}'

/**
 * In the order the calls run. A call that changes tmux returns the data it captured after the change. The reads of a
 * snapshot (`libtmux.data`) send tmux nothing and are not marked.
 */
const STEPS = [
  { id: 'open', label: 'libtmux.core/open!', anchor: '(tm/open!', type: 'Server', call: 'libtmux.core/open!', value: 'nil' },
  { id: 'new-session', label: 'libtmux.core/new-session!', anchor: '(tm/new-session! server', type: 'session', call: 'libtmux.core/new-session!', value: SESSION },
  { id: 'rename', label: 'libtmux.core/rename!', anchor: '(tm/rename! (:tmux/ref window) "editor")', type: 'window', call: 'libtmux.core/rename!', value: WINDOW },
  { id: 'split', label: 'libtmux.core/split-pane!', anchor: '(tm/split-pane! (:tmux/ref pane)', type: 'pane', call: 'libtmux.core/split-pane!', value: PANE },
  { id: 'new-window', label: 'libtmux.core/new-window!', anchor: '(tm/new-window! (:tmux/ref session)', type: 'window', call: 'libtmux.core/new-window!', value: WINDOW },
  { id: 'send-literal', label: 'libtmux.core/send-literal!', anchor: '(tm/send-literal! (:tmux/ref pane)', type: 'nil', call: 'libtmux.core/send-literal!', value: 'nil' },
  { id: 'send-keys', label: 'libtmux.core/send-keys!', anchor: '(tm/send-keys! (:tmux/ref pane) ["Enter"])', type: 'nil', call: 'libtmux.core/send-keys!', value: 'nil' },
  { id: 'await-text', label: 'libtmux.core/await-text!', anchor: '(tm/await-text! (:tmux/ref pane) "hello from Clojure"', type: 'keyword', call: 'libtmux.core/await-text!', value: 'result' },
  { id: 'snapshot', label: 'libtmux.core/snapshot!', anchor: '(tm/snapshot! server)', type: 'snapshot', call: 'libtmux.core/snapshot!', value: '{:sessions (count (:tmux/sessions result)) :windows (count (:tmux/windows result)) :panes (count (:tmux/panes result))}' },
  { id: 'capture', label: 'libtmux.core/capture!', anchor: '(tm/capture! (:tmux/ref pane))', type: '[string]', call: 'libtmux.core/capture!', value: '(vec (remove clojure.string/blank? result))' },
  { id: 'kill-server', label: 'libtmux.core/kill-server!', anchor: '(tm/kill-server! server)', type: 'nil', call: 'libtmux.core/kill-server!', value: 'nil' },
]

/** The line the marked copy adds: it loads the helper, which wraps the library, after the program has required it. */
const LOAD = "(require 'docs-mark) ; docs:mark"

/** Add the one line that loads the helper, after the program's `require`. */
export function instrumentClojure(source, steps) {
  for (const step of steps) {
    if (!statementLines(source, step.anchor, syntaxOf('clojure'), step.occurrence)) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
  }
  const lines = source.split('\n')
  const at = lines.indexOf("         '[libtmux.data :as data])")
  if (at < 0) throw new Error("the program has no `'[libtmux.data :as data])` line to load the helper after")
  lines.splice(at + 1, 0, LOAD)
  return lines.join('\n')
}

/** Where the library's data directory is: the program names `/tmp/libtmux-java-dev`, which the launcher maps to a directory the recorder reads. */
const FIXED = '/tmp/libtmux-java-dev'

/** The other files the page shows beside the program. */
let files

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.clj',
    stepMap: 'hand-written',
    source: (root) => {
      const home = quickstartSource(root, 'clojure', 'quickstart.clj')
      files = { 'deps.edn': quickstartSource(root, 'clojure', 'deps.edn').code }
      return home
    },
    /** What a pane runs once it has settled: the first pane runs the `/bin/sh` the program names, the others `cat`. */
    paneCommands: ['sh', 'cat'],
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The program names its socket's directory `clojure-home-<a random number>` under `/tmp/libtmux-java-dev`. */
    socket: { pattern: 'clojure-home-[0-9]+', fixed: 'clojure-home-1234567890' },
    helpers: [{ file: 'docs_mark.clj', source: clojureHelper(STEPS) }],
    steps: STEPS,
    ...PREAMBLE,
    /**
     * The library's own preamble, and the delimiters (32 hex digits) it picks for each server handle to read a listing
     * back by, in the commands it sends. What tmux prints in answer carries them too, glued to ids that are hex digits
     * themselves, so a reply is left as the library read it.
     */
    redact: (text) => PREAMBLE.redact(text).replace(/[0-9a-f]{32}/g, '0000'),
    instrument: instrumentClojure,
    /**
     * The program keeps its socket in a directory of `/tmp`, which is not the sandbox's. The launcher runs in a mount
     * namespace where `/tmp` is the sandbox's `tmp` (with the sandbox itself still at its own path) and
     * `/tmp/libtmux-java-dev` is that directory again, so the directory the program makes is where the recorder reads.
     */
    command: (dir) => ['unshare', '--user', '--map-current-user', '--keep-caps', '--mount', 'sh', '-c', 'S=$1 && mkdir -p "$S/tmp/${S##*/}" && mount --bind "$S" "$S/tmp/${S##*/}" && mount --rbind "$S/tmp" /tmp && exec "$2"', 'sh', join(dir, '..'), join(dir, 'program')],
    toolchain: () => ({ java: /version "([^"]+)"/.exec(spawnSync('java', ['-version'], { encoding: 'utf8' }).stderr)?.[1] ?? 'unknown', clojure: execFileSync('clojure', ['--version'], { encoding: 'utf8' }).replace(/^Clojure CLI version /, '').trim() }),
    /**
     * Publish the library and its Clojure layer from the checkout to a Maven repository under the sandbox, as the
     * page's own command does, then write the displayed project and the marked one, each with a copy of that
     * repository (the page's `deps.edn` names it `m2`), and fetch the program's other dependencies.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      const repository = join(sandbox, 'published')
      mkdirSync(repository, { recursive: true })
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      fastShim(sandbox)
      execFileSync(join(checkout, 'gradlew'), ['--no-daemon', '--console=plain', '--max-workers=1', '-Pkotlin.compiler.execution.strategy=in-process', `-Dmaven.repo.local=${repository}`, ':libtmux:publishToMavenLocal', ':libtmux-clojure:publishToMavenLocal'], { cwd: checkout, stdio: ['ignore', 'inherit', 'inherit'] })
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        const project = join(sandbox, dir)
        mkdirSync(project, { recursive: true })
        writeFileSync(join(project, this.file), source)
        for (const [name, text] of Object.entries(files)) writeFileSync(join(project, name), text)
        cpSync(repository, join(project, 'm2'), { recursive: true })
        if (dir === 'marked') for (const helper of helpers) writeFileSync(join(project, helper.file), helper.source)
        execFileSync('clojure', ['-P'], { cwd: project, stdio: ['ignore', 'ignore', 'inherit'] })
        // A run stopped at a mark leaves the program's socket directory behind, and a second socket would make the sandbox ambiguous.
        writeFileSync(join(project, 'program'), `#!/bin/sh\nrm -rf /tmp/clojure-home-*\nln -sfn . ${FIXED}\nunset TMUX TMUX_PANE\ncd ${JSON.stringify(project)}\nexec clojure -J-Dclojure.main.report=stderr -M quickstart.clj\n`)
        chmodSync(join(project, 'program'), 0o755)
      }
    },
  },
}
