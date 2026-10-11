---
port: julia
route: examples/owned-capture
title: Capture a pane
description: Capture a blank pane and verify owned-server cleanup.
sidebar:
  label: Capture a pane
  group: Examples
  order: 2
tableOfContents: true
---

Create a private tmux server, capture the screen of a pane running
`/bin/cat`, and keep the captured snapshot after the server has stopped.

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

Save this complete program as `owned_capture.jl`.

```julia title="owned_capture.jl"
using LibTmux

function main()
    endpoint = Ref{Server}()
    result = with_server(; tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux")) do server
        endpoint[] = server
        new_session(server; name="example", command=["/bin/cat"])
        snap = snapshot(server)
        pane = only(panes(snap))
        screen = capture_pane(server, pane.ref)
        @assert isempty(strip(screen))
        @assert only(sessions(snap)).name == "example"
        println("Captured ", string(pane.id), ": ", ncodeunits(screen), " screen bytes")
        (; snap, screen)
    end
    @assert !ispath(dirname(endpoint[].socket_path))
    @assert length(panes(result.snap)) == 1
    result
end

main()
```

`with_server` owns the daemon and its temporary socket directory. The
program asserts that the directory is gone after the block returns and that
the captured snapshot still contains its pane.

The pane has no text. Its captured screen contains blank lines, so the byte
count depends on its height; [`strip(screen)`](https://docs.julialang.org/en/v1/base/strings/#Base.strip) is empty.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ julia --startup-file=no --project=source owned_capture.jl
```

Expected output:

```text
Captured %0: 24 screen bytes
```

## Related APIs

- [`with_server`](../../reference/libtmux-with_server/)
- [`snapshot`](../../reference/libtmux-snapshot-1gv6/)
- [`capture_pane`](../../reference/libtmux-capture_pane/)

## Source and verification

The complete program comes from [examples/owned_capture.jl](https://github.com/libtmux/libtmux-julia/blob/6f62bd72cb8d99f3759ca5e2cc3591165a03c768/examples/owned_capture.jl).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
