import { jvmRecipe } from './jvm.mjs'
import { withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Scala's quickstart is recorded: the calls to mark. The build and
 * libtmux-java's tmux preamble are shared with Java and Kotlin (`jvm.mjs`).
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Scala expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's typed tree (the Scala 3 compiler's TASTy: every
 * call whose receiver is a type of the library) and take the value from the
 * name the statement binds; the recorder would not change.
 *
 * `session.newWindow("logs")` drops its result, and a line added after it
 * cannot reach the value, so that step returns the window's name from the
 * call's own argument; the window's id is in tmux's state at the step.
 */

/** The object the marked copy links in; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const SCALA_HELPER = `import java.lang.ProcessBuilder.Redirect

/** Tells the recorder that an API call has returned, and what it returned. */
object DocsMark {
  def mark(step: String, value: Any): Unit = {
    val status =
      try {
        new ProcessBuilder(sys.env("LIBTMUX_DOCS_MARK"), step, json(value))
          .redirectOutput(Redirect.DISCARD)
          .redirectError(Redirect.INHERIT)
          .start()
          .waitFor()
      } catch {
        case error: Exception =>
          System.err.println("docs mark: " + step + ": " + error)
          sys.exit(70)
      }
    if (status != 0) {
      System.err.println("docs mark: " + step + " exited " + status)
      sys.exit(status)
    }
  }

  /** A value as JSON: null, booleans, numbers, strings, maps and iterables. */
  def json(value: Any): String = value match {
    case null => "null"
    case _: Boolean | _: Number => value.toString
    case map: scala.collection.Map[?, ?] =>
      map.map((key, item) => json(key.toString) + ":" + json(item)).mkString("{", ",", "}")
    case items: Iterable[?] => items.map(json).mkString("[", ",", "]")
    case other =>
      val out = new StringBuilder("\\"")
      other.toString.foreach {
        case '"' => out.append("\\\\\\"")
        case '\\\\' => out.append("\\\\\\\\")
        case '\\n' => out.append("\\\\n")
        case '\\r' => out.append("\\\\r")
        case '\\t' => out.append("\\\\t")
        case c if c < ' ' => out.append("\\\\u%04x".format(c.toInt))
        case c => out.append(c)
      }
      out.append('"').toString
  }
}
`

/** A session, window or pane as a recording stores it, from the variable the statement binds. */
const SESSION = 'Map("id" -> session.asJava.id().value(), "name" -> session.name)'
const WINDOW = (name) => `Map("id" -> ${name}.id.value(), "index" -> ${name}.index.value(), "name" -> ${name}.name)`
const PANE = (name) => `Map("id" -> ${name}.id.value())`

export const RECIPES = {
  'typed-graph': jvmRecipe({
    port: 'scala',
    file: 'src/main/scala/Main.scala',
    mainClass: 'Main',
    modules: ['libtmux', 'libtmux-scala'],
    helpers: [{ file: 'src/main/scala/DocsMark.scala', source: SCALA_HELPER }],
    version: '0.1.2',
    steps: [
      { id: 'open', label: 'Server.open', anchor: 'Server.open(', type: 'Server', value: 'Map("endpoint" -> "named socket", "configFile" -> config.configFile().get().toString)' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Session', value: SESSION },
      { id: 'active-window', label: 'Session.activeWindow', anchor: 'session.activeWindow', type: 'Window', value: WINDOW('active') },
      { id: 'rename', label: 'Window.rename', anchor: 'active.rename(', type: 'Window', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Window.activePane', anchor: 'editor.activePane', type: 'Pane', value: PANE('left') },
      { id: 'split', label: 'Pane.split', anchor: 'left.split(', type: 'Pane', value: PANE('right') },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'session.newWindow(', type: 'Window', value: WINDOW('logs') },
      { id: 'send-line', label: 'Pane.sendLine', anchor: 'right.sendLine(', type: 'Unit', value: 'null' },
      { id: 'await-text', label: 'Pane.awaitText', anchor: 'right.awaitText(', type: 'TextOutcome', value: 'seen' },
      { id: 'select-pane', label: 'Pane.select', anchor: 'right.select(', type: 'Unit', value: 'null' },
      { id: 'select-window', label: 'Window.select', anchor: 'logs.select(', type: 'Unit', value: 'null' },
      { id: 'snapshot', label: 'Server.snapshot', anchor: 'server.snapshot(', type: 'ServerSnapshot', value: 'Map("sessions" -> snapshot.sessions().size(), "windows" -> snapshot.windows().size(), "panes" -> snapshot.panes().size())' },
      { id: 'snapshot-sessions', label: 'ServerSnapshot.sessions', anchor: 'snapshot.sessions(', type: 'Buffer[SessionState]', value: 'sessions.map(found => Map("id" -> found.id().value(), "name" -> found.name()))' },
      { id: 'pane-window', label: 'Pane.window', anchor: 'right.window', type: 'Window', value: WINDOW('window') },
      { id: 'window-session', label: 'Window.session', anchor: 'window.session', type: 'Session', value: SESSION.replace(/\bsession\b/g, 'owner') },
      { id: 'kill', label: 'Server.killServer', anchor: 'server.killServer(', type: 'Unit', value: 'null' },
    ],
  }),
}
