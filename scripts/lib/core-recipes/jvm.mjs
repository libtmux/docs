import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { splitCommandLine } from '../core-trace.mjs'
import { checkoutOf, instrumentLines, quickstartSource } from './common.mjs'

/**
 * What the three JVM ports (Java, Kotlin, Scala) share: they are one
 * repository, libtmux-java, and their quickstarts are Gradle projects that
 * depend on `io.github.libtmux:*:0.1.0` from Maven Central.
 *
 * Offline, from the checkout: the modules the program needs are published to a
 * Maven repository under the sandbox (`publishToMavenLocal`, version 0.1.0,
 * which is what the program names), and an init script makes that repository
 * the only source of the `io.github.libtmux` group. The build files are the
 * displayed ones, byte for byte; the plugins and the other libraries come from
 * Gradle's own cache (`--offline`). Gradle runs with `--no-daemon`, and the
 * Kotlin compiler in-process, so nothing outlives the build.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** The files of a port's quickstart project besides the program, as `home-examples.json` displays them. */
const projectFiles = (port) => JSON.parse(readFileSync(join(root, 'site/src/data/home-examples.json'), 'utf8'))[port].files

const gradle = (checkout, cwd, args) => execFileSync(join(checkout, 'gradlew'), ['--offline', '--no-daemon', '--console=plain', '-Pkotlin.compiler.execution.strategy=in-process', ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'] })

const INIT = (repository) => `allprojects {
    repositories {
        exclusiveContent {
            forRepository { maven { url = uri(${JSON.stringify(repository)}) } }
            filter { includeGroup("io.github.libtmux") }
        }
    }
}
`

/** The start script Gradle's \`installDist\` writes for the example project (\`rootProject.name\` is api-example). */
const LAUNCHER = 'build/install/api-example/bin/api-example'

/**
 * Insert a mark after each step's statement. A step with `afterAnchor` is
 * marked after the line that holds that text (for a statement that goes on
 * over the lines after its first); one with `joinTo` is marked in the same
 * place as the step it names, after that step's mark.
 */
export function instrumentJvm(source, steps, mark) {
  const lines = source.split('\n')
  const placed = steps.filter((step) => !step.joinTo).map((step) => {
    const joined = steps.filter((other) => other.joinTo === step.id)
    const marks = () => [step, ...joined].map(mark).join('\n')
    if (!step.afterAnchor) return { ...step, marks }
    const hits = lines.flatMap((line, index) => (line.includes(step.afterAnchor) ? [index + 1] : []))
    if (hits.length !== 1) throw new Error(`${step.id}: ${JSON.stringify(step.afterAnchor)} is not on exactly one line of the program`)
    return { ...step, after: hits[0], marks }
  })
  return instrumentLines(source, placed, (step) => step.marks())
}

/**
 * libtmux-java's own tmux preamble. Every invocation begins with a guard that
 * fails if the tmux was replaced (`if-shell -F <version is the checked one> ' ' libtmux-stale-version-<id>`), and a
 * command sent once the daemon is known sits in a second guard
 * (`if-shell -F <pid and start time are the checked ones> '<commands>' libtmux-stale-handle-<pid>`). Before its
 * first command it asks `tmux -V` and a `run-shell -C` that expands the
 * version, and before each one it asks `display-message` for the daemon's pid,
 * version and start time.
 */
export const PREAMBLE = {
  fence: (command) => command[0] === 'if-shell' && command.some((word) => word.startsWith('libtmux-stale-version-')),
  /**
   * What differs on every run: the program's socket `libtmux-home-<uuid>`, which the `-V` probe shows among its flags,
   * the random channel in the version probe (`libtmux-version-<16 hex>-`), and the three random markers around the
   * pid, version and start time the daemon probe prints.
   */
  redact: (text) =>
    text
      .replace(/libtmux-home-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, 'libtmux-home-0000')
      .replace(/libtmux-version-[0-9a-f]{16}-/g, 'libtmux-version-0000-')
      .replace(/(#\{pid\}|#\{version\}|#\{start_time\})[0-9a-f]{32}/g, (_, token) => `${token}0000`),
  unwrap: (command) => {
    if (command[0] !== 'if-shell' || command[1] !== '-F') return undefined
    // Window.select guards with a target of its own: `if-shell -F -t <window> <condition> '<commands>' libtmux-stale-winlink-<pid>-<id>`.
    const rest = command[2] === '-t' ? command.slice(4) : command.slice(2)
    return rest.length === 3 && rest[0].includes('#{pid}') ? splitCommandLine(rest[1]) : undefined
  },
  probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => (command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-'))) || (command[0] === 'display-message' && command.some((word) => word.startsWith('#{pid}') && word.includes('#{version}'))))),
}

/** What every JVM recipe shares; `port`, `modules` (the Gradle projects to publish) and `version` (the release the displayed build file names) vary. */
export function jvmRecipe({ port, file, mainClass, modules, helpers, steps, terminator = '', version = '0.1.0' }) {
  return {
    capability: 'typed-graph',
    file,
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh'],
    source: (rootDir) => quickstartSource(rootDir, port, file),
    checkout: (portEntry, env, expand) => checkoutOf(portEntry, env, expand),
    helpers,
    steps,
    ...PREAMBLE,
    instrument: (code, stepMap) => instrumentJvm(code, stepMap, (step) => `DocsMark.mark(${JSON.stringify(step.id)}, ${step.value})${terminator} // docs:mark`),
    command: (dir) => [join(dir, LAUNCHER)],
    toolchain: () => ({ java: /version "([^"]+)"/.exec(spawnSync('java', ['-version'], { encoding: 'utf8' }).stderr)?.[1] ?? 'unknown' }),
    /** Publish the modules from the checkout, then write and build the displayed and the marked copy against them. */
    build({ sandbox, checkout, code, marked, helpers: extra }) {
      const repository = join(sandbox, 'm2')
      mkdirSync(repository, { recursive: true })
      gradle(checkout, checkout, [`-PlibtmuxVersion=${version}`, `-Dmaven.repo.local=${repository}`, ...modules.map((module) => `:${module}:publishToMavenLocal`), '-x', 'test'])
      writeFileSync(join(sandbox, 'init.gradle.kts'), INIT(repository))
      for (const [dir, program] of [['exact', code], ['marked', marked]]) {
        for (const entry of projectFiles(port)) {
          mkdirSync(dirname(join(sandbox, dir, entry.name)), { recursive: true })
          writeFileSync(join(sandbox, dir, entry.name), entry.name.endsWith(file) ? program : entry.code)
        }
        if (dir === 'marked') for (const helper of extra) { mkdirSync(dirname(join(sandbox, dir, helper.file)), { recursive: true }); writeFileSync(join(sandbox, dir, helper.file), helper.source) }
        gradle(checkout, join(sandbox, dir), ['-I', join(sandbox, 'init.gradle.kts'), `-PexampleMain=${mainClass}`, 'installDist'])
      }
    },
  }
}
