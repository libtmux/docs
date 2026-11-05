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

export const RECIPES = {
  'typed-graph': jvmRecipe({
    port: 'kotlin',
    file: 'src/main/kotlin/Main.kt',
    mainClass: 'MainKt',
    modules: ['libtmux', 'libtmux-kotlin'],
    helpers: [{ file: 'src/main/kotlin/DocsMark.kt', source: KOTLIN_HELPER }],
    // `session.activeWindow` and `.activePane` are pure reads of the capture: no tmux command is sent for either, so they share one mark point after the statement that holds both.
    steps: [
      { id: 'with-server', label: 'withServer', anchor: 'withServer(', type: 'Server', value: 'mapOf("endpoint" to "named socket", "configFile" to config.configFile().get().toString())' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Session', value: 'mapOf("id" to session.id.value(), "name" to session.name)' },
      { id: 'active-window', label: 'Session.activeWindow', anchor: 'session.activeWindow', afterAnchor: '?: error("no active pane")', type: 'Window?', value: 'mapOf("id" to session.activeWindow!!.id.value(), "name" to session.activeWindow!!.name)' },
      { id: 'active-pane', label: 'Window.activePane', anchor: '?.activePane', joinTo: 'active-window', type: 'Pane?', value: 'mapOf("id" to pane.id.value())' },
      { id: 'send-line', label: 'Pane.sendLine', anchor: 'pane.sendLine(', type: 'Unit', value: 'null' },
      { id: 'await-text', label: 'Pane.awaitText', anchor: 'pane.awaitText(', type: 'TextOutcome', value: 'outcome.name' },
      { id: 'capture', label: 'Pane.capture', anchor: 'pane.capture(', type: 'List<String>', value: 'lines' },
      { id: 'run', label: 'Pane.run', anchor: 'pane.run(', type: 'PaneRun', value: 'mapOf("outcome" to run.outcome().name, "exitStatus" to run.exitStatus.orNull(), "output" to run.output())' },
      { id: 'kill', label: 'Server.killServer', anchor: 'server.killServer(', type: 'Unit', value: 'null' },
    ],
  }),
}
