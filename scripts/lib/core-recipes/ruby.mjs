import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Ruby's programs are recorded, one recipe per capability: the calls to
 * mark, what to run, and how libtmux-ruby's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of one program to
 * their anchors and to a Ruby expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls of the program from its syntax tree (Ripper) and take the returned
 * value from the variable the statement binds; the recorder would not change.
 */

/**
 * The Ruby the marked copy loads before the program (`ruby -r`). `mark` runs
 * `docs-mark` and stops the program if that fails. `returned` is the value a
 * call gave back when the program does not keep it (a call whose result is
 * discarded, or one made inside an expression): the library methods it names
 * are wrapped to remember their last return value and change nothing else.
 */
const RUBY_HELPER = `require "json"
require "libtmux"

# Docs recorder: tells the recorder that an API call has returned, and what it returned.
module LibTmuxDocs
  RETURNED = {}

  def self.mark(step, value)
    return if system(ENV.fetch("LIBTMUX_DOCS_MARK"), step, JSON.generate(value))

    warn "docs mark: #{step} failed"
    exit($?&.exitstatus || 70)
  end

  def self.returned(name) = RETURNED.fetch(name)

  def self.watch(owner, method)
    name = "#{owner.name.split("::").last}##{method}"
    owner.prepend(Module.new do
      define_method(method) { |*args, **options, &block| RETURNED[name] = super(*args, **options, &block) }
    end)
  end

  def self.result(command) = {"success" => command.success?}
end

LibTmuxDocs.watch(LibTmux::Window, :split)
LibTmuxDocs.watch(LibTmux::Window, :snapshot)
LibTmuxDocs.watch(LibTmux::Session, :list_windows)
LibTmuxDocs.watch(LibTmux::Pane, :send_text)
LibTmuxDocs.watch(LibTmux::Pane, :send_keys)
LibTmuxDocs.watch(LibTmux::Pane, :capture)
`

/** Insert a mark after each step's statement; the mark ends in the trailer the displayed copy is stripped by. */
export function instrumentRuby(source, steps) {
  return instrumentLines(source, steps, (step) => `LibTmuxDocs.mark(${JSON.stringify(step.id)}, ${step.value}) # docs:mark`, '#')
}

