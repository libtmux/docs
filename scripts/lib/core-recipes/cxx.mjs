import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How C++'s quickstart is recorded: the calls to mark, what to build, and how
 * libtmux-cxx's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a C++ expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (clang's AST: every call whose
 * receiver is a type of the library) and take the value from the variable the
 * statement binds; the recorder would not change.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** The files of the quickstart project besides the program (its CMakeLists.txt), as `home-examples.json` displays them. */
const projectFiles = () => JSON.parse(readFileSync(join(root, 'site/src/data/home-examples.json'), 'utf8')).cxx.files

/**
 * The header the marked copy includes; it runs `LIBTMUX_DOCS_MARK` and stops
 * the program if that fails. Standard library and POSIX only, and a small
 * hand-written JSON writer for the values the steps return.
 */
const CXX_HELPER = `#pragma once

#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>

#include <cstdio>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

extern char** environ;

namespace docs {

/** A string as a JSON string. */
inline std::string str(std::string_view text) {
  std::string out = "\\"";
  for (const unsigned char c : text) {
    switch (c) {
      case '"': out += "\\\\\\""; break;
      case '\\\\': out += "\\\\\\\\"; break;
      case '\\n': out += "\\\\n"; break;
      case '\\r': out += "\\\\r"; break;
      case '\\t': out += "\\\\t"; break;
      default:
        if (c < 0x20) {
          char escape[8];
          std::snprintf(escape, sizeof escape, "\\\\u%04x", c);
          out += escape;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out + '"';
}

inline std::string boolean(bool value) { return value ? "true" : "false"; }
inline std::string null() { return "null"; }

/** An object of keys and values that are already JSON. */
inline std::string object(const std::vector<std::pair<std::string, std::string>>& fields) {
  std::string out = "{";
  for (const auto& [key, value] : fields) {
    if (out.size() > 1) out += ',';
    out += str(key) + ':' + value;
  }
  return out + '}';
}

/** An array of strings. */
inline std::string lines(const std::vector<std::string_view>& items) {
  std::string out = "[";
  for (const auto item : items) {
    if (out.size() > 1) out += ',';
    out += str(item);
  }
  return out + ']';
}

/** Tell the recorder that an API call has returned, and what it returned (JSON). */
inline void mark(const char* step, const std::string& value) {
  const char* program = std::getenv("LIBTMUX_DOCS_MARK");
  if (!program) {
    std::fprintf(stderr, "docs mark: LIBTMUX_DOCS_MARK is not set\\n");
    std::exit(70);
  }
  char* argv[] = {const_cast<char*>(program), const_cast<char*>(step), const_cast<char*>(value.c_str()), nullptr};
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
  pid_t child = 0;
  const int started = posix_spawn(&child, program, &actions, nullptr, argv, environ);
  posix_spawn_file_actions_destroy(&actions);
  if (started != 0) {
    std::fprintf(stderr, "docs mark: %s: cannot start (%d)\\n", step, started);
    std::exit(70);
  }
  int status = 0;
  if (waitpid(child, &status, 0) < 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    std::fprintf(stderr, "docs mark: %s failed\\n", step);
    std::exit(WIFEXITED(status) ? WEXITSTATUS(status) : 70);
  }
}

}  // namespace docs
`

/**
 * Insert the marker lines and the include that provides them. A step with
 * \`afterAnchor\` is marked after the line that holds that text (when the
 * value is not in scope after its own statement); one with \`joinTo\` is
 * marked in the same place as the step it names, after that step's mark.
 */
export function instrumentCxx(source, steps) {
  const lines = source.split('\n')
  const placed = steps.filter((step) => !step.joinTo).map((step) => {
    const joined = steps.filter((other) => other.joinTo === step.id)
    const marks = () => [step, ...joined].map((entry) => `docs::mark(${JSON.stringify(entry.id)}, ${entry.value}); // docs:mark`).join('\n')
    if (!step.afterAnchor) return { ...step, marks }
    const hits = lines.flatMap((line, index) => (line.includes(step.afterAnchor) ? [index + 1] : []))
    if (hits.length !== 1) throw new Error(`${step.id}: ${JSON.stringify(step.afterAnchor)} is not on exactly one line of the program`)
    return { ...step, after: hits[0], marks }
  })
  const marked = instrumentLines(source, placed, (step) => step.marks())
  return `#include "docs_mark.hpp" // docs:mark\n${marked}`
}

/** Where the library is built and installed: beside the checkout, on disk, not in the tmpfs the sandbox lives in. */
const libraryDirectory = (checkout) => join(dirname(checkout), `${basename(checkout)}-build`)

const run = (command, args, options = {}) => execFileSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options })

