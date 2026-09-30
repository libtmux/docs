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
The program prints its name and leaves the tmux server running. It reports an
error if the connection fails or the session is absent.

This controls tmux from your program. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `main.go`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```go title="main.go"
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/libtmux/libtmux-go/tmux"
)

func main() {
	socket := os.Getenv("LIBTMUX_SOCKET_PATH")
	if socket == "" {
		log.Fatal("Set LIBTMUX_SOCKET_PATH to an existing socket")
	}
	server, err := tmux.NewServer(tmux.ServerOptions{SocketPath: socket})
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	filter := tmux.TmuxFilter("#{==:#{session_name},work}")
	sessions, err := server.SearchSessions(ctx, &filter)
	if err != nil {
		log.Fatal(err)
	}
	if len(sessions) != 1 {
		log.Fatalf("Expected one work session, found %d", len(sessions))
	}
	fmt.Println("work")
}
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Go 1.26.8.

Save this file beside the program using the displayed filename.

```text title="go.mod"
module example.com/connect

go 1.26.0

require github.com/libtmux/libtmux-go v0.0.0

replace github.com/libtmux/libtmux-go => ./libtmux
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-go-attach.XXXXXX")
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ] && ! "$binary" -S "$socket" kill-server; then
        printf 'Cannot stop tmux; kept %s\n' "$directory" >&2
        exit 1
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

unset TMUX TMUX_PANE
export LIBTMUX_SOCKET_PATH="$socket" TMUX_BIN="$binary"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

Fetch the verified library revision, build, and run:

```console
$ git clone https://github.com/libtmux/libtmux-go libtmux &&
  git -C libtmux checkout bb06e26e116e941813ca40bf45e7e3a47d38f52a &&
  GOWORK=off go mod tidy &&
  sh run.sh env GOWORK=off go run .
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
That launcher is responsible for the demonstration server's lifetime.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/). Continue with
[Sending keys](/guides/sending-keys/) once you have a pane handle.
