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
the [native version of this example](/examples/attach-and-send-keys/) builds
the same sequence in shell. [Source and verification](#where-this-comes-from)
identifies the file and its checks.

## 1. Get a server

`tmux.NewServer` validates a `tmux.ServerOptions` and does not start tmux. Empty
options select the tmux server your environment points at, so this program
creates a session on it and kills only that session. To keep a program off your
own server, give `ServerOptions.SocketPath` a path of its own, as the
[capture example](/examples/capture-pane-output/#1-get-a-private-server) does.
The server goes to `run`, so a test can pass in an isolated one.

```go file="examples/quickstart/main.go" from="server, err := tmux.NewServer" to="return run(ctx, server)"
```

## 2. Find or create the session

`Server.NewSession` creates a detached session, like `new-session -d`. It
returns a `tmux.Session` handle, and `NewSessionRequest.WindowName` names its
first window. A program that runs repeatedly should look for its session first;
[Finding an existing session instead](#finding-an-existing-session-instead)
links that pattern.

```go file="examples/quickstart/main.go" from="session, err := server.NewSession" to="=\t}"
```

## 3. Add a window

`Session.NewWindow` runs `new-window` in the session, and
`NewWindowRequest.Name` names it. The returned `tmux.Window` is a handle to
the window you created.

```go file="examples/quickstart/main.go" from="window, err := session.NewWindow" to="=\t}"
```

## 4. Pick the pane

`Window.SplitPane` runs `split-window` and returns the new `tmux.Pane`, so the
program keeps the pane it made and never has to look one up by position.
`SplitPaneRequest.Command` is the program the pane runs.

```go file="examples/quickstart/main.go" from="pane, err := window.SplitPane" to="=\t}"
```

## 5. Watch the pane's output

`Pane.OpenObservation` opens a dedicated control-mode client on the pane. It
returns a `tmux.PaneObservation` that begins at the pane's visible text, with
no gap before the output that follows. The caller must close it, which the
deferred call does.

```go file="examples/quickstart/main.go" from="output, err := pane.OpenObservation" to="output.Close()"
```

## 6. Send a command

`Pane.Writer` returns the pane's keyboard as an `io.Writer`. The bytes are typed
literally and each newline is the Enter key, so `fmt.Fprintln` submits the line
like `send-keys` followed by the `Enter` key. Open the observation first, as
the program does, so the output cannot arrive before the program is watching.

```go file="examples/quickstart/main.go" from="fmt.Fprintln(pane.Writer(ctx)" to="=\t}"
```

## 7. Read until the line appears

`PaneObservation.Reader` is a byte stream of what the pane prints. Reads block
until the pane writes, the context ends, or the observation closes, so the
loop needs no sleep. It stops at the first row equal to `libtmux ready`, which
the echoed command cannot match.

```go file="examples/quickstart/main.go" from="scanner := bufio.NewScanner" to="read pane"
```

## 8. Clean up

`Session.Kill` destroys the session and its windows, like `kill-session`. The
deferred call runs on every return below it. It uses a context of its own that
the run's cancellation cannot end, so a deadline that has passed does not skip
the cleanup, and `errors.Join` reports a cleanup failure beside the original
error.

```go file="examples/quickstart/main.go" from="=\tdefer func() {" to="=\t}()"
```

## The complete program

The steps follow the order a reader meets the calls. In the file, the deferred
cleanup comes right after the call it undoes. The whole file below is read from
the repository's tested example.

```go file="examples/quickstart/main.go"
```

## Finding an existing session instead

For a script that runs repeatedly, look up a session before creating it.
[Attaching to
tmux](/guides/attaching-to-tmux/#finding-a-session-instead-of-always-creating-one)
shows that pattern, and [Filtering and querying, in
practice](/guides/querying-and-filtering/) covers absent and ambiguous matches.

## Where this comes from

**Source:** `examples/quickstart/main.go`

**In this page:** the complete program is read whole from the file, and each
step quotes a range of its lines

**Checked by:** the whole file runs against a real tmux server as
`TestQuickstart`; the `docs:quickstart` region inside it is additionally
mirrored into README.md by `go generate ./tmux`, and CI fails if the two drift

### Source inclusion

A `file="..."` fence reads the named source during the site build. A fence that
also names `from` and `to` lines quotes only that range, and the build fails if
either line stops resolving.