/**
 * Stands in front of the recorder's `tmux` shim. libtmux-ruby starts the daemon it owns as a foreground `tmux -D`
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

const rubyBinary = () => execFileSync('ruby', ['-e', 'print RbConfig.ruby'], { encoding: 'utf8' })

/** What every Ruby recipe shares: the interpreter, the run against the checkout's library, and libtmux-ruby's tmux preamble. */
const RUBY = {
  stepMap: 'hand-written',
  /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
  paneCommands: ['sh', 'cat'],
  /** Every command the library sends begins with a guard, an `if-shel` (not a tmux command) that fails if the daemon is no longer the release it checked. */
  fence: (command) => command[0] === 'if-shel' && command.some((word) => /^libtmux-version-/.test(word)),
  /** What the library asks tmux about itself: `tmux -V`, the check that no alias shadows its guard (`if-shel` around an unknown `run-shel`), and an unknown `run-shel` whose error text carries the version or the daemon's identity. */
  probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => (command[0] === 'run-shel' && command.some((word) => /^libtmux-(version|identity)-/.test(word))) || (command[0] === 'if-shel' && command.some((word) => /run-shel -C libtmux-fence-/.test(word))))),
  checkout: (port, env, expand) => checkoutOf(port, env, expand),
  instrument: instrumentRuby,
  command: (dir) => [join(dir, 'program')],
  toolchain: () => ({ ruby: execFileSync(rubyBinary(), ['-e', 'print RUBY_VERSION'], { encoding: 'utf8' }) }),
  /** Write the displayed and the marked copy beside a launcher that runs them on the checkout's library, with nothing fetched. */
  build({ sandbox, checkout, code, marked, helpers }) {
    for (const [dir, source] of [['exact', code], ['marked', marked]]) {
      mkdirSync(join(sandbox, dir), { recursive: true })
      // The library keeps its socket in a directory it makes under TMPDIR; the recorder reads tmux from the sandbox's own `tmp`.
      mkdirSync(join(sandbox, 'tmp'), { recursive: true })
      writeFileSync(join(sandbox, dir, this.file), source)
      const preload = dir === 'marked' ? ` -r ${JSON.stringify(join(sandbox, dir, 'docs_mark.rb'))}` : ''
      writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nTMPDIR=${JSON.stringify(join(sandbox, 'tmp'))}\nexport TMPDIR\nPATH=${JSON.stringify(join(sandbox, 'rbbin'))}:$PATH\nexport PATH\nLIBTMUX_DOCS_WINDOW_NAMES=env\nexport LIBTMUX_DOCS_WINDOW_NAMES\nexec ${JSON.stringify(rubyBinary())} -I ${JSON.stringify(join(checkout, 'gems/libtmux/lib'))}${preload} ${JSON.stringify(join(sandbox, dir, this.file))}\n`)
      chmodSync(join(sandbox, dir, 'program'), 0o755)
    }
    mkdirSync(join(sandbox, 'rbbin'), { recursive: true })
    writeFileSync(join(sandbox, 'rbbin/tmux'), TMUX_LAUNCHER.replace('SHIM', JSON.stringify(join(sandbox, 'bin/tmux'))))
    chmodSync(join(sandbox, 'rbbin/tmux'), 0o755)
    for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
  },
}

/**
 * A capability's program from the example cache, and what it prints from the port's `examples/manifest.json`, which its own
 * tests compare the run with (the cache holds no `output.txt` for Ruby). The manifest is read from the checkout the recording is made on.
 */
function capabilityProgram(root, file, id) {
  const cached = JSON.parse(readFileSync(join(root, 'site/src/data/example-sources.json'), 'utf8'))[`ruby:${file}`]
  if (!cached) throw new Error(`ruby: ${file} is not in the example cache`)
  const checkout = process.env.LIBTMUX_DOCS_CHECKOUT_RUBY
  if (!checkout) throw new Error('ruby: set LIBTMUX_DOCS_CHECKOUT_RUBY to a checkout at the example\'s revision, which holds examples/manifest.json')
  const manifest = JSON.parse(readFileSync(join(checkout, 'examples/manifest.json'), 'utf8'))
  const entry = manifest.programs.find((example) => example.id === id)
  if (!entry) throw new Error(`ruby: examples/manifest.json has no ${id}`)
  return { code: cached.content.replace(/\n$/, ''), file: file.split('/').at(-1), revision: cached.revision, repository: cached.repository, expectedOutput: entry.api.output }
}

const SERVER = '{"owned" => server.owned?, "tmuxVersion" => server.tmux_version}'
const CAPTURED = '{"lines" => LibTmuxDocs.returned("Pane#capture").stdout.lines(chomp: true).reject(&:empty?)}'
const HELPERS = [{ file: 'docs_mark.rb', source: RUBY_HELPER }]

/** One recipe per capability of the landing page that Ruby plays. */
export const RECIPES = {
  'typed-graph': {
    ...RUBY,
    capability: 'typed-graph',
    file: 'quickstart.rb',
    source: (root) => quickstartSource(root, 'ruby', 'quickstart.rb'),
    helpers: HELPERS,
    steps: [
      { id: 'start', label: 'Server.start', anchor: 'LibTmux::Server.start', type: 'LibTmux::Server', value: SERVER },
      { id: 'new-session', label: 'Server#new_session', anchor: 'server.new_session(', type: 'LibTmux::Session', value: '{"id" => session.id}' },
      { id: 'new-window', label: 'Session#new_window', anchor: 'session.new_window(', type: 'LibTmux::Window', value: '{"id" => window.id}' },
      { id: 'split', label: 'Window#split', anchor: 'window.split(', type: 'LibTmux::Pane', value: '{"id" => LibTmuxDocs.returned("Window#split").id}' },
      { id: 'snapshot', label: 'Server#snapshot', anchor: 'server.snapshot', type: 'LibTmux::Snapshot', value: '{"windows" => snapshot.windows.map { |entry| {"name" => entry.name, "panes" => entry.panes.map(&:id)} }}' },
    ],
  },
  'create-windows': {
    ...RUBY,
    capability: 'create-windows',
    file: 'new_window.rb',
    source: (root) => capabilityProgram(root, 'examples/api/new_window.rb', 'api_new_window'),
    helpers: HELPERS,
    steps: [
      { id: 'start', label: 'Server.start', anchor: 'LibTmux::Server.start do |server|', type: 'LibTmux::Server', value: SERVER },
      { id: 'new-session', label: 'Server#new_session', anchor: 'server.new_session(', type: 'LibTmux::Session', value: '{"id" => session.id}' },
      { id: 'new-window', label: 'Session#new_window', anchor: 'session.new_window(', type: 'LibTmux::Window', value: '{"id" => window.id}' },
      { id: 'window-snapshot', label: 'Window#snapshot', anchor: 'window.snapshot.name', type: 'LibTmux::WindowSnapshot', value: '{"id" => LibTmuxDocs.returned("Window#snapshot").id, "name" => LibTmuxDocs.returned("Window#snapshot").name}' },
      { id: 'list-windows', label: 'Session#list_windows', anchor: 'session.list_windows.length', type: 'Array<LibTmux::Window>', value: '{"windows" => LibTmuxDocs.returned("Session#list_windows").map(&:id)}' },
    ],
  },
  'send-keys': {
    ...RUBY,
    capability: 'send-keys',
    file: 'capture.rb',
    source: (root) => capabilityProgram(root, 'examples/api/capture.rb', 'api_capture'),
    helpers: HELPERS,
    // The program polls, and the loop's capture is not a step: a mark waits for tmux to settle, so by the next capture the output has arrived and the loop does not run.
    steps: [
      { id: 'start', label: 'Server.start', anchor: 'LibTmux::Server.start do |server|', type: 'LibTmux::Server', value: SERVER },
      { id: 'new-session', label: 'Server#new_session', anchor: 'server.new_session(', type: 'LibTmux::CreationReceipt', value: '{"session" => created.entity.id, "window" => created.window.id, "pane" => created.pane.id}' },
      { id: 'send-text', label: 'Pane#send_text', anchor: 'pane.send_text(', type: 'LibTmux::CommandResult', value: 'LibTmuxDocs.result(LibTmuxDocs.returned("Pane#send_text"))' },
      { id: 'send-keys', label: 'Pane#send_keys', anchor: 'pane.send_keys(', type: 'LibTmux::CommandResult', value: 'LibTmuxDocs.result(LibTmuxDocs.returned("Pane#send_keys"))' },
      { id: 'capture', label: 'Pane#capture', anchor: 'captured = pane.capture.stdout.lines(chomp: true)', occurrence: 1, type: 'LibTmux::CommandResult', value: CAPTURED },
    ],
  },
}
