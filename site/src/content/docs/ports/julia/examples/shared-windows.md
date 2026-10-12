---
port: julia
route: examples/shared-windows
title: Query shared windows
description: Distinguish windows, session links, and pane occurrences.
sidebar:
  label: Query shared windows
  group: Examples
  order: 3
tableOfContents: true
---

Link the same window into two sessions and query the captured relationships.
The assertions distinguish unique windows and panes from their appearances in
each session.

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

Save this complete program as `shared_windows.jl`.

```julia title="shared_windows.jl"
using LibTmux
import LibTmux.Filters as F

function main()
    snap = with_server(; tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux")) do server
        dev = new_session(server; name="dev", command=["/bin/cat"])
        initial = snapshot(server)
        api = only(windows(initial)).ref
        rename_window(server, api, "api")
        split_window(server, only(panes(initial)).ref; command=["/bin/cat"])
        new_window(server, dev; name="build", command=["/bin/cat"])

        ops = new_session(server; name="ops", command=["/bin/cat"])
        captured = snapshot(server)
        placeholder =
            only(windows(onlymatch(SessionWhere(name="ops"), sessions(captured)))).ref
        source = onlymatch(
            WindowLinkWhere(window=WindowWhere(name="api")),
            windowlinks(captured),
        )
        link_window(server, WindowLinkRef(source), ops; index=4)
        kill_window(server, placeholder)
        snapshot(server)
    end

    @assert length(sessions(snap)) == 2
    @assert length(windows(snap)) == 2
    @assert length(windowlinks(snap)) == 3
    @assert length(panes(snap)) == 3
    @assert length(paneoccurrences(snap)) == 5

    # Captured relations remain usable after the owned daemon has stopped.
    has_api = SessionWhere(windows=F.AnyRelated(WindowWhere(name="api")))
    @assert count(has_api, sessions(snap)) == 2
    selected = filter(PaneWhere(active=true, window=WindowWhere(name="api")), panes(snap))
    @assert length(selected) == 1
    @assert only(selected).ref ==
            only(Iterators.filter(p -> p.active && p.window.name == "api", panes(snap))).ref
    println("2 sessions, 2 windows, 3 links, 3 panes, 5 occurrences")
    snap
end

main()
```

The `api` window has two panes and is linked into both `dev` and `ops`.
The `build` window has one pane and belongs only to `dev`. This gives two
unique windows, three window links, three unique panes, and five pane
occurrences.

The server is already stopped when the queries run. Captured relations remain
usable without contacting tmux. The program also checks that a declarative
pane filter selects the same reference as a Julia iterator filter.

## Run

```console
$ unset TMUX TMUX_PANE
$ export ENV=/dev/null BASH_ENV=/dev/null SHELL=/bin/sh
$ julia --startup-file=no --project=source shared_windows.jl
```

Expected output:

```text
2 sessions, 2 windows, 3 links, 3 panes, 5 occurrences
```

## Related APIs

- [`WindowLinkWhere`](../../reference/libtmux-windowlinkwhere/)
- [`paneoccurrences`](../../reference/libtmux-paneoccurrences/)
- [Query captured state](../../concepts/queries/)

## Source and verification

The complete program comes from [examples/shared_windows.jl](https://github.com/libtmux/libtmux-julia/blob/6f62bd72cb8d99f3759ca5e2cc3591165a03c768/examples/shared_windows.jl).
The verification runner executes these displayed files and setup commands
unchanged, checks the output, and checks that the program stopped its private
tmux server. Each example runs independently.
