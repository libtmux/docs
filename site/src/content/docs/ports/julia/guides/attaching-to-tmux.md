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
`LIBTMUX_SOCKET_PATH` selects the existing server, and `print_work` connects
to it and finds `work`. Without the variable, the program starts a private
server with [`with_server`](../../reference/libtmux-with_server/), creates
`work` with [`new_session`](../../reference/libtmux-new_session/), and calls
`print_work` with the socket path of that server. `with_server` stops the
private server and removes its socket directory when the block returns or
throws. A failed shutdown throws an error.

```julia title="connect.jl"
using LibTmux

function print_work(socket_path)
    server = Server(; socket_path)
    captured = snapshot(server)
    session = onlymatch(SessionWhere(; name="work"), sessions(captured))
    println(session.name)
end

function main()
    socket_path = get(ENV, "LIBTMUX_SOCKET_PATH", nothing)
    if socket_path === nothing
        with_server() do owner
            new_session(owner; name="work", command=["/bin/cat"])
            print_work(owner.socket_path)
        end
    else
        print_work(socket_path)
    end
end

main()
```

Constructing [`Server`](../../reference/libtmux-server/) performs no I/O.
[`snapshot`](../../reference/libtmux-snapshot-1gv6/) explicitly reads tmux and
returns captured state. The local
[`SessionWhere`](../../reference/libtmux-sessionwhere/) query filters that
state; [`onlymatch`](../../reference/libtmux-onlymatch/) requires exactly
one result. Reading or filtering captured values does not refresh them.

The server value in `print_work` borrows the daemon. It does not own a process
to close, and the program does not destroy the caller's sessions.

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

Run the program:

```console
$ julia --startup-file=no --project=source connect.jl
```

The program prints `work`. To use your own existing server, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; it prints
`work` and leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

Reading a session does not reserve its name. If your application creates a
session after an unsuccessful lookup, another client may create the same name
between those operations. Handle the creation error as well as the lookup.

[Captured queries](../../concepts/queries/) explains local selection.
[Capture from an owned server](../../examples/owned-capture/) is a complete
program that creates and stops its own daemon.
