---
port: lua
route: guides/attaching-to-tmux
title: Attaching to tmux
description: Connect to an existing tmux server and find a session with Lua.
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
`tmux attach-session`; the [shared guide](../../../../tmux/guides/attaching-to-tmux/) covers
interactive attachment and detaching.

<a id="which-socket-a-bare-constructor-reaches"></a>

## Connect to an existing server

Save the complete program as `connect.lua`. `LIBTMUX_SOCKET_PATH` selects
the existing server. The launcher below supplies a private socket for trying
the example.

```lua title="connect.lua"
local adapter = require("libtmux.runtime.luv")

local function must(value, err)
    if err ~= nil then error(tostring(err), 0) end
    return value
end

local socket = assert(os.getenv("LIBTMUX_SOCKET_PATH"), "set LIBTMUX_SOCKET_PATH")
local binary = assert(os.getenv("TMUX_BIN"), "set TMUX_BIN to the absolute tmux path")

must(adapter.run(function(runtime)
    local server = must(runtime:connect({ binary = binary, socket_path = socket }):await())
    local snapshot, capture_error = server:snapshot({ strict = true }):await()
    local closed, close_error = server:close():await()
    must(snapshot, capture_error)
    must(closed, close_error)
    for _, session in ipairs(snapshot.sessions) do
        if session.name == "work" then
            print("work")
            return true
        end
    end
    error("The work session does not exist", 0)
end))
```

## Setup and run

Use an empty directory on Linux with Git and tmux 3.2a or newer installed.

This example was checked with Lua 5.5.1, luv 1.52.1-0.

Save the launcher as `run.sh`. It starts an isolated tmux server, runs the
program, checks that the session still exists, then stops only that server.
Cleanup runs after failures too. A failed shutdown keeps its socket directory
and prints its location for inspection.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
directory=$(mktemp -d "${TMPDIR:-/tmp}/libtmux-lua-attach.XXXXXX")
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
$ git clone https://github.com/libtmux/libtmux-lua libtmux-source &&
  git -C libtmux-source checkout 5baa3f9b830ebdbc76fb50b5b3d7a5ad3f76d443 &&
  luarocks --tree ./rocks install luv 1.52.1-0 &&
  (cd libtmux-source &&
    luarocks --tree ../rocks make rockspecs/libtmux-scm-1.rockspec) &&
  eval "$(luarocks --tree ./rocks path)" &&
  sh run.sh lua connect.lua
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket and run the program without the launcher.
Also set `TMUX_BIN` to the absolute path of the tmux executable.
The launcher is responsible for the demonstration server's lifetime.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/).
