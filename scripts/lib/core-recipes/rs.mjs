import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { statementLines } from '../../../site/src/lib/core-statement.ts'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Rust's programs are recorded, one recipe per program: the calls to mark,
 * what to build, and how libtmux-rs's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of one program to
 * their anchors and to a Rust expression for the value each returned (a
 * `String` of JSON, built with the helpers below). It is checked against the
 * program (every anchor must be found once and in the order the marks arrive),
 * not derived from it. A generated map would read the calls from the program's
 * syntax tree (`syn`: every method call on a type of the library) and take the
 * value from the binding the statement makes; the recorder would not change.
 *
 * A call whose value the program drops (`pane.split(..).await?;`) or only
 * passes to a comparison (`session.windows().await?.len() == 2`) has no value
 * a marker line can reach, and is left out of every recipe here.
 */

/** Appended to the marked copy: the Rust helper that runs `docs-mark` and stops the program if that fails. */
const RUST_HELPER = `
// Everything below is added to the marked copy; the displayed program ends above.
fn docs_json(text: &str) -> String {
    let mut out = String::from("\\"");
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\\\\""),
            '\\\\' => out.push_str("\\\\\\\\"),
            '\\n' => out.push_str("\\\\n"),
            '\\r' => out.push_str("\\\\r"),
            '\\t' => out.push_str("\\\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn docs_object(fields: &[(&str, String)]) -> String {
    let body: Vec<String> = fields.iter().map(|(key, value)| format!("{}:{}", docs_json(key), value)).collect();
    format!("{{{}}}", body.join(","))
}

fn docs_array(items: Vec<String>) -> String {
    format!("[{}]", items.join(","))
}

/// A result as a recording stores it: null, or the error's message.
fn docs_error<T, E: std::fmt::Display>(result: &Result<T, E>) -> String {
    match result {
        Ok(_) => String::from("null"),
        Err(error) => docs_json(&error.to_string()),
    }
}

/// Tells the recorder that an API call has returned, and what it returned.
fn docs_mark(step: &str, value: String) {
    let mark = std::env::var("LIBTMUX_DOCS_MARK").expect("LIBTMUX_DOCS_MARK");
    match std::process::Command::new(mark).arg(step).arg(&value).status() {
        Ok(status) if status.success() => {}
        Ok(status) => {
            eprintln!("docs mark: {step} {status}");
            std::process::exit(status.code().unwrap_or(70));
        }
        Err(error) => {
            eprintln!("docs mark: {step} {error}");
            std::process::exit(70);
        }
    }
}
`

/**
 * Insert a mark after each step's statement. The statement ends at the line
 * that ends in `;`, since a call chain goes on past the call's own parenthesis
 * (`.await?;`); one that opens a block is marked after the block closes.
 */
