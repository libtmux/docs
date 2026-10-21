---
port: go
route: examples/attach-and-send-keys
title: Attach and send keys
description: Build a Go program that creates a session, sends a command to a pane, and reads the output.
sidebar:
  label: Attach and send keys
  group: Examples
  order: 2
tableOfContents: true
---

Create a session, run a command in one of its panes, and read what the pane
prints. These examples use libtmux from your program; to attach your terminal
interactively, see [Attaching to tmux](/guides/attaching-to-tmux/).

The steps below build the program one call at a time. Each block is a range of
lines from [the complete program](#the-complete-program), which includes setup,
error handling, and cleanup. Each step names the tmux command behind the call;
the [native version of this example](/tmux/examples/attach-and-send-keys/) builds
the same sequence in shell. [Source and verification](#where-this-comes-from)
identifies the file and its checks.

## 1. Get a server

Every call that reaches tmux takes a `context.Context`. The program gives the
whole run 30 seconds, so a wait that never matches ends with
`context.DeadlineExceeded` instead of blocking forever. `tmux.NewServer`
validates a `tmux.ServerOptions` and does not start tmux.
`ServerOptions.SocketName` selects a named socket, like `-L`, and
`ServerOptions.ConfigFile` set to `os.DevNull` keeps your tmux configuration
file out, like `-f /dev/null`. The program neither touches nor is changed by
the tmux you already use. The native step is
[Choose a private socket](/tmux/examples/attach-and-send-keys/#1-choose-a-private-socket).
The server goes to `run`, so a test can pass in an isolated one.

```go file="examples/pane-io/main.go" from="ctx, cancel := context.WithTimeout" to="return run(ctx, server)"
```

<a id="2-find-or-create-the-session"></a>
<a id="3-add-a-window"></a>

## 2. Create the session

`Server.NewSession` creates a detached session, like `new-session -d`, which
starts the server when the socket has none. `NewSessionRequest.Name`
names the session and `NewSessionRequest.Command` is the program its pane
runs. `sh` keeps the pane from depending on what your login shell does at
startup. The call fails with `ErrSessionExists` when the socket already holds a
session of that name, as after an earlier run that was killed before it cleaned
up, unless `NewSessionRequest.KillExisting` is set. A program that runs
repeatedly should look for its session first;
[Finding an existing session instead](#finding-an-existing-session-instead)
links that pattern.

```go file="examples/pane-io/main.go" from="session, err := server.NewSession" to="=\t}"
```

<a id="4-pick-the-pane"></a>

## 3. Pick the pane

`Session.ResolveActivePane` lists the session's panes, like `list-panes -s`,
and returns the active pane of the active window as a `tmux.Pane`. The program
keeps the pane it found, which carries its pane ID, and never has to address a
pane by position. The native
[pane ID step](/tmux/examples/attach-and-send-keys/#4-find-the-pane-by-its-id)
explains why code addresses a pane by identity.

```go file="examples/pane-io/main.go" from="pane, err := session.ResolveActivePane" to="=\t}"
```

<a id="5-watch-the-panes-output"></a>

## 4. Watch the pane's output

`Pane.OpenObservation` opens a dedicated control-mode client on the pane, which
tmux sees as `attach-session` with `-C`, and captures the pane's visible text
with `capture-pane`. It returns a `tmux.PaneObservation` that begins at that
text, with no gap before the output that follows. The caller must close it,
which the deferred call does. Open it before typing, so no output is missed.

```go file="examples/pane-io/main.go" from="output, err := pane.OpenObservation" to="output.Close()"
```

<a id="6-send-a-command"></a>

## 5. Send a command

`Pane.Writer` returns the pane's keyboard as an `io.Writer`. The bytes are typed
literally and each newline is the Enter key, so `fmt.Fprintln` submits the line.
It costs two commands: `send-keys -l` types the text and a second `send-keys`
presses the Enter key, the pair that the native steps
[Type text without pressing keys](/tmux/examples/attach-and-send-keys/#6-type-text-without-pressing-keys)
and [Press Enter](/tmux/examples/attach-and-send-keys/#7-press-enter) run in
shell.

```go file="examples/pane-io/main.go" from="command :=" to="=\t}"
```

## 6. Wait for the answer

`PaneObservation.WaitFor` reads what the pane writes after the observation
opened and calls the function with all of it each time new output arrives,
until the function returns true, the context ends, or the observation is lost. tmux
pushes each write to the control client as an `%output` notification, so there
is no sleep and no repeated `capture-pane`; the native step
[Poll until the line appears](/tmux/examples/attach-and-send-keys/#9-poll-until-the-line-appears)
repeats the capture instead. The terminal echoes the typed line, and the echo
is pane output like any other. The match is for `6 x 7 = 42`, which only the
computed answer contains: the typed line says `$((6 * 7))`.

```go file="examples/pane-io/main.go" from="output.WaitFor" to="the pane answered"
```

## 7. Read until the line appears

`PaneObservation.Reader` is an `io.Reader` over the same `%output` stream, so a
`bufio` scanner reads the pane line by line, as it would a file. Reads block
until the pane writes, the context ends, or the observation closes. The bytes
are the terminal's: the echo of the typed command arrives first, and a prompt
can share the reply's line. The loop matches how the line ends, and the typed
command, which ends in a quote, cannot match.

```go file="examples/pane-io/main.go" from="next :=" to="read pane"
```

## 8. Clean up

`Session.Kill` destroys the session and its windows, like `kill-session`. The
deferred calls run in reverse order on every return: the observation closes,
then the session is killed. The kill uses a context of its own that the run's
cancellation cannot end, with one second to finish, so a deadline that has
passed does not skip the cleanup, and `errors.Join` reports a cleanup failure
beside the original error. With the default `exit-empty` setting, the private
server exits when its last session is gone.

```go file="examples/pane-io/main.go" from="=\tdefer func() {" to="=\t}()"
```

## The complete program

The steps follow the order a reader meets the calls. In the file, the deferred
session cleanup comes right after the call it undoes. The whole file below is
read from the repository's tested example. From a clone of libtmux-go,
`go -C examples run ./pane-io` runs it, and it prints
`the pane answered 6 x 7 = 42` and then `read the line: streamed 2 lines`.

```go file="examples/pane-io/main.go"
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Where this comes from

**Source:** `examples/pane-io/main.go`

**In this page:** the complete program is read whole from the file, and each
step quotes a range of its lines

**Checked by:** `TestPaneIO` runs the file's `run` function against a real tmux
server on a socket the test harness owns and compares what it prints with the
output recorded beside it. Two more tests in
`examples/pane-io/example_test.go` run it with a slow shell and with a shell
that never answers. The `docs:pane-wait` and `docs:pane-io` regions inside the
file are mirrored into `examples/pane-io/README.md` by `go generate ./tmux`,
and CI fails if the two drift

### Source inclusion

A `file="..."` fence reads the named source during the site build. A fence that
also names `from` and `to` lines quotes only that range, and the build fails if
either line stops resolving.