const COMPILER = 'clang++-18'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'main.cpp',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh'],
    source: (rootDir) => quickstartSource(rootDir, 'cxx', 'main.cpp'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The program makes its socket directory under `/tmp/ltx-cxx-home-<six characters>`. */
    socket: { pattern: 'ltx-cxx-home-[A-Za-z0-9]{6}', fixed: 'ltx-cxx-home-AbC123' },
    helpers: [{ file: 'docs_mark.hpp', source: CXX_HELPER }],
    // In the order the calls run. The server is marked after the line that unwraps it: until then it is a result that may hold an error.
    steps: [
      { id: 'startable', label: 'Server.startable_at_socket_path', anchor: 'libtmux::Server::startable_at_socket_path(', afterAnchor: 'const auto server = std::move(created).value();', type: 'expected<Server, CommandFailure>', value: 'docs::object({{"socketPath", docs::str(server.socket_path())}})' },
      { id: 'new-session', label: 'Server.new_session', anchor: 'server.new_session(', type: 'expected<Session, CommandFailure>', value: 'docs::object({{"id", docs::str(session.id().value())}, {"name", docs::str(session.name())}})' },
      { id: 'new-window', label: 'Session.new_window', anchor: 'session.new_window(', type: 'expected<Window, CommandFailure>', value: 'docs::object({{"id", docs::str(editor.id().value())}, {"name", docs::str(editor.name())}})' },
      { id: 'split', label: 'Window.split', anchor: 'editor.split(', type: 'expected<Pane, CommandFailure>', value: 'docs::object({{"id", docs::str(logs.id().value())}})' },
      { id: 'send-text', label: 'Pane.send_text', anchor: 'logs.send_text(', type: 'expected<void, CommandFailure>', value: 'docs::null()' },
      { id: 'send-key', label: 'Pane.send_key', anchor: 'logs.send_key(', type: 'expected<void, CommandFailure>', value: 'docs::null()' },
      { id: 'wait-for-text', label: 'Pane.wait_for_text', anchor: 'logs.wait_for_text(', type: 'expected<WaitResult, CommandFailure>', value: 'docs::object({{"matched", docs::boolean(ready.matched)}})' },
      { id: 'capture', label: 'Pane.capture', anchor: 'logs.capture()', type: 'expected<std::string, CommandFailure>', value: 'docs::str(visible)' },
      // The range expression of the loop is evaluated once, and is pure; the marked copy evaluates it a second time where the value is in scope.
      { id: 'capture-lines', label: 'capture_lines', anchor: 'libtmux::capture_lines(visible)', joinTo: 'capture', type: 'std::vector<std::string_view>', value: 'docs::lines(libtmux::capture_lines(visible))' },
      { id: 'kill', label: 'Server.kill', anchor: 'server.kill()', type: 'expected<void, CommandFailure>', value: 'docs::null()' },
    ],
    // Every libtmux-cxx command is an `if-shell` guard; its text is learned from the trace.
    fence: () => false,
    probe: () => false,
    instrument: instrumentCxx,
    /**
     * The program keeps its socket under a fixed `/tmp/ltx-cxx-home-XXXXXX`,
     * outside the sandbox the recorder reads tmux from, so each runs in a
     * mount namespace in which the sandbox's `tmp` is `/tmp`. The sandbox
     * itself is bound back at its own path first, so the shim, the marker and
     * the trace are where the environment says. Nothing of the host's `/tmp`
     * is touched.
     */
    command: (dir) => ['unshare', '--user', '--map-current-user', '--keep-caps', '--mount', 'sh', '-c', 'S=$1 && mkdir -p "$S/tmp/${S##*/}" && mount --bind "$S" "$S/tmp/${S##*/}" && mount --rbind "$S/tmp" /tmp && exec "$2"', 'sh', dirname(dir), join(dir, 'build/api_example')],
    toolchain: () => ({ clang: /version (\S+)/.exec(execFileSync(COMPILER, ['--version'], { encoding: 'utf8' }))?.[1] ?? 'unknown' }),
    /**
     * Build the checkout's library, install it, then build the displayed and
     * the marked copy against the install with the displayed CMakeLists.txt
     * (`CMAKE_PREFIX_PATH`). Nothing is fetched. This host has libc++ 18 but
     * no `libunwind.so` link name, so a link of that name in the build
     * directory stands in for it.
     */
    build({ sandbox, checkout, code, marked, helpers }) {
      const base = libraryDirectory(checkout)
      const prefix = join(base, 'prefix')
      mkdirSync(join(base, 'shim'), { recursive: true })
      if (!existsSync(join(base, 'shim/libunwind.so'))) symlinkSync('/usr/lib/llvm-18/lib/libunwind.so.1', join(base, 'shim/libunwind.so'))
      const env = { ...process.env, LIBRARY_PATH: join(base, 'shim') }
      run('cmake', ['-S', checkout, '-B', join(base, 'library'), `-DCMAKE_TOOLCHAIN_FILE=${join(checkout, 'cmake/toolchains/clang-libcxx.cmake')}`, '-DCMAKE_BUILD_TYPE=Release', '-DLIBTMUX_BUILD_TESTS=OFF', '-DLIBTMUX_BUILD_EXAMPLES=OFF', '-DLIBTMUX_BUILD_TESTING_LIBRARY=OFF', '-DLIBTMUX_CXX_STANDARD=23', `-DCMAKE_CXX_COMPILER=${COMPILER}`], { env })
      run('cmake', ['--build', join(base, 'library'), '-j', '2'], { env })
      run('cmake', ['--install', join(base, 'library'), '--prefix', prefix], { env })
      for (const [dir, program] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        for (const entry of projectFiles()) writeFileSync(join(sandbox, dir, entry.name), entry.name === this.file ? program : entry.code)
        if (dir === 'marked') for (const helper of helpers) writeFileSync(join(sandbox, dir, helper.file), helper.source)
        run('cmake', ['-S', join(sandbox, dir), '-B', join(sandbox, dir, 'build'), `-DCMAKE_PREFIX_PATH=${prefix}`, `-DCMAKE_CXX_COMPILER=${COMPILER}`, '-DCMAKE_CXX_FLAGS=-stdlib=libc++', '-DCMAKE_CXX_STANDARD=23'], { env })
        run('cmake', ['--build', join(sandbox, dir, 'build'), '-j', '2'], { env })
      }
    },
  },
}