export function instrumentRust(source, steps, extra) {
  const lines = source.split('\n')
  const ended = steps.map((step) => {
    const range = statementLines(source, step.anchor, '//', step.occurrence)
    if (!range) return step
    let end = range[1]
    while (!/[;{]$/.test(lines[end - 1].trimEnd())) end++
    if (!lines[end - 1].trimEnd().endsWith('{')) return { ...step, after: end }
    // The block's own indentation: that of the line holding its `{`, which rustfmt may put on a line of its own.
    const indent = /^\s*/.exec(lines[end - 1])[0]
    const close = lines.findIndex((line, index) => index >= end && line === `${indent}}`)
    if (close < 0) throw new Error(`${step.id}: the block the call opens is not closed at its own indentation`)
    return { ...step, after: close + 1 }
  })
  const marked = instrumentLines(source, ended, (step) => `docs_mark(${JSON.stringify(step.id)}, ${step.value}); // docs:mark`)
  return extra ? extra(marked) : marked
}

const ENV = { ...process.env, RUSTUP_TOOLCHAIN: '1.97.1' }
/** Cargo's target directory, on disk (`/tmp` is memory), one per copy: cargo gives two packages of one name the same artifact when their paths differ only in the sandbox. */
const TARGET = '/home/d/tmp-wave/rs-core-player-target'

const ID = (value) => `docs_json(&${value}.id().to_string())`
const NAME = (value) => `docs_json(&${value}.name().to_string_lossy())`
const BUILD_VALUE = 'docs_object(&[("socket", docs_json(&server.socket_path().file_name().unwrap().to_string_lossy())), ("configFile", docs_json(&server.config_file().unwrap().to_string_lossy()))])'
const SESSION = `docs_object(&[("id", ${ID('session')}), ("name", ${NAME('session')})])`
const WINDOW = (name) => `docs_object(&[("id", ${ID(name)}), ("name", ${NAME(name)})])`
const PANE = (name) => `docs_object(&[("id", ${ID(name)})])`
/** The ids of the objects a read returned, in the order it returned them. */
const LIST = (name, item) => `docs_array(${name}.iter().map(|${item}| ${ID(item)}).collect())`
const RESULT = (name) => `docs_error(&${name})`

/** What every Rust recipe shares: the toolchain, the build against the checkout, and libtmux-rs's tmux preamble. */
const RUST = {
  stepMap: 'hand-written',
  /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
  paneCommands: ['sh'],
  /** A wait polls with `display-message ; capture-pane` until its text shows. */
  polls: ['display-message'],
  /** Every libtmux-rs command begins with a guard that fails if the daemon's version changed since it was read. */
  fence: (command) => command[0] === 'if-shell' && command.some((word) => word === 'libtmux-core-version-changed'),
  /** What the library asks tmux about itself: `tmux -V`, and a `run-shell -C` that expands the daemon's version. */
  probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-')))),
  checkout: (port, env, expand) => checkoutOf(port, env, expand),
  /**
   * The programs keep their socket in a fixed `/tmp/libtmux-rs-dev`, outside
   * the sandbox the recorder reads tmux from, so each runs in a mount
   * namespace that binds the sandbox's `tmp` over that directory. Nothing of
   * the host's `/tmp/libtmux-rs-dev` is touched.
   */
  command: (dir) => ['unshare', '--user', '--map-current-user', '--keep-caps', '--mount', 'sh', '-c', 'mkdir -p /tmp/libtmux-rs-dev && mount --bind "$1" /tmp/libtmux-rs-dev && exec "$2"', 'sh', join(dirname(dir), 'tmp'), join(dir, 'program')],
  toolchain: () => ({ rustc: execFileSync('rustc', ['--version'], { encoding: 'utf8', env: ENV }).trim().split(' ')[1] }),
  /**
   * Write the displayed and the marked copy as packages that depend on the
   * checkout's `crates/libtmux` by path, and build both offline. The package
   * takes the checkout's `Cargo.lock` (or the quickstart's own) so its
   * dependencies are the ones the checkout resolves.
   */
  build({ sandbox, checkout, code, marked }) {
    for (const [dir, source] of [['exact', code], ['marked', marked + RUST_HELPER]]) {
      mkdirSync(join(sandbox, dir, 'src'), { recursive: true })
      writeFileSync(join(sandbox, dir, 'Cargo.toml'), this.manifest(checkout))
      copyFileSync(join(checkout, 'Cargo.lock'), join(sandbox, dir, 'Cargo.lock'))
      writeFileSync(join(sandbox, dir, 'src/main.rs'), source)
    }
    mkdirSync(join(sandbox, 'tmp'), { recursive: true })
    for (const dir of ['exact', 'marked']) {
      execFileSync('cargo', ['build', '--offline', '--jobs', '2'], { cwd: join(sandbox, dir), env: { ...ENV, CARGO_TARGET_DIR: join(TARGET, dir) }, stdio: 'inherit' })
      copyFileSync(join(TARGET, dir, 'debug', 'docs-program'), join(sandbox, dir, 'program'))
    }
  },
}

const MANIFEST = (checkout, extra) => `[package]\nname = "docs-program"\nversion = "0.0.0"\nedition = "2024"\npublish = false\n\n[dependencies]\nlibtmux = { path = ${JSON.stringify(join(checkout, 'crates/libtmux'))} }\ntempfile = "3.20"\ntokio = { version = "1.40", features = ["macros", "rt", "time"] }\n${extra ?? ''}`

/** A capability's program from the example cache; the cache holds no output.txt for Rust, so the output is what `scripts/run-examples.sh` requires of it. */
function capabilityProgram(root, file, output) {
  const cache = JSON.parse(readFileSync(join(root, 'site/src/data/example-sources.json'), 'utf8'))
  const program = cache[`rs:${file}`]
  if (!program) throw new Error(`rs: ${file} is not in the example cache`)
  return { code: program.content.replace(/\n$/, ''), file: file.split('/').at(-1), revision: program.revision, repository: program.repository, expectedOutput: output }
}

const CAPABILITY = { ...RUST, manifest: (checkout) => MANIFEST(checkout) }

/** One recipe per program of the landing page that Rust plays. */
export const RECIPES = {
  'typed-graph': {
    ...RUST,
    capability: 'typed-graph',
    file: 'src/main.rs',
    source: (root) => quickstartSource(root, 'rs', 'src/main.rs'),
    // The quickstart's dependencies, with the library taken from the checkout instead of crates.io.
    manifest: (checkout) => MANIFEST(checkout),
    instrument: (source, steps) => instrumentRust(source, steps),
    // In the order the calls run, which is not the order of their lines: work() is above main().
    // The walk binds each read (`let windows = ...;`) so its value is in scope, and
    // the last two reads, `window()` and `session()`, go up from the right pane.
    steps: [
      { id: 'build', label: 'ServerBuilder.build', anchor: 'Server::builder()', type: 'Server', value: BUILD_VALUE },
      { id: 'new-session', label: 'Server.new_session', anchor: '.new_session(', type: 'Session', value: SESSION },
      { id: 'active-window', label: 'Session.active_window', anchor: '.active_window(', type: 'Option<Window>', value: WINDOW('editor') },
      { id: 'rename', label: 'Window.rename', anchor: 'editor.rename(', type: '&mut Window', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Window.active_pane', anchor: '.active_pane(', type: 'Option<Pane>', value: PANE('left') },
      { id: 'split', label: 'Pane.split', anchor: 'left.split(', type: 'Pane', value: PANE('right') },
      { id: 'new-window', label: 'Session.new_window', anchor: 'session.new_window(', type: 'Window', value: WINDOW('logs') },
      { id: 'send-line', label: 'Pane.send_line', anchor: 'right.send_line(', type: '()', value: 'String::from("null")' },
      { id: 'wait-for-text', label: 'Pane.wait_for_text', anchor: '.wait_for_text(', type: 'PaneWait', value: 'docs_json(&format!("{seen:?}"))' },
      { id: 'select-pane', label: 'Pane.select', anchor: 'right.select()', type: '&mut Pane', value: PANE('right') },
      { id: 'select-window', label: 'Window.select', anchor: 'logs.select()', type: '&mut Window', value: WINDOW('logs') },
      { id: 'sessions', label: 'Server.sessions', anchor: 'server.sessions()', type: 'Vec<Session>', value: LIST('sessions', 'session') },
      { id: 'windows', label: 'Session.windows', anchor: 'each.windows()', type: 'Vec<Window>', value: LIST('windows', 'window'), repeat: true },
      { id: 'panes', label: 'Window.panes', anchor: 'window.panes()', type: 'Vec<Pane>', value: LIST('panes', 'pane'), repeat: true },
      { id: 'pane-window', label: 'Pane.window', anchor: 'right.window()', type: 'Option<Window>', value: WINDOW('window') },
      { id: 'window-session', label: 'Window.session', anchor: 'window.session()', type: 'Option<Session>', value: `docs_object(&[("id", ${ID('owner')}), ("name", ${NAME('owner')})])` },
      { id: 'kill', label: 'Server.kill', anchor: 'server.kill()', type: 'Result<(), Error>', value: RESULT('killed') },
      { id: 'shutdown', label: 'Server.shutdown', anchor: 'server.shutdown()', type: 'Result<(), Error>', value: RESULT('closed') },
    ],
  },
  'send-keys': {
    ...CAPABILITY,
    capability: 'send-keys',
    file: 'api_input.rs',
    source: (root) => capabilityProgram(root, 'crates/libtmux/examples/api_input.rs', 'input: C-c is text\n'),
    instrument: (source, steps) => instrumentRust(source, steps),
    steps: [
      { id: 'build', label: 'ServerBuilder.build', anchor: 'Server::builder()', type: 'Server', value: BUILD_VALUE },
      { id: 'new-session', label: 'Server.new_session', anchor: '.new_session(', type: 'Session', value: SESSION },
      { id: 'panes', label: 'Session.panes', anchor: 'session.panes()', type: 'Vec<Pane>', value: `docs_array(panes.iter().map(|pane| ${ID('pane')}).collect())` },
      // The program returns an error unless the wait arrived, so the mark after the `if` runs only for `PaneWait::Arrived`.
      { id: 'wait-for-text', label: 'Pane.wait_for_text', anchor: '.wait_for_text(', type: 'PaneWait', value: 'docs_json("Arrived")' },
      { id: 'send-keys', label: 'Pane.send_keys', anchor: 'pane.send_keys(', type: '()', value: 'String::from("null")' },
      { id: 'send-key-names', label: 'Pane.send_key_names', anchor: 'pane.send_key_names(', type: '()', value: 'String::from("null")' },
      { id: 'capture', label: 'Pane.capture', anchor: 'pane.capture()', type: 'Vec<TmuxText>', value: 'docs_array(lines.iter().map(|line| docs_json(&line.to_string_lossy())).collect())', repeat: true },
      { id: 'kill', label: 'Server.kill', anchor: 'server.kill()', type: 'Result<(), Error>', value: RESULT('killed') },
      { id: 'shutdown', label: 'Server.shutdown', anchor: 'server.shutdown()', type: 'Result<(), Error>', value: RESULT('closed') },
    ],
  },
}
