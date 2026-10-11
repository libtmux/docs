---
port: julia
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Julia.
sidebar:
  label: Attaching to tmux
  group: Guides
  order: 3
tableOfContents: true
---

Select an explicit socket, capture the existing server, and find the `work`
session. The program prints its name and leaves the server running. A missing
server or session ends the program with an error.

This controls tmux from Julia. To open a session in your terminal, use
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/)
covers interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `connect.jl`. The environment variable
`LIBTMUX_SOCKET_PATH` selects the existing server. The launcher below sets
it to a private socket for trying the example.

```julia title="connect.jl"
using LibTmux

function main()
    server = Server(; socket_path=ENV["LIBTMUX_SOCKET_PATH"])
    captured = snapshot(server)
    session = onlymatch(SessionWhere(; name="work"), sessions(captured))
    println(session.name)
end

main()
```

Constructing [`Server`](../../reference/libtmux-server/) performs no I/O.
[`snapshot`](../../reference/libtmux-snapshot-1gv6/) explicitly reads tmux and
returns captured state. The local
[`SessionWhere`](../../reference/libtmux-sessionwhere/) query filters that
state; [`onlymatch`](../../reference/libtmux-onlymatch/) requires exactly
one result. Reading or filtering captured values does not refresh them.

The server value borrows the daemon. It does not own a process to close, and
the program does not destroy the caller's sessions.

## Setup and run

Use an empty directory on Linux with Julia 1.13, Git, POSIX shell, and tmux
installed. Run the following commands in a POSIX shell. Fetch the library
revision used by this program:

```console
$ git init -q source
$ git -C source fetch -q --depth=1 \
  https://github.com/libtmux/libtmux-julia.git \
  6f62bd72cb8d99f3759ca5e2cc3591165a03c768
$ git -C source checkout -q --detach FETCH_HEAD
```

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-julia-attach.XXXXXX")
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

```console
$ sh run.sh julia --startup-file=no --project=source connect.jl
```

The program prints `work`. To use your own existing server, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
The launcher owns only the demonstration server.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

Reading a session does not reserve its name. If your application creates a
session after an unsuccessful lookup, another client may create the same name
between those operations. Handle the creation error as well as the lookup.

[Captured queries](../../concepts/queries/) explains local selection.
[Capture from an owned server](../../examples/owned-capture/) is a complete
program that creates and stops its own daemon.

The [library source revision](https://github.com/libtmux/libtmux-julia/tree/6f62bd72cb8d99f3759ca5e2cc3591165a03c768)
records the implementation used by this example.
