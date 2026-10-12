---
port: lua
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Lua program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Lua program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux and a Unix environment; no existing session is required.

Save both files shown below. Run `sh run.sh` after the [setup](#setup-and-run);
the launcher creates the server and passes its socket to the Lua program.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```lua title="capture.lua"
local adapter = require("libtmux.runtime.luv")

local function must(value, err)
    if err ~= nil then error(tostring(err), 0) end
    return value
end

local function quote(text)
    return "'" .. text:gsub("'", "'\\''") .. "'"
end

local socket = assert(arg[1], "pass the private socket path")
local binary = assert(arg[2], "pass the absolute tmux executable path")

must(adapter.run(function(runtime)
    local server = must(runtime:connect({
        binary = binary,
        socket_path = socket,
    }):await())
    local created = must(server:new_session({
        name = "capture", argv = { "/bin/sh" },
    }):await())
    local pane = created.pane
    local tmux = quote(binary) .. " -S " .. quote(socket)
    local command = "printf '\\nlibtmux capture ready\\n'; "
        .. tmux .. " wait-for -S capture-ready"
    must(pane:send_text(command):await())
    must(pane:send_keys({ "Enter" }):await())
    local wait = { "wait-for", "capture-ready" }
    must(server:command(wait, { timeout = 5000 }):await())

    local capture = must(pane:capture({ history_lines = 20 }):await())
    local found = false
    for line in must(capture:text()):gmatch("[^\r\n]+") do
        if line == "libtmux capture ready" then found = true end
    end
    assert(found, "The completed command did not produce the expected line")
    print("libtmux capture ready")
    must(server:close():await())
    return true
end))
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The pane prints its line, then signals a tmux `wait-for` channel on the same private socket. The awaited command has a five-second deadline. Capture runs after that signal and checks the complete line. The launcher stops its server on success or failure; if stopping fails, it reports the error and keeps the socket directory.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the files using the displayed names. You need
Lua 5.5, LuaRocks, a C compiler, and CMake. The commands install libtmux and its luv runtime adapter into a local rocks tree.

Save this launcher beside the Lua program.

```sh title="run.sh"
#!/bin/sh
set -eu

binary=$(command -v tmux)
case "$binary" in
    /*) ;;
    *) printf '%s\n' 'tmux must resolve to an absolute path' >&2; exit 1 ;;
esac
mkdir -p /tmp/libtmux-lua-dev
directory=$(mktemp -d /tmp/libtmux-lua-dev/capture.XXXXXX)
socket="$directory/tmux.sock"

cleanup() {
    status=$?
    trap - 0 HUP INT TERM
    if [ -S "$socket" ]; then
        if ! "$binary" -S "$socket" kill-server; then
            printf 'Could not stop server; retained %s\n' "$directory" >&2
            exit 1
        fi
    fi
    rm -rf "$directory" || exit 1
    exit "$status"
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

export ENV=/dev/null
"$binary" -S "$socket" -f /dev/null new-session -d -s bootstrap /bin/cat
lua capture.lua "$socket" "$binary"
```

The commands pin the library revision used to run this program.

```console
$ git clone https://github.com/libtmux/libtmux-lua libtmux-source &&
  git -C libtmux-source checkout 5baa3f9b830ebdbc76fb50b5b3d7a5ad3f76d443 &&
  luarocks --tree ./rocks install luv 1.52.1-0 &&
  (cd libtmux-source &&
    luarocks --tree ../rocks make rockspecs/libtmux-scm-1.rockspec) &&
  eval "$(luarocks --tree ./rocks path)" &&
  sh run.sh
```

<a id="source-inclusion"></a>

## Where this comes from

The displayed files were compiled or loaded with their native tools and run
on Linux with tmux 3.2a and 3.7c. The rendering checks preserve those file bytes.
