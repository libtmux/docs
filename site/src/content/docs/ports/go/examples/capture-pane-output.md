---
port: go
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete program that captures a pane and waits for a complete output line.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

A pane runs asynchronously: sending a command does not mean its output is
already on screen. Capture repeatedly until the expected line appears, with a
deadline so a failed command cannot leave the program waiting forever.

This complete program creates a private tmux server, captures its output, and
cleans up. Follow the [setup and run instructions](#setup-and-run) below. You need
tmux and a Unix environment; no existing tmux session is required.

## Read what's on screen

The program sends `printf` with a leading newline, then waits for the complete
line `libtmux capture ready`. The newline keeps a late shell prompt off that
line. Matching the whole line avoids mistaking the echoed command for its output.

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
  defer func() { err = errors.Join(err, os.RemoveAll(directory)) }()
  server, err := tmux.NewServer(tmux.ServerOptions{
    SocketPath: filepath.Join(directory, "tmux.sock"),
    ConfigFile: "/dev/null",
  })
  if err != nil {
    return err
  }
  ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
  defer cancel()
  if _, err = server.NewSession(ctx, tmux.NewSessionRequest{
    Name: "capture", Command: "sh",
    Environment: map[string]string{"ENV": "/dev/null"},
  }); err != nil {
    return err
  }
  defer func() {
    cleanup, stop := context.WithTimeout(context.Background(), time.Second)
    defer stop()
    err = errors.Join(err, server.Kill(cleanup))
  }()
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

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The program above checks the captured screen for up to five seconds. The short
pause between checks limits polling; the observed output determines when the loop
finishes. A tmux capture is a view of the screen and scrollback, so it can miss
output that has already scrolled away. Use a stream or a completion signal for
long-running commands when that distinction matters.

[Capturing output](/guides/capturing-output/) covers capture options, while
[Sending keys](/guides/sending-keys/#the-race-you-cant-see-from-the-call-site)
explains why sending and waiting are separate operations.

## Setup and run

Use an empty directory. The commands pin the library
revision used to verify the program.

Save the program as `main.go` and this file as `go.mod`. Use Go 1.26 or newer.

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
