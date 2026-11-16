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

Save the complete program as `connect.lua`. `LIBTMUX_SOCKET_PATH` selects the
existing server, and `print_work` connects a `Server` to it and finds `work`.
Without the variable, the program starts a private server of its own in a new
temporary directory, creates `work` with
[`Server:new_session`](../../reference/libtmux-server-new_session/), and
connects a second `Server` to that socket by path. The library connects to a
running server and does not start one, so the program has `tmux` start the
daemon. It stops the private server with
[`Server:command`](../../reference/libtmux-server-command/) and removes the
directory after success or failure. If the server does not stop, the program
reports the error and keeps the directory.

```lua title="connect.lua"
local adapter = require("libtmux.runtime.luv")
local uv = require("luv")

local function must(value, err)
    if err ~= nil then error(tostring(err), 0) end
    return value
end

local binary
for directory in (os.getenv("PATH") or ""):gmatch("[^:]+") do
    local candidate = uv.fs_realpath(directory .. "/tmux")
    if candidate and uv.fs_access(candidate, "X") then
        binary = candidate
        break
    end
end
assert(binary, "tmux must be installed on PATH")

local function connect(runtime, socket)
    local options = { binary = binary, socket_path = socket }
    return must(runtime:connect(options):await())
end

local function print_work(runtime, socket)
    local server = connect(runtime, socket)
    local snapshot, capture_error = server:snapshot({ strict = true }):await()
    local closed, close_error = server:close():await()
    must(snapshot, capture_error)
    must(closed, close_error)
    for _, session in ipairs(snapshot.sessions) do
        if session.name == "work" then
            print("work")
            return
        end
    end
    error("The work session does not exist", 0)
end

local socket = os.getenv("LIBTMUX_SOCKET_PATH")
if socket then
    must(adapter.run(function(runtime)
        print_work(runtime, socket)
        return true
    end))
    return
end

-- No server was named: start one this program owns, in a new directory.
local directory = assert(uv.fs_mkdtemp(
    (os.getenv("TMPDIR") or "/tmp") .. "/libtmux-attach-XXXXXX"))
socket = directory .. "/tmux.sock"

local ok, failure = xpcall(function()
    -- libtmux connects to a running server, so tmux starts the daemon.
    local status
    local process
    process = assert(uv.spawn(binary, {
        args = {
            "-S", socket, "-f", "/dev/null", "start-server", ";",
            "set-option", "-s", "exit-empty", "off",
        },
        stdio = { nil, 1, 2 },
    }, function(code)
        status = code
        process:close()
    end))
    uv.run()
    assert(status == 0, "tmux did not start")

    must(adapter.run(function(runtime)
        local owner = connect(runtime, socket)
        local session = { name = "work", argv = { "/bin/cat" } }
        must(owner:new_session(session):await())
        must(owner:close():await())
        print_work(runtime, socket)
        return true
    end))
end, debug.traceback)

local stopped, stop_error = pcall(function()
    if uv.fs_stat(socket) then
        must(adapter.run(function(runtime)
            local owner = connect(runtime, socket)
            must(owner:command({ "kill-server" }):await())
            must(owner:close():await())
            return true
        end))
    end
    uv.fs_unlink(socket)
    assert(uv.fs_rmdir(directory))
end)

if not stopped then
    io.stderr:write(tostring(stop_error), "\n")
    io.stderr:write("Cannot stop tmux; kept ", directory, "\n")
end
if not ok then error(failure, 0) end
assert(stopped, "cleanup failed")
```

## Setup and run

Use an empty directory on Linux with Lua 5.5, LuaRocks, a C compiler, CMake, and
tmux 3.3a or newer installed. The commands install `libtmux` 0.1.1-1 and its luv
runtime adapter from LuaRocks into a local rocks tree ([source](https://github.com/libtmux/libtmux-lua/tree/d68f829fe097e38dcbbf7147e276666fe615f0cf)).

Install the rocks and run the program:

```console
$ luarocks --tree .rocks install luv 1.52.1-0 &&
  luarocks --tree .rocks install libtmux 0.1.1-1 &&
  eval "$(luarocks --tree .rocks path)" &&
  lua connect.lua
```

The program prints `work`. To use an existing server of your own, set
`LIBTMUX_SOCKET_PATH` to its socket before running the program; it prints
`work` and leaves that server running.

<a id="finding-a-session-instead-of-always-creating-one"></a>

## Find or create a session

The example only looks up a session. If your application creates a session
after an unsuccessful lookup, another client may create the same name between
those operations. Handle the creation error instead of assuming the lookup
reserves the name.

For a complete program that starts and owns its server, see
[Capture pane output](/examples/capture-pane-output/).
