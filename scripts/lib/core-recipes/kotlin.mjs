import { jvmRecipe } from './jvm.mjs'
import { withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Kotlin's quickstart is recorded: the calls to mark. The build and
 * libtmux-java's tmux preamble are shared with Java and Scala (`jvm.mjs`).
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Kotlin expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (the Kotlin compiler's PSI: every call
 * whose receiver is a type of the library) and take the value from the
 * variable the statement binds; the recorder would not change.
 */

/** The object the marked copy links in; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const KOTLIN_HELPER = `import java.lang.ProcessBuilder.Redirect
import kotlin.system.exitProcess

/** Tells the recorder that an API call has returned, and what it returned. */
object DocsMark {
    fun mark(step: String, value: Any?) {
        val status = try {
            ProcessBuilder(System.getenv("LIBTMUX_DOCS_MARK"), step, json(value))
                .redirectOutput(Redirect.DISCARD)
                .redirectError(Redirect.INHERIT)
                .start()
                .waitFor()
        } catch (error: Exception) {
            System.err.println("docs mark: $step: $error")
            exitProcess(70)
        }
        if (status != 0) {
            System.err.println("docs mark: $step exited $status")
            exitProcess(status)
        }
    }

    /** A value as JSON: null, booleans, numbers, strings, maps and iterables. */
    fun json(value: Any?): String = when (value) {
        null -> "null"
        is Boolean, is Number -> value.toString()
        is Map<*, *> -> value.entries.joinToString(",", "{", "}") { json(it.key.toString()) + ":" + json(it.value) }
        is Iterable<*> -> value.joinToString(",", "[", "]") { json(it) }
        else -> buildString {
            append('"')
            for (c in value.toString()) {
                when {
                    c == '"' -> append("\\\\\\"")
                    c == '\\\\' -> append("\\\\\\\\")
                    c == '\\n' -> append("\\\\n")
                    c == '\\r' -> append("\\\\r")
                    c == '\\t' -> append("\\\\t")
                    c < ' ' -> append("\\\\u%04x".format(c.code))
                    else -> append(c)
                }
            }
            append('"')
        }
    }
}
`

/** A window or a pane as a recording stores it, from the variable the statement binds. */
const WINDOW = (name) => `mapOf("id" to ${name}.id.value(), "index" to ${name}.index.value(), "name" to ${name}.name)`
const PANE = (name) => `mapOf("id" to ${name}.id.value())`

export const RECIPES = {
  'typed-graph': jvmRecipe({
    port: 'kotlin',
    file: 'src/main/kotlin/Main.kt',
    mainClass: 'MainKt',
    version: '0.1.2',
    modules: ['libtmux', 'libtmux-kotlin'],
    helpers: [{ file: 'src/main/kotlin/DocsMark.kt', source: KOTLIN_HELPER }],
    // In the order the calls run. `session.activeWindow`, `.activePane`, `Pane.window` and `Window.session` are pure reads of a capture: no tmux command is sent for them.
    steps: [
      { id: 'with-server', label: 'withServer', anchor: 'withServer(', type: 'Server', value: 'mapOf("endpoint" to "named socket", "configFile" to config.configFile().get().toString())' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Session', value: 'mapOf("id" to session.id.value(), "name" to session.name)' },
      { id: 'active-window', label: 'Session.activeWindow', anchor: 'session.activeWindow', type: 'Window?', value: 'mapOf("id" to first.id.value())' },
      { id: 'rename', label: 'Window.rename', anchor: 'first.rename(', type: 'Window', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Window.activePane', anchor: 'editor.activePane', type: 'Pane?', value: PANE('left') },
      { id: 'split', label: 'Pane.split', anchor: 'left.split(', type: 'Pane', value: PANE('right') },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'session.newWindow(', type: 'Window', value: WINDOW('logs') },
      { id: 'send-line', label: 'Pane.sendLine', anchor: 'right.sendLine(', type: 'Unit', value: 'null' },
      { id: 'await-text', label: 'Pane.awaitText', anchor: 'right.awaitText(', afterAnchor: 'check(outcome', type: 'TextOutcome', value: 'outcome.name' },
      { id: 'select-pane', label: 'Pane.select', anchor: 'right.select()', type: 'Unit', value: 'null' },
      { id: 'select-window', label: 'Window.select', anchor: 'logs.select()', type: 'Unit', value: 'null' },
      { id: 'sessions', label: 'Server.sessions', anchor: 'server.sessions()', type: 'List<Session>', value: 'mapOf("sessions" to sessions.size, "windows" to sessions.sumOf { it.windows.size }, "panes" to sessions.sumOf { s -> s.windows.sumOf { it.panes.size } })' },
      { id: 'pane-by-id', label: 'Server.pane', anchor: 'server.pane(', type: 'Pane?', value: PANE('pane') },
      { id: 'pane-window', label: 'Pane.window', anchor: 'pane.window', type: 'Window', value: WINDOW('home') },
      { id: 'window-session', label: 'Window.session', anchor: 'home.session', type: 'Session', value: 'mapOf("id" to owner.id.value(), "name" to owner.name)' },
      { id: 'kill', label: 'Server.killServer', anchor: 'server.killServer(', type: 'Unit', value: 'null' },
    ],
  }),
}
