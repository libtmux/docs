---
port: julia
route: examples/cancel-control-wait
title: Cancel a control wait
description: Cancel a control signal wait without closing its connection.
sidebar:
  label: Cancel a control wait
  group: Examples
  order: 4
tableOfContents: true
---

Cancel a control signal wait and check that the connection remains
open. Leaving the ownership blocks then closes the control clients and the
private tmux server.

## Setup

Julia 1.13.0, Git, POSIX shell and tmux on Linux. Start in an empty directory.
The following commands run in a POSIX shell.

Fetch the library revision used by this program.

```console
$ git init -q source
$ git -C source fetch -q --depth=1 \
  https://github.com/libtmux/libtmux-julia.git \
  6f62bd72cb8d99f3759ca5e2cc3591165a03c768
$ git -C source checkout -q --detach FETCH_HEAD
```

## Program

Save this complete program as `control_cancel.jl`.

```julia title="control_cancel.jl"
using LibTmux

function main()
    with_server(; tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux")) do server
        session = new_session(server; name="control", command=["/bin/cat"])
        open_control(server, session) do connection
            signal = control_signal(connection)
            token = CancellationToken()
            waiting = Threads.@spawn try
                wait(signal; cancel=token)
            catch error
                error
            end
            cancel!(token)
            @assert fetch(waiting) isa RequestCancelled
            @assert isopen(connection)
        end
        @assert isempty(clients(snapshot(server)))
    end
    println("Cancelled the wait and closed both owned control clients")
end

main()
```

The task catches its cancellation error so the caller can assert that it is
`RequestCancelled`. Cancelling the wait does not close the connection.
After `open_control` returns, the snapshot must contain no attached clients;
`with_server` then stops the daemon.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ julia --startup-file=no --project=source control_cancel.jl
```

Expected output:

```text
Cancelled the wait and closed both owned control clients
```

## Related APIs

- [`open_control`](../../reference/libtmux-open_control/)
- [`CancellationToken`](../../reference/libtmux-cancellationtoken/)
- [`cancel!`](../../reference/libtmux-cancel/)
- [Ownership](../../topics/ownership/)

## Source and verification

The complete program comes from [examples/control_cancel.jl](https://github.com/libtmux/libtmux-julia/blob/6f62bd72cb8d99f3759ca5e2cc3591165a03c768/examples/control_cancel.jl).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
