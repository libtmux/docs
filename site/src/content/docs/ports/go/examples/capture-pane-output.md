---
port: go
route: examples/capture-pane-output
title: Capture pane output
description: Build a Go program that sends a command to a pane and captures its screen until a complete line appears.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

The steps below build `main.go` one call at a time. Each block is a range of
lines from [the complete program](#the-complete-program), which creates a
private tmux server, captures its output, and cleans up. Each step names the
tmux command behind the call, which the [native version of this
example](/tmux/examples/capture-pane-output/) builds in shell. Follow the [setup and
run instructions](#setup-and-run) below. You need tmux and a Unix environment;
no existing tmux session is required.

## 1. Get a private server

`tmux.NewServer` validates a `tmux.ServerOptions` and does not start tmux.
`ServerOptions.SocketPath` selects the socket, like `-S`, and
`ServerOptions.ConfigFile` set to `/dev/null` keeps your tmux configuration
file out, like `-f /dev/null`. If the call fails, the program removes the
directory it just made.

```go excerpt="main.go" from="os.MkdirTemp" to="=  })"
```

## 2. Bound the run

Every call takes a `context.Context`. This deadline also ends the capture loop
in step 8, so a command that never prints fails the program after five seconds.

```go excerpt="main.go" from="ctx, cancel :=" to="defer cancel()"
```

## 3. Create the session

`Server.NewSession` creates a detached session, like `new-session -d`, and the
first command to reach the socket starts the server. `tmux.NewSessionRequest`
carries the session name and the command its pane runs. Its
`NewSessionRequest.Environment` entry `ENV=/dev/null` keeps `sh` from loading
a startup file, like `-e ENV=/dev/null`.

```go excerpt="main.go" from="server.NewSession" to="=  }"
```

## 4. Pick the pane

`Server.Panes` lists every pane on the server. A private server holds only the
session from step 3, so the first pane is its pane. On a shared server, list
through the session instead, with `Session.Panes`. The native
[pane ID step](/tmux/examples/attach-and-send-keys/#4-find-the-pane-by-its-id)
explains why code addresses a pane by identity and not by position.

```go excerpt="main.go" from="panes, err := server.Panes" to="pane := panes[0]"
```

## 5. Send the command

`Pane.SendKeys` runs `send-keys` and then sends the Enter key, so the shell
runs the text. `tmux.SendKeysRequest` takes the text as
`SendKeysRequest.Command`, a pointer because nil means no operand. Set
`SendKeysRequest.SkipEnter` to type without submitting, or
`SendKeysRequest.Literal` to turn off key-name lookup. The leading `\n` in the
`printf` format puts the output on a fresh row.

```go excerpt="main.go" from="command :=" to="=  }"
```

<a id="read-whats-on-screen"></a>

## 6. Capture the screen

`Pane.Capture` runs `capture-pane` and returns the printed rows as strings. A
zero `tmux.CapturePaneRequest` captures the visible screen with tmux's default
text handling.

```go excerpt="main.go" from="lines, err := pane.Capture" to="=    }"
```

## 7. Match a complete line

The program accepts only a row equal to `libtmux capture ready`. Matching the
whole line keeps the echoed `printf` command from satisfying the check.

```go excerpt="main.go" from="for _, line := range lines" to="=    }"
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>
<a id="wait-for-output-or-completion"></a>

## 8. Wait, then capture again

The shell may not have run the command yet, so the loop pauses and captures
again until the deadline from step 2 ends it. The short pause limits polling;
the observed output, not a fixed delay, decides when the program finishes. A
capture is a view of the screen and scrollback, so it can miss output that has
already scrolled away. [Capturing output](/guides/capturing-output/) covers
capture options, and
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

```go excerpt="main.go" from="select {" to="=    }"
```

## 9. Clean up

`Server.Kill` stops the server and every session on it. The program registers
this `defer` right after step 1, so it runs on every return below it, with its
own one-second context in case the run's deadline has passed. If tmux cannot
be stopped, the error reports the retained socket path so the server remains
reachable. Otherwise the program removes the directory.

```go excerpt="main.go" from="defer func() {" to="=  }()"
```

## The complete program

In the file, step 9's `defer` comes before step 2 so that it covers every call
after it. Save the program as `main.go`:

```go title="main.go"
package main

import (
  "context"
  "errors"
  "fmt"
  "log"
  "os"
  "path/filepath"
  "time"

  "github.com/libtmux/libtmux-go/tmux"
)

func main() {
  if err := capture(); err != nil {
    log.Fatal(err)
  }
}

func capture() (err error) {
  directory, err := os.MkdirTemp("", "libtmux-capture-")
  if err != nil {
    return err
  }
  server, err := tmux.NewServer(tmux.ServerOptions{
    SocketPath: filepath.Join(directory, "tmux.sock"),
    ConfigFile: "/dev/null",
  })
  if err != nil {
    return errors.Join(err, os.RemoveAll(directory))
  }
  defer func() {
    cleanup, stop := context.WithTimeout(context.Background(), time.Second)
    defer stop()
    if cleanupErr := server.Kill(cleanup); cleanupErr != nil {
      err = errors.Join(err, fmt.Errorf("stop private server at %s: %w",
        filepath.Join(directory, "tmux.sock"), cleanupErr))
      return
    }
    err = errors.Join(err, os.RemoveAll(directory))
  }()
  ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
  defer cancel()
  if _, err = server.NewSession(ctx, tmux.NewSessionRequest{
    Name: "capture", Command: "sh",
    Environment: map[string]string{"ENV": "/dev/null"},
  }); err != nil {
    return err
  }
  panes, err := server.Panes(ctx)
  if err != nil {
    return err
  }
  if len(panes) == 0 {
    return errors.New("the session has no pane")
  }
  pane := panes[0]
  command := "printf '\\nlibtmux capture ready\\n'"
  if err := pane.SendKeys(ctx, tmux.SendKeysRequest{Command: &command}); err != nil {
    return err
  }
  for {
    lines, err := pane.Capture(ctx, tmux.CapturePaneRequest{})
    if err != nil {
      return err
    }
    for _, line := range lines {
      if line == "libtmux capture ready" {
        fmt.Println(line)
        return nil
      }
    }
    select {
    case <-ctx.Done():
      return ctx.Err()
    case <-time.After(20 * time.Millisecond):
    }
  }
}
```

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program and module file using the displayed names. Use Go 1.26 or newer.

```text title="go.mod"
module example.com/capture

go 1.26.0

require github.com/libtmux/libtmux-go v0.0.0

replace github.com/libtmux/libtmux-go => ./libtmux
```

```console
$ git clone https://github.com/libtmux/libtmux-go libtmux &&
  git -C libtmux checkout bb06e26e116e941813ca40bf45e7e3a47d38f52a &&
  GOWORK=off go mod tidy &&
  GOWORK=off go run .
```

<a id="source-inclusion"></a>

## Where this comes from

This complete program was run against the library revision pinned above.
The displayed code is checked against the bytes from that run.
