import { statementLines } from '../../site/src/lib/core-statement.ts'

/**
 * How each port's program is recorded: the calls to mark, what to build, and
 * how its library's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of one program to
 * their anchors and to a Go expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls of the program from its syntax tree (for Go, `go/ast`: every call
 * whose receiver is a type of the library) and take the returned value from
 * the variable the statement binds; the recorder would not change.
 */

/** The Go helper the instrumented copy of a program links in; it runs `docs-mark` and stops the program if that fails. */
const GO_HELPER = `package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
)

// docsMark tells the recorder that an API call has returned, and what it returned.
func docsMark(step string, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		fmt.Fprintln(os.Stderr, "docs mark:", err)
		os.Exit(70)
	}
	mark := exec.Command(os.Getenv("LIBTMUX_DOCS_MARK"), step, string(encoded))
	mark.Stderr = os.Stderr
	if err := mark.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "docs mark:", step, err)
		if exit, ok := err.(*exec.ExitError); ok {
			os.Exit(exit.ExitCode())
		}
		os.Exit(70)
	}
}

// docsError is an error as a recording stores it: nil, or its message.
func docsError(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}
`

/** Insert a mark after each step's statement. Marked lines end in \`// docs:mark\`, so a copy of the program without them is the displayed program. */
export function instrumentGo(source, steps) {
  const lines = source.split('\n')
  const inserts = steps.map((step) => {
    const range = statementLines(source, step.anchor)
    if (!range) throw new Error(`${step.id}: the anchor ${JSON.stringify(step.anchor)} is not on exactly one line of the program`)
    const indent = /^\s*/.exec(lines[range[0] - 1])[0]
    return { after: range[1], text: `${indent}docsMark(${JSON.stringify(step.id)}, ${step.value}) // docs:mark` }
  })
  for (const { after, text } of inserts.toSorted((a, b) => b.after - a.after)) lines.splice(after, 0, text)
  return lines.join('\n')
}

/** The program as displayed, from an instrumented copy of it. */
export const withoutMarks = (source) => source.split('\n').filter((line) => !line.endsWith('// docs:mark')).join('\n')

export const RECIPES = {
  go: {
    capability: 'typed-graph',
    /** The step map is a person's, not generated from the program. */
    stepMap: 'hand-written',
    file: 'quickstart.go',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh'],
    /** Every libtmux-go command begins with a guard that fails if the daemon was replaced since it was checked. */
    fence: (command) => command[0] === 'if-shell' && command.some((word) => word.startsWith('__libtmux_daemon_replaced_')),
    /** What the library asks tmux about itself before it sends a command: `tmux -V`, and a `run-shell -C` that expands the daemon's identity. */
    probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-')))),
    helper: { file: 'docs_mark.go', source: GO_HELPER },
    instrument: instrumentGo,
    // In the order the calls run, which is not the order of their lines: the deferred Kill is above Run in the source.
    steps: [
      { id: 'new-server', label: 'tmux.NewServer', anchor: 'tmux.NewServer(', type: 'tmux.Server', value: 'map[string]any{"socketPath": server.SocketPath(), "configFile": server.ConfigFile(), "executable": server.Executable()}' },
      { id: 'new-session', label: 'Server.NewSession', anchor: 'server.NewSession(', type: 'tmux.Session', value: 'func() any { name, _ := session.Name(); return map[string]any{"id": session.ID(), "name": name} }()' },
      { id: 'run', label: 'Session.Run', anchor: 'session.Run(', type: 'tmux.RunResult', value: 'result' },
      { id: 'kill', label: 'Server.Kill', anchor: 'server.Kill(', type: 'error', value: 'docsError(err)' },
    ],
  },
}
