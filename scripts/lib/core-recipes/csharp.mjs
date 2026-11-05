import { instrumentLines, quickstartSource, checkoutOf, withoutMarks } from './common.mjs'
import { buildDotnet, dotnetFence, dotnetProbe, projectFiles, runCommand, toolchain } from './dotnet.mjs'

export { withoutMarks }

/**
 * How C#'s quickstart is recorded: the calls to mark, what to build, and how
 * libtmux-dotnet's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a C# expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the syntax tree (Roslyn: every invocation whose receiver is a type
 * of the library) and take the value from the variable the statement binds;
 * the recorder would not change.
 */

/** The class the marked copy compiles in; it runs `LIBTMUX_DOCS_MARK` and stops the program if that fails. */
const CS_HELPER = `#pragma warning disable
using System;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

internal static class DocsMark
{
    /// <summary>Tell the recorder that an API call has returned, and what it returned.</summary>
    public static void Mark(string step, object? value)
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("LIBTMUX_DOCS_MARK")!)
        {
            UseShellExecute = false,
        };
        start.ArgumentList.Add(step);
        start.ArgumentList.Add(JsonSerializer.Serialize(value));
        using var mark = Process.Start(start)!;
        mark.WaitForExit();
        if (mark.ExitCode != 0)
        {
            Console.Error.WriteLine($"docs mark: {step} failed");
            Environment.Exit(mark.ExitCode);
        }
    }
}

/// <summary>Stands in for TmuxWait in the marked copy: the program polls inside a wait, where no statement of it follows a capture.</summary>
internal static class DocsTmuxWait
{
    public static Task<T> UntilAsync<T>(
        Func<CancellationToken, Task<T>> probe,
        Func<T, bool> predicate,
        TimeSpan timeout,
        TimeSpan interval,
        CancellationToken cancellationToken = default) =>
        LibTmux.TmuxWait.UntilAsync(
            async cancellation =>
            {
                var value = await probe(cancellation);
                DocsMark.Mark("capture", value);
                return value;
            },
            predicate,
            timeout,
            interval,
            cancellationToken);
}
`

const mark = (step) => `DocsMark.Mark(${JSON.stringify(step.id)}, ${step.value}); // docs:mark`

/**
 * Insert a mark after each statement that binds a value, the alias that routes
 * `TmuxWait` through the helper, and a `try`/`finally` around the program so
 * that a mark is sent after the owned server's scope has been disposed.
 */
export function instrumentCsharp(source, steps) {
  const marked = instrumentLines(source, steps.filter((step) => !step.wrapped), mark, '//')
  const lines = marked.split('\n')
  const using = lines.indexOf('using LibTmux;')
  const first = lines.findIndex((line) => line.startsWith('using var deadline'))
  if (using < 0 || first < 0) throw new Error('the program has no `using LibTmux;` and `using var deadline` lines to put the marker helper around')
  lines.splice(first, 0, 'try // docs:mark', '{ // docs:mark')
  lines.splice(using + 1, 0, 'using TmuxWait = DocsTmuxWait; // docs:mark')
  lines.push('} // docs:mark', 'finally // docs:mark', '{ // docs:mark', `    ${mark(steps.find((step) => step.id === 'kill'))}`, '} // docs:mark')
  return lines.join('\n')
}

const OWNED = 'new { socketName = owned.Value.ConnectionOptions.SocketName, configFile = owned.Value.ConnectionOptions.ConfigurationFile }'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'Program.cs',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the program starts it with `/bin/sh`. */
    paneCommands: ['sh'],
    source: (root) => quickstartSource(root, 'csharp', 'app/Program.cs'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    helpers: [],
    // In the order the calls run. The owned server is stopped when its scope ends, after the last line of the program.
    steps: [
      { id: 'create-owned', label: 'Server.CreateOwnedAsync', anchor: 'Server.CreateOwnedAsync(', type: 'Task<OwnedServerScope>', value: OWNED },
      { id: 'create-session', label: 'Server.CreateSessionAsync', anchor: 'server.CreateSessionAsync(', type: 'Task<Session>', value: 'new { id = session.Id.ToString(), name = session.Name }' },
      { id: 'create-window', label: 'Session.CreateWindowAsync', anchor: 'session.CreateWindowAsync(', type: 'Task<Window>', value: 'new { id = window.Id.ToString(), name = window.Name }' },
      { id: 'get-panes', label: 'Window.GetPanesAsync', anchor: 'window.GetPanesAsync(', type: 'Task<IReadOnlyList<Pane>>', value: 'new { id = pane.Id.ToString() }' },
      { id: 'send-text', label: 'Pane.SendTextAsync', anchor: 'pane.SendTextAsync(', type: 'Task', value: 'null' },
      { id: 'enter', label: 'Pane.EnterAsync', anchor: 'pane.EnterAsync(', type: 'Task<Pane>', value: 'new { id = pane.Id.ToString() }' },
      // The capture is polled inside TmuxWait.UntilAsync; the helper's stand-in for it marks each result.
      { id: 'capture', label: 'Pane.CaptureAsync', anchor: 'pane.CaptureAsync(', type: 'Task<IReadOnlyList<string>>', value: 'null', repeat: true, wrapped: true },
      { id: 'kill', label: 'OwnedServerScope.DisposeAsync', anchor: 'await using var owned', type: 'ValueTask', value: 'null', wrapped: true },
    ],
    fence: dotnetFence,
    probe: dotnetProbe,
    /** The program names its socket `quickstart-<guid>`. */
    socket: { pattern: 'quickstart-[0-9a-f]{32}', fixed: 'quickstart-0123456789abcdef0123456789abcdef' },
    instrument: instrumentCsharp,
    command: (dir) => runCommand(dir, 'Example'),
    toolchain,
    build({ sandbox, checkout, code, marked }) {
      const project = projectFiles('csharp', ['Example.csproj', 'global.json'])
      const markedProject = { ...project, 'Example.csproj': project['Example.csproj'].replace('<Compile Include="Program.cs" />', '<Compile Include="Program.cs" />\n    <Compile Include="DocsMark.cs" />') }
      buildDotnet({
        sandbox, checkout, projects: ['LibTmux'],
        copies: { exact: { ...project, 'Program.cs': code }, marked: { ...markedProject, 'Program.cs': marked, 'DocsMark.cs': CS_HELPER } },
      })
    },
  },
}
