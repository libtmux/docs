import { jvmRecipe } from './jvm.mjs'
import { withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Java's quickstart is recorded: the calls to mark, and how libtmux-java's
 * own tmux preamble is recognised. The build is shared with Kotlin and Scala
 * (`jvm.mjs`).
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Java expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (javac's Tree API: every call whose
 * receiver is a type of the library) and take the value from the variable the
 * statement binds; the recorder would not change.
 */

/** The class the marked copy links in; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const JAVA_HELPER = `import java.io.IOException;
import java.util.Map;

/** Tells the recorder that an API call has returned, and what it returned. */
final class DocsMark {
    private DocsMark() {}

    static void mark(String step, Object value) {
        try {
            var process = new ProcessBuilder(System.getenv("LIBTMUX_DOCS_MARK"), step, json(value))
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.INHERIT)
                    .start();
            int status = process.waitFor();
            if (status != 0) {
                System.err.println("docs mark: " + step + " exited " + status);
                System.exit(status);
            }
        } catch (IOException | InterruptedException error) {
            System.err.println("docs mark: " + step + ": " + error);
            System.exit(70);
        }
    }

    /** A value as JSON: null, booleans, numbers, strings, maps and iterables. */
    static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Boolean || value instanceof Number) return value.toString();
        if (value instanceof Map<?, ?> map) {
            var out = new StringBuilder("{");
            for (var entry : map.entrySet()) {
                if (out.length() > 1) out.append(',');
                out.append(json(String.valueOf(entry.getKey()))).append(':').append(json(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof Iterable<?> items) {
            var out = new StringBuilder("[");
            for (var item : items) {
                if (out.length() > 1) out.append(',');
                out.append(json(item));
            }
            return out.append(']').toString();
        }
        var text = value.toString();
        var out = new StringBuilder("\\"");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\\\\"");
                case '\\\\' -> out.append("\\\\\\\\");
                case '\\n' -> out.append("\\\\n");
                case '\\r' -> out.append("\\\\r");
                case '\\t' -> out.append("\\\\t");
                default -> {
                    if (c < 0x20) out.append(String.format("\\\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }
}
`

const SESSION_OF = (name) => `java.util.Map.of("id", ${name}.id().value(), "name", ${name}.name())`
const SESSION = SESSION_OF('session')
const WINDOW = (name) => `java.util.Map.of("id", ${name}.id().value(), "name", ${name}.name())`
const PANE = (name) => `java.util.Map.of("id", ${name}.id().value())`

export const RECIPES = {
  'typed-graph': jvmRecipe({
    port: 'java',
    file: 'src/main/java/Main.java',
    mainClass: 'Main',
    modules: ['libtmux'],
    version: '0.1.2',
    terminator: ';',
    helpers: [{ file: 'src/main/java/DocsMark.java', source: JAVA_HELPER }],
    // The server is opened lazily: no tmux runs until the first command. The
    // snapshot and the reads taken from it send tmux nothing.
    steps: [
      { id: 'open', label: 'Server.open', anchor: 'Server.open(', type: 'Server', value: 'java.util.Map.of("endpoint", "named socket", "configFile", config.configFile().get().toString())' },
      { id: 'new-session', label: 'Server.newSession', anchor: 'server.newSession(', type: 'Session', value: SESSION },
      { id: 'active-window', label: 'Session.activeWindow', anchor: 'session.activeWindow(', type: 'Optional<Window>', value: WINDOW('first') },
      { id: 'rename', label: 'Window.rename', anchor: 'first.rename(', type: 'Window', value: WINDOW('editor') },
      { id: 'active-pane', label: 'Window.activePane', anchor: 'editor.activePane(', type: 'Optional<Pane>', value: PANE('left') },
      { id: 'split', label: 'Pane.split', anchor: 'left.split(', type: 'Pane', value: PANE('right') },
      { id: 'new-window', label: 'Session.newWindow', anchor: 'session.newWindow(', type: 'Window', value: WINDOW('logs') },
      { id: 'send-line', label: 'Pane.sendLine', anchor: 'right.sendLine(', type: 'void', value: 'null' },
      { id: 'await-text', label: 'Pane.awaitText', anchor: 'right.awaitText(', type: 'TextOutcome', value: 'seen.name()' },
      { id: 'select-pane', label: 'Pane.select', anchor: 'right.select(', type: 'void', value: 'null' },
      { id: 'select-window', label: 'Window.select', anchor: 'logs.select(', type: 'void', value: 'null' },
      { id: 'snapshot', label: 'Server.snapshot', anchor: 'server.snapshot(', type: 'ServerSnapshot', value: 'java.util.Map.of("sessions", snapshot.sessions().size(), "windows", snapshot.windows().size(), "panes", snapshot.panes().size())' },
      { id: 'sessions', label: 'ServerSnapshot.sessions', anchor: 'snapshot.sessions(', type: 'List<SessionState>', value: 'sessions.stream().map(x -> x.id().value()).toList()' },
      { id: 'windows', label: 'ServerSnapshot.windowsOf', anchor: 'snapshot.windowsOf(', type: 'List<WindowState>', value: 'windows.stream().map(x -> x.context().window().value()).toList()', repeat: true },
      { id: 'panes', label: 'ServerSnapshot.panesOf', anchor: 'snapshot.panesOf(', type: 'List<PaneState>', value: 'panes.stream().map(x -> x.id().value()).toList()', repeat: true },
      { id: 'pane-window', label: 'Pane.window', anchor: 'right.window(', type: 'Window', value: WINDOW('window') },
      { id: 'window-session', label: 'Window.session', anchor: 'window.session(', type: 'Session', value: SESSION_OF('owner') },
      { id: 'kill', label: 'Server.killServer', anchor: 'server.killServer(', type: 'void', value: 'null' },
    ],
  }),
}
