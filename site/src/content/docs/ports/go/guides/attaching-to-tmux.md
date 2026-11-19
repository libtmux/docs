---
port: go
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Go.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Connect a `Server` to an explicit socket and find the existing `work` session.
The program prints its name and leaves that server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `main.go`. `LIBTMUX_SOCKET_PATH` selects the
existing server: `findWork` connects a new `Server` to that socket, prints the
`work` session and leaves the tmux server running.

Without the variable, the program starts a demonstration server to stand in
for yours. `startDemonstration` creates a `work` session on a socket in a new
temporary directory. `run` stops that server and removes the directory when it
returns, including after an error. If tmux does not stop, the error names the
directory the program kept.

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

const limit = 5 * time.Second

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() (err error) {
	socket := os.Getenv("LIBTMUX_SOCKET_PATH")
	if socket == "" {
		var stop func() error
		if socket, stop, err = startDemonstration(); err != nil {
			return err
		}
		defer func() { err = errors.Join(err, stop()) }()
	}
	return findWork(socket)
}

func findWork(socket string) error {
	server, err := tmux.NewServer(tmux.ServerOptions{SocketPath: socket})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	filter := tmux.TmuxFilter("#{==:#{session_name},work}")
	sessions, err := server.SearchSessions(ctx, &filter)
	if err != nil {
		return err
	}
	if len(sessions) != 1 {
		return fmt.Errorf("found %d work sessions", len(sessions))
	}
	fmt.Println("work")
	return nil
}

func startDemonstration() (socket string, stop func() error, err error) {
	directory, err := os.MkdirTemp("", "libtmux-attach-")
	if err != nil {
		return "", nil, err
	}
	socket = filepath.Join(directory, "tmux.sock")
	owner, err := tmux.NewServer(tmux.ServerOptions{
		SocketPath: socket, ConfigFile: "/dev/null",
	})
	if err != nil {
		return "", nil, errors.Join(err, os.RemoveAll(directory))
	}
	stop = func() error {
		ctx, cancel := context.WithTimeout(context.Background(), limit)
		defer cancel()
		if err := owner.Kill(ctx); err != nil {
			return fmt.Errorf(
				"cannot stop tmux; kept %s: %w", directory, err,
			)
		}
		return os.RemoveAll(directory)
	}
	ctx, cancel := context.WithTimeout(context.Background(), limit)
	defer cancel()
	_, err = owner.NewSession(ctx, tmux.NewSessionRequest{
		Name: "work", Command: "cat",
	})
	if err != nil {
		return "", nil, errors.Join(err, stop())
	}
	return socket, stop, nil
}
```

## Setup and run

Use an empty directory on Linux with Go 1.26 or newer and tmux 3.3a or newer
installed.

Save this file beside the program using the displayed filename. It requires
`libtmux-go` v0.1.3 ([source](https://github.com/libtmux/libtmux-go/tree/7ad2bfb0f74c02d395fec1962d5bb9556e2200cd)).

```gomod title="go.mod"
module example.com/connect

go 1.26.0

require github.com/libtmux/libtmux-go v0.1.3
```

Resolve the module, build, and run:

```console
$ go mod tidy &&
  go run .
```

The program prints `work`. To attach to a server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket path in the environment of `go run .`. The
program then starts no server and leaves yours running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a program that sends input and captures output, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
