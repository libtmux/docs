import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { statementLines } from '../../../site/src/lib/core-statement.ts'
import { capabilitySource, checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Go's programs are recorded, one recipe per capability: the calls to
 * mark, what to build, and how libtmux-go's own tmux preamble is recognised.
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

/** A control-mode notification as a recording stores it: its kind, and a subscription's name and value. */
const GO_NOTIFICATION_HELPER = `package main

import "github.com/libtmux/libtmux-go/tmux"

// docsNotification is a control-mode notification as a recording stores it.
func docsNotification(notification tmux.ControlNotification) any {
	value := map[string]any{"kind": notification.Kind()}
	if change, ok := notification.Subscription(); ok {
		value["subscription"] = map[string]any{"name": change.Name, "value": change.Value}
	}
	return value
}
`

/**
 * Insert a mark after each step's statement. A statement that opens a block
 * (`if _, err := ...; err != nil {`) is marked after the block closes, where
 * the mark runs only when the call succeeded.
 */
export function instrumentGo(source, steps) {
  const lines = source.split('\n')
  const closed = steps.map((step) => {
    const range = statementLines(source, step.anchor, '//', step.occurrence)
    if (!range || !lines[range[1] - 1].trimEnd().endsWith('{')) return step
    const indent = /^\s*/.exec(lines[range[0] - 1])[0]
    const close = lines.findIndex((line, index) => index >= range[1] && line === `${indent}}`)
    if (close < 0) throw new Error(`${step.id}: the block the call opens is not closed at its own indentation`)
    return { ...step, after: close + 1 }
  })
  return instrumentLines(source, closed, (step) => `docsMark(${JSON.stringify(step.id)}, ${step.value}) // docs:mark`)
}

const DEVICES = ['exact', 'marked']

/** What every Go recipe shares: the toolchain, the build against the checkout, and libtmux-go's tmux preamble. */
const GO = {
  stepMap: 'hand-written',
  /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
  paneCommands: ['sh'],
  /** Every libtmux-go command begins with a guard that fails if the daemon was replaced since it was checked. */
  fence: (command) => command[0] === 'if-shell' && command.some((word) => word.startsWith('__libtmux_daemon_replaced_')),
  /** What the library asks tmux about itself before it sends a command: `tmux -V`, and a `run-shell -C` that expands the daemon's identity. */
  probe: ({ flags, commands }) => (commands.length === 0 && flags.includes('-V')) || (commands.length > 0 && commands.every((command) => command[0] === 'run-shell' && command.some((word) => word.startsWith('libtmux-version-')))),
  checkout: (port, env, expand) => checkoutOf(port, env, expand),
  instrument: instrumentGo,
  command: (dir) => [join(dir, 'program')],
  toolchain: () => ({ go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim().split(' ')[2] }),
  /** Write the displayed and the marked copy as modules that use the checkout, and build both. */
  build({ sandbox, checkout, code, marked, helpers }) {
    const goMod = `module example.com/libtmux-home\n\ngo 1.26.0\n\nrequire github.com/libtmux/libtmux-go v0.1.0\n\nreplace github.com/libtmux/libtmux-go => ${checkout}\n`
    const build = { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOWORK: 'off' }
    for (const [dir, source] of [['exact', code], ['marked', marked]]) {
      mkdirSync(join(sandbox, dir), { recursive: true })
      writeFileSync(join(sandbox, dir, 'go.mod'), goMod)
      writeFileSync(join(sandbox, dir, this.file), source)
    }
    for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
    for (const dir of DEVICES) execFileSync('go', ['build', '-p', '2', '-o', join(sandbox, dir, 'program'), '.'], { cwd: join(sandbox, dir), env: build, stdio: 'inherit' })
  },
}

const SERVER = 'map[string]any{"socketPath": server.SocketPath(), "configFile": server.ConfigFile(), "executable": server.Executable()}'
const SESSION = 'func() any { name, _ := session.Name(); return map[string]any{"id": session.ID(), "name": name} }()'

/** One recipe per capability of the landing page that Go plays. */
export const RECIPES = {
  'typed-graph': {
    ...GO,
    capability: 'typed-graph',
    file: 'quickstart.go',
    source: (root) => quickstartSource(root, 'go', 'quickstart.go'),
    helpers: [{ file: 'docs_mark.go', source: GO_HELPER }],
    // In the order the calls run, which is not the order of their lines: the deferred Kill is above Run in the source.
    steps: [
      { id: 'new-server', label: 'tmux.NewServer', anchor: 'tmux.NewServer(', type: 'tmux.Server', value: SERVER },
      { id: 'new-session', label: 'Server.NewSession', anchor: 'server.NewSession(', type: 'tmux.Session', value: SESSION },
      { id: 'run', label: 'Session.Run', anchor: 'session.Run(', type: 'tmux.RunResult', value: 'result' },
      { id: 'kill', label: 'Server.Kill', anchor: 'server.Kill(', type: 'error', value: 'docsError(err)' },
    ],
  },
  'run-applications': {
    ...GO,
    capability: 'run-applications',
    file: 'main.go',
    source: (root) => capabilitySource(root, 'go', 'examples/run-to-completion/main.go'),
    helpers: [{ file: 'docs_mark.go', source: GO_HELPER }],
    steps: [
      { id: 'new-server', label: 'tmux.NewServer', anchor: 'tmux.NewServer(', type: 'tmux.Server', value: SERVER },
      { id: 'new-session', label: 'Server.NewSession', anchor: 'server.NewSession(', type: 'tmux.Session', value: SESSION },
      { id: 'run', label: 'Session.Run', anchor: 'session.Run(', type: 'tmux.RunResult', value: 'result' },
      { id: 'start', label: 'Session.Start', anchor: 'session.Start(', type: '*tmux.Running', value: 'map[string]any{"pane": running.Pane().ID()}' },
      { id: 'stream', label: 'Running.StreamTo', anchor: 'running.StreamTo(', type: 'tmux.RunResult', value: 'streamed' },
      { id: 'kill', label: 'Session.Kill', anchor: 'session.Kill(', type: 'error', value: 'docsError(err)' },
    ],
  },
  watch: {
    ...GO,
    capability: 'watch',
    file: 'main.go',
    source: (root) => capabilitySource(root, 'go', 'examples/control-mode-subscribe/main.go'),
    helpers: [{ file: 'docs_mark.go', source: GO_HELPER }, { file: 'docs_notification.go', source: GO_NOTIFICATION_HELPER }],
    steps: [
      { id: 'new-server', label: 'tmux.NewServer', anchor: 'tmux.NewServer(', type: 'tmux.Server', value: SERVER },
      { id: 'new-session', label: 'Server.NewSession', anchor: 'server.NewSession(', type: 'tmux.Session', value: SESSION },
      { id: 'open', label: 'Session.OpenNotifications', anchor: 'session.OpenNotifications(', type: '*tmux.NotificationStream', value: 'map[string]any{"session": session.ID()}' },
      { id: 'rename', label: 'Session.Rename', anchor: 'session.Rename(', type: 'error', value: 'nil' },
      { id: 'next', label: 'NotificationStream.Next', anchor: 'stream.Next(ctx)', occurrence: 1, type: 'tmux.ControlNotification', value: 'docsNotification(notification)', repeat: true },
      { id: 'subscribe', label: 'NotificationStream.Subscribe', anchor: 'stream.Subscribe(', type: 'error', value: 'nil' },
      { id: 'new-window', label: 'Session.NewWindow', anchor: 'session.NewWindow(', type: 'error', value: 'nil' },
      { id: 'next-change', label: 'NotificationStream.Next', anchor: 'stream.Next(ctx)', occurrence: 2, type: 'tmux.ControlNotification', value: 'docsNotification(notification)', repeat: true },
      { id: 'kill', label: 'Session.Kill', anchor: 'session.Kill(', type: 'error', value: 'docsError(err)' },
    ],
  },
}
