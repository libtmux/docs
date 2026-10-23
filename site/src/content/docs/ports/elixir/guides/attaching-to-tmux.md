---
port: elixir
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Elixir.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Select an explicit socket, capture the existing server, and find the `work`
session. The program prints its name and leaves the server running. A missing
server or session ends the program with an error.

This controls tmux from Elixir. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/)
covers interactive attachment and detaching.

## Connect to an existing server

Save the complete program as `connect.exs`. The environment variable
`LIBTMUX_SOCKET_PATH` selects the existing server. The launcher below sets it
to a private socket for trying the example. The first line installs the
published alpha from Hex.

```elixir title="connect.exs"
Mix.install([{:libtmux, "== 0.0.1-alpha.1"}])

alias LibTmux.{Selection, Server, Snapshot}

tmux = System.find_executable("tmux") || raise "tmux is not on PATH"
socket = System.fetch_env!("LIBTMUX_SOCKET_PATH")

server = Server.new(executable: tmux, socket: socket)
snapshot = Server.snapshot!(server)
session = snapshot |> Snapshot.sessions() |> Selection.one!(name: "work")
IO.puts(session.name)
```

[`Server.new/1`](../../reference/libtmux-server-new-1/) describes a server that
already exists and performs no I/O. [`Server.snapshot!/2`](../../reference/libtmux-server-snapshot-bang-2/)
reads tmux and returns captured state, or raises the structured capture error.
[`Snapshot.sessions/1`](../../reference/libtmux-snapshot-sessions-1/) selects
sessions from that state without contacting tmux again, and
[`Selection.one!/2`](../../reference/libtmux-selection-one-bang-2/) requires
exactly one match. Reading or filtering captured values does not refresh them.

The server value describes the daemon. It does not own a process to close, and
the program does not destroy the caller's sessions.

## Setup and run

Use an empty directory on Linux with Elixir 1.20.4 or newer on Erlang/OTP 29,
a C11 compiler, tmux 3.3 or newer, a POSIX shell, and access to hex.pm. Save
the launcher as `run.sh`. It starts an isolated tmux server, runs the program,
checks that the session still exists, then stops only that server. Cleanup runs
after failures too. A failed shutdown keeps its socket directory and prints its
location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-elixir-attach.XXXXXX")
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
export LIBTMUX_SOCKET_PATH="$socket"
"$binary" -S "$socket" -f /dev/null new-session -d -s work /bin/cat
"$@"
"$binary" -S "$socket" has-session -t '=work'
```

```console
$ sh run.sh elixir connect.exs
```

The program prints `work`. To use your own existing server, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
The launcher owns only the demonstration server.

## Find or create a session

Reading a session does not reserve its name. If your application creates a
session after an unsuccessful lookup, another client may create the same name
between those operations. Handle the creation error as well as the lookup.

[Mental model](../../concepts/mental-model/) and
[Observations](../../concepts/observations/) explain what a snapshot holds.
[Capture a pane and read it](../../examples/capture-and-read/) is a complete
program that runs against an isolated server.

The [library source revision](https://github.com/libtmux/libtmux-elixir/tree/b72452c198917433229bdc266a68c163541b6127)
records the implementation used by this example.
